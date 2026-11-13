'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, CameraOff, Loader2, Mic, MicOff, Phone, PhoneOff, Radio, Video, X } from 'lucide-react';
import Avatar from './Avatar';
import { useToast } from './Providers';

const initialView = { phase: 'idle', call: null, localStream: null, remoteStream: null, muted: false, cameraOff: false, busy: false };

function request(socket, event, payload, timeoutMs = 10000) {
  if (!socket?.connected) return Promise.reject(new Error('The call signaling connection is offline.'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The call server did not respond.')), timeoutMs);
    socket.emit(event, payload, (response) => {
      clearTimeout(timer);
      if (response?.error) {
        const error = new Error(response.error.message || 'The call request failed.');
        error.code = response.error.code;
        reject(error);
      } else resolve(response?.data);
    });
  });
}

export default function MediasoupCallOverlay({ socket, conversation, currentUserId }) {
  const [view, setView] = useState(initialView);
  const [controlsTarget, setControlsTarget] = useState(null);
  const viewRef = useRef(initialView);
  const callRef = useRef(null);
  const resources = useRef({
    device: null, sendTransport: null, recvTransport: null, localStream: null,
    producers: new Map(), consumers: new Map(), consuming: new Map(), pendingProducers: new Map(),
    remoteStream: null, callId: null, generation: 0, setupPromise: null, recoveryPromise: null
  });
  const localVideo = useRef(null);
  const remoteVideo = useRef(null);
  const remoteAudio = useRef(null);
  const recoverMediaRef = useRef(null);
  const mounted = useRef(true);
  const notify = useToast();
  const debug = useCallback((...details) => {
    try { if (sessionStorage.getItem('gather:call-debug') === 'true') console.info('[gather-call-debug]', ...details); } catch {}
  }, []);

  const update = useCallback((change) => {
    setView((old) => {
      const next = typeof change === 'function' ? change(old) : { ...old, ...change };
      viewRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    if (localVideo.current && view.localStream) localVideo.current.srcObject = view.localStream;
    if (remoteVideo.current && view.remoteStream) remoteVideo.current.srcObject = view.remoteStream;
    if (remoteAudio.current && view.remoteStream) remoteAudio.current.srcObject = view.remoteStream;
    if (remoteVideo.current && view.remoteStream) remoteVideo.current.play().catch(() => {});
    if (remoteAudio.current && view.remoteStream) remoteAudio.current.play().catch(() => {});
  }, [view.localStream, view.remoteStream, view.call]);

  useEffect(() => {
    setControlsTarget(conversation ? document.getElementById('call-controls') : null);
  }, [conversation?.id]);

  const disposeMedia = useCallback((stopTracks = true) => {
    const current = resources.current;
    current.generation += 1;
    current.setupPromise = null;
    current.consuming.clear();
    for (const { consumer } of current.consumers.values()) consumer.close();
    current.consumers.clear();
    current.pendingProducers.clear();
    for (const producer of current.producers.values()) producer.close();
    current.producers.clear();
    current.sendTransport?.close(); current.sendTransport = null;
    current.recvTransport?.close(); current.recvTransport = null;
    current.device = null;
    current.remoteStream?.getTracks().forEach((track) => track.stop());
    current.remoteStream = null;
    if (stopTracks) {
      current.localStream?.getTracks().forEach((track) => track.stop());
      current.localStream = null;
    }
    if (mounted.current) update({ localStream: stopTracks ? null : current.localStream, remoteStream: null, muted: false, cameraOff: false });
  }, [update]);

  const clearCall = useCallback((reason, shouldNotify = false) => {
    const call = callRef.current;
    disposeMedia(true);
    callRef.current = null;
    resources.current.callId = null;
    try { if (call?.id) sessionStorage.removeItem('gather:active-call'); } catch {}
    if (mounted.current) update(initialView);
    if (shouldNotify && reason) notify(reason, 'error');
  }, [disposeMedia, notify, update]);

  const attachTransportHandlers = useCallback((transport, callId, direction, generation) => {
    transport.on('connect', ({ dtlsParameters }, callback, errback) => {
      request(socket, 'mediasoup:connect-transport', { callId, transportId: transport.id, dtlsParameters }).then(() => callback()).catch(errback);
    });
    if (direction === 'send') {
      transport.on('produce', ({ kind, rtpParameters }, callback, errback) => {
        request(socket, 'mediasoup:produce', { callId, transportId: transport.id, kind, rtpParameters })
          .then((result) => callback({ id: result.id })).catch(errback);
      });
    }
    transport.on('connectionstatechange', (connectionState) => {
      if (generation !== resources.current.generation) return;
      debug(`${direction} transport state`, connectionState);
      if (connectionState === 'failed') recoverMediaRef.current?.('The media connection dropped. Reconnecting…');
    });
  }, [debug, socket]);

  const consumeProducer = useCallback(async (producerInfo) => {
    const current = resources.current;
    const call = callRef.current;
    if (!call || !producerInfo?.producerId || producerInfo.callId !== call.id || !current.device || !current.recvTransport) {
      if (call && producerInfo?.producerId && producerInfo.callId === call.id) current.pendingProducers.set(producerInfo.producerId, producerInfo);
      return;
    }
    if (current.consumers.has(producerInfo.producerId)) return;
    if (current.consuming.has(producerInfo.producerId)) return current.consuming.get(producerInfo.producerId);
    const generation = current.generation;
    const task = (async () => {
      let response;
      let consumer;
      let attached = false;
      try {
        response = await request(socket, 'mediasoup:consume', {
          callId: call.id, transportId: current.recvTransport.id, producerId: producerInfo.producerId,
          rtpCapabilities: current.device.rtpCapabilities
        });
        debug('server consumer created', producerInfo.kind, producerInfo.producerId);
        if (generation !== resources.current.generation || !resources.current.recvTransport) {
          request(socket, 'mediasoup:close-consumer', { callId: call.id, consumerId: response.id }).catch(() => {});
          return;
        }
        consumer = await resources.current.recvTransport.consume({
          id: response.id, producerId: response.producerId, kind: response.kind, rtpParameters: response.rtpParameters
        });
        if (generation !== resources.current.generation) {
          consumer.close();
          request(socket, 'mediasoup:close-consumer', { callId: call.id, consumerId: response.id }).catch(() => {});
          return;
        }
        await request(socket, 'mediasoup:resume-consumer', { callId: call.id, consumerId: consumer.id });
        if (generation !== resources.current.generation) {
          consumer.close();
          request(socket, 'mediasoup:close-consumer', { callId: call.id, consumerId: response.id }).catch(() => {});
          return;
        }
        if (producerInfo.paused) consumer.track.enabled = false;
        debug('remote track ready', consumer.track.kind, consumer.track.readyState);
        const onClose = () => {
          if (generation !== resources.current.generation) return;
          const stream = resources.current.remoteStream;
          if (!stream) return;
          const remainingTracks = stream.getTracks().filter((track) => track !== consumer.track);
          const nextStream = remainingTracks.length ? new MediaStream(remainingTracks) : null;
          resources.current.remoteStream = nextStream;
          resources.current.consumers.delete(producerInfo.producerId);
          if (mounted.current) update({ remoteStream: nextStream });
        };
        consumer.on('producerclose', onClose);
        consumer.on('transportclose', onClose);
        consumer.on('trackended', onClose);
        const oldTracks = resources.current.remoteStream?.getTracks() || [];
        const remoteStream = new MediaStream([...oldTracks, consumer.track]);
        resources.current.remoteStream = remoteStream;
        resources.current.consumers.set(producerInfo.producerId, { consumer, userId: producerInfo.userId });
        attached = true;
        if (mounted.current) update({ remoteStream });
      } catch (error) {
        if (!attached && response?.id && socket.connected) request(socket, 'mediasoup:close-consumer', { callId: call.id, consumerId: response.id }).catch(() => {});
        debug('remote consumer failed', producerInfo.kind, producerInfo.producerId, error?.message);
        throw error;
      }
    })();
    current.consuming.set(producerInfo.producerId, task);
    try { await task; }
    finally { current.consuming.delete(producerInfo.producerId); }
  }, [debug, socket, update]);

  const createMedia = useCallback(async (call, suppliedStream = null) => {
    const current = resources.current;
    if (!call?.id || !socket?.connected) throw new Error('The call signaling connection is offline.');
    if (current.setupPromise) return current.setupPromise;
    const generation = ++current.generation;
    current.callId = call.id;
    const isCurrent = () => generation === resources.current.generation && resources.current.callId === call.id && callRef.current?.id === call.id;
    const task = (async () => {
      const mediaDevices = navigator.mediaDevices;
      if (!mediaDevices?.getUserMedia) throw new Error('Camera and microphone access requires a supported browser on HTTPS or localhost.');
      debug('requesting local media', call.id, call.type);
      let localStream = suppliedStream || current.localStream || await mediaDevices.getUserMedia({ audio: true, video: call.type === 'VIDEO' });
      debug('local media tracks', call.id, localStream.getTracks().map((track) => `${track.kind}:${track.readyState}`).join(','));
      if (generation !== resources.current.generation) { if (localStream !== resources.current.localStream) localStream.getTracks().forEach((track) => track.stop()); return; }
      current.localStream = localStream;
      if (mounted.current) update({ localStream, phase: 'connecting', busy: true });

      const { Device } = await import('mediasoup-client');
      const device = new Device();
      const capabilities = await request(socket, 'mediasoup:get-router-capabilities', { callId: call.id });
      await device.load({ routerRtpCapabilities: capabilities.rtpCapabilities });
      if (!isCurrent()) return;
      current.device = device;

      const sendData = await request(socket, 'mediasoup:create-transport', { callId: call.id, direction: 'send' });
      if (!isCurrent()) { request(socket, 'mediasoup:close-transport', { callId: call.id, transportId: sendData.transport.id }).catch(() => {}); return; }
      const sendTransport = device.createSendTransport(sendData.transport);
      current.sendTransport = sendTransport;
      attachTransportHandlers(sendTransport, call.id, 'send', generation);

      const recvData = await request(socket, 'mediasoup:create-transport', { callId: call.id, direction: 'recv' });
      if (!isCurrent()) {
        request(socket, 'mediasoup:close-transport', { callId: call.id, transportId: recvData.transport.id }).catch(() => {});
        sendTransport.close();
        return;
      }
      const recvTransport = device.createRecvTransport(recvData.transport);
      current.recvTransport = recvTransport;
      attachTransportHandlers(recvTransport, call.id, 'recv', generation);

      const mediaKinds = call.type === 'VIDEO' ? ['audio', 'video'] : ['audio'];
      for (const kind of mediaKinds) {
        if (kind === 'video' && !device.canProduce('video')) continue;
        let producer;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          let track = localStream.getTracks().find((item) => item.kind === kind && item.readyState === 'live');
          if (!track) {
            if (attempt > 0) throw new Error(`Your ${kind === 'audio' ? 'microphone' : 'camera'} track stopped during setup.`);
            debug(`reacquiring ended ${kind} track`);
            const replacementStream = await mediaDevices.getUserMedia({ audio: true, video: call.type === 'VIDEO' });
            if (!isCurrent()) { replacementStream.getTracks().forEach((item) => item.stop()); return; }
            track = replacementStream.getTracks().find((item) => item.kind === kind && item.readyState === 'live');
            if (!track) { replacementStream.getTracks().forEach((item) => item.stop()); throw new Error(`The browser did not provide a live ${kind} track.`); }
            const retained = localStream.getTracks().filter((item) => item.kind !== kind && item.readyState === 'live');
            replacementStream.getTracks().filter((item) => item !== track).forEach((item) => item.stop());
            localStream = new MediaStream([...retained, track]);
            current.localStream = localStream;
            if (mounted.current) update({ localStream });
            debug(`reacquired ended ${kind} track`);
          }
          try {
            producer = await sendTransport.produce({ track, appData: { mediaKind: kind } });
            break;
          } catch (error) {
            if (attempt === 0 && track.readyState === 'ended') { debug(`${kind} track ended while producing; retrying`); continue; }
            throw error;
          }
        }
        if (!isCurrent()) { producer?.close(); return; }
        current.producers.set(kind, producer);
        const track = producer.track;
        track.addEventListener('ended', () => {
          if (!callRef.current || callRef.current.id !== call.id) return;
          if (track.kind === 'audio') recoverMedia('Your microphone disconnected.');
          else { request(socket, 'media:pause-producer', { callId: call.id, producerId: producer.id }).catch(() => {}); if (mounted.current) update({ cameraOff: true }); }
        }, { once: true });
      }

      const existing = await request(socket, 'mediasoup:list-producers', { callId: call.id });
      if (!isCurrent()) return;
      for (const producerInfo of existing.producers || []) await consumeProducer({ ...producerInfo, callId: call.id });
      for (const producerInfo of current.pendingProducers.values()) await consumeProducer(producerInfo);
      current.pendingProducers.clear();
      if (mounted.current) update({ phase: 'connecting', busy: false });
    })();
    current.setupPromise = task;
    try { await task; }
    catch (error) { debug('media setup failed', call.id, error?.name, error?.message); throw error; }
    finally { if (resources.current.setupPromise === task) resources.current.setupPromise = null; }
  }, [attachTransportHandlers, consumeProducer, debug, socket, update]);

  const recoverMedia = useCallback((message = 'Reconnecting the media session…') => {
    const call = callRef.current;
    if (resources.current.recoveryPromise) return resources.current.recoveryPromise;
    if (!call?.id || !socket?.connected) return Promise.resolve();
    const task = Promise.resolve().then(async () => {
      const stream = resources.current.localStream;
      if (mounted.current) update({ phase: 'reconnecting', busy: true });
      debug('starting media recovery', call.id, message);
      try {
        disposeMedia(false);
        const recovered = await request(socket, 'call:resume', { callId: call.id });
        if (!socket.connected || callRef.current?.id !== call.id) return;
        const status = String(recovered.status || call.status).toLowerCase();
        const resumed = { ...callRef.current, status };
        callRef.current = resumed;
        if (['accepted', 'connecting', 'connected'].includes(status)) await createMedia(resumed, stream);
        else update((previous) => ({ ...previous, call: resumed, phase: status, busy: false }));
        if (mounted.current) notify(message);
      } catch (error) {
        debug('media recovery failed', call.id, error?.name, error?.message, `socketConnected=${socket.connected}`);
        if (socket?.connected && callRef.current?.id === call.id) {
          socket.emit('call:end', { callId: call.id });
          clearCall(error.message || 'The media session could not be restored.', true);
        }
      }
    }).finally(() => {
      if (resources.current.recoveryPromise === task) resources.current.recoveryPromise = null;
    });
    resources.current.recoveryPromise = task;
    return task;
  }, [clearCall, createMedia, debug, disposeMedia, notify, socket, update]);
  recoverMediaRef.current = recoverMedia;

  const startCall = useCallback(async (type) => {
    if (!socket?.connected || !conversation || callRef.current) { notify('Connect to messages and select a conversation before calling.', 'error'); return; }
    const peer = conversation.participants?.find((item) => item.userId !== currentUserId)?.user;
    if (!peer) { notify('This conversation is not ready for calling.', 'error'); return; }
    const call = { id: null, peerId: peer.id, peerName: peer.username, type, status: 'calling', direction: 'outgoing', conversationId: conversation.id };
    callRef.current = call;
    update({ ...initialView, phase: 'calling', call, busy: true });
    try {
      const result = await request(socket, 'call:start', { toUserId: peer.id, conversationId: conversation.id, type });
      const latest = callRef.current?.id === result.callId ? callRef.current : call;
      const active = { ...call, ...latest, id: result.callId, status: latest.status === 'calling' ? result.status.toLowerCase() : latest.status };
      callRef.current = active;
      try { sessionStorage.setItem('gather:active-call', active.id); } catch {}
      update((previous) => ({ ...previous, call: active, phase: active.status, busy: false }));
      if (active.status === 'accepted') await createMedia(active);
    } catch (error) { callRef.current = null; update(initialView); notify(error.message, 'error'); }
  }, [conversation, createMedia, currentUserId, notify, socket, update]);

  const acceptCall = useCallback(async () => {
    const call = callRef.current;
    if (!call?.id || call.direction !== 'incoming' || !socket?.connected) return;
    update((previous) => ({ ...previous, busy: true }));
    let stream;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera and microphone access requires a supported browser on HTTPS or localhost.');
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: call.type === 'VIDEO' });
      await request(socket, 'call:accept', { callId: call.id });
      const accepted = { ...call, status: 'accepted' };
      callRef.current = accepted;
      update((previous) => ({ ...previous, call: accepted, phase: 'accepted', busy: true }));
      await createMedia(accepted, stream);
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      if (callRef.current?.id === call.id && socket?.connected) socket.emit('call:reject', { callId: call.id });
      clearCall(error.name === 'NotAllowedError' ? 'Allow camera and microphone access to answer.' : error.message, true);
    }
  }, [clearCall, createMedia, socket, update]);

  const rejectCall = useCallback(async () => {
    const call = callRef.current;
    if (!call?.id) return;
    try { await request(socket, 'call:reject', { callId: call.id }); } catch {}
    clearCall();
  }, [clearCall, socket]);

  const hangup = useCallback(async () => {
    const call = callRef.current;
    if (!call) return;
    update((previous) => ({ ...previous, phase: 'ending', busy: true }));
    try {
      if (call.direction === 'outgoing' && ['calling', 'ringing'].includes(call.status)) await request(socket, 'call:cancel', { callId: call.id });
      else await request(socket, 'call:end', { callId: call.id });
    } catch {}
    clearCall();
  }, [clearCall, socket, update]);

  const toggleProducer = useCallback(async (kind) => {
    const call = callRef.current;
    const producer = resources.current.producers.get(kind);
    if (!call?.id || !producer || !socket?.connected) return;
    const paused = kind === 'audio' ? !viewRef.current.muted : !viewRef.current.cameraOff;
    const track = producer.track;
    try {
      await request(socket, paused ? 'media:pause-producer' : 'media:resume-producer', { callId: call.id, producerId: producer.id });
      if (track) track.enabled = !paused;
      update(kind === 'audio' ? { muted: paused } : { cameraOff: paused });
    } catch (error) { notify(error.message, 'error'); }
  }, [notify, socket, update]);

  useEffect(() => {
    mounted.current = true;
    if (!socket) return () => { mounted.current = false; };
    const onRing = (payload) => {
      if (callRef.current && callRef.current.id !== payload.callId) {
        socket.emit('call:reject', { callId: payload.callId });
        return;
      }
      const incoming = { id: payload.callId, peerId: payload.fromUserId, peerName: payload.fromUser?.username, type: payload.type, status: 'ringing', direction: 'incoming', conversationId: payload.conversationId };
      callRef.current = incoming;
      try { sessionStorage.setItem('gather:active-call', incoming.id); } catch {}
      update({ ...initialView, call: incoming, phase: 'ringing' });
    };
    const onAccepted = ({ callId }) => {
      const current = callRef.current;
      if (!current || (current.id && current.id !== callId)) return;
      const accepted = { ...current, id: callId, status: 'accepted' };
      callRef.current = accepted;
      try { sessionStorage.setItem('gather:active-call', callId); } catch {}
      update((previous) => ({ ...previous, call: accepted, phase: 'accepted', busy: accepted.direction === 'outgoing' }));
      if (accepted.direction === 'outgoing') createMedia(accepted).catch((error) => {
        if (error.name === 'NotAllowedError') { socket.emit('call:end', { callId }); clearCall('Allow camera and microphone access to place this call.', true); }
        else if (socket.connected) { socket.emit('call:end', { callId }); clearCall(error.message, true); }
      });
    };
    const onCallState = ({ callId, status }) => {
      const current = callRef.current;
      if (!current || (current.id && current.id !== callId)) return;
      const next = { ...current, id: callId, status: String(status || 'RINGING').toLowerCase() };
      callRef.current = next;
      update((previous) => ({ ...previous, call: next, phase: next.status }));
    };
    const onEnded = ({ callId, reason }) => {
      if (callRef.current?.id && callRef.current.id !== callId) return;
      clearCall(reason === 'peer_disconnected' ? 'The other person disconnected.' : null, reason === 'peer_disconnected');
    };
    const onRejected = ({ callId }) => {
      if (callRef.current?.id === callId) clearCall('Your call was declined.', true);
    };
    const onReplaced = ({ callId }) => { if (callRef.current?.id === callId) clearCall('This call moved to another Gather session.', true); };
    const onProducerCreated = (payload) => { if (callRef.current?.id === payload.callId) consumeProducer(payload).catch((error) => notify(error.message, 'error')); };
    const onProducerClosed = ({ callId, producerId }) => {
      if (callRef.current?.id !== callId) return;
      const entry = resources.current.consumers.get(producerId);
      if (entry) { entry.consumer.close(); resources.current.consumers.delete(producerId); }
    };
    const onProducerState = ({ callId, producerId, paused }) => {
      if (callRef.current?.id !== callId) return;
      const entry = resources.current.consumers.get(producerId);
      if (entry) entry.consumer.track.enabled = !paused;
    };
    const onPeerReconnecting = ({ callId, userId }) => {
      if (callRef.current?.id === callId && callRef.current.peerId === userId) update((previous) => ({ ...previous, call: { ...previous.call, peerStatus: 'reconnecting' } }));
    };
    const onPeerReconnected = ({ callId, userId }) => {
      if (callRef.current?.id === callId && callRef.current.peerId === userId) update((previous) => ({ ...previous, call: { ...previous.call, peerStatus: 'connected' } }));
    };
    const onTransportFailed = ({ callId, reason }) => { if (callRef.current?.id === callId) recoverMedia(reason || 'The media connection failed. Reconnecting…'); };
    const onDisconnect = () => {
      const current = callRef.current;
      if (!current) return;
      const call = { ...current, status: 'reconnecting' };
      callRef.current = call;
      update((previous) => ({ ...previous, phase: 'reconnecting', call }));
      disposeMedia(false);
    };
    const onConnect = async () => {
      const current = callRef.current;
      if (!current) {
        let storedCallId;
        try { storedCallId = sessionStorage.getItem('gather:active-call'); } catch {}
        if (!storedCallId) return;
        try {
          const recovered = await request(socket, 'call:resume', { callId: storedCallId });
          const status = recovered.status.toLowerCase();
          const resumed = { id: recovered.callId, peerId: recovered.peerId, peerName: recovered.peer?.username, type: recovered.type, status, direction: status === 'ringing' && recovered.role === 'callee' ? 'incoming' : status === 'ringing' ? 'outgoing' : 'resumed', conversationId: recovered.conversationId };
          callRef.current = resumed;
          update((previous) => ({ ...previous, call: resumed, phase: 'reconnecting', busy: true }));
          if (['accepted', 'connecting', 'connected'].includes(status)) await createMedia(resumed, resources.current.localStream);
          else update((previous) => ({ ...previous, phase: status, busy: false }));
        } catch { try { sessionStorage.removeItem('gather:active-call'); } catch {} }
        return;
      }
      if (current.status === 'reconnecting') recoverMedia('The call reconnected.');
    };
    socket.on('call:ring', onRing); socket.on('call:accepted', onAccepted); socket.on('call:state', onCallState);
    socket.on('call:ended', onEnded); socket.on('call:rejected', onRejected); socket.on('call:replaced', onReplaced);
    socket.on('media:producer-created', onProducerCreated); socket.on('media:producer-closed', onProducerClosed);
    socket.on('media:producer-state', onProducerState); socket.on('media:transport-failed', onTransportFailed);
    socket.on('peer:reconnecting', onPeerReconnecting); socket.on('peer:reconnected', onPeerReconnected);
    socket.on('disconnect', onDisconnect); socket.on('connect', onConnect);
    if (socket.connected) onConnect();
    return () => {
      mounted.current = false;
      socket.off('call:ring', onRing); socket.off('call:accepted', onAccepted); socket.off('call:state', onCallState);
      socket.off('call:ended', onEnded); socket.off('call:rejected', onRejected); socket.off('call:replaced', onReplaced);
      socket.off('media:producer-created', onProducerCreated); socket.off('media:producer-closed', onProducerClosed);
      socket.off('media:producer-state', onProducerState); socket.off('media:transport-failed', onTransportFailed);
      socket.off('peer:reconnecting', onPeerReconnecting); socket.off('peer:reconnected', onPeerReconnected);
      socket.off('disconnect', onDisconnect); socket.off('connect', onConnect);
      const call = callRef.current;
      if (call?.id && socket.connected) socket.emit('call:end', { callId: call.id });
      disposeMedia(true);
    };
  }, [clearCall, consumeProducer, createMedia, disposeMedia, notify, recoverMedia, socket, update]);

  const peer = conversation?.participants?.find((item) => item.userId === view.call?.peerId)?.user;
  const peerName = peer?.username || view.call?.peerName || 'Your contact';
  const phase = view.call?.status || view.phase;
  const incoming = view.call?.direction === 'incoming' && phase === 'ringing';

  return <>
    {controlsTarget && conversation && !view.call && createPortal(<><button title="Voice call" aria-label="Start voice call" onClick={() => startCall('VOICE')} className="rounded-full p-2.5 text-ink/60 hover:bg-paper hover:text-moss"><Phone size={18} /></button><button title="Video call" aria-label="Start video call" onClick={() => startCall('VIDEO')} className="rounded-full p-2.5 text-ink/60 hover:bg-paper hover:text-moss"><Video size={19} /></button></>, controlsTarget)}
    {view.call && typeof document !== 'undefined' && createPortal(<div role="dialog" aria-modal="true" aria-label={`${view.call.type.toLowerCase()} call`} className="fixed inset-0 z-[70] grid place-items-center bg-[#0c1713]/95 p-3 text-white sm:p-8">
      <div className="absolute right-5 top-5 flex items-center gap-2"><span className="h-2 w-2 animate-pulse rounded-full bg-[#91d8ac]" /><span className="text-xs uppercase tracking-[.2em] text-white/60">{phase}</span><button aria-label="Close call window" onClick={hangup} className="ml-2 rounded-full bg-white/10 p-2"><X size={18} /></button></div>
      <div className="relative h-[min(80vh,760px)] w-full max-w-4xl overflow-hidden rounded-[30px] bg-[#21352c]">
        {view.call.type === 'VIDEO' && view.remoteStream?.getVideoTracks().length > 0 && <video ref={remoteVideo} autoPlay muted playsInline className="h-full w-full object-cover" />}
        <audio ref={remoteAudio} autoPlay className="hidden" />
        {(view.call.type === 'VOICE' || !view.remoteStream?.getVideoTracks().length) && <div className="flex h-full flex-col items-center justify-center"><Avatar src={peer?.image} name={peerName} size="xl" /><h2 className="mt-5 text-2xl font-semibold">{peerName}</h2><p className="mt-2 text-sm capitalize text-white/55">{incoming ? 'Incoming call' : phase === 'calling' ? 'Calling…' : phase === 'reconnecting' ? 'Reconnecting…' : view.call.peerStatus === 'reconnecting' ? 'Your contact is reconnecting…' : phase === 'connected' ? 'Connected' : 'Connecting media…'}</p><div className="mt-6 flex items-center gap-2 text-xs text-white/35"><Radio size={14} /> Media routed securely through Gather SFU</div></div>}
        {view.call.type === 'VIDEO' && view.localStream && <video ref={localVideo} autoPlay muted playsInline className="absolute bottom-4 right-4 aspect-video w-36 rounded-2xl border border-white/25 bg-black object-cover sm:w-52" />}
        <div className="absolute inset-x-0 bottom-5 flex justify-center gap-3">
          {incoming ? <><button onClick={acceptCall} disabled={view.busy} className="flex items-center gap-2 rounded-full bg-moss px-6 py-3 text-sm font-semibold disabled:opacity-50">{view.busy ? <Loader2 size={18} className="animate-spin" /> : <Phone size={18} />}Answer</button><button onClick={rejectCall} disabled={view.busy} className="flex items-center gap-2 rounded-full bg-coral px-6 py-3 text-sm font-semibold"><PhoneOff size={18} />Decline</button></> : <><button onClick={() => toggleProducer('audio')} disabled={view.busy || !resources.current.producers.has('audio')} className={`grid h-12 w-12 place-items-center rounded-full disabled:opacity-40 ${view.muted ? 'bg-coral' : 'bg-white/15'}`} aria-label={view.muted ? 'Unmute microphone' : 'Mute microphone'}>{view.muted ? <MicOff /> : <Mic />}</button>{view.call.type === 'VIDEO' && <button onClick={() => toggleProducer('video')} disabled={view.busy || !resources.current.producers.has('video')} className={`grid h-12 w-12 place-items-center rounded-full disabled:opacity-40 ${view.cameraOff ? 'bg-coral' : 'bg-white/15'}`} aria-label={view.cameraOff ? 'Turn camera on' : 'Turn camera off'}>{view.cameraOff ? <CameraOff /> : <Camera />}</button>}<button onClick={hangup} className="grid h-12 w-12 place-items-center rounded-full bg-[#d64c43]" aria-label={view.call.direction === 'outgoing' && ['calling', 'ringing'].includes(phase) ? 'Cancel call' : 'End call'}><PhoneOff /></button></>}
        </div>
      </div>
      <p className="mt-4 max-w-lg text-center text-xs leading-5 text-white/35">Gather routes live audio and video through a mediasoup SFU. Your browser controls camera and microphone permissions.</p>
    </div>, document.body)}
  </>;
}
