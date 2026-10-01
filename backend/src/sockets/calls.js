const { z } = require('zod');

const id = z.string().trim().min(1).max(64);
const record = z.object({}).passthrough();
const schemas = {
  start: z.object({ conversationId: id, toUserId: id, type: z.enum(['VOICE', 'VIDEO']) }),
  callId: z.object({ callId: id }),
  transport: z.object({ callId: id, direction: z.enum(['send', 'recv']) }),
  connectTransport: z.object({ callId: id, transportId: id, dtlsParameters: record }),
  closeTransport: z.object({ callId: id, transportId: id }),
  produce: z.object({ callId: id, transportId: id, kind: z.enum(['audio', 'video']), rtpParameters: record }),
  consume: z.object({ callId: id, transportId: id, producerId: id, rtpCapabilities: record }),
  consumer: z.object({ callId: id, consumerId: id }),
  producer: z.object({ callId: id, producerId: id }),
  resume: z.object({ callId: id })
};

const publicErrors = {
  INVALID_CALL: ['INVALID_CALL', 'The call request is invalid.'],
  FORBIDDEN: ['FORBIDDEN', 'You are not allowed to control this call or media resource.'],
  USER_BUSY: ['USER_BUSY', 'One of the participants is already in a call.'],
  CALL_NOT_ACTIVE: ['CALL_NOT_ACTIVE', 'This call is no longer active.'],
  CALL_NOT_ACCEPTED: ['CALL_NOT_ACCEPTED', 'Accept the call before connecting media.'],
  INVALID_CALL_STATE: ['INVALID_CALL_STATE', 'This call has already changed state.'],
  INVALID_TRANSPORT: ['INVALID_TRANSPORT', 'The media transport is unavailable. Rejoin the call to reconnect.'],
  INVALID_TRANSPORT_DIRECTION: ['INVALID_TRANSPORT_DIRECTION', 'The media transport direction is invalid.'],
  INVALID_MEDIA_KIND: ['INVALID_MEDIA_KIND', 'This call cannot send that media type.'],
  PEER_NOT_READY: ['PEER_NOT_READY', 'The media session is still starting. Try again.'],
  PEER_LEFT: ['PEER_LEFT', 'The other participant has left the media session.'],
  INVALID_CONSUMER: ['INVALID_CONSUMER', 'The remote media subscription is no longer available.'],
  INVALID_PRODUCER: ['INVALID_PRODUCER', 'The local media track is no longer available.'],
  PRODUCER_NOT_AVAILABLE: ['PRODUCER_NOT_AVAILABLE', 'That remote media track is no longer available.'],
  CANNOT_CONSUME: ['CANNOT_CONSUME', 'This browser cannot receive the selected media track.'],
  MEDIA_SERVER_UNAVAILABLE: ['MEDIA_SERVER_UNAVAILABLE', 'The media server is unavailable. Please try again later.'],
  CALL_SERVICE_CLOSED: ['CALL_SERVICE_CLOSED', 'The call service is shutting down.'],
  INVALID_PAYLOAD: ['INVALID_PAYLOAD', 'The call request payload is invalid.']
};

function eventError(error) {
  const code = typeof error?.message === 'string' ? error.message : '';
  const [safeCode, message] = publicErrors[code] || ['CALL_FAILED', 'The call request could not be completed.'];
  if (safeCode === 'CALL_FAILED') console.error('[socket] call event failed', error);
  return { error: { code: safeCode, message } };
}

function registerCallHandlers(socket, callService) {
  const { id: userId } = socket.user;
  const context = (payload) => ({ callId: payload.callId, userId, socketId: socket.id });
  const attach = (name, schema, handler, options = {}) => {
    socket.on(name, async (payload = {}, ack = () => {}) => {
      try {
        const parsed = schema.safeParse(payload);
        if (!parsed.success) return typeof ack === 'function' && ack({ error: { code: 'INVALID_PAYLOAD', message: publicErrors.INVALID_PAYLOAD[1] } });
        const result = await handler(parsed.data);
        if (typeof ack === 'function') ack({ data: result });
      } catch (error) {
        if (process.env.CALL_DEBUG === 'true') console.error(`[call-debug] ${name} failed for ${String(payload?.callId || '').slice(0, 8)}: ${error?.message || 'unknown error'}`);
        const response = eventError(error);
        if (typeof ack === 'function') ack(response);
        if (options.emitError) socket.emit(options.emitError, { callId: payload?.callId, ...response.error });
      }
    });
  };

  attach('call:start', schemas.start, (payload) => callService.start({ ...payload, userId, socketId: socket.id }));
  attach('call:accept', schemas.callId, (payload) => callService.accept({ ...payload, userId, socketId: socket.id }));
  attach('call:reject', schemas.callId, (payload) => callService.reject({ ...payload, userId, socketId: socket.id }));
  attach('call:cancel', schemas.callId, (payload) => callService.cancel({ ...payload, userId, socketId: socket.id }));
  attach('call:end', schemas.callId, async (payload) => {
    const call = callService.getCall(payload.callId, userId);
    if (call.status === 'RINGING') {
      if (call.initiatorId === userId) return { ended: (await callService.cancel({ ...payload, userId, socketId: socket.id })).status === 'ENDED' };
      return { ended: (await callService.reject({ ...payload, userId, socketId: socket.id })).status === 'REJECTED' };
    }
    callService.authorize(payload.callId, userId, socket.id);
    return { ended: await callService.end(payload.callId, 'ENDED', 'PARTICIPANT_ENDED') };
  });
  attach('call:resume', schemas.resume, (payload) => callService.resume({ ...payload, userId, socketId: socket.id }));

  attach('mediasoup:get-router-capabilities', schemas.callId, async (payload) => ({ rtpCapabilities: await callService.getRouterRtpCapabilities(context(payload)) }));
  attach('mediasoup:create-transport', schemas.transport, async (payload) => ({ transport: await callService.createTransport(context(payload), payload.direction) }));
  attach('mediasoup:connect-transport', schemas.connectTransport, (payload) => callService.connectTransport(context(payload), payload.transportId, payload.dtlsParameters));
  attach('mediasoup:close-transport', schemas.closeTransport, (payload) => callService.closeTransport(context(payload), payload.transportId));
  attach('mediasoup:produce', schemas.produce, (payload) => callService.produce(context(payload), payload.transportId, payload.kind, payload.rtpParameters));
  attach('mediasoup:consume', schemas.consume, (payload) => callService.consume(context(payload), payload.transportId, payload.producerId, payload.rtpCapabilities));
  attach('mediasoup:list-producers', schemas.callId, (payload) => callService.listProducers(context(payload)));
  attach('mediasoup:resume-consumer', schemas.consumer, (payload) => callService.resumeConsumer(context(payload), payload.consumerId));
  attach('mediasoup:close-consumer', schemas.consumer, (payload) => callService.closeConsumer(context(payload), payload.consumerId));
  attach('media:pause-producer', schemas.producer, (payload) => callService.setProducerPaused(context(payload), payload.producerId, true));
  attach('media:resume-producer', schemas.producer, (payload) => callService.setProducerPaused(context(payload), payload.producerId, false));
}

module.exports = { registerCallHandlers, eventError };
