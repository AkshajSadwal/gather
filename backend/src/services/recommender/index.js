const defaultPrisma = require('../../config/prisma');
const { getBlockedUserIds } = require('../blocks');
const { mutedIdsFor } = require('../relations');
const modelService = require('./modelService');
const { isReelEligible, buildReelCandidateWhere, applyModelRanking } = require('./rankingPolicy');
const { opaqueId, buildUserFeatureSnapshot, buildReelFeatureSnapshot, mergeForModel } = require('../recoFeatureSchema');

const { countQualifiedReels, interactionThreshold, sampleCatalogue, selectDiverse } = require('./discovery');

const MODEL_VERSION = 'kuairand_zero_shot_v1';

async function getCandidates({ userId, sessionId, requestId, limit = 10, excludeReelIds = [] }, {
  prisma = defaultPrisma, blockedFor = getBlockedUserIds, mutedFor = mutedIdsFor, model = modelService
} = {}) {
  const now = new Date();
  const [user, blockedIds, mutedIds, follows, affinities] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true, personalizedRecs: true, recsResetAt: true, profile: { select: { visibility: true } } } }),
    blockedFor(userId), mutedFor(userId),
    prisma.follow.findMany({ where: { followerId: userId, accepted: true }, select: { followedId: true } }),
    prisma.userCreatorAffinity.findMany({ where: { userId }, select: { creatorId: true, score: true, lastInteractionAt: true } })
  ]);
  const followed = new Set(follows.map((row) => row.followedId));
  const personalizationEnabled = Boolean(user?.personalizedRecs);
  const affinity = new Map((personalizationEnabled ? affinities : []).map((row) => [row.creatorId, row.score]));
  const negativeAffinity = [...affinity].filter(([, score]) => score <= -3).map(([id]) => id);
  const hidden = [...new Set([...blockedIds, ...mutedIds, ...negativeAffinity, userId])];
  const cutoff = new Date(Math.max(now.getTime() - 30 * 86400000, user?.recsResetAt?.getTime() || 0));
  const threshold = interactionThreshold();
  const qualifiedCount = personalizationEnabled ? await countQualifiedReels(prisma, userId, user.recsResetAt) : null;
  let mode = !personalizationEnabled ? 'personalization_disabled' : qualifiedCount < threshold ? 'cold_start' : 'model_disabled';
  const canRank = mode === 'model_disabled' && model.isConfigured();
  const select = canRank ? { id: true, authorId: true, createdAt: true, durationMs: true, language: true, author: { select: { createdAt: true, profile: { select: { visibility: true } }, _count: { select: { followers: { where: { accepted: true } } } } } }, media: { select: { sizeBytes: true } }, post: { select: { id: true, archivedAt: true, hashtags: { include: { hashtag: { select: { tag: true } } } } } } } : { id: true, authorId: true };
  const sessionHistory = { userId, sessionId, servedAt: { gte: user?.recsResetAt || new Date(0) } };
  const base = buildReelCandidateWhere({ userId, hiddenIds: hidden, followedIds: [...followed], excludedIds: excludeReelIds });
  const available = { ...base, media: { some: { url: { not: '' }, sizeBytes: { gt: 0 } } } };
  const recentIds = excludeReelIds.slice(-9);
  let recentCreators = [];
  let lastReelId = recentIds.at(-1);
  if (recentIds.length) {
    const rows = await prisma.reel.findMany({ where: { id: { in: recentIds } }, select: { id: true, authorId: true } });
    const byId = new Map(rows.map((row) => [row.id, row.authorId]));
    recentCreators = recentIds.map((id) => byId.get(id)).filter(Boolean);
  } else if (personalizationEnabled) {
    const rows = await prisma.reelImpression.findMany({
      where: sessionHistory, orderBy: [{ servedAt: 'desc' }, { requestId: 'desc' }, { position: 'desc' }],
      take: 9, select: { creatorId: true, reelId: true }
    });
    lastReelId = rows[0]?.reelId;
    recentCreators = rows.reverse().map((row) => row.creatorId);
  }
  const seed = JSON.stringify([userId, sessionId, lastReelId]);
  const newReels = await sampleCatalogue(prisma, {
    where: personalizationEnabled ? { ...available, impressions: { none: { OR: [sessionHistory, { userId, servedAt: { gte: cutoff } }] } } } : available,
    select, seed, limit
  });
  // Revisit older recommendations only when fresh options run low, once per session.
  const replayReels = personalizationEnabled && newReels.length < limit ? await sampleCatalogue(prisma, {
    where: { AND: [available, { id: { notIn: newReels.map((reel) => reel.id) } }], impressions: { none: sessionHistory } },
    select, seed, limit
  }) : [];
  const reels = [...newReels, ...replayReels];
  const hiddenIds = new Set(hidden);
  const eligible = reels.filter((reel) => isReelEligible(reel, {
    userId, hiddenIds, followedIds: followed, personalizationEnabled, affinity
  }));
  const freshCutoff = new Date(now.getTime() - 7 * 86400000);
  let usedModel = false;
  const stats = canRank && eligible.length ? await prisma.reelStatsDaily.groupBy({ by: ['reelId'], where: { reelId: { in: eligible.map((row) => row.id) }, day: { gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6)) } }, _sum: { views: true, likes: true, watchMsSum: true } }) : [];
  const popularity = new Map(stats.map((row) => [row.reelId, (row._sum.views || 0) + (row._sum.likes || 0) * 3 + Math.floor(Number(row._sum.watchMsSum || 0) / 60000)]));
  let candidates = eligible.map((reel) => {
    let candidateSource = followed.has(reel.authorId) ? 'FOLLOWING' : 'EXPLORE';
    if (user?.personalizedRecs !== false && affinity.has(reel.authorId) && affinity.get(reel.authorId) > 0) candidateSource = 'AFFINITY';
    else if ((popularity.get(reel.id) || 0) > 0) candidateSource = 'POPULAR';
    else if (reel.createdAt >= freshCutoff) candidateSource = 'FRESH';
    return { reelId: reel.id, creatorId: reel.authorId, candidateSource, retrievalScore: null, rankingScore: null };
  });
  const exploration = candidates;
  if (canRank) mode = 'no_candidates';
  if (canRank && candidates.length) {
    const [userFeature, followerCount] = await Promise.all([
      prisma.userRecoFeatures.findUnique({ where: { userId }, select: { features: true } }),
      prisma.follow.count({ where: { followedId: userId, accepted: true } })
    ]);
    const userSnapshot = buildUserFeatureSnapshot({ userId, createdAt: user.createdAt, profileVisibility: user.profile?.visibility, followingCount: follows.length, followerCount, friendCount: null, personalizedRecs: true, features: userFeature?.features, at: now });
    const featureById = new Map(eligible.map((reel) => [reel.id, buildReelFeatureSnapshot({ reel, mediaBytes: reel.media.reduce((sum, media) => sum + (media.sizeBytes || 0), 0), creatorFollowerCount: reel.author._count.followers, creatorCreatedAt: reel.author.createdAt, at: now })]));
    const ranked = await model.recommend({
      requestId, sessionId, userKey: opaqueId('viewer', userId),
      featureSchemaVersion: 'gather-reco-v1',
      userFeatures: userSnapshot,
      candidates: candidates.map((candidate) => {
        const reelKey = opaqueId('reel', candidate.reelId);
        const creatorKey = opaqueId('creator', candidate.creatorId);
        return { reelId: candidate.reelId, reelKey, creatorId: creatorKey, candidateSource: candidate.candidateSource, features: mergeForModel(userSnapshot, featureById.get(candidate.reelId) || {}) };
      })
    }, (status) => { mode = status; });
    if (ranked?.status === 'READY' && Array.isArray(ranked.items)) {
      const trusted = applyModelRanking(candidates, ranked);
      if (trusted) { candidates = trusted; usedModel = true; mode = 'personalized'; }
      else { mode = 'model_incompatible'; model.logFallback('invalid_ranking'); }
    }
  }
  const result = selectDiverse(candidates, { limit, recentCreators, exploration: usedModel ? exploration : [] });
  return {
    modelVersion: MODEL_VERSION, provider: usedModel ? MODEL_VERSION : 'cold_start_v1',
    candidates: result, trackingEnabled: personalizationEnabled,
    diagnostics: { mode, qualifiedCount, threshold }
  };
}

module.exports = { MODEL_VERSION, getCandidates };
