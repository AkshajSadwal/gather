const { Server } = require('socket.io');
const { sessionUserFromCookie } = require('../middleware/auth');
const prisma = require('../config/prisma');

const activeCalls = new Map();
const onlineSockets = new Map();
const callTimeouts = new Map();
const messageWindows = new Map();

function createSocketServer(server, frontendUrl) {
  const io = new Server(server, { cors: { origin: frontendUrl, credentials: true }, pingInterval: 25000, pingTimeout: 20000 });
  global.io = io;

  io.use(async (socket, next) => {
    try {
      const user = await sessionUserFromCookie(socket.handshake.headers.cookie);
      if (!user) return next(new Error('UNAUTHENTICATED'));
      socket.user = user;
      next();
    } catch (error) { next(error); }
  });

  io.on('connection', async (socket) => {
    const userId = socket.user.id;
    socket.join(`user:${userId}`);
    const count = onlineSockets.get(userId) || 0;
    onlineSockets.set(userId, count + 1);
    if (count === 0) io.emit('user:online', { userId });
    socket.emit('presence:snapshot', { userIds: [...onlineSockets.keys()].filter((id) => id !== userId) });
    const memberships = await prisma.conversationParticipant.findMany({ where: { userId }, select: { conversationId: true } }).catch(() => []);
    memberships.forEach(({ conversationId }) => socket.join(`conversation:${conversationId}`));

    socket.on('message:send', async (payload = {}, ack = () => {}) => {
      try {
        const now = Date.now();
        const window = messageWindows.get(userId);
        if (!window || now - window.startedAt >= 60000) messageWindows.set(userId, { startedAt: now, count: 1 });
        else if (window.count >= 60) return ack({ error: { code: 'RATE_LIMITED', message: 'You are sending messages too quickly.' } });
        else window.count += 1;
        const conversationId = String(payload.conversationId || '');
        const body = String(payload.body || '').trim();
        if (!conversationId || !body || body.length > 4000) return ack({ error: { code: 'INVALID_MESSAGE', message: 'Message must contain 1–4000 characters.' } });
        const member = await prisma.conversationParticipant.findUnique({ where: { conversationId_userId: { conversationId, userId } }, select: { id: true } });
        if (!member) return ack({ error: { code: 'FORBIDDEN', message: 'You are not a participant in this conversation.' } });
        const message = await prisma.message.create({ data: { conversationId, senderId: userId, body }, include: { sender: { select: { id: true, username: true, image: true } } } });
        await prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
        const recipients = await prisma.conversationParticipant.findMany({ where: { conversationId, userId: { not: userId } }, select: { userId: true } });
        const delivered = recipients.some((recipient) => onlineSockets.has(recipient.userId));
        if (delivered) await prisma.message.update({ where: { id: message.id }, data: { deliveredAt: new Date() } });
        const output = { ...message, delivered: !!delivered };
        socket.emit('message:received', output);
        recipients.forEach(({ userId: recipientId }) => io.to(`user:${recipientId}`).emit('message:received', output));
        if (delivered) socket.emit('message:delivered', { conversationId, messageId: message.id });
        ack({ data: output });
      } catch { ack({ error: { code: 'MESSAGE_FAILED', message: 'Could not send this message.' } }); }
    });

    for (const event of ['typing:start', 'typing:stop']) {
      socket.on(event, async ({ conversationId } = {}) => {
        if (typeof conversationId !== 'string') return;
        const member = await prisma.conversationParticipant.findUnique({ where: { conversationId_userId: { conversationId, userId } }, select: { id: true } }).catch(() => null);
        if (member) {
          const others = await prisma.conversationParticipant.findMany({ where: { conversationId, userId: { not: userId } }, select: { userId: true } });
          others.forEach(({ userId: recipientId }) => io.to(`user:${recipientId}`).emit(event, { conversationId, userId }));
        }
      });
    }

    socket.on('call:offer', async ({ toUserId, offer, type, conversationId } = {}, ack = () => {}) => {
      try {
        if (!toUserId || !offer || !['VOICE', 'VIDEO'].includes(type)) return ack({ error: { code: 'INVALID_CALL', message: 'Call details are invalid.' } });
        const isParticipant = await prisma.conversationParticipant.findFirst({ where: { userId, conversationId, conversation: { participants: { some: { userId: toUserId } } } }, select: { id: true } });
        if (!isParticipant) return ack({ error: { code: 'FORBIDDEN', message: 'Start a call from an authorized conversation.' } });
        const call = await prisma.callSession.create({ data: { initiatorId: userId, recipientId: toUserId, type, status: 'RINGING' } });
        activeCalls.set(call.id, { initiatorId: userId, recipientId: toUserId });
        const timer = setTimeout(async () => {
          if (!activeCalls.has(call.id)) return;
          activeCalls.delete(call.id); callTimeouts.delete(call.id);
          await prisma.callSession.update({ where: { id: call.id }, data: { status: 'FAILED', endedAt: new Date() } }).catch(() => {});
          io.to(`user:${userId}`).emit('call:ended', { callId: call.id, userId: toUserId, reason: 'timeout' });
          io.to(`user:${toUserId}`).emit('call:ended', { callId: call.id, userId, reason: 'timeout' });
        }, 45000);
        callTimeouts.set(call.id, timer);
        io.to(`user:${toUserId}`).emit('call:ringing', { callId: call.id, fromUserId: userId, type, offer });
        io.to(`user:${toUserId}`).emit('call:offer', { callId: call.id, fromUserId: userId, offer, type });
        ack({ data: { callId: call.id, status: 'RINGING' } });
      } catch { ack({ error: { code: 'CALL_FAILED', message: 'Could not start this call.' } }); }
    });

    async function authorizeCall(callId) {
      const call = activeCalls.get(callId);
      return call && (call.initiatorId === userId || call.recipientId === userId) ? call : null;
    }
    socket.on('call:accepted', async ({ callId } = {}) => {
      const call = await authorizeCall(callId);
      if (!call || call.recipientId !== userId) return;
      clearTimeout(callTimeouts.get(callId)); callTimeouts.delete(callId);
      await prisma.callSession.update({ where: { id: callId }, data: { status: 'ACCEPTED' } });
      io.to(`user:${call.initiatorId}`).emit('call:accepted', { callId, userId });
    });
    socket.on('call:answer', async ({ callId, answer } = {}) => {
      const call = await authorizeCall(callId);
      if (call && call.recipientId === userId) io.to(`user:${call.initiatorId}`).emit('call:answer', { callId, answer });
    });
    socket.on('call:ice-candidate', async ({ callId, candidate } = {}) => {
      const call = await authorizeCall(callId);
      if (call) {
        const other = call.initiatorId === userId ? call.recipientId : call.initiatorId;
        io.to(`user:${other}`).emit('call:ice-candidate', { callId, candidate });
      }
    });
    socket.on('call:rejected', async ({ callId } = {}) => {
      const call = await authorizeCall(callId);
      if (call && call.recipientId === userId) {
        activeCalls.delete(callId);
        clearTimeout(callTimeouts.get(callId)); callTimeouts.delete(callId);
        await prisma.callSession.update({ where: { id: callId }, data: { status: 'REJECTED', endedAt: new Date() } });
        io.to(`user:${call.initiatorId}`).emit('call:rejected', { callId, userId });
      }
    });
    socket.on('call:ended', async ({ callId } = {}) => {
      const call = await authorizeCall(callId);
      if (call) {
        activeCalls.delete(callId);
        clearTimeout(callTimeouts.get(callId)); callTimeouts.delete(callId);
        await prisma.callSession.update({ where: { id: callId }, data: { status: 'ENDED', endedAt: new Date() } }).catch(() => {});
        const other = call.initiatorId === userId ? call.recipientId : call.initiatorId;
        io.to(`user:${other}`).emit('call:ended', { callId, userId });
      }
    });

    socket.on('disconnect', async () => {
      const remaining = Math.max(0, (onlineSockets.get(userId) || 1) - 1);
      if (remaining) onlineSockets.set(userId, remaining);
      else { onlineSockets.delete(userId); messageWindows.delete(userId); io.emit('user:offline', { userId }); }
      for (const [callId, call] of activeCalls.entries()) {
        if (call.initiatorId === userId || call.recipientId === userId) {
          activeCalls.delete(callId);
          clearTimeout(callTimeouts.get(callId)); callTimeouts.delete(callId);
          await prisma.callSession.update({ where: { id: callId }, data: { status: 'ENDED', endedAt: new Date() } }).catch(() => {});
          const other = call.initiatorId === userId ? call.recipientId : call.initiatorId;
          io.to(`user:${other}`).emit('call:ended', { callId, userId, reason: 'disconnect' });
        }
      }
    });
  });
  return io;
}

module.exports = { createSocketServer, activeCalls, onlineSockets };
