const prisma = require('../config/prisma');
const { HttpError, ok } = require('../utils/http');

async function list(req, res) {
  const notifications = await prisma.notification.findMany({ where: { recipientId: req.user.id }, orderBy: { createdAt: 'desc' }, take: Math.min(Number(req.query.limit) || 30, 100), include: { actor: { select: { id: true, username: true, image: true } } } });
  return ok(res, { notifications });
}

async function markRead(req, res) {
  const id = req.params.id;
  if (id === 'all') {
    const result = await prisma.notification.updateMany({ where: { recipientId: req.user.id, readAt: null }, data: { readAt: new Date() } });
    return ok(res, { updated: result.count });
  }
  const result = await prisma.notification.updateMany({ where: { id, recipientId: req.user.id }, data: { readAt: new Date() } });
  if (!result.count) throw new HttpError(404, 'NOTIFICATION_NOT_FOUND', 'That notification could not be found.');
  return ok(res, { updated: result.count });
}

module.exports = { list, markRead };
