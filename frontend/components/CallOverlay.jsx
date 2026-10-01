'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Mic, MicOff, Phone, PhoneOff, Radio, Video, X } from 'lucide-react';
import Avatar from './Avatar';
import { useToast } from './Providers';

export default function CallOverlay({ socket, conversation, currentUserId }) {
  const [call, setCall] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const pcRef = useRef(null);
  const streamRef = useRef(null);
  const pendingIce = useRef([]);
  const pendingLocalIce = useRef([]);
  const callIdRef = useRef(null);
  const localVideo = useRef(null);
  const remoteVideo = useRef(null);
  const notify = useToast();

  useEffect(() => { if (localVideo.current && localStream) localVideo.current.srcObject = localStream; }, [localStream, call]);
  useEffect(() => { if (remoteVideo.current && remoteStream) remoteVideo.current.srcObject = remoteStream; }, [remoteStream, call]);

  const cleanup = () => {
    pcRef.current?.close(); pcRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null;
    pendingIce.current = []; pendingLocalIce.current = []; callIdRef.current = null; setLocalStream(null); setRemoteStream(null); setCall(null); setBusy(false); setMuted(false); setCameraOff(false);
  };

  useEffect(() => {
    if (!socket) return;
    const onOffer = (payload) => { callIdRef.current = payload.callId; setCall({ id: payload.callId, peerId: payload.fromUserId, type: payload.type, status: 'ringing', offer: payload.offer }); };
    const onAccepted = ({ callId }) => setCall((active) => active?.id === callId ? { ...active, status: 'accepted' } : active);
    const onAnswer = async ({ callId, answer }) => {
      const pc = pcRef.current;
      if (!pc || call?.id !== callId) return;
      try { await pc.setRemoteDescription(answer); for (const candidate of pendingIce.current.splice(0)) await pc.addIceCandidate(candidate); setCall((active) => active ? { ...active, status: 'accepted' } : active); }
      catch { setCall((active) => active ? { ...active, status: 'failed' } : active); }
    };
    const onCandidate = async ({ callId, candidate }) => {
      if (call && call.id !== callId) return;
      const value = candidate;
      if (!pcRef.current?.remoteDescription) { pendingIce.current.push(value); return; }
      try { await pcRef.current.addIceCandidate(value); } catch { /* A stale candidate can be ignored. */ }
    };
    const onEnded = ({ callId, reason }) => { if (call?.id && call.id !== callId) return; cleanup(); if (reason === 'disconnect') notify('The other person disconnected.', 'error'); };
    const onRejected = ({ callId }) => { if (call?.id === callId) { cleanup(); notify('Your call was declined.'); } };
    socket.on('call:offer', onOffer); socket.on('call:accepted', onAccepted); socket.on('call:answer', onAnswer); socket.on('call:ice-candidate', onCandidate); socket.on('call:ended', onEnded); socket.on('call:rejected', onRejected);
    return () => { socket.off('call:offer', onOffer); socket.off('call:accepted', onAccepted); socket.off('call:answer', onAnswer); socket.off('call:ice-candidate', onCandidate); socket.off('call:ended', onEnded); socket.off('call:rejected', onRejected); };
  }, [socket, call?.id]);

  const setupPeer = async (type) => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser does not support camera or microphone access. Use HTTPS or localhost.');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: type === 'VIDEO' });
    streamRef.current = stream; setLocalStream(stream);
    const pc = new RTCPeerConnection({ iceServers: process.env.NEXT_PUBLIC_STUN_URL ? [{ urls: process.env.NEXT_PUBLIC_STUN_URL }] : [] });
    pcRef.current = pc;
    const remote = new MediaStream(); setRemoteStream(remote);
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    pc.ontrack = (event) => event.streams[0]?.getTracks().forEach((track) => remote.addTrack(track));
    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      if (callIdRef.current) socket?.emit('call:ice-candidate', { callId: callIdRef.current, candidate: event.candidate });
      else pendingLocalIce.current.push(event.candidate);
    };
    pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) setCall((active) => active ? { ...active, status: 'failed' } : active); };
    return pc;
  };

  const startCall = async (type) => {
    if (!socket?.connected || !conversation || busy) { notify('Connect to messages and select a conversation first.', 'error'); return; }
    const peer = conversation.participants?.find((item) => item.userId !== currentUserId)?.user;
    if (!peer) { notify('This conversation is not ready for calling.', 'error'); return; }
    setBusy(true); setCall({ peerId: peer.id, peerName: peer.username, type, status: 'calling' });
    try {
      const pc = await setupPeer(type);
      const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
      socket.emit('call:offer', { toUserId: peer.id, offer: pc.localDescription, type, conversationId: conversation.id }, (result) => {
        if (result?.error) { cleanup(); notify(result.error.message, 'error'); return; }
        callIdRef.current = result.data.callId;
        for (const candidate of pendingLocalIce.current.splice(0)) socket.emit('call:ice-candidate', { callId: callIdRef.current, candidate });
        setCall((active) => active ? { ...active, id: result.data.callId, status: 'calling', peerName: peer.username } : active);
      });
    } catch (error) { cleanup(); notify(error.name === 'NotAllowedError' ? 'Allow camera and microphone access to place this call.' : error.message, 'error'); }
  };

  const accept = async () => {
    if (!call?.offer || !socket) return;
    setBusy(true);
    try {
      const pc = await setupPeer(call.type); await pc.setRemoteDescription(call.offer);
      for (const candidate of pendingIce.current.splice(0)) await pc.addIceCandidate(candidate);
      const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
      socket.emit('call:accepted', { callId: call.id }); socket.emit('call:answer', { callId: call.id, answer: pc.localDescription });
      setCall((active) => active ? { ...active, status: 'accepted', offer: null } : active);
    } catch (error) { socket.emit('call:rejected', { callId: call.id }); cleanup(); notify(error.name === 'NotAllowedError' ? 'Allow camera and microphone access to accept this call.' : error.message, 'error'); }
  };

  const reject = () => { socket?.emit('call:rejected', { callId: call?.id }); cleanup(); };
  const hangup = () => { socket?.emit('call:ended', { callId: call?.id }); cleanup(); };
  const toggleMute = () => { const next = !muted; streamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !next; }); setMuted(next); };
  const toggleCamera = () => { const next = !cameraOff; streamRef.current?.getVideoTracks().forEach((track) => { track.enabled = !next; }); setCameraOff(next); };

  const peerName = conversation?.participants?.find((item) => item.userId === call?.peerId)?.user?.username || call?.peerName || 'Your contact';
  return <>
    {!call && <div className="flex gap-1"><button title="Voice call" aria-label="Start voice call" onClick={() => startCall('VOICE')} className="rounded-full p-2.5 text-ink/60 hover:bg-paper hover:text-moss"><Phone size={18} /></button><button title="Video call" aria-label="Start video call" onClick={() => startCall('VIDEO')} className="rounded-full p-2.5 text-ink/60 hover:bg-paper hover:text-moss"><Video size={19} /></button></div>}
    {call && <div role="dialog" aria-modal="true" aria-label={`${call.type.toLowerCase()} call`} className="fixed inset-0 z-[70] grid place-items-center bg-[#0c1713]/95 p-3 text-white sm:p-8">
      <div className="absolute right-5 top-5 flex items-center gap-2"><span className="h-2 w-2 animate-pulse rounded-full bg-[#91d8ac]" /><span className="text-xs uppercase tracking-[.2em] text-white/60">{call.status}</span><button aria-label="Close call window" onClick={hangup} className="ml-2 rounded-full bg-white/10 p-2"><X size={18} /></button></div>
      <div className="relative h-[min(80vh,760px)] w-full max-w-4xl overflow-hidden rounded-[30px] bg-[#21352c]">
        {call.type === 'VIDEO' && call.status === 'accepted' && <video ref={remoteVideo} autoPlay playsInline className="h-full w-full object-cover" />}
        {(call.type === 'VOICE' || call.status !== 'accepted') && <div className="flex h-full flex-col items-center justify-center"><Avatar src={null} name={peerName} size="xl" /><h2 className="mt-5 text-2xl font-semibold">{peerName}</h2><p className="mt-2 text-sm capitalize text-white/55">{call.status === 'calling' ? 'Calling…' : call.status === 'ringing' ? 'Incoming call' : call.status === 'failed' ? 'Connection failed' : call.status === 'accepted' ? 'Voice call in progress' : 'Connecting…'}</p><div className="mt-6 flex items-center gap-2 text-xs text-white/35"><Radio size={14} /> Peer-to-peer encrypted media</div></div>}
        {call.type === 'VIDEO' && localStream && <video ref={localVideo} autoPlay muted playsInline className="absolute bottom-4 right-4 aspect-video w-36 rounded-2xl border border-white/25 bg-black object-cover sm:w-52" />}
        <div className="absolute inset-x-0 bottom-5 flex justify-center gap-3">{call.status === 'ringing' && call.offer ? <><button onClick={accept} disabled={busy} className="flex items-center gap-2 rounded-full bg-moss px-6 py-3 text-sm font-semibold"><Phone size={18} />Accept</button><button onClick={reject} className="flex items-center gap-2 rounded-full bg-coral px-6 py-3 text-sm font-semibold"><PhoneOff size={18} />Decline</button></> : <><button onClick={toggleMute} className={`grid h-12 w-12 place-items-center rounded-full ${muted ? 'bg-coral' : 'bg-white/15'}`} aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}>{muted ? <MicOff /> : <Mic />}</button>{call.type === 'VIDEO' && <button onClick={toggleCamera} className={`grid h-12 w-12 place-items-center rounded-full ${cameraOff ? 'bg-coral' : 'bg-white/15'}`} aria-label={cameraOff ? 'Turn camera on' : 'Turn camera off'}>{cameraOff ? <CameraOff /> : <Camera />}</button>}<button onClick={hangup} className="grid h-12 w-12 place-items-center rounded-full bg-[#d64c43]" aria-label="End call"><PhoneOff /></button></>}</div>
      </div>
      <p className="mt-4 max-w-lg text-center text-xs leading-5 text-white/35">Calls connect directly between browsers. A TURN relay may be needed when either network blocks peer connections.</p>
    </div>}
  </>;
}
