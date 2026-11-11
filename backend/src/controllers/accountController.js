const bcrypt = require('bcryptjs');
const { z } = require('zod');
const prisma = require('../config/prisma');
const { HttpError, ok } = require('../utils/http');
const { removeLocal } = require('../services/storage');
const { invalidateSessionUserCache } = require('../middleware/auth');

const passwordSchema = z.string().min(8).max(72);

async function changePassword(req, res) {
  const parsed = z.object({ currentPassword: z.string().min(1).max(72), newPassword: passwordSchema }).strict().safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'New passwords must be 8–72 characters.');
  if (Buffer.byteLength(parsed.data.newPassword, 'utf8') > 72) throw new HttpError(400, 'INVALID_PASSWORD', 'Passwords must be 72 bytes or fewer.');
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { passwordHash: true } });
  if (!user?.passwordHash) throw new HttpError(400, 'PASSWORD_NOT_CONFIGURED', 'This account uses Google sign-in and does not have a password.');
  if (!await bcrypt.compare(parsed.data.currentPassword, user.passwordHash)) throw new HttpError(401, 'INVALID_CURRENT_PASSWORD', 'Your current password is incorrect.');
  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
  await prisma.user.update({ where: { id: req.user.id }, data: { passwordHash, passwordChangedAt: new Date() } });
  invalidateSessionUserCache(req.user.id);
  return ok(res, { changed: true, reauthRequired: true });
}

async function deleteAccount(req, res) {
  const parsed = z.object({ confirmUsername: z.string().trim().min(3).max(30), password: z.string().max(72).optional() }).strict().safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Confirm your username to delete this account.');
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { id: true, username: true, passwordHash: true, image: true, profile: { select: { avatarUrl: true } } } });
  if (!user) throw new HttpError(404, 'USER_NOT_FOUND', 'That account could not be found.');
  if (parsed.data.confirmUsername !== user.username) throw new HttpError(400, 'USERNAME_CONFIRMATION_MISMATCH', 'Type your username exactly to confirm account deletion.');
  if (user.passwordHash) {
    if (!parsed.data.password) throw new HttpError(400, 'PASSWORD_REQUIRED', 'Enter your password to delete this account.');
    if (!await bcrypt.compare(parsed.data.password, user.passwordHash)) throw new HttpError(401, 'INVALID_CURRENT_PASSWORD', 'Your password is incorrect.');
  }

  const [posts, reels, stories] = await Promise.all([
    prisma.postMedia.findMany({ where: { post: { is: { authorId: user.id } } }, select: { url: true } }),
    prisma.reelMedia.findMany({ where: { reel: { is: { authorId: user.id } } }, select: { url: true } }),
    prisma.storyMedia.findMany({ where: { story: { is: { authorId: user.id } } }, select: { url: true } })
  ]);
  const media = new Set([user.image, user.profile?.avatarUrl, ...posts.map((item) => item.url), ...reels.map((item) => item.url), ...stories.map((item) => item.url)].filter(Boolean));
  await prisma.user.delete({ where: { id: user.id } });
  invalidateSessionUserCache(user.id);
  await Promise.all([...media].map((reference) => removeLocal(reference).catch(() => {})));
  global.io?.in(`user:${user.id}`).disconnectSockets(true);
  return ok(res, { deleted: true });
}

module.exports = { changePassword, deleteAccount };
