const prisma = require('../config/prisma');
const { HttpError } = require('../utils/http');

async function blockedIdsFor(userId) {
  if (!userId) return [];
  const [outgoing, incoming] = await Promise.all([
    prisma.block.findMany({ where: { blockerId: userId }, select: { blockedId: true } }),
    prisma.block.findMany({ where: { blockedId: userId }, select: { blockerId: true } })
  ]);
  return [...new Set([...outgoing.map((row) => row.blockedId), ...incoming.map((row) => row.blockerId)])];
}

async function mutedIdsFor(userId) {
  if (!userId) return [];
  const mutes = await prisma.mute.findMany({ where: { muterId: userId }, select: { mutedId: true } });
  return mutes.map((row) => row.mutedId);
}

async function isBlockedBetween(userId, otherUserId) {
  if (!userId || !otherUserId || userId === otherUserId) return false;
  return Boolean(await prisma.block.findFirst({
    where: { OR: [{ blockerId: userId, blockedId: otherUserId }, { blockerId: otherUserId, blockedId: userId }] },
    select: { id: true }
  }));
}

async function getBlockState(userId, otherUserId) {
  if (!userId || !otherUserId || userId === otherUserId) return { blocked: false, blockedBy: false };
  const [blocked, blockedBy] = await Promise.all([
    prisma.block.findUnique({ where: { blockerId_blockedId: { blockerId: userId, blockedId: otherUserId } }, select: { id: true } }),
    prisma.block.findUnique({ where: { blockerId_blockedId: { blockerId: otherUserId, blockedId: userId } }, select: { id: true } })
  ]);
  return { blocked: Boolean(blocked), blockedBy: Boolean(blockedBy) };
}

async function listMutes(userId) {
  return prisma.mute.findMany({
    where: { muterId: userId },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { muted: { select: { id: true, username: true, image: true, profile: { select: { displayName: true, avatarUrl: true } } } } }
  });
}

async function toggleMute(userId, username) {
  const target = await prisma.user.findUnique({ where: { username }, select: { id: true, username: true } });
  if (!target) throw new HttpError(404, 'USER_NOT_FOUND', 'That account could not be found.');
  if (target.id === userId) throw new HttpError(400, 'CANNOT_MUTE_SELF', 'You cannot mute your own account.');
  const existing = await prisma.mute.findUnique({ where: { muterId_mutedId: { muterId: userId, mutedId: target.id } } });
  if (existing) {
    await prisma.mute.delete({ where: { id: existing.id } });
    return { muted: false, username: target.username };
  }
  await prisma.mute.create({ data: { muterId: userId, mutedId: target.id } });
  return { muted: true, username: target.username };
}

module.exports = { blockedIdsFor, mutedIdsFor, isBlockedBetween, getBlockState, listMutes, toggleMute };
