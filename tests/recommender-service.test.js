const { test } = require('node:test');
const assert = require('node:assert/strict');
const { recommend } = require('../backend/src/services/recommender/modelService');
const { isReelEligible, applyModelRanking } = require('../backend/src/services/recommender/rankingPolicy');

const schemaFingerprint = 'cd94509ad053c55cb973f5dea69546900e3c6d35fc15e90d7308fdbfb46ab82a';

test('model service accepts only the configured Gather feature contract', async () => {
  const previous = {
    url: process.env.REELS_RECOMMENDER_URL,
    token: process.env.REELS_RECOMMENDER_TOKEN,
    fingerprint: process.env.REELS_RECOMMENDER_SCHEMA_FINGERPRINT,
    fetch: global.fetch
  };
  process.env.REELS_RECOMMENDER_URL = 'http://localhost:8100';
  process.env.REELS_RECOMMENDER_TOKEN = 'test-token';
  process.env.REELS_RECOMMENDER_SCHEMA_FINGERPRINT = schemaFingerprint;
  let requestOptions;
  global.fetch = async (_url, options) => {
    requestOptions = options;
    return { ok: true, json: async () => ({ status: 'READY', mode: 'kuairand_zero_shot_v1', trainingDomain: 'KuaiRand-1K', featureSchemaVersion: 'gather-reco-v1', featureSchemaFingerprint: schemaFingerprint, items: [] }) };
  };
  try {
    const result = await recommend({ requestId: 'request-1', candidates: [] });
    assert.equal(result.status, 'READY');
    assert.equal(requestOptions.headers.authorization, 'Bearer test-token');
    assert.equal(JSON.parse(requestOptions.body).featureSchemaFingerprint, schemaFingerprint);
    global.fetch = async () => ({ ok: true, json: async () => ({ status: 'READY', mode: 'kuairand_zero_shot_v1', trainingDomain: 'KuaiRand-1K', featureSchemaVersion: 'gather-reco-v1', featureSchemaFingerprint: 'wrong', items: [] }) });
    assert.equal(await recommend({ requestId: 'request-2', candidates: [] }), null);
    global.fetch = async () => ({ ok: true, json: async () => ({ status: 'READY', mode: 'gather_v1', trainingDomain: 'Gather', featureSchemaVersion: 'gather-reco-v1', featureSchemaFingerprint: schemaFingerprint, items: [] }) });
    assert.equal(await recommend({ requestId: 'request-3', candidates: [] }), null);
    global.fetch = async () => ({ ok: false, status: 503, json: async () => ({ detail: { status: 'COLD_START' } }) });
    assert.equal(await recommend({ requestId: 'request-4', candidates: [] }), null);
    global.fetch = async () => { const error = new Error('timed out'); error.name = 'AbortError'; throw error; };
    assert.equal(await recommend({ requestId: 'request-5', candidates: [] }), null);
  } finally {
    global.fetch = previous.fetch;
    for (const [name, value] of [['REELS_RECOMMENDER_URL', previous.url], ['REELS_RECOMMENDER_TOKEN', previous.token], ['REELS_RECOMMENDER_SCHEMA_FINGERPRINT', previous.fingerprint]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test('privacy policy filters blocked, muted, private and archived reels before ranking', () => {
  const blockedIds = new Set(['blocked-author', 'muted-author']);
  const followedIds = new Set(['private-followed']);
  const affinity = new Map();
  const eligible = (reel) => isReelEligible(reel, {
    userId: 'viewer', hiddenIds: blockedIds, followedIds, personalizationEnabled: true, affinity
  });
  const reel = (authorId, visibility = 'PUBLIC', archivedAt = null) => ({
    authorId, post: { archivedAt }, author: { profile: { visibility } }
  });

  assert.equal(eligible(reel('blocked-author')), false);
  assert.equal(eligible(reel('muted-author')), false);
  assert.equal(eligible(reel('private-owner', 'PRIVATE')), false);
  assert.equal(eligible(reel('private-followed', 'PRIVATE')), true);
  assert.equal(eligible(reel('viewer', 'PRIVATE')), true);
  assert.equal(eligible(reel('public-author', 'PUBLIC', new Date())), false);
});

test('model ranking can only reorder eligible IDs and preserves source labels', () => {
  const pool = [
    { reelId: 'reel-affinity', creatorId: 'creator-a', candidateSource: 'AFFINITY' },
    { reelId: 'reel-following', creatorId: 'creator-b', candidateSource: 'FOLLOWING' }
  ];
  const ranked = applyModelRanking(pool, {
    status: 'READY',
    items: [
      { reelId: 'reel-following', rankingScore: 0.9, retrievalScore: 0.2 },
      { reelId: 'reel-affinity', rankingScore: 0.7, retrievalScore: 'invalid' }
    ]
  });
  assert.deepEqual(ranked.map((item) => item.reelId), ['reel-following', 'reel-affinity']);
  assert.equal(ranked[0].candidateSource, 'FOLLOWING');
  assert.equal(ranked[1].candidateSource, 'AFFINITY');
  assert.equal(ranked[1].retrievalScore, null);
  assert.equal(applyModelRanking(pool, { status: 'READY', items: [{ reelId: 'invented-reel', rankingScore: 1.0 }] }), null);
  assert.equal(applyModelRanking(pool, { status: 'READY', items: [{ reelId: 'reel-following', rankingScore: 0.9 }] }), null);
  assert.equal(applyModelRanking(pool, { status: 'READY', items: [{ reelId: 'reel-following', rankingScore: 0.9 }, { reelId: 'reel-following', rankingScore: 0.8 }] }), null);
  assert.equal(applyModelRanking(pool, { status: 'COLD_START', items: [] }), null);
});
