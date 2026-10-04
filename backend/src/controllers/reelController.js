const prisma = require('../config/prisma');
const { HttpError, ok } = require('../utils/http');
const { persistUpload, removeLocal } = require('../services/storage');
const { getBlockedUserIds } = require('../services/blocks');

async function list(req, res) {
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 30);
  const blockedIds = await getBlockedUserIds(req.user?.id);
  const relationships = req.user?.id ? await prisma.follow.findMany({ where: { followerId: req.user.id }, select: { followedId: true, accepted: true } }) : [];
  const relationshipByAuthor = new Map(relationships.map((relation) => [relation.followedId, relation]));
  const visibleAuthorIds = [...(req.user?.id ? [req.user.id] : []), ...relationships.filter((item) => item.accepted).map((item) => item.followedId)].filter((id) => !blockedIds.includes(id));
  const visibilityFilters = [{ authorId: { notIn: blockedIds }, author: { is: { profile: { is: { visibility: 'PUBLIC' } } } } }];
  if (visibleAuthorIds.length) visibilityFilters.push({ authorId: { in: visibleAuthorIds } });
  const reels = await prisma.reel.findMany({ where: { OR: visibilityFilters }, orderBy: { createdAt: 'desc' }, take: limit + 1, ...(req.query.cursor ? { cursor: { id: String(req.query.cursor) }, skip: 1 } : {}), include: { author: { select: { id: true, username: true, image: true, profile: { select: { displayName: true } } } }, media: true, post: { include: { _count: { select: { likes: true, comments: true } }, likes: { where: { userId: req.user?.id || '__visitor__' }, select: { id: true }, take: 1 }, bookmarks: { where: { userId: req.user?.id || '__visitor__' }, select: { id: true }, take: 1 } } } } });
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
      return tx.reel.create({ data: { authorId: req.user.id, postId: post.id, caption, media: { create: { url: media.url, mimeType: media.mimeType, sizeBytes: media.sizeBytes } } }, include: { media: true } });
    });
  } catch (error) { await removeLocal(media.url).catch(() => {}); throw error; }
  const response = { ...reel };
  delete response.authorId;
  return ok(res, { reel: response }, 201);
}

module.exports = { list, create };
