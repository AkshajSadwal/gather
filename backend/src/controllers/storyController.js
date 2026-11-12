const prisma = require('../config/prisma');
const { HttpError, ok } = require('../utils/http');
const { persistUpload, removeLocal } = require('../services/storage');
const { isBlockedBetween, getBlockedUserIds } = require('../services/blocks');
const { mutedIdsFor } = require('../services/relations');
const { z } = require('zod');
const { createNotification } = require('../services/notifications');

async function list(req, res) {
  const now = new Date();
  const blockedIds = await getBlockedUserIds(req.user.id);
  const hiddenIds = [...new Set([...blockedIds, ...await mutedIdsFor(req.user.id)])];
  const following = await prisma.follow.findMany({ where: { followerId: req.user.id, accepted: true }, select: { followedId: true } });
  const closeFriendOwners = await prisma.closeFriend.findMany({ where: { friendId: req.user.id }, select: { ownerId: true } });
  const users = [...following.map((item) => item.followedId), ...closeFriendOwners.map((row) => row.ownerId), req.user.id].filter((id) => !hiddenIds.includes(id));
  const stories = await prisma.story.findMany({ where: { authorId: { in: users }, expiresAt: { gt: now }, OR: [{ audience: 'EVERYONE' }, { authorId: req.user.id }, { audience: 'CLOSE_FRIENDS', authorId: { in: closeFriendOwners.map((row) => row.ownerId) } }] }, orderBy: { createdAt: 'asc' }, include: { author: { select: { id: true, username: true, image: true, profile: { select: { avatarUrl: true } } } }, media: true, views: { where: { viewerId: req.user.id }, select: { id: true } }, _count: { select: { views: true } } } });
  const groups = new Map();
  for (const story of stories) {
    if (!groups.has(story.authorId)) groups.set(story.authorId, { user: story.author, stories: [] });
    groups.get(story.authorId).stories.push({ ...story, viewed: story.views.length > 0, views: undefined });
  }
  return ok(res, { users: [...groups.values()] });
}

async function create(req, res) {
  const parsed = z.object({ audience: z.enum(['EVERYONE', 'CLOSE_FRIENDS']).default('EVERYONE') }).safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Choose a valid story audience.');
  if (!req.file) throw new HttpError(400, 'MEDIA_REQUIRED', 'Choose an image or video for your story.');
  const caption = String(req.body.caption || '').trim().slice(0, 500);
  const media = await persistUpload(req.file, 'stories');
  let story;
  try { story = await prisma.story.create({ data: { authorId: req.user.id, caption, audience: parsed.data.audience, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), media: { create: media } }, include: { media: true } }); }
  catch (error) { await removeLocal(media.url).catch(() => {}); throw error; }
  return ok(res, { story }, 201);
}

async function view(req, res) {
  const story = await prisma.story.findUnique({ where: { id: req.params.id }, select: { id: true, authorId: true, audience: true, expiresAt: true } });
  if (!story || story.expiresAt <= new Date()) throw new HttpError(404, 'STORY_NOT_FOUND', 'That story has expired or was removed.');
  if (story.authorId === req.user.id) return ok(res, { viewed: true });
  if (await isBlockedBetween(req.user.id, story.authorId)) throw new HttpError(403, 'BLOCKED', 'You cannot view this story.');
  if (story.audience === 'CLOSE_FRIENDS' && !await prisma.closeFriend.findUnique({ where: { ownerId_friendId: { ownerId: story.authorId, friendId: req.user.id } }, select: { id: true } })) throw new HttpError(404, 'STORY_NOT_FOUND', 'That story has expired or was removed.');
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

async function reply(req, res) {
  const parsedId = z.string().trim().min(1).max(64).safeParse(req.params.id);
  if (!parsedId.success) throw new HttpError(400, 'VALIDATION_ERROR', 'The story identifier is invalid.');
  const parsed = z.object({ text: z.string().trim().min(1).max(1000) }).safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Story replies must be between 1 and 1000 characters.');
  const story = await prisma.story.findUnique({ where: { id: parsedId.data }, select: { id: true, authorId: true, audience: true, caption: true, expiresAt: true } });
  if (!story || story.expiresAt <= new Date() || story.authorId === req.user.id) throw new HttpError(404, 'STORY_NOT_FOUND', 'That story is unavailable for replies.');
  if (await isBlockedBetween(req.user.id, story.authorId)) throw new HttpError(404, 'STORY_NOT_FOUND', 'That story is unavailable for replies.');
  if (story.audience === 'CLOSE_FRIENDS' && !await prisma.closeFriend.findUnique({ where: { ownerId_friendId: { ownerId: story.authorId, friendId: req.user.id } }, select: { id: true } })) throw new HttpError(404, 'STORY_NOT_FOUND', 'That story is unavailable for replies.');
  const follow = await prisma.follow.findUnique({ where: { followerId_followedId: { followerId: req.user.id, followedId: story.authorId } }, select: { accepted: true } });
  const profile = await prisma.profile.findUnique({ where: { userId: story.authorId }, select: { visibility: true } });
  if (profile?.visibility === 'PRIVATE' && !follow?.accepted) throw new HttpError(404, 'STORY_NOT_FOUND', 'That story is unavailable for replies.');
  const directKey = [req.user.id, story.authorId].sort().join(':');
  const conversation = await prisma.conversation.upsert({ where: { directKey }, create: { directKey, participants: { create: [{ userId: req.user.id }, { userId: story.authorId }] } }, update: {}, select: { id: true } });
  const message = await prisma.message.create({ data: { conversationId: conversation.id, senderId: req.user.id, body: parsed.data.text, storyId: story.id, storyReplyPreview: story.caption || 'Story' }, include: { sender: { select: { id: true, username: true, image: true } }, reactions: true, reads: true } });
  await prisma.conversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });
  await createNotification({ recipientId: story.authorId, actorId: req.user.id, type: 'STORY_REPLY', entityId: story.id });
  const io = global.io;
  if (io) {
    const unreadCount = await prisma.message.count({ where: { conversationId: conversation.id, senderId: { not: story.authorId }, deletedAt: null, reads: { none: { userId: story.authorId } } } });
    io.to(`user:${req.user.id}`).emit('message:received', { ...message, unreadCount: 0 });
    io.to(`user:${story.authorId}`).emit('message:received', { ...message, unreadCount });
    io.to(`user:${req.user.id}`).emit('message:new', { ...message, unreadCount: 0 });
    io.to(`user:${story.authorId}`).emit('message:new', { ...message, unreadCount });
  }
  return ok(res, { conversationId: conversation.id, message }, 201);
}

module.exports = { list, create, view, remove, viewers, reply };
