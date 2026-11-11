const { Server } = require('socket.io');
const { sessionUserFromCookie } = require('../middleware/auth');
const prisma = require('../config/prisma');
const { mediasoup } = require('../config/env');
const { CallService } = require('../services/callService');
const { registerCallHandlers } = require('./calls');
const { isBlockedBetween } = require('../services/blocks');

const activeCalls = new Map();
const onlineSockets = new Map();
const messageWindows = new Map();

function createSocketServer(server, frontendUrl, database = prisma) {
  const io = new Server(server, { cors: { origin: frontendUrl, credentials: true }, pingInterval: 25000, pingTimeout: 20000, maxHttpBufferSize: 1_000_000 });
  global.io = io;
  const callService = new CallService({ io, prisma: database, config: mediasoup, activeCalls });
  io.callService = callService;

  io.use(async (socket, next) => {
    try {
      const user = await sessionUserFromCookie(socket.handshake.headers.cookie);
      if (!user) return next(new Error('UNAUTHENTICATED'));
      socket.user = user;
      next();
    } catch (error) { next(error); }
  });

  io.on('connection', async (socket) => {
    try {
    const userId = socket.user.id;
    registerCallHandlers(socket, callService);
    socket.join(`user:${userId}`);
    const count = onlineSockets.get(userId) || 0;
    onlineSockets.set(userId, count + 1);
    if (count === 0) io.emit('user:online', { userId });
    socket.emit('presence:snapshot', { userIds: [...onlineSockets.keys()].filter((id) => id !== userId) });
    const memberships = await database.conversationParticipant.findMany({ where: { userId }, select: { conversationId: true } }).catch(() => []);
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
        const member = await database.conversationParticipant.findUnique({ where: { conversationId_userId: { conversationId, userId } }, select: { id: true } });
        if (!member) return ack({ error: { code: 'FORBIDDEN', message: 'You are not a participant in this conversation.' } });
        const other = await database.conversationParticipant.findFirst({ where: { conversationId, userId: { not: userId } }, select: { userId: true } });
        if (other && await isBlockedBetween(userId, other.userId)) return ack({ error: { code: 'BLOCKED', message: 'You cannot message this account.' } });
        const message = await database.message.create({ data: { conversationId, senderId: userId, body }, include: { sender: { select: { id: true, username: true, image: true } } } });
        await database.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
        const recipients = await database.conversationParticipant.findMany({ where: { conversationId, userId: { not: userId } }, select: { userId: true } });
        const delivered = recipients.some((recipient) => onlineSockets.has(recipient.userId));
        if (delivered) await database.message.update({ where: { id: message.id }, data: { deliveredAt: new Date() } });
        const output = { ...message, delivered: !!delivered, unreadCount: 0 };
        socket.emit('message:received', output);
        for (const { userId: recipientId } of recipients) {
          const unreadCount = await database.message.count({
            where: {
              conversationId,
              senderId: { not: recipientId },
              deletedAt: null,
              reads: { none: { userId: recipientId } }
            }
          });
          io.to(`user:${recipientId}`).emit('message:received', { ...output, unreadCount });
        }
        if (delivered) socket.emit('message:delivered', { conversationId, messageId: message.id });
        ack({ data: output });
      } catch { ack({ error: { code: 'MESSAGE_FAILED', message: 'Could not send this message.' } }); }
    });

    for (const event of ['typing:start', 'typing:stop']) {
      socket.on(event, async ({ conversationId } = {}) => {
        if (typeof conversationId !== 'string') return;
        const member = await database.conversationParticipant.findUnique({ where: { conversationId_userId: { conversationId, userId } }, select: { id: true } }).catch(() => null);
        if (member) {
          const others = await database.conversationParticipant.findMany({ where: { conversationId, userId: { not: userId } }, select: { userId: true } });
          others.forEach(({ userId: recipientId }) => io.to(`user:${recipientId}`).emit(event, { conversationId, userId }));
        }
      });
    }

    socket.on('disconnect', () => {
      callService.handleDisconnect(socket.id, userId);
      const remaining = Math.max(0, (onlineSockets.get(userId) || 1) - 1);
      if (remaining) onlineSockets.set(userId, remaining);
      else { onlineSockets.delete(userId); messageWindows.delete(userId); io.emit('user:offline', { userId }); }
    });
    } catch (error) {
      console.error('[socket] connection setup failed', error);
      socket.disconnect(true);
    }
  });
  return io;
}

module.exports = { createSocketServer, activeCalls, onlineSockets };
