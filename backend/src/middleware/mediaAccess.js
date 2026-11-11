const path = require('node:path');
const prisma = require('../config/prisma');
const { sessionUserFromCookie } = require('./auth');
const { isBlockedBetween } = require('../services/blocks');
const { isAdminUsername } = require('./admin');

async function canViewAuthor(authorId, visibility, userId) {
  if (authorId === userId) return true;
  if (userId && await isBlockedBetween(userId, authorId)) return false;
  if (visibility !== 'PRIVATE') return true;
  if (!userId) return false;
  const follow = await prisma.follow.findUnique({ where: { followerId_followedId: { followerId: userId, followedId: authorId } }, select: { accepted: true } });
  return Boolean(follow?.accepted);
}

async function authorizeMediaReference(reference, userId, admin = false) {
  const [posts, stories, reels, avatar] = await Promise.all([
    prisma.postMedia.findMany({ where: { url: reference }, select: { post: { select: { id: true, authorId: true, author: { select: { profile: { select: { visibility: true } } } } } } } }),
    prisma.storyMedia.findMany({ where: { url: reference }, select: { story: { select: { authorId: true, expiresAt: true, author: { select: { profile: { select: { visibility: true } } } } } } } }),
    prisma.reelMedia.findMany({ where: { url: reference }, select: { reel: { select: { authorId: true, author: { select: { profile: { select: { visibility: true } } } } } } } }),
    prisma.user.findFirst({ where: { OR: [{ image: reference }, { profile: { is: { avatarUrl: reference } } }] }, select: { id: true, profile: { select: { visibility: true } } } })
  ]);
  const checks = [
    ...posts.map(async (entry) => (await canViewAuthor(entry.post.authorId, entry.post.author.profile?.visibility, userId)) || (admin && Boolean(await prisma.report.findFirst({ where: { targetType: 'POST', targetId: entry.post.id, status: 'OPEN' }, select: { id: true } })))),
    ...stories.map((entry) => entry.story.expiresAt > new Date() && canViewAuthor(entry.story.authorId, entry.story.author.profile?.visibility, userId)),
    ...reels.map((entry) => canViewAuthor(entry.reel.authorId, entry.reel.author.profile?.visibility, userId)),
    ...(avatar ? [canViewAuthor(avatar.id, avatar.profile?.visibility, userId)] : [])
  ];
  if (!checks.length) return { exists: false, allowed: false };
  return { exists: true, allowed: (await Promise.all(checks)).some(Boolean) };
}

async function mediaAccess(req, res, next) {
  try {
    const filename = path.basename(req.path.slice(1));
    if (!filename || filename !== req.path.slice(1)) return res.status(404).json({ error: { code: 'MEDIA_NOT_FOUND', message: 'That media could not be found.' } });
    const url = `/uploads/${filename}`;
    const user = await sessionUserFromCookie(req.headers.cookie);
    const result = await authorizeMediaReference(url, user?.id, isAdminUsername(user?.username));
    if (!result.exists) return res.status(404).json({ error: { code: 'MEDIA_NOT_FOUND', message: 'That media could not be found.' } });
    if (!result.allowed) return res.status(403).json({ error: { code: 'MEDIA_PRIVATE', message: 'You do not have access to this media.' } });
    next();
  } catch (error) { next(error); }
}

module.exports = mediaAccess;
module.exports.authorizeMediaReference = authorizeMediaReference;
