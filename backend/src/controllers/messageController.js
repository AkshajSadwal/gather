const prisma = require('../config/prisma');
const { z } = require('zod');
const { HttpError, ok } = require('../utils/http');
const { isBlockedBetween, getBlockedUserIds } = require('../services/blocks');
const { assertPostVisible } = require('./postController');
const { MESSAGE_REACTION_EMOJIS } = require('../utils/messageRules');
const { logPostReelEvent } = require('../services/recoEvents');

function aggregateReactions(reactions, viewerId) {
  const groups = new Map();
  for (const reaction of reactions) {
    const group = groups.get(reaction.emoji) || { emoji: reaction.emoji, count: 0, reactedByMe: false };
    group.count += 1;
    if (reaction.userId === viewerId) group.reactedByMe = true;
    groups.set(reaction.emoji, group);
  }
  return [...groups.values()];
}

async function attachSharedPostPreviews(messages, viewerId) {
  const sharedIds = messages.map((message) => message.sharedPostId).filter(Boolean);
  const sharedPosts = sharedIds.length ? await prisma.post.findMany({ where: { id: { in: sharedIds }, archivedAt: null }, include: { author: { select: { id: true, username: true, profile: { select: { visibility: true } } } }, media: { orderBy: { position: 'asc' }, take: 1 }, reel: { select: { id: true, caption: true, media: { orderBy: { createdAt: 'asc' }, take: 1, select: { url: true } } } } } }) : [];
  const postById = new Map(sharedPosts.map((post) => [post.id, post]));
  const authorIds = [...new Set(sharedPosts.map((post) => post.authorId).filter((id) => id !== viewerId))];
  const [blockedIds, acceptedFollows] = await Promise.all([
    getBlockedUserIds(viewerId),
    authorIds.length ? prisma.follow.findMany({ where: { followerId: viewerId, followedId: { in: authorIds }, accepted: true }, select: { followedId: true } }) : []
  ]);
  const blocked = new Set(blockedIds);
  const followed = new Set(acceptedFollows.map((item) => item.followedId));
  return messages.map((message) => {
    const shared = message.sharedPostId ? postById.get(message.sharedPostId) : null;
    const visible = shared && !blocked.has(shared.authorId) && (shared.authorId === viewerId || shared.author.profile?.visibility !== 'PRIVATE' || followed.has(shared.authorId));
    const preview = visible ? { id: shared.id, type: shared.reel ? 'REEL' : 'POST', thumbnailUrl: shared.reel?.media[0]?.url || shared.media[0]?.url || null, authorUsername: shared.author.username, captionSnippet: (shared.reel?.caption || shared.caption).slice(0, 160) } : message.body.startsWith('Shared a post') ? { unavailable: true, label: 'This post is no longer available' } : null;
    const output = { ...message, sharedPost: preview, reactions: aggregateReactions(message.reactions || [], viewerId) };
    delete output.sharedPostId;
    return output;
  });
}

async function unreadCountsForUser(userId, conversationIds) {
  if (!conversationIds.length) return {};
  const rows = await prisma.message.groupBy({
    by: ['conversationId'],
    where: {
      conversationId: { in: conversationIds },
      senderId: { not: userId },
      deletedAt: null,
      reads: { none: { userId } }
    },
    _count: { _all: true }
  });
  return Object.fromEntries(rows.map((row) => [row.conversationId, row._count._all]));
}

async function conversations(req, res) {
  const links = await prisma.conversationParticipant.findMany({
    where: { userId: req.user.id }, orderBy: { conversation: { updatedAt: 'desc' } },
    include: {
      conversation: {
        include: {
          participants: { include: { user: { select: { id: true, username: true, image: true, profile: { select: { displayName: true, avatarUrl: true } } } } } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1, include: { sender: { select: { id: true, username: true } }, reads: true, reactions: true } }
        }
      }
    }
  });
  const conversationIds = links.map(({ conversation }) => conversation.id);
  const unreadByConversation = await unreadCountsForUser(req.user.id, conversationIds);
  const latestMessages = links.flatMap(({ conversation }) => conversation.messages);
  const shapedMessages = new Map((await attachSharedPostPreviews(latestMessages, req.user.id)).map((message) => [message.id, message]));
  const data = links.map(({ conversation }) => ({ ...conversation, messages: conversation.messages.map((message) => { const shaped = shapedMessages.get(message.id); return shaped.deletedAt ? { ...shaped, body: '' } : shaped; }), unreadCount: unreadByConversation[conversation.id] || 0 }));
  return ok(res, { conversations: data });
}

async function unread(req, res) {
  const memberships = await prisma.conversationParticipant.findMany({ where: { userId: req.user.id }, select: { conversationId: true } });
  const unreadByConversation = await unreadCountsForUser(req.user.id, memberships.map(({ conversationId }) => conversationId));
  const total = Object.values(unreadByConversation).reduce((sum, count) => sum + count, 0);
  return ok(res, { total, unreadByConversation });
}

async function shareRecipients(req, res) {
  const parsed = z.object({ q: z.string().trim().max(30).optional() }).safeParse(req.query);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'The recipient search is invalid.');
  const [follows, conversations, blockedIds] = await Promise.all([
    prisma.follow.findMany({ where: { followerId: req.user.id, accepted: true }, select: { followedId: true } }),
    prisma.conversationParticipant.findMany({ where: { userId: req.user.id }, select: { conversationId: true } }),
    getBlockedUserIds(req.user.id)
  ]);
  const partners = conversations.length ? await prisma.conversationParticipant.findMany({ where: { conversationId: { in: conversations.map((item) => item.conversationId) }, userId: { not: req.user.id } }, select: { userId: true } }) : [];
  const excluded = new Set([req.user.id, ...blockedIds]);
  const ids = [...new Set([...follows.map((item) => item.followedId), ...partners.map((item) => item.userId)])].filter((id) => !excluded.has(id));
  const users = await prisma.user.findMany({ where: { id: { in: ids }, ...(parsed.data.q ? { username: { contains: parsed.data.q, mode: 'insensitive' } } : {}) }, orderBy: { username: 'asc' }, take: 50, select: { id: true, username: true, image: true, profile: { select: { displayName: true } } } });
  return ok(res, { users });
}

async function suggestions(req, res) {
  const follows = req.user?.id ? await prisma.follow.findMany({ where: { followerId: req.user.id }, select: { followedId: true } }) : [];
  const excluded = [...(req.user?.id ? [req.user.id] : []), ...follows.map((row) => row.followedId)];
  const blockedIds = await getBlockedUserIds(req.user?.id);
  const candidates = await prisma.user.findMany({ where: { id: { notIn: [...excluded, ...blockedIds] }, profile: { is: { visibility: 'PUBLIC' } } }, take: 50, orderBy: { createdAt: 'desc' }, select: { id: true, username: true, image: true, profile: { select: { displayName: true, avatarUrl: true } }, followers: { where: { accepted: true, followerId: { in: follows.map((row) => row.followedId) } }, select: { id: true } }, _count: { select: { followers: { where: { accepted: true } } } } } });
  const users = candidates.map(({ followers, ...user }) => ({ ...user, mutualFollowers: followers.length })).sort((a, b) => b.mutualFollowers - a.mutualFollowers || b._count.followers - a._count.followers).slice(0, 8);
  return ok(res, { users });
}

async function openConversation(req, res) {
  const target = await prisma.user.findUnique({ where: { username: String(req.params.username).toLowerCase() }, select: { id: true, username: true } });
  if (!target) throw new HttpError(404, 'USER_NOT_FOUND', 'That user could not be found.');
  if (await isBlockedBetween(req.user.id, target.id)) throw new HttpError(403, 'BLOCKED', 'You cannot message this account.');
  if (target.id === req.user.id) throw new HttpError(400, 'INVALID_CONVERSATION', 'You cannot message yourself.');
  const directKey = [req.user.id, target.id].sort().join(':');
  const conversation = await prisma.conversation.upsert({ where: { directKey }, create: { directKey, participants: { create: [{ userId: req.user.id }, { userId: target.id }] } }, update: {}, include: { participants: { include: { user: { select: { id: true, username: true, image: true } } } } } });
  return ok(res, { conversation }, 200);
}

async function messages(req, res) {
  const member = await prisma.conversationParticipant.findUnique({ where: { conversationId_userId: { conversationId: req.params.id, userId: req.user.id } }, select: { id: true } });
  if (!member) throw new HttpError(403, 'FORBIDDEN', 'You are not a participant in this conversation.');
  const other = await prisma.conversationParticipant.findFirst({ where: { conversationId: req.params.id, userId: { not: req.user.id } }, select: { userId: true } });
  if (other && await isBlockedBetween(req.user.id, other.userId)) throw new HttpError(403, 'BLOCKED', 'You cannot access this conversation.');
  const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), 100);
  const rows = await prisma.message.findMany({ where: { conversationId: req.params.id }, orderBy: { createdAt: 'desc' }, take: limit + 1, ...(req.query.cursor ? { cursor: { id: String(req.query.cursor) }, skip: 1 } : {}), include: { sender: { select: { id: true, username: true, image: true } }, reads: true, reactions: true, sharedPost: { select: { id: true } } } });
  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();
  const shaped = await attachSharedPostPreviews(rows, req.user.id);
  return ok(res, { messages: shaped.map((message) => message.deletedAt ? { ...message, body: '' } : message).reverse(), nextCursor: hasMore ? rows[0]?.id : null });
}

async function sharePost(req, res) {
  const parsed = z.object({ postId: z.string().trim().min(1).max(64), recipientUsernames: z.array(z.string().trim().min(3).max(30).regex(/^[a-zA-Z0-9._]+$/)).min(1).max(5), note: z.string().trim().max(500).optional() }).safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Choose one to five recipients and an optional note of up to 500 characters.');
  const usernames = [...new Set(parsed.data.recipientUsernames.map((username) => username.toLowerCase()))];
  if (usernames.length !== parsed.data.recipientUsernames.length || usernames.includes(String(req.user.username).toLowerCase())) throw new HttpError(400, 'VALIDATION_ERROR', 'Choose different recipients other than yourself.');
  const [recipients, blockedIds] = await Promise.all([
    prisma.user.findMany({ where: { username: { in: usernames } }, select: { id: true, username: true } }),
    getBlockedUserIds(req.user.id)
  ]);
  if (recipients.length !== usernames.length) throw new HttpError(404, 'USER_NOT_FOUND', 'One or more recipients could not be found.');
  if (recipients.some((recipient) => blockedIds.includes(recipient.id))) throw new HttpError(403, 'BLOCKED', 'You cannot message one or more selected recipients.');
  const post = await prisma.post.findUnique({ where: { id: parsed.data.postId }, select: { id: true, authorId: true, archivedAt: true, caption: true, reel: { select: { id: true, caption: true, media: { orderBy: { createdAt: 'asc' }, take: 1, select: { url: true } } } }, author: { select: { username: true, profile: { select: { visibility: true } } } }, media: { orderBy: { position: 'asc' }, take: 1 } } });
  if (!post) throw new HttpError(404, 'POST_NOT_FOUND', 'That post could not be found.');
  await assertPostVisible(post, req.user.id);
  if (post.reel) logPostReelEvent(req.user.id, post.id, 'SHARE', { impressionId: req.get('x-reco-impression-id') || undefined });
  const created = [];
  for (const recipient of recipients) {
    const directKey = [req.user.id, recipient.id].sort().join(':');
    const conversation = await prisma.conversation.upsert({ where: { directKey }, create: { directKey, participants: { create: [{ userId: req.user.id }, { userId: recipient.id }] } }, update: {}, select: { id: true } });
    const body = `Shared a post${parsed.data.note ? `: ${parsed.data.note}` : ''}`;
    const message = await prisma.message.create({ data: { conversationId: conversation.id, senderId: req.user.id, body, sharedPostId: post.id }, include: { sender: { select: { id: true, username: true, image: true } }, reads: true, reactions: true, sharedPost: { select: { id: true } } } });
    await prisma.conversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });
    const unreadCount = await prisma.message.count({ where: { conversationId: conversation.id, senderId: { not: recipient.id }, deletedAt: null, reads: { none: { userId: recipient.id } } } });
    let sharedPreview;
    try {
      await assertPostVisible(post, recipient.id);
      sharedPreview = { id: post.id, type: post.reel ? 'REEL' : 'POST', thumbnailUrl: post.reel?.media[0]?.url || post.media[0]?.url || null, authorUsername: post.author.username, captionSnippet: (post.reel?.caption || post.caption).slice(0, 160) };
    } catch { sharedPreview = { unavailable: true, label: 'This post is no longer available' }; }
    created.push({ recipientId: recipient.id, message: { ...message, sharedPost: sharedPreview, unreadCount } });
  }
  const io = global.io;
  if (io) {
    for (const { recipientId, message } of created) {
      const senderMessage = { ...message, unreadCount: 0 };
      io.to(`user:${req.user.id}`).emit('message:received', senderMessage);
      io.to(`user:${recipientId}`).emit('message:received', message);
      io.to(`user:${req.user.id}`).emit('message:new', senderMessage);
      io.to(`user:${recipientId}`).emit('message:new', message);
    }
  }
  return ok(res, { messages: created.map(({ message }) => message) }, 201);
}

async function toggleReaction(req, res) {
  const parsedId = z.string().trim().min(1).max(64).safeParse(req.params.messageId);
  if (!parsedId.success) throw new HttpError(400, 'VALIDATION_ERROR', 'The message identifier is invalid.');
  const parsed = z.object({ emoji: z.enum(MESSAGE_REACTION_EMOJIS) }).safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Choose a supported reaction emoji.');
  const message = await prisma.message.findUnique({ where: { id: parsedId.data }, select: { id: true, conversationId: true, deletedAt: true } });
  if (!message || message.deletedAt) throw new HttpError(404, 'MESSAGE_NOT_FOUND', 'That message is unavailable.');
  const members = await prisma.conversationParticipant.findMany({ where: { conversationId: message.conversationId }, select: { userId: true } });
  if (!members.some((member) => member.userId === req.user.id)) throw new HttpError(403, 'FORBIDDEN', 'You are not a participant in this conversation.');
  const recipient = members.find((member) => member.userId !== req.user.id);
  if (recipient && await isBlockedBetween(req.user.id, recipient.userId)) throw new HttpError(403, 'BLOCKED', 'You cannot access this conversation.');
  const key = { messageId_userId: { messageId: message.id, userId: req.user.id } };
  const existing = await prisma.messageReaction.findUnique({ where: key, select: { id: true, emoji: true } });
  const removed = existing?.emoji === parsed.data.emoji;
  if (removed) await prisma.messageReaction.delete({ where: { id: existing.id } });
  else await prisma.messageReaction.upsert({ where: key, create: { messageId: message.id, userId: req.user.id, emoji: parsed.data.emoji }, update: { emoji: parsed.data.emoji } });
  const event = { conversationId: message.conversationId, messageId: message.id, userId: req.user.id, emoji: removed ? null : parsed.data.emoji };
  const io = global.io;
  const reactionRows = await prisma.messageReaction.findMany({ where: { messageId: message.id }, select: { emoji: true, userId: true } });
  const reactions = aggregateReactions(reactionRows, req.user.id);
  if (io) members.forEach((member) => io.to(`user:${member.userId}`).emit('message:reaction', { ...event, reactions }));
  return ok(res, { reactions });
}

async function removeMessage(req, res) {
  const parsed = z.string().trim().min(1).max(64).safeParse(req.params.messageId);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'The message identifier is invalid.');
  const message = await prisma.message.findUnique({ where: { id: parsed.data }, select: { id: true, senderId: true, conversationId: true, deletedAt: true } });
  if (!message) throw new HttpError(404, 'MESSAGE_NOT_FOUND', 'That message could not be found.');
  if (message.senderId !== req.user.id) throw new HttpError(403, 'FORBIDDEN', 'You can only unsend your own messages.');
  const deletedAt = message.deletedAt || new Date();
  if (!message.deletedAt) await prisma.message.update({ where: { id: message.id }, data: { deletedAt } });
  const io = global.io;
  if (io) {
    const participants = await prisma.conversationParticipant.findMany({ where: { conversationId: message.conversationId }, select: { userId: true } });
    for (const participant of participants) io.to(`user:${participant.userId}`).emit('message:deleted', { conversationId: message.conversationId, messageId: message.id });
  }
  return ok(res, { deleted: true, deletedAt });
}

async function markRead(req, res) {
  const membership = await prisma.conversationParticipant.findUnique({ where: { conversationId_userId: { conversationId: req.params.id, userId: req.user.id } }, select: { id: true } });
  if (!membership) throw new HttpError(403, 'FORBIDDEN', 'You are not a participant in this conversation.');
  const other = await prisma.conversationParticipant.findFirst({ where: { conversationId: req.params.id, userId: { not: req.user.id } }, select: { userId: true } });
  if (other && await isBlockedBetween(req.user.id, other.userId)) throw new HttpError(403, 'BLOCKED', 'You cannot access this conversation.');
  const unread = await prisma.message.findMany({ where: { conversationId: req.params.id, senderId: { not: req.user.id }, reads: { none: { userId: req.user.id } } }, select: { id: true } });
  if (unread.length) await prisma.messageRead.createMany({ data: unread.map(({ id }) => ({ messageId: id, userId: req.user.id })), skipDuplicates: true });
  const io = global.io;
  if (io) {
    const others = await prisma.conversationParticipant.findMany({ where: { conversationId: req.params.id, userId: { not: req.user.id } }, select: { userId: true } });
    for (const other of others) io.to(`user:${other.userId}`).emit('message:read', { conversationId: req.params.id, userId: req.user.id, messageIds: unread.map(({ id }) => id), readAt: new Date().toISOString() });
  }
  return ok(res, { read: unread.length });
}

module.exports = { conversations, unread, suggestions, shareRecipients, openConversation, messages, sharePost, toggleReaction, removeMessage, markRead };

