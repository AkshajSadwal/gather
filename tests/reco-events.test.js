const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  recordReelEvent, setReelEventDependenciesForTests, resetReelEventDependenciesForTests, clientEventSchema
} = require('../backend/src/services/recoEvents');

function fakeEventDatabase({ createCounts = [1], impression = {} } = {}) {
  const calls = { create: 0, update: 0, affinity: 0, stats: 0 };
  const tx = {
    user: { findUnique: async () => ({ personalizedRecs: true }) },
    reel: { findUnique: async ({ where }) => ({
      id: where.id, authorId: 'creator-1', durationMs: 10000, post: { archivedAt: null },
      author: { profile: { visibility: 'PUBLIC' } }
    }) },
    follow: { findUnique: async () => null },
    reelImpression: {
      findUnique: async () => ({
        id: 'imp-1', userId: 'viewer-1', reelId: 'reel-1', requestId: 'req-1', creatorId: 'creator-1',
        seenAt: null, completed: false, visibleMs: 0, watchMs: 0, maxProgressMs: 0, replayCount: 0, videoDurationMs: 10000,
        ...impression
      }),
      update: async () => { calls.update += 1; return {}; }
    },
    reelEvent: {
      createMany: async () => { const count = createCounts[calls.create] ?? 0; calls.create += 1; return { count }; }
    },
    userCreatorAffinity: {
      findUnique: async () => null,
      upsert: async () => { calls.affinity += 1; return {}; }
    },
    reelStatsDaily: { upsert: async () => { calls.stats += 1; return {}; } }
  };
  return { calls, prisma: { $transaction: (callback) => callback(tx) } };
}

const base = { eventId: 'evt-once', type: 'LIKE', reelId: 'reel-1', impressionId: 'imp-1' };

test('duplicate event delivery is idempotent and applies one action update', async () => {
  const db = fakeEventDatabase({ createCounts: [1, 0] });
  setReelEventDependenciesForTests({ prisma: db.prisma, isBlockedBetween: async () => false, mutedIdsFor: async () => [] });
  try {
    assert.deepEqual(await recordReelEvent('viewer-1', base), { accepted: true, duplicate: false });
    assert.deepEqual(await recordReelEvent('viewer-1', base), { accepted: false, duplicate: true });
    assert.deepEqual(db.calls, { create: 2, update: 1, affinity: 1, stats: 1 });
  } finally { resetReelEventDependenciesForTests(); }
});

test('impression ownership and reel relationships reject forged event attribution', async () => {
  for (const overrides of [{ impression: { userId: 'other-viewer' } }, { impression: { reelId: 'other-reel' } }]) {
    const db = fakeEventDatabase(overrides);
    setReelEventDependenciesForTests({ prisma: db.prisma, isBlockedBetween: async () => false, mutedIdsFor: async () => [] });
    try {
      const input = { ...base, reelId: overrides.impression?.reelId === 'other-reel' ? 'reel-1' : base.reelId };
      const result = await recordReelEvent('viewer-1', input);
      assert.equal(result.rejected, true);
      assert.equal(db.calls.create, 0);
    } finally { resetReelEventDependenciesForTests(); }
  }
  const db = fakeEventDatabase();
  setReelEventDependenciesForTests({ prisma: db.prisma, isBlockedBetween: async () => false, mutedIdsFor: async () => [] });
  try {
    const result = await recordReelEvent('viewer-1', { ...base, reelId: 'forged-reel' });
    assert.equal(result.rejected, true);
    assert.equal(db.calls.create, 0);
  } finally { resetReelEventDependenciesForTests(); }
});

test('watch-time event validation rejects negative or unbounded measurements', () => {
  const valid = { eventId: 'evt-watch', type: 'WATCH_PROGRESS', reelId: 'reel-1', impressionId: 'imp-1', payload: { watchMs: 5000, videoDurationMs: 10000 } };
  assert.equal(clientEventSchema.safeParse(valid).success, true);
  assert.equal(clientEventSchema.safeParse({ ...valid, payload: { watchMs: -1 } }).success, false);
  assert.equal(clientEventSchema.safeParse({ ...valid, payload: { watchMs: 3600001 } }).success, false);
});
