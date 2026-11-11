const { z } = require('zod');
const prisma = require('../config/prisma');
const { HttpError, ok } = require('../utils/http');
const { getBlockedUserIds } = require('../services/blocks');
const { mutedIdsFor } = require('../services/relations');
const { shapePost } = require('./postController');

async function list(req, res) {
  const parsed = z.object({ cursor: z.string().trim().min(1).max(64).optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }).safeParse(req.query);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Choose a valid hashtag page.');
  const tag = String(req.params.tag || '').replace(/^#/, '').trim().toLowerCase();
  if (!/^[a-z0-9_]{1,100}$/.test(tag)) throw new HttpError(400, 'INVALID_HASHTAG', 'That hashtag is invalid.');
  const blocked = await getBlockedUserIds(req.user?.id);
  const muted = await mutedIdsFor(req.user?.id);
  const hidden = [...new Set([...blocked, ...muted])];
  const where = { authorId: { notIn: hidden }, hashtags: { some: { hashtag: { tag } } }, author: { is: { profile: { is: { visibility: 'PUBLIC' } } } } };
  if (parsed.data.cursor) {
    const cursor = await prisma.post.findFirst({ where: { id: parsed.data.cursor, ...where }, select: { id: true, createdAt: true } });
    if (!cursor) throw new HttpError(400, 'INVALID_CURSOR', 'That hashtag page cursor is invalid.');
    where.OR = [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }];
  }
  const posts = await prisma.post.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: parsed.data.limit + 1, include: { media: true, hashtags: { include: { hashtag: true } }, author: { select: { id: true, username: true, image: true, profile: { select: { displayName: true, avatarUrl: true, visibility: true } } } }, likes: { where: { userId: req.user?.id || '__visitor__' }, select: { id: true }, take: 1 }, bookmarks: { where: { userId: req.user?.id || '__visitor__' }, select: { id: true }, take: 1 }, _count: { select: { likes: true, comments: true } } } });
  const hasMore = posts.length > parsed.data.limit;
  if (hasMore) posts.pop();
  return ok(res, { tag, posts: posts.map(shapePost), nextCursor: hasMore ? posts.at(-1)?.id || null : null });
}

module.exports = { list };
