const prisma = require('../config/prisma');
const { HttpError, ok } = require('../utils/http');
const { normalizeUsername } = require('../utils/normalize');
const { reportSchema } = require('../utils/reportSchema');
const { assertPostVisible } = require('./postController');

async function create(req, res) {
  const parsed = reportSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Choose what you are reporting and a reason.', parsed.error.flatten().fieldErrors);
  const { username, postId, reason, details } = parsed.data;

  let targetUserId;
  let targetPostId = null;
  if (postId) {
    const post = await prisma.post.findUnique({ where: { id: postId }, select: { id: true, authorId: true } });
    if (!post) throw new HttpError(404, 'POST_NOT_FOUND', 'That post could not be found.');
    if (post.authorId === req.user.id) throw new HttpError(400, 'CANNOT_REPORT_SELF', 'You cannot report your own post.');
    // Reporters can only report content they are allowed to see, so reports cannot be
    // used to probe private posts or content across a block boundary.
    await assertPostVisible(post, req.user.id);
    targetUserId = post.authorId;
    targetPostId = post.id;
  } else {
    const target = await prisma.user.findUnique({ where: { username: normalizeUsername(username) }, select: { id: true } });
    if (!target) throw new HttpError(404, 'USER_NOT_FOUND', 'That account could not be found.');
    if (target.id === req.user.id) throw new HttpError(400, 'CANNOT_REPORT_SELF', 'You cannot report your own account.');
    targetUserId = target.id;
  }

  // One open report per reporter and target. Repeating the request is harmless and
  // returns the existing report instead of letting one person flood the queue.
  const existing = await prisma.report.findFirst({
    where: { reporterId: req.user.id, targetUserId, postId: targetPostId, status: { in: ['OPEN', 'REVIEWING'] } },
    select: { id: true, status: true }
  });
  if (existing) return ok(res, { report: { id: existing.id, status: existing.status }, duplicate: true });

  const report = await prisma.report.create({
    data: { reporterId: req.user.id, targetUserId, postId: targetPostId, reason, details },
    select: { id: true, status: true }
  });
  return ok(res, { report, duplicate: false }, 201);
}

module.exports = { create };
