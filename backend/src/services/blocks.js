const prisma = require('../config/prisma');

async function getBlockState(userId, otherUserId) {
  if (!userId || !otherUserId || userId === otherUserId) return { blocked: false, blockedBy: false };
  const [outgoing, incoming] = await Promise.all([
    prisma.block.findUnique({ where: { blockerId_blockedId: { blockerId: userId, blockedId: otherUserId } }, select: { id: true } }),
    prisma.block.findUnique({ where: { blockerId_blockedId: { blockerId: otherUserId, blockedId: userId } }, select: { id: true } })
  ]);
  return { blocked: Boolean(outgoing), blockedBy: Boolean(incoming) };
}

async function isBlockedBetween(userId, otherUserId) {
  const state = await getBlockState(userId, otherUserId);
  return state.blocked || state.blockedBy;
}

async function getBlockedUserIds(userId) {
  if (!userId) return [];
  const [outgoing, incoming] = await Promise.all([
    prisma.block.findMany({ where: { blockerId: userId }, select: { blockedId: true } }),
    prisma.block.findMany({ where: { blockedId: userId }, select: { blockerId: true } })
  ]);
  return [...new Set([...outgoing.map((row) => row.blockedId), ...incoming.map((row) => row.blockerId)])];
}

module.exports = { getBlockState, isBlockedBetween, getBlockedUserIds };
