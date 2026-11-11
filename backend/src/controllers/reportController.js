const prisma = require('../config/prisma');
const { HttpError, ok } = require('../utils/http');
const { reportSchema } = require('../utils/reportSchema');
const { assertPostVisible } = require('./postController');
const { isBlockedBetween } = require('../services/relations');

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

module.exports = { create };
