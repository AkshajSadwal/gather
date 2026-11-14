const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

test('failed event ingestion keeps the same event ID for a later retry', async () => {
  const sourcePath = path.join(__dirname, '..', 'frontend', 'lib', 'recoTracker.js');
  const originalSource = await readFile(sourcePath, 'utf8');
  const source = originalSource.replace("import { api } from './api';", 'const { api } = globalThis.__gatherRecoTestApi;');
  assert.notEqual(source, originalSource, 'tracker API import should be replaceable for an isolated test');

  const originalWindow = globalThis.window;
  const originalTestApi = globalThis.__gatherRecoTestApi;
  const originalNow = Date.now;
  const attempts = [];
  let shouldFail = true;
  globalThis.window = {
    sessionStorage: { getItem: () => 'session-1', setItem: () => {} },
    setTimeout: () => 1,
    setInterval: () => 1,
    addEventListener: () => {}
  };
  globalThis.__gatherRecoTestApi = {
    api: async (_url, options) => {
      attempts.push(JSON.parse(options.body).events);
      if (shouldFail) throw new Error('temporary ingestion failure');
      return {};
    }
  };

  try {
    const sourceUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
    const tracker = await import(sourceUrl);
    tracker.trackReelEvent({ eventId: 'event-stable', type: 'WATCH_START', reelId: 'reel-1', impressionId: 'impression-1' });
    assert.equal(await tracker.flushRecoEvents(), false);
    Date.now = () => originalNow() + 6000;
    shouldFail = false;
    assert.equal(await tracker.flushRecoEvents(), true);
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0][0].eventId, 'event-stable');
    assert.equal(attempts[1][0].eventId, 'event-stable');
  } finally {
    Date.now = originalNow;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalTestApi === undefined) delete globalThis.__gatherRecoTestApi;
    else globalThis.__gatherRecoTestApi = originalTestApi;
  }
});
