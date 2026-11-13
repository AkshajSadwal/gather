const prisma = require('../config/prisma');
const { HttpError } = require('../utils/http');
const { deletePostContentInTransaction, removeMediaBestEffort } = require('./contentService');

async function reviewReport({ reportId, moderatorId, moderatorUsername, status, removeContent }) {
  const mediaUrls = [];
  const updated = await prisma.$transaction(async (tx) => {
    const report = await tx.report.findUnique({ where: { id: reportId }, select: { id: true, targetType: true, targetId: true, reason: true, status: true } });
    if (!report) throw new HttpError(404, 'REPORT_NOT_FOUND', 'That report could not be found.');

    let contentRemoved = false;
    if (removeContent) {
      if (report.targetType === 'POST') {
        const result = await deletePostContentInTransaction(tx, report.targetId);
        contentRemoved = result.deleted;
        mediaUrls.push(...result.mediaUrls);
      } else if (report.targetType === 'COMMENT') {
        const result = await tx.comment.deleteMany({ where: { id: report.targetId } });
        contentRemoved = result.count > 0;
      } else {
        throw new HttpError(400, 'UNSUPPORTED_CONTENT_REMOVAL', 'User accounts cannot be removed from this review action.');
      }
    }

    const reviewedAt = new Date();
    const reviewed = await tx.report.update({ where: { id: report.id }, data: { status, reviewedById: moderatorId, reviewedAt }, select: { id: true, status: true, reviewedAt: true } });
    const auditBase = {
      reportId: report.id,
      reportRef: report.id,
      targetType: report.targetType,
      targetId: report.targetId,
      reason: report.reason,
      moderatorId,
      moderatorUsername,
      previousStatus: report.status,
      newStatus: status
    };
    const actions = [{ ...auditBase, action: 'REPORT_REVIEWED', createdAt: reviewedAt }];
    if (contentRemoved) actions.push({ ...auditBase, action: 'CONTENT_REMOVED', createdAt: reviewedAt });
    await tx.moderationAction.createMany({ data: actions });
    return reviewed;
  });

  await removeMediaBestEffort(mediaUrls);
  return updated;
}

async function listModerationHistory({ reportId, cursor, limit }) {
  const where = reportId ? { reportRef: reportId } : {};
  const cursorRow = cursor ? await prisma.moderationAction.findFirst({ where: { id: cursor, ...where }, select: { id: true } }) : null;
  if (cursor && !cursorRow) throw new HttpError(400, 'INVALID_CURSOR', 'That moderation history cursor is invalid.');
  const rows = await prisma.moderationAction.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1, ...(cursorRow ? { cursor: { id: cursorRow.id }, skip: 1 } : {}) });
  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();
  return { items: rows, nextCursor: hasMore ? rows.at(-1)?.id || null : null };
}

module.exports = { reviewReport, listModerationHistory };
