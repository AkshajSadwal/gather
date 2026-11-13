const { z } = require('zod');
const prisma = require('../config/prisma');
const { HttpError, ok } = require('../utils/http');
const { blockedIdsFor } = require('../services/relations');

async function list(req, res) {
  const members = await prisma.closeFriend.findMany({ where: { ownerId: req.user.id }, orderBy: { createdAt: 'desc' }, include: { friend: { select: { id: true, username: true, image: true, profile: { select: { displayName: true, avatarUrl: true } } } } } });
  return ok(res, { members });
}

async function candidates(req, res) {
  const parsed = z.object({ q: z.string().trim().max(30).optional() }).safeParse(req.query);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'The Close Friends search is invalid.');
  const blockedIds = await blockedIdsFor(req.user.id);
  const [following, followers, members] = await Promise.all([
    prisma.follow.findMany({ where: { followerId: req.user.id, accepted: true }, select: { followedId: true } }),
    prisma.follow.findMany({ where: { followedId: req.user.id, accepted: true }, select: { followerId: true } }),
    prisma.closeFriend.findMany({ where: { ownerId: req.user.id }, select: { friendId: true } })
  ]);
  const excluded = new Set([req.user.id, ...blockedIds, ...members.map((item) => item.friendId)]);
  const allowedIds = [...new Set([...following.map((item) => item.followedId), ...followers.map((item) => item.followerId)])].filter((id) => !excluded.has(id));
  const candidates = await prisma.user.findMany({ where: { id: { in: allowedIds }, ...(parsed.data.q ? { username: { contains: parsed.data.q, mode: 'insensitive' } } : {}) }, orderBy: { username: 'asc' }, take: 50, select: { id: true, username: true, image: true, profile: { select: { displayName: true, avatarUrl: true } } } });
  return ok(res, { candidates });
}

async function toggle(req, res) {
  const parsed = z.object({ username: z.string().trim().min(3).max(30).regex(/^[a-zA-Z0-9._]+$/) }).safeParse(req.params);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Enter a valid username.');
  const friend = await prisma.user.findUnique({ where: { username: parsed.data.username.toLowerCase() }, select: { id: true } });
  if (!friend || friend.id === req.user.id || await blockedIdsFor(req.user.id).then((ids) => ids.includes(friend.id))) throw new HttpError(404, 'USER_NOT_FOUND', 'That account could not be found.');
  const existing = await prisma.closeFriend.findUnique({ where: { ownerId_friendId: { ownerId: req.user.id, friendId: friend.id } }, select: { id: true } });
  if (existing) {
    await prisma.closeFriend.delete({ where: { id: existing.id } });
    return ok(res, { isCloseFriend: false });
  }
  const [following, followedBy] = await Promise.all([
    prisma.follow.findUnique({ where: { followerId_followedId: { followerId: req.user.id, followedId: friend.id } }, select: { accepted: true } }),
    prisma.follow.findUnique({ where: { followerId_followedId: { followerId: friend.id, followedId: req.user.id } }, select: { accepted: true } })
  ]);
  if (!following?.accepted && !followedBy?.accepted) throw new HttpError(400, 'FOLLOW_REQUIRED', 'You can add people who follow you or people you follow.');
  await prisma.closeFriend.create({ data: { ownerId: req.user.id, friendId: friend.id } });
  return ok(res, { isCloseFriend: true });
}

module.exports = { list, candidates, toggle };
