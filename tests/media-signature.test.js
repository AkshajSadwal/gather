const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detectMediaType, matchesDeclaredMediaType } = require('../backend/src/utils/mediaSignature');

test('upload signature validation recognizes supported formats and rejects MIME spoofing', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00]);
  assert.equal(detectMediaType(jpeg), 'image/jpeg');
  assert.equal(detectMediaType(png), 'image/png');
  assert.equal(detectMediaType(webm), 'video/webm');
  assert.equal(matchesDeclaredMediaType(jpeg, 'image/jpeg'), true);
  assert.equal(matchesDeclaredMediaType(jpeg, 'image/png'), false);
  assert.equal(detectMediaType(Buffer.from('not media')), null);
});
