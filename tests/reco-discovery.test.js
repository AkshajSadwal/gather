const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getCandidates } = require('../backend/src/services/recommender');

function fixture() {
  const creators = ['bulk', 'a', 'b', 'c', 'd', 'e'];
  const reels = creators.flatMap((authorId) => Array.from({ length: authorId === 'bulk' ? 360 : 12 }, (_, offset) => ({
    id: `${authorId}-${offset}`, authorId,
    createdAt: new Date(Date.UTC(2024, 0, (authorId === 'bulk' ? 300 : 1) + offset)),
    author: { profile: { visibility: 'PUBLIC' }, _count: { followers: 0 } },
    media: [{ sizeBytes: 8000 }]
  })));
  const state = { reels, qualified: 0, enabled: true, calls: 0, resetAt: null, modelStatus: 'ready', served: [] };
  const matching = (where) => reels.filter((reel) =>
    !(where.authorId?.notIn || []).includes(reel.authorId) &&
    !(where.id?.notIn || []).includes(reel.id) &&
    (where.AND || []).every((condition) => !(condition.id?.notIn || []).includes(reel.id)) &&
    !(where.impressions?.none.OR && state.served.includes(reel.id)));
  const prisma = {
    user: { findUnique: async () => ({ personalizedRecs: state.enabled, recsResetAt: state.resetAt }) },
    $queryRaw: async (query) => {
      assert.equal(query.values[0], 'viewer');
      assert.deepEqual(query.values[1], state.resetAt || new Date(0));
      return [{ count: state.qualified }];
    },
    follow: { findMany: async () => [], count: async () => 0 },
    userCreatorAffinity: { findMany: async () => [] },
    userRecoFeatures: { findUnique: async () => null },
    reelImpression: { findMany: async () => [] },
    reelStatsDaily: { groupBy: async () => [] },
    reel: {
      groupBy: async ({ where }) => [...new Set(matching(where).map((reel) => reel.authorId))].map((authorId) => {
        const group = matching(where).filter((reel) => reel.authorId === authorId);
        return { authorId, _min: { createdAt: group[0].createdAt }, _max: { createdAt: group.at(-1).createdAt } };
      }),
      findMany: async ({ where, take }) => {
        if (where.id?.in) return reels.filter((reel) => where.id.in.includes(reel.id));
        const [eligible, { authorId, createdAt }] = where.AND;
        return matching(eligible).filter((reel) => reel.authorId === authorId &&
          (createdAt.gte ? reel.createdAt >= createdAt.gte : reel.createdAt < createdAt.lt)).slice(0, take);
      }
    }
  };
  const model = {
    isConfigured: () => state.modelStatus !== 'disabled',
    logFallback: () => {},
    recommend: async ({ candidates }, report) => {
      state.calls++;
      if (state.modelStatus === 'offline') { report('model_unavailable'); return null; }
      if (state.modelStatus === 'foreign_id') return { status: 'READY', items: [{ reelId: 'ineligible', rankingScore: 1 }] };
      return { status: 'READY', items: [...candidates].reverse().map(({ reelId }) => ({ reelId, rankingScore: 0.8 })) };
    }
  };
  const feed = (options = {}) => getCandidates({ userId: 'viewer', sessionId: 's1', requestId: 'r1', ...options }, {
    prisma, model, blockedFor: async () => options.blocked || [], mutedFor: async () => []
  });
  return { state, feed };
}

function checkDiversity(items) {
  for (let i = 0; i < items.length; i++) {
    const creator = items[i].creatorId;
    assert.notEqual(creator, items[i - 1]?.creatorId);
    assert.ok(items.slice(Math.max(0, i - 9), i + 1).filter((item) => item.creatorId === creator).length <= 2);
  }
}

test('cold-start pages are repeatable, sample old creators, and balance 360 bulk uploads across the first 50', async () => {
  const { state, feed } = fixture();
  const first = await feed();
  assert.equal(first.provider, 'cold_start_v1');
  assert.deepEqual((await feed()).candidates, first.candidates);
  assert.notDeepEqual((await feed({ sessionId: 's2' })).candidates, first.candidates);
  const seen = [];
  for (let page = 0; page < 5; page++) {
    const { candidates } = await feed({ excludeReelIds: seen.map((item) => item.reelId) });
    assert.equal(candidates.length, 10);
    seen.push(...candidates);
  }
  assert.equal(new Set(seen.map((item) => item.reelId)).size, 50);
  checkDiversity(seen);
  assert.equal(state.calls, 0);
});

test('at 49 the model is skipped, at 50 its results are diversified, and invalid/offline models fall back', async () => {
  const { state, feed } = fixture();
  state.qualified = 49;
  assert.equal((await feed()).diagnostics.mode, 'cold_start');
  assert.equal(state.calls, 0);
  state.qualified = 50;
  const ranked = await feed({ blocked: ['a'] });
  assert.equal(ranked.diagnostics.mode, 'personalized');
  assert.equal(ranked.provider, 'kuairand_zero_shot_v1');
  assert.equal(state.calls, 1);
  assert.ok(ranked.candidates.every(({ creatorId }) => creatorId !== 'a'));
  checkDiversity(ranked.candidates);
  for (const [status, mode] of [['offline', 'model_unavailable'], ['foreign_id', 'model_incompatible'], ['disabled', 'model_disabled']]) {
    state.modelStatus = status;
    const fallback = await feed();
    assert.equal(fallback.provider, 'cold_start_v1');
    assert.equal(fallback.diagnostics.mode, mode);
    checkDiversity(fallback.candidates);
  }
  state.enabled = false;
  const optedOut = await feed();
  assert.equal(optedOut.trackingEnabled, false);
  assert.deepEqual(optedOut.diagnostics, { mode: 'personalization_disabled', qualifiedCount: null, threshold: 50 });
  state.enabled = true;
  state.resetAt = new Date();
  state.qualified = 0;
  assert.equal((await feed()).diagnostics.mode, 'cold_start');
});

test('a small catalogue can replay recent reels once in a new session and terminates when exhausted', async () => {
  const { state, feed } = fixture();
  state.reels.splice(3);
  state.served = state.reels.map((reel) => reel.id);
  const first = await feed();
  assert.equal(first.candidates.length, 3);
  const next = await feed({ excludeReelIds: first.candidates.map((item) => item.reelId) });
  assert.deepEqual(next.candidates, []);
});
