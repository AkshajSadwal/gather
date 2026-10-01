const prisma = require('../config/prisma');
const { HttpError, ok } = require('../utils/http');
const { persistUpload, removeLocal } = require('../services/storage');

async function list(req, res) {
  const now = new Date();
  const following = await prisma.follow.findMany({ where: { followerId: req.user.id, accepted: true }, select: { followedId: true } });
  const users = [...following.map((item) => item.followedId), req.user.id];
  const stories = await prisma.story.findMany({ where: { authorId: { in: users }, expiresAt: { gt: now } }, orderBy: { createdAt: 'asc' }, include: { author: { select: { id: true, username: true, image: true, profile: { select: { avatarUrl: true } } } }, media: true, views: { where: { viewerId: req.user.id }, select: { id: true } }, _count: { select: { views: true } } } });
  const groups = new Map();
  for (const story of stories) {
    if (!groups.has(story.authorId)) groups.set(story.authorId, { user: story.author, stories: [] });
    groups.get(story.authorId).stories.push({ ...story, viewed: story.views.length > 0, views: undefined });
  }
  return ok(res, { users: [...groups.values()] });
}

async function create(req, res) {
  if (!req.file) throw new HttpError(400, 'MEDIA_REQUIRED', 'Choose an image or video for your story.');
  const caption = String(req.body.caption || '').trim().slice(0, 500);
  const media = await persistUpload(req.file);
  let story;
  try { story = await prisma.story.create({ data: { authorId: req.user.id, caption, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), media: { create: media } }, include: { media: true } }); }
  catch (error) { await removeLocal(media.url).catch(() => {}); throw error; }
  return ok(res, { story }, 201);
}

async function view(req, res) {
  const story = await prisma.story.findUnique({ where: { id: req.params.id }, select: { id: true, authorId: true, expiresAt: true } });
  if (!story || story.expiresAt <= new Date()) throw new HttpError(404, 'STORY_NOT_FOUND', 'That story has expired or was removed.');
  if (story.authorId === req.user.id) return ok(res, { viewed: true });
  const follows = await prisma.follow.findUnique({ where: { followerId_followedId: { followerId: req.user.id, followedId: story.authorId } }, select: { accepted: true } });
  const profile = await prisma.profile.findUnique({ where: { userId: story.authorId }, select: { visibility: true } });
  if (profile?.visibility === 'PRIVATE' && !follows?.accepted) throw new HttpError(403, 'FORBIDDEN', 'Follow this account to view its stories.');
  await prisma.storyView.upsert({ where: { storyId_viewerId: { storyId: story.id, viewerId: req.user.id } }, create: { storyId: story.id, viewerId: req.user.id }, update: {} });
  return ok(res, { viewed: true });
}

async function remove(req, res) {
  const story = await prisma.story.findUnique({ where: { id: req.params.id }, select: { id: true, authorId: true, media: { select: { url: true } } } });
  if (!story) throw new HttpError(404, 'STORY_NOT_FOUND', 'That story could not be found.');
  if (story.authorId !== req.user.id) throw new HttpError(403, 'FORBIDDEN', 'You can only remove your own stories.');
  await prisma.story.delete({ where: { id: story.id } });
  await Promise.all(story.media.map((item) => removeLocal(item.url).catch(() => {})));
  return ok(res, { deleted: true });
}

async function viewers(req, res) {
  const story = await prisma.story.findUnique({ where: { id: req.params.id }, select: { authorId: true } });
  if (!story) throw new HttpError(404, 'STORY_NOT_FOUND', 'That story could not be found.');
  if (story.authorId !== req.user.id) throw new HttpError(403, 'FORBIDDEN', 'Only the story owner can see its viewers.');
  const views = await prisma.storyView.findMany({ where: { storyId: req.params.id }, orderBy: { viewedAt: 'desc' }, include: { viewer: { select: { username: true, image: true, profile: { select: { displayName: true } } } } } });
  return ok(res, { viewers: views });
}

module.exports = { list, create, view, remove, viewers };
