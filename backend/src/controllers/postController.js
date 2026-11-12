const { z } = require('zod');
const prisma = require('../config/prisma');
const { HttpError, ok } = require('../utils/http');
const { persistUpload, removeLocal } = require('../services/storage');
const { createNotification } = require('../services/notifications');
const { logPostReelEvent } = require('../services/recoEvents');
const { getBlockState, isBlockedBetween, getBlockedUserIds } = require('../services/blocks');
const { blockedIdsFor } = require('../services/relations');
const { deletePostContent } = require('../services/contentService');

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
    throw new HttpError(404, 'POST_NOT_FOUND', 'That post could not be found.');
  }
  if (post.archivedAt && post.authorId !== userId) throw new HttpError(404, 'POST_NOT_FOUND', 'That post could not be found.');
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
  const hiddenIds = [...new Set([...blockedIds, ...await mutedIdsFor(req.user.id)])];
  const following = await prisma.follow.findMany({
    where: {
      followerId: req.user.id,
      accepted: true,
      followedId: { notIn: hiddenIds }
    },
    select: { followedId: true }
  });
  const authorIds = [...following.map((row) => row.followedId), req.user.id];
  const posts = await prisma.post.findMany({
    where: { authorId: { in: authorIds, notIn: hiddenIds }, archivedAt: null },
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
  if (req.query.sort === 'popular') {
    const parsed = z.object({ page: z.coerce.number().int().min(1).max(10).default(1) }).safeParse(req.query);
    if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Choose a popular page from 1 to 10.');
    const blockedIds = await getBlockedUserIds(req.user?.id);
    const hiddenIds = [...new Set([...blockedIds, ...await mutedIdsFor(req.user?.id)])];
    const where = { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, archivedAt: null, authorId: { notIn: hiddenIds }, author: { is: { profile: { is: { visibility: 'PUBLIC' } } } } };
    const [posts, total] = await Promise.all([
      prisma.post.findMany({ where, orderBy: [{ likes: { _count: 'desc' } }, { id: 'desc' }], skip: (parsed.data.page - 1) * 12, take: 12, include: postInclude(req.user?.id || '__visitor__') }),
      prisma.post.count({ where })
    ]);
    return ok(res, { posts: posts.map(shapePost), page: parsed.data.page, totalPages: Math.max(1, Math.min(10, Math.ceil(total / 12))) });
  }
  const limit = Math.min(Math.max(Number(req.query.limit) || 12, 1), 30);
  const blockedIds = await getBlockedUserIds(req.user?.id);
  const hiddenIds = [...new Set([...blockedIds, ...await mutedIdsFor(req.user?.id)])];
  const posts = await prisma.post.findMany({
    where: {
      archivedAt: null,
      authorId: { notIn: hiddenIds },
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
    for (const file of body.files) persisted.push(await persistUpload(file, 'posts'));
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
  const post = await prisma.post.findUnique({ where: { id: req.params.id }, select: { id: true, authorId: true } });
  if (!post) throw new HttpError(404, 'POST_NOT_FOUND', 'That post could not be found.');
  if (post.authorId !== req.user.id) throw new HttpError(403, 'FORBIDDEN', 'You can only delete your own posts.');
  await deletePostContent(post.id);
  return ok(res, { deleted: true });
}

async function archived(req, res) {
  const parsed = z.object({ cursor: z.string().trim().min(1).max(64).optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }).safeParse(req.query);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Choose a valid archive page.');
  const where = { authorId: req.user.id, archivedAt: { not: null } };
  const cursor = parsed.data.cursor ? await prisma.post.findFirst({ where: { ...where, id: parsed.data.cursor }, select: { id: true } }) : null;
  if (parsed.data.cursor && !cursor) throw new HttpError(400, 'INVALID_CURSOR', 'That archive cursor is invalid.');
  const rows = await prisma.post.findMany({ where, orderBy: [{ archivedAt: 'desc' }, { id: 'desc' }], take: parsed.data.limit + 1, ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}), include: postInclude(req.user.id) });
  const hasMore = rows.length > parsed.data.limit;
  if (hasMore) rows.pop();
  return ok(res, { items: rows.map(shapePost), nextCursor: hasMore ? rows.at(-1)?.id || null : null });
}

async function togglePin(req, res) {
  const params = z.object({ id: z.string().trim().min(1).max(64) }).safeParse(req.params);
  const body = z.object({}).strict().safeParse(req.body || {});
  if (!params.success || !body.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Choose a valid post.');
  try {
    const post = await prisma.$transaction(async (tx) => {
      const current = await tx.post.findUnique({ where: { id: params.data.id }, select: { id: true, authorId: true, pinnedAt: true, archivedAt: true } });
      if (!current) throw new HttpError(404, 'POST_NOT_FOUND', 'That post could not be found.');
      if (current.authorId !== req.user.id) throw new HttpError(403, 'FORBIDDEN', 'You can only pin your own posts.');
      if (current.archivedAt) throw new HttpError(409, 'POST_ARCHIVED', 'Unarchive this post before pinning it.');
      let pinnedAt = null;
      if (!current.pinnedAt) {
        const count = await tx.post.count({ where: { authorId: req.user.id, archivedAt: null, pinnedAt: { not: null } } });
        if (count >= 3) throw new HttpError(409, 'PIN_LIMIT', 'You can pin up to three posts to your profile.');
        pinnedAt = new Date();
      }
      return tx.post.update({ where: { id: current.id }, data: { pinnedAt }, include: postInclude(req.user.id) });
    }, { isolationLevel: 'Serializable' });
    return ok(res, { post: shapePost(post), pinned: Boolean(post.pinnedAt) });
  } catch (error) {
    if (error?.code === 'P2034') throw new HttpError(409, 'PIN_LIMIT', 'Your post pins changed at the same time. Please try again.');
    throw error;
  }
}

async function toggleArchive(req, res) {
  const params = z.object({ id: z.string().trim().min(1).max(64) }).safeParse(req.params);
  const body = z.object({}).strict().safeParse(req.body || {});
  if (!params.success || !body.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Choose a valid post.');
  const post = await prisma.post.findUnique({ where: { id: params.data.id }, select: { id: true, authorId: true, archivedAt: true } });
  if (!post) throw new HttpError(404, 'POST_NOT_FOUND', 'That post could not be found.');
  if (post.authorId !== req.user.id) throw new HttpError(403, 'FORBIDDEN', 'You can only archive your own posts.');
  const archiving = !post.archivedAt;
  const updated = await prisma.post.update({ where: { id: post.id }, data: { archivedAt: archiving ? new Date() : null, ...(archiving ? { pinnedAt: null } : {}) }, include: postInclude(req.user.id) });
  return ok(res, { post: shapePost(updated), archived: archiving });
}

async function saved(req, res) {
  const parsed = z.object({ cursor: z.string().trim().min(1).max(64).optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }).safeParse(req.query);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'The saved-post page is invalid.');
  const blockedIds = await getBlockedUserIds(req.user.id);
  const cursor = parsed.data.cursor ? await prisma.bookmark.findFirst({ where: { id: parsed.data.cursor, userId: req.user.id }, select: { id: true } }) : null;
  const rows = await prisma.bookmark.findMany({
    where: { userId: req.user.id, post: { is: { authorId: { notIn: blockedIds }, archivedAt: null } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: parsed.data.limit + 1,
    ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
    include: { post: { include: postInclude(req.user.id) } }
  });
  const hasMore = rows.length > parsed.data.limit;
  if (hasMore) rows.pop();
  const items = [];
  for (const row of rows) {
    try { await assertPostVisible(row.post, req.user.id); items.push({ ...shapePost(row.post), savedAt: row.createdAt }); }
    catch (error) { if (!['POST_NOT_FOUND', 'PRIVATE_ACCOUNT'].includes(error.code)) throw error; }
  }
  return ok(res, { items, nextCursor: hasMore ? rows.at(-1)?.id : null });
}

async function updateCaption(req, res) {
  const parsed = z.object({ caption: z.string().trim().max(2200) }).strict().safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Captions must be 2200 characters or fewer.');
  const current = await prisma.post.findUnique({ where: { id: req.params.id }, select: { id: true, authorId: true, caption: true, reel: { select: { id: true } } } });
  if (!current) throw new HttpError(404, 'POST_NOT_FOUND', 'That post could not be found.');
  if (current.authorId !== req.user.id) throw new HttpError(403, 'FORBIDDEN', 'You can only edit your own posts.');
  const caption = parsed.data.caption;
  const oldMentions = new Set((current.caption.match(/@([a-zA-Z0-9._]{3,30})/g) || []).map((item) => item.slice(1).toLowerCase()));
  const mentions = [...new Set((caption.match(/@([a-zA-Z0-9._]{3,30})/g) || []).map((item) => item.slice(1).toLowerCase()))].filter((username) => !oldMentions.has(username));
  const tags = [...new Set((caption.match(/#[\p{L}\p{N}_]+/gu) || []).map((tag) => tag.slice(1, 101).toLowerCase()).filter(Boolean))].slice(0, 30);
  const updated = await prisma.$transaction(async (tx) => {
    await tx.postHashtag.deleteMany({ where: { postId: current.id } });
    if (tags.length) {
      const hashtags = await Promise.all(tags.map((tag) => tx.hashtag.upsert({ where: { tag }, create: { tag }, update: {} })));
      await tx.postHashtag.createMany({ data: hashtags.map((hashtag) => ({ postId: current.id, hashtagId: hashtag.id })) });
    }
    const post = await tx.post.update({ where: { id: current.id }, data: { caption }, include: postInclude(req.user.id) });
    if (current.reel) await tx.reel.update({ where: { id: current.reel.id }, data: { caption } });
    return post;
  });
  if (mentions.length) {
    const mentioned = await prisma.user.findMany({ where: { username: { in: mentions }, id: { not: req.user.id } }, select: { id: true } });
    await Promise.all(mentioned.map((user) => createNotification({ recipientId: user.id, actorId: req.user.id, type: 'MENTION', entityId: current.id })));
  }
  return ok(res, { post: shapePost(updated) });
}

async function toggleLike(req, res) {
  const post = await prisma.post.findUnique({ where: { id: req.params.id }, select: { id: true, authorId: true, archivedAt: true } });
  if (!post) throw new HttpError(404, 'POST_NOT_FOUND', 'That post could not be found.');
  await assertPostVisible(post, req.user.id);
  const where = { userId_postId: { userId: req.user.id, postId: post.id } };
  const existing = await prisma.like.findUnique({ where });
  if (existing) {
    logPostReelEvent(req.user.id, post.id, 'UNLIKE', { impressionId: req.get('x-reco-impression-id') || undefined });
    await prisma.like.delete({ where: { id: existing.id } });
    await prisma.notification.deleteMany({
      where: { recipientId: post.authorId, actorId: req.user.id, type: 'LIKE', entityId: post.id }
    });
    return ok(res, { liked: false });
  }
  await prisma.like.create({ data: { userId: req.user.id, postId: post.id } });
  logPostReelEvent(req.user.id, post.id, 'LIKE', { impressionId: req.get('x-reco-impression-id') || undefined });
  if (post.authorId !== req.user.id) await createNotification({ recipientId: post.authorId, actorId: req.user.id, type: 'LIKE', entityId: post.id });
  return ok(res, { liked: true });
}

async function toggleBookmark(req, res) {
  const post = await prisma.post.findUnique({ where: { id: req.params.id }, select: { id: true, authorId: true, archivedAt: true } });
  if (!post) throw new HttpError(404, 'POST_NOT_FOUND', 'That post could not be found.');
  await assertPostVisible(post, req.user.id);
  const where = { userId_postId: { userId: req.user.id, postId: post.id } };
  const existing = await prisma.bookmark.findUnique({ where });
  if (existing) {
    logPostReelEvent(req.user.id, post.id, 'UNSAVE', { impressionId: req.get('x-reco-impression-id') || undefined });
    await prisma.bookmark.delete({ where: { id: existing.id } });
    return ok(res, { bookmarked: false });
  }
  await prisma.bookmark.create({ data: { userId: req.user.id, postId: post.id } });
  logPostReelEvent(req.user.id, post.id, 'SAVE', { impressionId: req.get('x-reco-impression-id') || undefined });
  return ok(res, { bookmarked: true });
}

async function listComments(req, res) {
  const post = await prisma.post.findUnique({ where: { id: req.params.id }, select: { id: true, authorId: true, archivedAt: true } });
  if (!post) throw new HttpError(404, 'POST_NOT_FOUND', 'That post could not be found.');
  await assertPostVisible(post, req.user?.id);
  const blockedIds = await blockedIdsFor(req.user?.id);
  const parsed = z.object({ cursor: z.string().trim().min(1).max(64).optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }).safeParse(req.query);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'The comment page is invalid.');
  const cursor = parsed.data.cursor ? await prisma.comment.findFirst({ where: { id: parsed.data.cursor, postId: post.id, parentId: null, userId: { notIn: blockedIds } }, select: { id: true } }) : null;
  const rows = await prisma.comment.findMany({
    where: { postId: post.id, parentId: null, userId: { notIn: blockedIds } },
    orderBy: [{ pinnedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }, { id: 'desc' }],
    take: parsed.data.limit + 1,
    ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
    include: { user: { select: { id: true, username: true, image: true } }, likes: { where: { userId: req.user?.id || '__visitor__' }, select: { id: true }, take: 1 }, _count: { select: { likes: true, replies: { where: { userId: { notIn: blockedIds } } } } } }
  });
  const hasMore = rows.length > parsed.data.limit;
  if (hasMore) rows.pop();
  const comments = rows.map(({ likes, _count, ...comment }) => ({ ...comment, _count: { replies: _count.replies }, likeCount: _count.likes, likedByMe: likes.length > 0 }));
  return ok(res, { comments, nextCursor: hasMore ? rows.at(-1)?.id : null });
}

async function listReplies(req, res) {
  const parent = await prisma.comment.findUnique({ where: { id: req.params.commentId }, select: { id: true, postId: true, parentId: true, post: { select: { id: true, authorId: true, archivedAt: true } } } });
  if (!parent || parent.parentId) throw new HttpError(404, 'COMMENT_NOT_FOUND', 'That comment could not be found.');
  await assertPostVisible(parent.post, req.user?.id);
  const blockedIds = await blockedIdsFor(req.user?.id);
  const parsed = z.object({ cursor: z.string().trim().min(1).max(64).optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }).safeParse(req.query);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'The replies page is invalid.');
  const cursor = parsed.data.cursor ? await prisma.comment.findFirst({ where: { id: parsed.data.cursor, parentId: parent.id, userId: { notIn: blockedIds } }, select: { id: true } }) : null;
  const rows = await prisma.comment.findMany({
    where: { parentId: parent.id, userId: { notIn: blockedIds } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: parsed.data.limit + 1,
    ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
    include: { user: { select: { id: true, username: true, image: true } }, likes: { where: { userId: req.user?.id || '__visitor__' }, select: { id: true }, take: 1 }, _count: { select: { likes: true } } }
  });
  const hasMore = rows.length > parsed.data.limit;
  if (hasMore) rows.pop();
  const replies = rows.map(({ likes, _count, ...comment }) => ({ ...comment, likeCount: _count.likes, likedByMe: likes.length > 0 }));
  return ok(res, { replies, nextCursor: hasMore ? rows.at(-1)?.id : null });
}

async function createComment(req, res) {
  const parsed = z.object({ body: z.string().trim().min(1).max(1000), parentId: z.string().trim().min(1).max(64).optional() }).safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Comments must be between 1 and 1000 characters.');
  const post = await prisma.post.findUnique({ where: { id: req.params.id }, select: { id: true, authorId: true, archivedAt: true } });
  if (!post) throw new HttpError(404, 'POST_NOT_FOUND', 'That post could not be found.');
  await assertPostVisible(post, req.user.id);
  let parent = null;
  if (parsed.data.parentId) {
    parent = await prisma.comment.findFirst({ where: { id: parsed.data.parentId, postId: post.id, parentId: null }, select: { id: true, userId: true } });
    if (!parent) throw new HttpError(404, 'COMMENT_NOT_FOUND', 'That comment could not be found.');
  }
  const comment = await prisma.comment.create({ data: { postId: post.id, userId: req.user.id, body: parsed.data.body, ...(parent ? { parentId: parent.id } : {}) }, include: { user: { select: { id: true, username: true, image: true } }, _count: { select: { replies: true, likes: true } } } });
  logPostReelEvent(req.user.id, post.id, 'COMMENT', { impressionId: req.get('x-reco-impression-id') || undefined });
  comment.likeCount = comment._count.likes; comment.likedByMe = false;
  const notificationTypes = new Map();
  const queueNotification = (recipientId, type) => { if (recipientId && recipientId !== req.user.id && !notificationTypes.has(recipientId)) notificationTypes.set(recipientId, type); };
  if (parent) queueNotification(parent.userId, 'REPLY');
  queueNotification(post.authorId, 'COMMENT');
  const mentions = [...new Set((parsed.data.body.match(/@([a-zA-Z0-9._]{3,30})/g) || []).map((part) => part.slice(1).toLowerCase()))];
  if (mentions.length) {
    const users = await prisma.user.findMany({ where: { username: { in: mentions }, id: { not: req.user.id } }, select: { id: true } });
    for (const user of users) queueNotification(user.id, 'MENTION');
  }
  await Promise.all([...notificationTypes].map(([recipientId, type]) => createNotification({ recipientId, actorId: req.user.id, type, entityId: post.id })));
  return ok(res, { comment }, 201);
}

async function deleteComment(req, res) {
  const comment = await prisma.comment.findUnique({ where: { id: req.params.commentId }, select: { id: true, userId: true, post: { select: { id: true, authorId: true, archivedAt: true } } } });
  if (!comment) throw new HttpError(404, 'COMMENT_NOT_FOUND', 'That comment could not be found.');
  await assertPostVisible(comment.post, req.user.id);
  if (comment.userId !== req.user.id && comment.post.authorId !== req.user.id) throw new HttpError(403, 'FORBIDDEN', 'You can only delete comments on your own posts.');
  await prisma.comment.delete({ where: { id: comment.id } });
  return ok(res, { deleted: true });
}

async function toggleCommentLike(req, res) {
  const parsedId = z.string().trim().min(1).max(64).safeParse(req.params.commentId);
  if (!parsedId.success) throw new HttpError(400, 'VALIDATION_ERROR', 'The comment identifier is invalid.');
  const comment = await prisma.comment.findUnique({ where: { id: parsedId.data }, select: { id: true, userId: true, post: { select: { id: true, authorId: true, archivedAt: true } } } });
  if (!comment) throw new HttpError(404, 'COMMENT_NOT_FOUND', 'That comment could not be found.');
  await assertPostVisible(comment.post, req.user.id);
  const blockedIds = await blockedIdsFor(req.user.id);
  if (blockedIds.includes(comment.userId)) throw new HttpError(404, 'COMMENT_NOT_FOUND', 'That comment could not be found.');
  const existing = await prisma.commentLike.findUnique({ where: { commentId_userId: { commentId: comment.id, userId: req.user.id } }, select: { id: true } });
  if (existing) {
    await prisma.commentLike.delete({ where: { id: existing.id } });
    const remainingLike = await prisma.commentLike.findFirst({ where: { userId: req.user.id, comment: { postId: comment.post.id, userId: comment.userId } }, select: { id: true } });
    if (!remainingLike) await prisma.notification.deleteMany({ where: { recipientId: comment.userId, actorId: req.user.id, type: 'COMMENT_LIKE', entityId: comment.post.id } });
  } else {
    await prisma.commentLike.create({ data: { commentId: comment.id, userId: req.user.id } });
    await createNotification({ recipientId: comment.userId, actorId: req.user.id, type: 'COMMENT_LIKE', entityId: comment.post.id });
  }
  const count = await prisma.commentLike.count({ where: { commentId: comment.id } });
  return ok(res, { liked: !existing, count });
}

async function toggleCommentPin(req, res) {
  const parsedId = z.string().trim().min(1).max(64).safeParse(req.params.commentId);
  if (!parsedId.success) throw new HttpError(400, 'VALIDATION_ERROR', 'The comment identifier is invalid.');
  const comment = await prisma.comment.findUnique({ where: { id: parsedId.data }, select: { id: true, postId: true, parentId: true, pinnedAt: true, post: { select: { id: true, authorId: true, archivedAt: true } } } });
  if (!comment) throw new HttpError(404, 'COMMENT_NOT_FOUND', 'That comment could not be found.');
  await assertPostVisible(comment.post, req.user.id);
  if (comment.post.authorId !== req.user.id) throw new HttpError(403, 'FORBIDDEN', 'Only the post owner can pin a comment.');
  if (comment.parentId) throw new HttpError(400, 'VALIDATION_ERROR', 'Only top-level comments can be pinned.');
  const pinnedAt = comment.pinnedAt ? null : new Date();
  await prisma.$transaction(async (tx) => {
    if (pinnedAt) await tx.comment.updateMany({ where: { postId: comment.postId, parentId: null, pinnedAt: { not: null } }, data: { pinnedAt: null } });
    await tx.comment.update({ where: { id: comment.id }, data: { pinnedAt } });
  });
  return ok(res, { pinned: Boolean(pinnedAt), pinnedAt });
}

module.exports = { feed, explore, create, detail, remove, archived, togglePin, toggleArchive, saved, updateCaption, toggleLike, toggleBookmark, listComments, listReplies, createComment, deleteComment, toggleCommentLike, toggleCommentPin, assertPostVisible };
