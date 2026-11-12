const { createHash } = require('node:crypto');

const FEATURE_SCHEMA_VERSION = 'gather-reco-v1';
const MISSING = '__MISSING__';

function opaqueId(kind, id) {
  return createHash('sha256').update(`gather-reco-v1:${kind}:${id}`).digest('hex').slice(0, 32);
}

function bucket(value, cuts, labels) {
  if (!Number.isFinite(value) || value < 0) return MISSING;
  for (let i = 0; i < cuts.length; i += 1) if (value <= cuts[i]) return labels[i];
  return labels[labels.length - 1];
}

function log1p(value) {
  return Number.isFinite(value) && value >= 0 ? Math.log1p(value) : null;
}

function rateBucket(value) {
  if (!Number.isFinite(value) || value < 0) return MISSING;
  if (value === 0) return 'none';
  if (value < 0.05) return 'low';
  if (value < 0.2) return 'medium';
  return 'high';
}

function utcHour(date) {
  const hour = date.getUTCHours();
  const angle = 2 * Math.PI * hour / 24;
  return [Math.sin(angle), Math.cos(angle)];
}

function buildUserFeatureSnapshot({ userId, createdAt, profileVisibility, followingCount, followerCount, friendCount, personalizedRecs, features, at = new Date(), tab = 'REELS' }) {
  const d24 = features?.['24h'] || {};
  const d7 = features?.['7d'] || {};
  const d30 = features?.['30d'] || {};
  const userDays = createdAt ? Math.max(0, (at.getTime() - new Date(createdAt).getTime()) / 86400000) : null;
  const age = Number.isFinite(userDays) ? userDays : null;
  const hashtags = d30.topHashtags || d7.topHashtags || [];
  const languages = d30.topLanguages || d7.topLanguages || [];
  const creatorScore = Number(d24.topCreators?.[0]?.score ?? d7.topCreators?.[0]?.score);
  const [hourSin, hourCos] = utcHour(at);
  const categorical = {
    user_id: opaqueId('viewer', userId), tab,
    'user:account_age_bucket': bucket(age, [7, 30, 180, 730], ['0_7d', '8_30d', '31_180d', '181_730d', '730d_plus']),
    'user:following_count_bucket': bucket(followingCount, [0, 4, 19, 99], ['0', '1_4', '5_19', '20_99', '100_plus']),
    'user:follower_count_bucket': bucket(followerCount, [0, 4, 19, 99], ['0', '1_4', '5_19', '20_99', '100_plus']),
    'user:friend_count_bucket': bucket(friendCount, [0, 4, 19, 99], ['0', '1_4', '5_19', '20_99', '100_plus']),
    'user:recent_watch_bucket': bucket(Number(d24.averageWatchMs || 0) / 1000, [0, 3, 10, 30], ['0', '1_3s', '4_10s', '11_30s', '30s_plus']),
    'user:completion_bucket': rateBucket(Number(d7.completionRate || 0)),
    'user:like_rate_bucket': rateBucket(Number(d30.likeRate || 0)),
    'user:save_rate_bucket': rateBucket(Number(d30.saveRate || 0)),
    'user:share_rate_bucket': rateBucket(Number(d30.shareRate || 0)),
    'user:negative_feedback_bucket': bucket(Number(d30.recentNegativeCount || 0), [0, 1, 4, 9], ['0', '1', '2_4', '5_9', '10_plus']),
    'user:profile_visibility': profileVisibility || MISSING,
    'user:personalization_state': personalizedRecs ? 'ENABLED' : 'DISABLED',
    'user:recent_creator_engagement_bucket': bucket(creatorScore, [0, 0.5, 2, 5], ['none', 'low', 'medium', 'high', 'very_high'])
  };
  for (let i = 1; i <= 10; i += 1) categorical[`user:topic_preference_${i}`] = hashtags[i - 1]?.tag || MISSING;
  for (let i = 1; i <= 3; i += 1) categorical[`user:language_preference_${i}`] = languages[i - 1]?.language || MISSING;
  const numeric = {
    hour_sin_utc: hourSin, hour_cos_utc: hourCos,
    log1p_user_following_count: log1p(followingCount),
    log1p_user_follower_count: log1p(followerCount),
    log1p_user_friend_count: log1p(friendCount),
    log1p_user_account_age_days: log1p(age)
  };
  return { schemaVersion: FEATURE_SCHEMA_VERSION, categorical, numeric };
}

function buildReelFeatureSnapshot({ reel, mediaBytes = null, creatorFollowerCount = null, creatorCreatedAt = null, at = new Date() }) {
  const tags = (reel.post?.hashtags || []).map((row) => row.hashtag?.tag).filter(Boolean).map((tag) => tag.toLowerCase()).sort();
  const durationSeconds = reel.durationMs > 0 ? reel.durationMs / 1000 : null;
  const ageHours = Math.max(0, (at.getTime() - new Date(reel.createdAt).getTime()) / 3600000);
  const creatorAgeDays = creatorCreatedAt ? Math.max(0, (at.getTime() - new Date(creatorCreatedAt).getTime()) / 86400000) : null;
  const categorical = {
    reel_id: opaqueId('reel', reel.id),
    'video:creator_id': opaqueId('creator', reel.authorId),
    'video:topic': tags[0] || MISSING,
    'video:language': reel.language || MISSING,
    'video:duration_bucket': bucket(durationSeconds, [3, 10, 30, 60], ['0_3s', '4_10s', '11_30s', '31_60s', '60s_plus']),
    'video:hashtag_group': tags.slice(0, 3).join('|') || MISSING,
    'video:creator_age_bucket': bucket(creatorAgeDays, [7, 30, 180, 730], ['0_7d', '8_30d', '31_180d', '181_730d', '730d_plus']),
    'video:creator_visibility': reel.author?.profile?.visibility || MISSING
  };
  const numeric = {
    log1p_reel_duration_seconds: log1p(durationSeconds),
    log1p_reel_age_hours: log1p(ageHours),
    log1p_creator_follower_count: log1p(creatorFollowerCount),
    log1p_reel_media_bytes: log1p(mediaBytes)
  };
  return { schemaVersion: FEATURE_SCHEMA_VERSION, categorical, numeric };
}

function mergeForModel(userSnapshot, reelSnapshot) {
  return {
    schemaVersion: FEATURE_SCHEMA_VERSION,
    categorical: { ...userSnapshot.categorical, ...reelSnapshot.categorical },
    numeric: { ...userSnapshot.numeric, ...reelSnapshot.numeric }
  };
}

module.exports = { FEATURE_SCHEMA_VERSION, MISSING, opaqueId, bucket, buildUserFeatureSnapshot, buildReelFeatureSnapshot, mergeForModel };
