const prisma = require('../../config/prisma');
const { getBlockedUserIds } = require('../blocks');
const { mutedIdsFor } = require('../relations');

const MODEL_VERSION = 'heuristic_v0';

async function getCandidates({ userId, sessionId, limit = 10, excludeReelIds = [] }) {
  const now = new Date();
  const [user, blockedIds, mutedIds, follows, affinities] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { personalizedRecs: true, recsResetAt: true } }),
    getBlockedUserIds(userId), mutedIdsFor(userId),
    prisma.follow.findMany({ where: { followerId: userId, accepted: true }, select: { followedId: true } }),
    prisma.userCreatorAffinity.findMany({ where: { userId }, select: { creatorId: true, score: true, lastInteractionAt: true } })
  ]);
  const followed = new Set(follows.map((row) => row.followedId));
  const personalizationEnabled = user?.personalizedRecs !== false;
  const affinity = new Map((personalizationEnabled ? affinities : []).map((row) => [row.creatorId, row.score]));
  const hidden = [...new Set([...blockedIds, ...mutedIds])];
  const cutoff = new Date(Math.max(now.getTime() - 30 * 86400000, user?.recsResetAt?.getTime() || 0));
  const seen = await prisma.reelImpression.findMany({ where: { userId, servedAt: { gte: cutoff } }, select: { reelId: true } });
  const excluded = new Set([...excludeReelIds, ...seen.map((row) => row.reelId)]);
  const reels = await prisma.reel.findMany({
    where: {
      authorId: { notIn: hidden },
      AND: [{ OR: [{ post: { is: { archivedAt: null } } }, { post: { is: null } }] }],
      OR: [
        { authorId: userId },
        { authorId: { in: [...followed] } },
        { author: { is: { profile: { is: { visibility: 'PUBLIC' } } } } }
      ],
      ...(excluded.size ? { id: { notIn: [...excluded] } } : {})
    },
    orderBy: { createdAt: 'desc' }, take: 250,
    select: { id: true, authorId: true, createdAt: true, author: { select: { profile: { select: { visibility: true } } } }, post: { select: { id: true, archivedAt: true } } }
  });
  const privateFollowed = followed;
  const eligible = reels.filter((reel) => {
    if (reel.author.profile?.visibility === 'PRIVATE' && reel.authorId !== userId && !privateFollowed.has(reel.authorId)) return false;
    return !personalizationEnabled || (affinity.get(reel.authorId) ?? 0) > -3;
  });
  const freshCutoff = new Date(now.getTime() - 7 * 86400000);
  const stats = await prisma.reelStatsDaily.groupBy({ by: ['reelId'], where: { reelId: { in: eligible.map((row) => row.id) }, day: { gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6)) } }, _sum: { views: true, likes: true, watchMsSum: true } });
  const popularity = new Map(stats.map((row) => [row.reelId, (row._sum.views || 0) + (row._sum.likes || 0) * 3 + Math.floor(Number(row._sum.watchMsSum || 0) / 60000)]));
  const candidates = eligible.map((reel) => {
    let candidateSource = followed.has(reel.authorId) ? 'FOLLOWING' : 'EXPLORE';
    if (user?.personalizedRecs !== false && affinity.has(reel.authorId) && affinity.get(reel.authorId) > 0) candidateSource = 'AFFINITY';
    else if ((popularity.get(reel.id) || 0) > 0) candidateSource = 'POPULAR';
    else if (reel.createdAt >= freshCutoff) candidateSource = 'FRESH';
    const ageHours = Math.max(0, (now - reel.createdAt) / 3600000);
    const retrievalScore = candidateSource === 'FOLLOWING' ? 2 : candidateSource === 'AFFINITY' ? 1.8 : candidateSource === 'POPULAR' ? 1.5 : candidateSource === 'FRESH' ? 1 : 0.5;
    const rankingScore = (candidateSource === 'AFFINITY' ? affinity.get(reel.authorId) : 0) + Math.log1p(popularity.get(reel.id) || 0) + retrievalScore - ageHours / 240;
    return { reelId: reel.id, creatorId: reel.authorId, candidateSource, retrievalScore, rankingScore, createdAt: reel.createdAt };
  }).sort((a, b) => b.rankingScore - a.rankingScore || b.createdAt - a.createdAt);
  const result = [];
  const creatorCounts = new Map();
  for (const candidate of candidates) {
    if ((creatorCounts.get(candidate.creatorId) || 0) >= 2) continue;
    result.push(candidate);
    creatorCounts.set(candidate.creatorId, (creatorCounts.get(candidate.creatorId) || 0) + 1);
    if (result.length >= Math.min(30, Math.max(1, limit))) break;
  }
  return { modelVersion: MODEL_VERSION, candidates: result, sessionId, trackingEnabled: user?.personalizedRecs !== false };
}

module.exports = { MODEL_VERSION, getCandidates };
