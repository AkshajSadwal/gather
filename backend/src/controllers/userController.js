const { z } = require('zod');
const prisma = require('../config/prisma');
const { normalizeUsername } = require('../utils/normalize');
const { HttpError, ok } = require('../utils/http');
const { createNotification } = require('../services/notifications');
const { persistUpload, removeLocal } = require('../services/storage');
const { getBlockState, isBlockedBetween, getBlockedUserIds } = require('../services/blocks');

async function profile(req, res) {
  const username = normalizeUsername(req.params.username);
  const user = await prisma.user.findUnique({
    where: { username },
    select: {
      id: true, username: true, image: true, createdAt: true,
      profile: true,
      followers: { where: { followerId: req.user?.id || '__visitor__', accepted: true }, select: { id: true }, take: 1 }
    }
  });
  if (!user) throw new HttpError(404, 'USER_NOT_FOUND', 'That profile could not be found.');
  const isSelf = req.user?.id === user.id;
  const blockState = isSelf ? { blocked: false, blockedBy: false } : await getBlockState(req.user?.id, user.id);
  const isFollowing = user.followers.length > 0 && !blockState.blocked && !blockState.blockedBy;
  const pendingRelation = req.user?.id ? await prisma.follow.findUnique({ where: { followerId_followedId: { followerId: req.user.id, followedId: user.id } }, select: { accepted: true } }) : null;
  const isFollowPending = Boolean(pendingRelation && !pendingRelation.accepted);
  const visibility = user.profile?.visibility || 'PUBLIC';
  const canView = !blockState.blocked && !blockState.blockedBy && (isSelf || visibility === 'PUBLIC' || isFollowing);
  const [followersCount, followingCount, postsCount, posts] = await Promise.all([
    prisma.follow.count({ where: { followedId: user.id, accepted: true } }),
    prisma.follow.count({ where: { followerId: user.id, accepted: true } }),
    prisma.post.count({ where: { authorId: user.id } }),
    canView ? prisma.post.findMany({ where: { authorId: user.id }, orderBy: { createdAt: 'desc' }, take: 24, include: { author: { select: { id: true, username: true, image: true, profile: true } }, media: { orderBy: { position: 'asc' } }, likes: { where: { userId: req.user?.id || '__visitor__' }, select: { id: true }, take: 1 }, bookmarks: { where: { userId: req.user?.id || '__visitor__' }, select: { id: true }, take: 1 }, _count: { select: { likes: true, comments: true } } } }) : Promise.resolve([])
  ]);
  const shapedPosts = posts.map((post) => ({ ...post, isLiked: post.likes.length > 0, isBookmarked: post.bookmarks.length > 0, likes: undefined, bookmarks: undefined }));
  return ok(res, { user: { ...user, followers: undefined, _count: { followers: followersCount, following: followingCount, posts: postsCount }, isSelf, isFollowing, isFollowPending, canView, isBlocked: blockState.blocked, isBlockedBy: blockState.blockedBy }, posts: shapedPosts });
}

async function updateProfile(req, res) {
  const schema = z.object({
    displayName: z.string().trim().max(60).optional(),
    bio: z.string().trim().max(500).optional(),
    website: z.union([z.string().url().max(2048), z.literal('')]).optional(),
    visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Profile details are invalid.', parsed.error.flatten().fieldErrors);
  const profile = await prisma.profile.upsert({ where: { userId: req.user.id }, create: { userId: req.user.id, ...parsed.data }, update: parsed.data });
  if (parsed.data.visibility === 'PUBLIC') await prisma.follow.updateMany({ where: { followedId: req.user.id, accepted: false }, data: { accepted: true } });
  return ok(res, { profile });
}

async function updateAvatar(req, res) {
  if (!req.file) throw new HttpError(400, 'MEDIA_REQUIRED', 'Choose an image for your profile photo.');
  if (!req.file.mimetype.startsWith('image/')) {
    await require('node:fs/promises').rm(req.file.path, { force: true });
    throw new HttpError(400, 'IMAGE_REQUIRED', 'Profile photos must be images.');
  }
  const media = await persistUpload(req.file, 'avatars');
  if (media.type !== 'IMAGE') throw new HttpError(400, 'IMAGE_REQUIRED', 'Profile photos must be images.');
  const current = await prisma.user.findUnique({ where: { id: req.user.id }, select: { image: true } });
  let profile;
  try {
    profile = await prisma.$transaction(async (tx) => {
      const updated = await tx.profile.upsert({ where: { userId: req.user.id }, create: { userId: req.user.id, avatarUrl: media.url }, update: { avatarUrl: media.url } });
      await tx.user.update({ where: { id: req.user.id }, data: { image: media.url } });
      return updated;
    });
  } catch (error) { await removeLocal(media.url).catch(() => {}); throw error; }
  if (current?.image?.startsWith('/uploads/')) await removeLocal(current.image).catch(() => {});
  return ok(res, { profile, image: media.url });
}

async function removeFollower(req, res) {
  const username = normalizeUsername(req.params.username);
  const follower = await prisma.user.findUnique({ where: { username }, select: { id: true, username: true } });
  if (!follower) throw new HttpError(404, 'USER_NOT_FOUND', 'That account could not be found.');
  if (follower.id === req.user.id) throw new HttpError(400, 'INVALID_FOLLOWER', 'You cannot remove yourself as a follower.');
  const relation = await prisma.follow.findUnique({
    where: { followerId_followedId: { followerId: follower.id, followedId: req.user.id } },
    select: { id: true, accepted: true }
  });
  if (!relation || !relation.accepted) throw new HttpError(404, 'FOLLOWER_NOT_FOUND', 'That account is not an accepted follower.');
  await prisma.follow.delete({ where: { id: relation.id } });
  return ok(res, { removed: true, username: follower.username });
}

async function follow(req, res) {
  const target = await prisma.user.findUnique({ where: { username: normalizeUsername(req.params.username) }, select: { id: true, profile: { select: { visibility: true } } } });
  if (!target) throw new HttpError(404, 'USER_NOT_FOUND', 'That account could not be found.');
  if (target.id === req.user.id) throw new HttpError(400, 'CANNOT_FOLLOW_SELF', 'You cannot follow your own account.');
  if (await isBlockedBetween(req.user.id, target.id)) throw new HttpError(403, 'BLOCKED', 'You cannot follow this account.');
  const existing = await prisma.follow.findUnique({ where: { followerId_followedId: { followerId: req.user.id, followedId: target.id } } });
  if (existing) {
    await prisma.follow.delete({ where: { id: existing.id } });
    return ok(res, { following: false, cancelledRequest: !existing.accepted });
  }
  const pending = target.profile?.visibility === 'PRIVATE';
  const relation = await prisma.follow.create({
    data: { followerId: req.user.id, followedId: target.id, accepted: !pending }
  });
  await createNotification({
    recipientId: target.id,
    actorId: req.user.id,
    type: pending ? 'FOLLOW_REQUEST' : 'FOLLOW',
    entityId: relation.id
  });
  return ok(res, { following: !pending, pending, requestId: pending ? relation.id : null });
}

async function listRelation(req, res) {
  const username = normalizeUsername(req.params.username);
  const target = await prisma.user.findUnique({ where: { username }, select: { id: true, profile: { select: { visibility: true } } } });
  if (!target) throw new HttpError(404, 'USER_NOT_FOUND', 'That profile could not be found.');
  if (await isBlockedBetween(req.user?.id, target.id)) throw new HttpError(403, 'BLOCKED', 'You cannot view this account.');
  if (target.profile?.visibility === 'PRIVATE' && req.user?.id !== target.id) {
    const follow = req.user?.id ? await prisma.follow.findUnique({ where: { followerId_followedId: { followerId: req.user.id, followedId: target.id } }, select: { accepted: true } }) : null;
    if (!follow?.accepted) throw new HttpError(403, 'PRIVATE_ACCOUNT', 'Follow this account to view its connections.');
  }
  const direction = req.path.endsWith('/followers') ? 'followers' : 'following';
  const rows = await prisma.follow.findMany({
    where: direction === 'followers' ? { followedId: target.id, accepted: true } : { followerId: target.id, accepted: true },
    orderBy: { createdAt: 'desc' }, take: Math.min(Number(req.query.limit) || 50, 100),
    include: { follower: { select: { id: true, username: true, image: true, profile: true } }, followed: { select: { id: true, username: true, image: true, profile: true } } }
  });
  return ok(res, { users: rows.map((row) => direction === 'followers' ? row.follower : row.followed) });
}

async function followRequests(req, res) {
  const requests = await prisma.follow.findMany({ where: { followedId: req.user.id, accepted: false }, orderBy: { createdAt: 'desc' }, include: { follower: { select: { id: true, username: true, image: true, profile: { select: { displayName: true, avatarUrl: true } } } } } });
  return ok(res, { requests });
}

async function updateFollowRequest(req, res) {
  const parsed = z.object({ accepted: z.boolean() }).safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Choose whether to accept this follow request.');
  const relation = await prisma.follow.findUnique({ where: { id: req.params.id } });
  if (!relation || relation.followedId !== req.user.id || relation.accepted) throw new HttpError(404, 'REQUEST_NOT_FOUND', 'That follow request could not be found.');
  if (parsed.data.accepted) {
    await prisma.follow.update({ where: { id: relation.id }, data: { accepted: true } });
    await createNotification({ recipientId: relation.followerId, actorId: req.user.id, type: 'FOLLOW', entityId: relation.id });
    const reverse = await prisma.follow.findUnique({
      where: { followerId_followedId: { followerId: relation.followedId, followedId: relation.followerId } },
      select: { accepted: true }
    });
    return ok(res, {
      accepted: true,
      followingBack: reverse?.accepted === true,
      followBackPending: Boolean(reverse && !reverse.accepted)
    });
  }
  await prisma.follow.delete({ where: { id: relation.id } });
  return ok(res, { accepted: false });
}

async function toggleBlock(req, res) {
  const username = normalizeUsername(req.params.username);
  const target = await prisma.user.findUnique({ where: { username }, select: { id: true, username: true } });
  if (!target) throw new HttpError(404, 'USER_NOT_FOUND', 'That account could not be found.');
  if (target.id === req.user.id) throw new HttpError(400, 'CANNOT_BLOCK_SELF', 'You cannot block your own account.');
  const existing = await prisma.block.findUnique({ where: { blockerId_blockedId: { blockerId: req.user.id, blockedId: target.id } } });
  if (existing) {
    await prisma.block.delete({ where: { id: existing.id } });
    return ok(res, { blocked: false, username: target.username });
  }
  await prisma.$transaction(async (tx) => {
    await tx.block.create({ data: { blockerId: req.user.id, blockedId: target.id } });
    await tx.follow.deleteMany({
      where: { OR: [
        { followerId: req.user.id, followedId: target.id },
        { followerId: target.id, followedId: req.user.id }
      ] }
    });
  });
  return ok(res, { blocked: true, username: target.username });
}

async function listBlocks(req, res) {
  const rows = await prisma.block.findMany({
    where: { blockerId: req.user.id },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: { id: true, createdAt: true, blocked: { select: { id: true, username: true, image: true, profile: { select: { displayName: true, avatarUrl: true } } } } }
  });
  return ok(res, { blocks: rows.map((row) => ({ id: row.id, createdAt: row.createdAt, user: row.blocked })) });
}

async function search(req, res) {
  const query = String(req.query.q || '').trim().replace(/^[@#]/, '').slice(0, 100);
  if (query.length < 1) return ok(res, { users: [], hashtags: [], posts: [] });
  const blockedIds = await getBlockedUserIds(req.user?.id);
  const [users, hashtags, posts] = await Promise.all([
    prisma.user.findMany({ where: { id: { notIn: blockedIds }, OR: [{ username: { contains: query.toLowerCase() } }, { profile: { displayName: { contains: query, mode: 'insensitive' } } }] }, take: 12, select: { id: true, username: true, image: true, profile: true } }),
    prisma.hashtag.findMany({ where: { tag: { contains: query.toLowerCase() } }, take: 8, include: { _count: { select: { posts: true } } } }),
    prisma.post.findMany({ where: { authorId: { notIn: blockedIds }, caption: { contains: query, mode: 'insensitive' }, author: { is: { profile: { is: { visibility: 'PUBLIC' } } } } }, take: 12, orderBy: { createdAt: 'desc' }, include: { media: { take: 1, orderBy: { position: 'asc' } }, author: { select: { username: true, image: true } }, _count: { select: { likes: true, comments: true } } } })
  ]);
  return ok(res, { users, hashtags, posts });
}

module.exports = { profile, updateProfile, updateAvatar, follow, removeFollower, listRelation, followRequests, updateFollowRequest, toggleBlock, listBlocks, search };
