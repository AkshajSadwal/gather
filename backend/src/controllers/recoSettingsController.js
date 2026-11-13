const { z } = require('zod');
const prisma = require('../config/prisma');
const { HttpError, ok } = require('../utils/http');

async function updateSettings(req, res) {
  const parsed = z.object({ personalizedRecs: z.boolean() }).strict().safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Choose whether to personalize your reels.');
  const user = await prisma.user.update({ where: { id: req.user.id }, data: { personalizedRecs: parsed.data.personalizedRecs }, select: { personalizedRecs: true } });
  return ok(res, { personalizedRecs: user.personalizedRecs });
}

async function resetHistory(req, res) {
  const resetAt = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.reelEvent.deleteMany({ where: { userId: req.user.id } });
    await tx.reelImpression.deleteMany({ where: { userId: req.user.id } });
    await tx.userCreatorAffinity.deleteMany({ where: { userId: req.user.id } });
    await tx.userRecoFeatures.deleteMany({ where: { userId: req.user.id } });
    await tx.user.update({ where: { id: req.user.id }, data: { recsResetAt: resetAt } });
  });
  return ok(res, { resetAt });
}

module.exports = { updateSettings, resetHistory };
