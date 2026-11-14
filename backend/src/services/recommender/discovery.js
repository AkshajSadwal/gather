const { createHash } = require('node:crypto');
const { Prisma } = require('@prisma/client');

const DEFAULT_THRESHOLD = 50;
const REELS_PER_CREATOR = 7;

function interactionThreshold() {
  const value = Number(process.env.REELS_QUALIFIED_INTERACTION_THRESHOLD);
  return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_THRESHOLD;
}

async function countQualifiedReels(db, userId, resetAt) {
  // Each impression already accumulates watch deltas from idempotent events.
  const cutoff = resetAt || new Date(0);
  const [row] = await db.$queryRaw(Prisma.sql`
    SELECT COUNT(*)::int AS count FROM (
      SELECT i."reelId" FROM "ReelImpression" i
      JOIN "Reel" r ON r.id = i."reelId"
      WHERE i."userId" = ${userId} AND i."servedAt" >= ${cutoff}
        AND r."authorId" <> ${userId}
        AND i."watchMs" >= LEAST(3000,
          CASE WHEN COALESCE(r."durationMs", i."videoDurationMs") BETWEEN 1 AND 2999
            THEN CEIL(COALESCE(r."durationMs", i."videoDurationMs") / 2.0)
            ELSE 3000 END)
      UNION
      SELECT e."reelId" FROM "ReelEvent" e
      JOIN "Reel" r ON r.id = e."reelId"
      WHERE e."userId" = ${userId} AND e."occurredAt" >= ${cutoff}
        AND r."authorId" <> ${userId}
        AND e.type IN ('LIKE', 'SAVE', 'SHARE', 'COMMENT')
    ) qualified
  `);
  return row.count;
}

function stableOrder(items, seed, key) {
  return items.map((item) => ({ item, order: createHash('sha256').update(JSON.stringify([seed, key(item)])).digest('hex') }))
    .sort((a, b) => a.order.localeCompare(b.order)).map(({ item }) => item);
}

async function sampleCatalogue(db, { where, select, seed, limit }) {
  const creators = await db.user.findMany({ where: { reels: { some: where } }, select: { id: true } });
  if (!creators.length) return [];
  const ordered = stableOrder(creators, seed, (creator) => creator.id).slice(0, Math.max(12, limit + 4));
  const perCreator = Math.max(REELS_PER_CREATOR, Math.ceil(limit / creators.length));
  const sampled = [];
  for (let start = 0; start < ordered.length; start += 5) {
    const groups = await Promise.all(ordered.slice(start, start + 5).map(async ({ id }) => {
      // The existing (authorId, createdAt) index supports both date bounds and seeks.
      const dates = await db.reel.aggregate({ where: { authorId: id }, _min: { createdAt: true }, _max: { createdAt: true } });
      if (!dates._min.createdAt || !dates._max.createdAt) return [];
      const min = dates._min.createdAt.getTime();
      const max = dates._max.createdAt.getTime();
      const fraction = createHash('sha256').update(JSON.stringify([seed, id])).digest().readUInt32BE() / 2 ** 32;
      const pivot = new Date(min + Math.floor((max - min) * fraction));
      const read = (createdAt, take) => db.reel.findMany({
        where: { AND: [where, { authorId: id, createdAt }] },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take, select
      });
      const tail = await read({ gte: pivot }, perCreator);
      const group = tail.length === perCreator ? tail : [...tail, ...await read({ lt: pivot }, perCreator - tail.length)];
      return stableOrder(group, seed, (reel) => reel.id);
    }));
    sampled.push(...groups);
  }
  return Array.from({ length: perCreator }, (_, position) => sampled.flatMap((group) => group[position] ? [group[position]] : [])).flat();
}

function selectDiverse(ranked, { limit, recentCreators = [], exploration = [] }) {
  const pool = new Map(ranked.map((item) => [item.reelId, item]));
  const recent = recentCreators.slice(-9);
  const result = [];
  const discoverySlots = Math.round(limit * 0.15);
  const desiredSlots = new Set(Array.from({ length: discoverySlots }, (_, i) =>
    Math.floor((i + 1) * limit / (discoverySlots + 1))));
  while (pool.size && result.length < limit) {
    const discovery = desiredSlots.has(result.length)
      ? exploration.filter((item) => pool.has(item.reelId)).map((item) => pool.get(item.reelId))
      : [];
    const ordered = [...new Set([...discovery, ...pool.values()])];
    const previous = recent.at(-1);
    const fitsWindow = (item) => recent.filter((creator) => creator === item.creatorId).length < 2;
    const next = ordered.find((item) => fitsWindow(item) && item.creatorId !== previous)
      || ordered.find((item) => fitsWindow(item))
      || ordered.find((item) => item.creatorId !== previous)
      || ordered[0];
    result.push(next);
    pool.delete(next.reelId);
    recent.push(next.creatorId);
    if (recent.length > 9) recent.shift();
  }
  return result;
}

module.exports = { countQualifiedReels, interactionThreshold, sampleCatalogue, selectDiverse };
