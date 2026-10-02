process.env.AUTH_SECRET ||= 'unit-test-secret-that-must-never-be-used-in-production';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const backendRequire = createRequire(path.resolve(__dirname, '../backend/package.json'));
const { encode } = backendRequire('@auth/core/jwt');
const { normalizeEmail, normalizeUsername, validUsername } = require('../backend/src/utils/normalize');
const { identify } = require('../backend/src/services/storage');
const { sessionUserFromCookie, SESSION_COOKIE_NAME } = require('../backend/src/middleware/auth');
const { MediasoupService } = require('../backend/src/services/mediasoupService');

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

test('backend accepts only the active Auth.js session cookie and its subject', async () => {
  const name = SESSION_COOKIE_NAME;
  const token = await encode({ token: { sub: 'user-unit-1', email: 'unit@example.test' }, secret: process.env.AUTH_SECRET, salt: name, maxAge: 3600 });
  const valid = await sessionUserFromCookie(`${name}=${encodeURIComponent(token)}`);
  assert.equal(valid.id, 'user-unit-1');
  assert.equal(await sessionUserFromCookie(`${name}=not-a-token`), null);
  assert.equal(await sessionUserFromCookie(`${name}=%E0%A4%A`), null);

  const expired = await encode({ token: { sub: 'user-unit-2' }, secret: process.env.AUTH_SECRET, salt: name, maxAge: -120 });
  assert.equal(await sessionUserFromCookie(`${name}=${encodeURIComponent(expired)}`), null);

  // Legacy cookie names must never be accepted. This is the regression case
  // for cross-account identity confusion caused by stale cookies.
  const legacyName = name === 'authjs.session-token' ? 'next-auth.session-token' : 'authjs.session-token';
  const legacyToken = await encode({ token: { sub: 'wrong-user' }, secret: process.env.AUTH_SECRET, salt: legacyName, maxAge: 3600 });
  assert.equal(await sessionUserFromCookie(`${legacyName}=${encodeURIComponent(legacyToken)}`), null);

  // Even if a stale legacy cookie and the current cookie are both present,
  // the active cookie remains the only identity source.
  const activeToken = await encode({ token: { sub: 'right-user' }, secret: process.env.AUTH_SECRET, salt: name, maxAge: 3600 });
  const mixedCookies = `${legacyName}=${encodeURIComponent(legacyToken)}; ${name}=${encodeURIComponent(activeToken)}`;
  const mixed = await sessionUserFromCookie(mixedCookies);
  assert.equal(mixed.id, 'right-user');
});

test('mediasoup worker creates one room with deduplicated send and receive transports and closes cleanly', async () => {
  const config = { workerCount: 1, rtcMinPort: 41040, rtcMaxPort: 41100, listenIp: '127.0.0.1', enableUdp: true, enableTcp: true, preferUdp: true };
  const io = { to: () => ({ emit: () => {} }) };
  const service = new MediasoupService({ io, config });
  try {
    await service.ready;
    const [room, duplicateRoom] = await Promise.all([service.getOrCreateRoom('unit-call'), service.getOrCreateRoom('unit-call')]);
    assert.equal(room, duplicateRoom);
    assert.ok(room.router.rtpCapabilities.codecs.some((codec) => codec.mimeType === 'audio/opus'));
    const peer = room.getOrCreatePeer('unit-user', 'unit-socket');
    const [send, duplicateSend, receive] = await Promise.all([
      peer.createTransport(room.router, 'unit-call', 'send', config),
      peer.createTransport(room.router, 'unit-call', 'send', config),
      peer.createTransport(room.router, 'unit-call', 'recv', config)
    ]);
    assert.equal(send, duplicateSend);
    assert.notEqual(send.id, receive.id);
    assert.equal(send.appData.direction, 'send');
    assert.equal(receive.appData.direction, 'recv');
    assert.ok(send.iceParameters.usernameFragment);
    await service.closeRoom('unit-call');
    assert.equal(service.rooms.has('unit-call'), false);
    assert.equal(room.closed, true);
  } finally {
    await service.close();
  }
});
