const { test } = require('node:test');
const assert = require('node:assert/strict');
const { opaqueId, buildUserFeatureSnapshot, buildReelFeatureSnapshot, mergeForModel } = require('../backend/src/services/recoFeatureSchema');

test('Gather feature builders match manifest fields and hash app IDs', () => {
  const at = new Date('2026-11-12T12:00:00Z');
  const user = buildUserFeatureSnapshot({ userId: 'cuid-user', createdAt: '2025-01-01T00:00:00Z', profileVisibility: 'PUBLIC', followingCount: 12, followerCount: 20, friendCount: null, personalizedRecs: true, features: {}, at });
  const reel = buildReelFeatureSnapshot({ reel: { id: 'cuid-reel', authorId: 'cuid-creator', createdAt: '2026-11-12T10:00:00Z', durationMs: 12000, language: 'en', author: { profile: { visibility: 'PUBLIC' } }, post: { hashtags: [{ hashtag: { tag: 'travel' } }] } }, mediaBytes: 1000, creatorFollowerCount: 10, creatorCreatedAt: '2025-01-01T00:00:00Z', at });
  const model = mergeForModel(user, reel);
  assert.equal(Object.keys(model.categorical).length, 36);
  assert.equal(Object.keys(model.numeric).length, 10);
  assert.ok(Object.hasOwn(model.categorical, "video:creator_id"));
  assert.ok(Object.hasOwn(model.numeric, "log1p_reel_duration_seconds"));
  assert.equal(user.categorical.user_id, opaqueId('viewer', 'cuid-user'));
  assert.notEqual(user.categorical.user_id, 'cuid-user');
  assert.equal(model.numeric.log1p_reel_duration_seconds, Math.log1p(12));
  assert.equal(model.numeric.log1p_user_friend_count, null);
});