const prisma = require('../config/prisma');
const { z } = require('zod');
const { HttpError, ok } = require('../utils/http');
const { reportSchema } = require('../utils/reportSchema');
const { assertPostVisible } = require('./postController');
const { isBlockedBetween } = require('../services/relations');
const { deletePostContent } = require('./postController');

async function create(req, res) {
  const parsed = reportSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Choose a visible target and a reason.', parsed.error.flatten().fieldErrors);
  const { targetType, targetId, reason, details } = parsed.data;

  if (targetType === 'USER') {
    const target = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true } });
    if (!target || await isBlockedBetween(req.user.id, target.id)) throw new HttpError(404, 'USER_NOT_FOUND', 'That account could not be found.');
    if (target.id === req.user.id) throw new HttpError(400, 'CANNOT_REPORT_SELF', 'You cannot report your own account.');
  } else if (targetType === 'POST') {
    const post = await prisma.post.findUnique({ where: { id: targetId }, select: { id: true, authorId: true } });
    if (!post) throw new HttpError(404, 'POST_NOT_FOUND', 'That post could not be found.');
    if (post.authorId === req.user.id) throw new HttpError(400, 'CANNOT_REPORT_SELF', 'You cannot report your own post.');
    await assertPostVisible(post, req.user.id);
  } else {
    const comment = await prisma.comment.findUnique({ where: { id: targetId }, select: { id: true, userId: true, post: { select: { id: true, authorId: true } } } });
    if (!comment) throw new HttpError(404, 'COMMENT_NOT_FOUND', 'That comment could not be found.');
    if (comment.userId === req.user.id) throw new HttpError(400, 'CANNOT_REPORT_SELF', 'You cannot report your own comment.');
    await assertPostVisible(comment.post, req.user.id);
  }

  const key = { reporterId: req.user.id, targetType, targetId };
  const existing = await prisma.report.findUnique({ where: { reporterId_targetType_targetId: key }, select: { id: true, status: true } });
  if (existing) return ok(res, { report: existing, alreadyReported: true });

  try {
    const report = await prisma.report.create({ data: { ...key, reason, details: details || null }, select: { id: true, status: true } });
    return ok(res, { report, alreadyReported: false }, 201);
  } catch (error) {
    if (error?.code !== 'P2002') throw error;
    const duplicate = await prisma.report.findUnique({ where: { reporterId_targetType_targetId: key }, select: { id: true, status: true } });
    if (!duplicate) throw error;
    return ok(res, { report: duplicate, alreadyReported: true });
  }
}

async function listForAdmin(req, res) {
  const parsed = z.object({ status: z.enum(['OPEN', 'REVIEWED', 'DISMISSED']).optional(), cursor: z.string().trim().min(1).max(64).optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }).safeParse(req.query);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Choose a valid report page.');
  const cursor = parsed.data.cursor ? await prisma.report.findUnique({ where: { id: parsed.data.cursor }, select: { id: true } }) : null;
  if (parsed.data.cursor && !cursor) throw new HttpError(400, 'INVALID_CURSOR', 'That report page cursor is invalid.');
  const rows = await prisma.report.findMany({ where: parsed.data.status ? { status: parsed.data.status } : {}, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: parsed.data.limit + 1, ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}), include: { reporter: { select: { id: true, username: true } }, reviewedBy: { select: { id: true, username: true } } } });
  const hasMore = rows.length > parsed.data.limit;
  if (hasMore) rows.pop();
  const items = await Promise.all(rows.map(async (report) => {
    let preview = null;
    if (report.targetType === 'POST') {
      const post = await prisma.post.findUnique({ where: { id: report.targetId }, select: { id: true, caption: true, author: { select: { id: true, username: true } }, media: { take: 1, select: { url: true } } } });
      if (post) preview = { id: post.id, text: post.caption.slice(0, 300), author: post.author, mediaUrl: report.status === 'OPEN' ? post.media[0]?.url || null : null };
    } else if (report.targetType === 'COMMENT') {
      const comment = await prisma.comment.findUnique({ where: { id: report.targetId }, select: { id: true, body: true, user: { select: { id: true, username: true } }, postId: true } });
      if (comment) preview = { id: comment.id, text: comment.body.slice(0, 300), author: comment.user, postId: comment.postId };
    } else {
      const user = await prisma.user.findUnique({ where: { id: report.targetId }, select: { id: true, username: true, profile: { select: { displayName: true } } } });
      if (user) preview = { id: user.id, username: user.username, displayName: user.profile?.displayName || '' };
    }
    const { reporterId, ...safeReport } = report;
    return { ...safeReport, preview };
  }));
  return ok(res, { items, nextCursor: hasMore ? rows.at(-1)?.id || null : null });
}

async function review(req, res) {
  const parsed = z.object({ status: z.enum(['REVIEWED', 'DISMISSED']), removeContent: z.boolean().default(false) }).strict().safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Choose a valid review action.');
  const report = await prisma.report.findUnique({ where: { id: req.params.id }, select: { id: true, targetType: true, targetId: true } });
  if (!report) throw new HttpError(404, 'REPORT_NOT_FOUND', 'That report could not be found.');
  if (parsed.data.removeContent) {
    if (report.targetType === 'POST') await deletePostContent(report.targetId);
    else if (report.targetType === 'COMMENT') await prisma.comment.deleteMany({ where: { id: report.targetId } });
    else throw new HttpError(400, 'UNSUPPORTED_CONTENT_REMOVAL', 'User accounts cannot be removed from this review action.');
  }
  const updated = await prisma.report.update({ where: { id: report.id }, data: { status: parsed.data.status, reviewedById: req.user.id, reviewedAt: new Date() }, select: { id: true, status: true, reviewedAt: true } });
  return ok(res, { report: updated });
}

module.exports = { create, listForAdmin, review };
