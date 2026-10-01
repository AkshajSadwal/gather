process.env.AUTH_SECRET ||= 'unit-test-secret-that-must-never-be-used-in-production';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const backendRequire = createRequire(path.resolve(__dirname, '../backend/package.json'));
const { encode } = backendRequire('@auth/core/jwt');
const { normalizeEmail, normalizeUsername, validUsername } = require('../backend/src/utils/normalize');
const { identify } = require('../backend/src/services/storage');
const { sessionUserFromCookie } = require('../backend/src/middleware/auth');

test('account identifiers normalize consistently and usernames are validated', () => {
  assert.equal(normalizeUsername('  Ｍaya.Name  '), 'maya.name');
  assert.equal(normalizeEmail('  Person@Example.Test '), 'person@example.test');
  assert.equal(validUsername('a.b_123'), true);
  assert.equal(validUsername('ab'), false);
  assert.equal(validUsername('.starting'), false);
  assert.equal(validUsername('double..dot'), false);
});

test('media signature checks recognize supported formats and reject fake image bytes', async () => {
  assert.equal(await identify(Buffer.from([0xff, 0xd8, 0xff, 0x00])), 'image/jpeg');
  assert.equal(await identify(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'image/png');
  assert.equal(await identify(Buffer.from('RIFFxxxxWEBP')), 'image/webp');
  assert.equal(await identify(Buffer.from('000000186674797069736f6d00000000', 'hex')), 'video/mp4');
  assert.equal(await identify(Buffer.from('plain text is not media')), null);
});

test('backend accepts only valid, unexpired Auth.js session cookies', async () => {
  const name = 'authjs.session-token';
  const token = await encode({ token: { sub: 'user-unit-1', email: 'unit@example.test' }, secret: process.env.AUTH_SECRET, salt: name, maxAge: 3600 });
  const valid = await sessionUserFromCookie(`${name}=${encodeURIComponent(token)}`);
  assert.equal(valid.id, 'user-unit-1');
  assert.equal(await sessionUserFromCookie(`${name}=not-a-token`), null);
  const expired = await encode({ token: { sub: 'user-unit-2' }, secret: process.env.AUTH_SECRET, salt: name, maxAge: -120 });
  assert.equal(await sessionUserFromCookie(`${name}=${encodeURIComponent(expired)}`), null);
});
