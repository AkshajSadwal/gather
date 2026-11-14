const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRecoController } = require('../backend/src/controllers/recoController');

test('recommendation event batches run sequentially and preserve aggregate results', async () => {
  let active = 0;
  let maxActive = 0;
  const seen = [];
  const controller = createRecoController(async (userId, event, options) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    seen.push([userId, event.eventId, options.allowClientTypes]);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    if (event.eventId === 'duplicate') return { accepted: false, duplicate: true };
    if (event.eventId === 'rejected') return { accepted: false, rejected: true };
    return { accepted: true, duplicate: false };
  });
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };

  await controller.ingestEvents({
    user: { id: 'viewer-1' },
    body: { events: ['accepted', 'duplicate', 'rejected'].map((eventId) => ({ eventId, type: 'WATCH_START', reelId: 'reel-1' })) }
  }, response);

  assert.equal(maxActive, 1);
  assert.deepEqual(seen, [
    ['viewer-1', 'accepted', true],
    ['viewer-1', 'duplicate', true],
    ['viewer-1', 'rejected', true]
  ]);
  assert.deepEqual(response.body.data, { accepted: 1, duplicates: 1, rejected: 1 });
});
