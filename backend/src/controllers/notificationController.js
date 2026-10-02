const prisma = require('../config/prisma');
const { HttpError, ok } = require('../utils/http');

async function list(req, res) {
  const notifications = await prisma.notification.findMany({
    where: { recipientId: req.user.id },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Number(req.query.limit) || 30, 100),
    include: { actor: { select: { id: true, username: true, image: true } } }
  });

  const requestActorIds = [...new Set(
    notifications
      .filter((item) => item.type === 'FOLLOW_REQUEST' && item.actor?.id)
      .map((item) => item.actor.id)
  )];

  const pendingRequests = requestActorIds.length
    ? await prisma.follow.findMany({
      where: {
        followedId: req.user.id,
        accepted: false,
        followerId: { in: requestActorIds }
      },
      select: { id: true, followerId: true }
    })
    : [];

  const requestIdByActor = new Map(pendingRequests.map((request) => [request.followerId, request.id]));
  const seenPendingActors = new Set();
  const shaped = [];

  for (const item of notifications) {
    const followRequestId = item.type === 'FOLLOW_REQUEST'
      ? (requestIdByActor.get(item.actor?.id) || null)
      : null;

    // A user may have several historical FOLLOW_REQUEST notifications for the
    // same currently-pending request. Show only the newest actionable one.
    if (item.type === 'FOLLOW_REQUEST' && followRequestId && item.actor?.id) {
      if (seenPendingActors.has(item.actor.id)) continue;
      seenPendingActors.add(item.actor.id);
    }

    shaped.push({ ...item, followRequestId });
  }

  return ok(res, { notifications: shaped });
}

async function unread(req, res) {
  const [regularUnread, pendingRequestNotifications] = await Promise.all([
    prisma.notification.count({
      where: { recipientId: req.user.id, readAt: null, type: { not: 'FOLLOW_REQUEST' } }
    }),
    prisma.notification.findMany({
      where: { recipientId: req.user.id, readAt: null, type: 'FOLLOW_REQUEST' },
      select: { actorId: true }
    })
  ]);
  const uniquePendingRequestActors = new Set(pendingRequestNotifications.map((item) => item.actorId).filter(Boolean));
  return ok(res, { total: regularUnread + uniquePendingRequestActors.size });
}

async function markRead(req, res) {
  const id = req.params.id;
  if (id === 'all') {
    const result = await prisma.notification.updateMany({
      where: { recipientId: req.user.id, readAt: null },
      data: { readAt: new Date() }
    });
    return ok(res, { updated: result.count });
  }
  const result = await prisma.notification.updateMany({
    where: { id, recipientId: req.user.id },
    data: { readAt: new Date() }
  });
  if (!result.count) throw new HttpError(404, 'NOTIFICATION_NOT_FOUND', 'That notification could not be found.');
  return ok(res, { updated: result.count });
}

module.exports = { list, unread, markRead };
