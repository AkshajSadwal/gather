const prisma = require('../config/prisma');

const WINDOWS = Object.freeze({ '24h': 24 * 60 * 60 * 1000, '7d': 7 * 86400000, '30d': 30 * 86400000, all: null });
const EVENTS = ['LIKE', 'SAVE', 'SHARE', 'COMMENT', 'NOT_INTERESTED', 'REPORT', 'CREATOR_BLOCK', 'CREATOR_MUTE'];

async function computeWindow(userIds, name, now) {
  const duration = WINDOWS[name];
  const since = duration ? new Date(now.getTime() - duration) : undefined;
  const impressionWhere = { userId: { in: userIds }, ...(since ? { servedAt: { gte: since } } : {}) };
  const eventWhere = { userId: { in: userIds }, ...(since ? { occurredAt: { gte: since } } : {}) };
  const [impressions, watched, completed, skipped, events] = await Promise.all([
    prisma.reelImpression.groupBy({ by: ['userId'], where: impressionWhere, _count: { _all: true }, _sum: { watchMs: true } }),
    prisma.reelImpression.groupBy({ by: ['userId'], where: { ...impressionWhere, watchMs: { gt: 0 } }, _count: { _all: true }, _sum: { watchMs: true } }),
    prisma.reelImpression.groupBy({ by: ['userId'], where: { ...impressionWhere, completed: true }, _count: { _all: true } }),
    prisma.reelImpression.groupBy({ by: ['userId'], where: { ...impressionWhere, visibleMs: { lt: 2000 } }, _count: { _all: true } }),
    prisma.reelEvent.groupBy({ by: ['userId', 'type'], where: { ...eventWhere, type: { in: EVENTS } }, _count: { _all: true } })
  ]);
  const impressionMap = new Map(impressions.map((row) => [row.userId, { count: row._count._all, watchMs: Number(row._sum.watchMs || 0) }]));
  const watchedMap = new Map(watched.map((row) => [row.userId, { count: row._count._all, watchMs: Number(row._sum.watchMs || 0) }]));
  const completeMap = new Map(completed.map((row) => [row.userId, row._count._all]));
  const skipMap = new Map(skipped.map((row) => [row.userId, row._count._all]));
  const eventMap = new Map();
  for (const row of events) {
    const values = eventMap.get(row.userId) || {};
    values[row.type] = row._count._all;
    eventMap.set(row.userId, values);
  }
  return new Map(userIds.map((userId) => {
    const total = impressionMap.get(userId) || { count: 0, watchMs: 0 };
    const watchedTotal = watchedMap.get(userId) || { count: 0, watchMs: 0 };
    const count = (type) => eventMap.get(userId)?.[type] || 0;
    const denominator = Math.max(total.count, 1);
    return [userId, {
      impressionsSeen: total.count,
      reelsWatched: watchedTotal.count,
      averageWatchMs: watchedTotal.count ? Math.round(watchedTotal.watchMs / watchedTotal.count) : 0,
      completionRate: Number(((completeMap.get(userId) || 0) / denominator).toFixed(4)),
      likeRate: Number((count('LIKE') / denominator).toFixed(4)),
      saveRate: Number((count('SAVE') / denominator).toFixed(4)),
      shareRate: Number((count('SHARE') / denominator).toFixed(4)),
      commentRate: Number((count('COMMENT') / denominator).toFixed(4)),
      skipCount: skipMap.get(userId) || 0,
      notInterestedCount: count('NOT_INTERESTED'),
      recentNegativeCount: ['NOT_INTERESTED', 'REPORT', 'CREATOR_BLOCK', 'CREATOR_MUTE'].reduce((sum, type) => sum + count(type), 0),
      topCreators: [], topHashtags: []
    }];
  }));
}

async function runFeatureRecompute() {
  try {
    const now = new Date();
    const recentCutoff = new Date(now.getTime() - 30 * 86400000);
    const recent = await prisma.reelEvent.findMany({ where: { occurredAt: { gte: recentCutoff }, user: { personalizedRecs: true } }, distinct: ['userId'], select: { userId: true }, take: 500 });
    const users = await prisma.user.findMany({ where: { id: { in: recent.map((row) => row.userId) }, personalizedRecs: true }, select: { id: true } });
    if (!users.length) return;
    const userIds = users.map((row) => row.id);
    const windows = await Promise.all(Object.keys(WINDOWS).map(async (name) => [name, await computeWindow(userIds, name, now)]));
    const [affinities, recentImpressions] = await Promise.all([
      prisma.userCreatorAffinity.findMany({ where: { userId: { in: userIds }, score: { gt: 0 } }, orderBy: { score: 'desc' }, select: { userId: true, creatorId: true, score: true } }),
      prisma.reelImpression.findMany({
        where: { userId: { in: userIds }, seenAt: { gte: recentCutoff } }, take: 10000,
        select: {
          userId: true,
          reel: { select: { post: { select: { hashtags: { select: { hashtag: { select: { tag: true } } } } } } } }
        }
      })
    ]);
    const topByUser = new Map();
    for (const row of affinities) {
      const list = topByUser.get(row.userId) || [];
      if (list.length < 5) list.push({ creatorId: row.creatorId, score: row.score });
      topByUser.set(row.userId, list);
    }
    const hashtagCounts = new Map();
    for (const impression of recentImpressions) {
      const counts = hashtagCounts.get(impression.userId) || new Map();
      for (const link of impression.reel.post?.hashtags || []) counts.set(link.hashtag.tag, (counts.get(link.hashtag.tag) || 0) + 1);
      hashtagCounts.set(impression.userId, counts);
    }
    await prisma.$transaction(userIds.map((userId) => {
      const features = Object.fromEntries(windows.map(([name, values]) => [name, { ...values.get(userId), topCreators: topByUser.get(userId) || [], topHashtags: [...(hashtagCounts.get(userId) || new Map())].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tag, count]) => ({ tag, count })) }]));
      return prisma.userRecoFeatures.upsert({ where: { userId }, create: { userId, features, computedAt: now }, update: { features, computedAt: now } });
    }));
    console.log(`[reco] features recomputed users=${userIds.length}`);
  } catch {
    console.warn('[reco] feature recompute failed');
  }
}

function startFeatureRecompute() {
  if (process.env.NODE_ENV === 'test') return null;
  const configured = Number(process.env.RECO_FEATURES_INTERVAL_MS || 600000);
  const timer = setInterval(() => { void runFeatureRecompute(); }, Number.isFinite(configured) && configured > 0 ? configured : 600000);
  timer.unref();
  return timer;
}

function stopFeatureRecompute(timer) { if (timer) clearInterval(timer); }

module.exports = { runFeatureRecompute, startFeatureRecompute, stopFeatureRecompute };
