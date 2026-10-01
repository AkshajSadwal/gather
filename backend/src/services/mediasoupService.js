const { MediaWorkerPool } = require('./mediaWorkerPool');

const mediaCodecs = [
  { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
  { kind: 'video', mimeType: 'video/VP8', clockRate: 90000 },
  { kind: 'video', mimeType: 'video/H264', clockRate: 90000, parameters: { 'packetization-mode': 1, 'level-asymmetry-allowed': 1 } }
];

function transportOptions(config) {
  const listenInfo = (protocol) => ({
    protocol,
    ip: config.listenIp,
    ...(config.announcedAddress ? { announcedAddress: config.announcedAddress } : {})
  });
  return {
    listenInfos: [
      ...(config.enableUdp ? [listenInfo('udp')] : []),
      ...(config.enableTcp ? [listenInfo('tcp')] : [])
    ],
    enableUdp: config.enableUdp,
    enableTcp: config.enableTcp,
    preferUdp: config.preferUdp,
    initialAvailableOutgoingBitrate: 1_000_000,
    maxIncomingBitrate: 1_500_000,
    appData: {}
  };
}

class MediaPeer {
  constructor(userId, socketId, notify) {
    this.userId = userId;
    this.socketId = socketId;
    this.notify = notify;
    this.transports = new Map();
    this.transportPromises = new Map();
    this.producers = new Map();
    this.producerPromises = new Map();
    this.consumers = new Map();
    this.consumerByProducer = new Map();
    this.consumerPromises = new Map();
    this.closed = false;
    this.generation = 0;
  }

  getTransport(direction) {
    return [...this.transports.values()].find((transport) => transport.appData.direction === direction && !transport.closed);
  }

  async createTransport(router, callId, direction, config) {
    const current = this.getTransport(direction);
    if (current) return current;
    if (this.transportPromises.has(direction)) return this.transportPromises.get(direction);
    const pending = (async () => {
      if (this.closed) throw new Error('PEER_LEFT');
      const generation = this.generation;
      const transport = await router.createWebRtcTransport({
        ...transportOptions(config),
        appData: { callId, userId: this.userId, direction }
      });
      if (this.closed || generation !== this.generation) { transport.close(); throw new Error('PEER_LEFT'); }
      this.transports.set(transport.id, transport);
      transport.on('dtlsstatechange', (state) => {
        if (process.env.CALL_DEBUG === 'true') console.info(`[call-debug] ${callId.slice(0, 8)} ${direction} transport DTLS ${state}`);
        if (state === 'failed') this.notify(this.userId, 'media:transport-failed', { callId, transportId: transport.id, reason: 'DTLS negotiation failed.' });
      });
      transport.on('icestatechange', (state) => {
        if (process.env.CALL_DEBUG === 'true') console.info(`[call-debug] ${callId.slice(0, 8)} ${direction} transport ICE ${state}`);
        if (state === 'failed') this.notify(this.userId, 'media:transport-failed', { callId, transportId: transport.id, reason: 'ICE connectivity failed.' });
      });
      transport.on('close', () => this.transports.delete(transport.id));
      return transport;
    })();
    this.transportPromises.set(direction, pending);
    try { return await pending; }
    finally { this.transportPromises.delete(direction); }
  }

  async produce(callId, transportId, kind, rtpParameters) {
    const transport = this.transports.get(transportId);
    if (!transport || transport.appData.direction !== 'send') throw new Error('INVALID_TRANSPORT');
    const duplicate = [...this.producers.values()].find((producer) => producer.kind === kind && !producer.closed);
    if (duplicate) return duplicate;
    if (this.producerPromises.has(kind)) return this.producerPromises.get(kind);
    const pending = (async () => {
      if (this.closed) throw new Error('PEER_LEFT');
      const generation = this.generation;
      const producer = await transport.produce({ kind, rtpParameters, appData: { callId, userId: this.userId } });
      if (this.closed || generation !== this.generation) { producer.close(); throw new Error('PEER_LEFT'); }
      this.producers.set(producer.id, producer);
      producer.on('transportclose', () => this.removeProducer(producer.id, callId));
      producer.on('close', () => this.removeProducer(producer.id, callId));
      return producer;
    })();
    this.producerPromises.set(kind, pending);
    try { return await pending; }
    finally { this.producerPromises.delete(kind); }
  }

  removeProducer(producerId, callId) {
    const producer = this.producers.get(producerId);
    if (!producer) return;
    this.producers.delete(producerId);
    this.notify(null, 'media:producer-closed', { callId, producerId, userId: this.userId, kind: producer.kind });
  }

  async consume(router, producer, transportId, rtpCapabilities, callId) {
    if (this.closed) throw new Error('PEER_LEFT');
    const transport = this.transports.get(transportId);
    if (!transport || transport.appData.direction !== 'recv') throw new Error('INVALID_TRANSPORT');
    if (!router.canConsume({ producerId: producer.id, rtpCapabilities })) throw new Error('CANNOT_CONSUME');
    const existingId = this.consumerByProducer.get(producer.id);
    const existing = existingId && this.consumers.get(existingId);
    if (existing && !existing.closed) return existing;
    if (this.consumerPromises.has(producer.id)) return this.consumerPromises.get(producer.id);
    const generation = this.generation;
    const pending = (async () => {
      const consumer = await transport.consume({ producerId: producer.id, rtpCapabilities, paused: true, appData: { callId, userId: this.userId, producerId: producer.id } });
      if (this.closed || generation !== this.generation) { consumer.close(); throw new Error('PEER_LEFT'); }
      this.consumers.set(consumer.id, consumer);
      this.consumerByProducer.set(producer.id, consumer.id);
      const remove = () => {
        this.consumers.delete(consumer.id);
        if (this.consumerByProducer.get(producer.id) === consumer.id) this.consumerByProducer.delete(producer.id);
      };
      consumer.on('transportclose', remove);
      consumer.on('producerclose', remove);
      consumer.on('close', remove);
      return consumer;
    })();
    this.consumerPromises.set(producer.id, pending);
    try { return await pending; }
    finally { this.consumerPromises.delete(producer.id); }
  }

  async reset(socketId) {
    await this.close();
    this.closed = false;
    this.socketId = socketId;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.generation += 1;
    for (const consumer of this.consumers.values()) consumer.close();
    for (const producer of this.producers.values()) producer.close();
    for (const transport of this.transports.values()) transport.close();
    this.consumers.clear(); this.consumerByProducer.clear(); this.consumerPromises.clear(); this.producers.clear(); this.transports.clear();
  }
}

class MediaRoom {
  constructor(callId, worker, router, config, notify) {
    this.callId = callId;
    this.worker = worker;
    this.router = router;
    this.config = config;
    this.notify = notify;
    this.peers = new Map();
    this.closed = false;
  }

  getPeer(userId) { return this.peers.get(userId); }
  getOrCreatePeer(userId, socketId) {
    let peer = this.peers.get(userId);
    if (!peer || peer.closed) {
      peer = new MediaPeer(userId, socketId, this.notify);
      this.peers.set(userId, peer);
    } else peer.socketId = socketId;
    return peer;
  }

  async resetPeer(userId, socketId) {
    const peer = this.peers.get(userId);
    if (peer) await peer.reset(socketId);
    else this.getOrCreatePeer(userId, socketId);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const peer of this.peers.values()) peer.close();
    this.peers.clear();
    this.router.close();
  }
}

class MediasoupService {
  constructor({ io, config, onWorkerRoomFailure, onTransportFailure }) {
    this.io = io;
    this.config = config;
    this.pool = new MediaWorkerPool(config);
    this.rooms = new Map();
    this.roomPromises = new Map();
    this.onWorkerRoomFailure = onWorkerRoomFailure;
    this.onTransportFailure = onTransportFailure;
    this.pool.on('worker:died', ({ worker, error }) => this.failWorkerRooms(worker, error));
    this.ready = this.pool.start();
  }

  notify(userId, event, payload) {
    if (event === 'media:transport-failed') {
      Promise.resolve(this.onTransportFailure?.(payload?.callId, payload)).catch((error) => console.error('[call] Could not record transport recovery state.', error));
    }
    if (userId) this.io.to(`user:${userId}`).emit(event, payload);
    else if (payload?.callId && this.callParticipants) {
      const users = this.callParticipants(payload.callId) || [];
      for (const participantId of users) this.io.to(`user:${participantId}`).emit(event, payload);
    }
  }

  async getOrCreateRoom(callId) {
    await this.ready;
    const room = this.rooms.get(callId);
    if (room && !room.closed) return room;
    if (this.roomPromises.has(callId)) return this.roomPromises.get(callId);
    const pending = (async () => {
      const worker = this.pool.nextWorker();
      const router = await worker.createRouter({ mediaCodecs });
      const created = new MediaRoom(callId, worker, router, this.config, this.notify.bind(this));
      if (this.rooms.has(callId)) { created.close(); return this.rooms.get(callId); }
      this.rooms.set(callId, created);
      router.on('workerclose', () => this.rooms.delete(callId));
      return created;
    })();
    this.roomPromises.set(callId, pending);
    try { return await pending; }
    finally { this.roomPromises.delete(callId); }
  }

  async closeRoom(callId) {
    // Router creation runs outside CallService's lifecycle queue. Wait for an
    // in-flight creation so a call ending during createRouter cannot orphan it.
    const creating = this.roomPromises.get(callId);
    if (creating) await creating.catch(() => {});
    const room = this.rooms.get(callId);
    if (!room) return;
    this.rooms.delete(callId);
    room.close();
  }

  async failWorkerRooms(worker, error) {
    const calls = [...this.rooms.values()].filter((room) => room.worker === worker).map((room) => room.callId);
    for (const room of [...this.rooms.values()].filter((candidate) => candidate.worker === worker)) room.close();
    for (const callId of calls) {
      this.rooms.delete(callId);
      await this.onWorkerRoomFailure?.(callId, error);
    }
  }

  async close() {
    for (const room of this.rooms.values()) room.close();
    this.rooms.clear();
    await this.pool.close();
  }
}

module.exports = { MediasoupService, MediaRoom, MediaPeer, mediaCodecs };
