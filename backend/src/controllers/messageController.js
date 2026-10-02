const prisma = require('../config/prisma');
const { HttpError, ok } = require('../utils/http');
const { isBlockedBetween, getBlockedUserIds } = require('../services/blocks');

async function unreadCountsForUser(userId, conversationIds) {
  if (!conversationIds.length) return {};
  const rows = await prisma.message.groupBy({
    by: ['conversationId'],
    where: {
      conversationId: { in: conversationIds },
      senderId: { not: userId },
      reads: { none: { userId } }
    },
    _count: { _all: true }
  });
  return Object.fromEntries(rows.map((row) => [row.conversationId, row._count._all]));
}

async function conversations(req, res) {
  const links = await prisma.conversationParticipant.findMany({
    where: { userId: req.user.id }, orderBy: { conversation: { updatedAt: 'desc' } },
    include: {
      conversation: {
        include: {
          participants: { include: { user: { select: { id: true, username: true, image: true, profile: { select: { displayName: true, avatarUrl: true } } } } } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1, include: { sender: { select: { id: true, username: true } }, reads: true } }
        }
      }
    }
  });
  const conversationIds = links.map(({ conversation }) => conversation.id);
  const unreadByConversation = await unreadCountsForUser(req.user.id, conversationIds);
  const data = links.map(({ conversation }) => ({ ...conversation, unreadCount: unreadByConversation[conversation.id] || 0 }));
  return ok(res, { conversations: data });
}

async function unread(req, res) {
  const memberships = await prisma.conversationParticipant.findMany({ where: { userId: req.user.id }, select: { conversationId: true } });
  const unreadByConversation = await unreadCountsForUser(req.user.id, memberships.map(({ conversationId }) => conversationId));
  const total = Object.values(unreadByConversation).reduce((sum, count) => sum + count, 0);
  return ok(res, { total, unreadByConversation });
}

async function suggestions(req, res) {
  const follows = req.user?.id ? await prisma.follow.findMany({ where: { followerId: req.user.id }, select: { followedId: true } }) : [];
  const excluded = [...(req.user?.id ? [req.user.id] : []), ...follows.map((row) => row.followedId)];
  const blockedIds = await getBlockedUserIds(req.user?.id);
  const users = await prisma.user.findMany({ where: { id: { notIn: [...excluded, ...blockedIds] }, profile: { is: { visibility: 'PUBLIC' } } }, take: 8, orderBy: { createdAt: 'desc' }, select: { id: true, username: true, image: true, profile: { select: { displayName: true, avatarUrl: true } }, _count: { select: { followers: { where: { accepted: true } } } } } });
  return ok(res, { users });
}

async function openConversation(req, res) {
  const target = await prisma.user.findUnique({ where: { username: String(req.params.username).toLowerCase() }, select: { id: true, username: true } });
  if (!target) throw new HttpError(404, 'USER_NOT_FOUND', 'That user could not be found.');
  if (await isBlockedBetween(req.user.id, target.id)) throw new HttpError(403, 'BLOCKED', 'You cannot message this account.');
  if (target.id === req.user.id) throw new HttpError(400, 'INVALID_CONVERSATION', 'You cannot message yourself.');
  const directKey = [req.user.id, target.id].sort().join(':');
  const conversation = await prisma.conversation.upsert({ where: { directKey }, create: { directKey, participants: { create: [{ userId: req.user.id }, { userId: target.id }] } }, update: {}, include: { participants: { include: { user: { select: { id: true, username: true, image: true } } } } } });
  return ok(res, { conversation }, 200);
}

async function messages(req, res) {
  const member = await prisma.conversationParticipant.findUnique({ where: { conversationId_userId: { conversationId: req.params.id, userId: req.user.id } }, select: { id: true } });
  if (!member) throw new HttpError(403, 'FORBIDDEN', 'You are not a participant in this conversation.');
  const other = await prisma.conversationParticipant.findFirst({ where: { conversationId: req.params.id, userId: { not: req.user.id } }, select: { userId: true } });
  if (other && await isBlockedBetween(req.user.id, other.userId)) throw new HttpError(403, 'BLOCKED', 'You cannot access this conversation.');
  const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), 100);
  const rows = await prisma.message.findMany({ where: { conversationId: req.params.id }, orderBy: { createdAt: 'desc' }, take: limit + 1, ...(req.query.cursor ? { cursor: { id: String(req.query.cursor) }, skip: 1 } : {}), include: { sender: { select: { id: true, username: true, image: true } }, reads: true } });
  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();
  return ok(res, { messages: rows.reverse(), nextCursor: hasMore ? rows[0]?.id : null });
}

async function markRead(req, res) {
  const membership = await prisma.conversationParticipant.findUnique({ where: { conversationId_userId: { conversationId: req.params.id, userId: req.user.id } }, select: { id: true } });
  if (!membership) throw new HttpError(403, 'FORBIDDEN', 'You are not a participant in this conversation.');
  const other = await prisma.conversationParticipant.findFirst({ where: { conversationId: req.params.id, userId: { not: req.user.id } }, select: { userId: true } });
  if (other && await isBlockedBetween(req.user.id, other.userId)) throw new HttpError(403, 'BLOCKED', 'You cannot access this conversation.');
  const unread = await prisma.message.findMany({ where: { conversationId: req.params.id, senderId: { not: req.user.id }, reads: { none: { userId: req.user.id } } }, select: { id: true } });
  if (unread.length) await prisma.messageRead.createMany({ data: unread.map(({ id }) => ({ messageId: id, userId: req.user.id })), skipDuplicates: true });
  const io = global.io;
  if (io) {
    const others = await prisma.conversationParticipant.findMany({ where: { conversationId: req.params.id, userId: { not: req.user.id } }, select: { userId: true } });
    for (const other of others) io.to(`user:${other.userId}`).emit('message:read', { conversationId: req.params.id, userId: req.user.id, messageIds: unread.map(({ id }) => id), readAt: new Date().toISOString() });
  }
  return ok(res, { read: unread.length });
}

module.exports = { conversations, unread, suggestions, openConversation, messages, markRead };

