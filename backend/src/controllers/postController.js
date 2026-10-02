const { z } = require('zod');
const prisma = require('../config/prisma');
const { HttpError, ok } = require('../utils/http');
const { persistUpload, removeLocal } = require('../services/storage');
const { createNotification } = require('../services/notifications');
const { getBlockState, isBlockedBetween, getBlockedUserIds } = require('../services/blocks');

const postInclude = (userId) => ({
  author: { select: { id: true, username: true, image: true, profile: { select: { displayName: true, avatarUrl: true } } } },
  media: { orderBy: { position: 'asc' } },
  hashtags: { include: { hashtag: true } },
  likes: { where: { userId }, select: { id: true }, take: 1 },
  bookmarks: { where: { userId }, select: { id: true }, take: 1 },
  _count: { select: { likes: true, comments: true } }
});

function shapePost(post) {
  return {
    ...post,
    isLiked: post.likes?.length > 0,
    isBookmarked: post.bookmarks?.length > 0,
    likes: undefined,
    bookmarks: undefined
  };
}

async function assertPostVisible(post, userId) {
  if (userId && await isBlockedBetween(userId, post.authorId)) {
    throw new HttpError(403, 'BLOCKED', 'You cannot access this post.');
  }
  const profile = await prisma.profile.findUnique({ where: { userId: post.authorId }, select: { visibility: true } });
  if (profile?.visibility === 'PRIVATE' && post.authorId !== userId) {
    const follow = userId
      ? await prisma.follow.findUnique({
        where: { followerId_followedId: { followerId: userId, followedId: post.authorId } },
        select: { accepted: true }
      })
      : null;
    if (!follow?.accepted) throw new HttpError(403, 'PRIVATE_ACCOUNT', 'Follow this account to view its posts.');
  }
}

async function feed(req, res) {
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 30);
  const blockedIds = await getBlockedUserIds(req.user.id);
  const following = await prisma.follow.findMany({
    where: {
      followerId: req.user.id,
      accepted: true,
      followedId: { notIn: blockedIds }
    },
    select: { followedId: true }
  });
  const authorIds = [...following.map((row) => row.followedId), req.user.id];
  const posts = await prisma.post.findMany({
    where: { authorId: { in: authorIds, notIn: blockedIds } },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(req.query.cursor ? { cursor: { id: String(req.query.cursor) }, skip: 1 } : {}),
    include: postInclude(req.user.id)
  });
  const hasMore = posts.length > limit;
  if (hasMore) posts.pop();
  return ok(res, { posts: posts.map(shapePost), nextCursor: hasMore ? posts.at(-1)?.id : null });
}

async function explore(req, res) {
  const limit = Math.min(Math.max(Number(req.query.limit) || 12, 1), 30);
  const blockedIds = await getBlockedUserIds(req.user?.id);
  const posts = await prisma.post.findMany({
    where: {
      authorId: { notIn: blockedIds },
      author: { is: { profile: { is: { visibility: 'PUBLIC' } } } }
    },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(req.query.cursor ? { cursor: { id: String(req.query.cursor) }, skip: 1 } : {}),
    include: postInclude(req.user?.id || '__visitor__')
  });
  const hasMore = posts.length > limit;
  if (hasMore) posts.pop();
  return ok(res, { posts: posts.map(shapePost), nextCursor: hasMore ? posts.at(-1)?.id : null });
}

async function create(req, res) {
  const body = { caption: String(req.body.caption || '').trim().slice(0, 2200), files: req.files || [] };
  if (!body.files.length) throw new HttpError(400, 'MEDIA_REQUIRED', 'Choose at least one image or video.');
  if (body.files.length > 10) throw new HttpError(400, 'TOO_MANY_FILES', 'A post can contain up to 10 media files.');
  const persisted = [];
  let post;
  try {
    for (const file of body.files) persisted.push(await persistUpload(file));
    const tags = [...new Set((body.caption.match(/#[\p{L}\p{N}_]+/gu) || []).map((tag) => tag.slice(1).toLowerCase()).filter(Boolean))].slice(0, 30);
    post = await prisma.post.create({
      data: {
        authorId: req.user.id,
        caption: body.caption,
        media: { create: persisted.map((item, position) => ({ ...item, position })) },
        hashtags: { create: tags.map((tag) => ({ hashtag: { connectOrCreate: { where: { tag }, create: { tag } } } })) }
      },
      include: postInclude(req.user.id)
    });
  } catch (error) {
    await Promise.all(persisted.map((media) => removeLocal(media.url).catch(() => {})));
    throw error;
  }
  const mentions = [...new Set((body.caption.match(/@([a-zA-Z0-9._]{3,30})/g) || []).map((part) => part.slice(1).toLowerCase()))];
  if (mentions.length) {
    const blockedIds = await getBlockedUserIds(req.user.id);
    const mentioned = await prisma.user.findMany({
      where: { username: { in: mentions }, id: { not: req.user.id, notIn: blockedIds } },
      select: { id: true }
    });
    await Promise.all(mentioned.map((user) => createNotification({ recipientId: user.id, actorId: req.user.id, type: 'MENTION', entityId: post.id })));
  }
  return ok(res, { post: shapePost(post) }, 201);
}

async function detail(req, res) {
  const post = await prisma.post.findUnique({ where: { id: req.params.id }, include: postInclude(req.user?.id || '__visitor__') });
  if (!post) throw new HttpError(404, 'POST_NOT_FOUND', 'That post could not be found.');
  await assertPostVisible(post, req.user?.id);
  return ok(res, { post: shapePost(post) });
}

async function remove(req, res) {
  const post = await prisma.post.findUnique({ where: { id: req.params.id }, select: { id: true, authorId: true, media: { select: { url: true } }, reel: { include: { media: { select: { url: true } } } } } });
  if (!post) throw new HttpError(404, 'POST_NOT_FOUND', 'That post could not be found.');
  if (post.authorId !== req.user.id) throw new HttpError(403, 'FORBIDDEN', 'You can only delete your own posts.');
  await prisma.post.delete({ where: { id: post.id } });
  await Promise.all([...post.media.map((item) => item.url), ...(post.reel?.media.map((item) => item.url) || [])].map((url) => removeLocal(url).catch(() => {})));
  return ok(res, { deleted: true });
}

async function toggleLike(req, res) {
  const post = await prisma.post.findUnique({ where: { id: req.params.id }, select: { id: true, authorId: true } });
  if (!post) throw new HttpError(404, 'POST_NOT_FOUND', 'That post could not be found.');
  await assertPostVisible(post, req.user.id);
  const where = { userId_postId: { userId: req.user.id, postId: post.id } };
  const existing = await prisma.like.findUnique({ where });
  if (existing) {
    await prisma.like.delete({ where: { id: existing.id } });
    return ok(res, { liked: false });
  }
  await prisma.like.create({ data: { userId: req.user.id, postId: post.id } });
  if (post.authorId !== req.user.id) await createNotification({ recipientId: post.authorId, actorId: req.user.id, type: 'LIKE', entityId: post.id });
  return ok(res, { liked: true });
}

async function toggleBookmark(req, res) {
  const post = await prisma.post.findUnique({ where: { id: req.params.id }, select: { id: true, authorId: true } });
  if (!post) throw new HttpError(404, 'POST_NOT_FOUND', 'That post could not be found.');
  await assertPostVisible(post, req.user.id);
  const where = { userId_postId: { userId: req.user.id, postId: post.id } };
  const existing = await prisma.bookmark.findUnique({ where });
  if (existing) {
    await prisma.bookmark.delete({ where: { id: existing.id } });
    return ok(res, { bookmarked: false });
  }
  await prisma.bookmark.create({ data: { userId: req.user.id, postId: post.id } });
  return ok(res, { bookmarked: true });
}

async function listComments(req, res) {
  const post = await prisma.post.findUnique({ where: { id: req.params.id }, select: { id: true, authorId: true } });
  if (!post) throw new HttpError(404, 'POST_NOT_FOUND', 'That post could not be found.');
  await assertPostVisible(post, req.user?.id);
  const comments = await prisma.comment.findMany({ where: { postId: post.id }, orderBy: { createdAt: 'desc' }, take: Math.min(Number(req.query.limit) || 30, 100), include: { user: { select: { id: true, username: true, image: true } } } });
  return ok(res, { comments });
}

async function createComment(req, res) {
  const parsed = z.object({ body: z.string().trim().min(1).max(1000) }).safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Comments must be between 1 and 1000 characters.');
  const post = await prisma.post.findUnique({ where: { id: req.params.id }, select: { id: true, authorId: true } });
  if (!post) throw new HttpError(404, 'POST_NOT_FOUND', 'That post could not be found.');
  await assertPostVisible(post, req.user.id);
  const comment = await prisma.comment.create({ data: { postId: post.id, userId: req.user.id, body: parsed.data.body }, include: { user: { select: { id: true, username: true, image: true } } } });
  if (post.authorId !== req.user.id) await createNotification({ recipientId: post.authorId, actorId: req.user.id, type: 'COMMENT', entityId: post.id });
  return ok(res, { comment }, 201);
}

async function deleteComment(req, res) {
  const comment = await prisma.comment.findUnique({ where: { id: req.params.commentId }, select: { id: true, userId: true } });
  if (!comment) throw new HttpError(404, 'COMMENT_NOT_FOUND', 'That comment could not be found.');
  if (comment.userId !== req.user.id) throw new HttpError(403, 'FORBIDDEN', 'You can only delete your own comments.');
  await prisma.comment.delete({ where: { id: comment.id } });
  return ok(res, { deleted: true });
}

module.exports = { feed, explore, create, detail, remove, toggleLike, toggleBookmark, listComments, createComment, deleteComment, assertPostVisible };
