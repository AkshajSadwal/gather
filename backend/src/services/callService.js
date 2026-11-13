const { MediasoupService } = require('./mediasoupService');
const { isBlockedBetween } = require('./blocks');

const activeStates = new Set(['RINGING', 'ACCEPTED', 'CONNECTING', 'CONNECTED']);
const allowedTransitions = {
  CALLING: new Set(['RINGING', 'ENDED', 'FAILED']),
  RINGING: new Set(['ACCEPTED', 'REJECTED', 'ENDED', 'FAILED']),
  ACCEPTED: new Set(['CONNECTING', 'ENDED', 'FAILED']),
  CONNECTING: new Set(['CONNECTED', 'ENDED', 'FAILED']),
  CONNECTED: new Set(['CONNECTING', 'ENDED', 'FAILED']),
  REJECTED: new Set(), ENDED: new Set(), FAILED: new Set()
};

class CallService {
  constructor({ io, prisma, config, activeCalls = new Map() }) {
    this.io = io;
    this.prisma = prisma;
    this.config = config;
    this.calls = activeCalls;
    this.busyUsers = new Map();
    this.queue = Promise.resolve();
    this.closed = false;
    this.media = new MediasoupService({
      io,
      config,
      onWorkerRoomFailure: (callId, error) => this.end(callId, 'FAILED', 'MEDIA_WORKER_DIED', error),
      onTransportFailure: (callId) => this.markReconnecting(callId)
    });
    this.media.callParticipants = (callId) => {
      const call = this.calls.get(callId);
      return call ? [call.initiatorId, call.recipientId] : [];
    };
    this.ready = this.media.ready.then(() => this.failOrphanedPersistedCalls());
  }

  exclusive(operation) {
    const result = this.queue.then(operation, operation);
    this.queue = result.catch(() => {});
    return result;
  }

  async failOrphanedPersistedCalls() {
    await this.prisma.callSession.updateMany({
      where: { status: { in: ['CALLING', 'RINGING', 'ACCEPTED', 'CONNECTING', 'CONNECTED'] } },
      data: { status: 'FAILED', endedAt: new Date(), failureReason: 'SERVER_RESTARTED' }
    });
  }

  callState(call) {
    return { callId: call.id, status: call.status, type: call.type, conversationId: call.conversationId, peerId: null };
  }

  emitToParticipants(call, event, payload) {
    this.io.to(`user:${call.initiatorId}`).emit(event, payload);
    this.io.to(`user:${call.recipientId}`).emit(event, payload);
  }

  async setStatus(call, status, failureReason = null) {
    const previousStatus = call.status;
    if (previousStatus === status) return false;
    if (!allowedTransitions[previousStatus]?.has(status)) throw new Error('INVALID_CALL_STATE');
    if (process.env.CALL_DEBUG === 'true') console.info(`[call-debug] ${call.id.slice(0, 8)} ${previousStatus}->${status}${failureReason ? ` (${failureReason})` : ''}`);
    const result = await this.prisma.callSession.updateMany({
      where: { id: call.id, status: previousStatus },
      data: { status, ...(failureReason ? { failureReason: failureReason.slice(0, 240) } : {}) }
    });
    if (!result.count) {
      const latest = await this.prisma.callSession.findUnique({ where: { id: call.id }, select: { status: true } });
      if (!latest) throw new Error('CALL_NOT_ACTIVE');
      call.status = latest.status;
      if (this.calls.get(call.id) === call && !activeStates.has(latest.status)) {
        this.end(call.id, latest.status, 'CALL_STATE_CHANGED_EXTERNALLY').catch((error) => console.error('[call] stale state cleanup failed', error));
      }
      return false;
    }
    call.status = status;
    this.emitToParticipants(call, 'call:state', { ...this.callState(call), ...(failureReason ? { reason: failureReason } : {}) });
    return true;
  }

  async markReconnecting(callId) {
    return this.exclusive(async () => {
      const call = this.calls.get(callId);
      if (call && call.status === 'CONNECTED') await this.setStatus(call, 'CONNECTING');
    });
  }

  async start({ userId, socketId, conversationId, toUserId, type }) {
    return this.exclusive(async () => {
      await this.ready;
      if (this.closed) throw new Error('CALL_SERVICE_CLOSED');
      if (!conversationId || !toUserId || userId === toUserId || !['VOICE', 'VIDEO'].includes(type)) throw new Error('INVALID_CALL');
      if (this.busyUsers.has(userId) || this.busyUsers.has(toUserId)) throw new Error('USER_BUSY');
      if (await isBlockedBetween(userId, toUserId)) throw new Error('FORBIDDEN');

      const participants = await this.prisma.conversationParticipant.findMany({
        where: { conversationId },
        select: { userId: true, user: { select: { id: true, username: true, image: true } } }
      });
      if (participants.length !== 2 || !participants.some((item) => item.userId === userId) || !participants.some((item) => item.userId === toUserId)) throw new Error('FORBIDDEN');

      const record = await this.prisma.callSession.create({ data: { initiatorId: userId, recipientId: toUserId, conversationId, type, status: 'CALLING' } });
      const caller = participants.find((item) => item.userId === userId)?.user;
      const call = {
        id: record.id, initiatorId: userId, recipientId: toUserId, conversationId, type, status: 'CALLING',
        users: Object.fromEntries(participants.map((item) => [item.userId, item.user])),
        socketIds: { [userId]: socketId, [toUserId]: null }, timers: new Map(), joined: new Set(), terminating: false
      };
      this.calls.set(call.id, call);
      this.busyUsers.set(userId, call.id); this.busyUsers.set(toUserId, call.id);
      try { await this.setStatus(call, 'RINGING'); }
      catch (error) {
        this.calls.delete(call.id); this.busyUsers.delete(userId); this.busyUsers.delete(toUserId);
        await this.prisma.callSession.update({ where: { id: call.id }, data: { status: 'FAILED', endedAt: new Date(), failureReason: 'CALL_START_FAILED' } }).catch(() => {});
        throw error;
      }
      this.io.to(`user:${toUserId}`).emit('call:ring', { callId: call.id, fromUserId: userId, fromUser: caller, type, conversationId, status: 'RINGING' });
      call.timers.set('ring', setTimeout(() => this.end(call.id, 'FAILED', 'RING_TIMEOUT').catch((error) => console.error('[call] ring timeout cleanup failed', error)), this.config.callTimeoutMs));
      call.timers.get('ring').unref?.();
      return { callId: call.id, status: call.status };
    });
  }

  getCall(callId, userId) {
    if (typeof callId !== 'string' || callId.length > 64) throw new Error('INVALID_CALL');
    const call = this.calls.get(callId);
    if (!call || !activeStates.has(call.status)) throw new Error('CALL_NOT_ACTIVE');
    if (call.initiatorId !== userId && call.recipientId !== userId) throw new Error('FORBIDDEN');
    return call;
  }

  authorize(callId, userId, socketId, requireAccepted = true) {
    const call = this.getCall(callId, userId);
    if (requireAccepted && !['ACCEPTED', 'CONNECTING', 'CONNECTED'].includes(call.status)) throw new Error('CALL_NOT_ACCEPTED');
    if (call.socketIds[userId] !== socketId) throw new Error('FORBIDDEN');
    return call;
  }

  async accept({ callId, userId, socketId }) {
    return this.exclusive(async () => {
      const call = this.getCall(callId, userId);
      if (call.recipientId !== userId || call.status !== 'RINGING') throw new Error('FORBIDDEN');
      if (this.busyUsers.get(call.initiatorId) !== call.id || this.busyUsers.get(call.recipientId) !== call.id) throw new Error('CALL_NOT_ACTIVE');
      clearTimeout(call.timers.get('ring')); call.timers.delete('ring');
      call.socketIds[userId] = socketId;
      await this.setStatus(call, 'ACCEPTED');
      this.emitToParticipants(call, 'call:accepted', { callId, status: call.status });
      return { callId, status: call.status };
    });
  }

  async reject({ callId, userId, socketId }) {
    return this.exclusive(async () => {
      const call = this.getCall(callId, userId);
      if (call.recipientId !== userId || call.status !== 'RINGING') throw new Error('FORBIDDEN');
      call.socketIds[userId] = socketId;
      await this.finish(call, 'REJECTED', 'DECLINED');
      this.io.to(`user:${call.initiatorId}`).emit('call:rejected', { callId, userId });
      return { callId, status: 'REJECTED' };
    });
  }

  async cancel({ callId, userId, socketId }) {
    return this.exclusive(async () => {
      const call = this.getCall(callId, userId);
      if (call.initiatorId !== userId || call.socketIds[userId] !== socketId || call.status !== 'RINGING') throw new Error('FORBIDDEN');
      await this.finish(call, 'ENDED', 'CALLER_CANCELLED');
      return { callId, status: 'ENDED' };
    });
  }

  async end(callId, status = 'ENDED', reason = null, error = null) {
    return this.exclusive(async () => {
      const call = this.calls.get(callId);
      if (!call) return false;
      if (error) console.error(`[mediasoup] Call ${callId} is failing (${reason}).`, error);
      await this.finish(call, status, reason);
      return true;
    });
  }

  async finish(call, status, reason = null) {
    if (!call || call.terminating || !this.calls.has(call.id)) return;
    call.terminating = true;
    for (const timer of call.timers.values()) clearTimeout(timer);
    call.timers.clear();
    this.calls.delete(call.id);
    this.busyUsers.delete(call.initiatorId); this.busyUsers.delete(call.recipientId);
    try { await this.media.closeRoom(call.id); }
    catch (error) { console.error(`[mediasoup] Could not close room for call ${call.id}.`, error); }
    try {
      await this.prisma.callSession.update({
        where: { id: call.id },
        data: { status, endedAt: new Date(), ...(reason ? { failureReason: reason.slice(0, 240) } : {}) }
      });
    } catch (error) { console.error(`[call] Could not persist terminal state for ${call.id}.`, error); }
    call.status = status;
    this.io.to(`user:${call.initiatorId}`).emit('peer:left', { callId: call.id, userId: call.recipientId });
    this.io.to(`user:${call.recipientId}`).emit('peer:left', { callId: call.id, userId: call.initiatorId });
    this.emitToParticipants(call, 'call:ended', { callId: call.id, status, reason: reason?.toLowerCase() || 'ended' });
  }

  async ensureMediaPeer({ callId, userId, socketId }) {
    const call = this.authorize(callId, userId, socketId);
    await this.ready;
    let room;
    try { room = await this.media.getOrCreateRoom(call.id); }
    catch (error) { await this.end(call.id, 'FAILED', 'MEDIA_SERVER_UNAVAILABLE', error); throw new Error('MEDIA_SERVER_UNAVAILABLE'); }
    const alreadyJoined = room.peers.has(userId) && !room.peers.get(userId).closed;
    const peer = room.getOrCreatePeer(userId, socketId);
    if (!call.joined.has(userId)) {
      call.joined.add(userId);
      const otherUserId = userId === call.initiatorId ? call.recipientId : call.initiatorId;
      this.io.to(`user:${otherUserId}`).emit('peer:joined', { callId: call.id, userId });
    }
    if (call.status === 'ACCEPTED') await this.setStatus(call, 'CONNECTING');
    return { call, room, peer, alreadyJoined };
  }

  async getRouterRtpCapabilities(context) {
    const { room } = await this.ensureMediaPeer(context);
    return room.router.rtpCapabilities;
  }

  async createTransport(context, direction) {
    if (!['send', 'recv'].includes(direction)) throw new Error('INVALID_TRANSPORT_DIRECTION');
    const { call, room, peer } = await this.ensureMediaPeer(context);
    const transport = await peer.createTransport(room.router, call.id, direction, this.config);
    if (this.calls.get(call.id) !== call || this.media.rooms.get(call.id) !== room || peer.closed) { transport.close(); throw new Error('CALL_NOT_ACTIVE'); }
    return {
      id: transport.id, iceParameters: transport.iceParameters, iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters, sctpParameters: transport.sctpParameters
    };
  }

  async connectTransport(context, transportId, dtlsParameters) {
    this.authorize(context.callId, context.userId, context.socketId);
    const room = this.media.rooms.get(context.callId);
    const peer = room?.getPeer(context.userId);
    const transport = peer?.transports.get(transportId);
    if (!transport || transport.closed || transport.appData.userId !== context.userId) throw new Error('INVALID_TRANSPORT');
    await transport.connect({ dtlsParameters });
    return { connected: true };
  }

  closeTransport(context, transportId) {
    this.authorize(context.callId, context.userId, context.socketId);
    const peer = this.media.rooms.get(context.callId)?.getPeer(context.userId);
    const transport = peer?.transports.get(transportId);
    if (!transport) return { closed: false };
    if (transport.appData.userId !== context.userId) throw new Error('FORBIDDEN');
    peer.transports.delete(transportId);
    transport.close();
    return { closed: true };
  }

  async produce(context, transportId, kind, rtpParameters) {
    const call = this.authorize(context.callId, context.userId, context.socketId);
    if (!['audio', 'video'].includes(kind) || (call.type === 'VOICE' && kind !== 'audio')) throw new Error('INVALID_MEDIA_KIND');
    const room = this.media.rooms.get(context.callId);
    const peer = room?.getPeer(context.userId);
    if (!peer) throw new Error('PEER_NOT_READY');
    const producer = await peer.produce(call.id, transportId, kind, rtpParameters);
    if (this.calls.get(call.id) !== call || this.media.rooms.get(call.id) !== room || peer.closed) { producer.close(); throw new Error('CALL_NOT_ACTIVE'); }
    const payload = { callId: call.id, producerId: producer.id, userId: context.userId, kind: producer.kind, paused: producer.paused };
    const otherUserId = context.userId === call.initiatorId ? call.recipientId : call.initiatorId;
    this.io.to(`user:${otherUserId}`).emit('media:producer-created', payload);
    const currentRoom = this.media.rooms.get(call.id);
    const bothHaveMedia = [call.initiatorId, call.recipientId].every((id) => {
      const currentPeer = currentRoom?.getPeer(id);
      return currentPeer && [...currentPeer.producers.values()].some((item) => item.kind === 'audio' && !item.closed);
    });
    if (process.env.CALL_DEBUG === 'true') {
      const audioPeerCount = [call.initiatorId, call.recipientId].filter((id) => [...(currentRoom?.getPeer(id)?.producers.values() || [])].some((item) => item.kind === 'audio' && !item.closed)).length;
      console.info(`[call-debug] ${call.id.slice(0, 8)} ${kind} producer; audio participants=${audioPeerCount}/2; status=${call.status}`);
    }
    if (bothHaveMedia && call.status === 'CONNECTING') await this.setStatus(call, 'CONNECTED');
    return { id: producer.id, kind: producer.kind, paused: producer.paused };
  }

  findProducer(room, producerId) {
    for (const peer of room?.peers.values() || []) {
      const producer = peer.producers.get(producerId);
      if (producer && !producer.closed) return { peer, producer };
    }
    return null;
  }

  async consume(context, transportId, producerId, rtpCapabilities) {
    const { call, room, peer } = await this.ensureMediaPeer(context);
    const found = this.findProducer(room, producerId);
    if (!found || found.peer.userId === context.userId) throw new Error('PRODUCER_NOT_AVAILABLE');
    const consumer = await peer.consume(room.router, found.producer, transportId, rtpCapabilities, call.id);
    if (process.env.CALL_DEBUG === 'true') console.info(`[call-debug] ${call.id.slice(0, 8)} consumed ${found.producer.kind} media for a peer.`);
    if (this.calls.get(call.id) !== call || this.media.rooms.get(call.id) !== room || peer.closed) { consumer.close(); throw new Error('CALL_NOT_ACTIVE'); }
    return {
      id: consumer.id, producerId: consumer.producerId, kind: consumer.kind,
      rtpParameters: consumer.rtpParameters, type: consumer.type, producerPaused: consumer.producerPaused
    };
  }

  listProducers(context) {
    this.authorize(context.callId, context.userId, context.socketId);
    const room = this.media.rooms.get(context.callId);
    if (!room) return { producers: [] };
    return {
      producers: [...room.peers.values()]
        .filter((peer) => peer.userId !== context.userId)
        .flatMap((peer) => [...peer.producers.values()]
          .filter((producer) => !producer.closed)
          .map((producer) => ({ producerId: producer.id, userId: peer.userId, kind: producer.kind, paused: producer.paused })))
    };
  }

  async resumeConsumer(context, consumerId) {
    this.authorize(context.callId, context.userId, context.socketId);
    const consumer = this.media.rooms.get(context.callId)?.getPeer(context.userId)?.consumers.get(consumerId);
    if (!consumer || consumer.closed) throw new Error('INVALID_CONSUMER');
    await consumer.resume();
    return { resumed: true };
  }

  async setProducerPaused(context, producerId, paused) {
    this.authorize(context.callId, context.userId, context.socketId);
    const producer = this.media.rooms.get(context.callId)?.getPeer(context.userId)?.producers.get(producerId);
    if (!producer || producer.closed) throw new Error('INVALID_PRODUCER');
    if (paused && !producer.paused) await producer.pause();
    if (!paused && producer.paused) await producer.resume();
    const call = this.calls.get(context.callId);
    const otherUserId = context.userId === call.initiatorId ? call.recipientId : call.initiatorId;
    this.io.to(`user:${otherUserId}`).emit('media:producer-state', { callId: call.id, producerId, userId: context.userId, kind: producer.kind, paused: producer.paused });
    return { paused: producer.paused };
  }

  async closeConsumer(context, consumerId) {
    this.authorize(context.callId, context.userId, context.socketId);
    const consumer = this.media.rooms.get(context.callId)?.getPeer(context.userId)?.consumers.get(consumerId);
    if (!consumer) return { closed: false };
    consumer.close();
    return { closed: true };
  }

  async resume({ callId, userId, socketId }) {
    return this.exclusive(async () => {
      const call = this.getCall(callId, userId);
      const previousSocketId = call.socketIds[userId];
      const timer = call.timers.get(`disconnect:${userId}`);
      if (timer) clearTimeout(timer);
      call.timers.delete(`disconnect:${userId}`);
      call.socketIds[userId] = socketId;
      if (previousSocketId && previousSocketId !== socketId) this.io.to(previousSocketId).emit('call:replaced', { callId });
      const room = this.media.rooms.get(callId);
      if (process.env.CALL_DEBUG === 'true') console.info(`[call-debug] ${callId.slice(0, 8)} resume ${userId.slice(0, 8)}; priorSocket=${previousSocketId ? 'present' : 'none'}; room=${room ? 'present' : 'none'}`);
      if (room) await room.resetPeer(userId, socketId);
      if (call.status === 'CONNECTED') await this.setStatus(call, 'CONNECTING');
      const otherUserId = userId === call.initiatorId ? call.recipientId : call.initiatorId;
      this.io.to(`user:${otherUserId}`).emit('peer:reconnected', { callId, userId });
      return {
        callId, status: call.status, type: call.type, conversationId: call.conversationId, peerId: otherUserId,
        peer: call.users?.[otherUserId] || null,
        role: userId === call.recipientId ? 'callee' : 'caller', roomCreated: !!room
      };
    });
  }

  handleDisconnect(socketId, userId) {
    for (const call of this.calls.values()) {
      if (call.socketIds[userId] !== socketId) continue;
      if (process.env.CALL_DEBUG === 'true') console.info(`[call-debug] ${call.id.slice(0, 8)} disconnect ${userId.slice(0, 8)} socket`);
      call.socketIds[userId] = null;
      const otherUserId = userId === call.initiatorId ? call.recipientId : call.initiatorId;
      const room = this.media.rooms.get(call.id);
      const peer = room?.getPeer(userId);
      if (peer) peer.socketId = null;
      this.io.to(`user:${otherUserId}`).emit('peer:reconnecting', { callId: call.id, userId });
      const key = `disconnect:${userId}`;
      clearTimeout(call.timers.get(key));
      const timer = setTimeout(() => {
        if (this.calls.get(call.id) === call && call.socketIds[userId] === null) this.end(call.id, 'FAILED', 'PEER_DISCONNECTED').catch((error) => console.error('[call] reconnect timeout cleanup failed', error));
      }, this.config.reconnectGraceMs);
      timer.unref?.();
      call.timers.set(key, timer);
    }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const call of [...this.calls.values()]) await this.finish(call, 'FAILED', 'SERVER_SHUTDOWN');
    await this.media.close();
  }
}

module.exports = { CallService };
