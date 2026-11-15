const { test } = require('node:test');
const assert = require('node:assert/strict');

test('guest invitation requires three distinct active reels and respects dismissal and authentication', async () => {
  const { createGuestReelsInvite } = await import('../frontend/lib/guestReelsInvite.mjs');
  const visit = createGuestReelsInvite();
  assert.equal(visit(null, 'unauthenticated', false), false);
  assert.equal(visit('a', 'unauthenticated', false), false);
  assert.equal(visit('a', 'unauthenticated', false), false);
  assert.equal(visit('b', 'unauthenticated', false), false);
  assert.equal(visit('c', 'authenticated', false), false);
  assert.equal(visit('c', 'unauthenticated', false), true);
  assert.equal(visit('d', 'unauthenticated', true), false);
});
