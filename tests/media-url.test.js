const { test } = require('node:test');
const assert = require('node:assert/strict');

const mediaSourceModule = import('../frontend/lib/mediaSource.mjs');

test('missing and whitespace-only media references resolve to no source', async () => {
  const { normalizeMediaSource, resolveMediaUrl } = await mediaSourceModule;
  for (const value of [null, undefined, '', ' ', '\t\n  ']) {
    assert.equal(normalizeMediaSource(value), null);
    assert.equal(resolveMediaUrl(value, 'http://localhost:4000'), null);
  }
});

test('valid media references preserve local, remote, and signed S3 routing', async () => {
  const { resolveMediaUrl } = await mediaSourceModule;
  assert.equal(resolveMediaUrl('  /uploads/photo.jpg  ', 'http://localhost:4000'), 'http://localhost:4000/uploads/photo.jpg');
  assert.equal(resolveMediaUrl(' https://cdn.example.test/photo.jpg ', 'http://localhost:4000'), 'https://cdn.example.test/photo.jpg');
  assert.equal(resolveMediaUrl(' s3://gather-media/posts/photo.jpg ', 'http://localhost:4000'), 'http://localhost:4000/api/media?key=s3%3A%2F%2Fgather-media%2Fposts%2Fphoto.jpg');
});
