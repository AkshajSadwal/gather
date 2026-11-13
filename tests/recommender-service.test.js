const { test } = require('node:test');
const assert = require('node:assert/strict');
const { recommend } = require('../backend/src/services/recommender/modelService');

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
    return { ok: true, json: async () => ({ status: 'READY', featureSchemaVersion: 'gather-reco-v1', featureSchemaFingerprint: schemaFingerprint, items: [] }) };
  };
  try {
    const result = await recommend({ requestId: 'request-1', candidates: [] });
    assert.equal(result.status, 'READY');
    assert.equal(requestOptions.headers.authorization, 'Bearer test-token');
    assert.equal(JSON.parse(requestOptions.body).featureSchemaFingerprint, schemaFingerprint);
    global.fetch = async () => ({ ok: true, json: async () => ({ status: 'READY', featureSchemaVersion: 'gather-reco-v1', featureSchemaFingerprint: 'wrong', items: [] }) });
    assert.equal(await recommend({ requestId: 'request-2', candidates: [] }), null);
  } finally {
    global.fetch = previous.fetch;
    for (const [name, value] of [['REELS_RECOMMENDER_URL', previous.url], ['REELS_RECOMMENDER_TOKEN', previous.token], ['REELS_RECOMMENDER_SCHEMA_FINGERPRINT', previous.fingerprint]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
