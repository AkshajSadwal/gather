const prisma = require('../config/prisma');

async function createNotification({ recipientId, actorId, type, entityId }) {
  if (!recipientId || recipientId === actorId) return null;
  const notification = await prisma.notification.create({
    data: { recipientId, actorId, type, entityId },
    include: { actor: { select: { id: true, username: true, image: true, profile: { select: { avatarUrl: true } } } } }
  });
  const io = global.io;
  if (io) io.to(`user:${recipientId}`).emit('notification:new', notification);
  return notification;
}

module.exports = { createNotification };
