const prisma = require('../config/prisma');
const { HttpError, ok } = require('../utils/http');
const { persistUpload, removeLocal } = require('../services/storage');
const { getBlockedUserIds } = require('../services/blocks');
const { mutedIdsFor } = require('../services/relations');
const recommender = require('../services/recommender');
const { randomUUID } = require('node:crypto');
const { buildUserFeatureSnapshot, buildReelFeatureSnapshot, mergeForModel } = require('../services/recoFeatureSchema');

async function list(req, res) {
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 30);
  const blockedIds = await getBlockedUserIds(req.user?.id);
  const hiddenIds = [...new Set([...blockedIds, ...await mutedIdsFor(req.user?.id)])];
  const relationships = req.user?.id ? await prisma.follow.findMany({ where: { followerId: req.user.id }, select: { followedId: true, accepted: true } }) : [];
  const relationshipByAuthor = new Map(relationships.map((relation) => [relation.followedId, relation]));
  const visibleAuthorIds = [...(req.user?.id ? [req.user.id] : []), ...relationships.filter((item) => item.accepted).map((item) => item.followedId)].filter((id) => !hiddenIds.includes(id));
  const visibilityFilters = [{ authorId: { notIn: hiddenIds }, author: { is: { profile: { is: { visibility: 'PUBLIC' } } } } }];
  if (visibleAuthorIds.length) visibilityFilters.push({ authorId: { in: visibleAuthorIds } });
  const reels = await prisma.reel.findMany({ where: { OR: visibilityFilters, AND: [{ OR: [{ post: { is: { archivedAt: null } } }, { post: { is: null } }] }] }, orderBy: { createdAt: 'desc' }, take: limit + 1, ...(req.query.cursor ? { cursor: { id: String(req.query.cursor) }, skip: 1 } : {}), include: { author: { select: { id: true, username: true, image: true, profile: { select: { displayName: true } } } }, media: true, post: { include: { _count: { select: { likes: true, comments: true } }, likes: { where: { userId: req.user?.id || '__visitor__' }, select: { id: true }, take: 1 }, bookmarks: { where: { userId: req.user?.id || '__visitor__' }, select: { id: true }, take: 1 } } } } });
  const hasMore = reels.length > limit;
  if (hasMore) reels.pop();
  return ok(res, { reels: reels.map((reel) => ({ ...reel, isFollowing: !!relationshipByAuthor.get(reel.authorId)?.accepted, isFollowPending: relationshipByAuthor.get(reel.authorId)?.accepted === false, post: reel.post ? { ...reel.post, isLiked: !!reel.post.likes.length, isBookmarked: !!reel.post.bookmarks.length, likes: undefined, bookmarks: undefined } : null })), nextCursor: hasMore ? reels.at(-1)?.id : null });
}

async function create(req, res) {
  if (!req.file) throw new HttpError(400, 'MEDIA_REQUIRED', 'Choose a video to create a reel.');
  if (!req.file.mimetype.startsWith('video/')) {
    await require('node:fs/promises').rm(req.file.path, { force: true });
    throw new HttpError(400, 'VIDEO_REQUIRED', 'Reels require a video file.');
  }
  const media = await persistUpload(req.file, 'reels');
  if (media.type !== 'VIDEO') throw new HttpError(400, 'VIDEO_REQUIRED', 'Reels require a video file.');
  const caption = String(req.body.caption || '').trim().slice(0, 2200);
  let reel;
  try {
    reel = await prisma.$transaction(async (tx) => {
      const post = await tx.post.create({ data: { authorId: req.user.id, caption, media: { create: { ...media, position: 0 } } } });
      return tx.reel.create({ data: { authorId: req.user.id, postId: post.id, caption, media: { create: { url: media.url, objectKey: media.objectKey, mimeType: media.mimeType, sizeBytes: media.sizeBytes } } }, include: { media: true } });
    });
  } catch (error) { await removeLocal(media.url).catch(() => {}); throw error; }
  const response = { ...reel };
  delete response.authorId;
  return ok(res, { reel: response }, 201);
}

async function feed(req, res) {
  const size = Math.min(Math.max(Number(req.query.size) || 10, 1), 20);
  const sessionId = String(req.query.sessionId || randomUUID()).slice(0, 128);
  const requestId = randomUUID();
  const excludeReelIds = String(req.query.exclude || '').split(',').filter((id) => id.length <= 64).slice(0, 100);
  const { modelVersion, provider, candidates, trackingEnabled } = await recommender.getCandidates({ userId: req.user.id, sessionId, requestId, limit: size, excludeReelIds });
  const servedAt = new Date();
  const reels = candidates.length ? await prisma.reel.findMany({ where: { id: { in: candidates.map((candidate) => candidate.reelId) } }, include: { author: { select: { id: true, username: true, image: true, createdAt: true, profile: { select: { displayName: true, visibility: true } } } }, media: true, post: { include: { _count: { select: { likes: true, comments: true } }, likes: { where: { userId: req.user.id }, select: { id: true }, take: 1 }, bookmarks: { where: { userId: req.user.id }, select: { id: true }, take: 1 }, hashtags: { include: { hashtag: { select: { tag: true } } } } } } } }) : [];
  const reelById = new Map(reels.map((reel) => [reel.id, reel]));
  let safeCandidates = candidates.filter((candidate) => reelById.has(candidate.reelId));
  if (safeCandidates.length) {
    const [blockedIds, mutedIds, acceptedFollows] = await Promise.all([
      getBlockedUserIds(req.user.id), mutedIdsFor(req.user.id),
      prisma.follow.findMany({ where: { followerId: req.user.id, accepted: true }, select: { followedId: true } })
    ]);
    const hidden = new Set([...blockedIds, ...mutedIds]);
    const followed = new Set(acceptedFollows.map((row) => row.followedId));
    safeCandidates = safeCandidates.filter((candidate) => {
      const reel = reelById.get(candidate.reelId);
      return reel && !hidden.has(reel.authorId) && (!reel.post?.archivedAt || reel.authorId === req.user.id) &&
        (reel.author.profile?.visibility !== 'PRIVATE' || reel.authorId === req.user.id || followed.has(reel.authorId));
    });
  }
  if (trackingEnabled) {
    const [userFeature, user, followingCount, followerCount, creatorFollowCounts] = await Promise.all([
      prisma.userRecoFeatures.findUnique({ where: { userId: req.user.id }, select: { features: true } }),
      prisma.user.findUnique({ where: { id: req.user.id }, select: { createdAt: true, personalizedRecs: true, profile: { select: { visibility: true } } } }),
      prisma.follow.count({ where: { followerId: req.user.id, accepted: true } }),
      prisma.follow.count({ where: { followedId: req.user.id, accepted: true } }),
      safeCandidates.length ? prisma.follow.groupBy({ by: ['followedId'], where: { followedId: { in: [...new Set(safeCandidates.map((candidate) => candidate.creatorId))] }, accepted: true }, _count: { _all: true } }) : []
    ]);
    const userSnapshot = buildUserFeatureSnapshot({ userId: req.user.id, createdAt: user?.createdAt, profileVisibility: user?.profile?.visibility, followingCount, followerCount, friendCount: null, personalizedRecs: user?.personalizedRecs !== false, features: userFeature?.features, at: servedAt });
    const creatorFollowerCount = new Map(creatorFollowCounts.map((row) => [row.followedId, row._count._all]));
    const snapshotsByReel = new Map(safeCandidates.map((candidate) => {
      const reel = reelById.get(candidate.reelId);
      const mediaBytes = reel.media.reduce((sum, media) => sum + (media.sizeBytes || 0), 0);
      const reelSnapshot = buildReelFeatureSnapshot({ reel, mediaBytes, creatorFollowerCount: creatorFollowerCount.get(reel.authorId) || 0, creatorCreatedAt: reel.author.createdAt, at: servedAt });
      return [reel.id, { user: userSnapshot, reel: reelSnapshot, model: mergeForModel(userSnapshot, reelSnapshot) }];
    }));
    await prisma.recommendationRequest.create({ data: {
      id: requestId, userId: req.user.id, sessionId, requestedAt: servedAt, feedSize: safeCandidates.length,
      cursor: typeof req.query.cursor === 'string' ? req.query.cursor.slice(0, 256) : null,
      retrievalModelVersion: provider === 'two_stage_v1' ? modelVersion : null,
      rankingModelVersion: provider === 'two_stage_v1' ? modelVersion : null,
      featureSchemaVersion: 'gather-reco-v1', provider,
      status: safeCandidates.length ? 'OK' : 'EMPTY'
    } });
    if (safeCandidates.length) await prisma.reelImpression.createMany({ data: safeCandidates.map((candidate, position) => ({
      requestId, userId: req.user.id, reelId: candidate.reelId, creatorId: candidate.creatorId,
      sessionId, position, servedAt, candidateSource: candidate.candidateSource,
      retrievalScore: candidate.retrievalScore, rankingScore: candidate.rankingScore, modelVersion,
      retrievalModelVersion: provider === 'two_stage_v1' ? modelVersion : null,
      rankingModelVersion: provider === 'two_stage_v1' ? modelVersion : null,
      featureSchemaVersion: 'gather-reco-v1',
      userFeaturesSnapshot: snapshotsByReel.get(candidate.reelId).user,
      reelFeaturesSnapshot: snapshotsByReel.get(candidate.reelId).reel
    })) });
  }
  if (!safeCandidates.length) return ok(res, { requestId, modelVersion, provider, items: [] });
  if (trackingEnabled) await Promise.all(safeCandidates.map((candidate) => prisma.reelStatsDaily.upsert({
    where: { reelId_day: { reelId: candidate.reelId, day: new Date(Date.UTC(servedAt.getUTCFullYear(), servedAt.getUTCMonth(), servedAt.getUTCDate())) } },
    create: { reelId: candidate.reelId, day: new Date(Date.UTC(servedAt.getUTCFullYear(), servedAt.getUTCMonth(), servedAt.getUTCDate())), impressions: 1 },
    update: { impressions: { increment: 1 } }
  })));
  const impressions = trackingEnabled ? await prisma.reelImpression.findMany({ where: { requestId, userId: req.user.id }, select: { id: true, reelId: true, position: true, candidateSource: true } }) : [];
  const impressionByReel = new Map(impressions.map((item) => [item.reelId, item]));
  const items = safeCandidates.flatMap((candidate) => {
    const reel = reelById.get(candidate.reelId);
    const impression = impressionByReel.get(candidate.reelId);
    if (!reel || (trackingEnabled && !impression)) return [];
    return [{ ...reel, isFollowing: candidate.candidateSource === 'FOLLOWING', isFollowPending: false, post: reel.post ? { ...reel.post, isLiked: !!reel.post.likes.length, isBookmarked: !!reel.post.bookmarks.length, likes: undefined, bookmarks: undefined } : null, ...(impression ? { impressionId: impression.id, position: impression.position, candidateSource: impression.candidateSource } : {}) }];
  });
  return ok(res, { requestId, modelVersion, provider, items });
}

module.exports = { list, create, feed };
