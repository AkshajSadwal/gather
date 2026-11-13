process.env.AUTH_SECRET ||= 'feature-test-session-secret-should-never-be-used-in-production';
process.env.FRONTEND_URL ||= 'http://localhost:3000';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { createRequire } = require('node:module');
const backendRequire = createRequire(path.resolve(__dirname, '../backend/package.json'));
const request = backendRequire('supertest');
const bcrypt = backendRequire('bcryptjs');
const { encode } = backendRequire('@auth/core/jwt');
const app = require('../backend/src/app');
const prisma = require('../backend/src/config/prisma');

async function authCookie(user) {
  const name = 'authjs.session-token';
  const token = await encode({ token: { sub: user.id, email: user.email }, secret: process.env.AUTH_SECRET, salt: name, maxAge: 3600 });
  return `${name}=${encodeURIComponent(token)}`;
}

test('blocks, comment ownership, caption permissions, password checks, and account cascade', async (t) => {
  if (!process.env.DATABASE_URL) { t.skip('DATABASE_URL is not set; this integration test needs a disposable local database.'); return; }
  await prisma.$connect();
  const suffix = crypto.randomBytes(8).toString('hex');
  const users = [];
  const makeUser = async (name, passwordHash = null) => {
    const username = `${name}_${suffix}`.slice(0, 30);
    const user = await prisma.user.create({ data: { username, email: `${username}@example.test`, passwordHash, profile: { create: { visibility: 'PUBLIC' } } } });
    users.push(user.id);
    return user;
  };

  try {
    const blocker = await makeUser('blocker');
    const blocked = await makeUser('blocked');
    const blockedPost = await prisma.post.create({ data: { authorId: blocked.id, caption: 'hidden after block' } });
    await prisma.follow.create({ data: { followerId: blocker.id, followedId: blocked.id, accepted: true } });
    const blockerCookie = await authCookie(blocker);
    const blockedCookie = await authCookie(blocked);

    await request(app).post(`/api/blocks/${blocked.username}/toggle`).set('Cookie', blockerCookie).expect(200);
    const feed = await request(app).get('/api/posts/feed').set('Cookie', blockerCookie).expect(200);
    assert.equal(feed.body.data.posts.some((post) => post.id === blockedPost.id), false);
    const blockedProfile = await request(app).get(`/api/users/${blocked.username}`).set('Cookie', blockerCookie).expect(200);
    assert.equal(blockedProfile.body.data.user.isBlocked, true);
    await request(app).get(`/api/users/${blocker.username}`).set('Cookie', blockedCookie).expect(404);
    await request(app).post(`/api/messages/conversations/${blocked.username}`).set('Cookie', blockerCookie).expect(403);

    const owner = await makeUser('owner');
    const commenter = await makeUser('commenter');
    const ownerPost = await prisma.post.create({ data: { authorId: owner.id, caption: 'before edit' } });
    const comment = await prisma.comment.create({ data: { postId: ownerPost.id, userId: commenter.id, body: 'remove me' } });
    await request(app).delete(`/api/comments/${comment.id}`).set('Cookie', await authCookie(owner)).expect(200);
    await request(app).patch(`/api/posts/${ownerPost.id}`).set('Cookie', await authCookie(commenter)).send({ caption: 'intrusion' }).expect(403);
    const edited = await request(app).patch(`/api/posts/${ownerPost.id}`).set('Cookie', await authCookie(owner)).send({ caption: 'after edit' }).expect(200);
    assert.equal(edited.body.data.post.caption, 'after edit');

    const hash = await bcrypt.hash('InitialPassword2026!', 12);
    const credentialUser = await makeUser('credential', hash);
    await request(app).post('/api/auth/change-password').set('Cookie', await authCookie(credentialUser)).send({ currentPassword: 'wrong-password', newPassword: 'NewPassword2026!' }).expect(401);

    const doomed = await makeUser('doomed');
    const doomedPost = await prisma.post.create({ data: { authorId: doomed.id, caption: 'cascade me' } });
    const deleted = await request(app).delete('/api/users/me').set('Cookie', await authCookie(doomed)).send({ confirmUsername: doomed.username }).expect(200);
    assert.equal(deleted.body.data.deleted, true);
    assert.equal(await prisma.post.findUnique({ where: { id: doomedPost.id }, select: { id: true } }), null);
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  }
});

test('Round 2 privacy, session revocation, moderation, and hashtag visibility', async (t) => {
  if (!process.env.DATABASE_URL) { t.skip('DATABASE_URL is not set; use a disposable local PostgreSQL database.'); return; }
  await prisma.$connect();
  const suffix = crypto.randomBytes(8).toString('hex');
  const users = [];
  const originalAdmins = process.env.ADMIN_USERNAMES;
  const makeUser = async (name, visibility = 'PUBLIC', passwordHash = null) => {
    const username = `${name}_${suffix}`.slice(0, 30);
    const user = await prisma.user.create({ data: { username, email: `${username}@example.test`, passwordHash, profile: { create: { visibility } } } });
    users.push(user.id);
    return user;
  };
  const cookieFor = async (user, authAt) => {
    const name = 'authjs.session-token';
    const token = await encode({ token: { sub: user.id, username: user.username, email: user.email, ...(authAt ? { authAt } : {}) }, secret: process.env.AUTH_SECRET, salt: name, maxAge: 3600 });
    return `${name}=${encodeURIComponent(token)}`;
  };
  try {
    const viewer = await makeUser('viewer');
    const blockedAuthor = await makeUser('blocked');
    const post = await prisma.post.create({ data: { authorId: viewer.id, caption: 'visible post' } });
    const topComment = await prisma.comment.create({ data: { postId: post.id, userId: viewer.id, body: 'top level' } });
    await prisma.comment.create({ data: { postId: post.id, userId: blockedAuthor.id, parentId: topComment.id, body: 'hidden reply' } });
    await prisma.block.create({ data: { blockerId: viewer.id, blockedId: blockedAuthor.id } });
    const comments = await request(app).get(`/api/posts/${post.id}/comments`).set('Cookie', await cookieFor(viewer));
    assert.equal(comments.status, 200);
    assert.equal(comments.body.data.comments[0]._count.replies, 0);
    const replies = await request(app).get(`/api/comments/${topComment.id}/replies`).set('Cookie', await cookieFor(viewer));
    assert.deepEqual(replies.body.data.replies, []);

    const deleted = await makeUser('deleted');
    const deletedCookie = await cookieFor(deleted);
    const deletion = await request(app).delete('/api/users/me').set('Cookie', deletedCookie).send({ confirmUsername: deleted.username });
    assert.equal(deletion.status, 200);
    assert.equal((await request(app).get('/api/auth/me').set('Cookie', deletedCookie)).status, 401);

    const bcrypt = backendRequire('bcryptjs');
    const passwordUser = await makeUser('password', 'PUBLIC', await bcrypt.hash('old-password-1', 10));
    const oldCookie = await cookieFor(passwordUser, Date.now() - 60_000);
    const change = await request(app).post('/api/auth/change-password').set('Cookie', oldCookie).send({ currentPassword: 'old-password-1', newPassword: 'new-password-2' });
    assert.equal(change.status, 200);
    assert.equal(change.body.data.reauthRequired, true);
    assert.equal((await request(app).get('/api/auth/me').set('Cookie', oldCookie)).status, 401);

    const report = await prisma.report.create({ data: { reporterId: viewer.id, targetType: 'USER', targetId: blockedAuthor.id, reason: 'SPAM' } });
    process.env.ADMIN_USERNAMES = `admin_${suffix}`;
    const admin = await makeUser('admin');
    assert.equal((await request(app).get('/api/admin/reports').set('Cookie', await cookieFor(viewer))).status, 403);
    const reviewed = await request(app).patch(`/api/admin/reports/${report.id}`).set('Cookie', await cookieFor(admin)).send({ status: 'REVIEWED' });
    assert.equal(reviewed.status, 200);
    assert.equal(reviewed.body.data.report.status, 'REVIEWED');

    const privateAuthor = await makeUser('private', 'PRIVATE');
    const privatePost = await prisma.post.create({ data: { authorId: privateAuthor.id, caption: '#roundtwo' } });
    const hashtag = await prisma.hashtag.upsert({ where: { tag: 'roundtwo' }, create: { tag: 'roundtwo' }, update: {} });
    await prisma.postHashtag.create({ data: { postId: privatePost.id, hashtagId: hashtag.id } });
    const tagPage = await request(app).get('/api/tags/roundtwo').set('Cookie', await cookieFor(viewer));
    assert.equal(tagPage.status, 200);
    assert.equal(tagPage.body.data.posts.some((item) => item.id === privatePost.id), false);
  } finally {
    if (originalAdmins === undefined) delete process.env.ADMIN_USERNAMES; else process.env.ADMIN_USERNAMES = originalAdmins;
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  }
});

test('admin report review is recorded in moderation history', async (t) => {
  if (!process.env.DATABASE_URL) { t.skip('DATABASE_URL is not set; this integration test needs a disposable local database.'); return; }
  await prisma.$connect();
  const suffix = crypto.randomBytes(8).toString('hex');
  const userIds = [];
  const reportIds = [];
  const previousAdmins = process.env.ADMIN_USERNAMES;
  const createUser = async (prefix) => {
    const username = `${prefix}_${suffix}`.slice(0, 30);
    const user = await prisma.user.create({ data: { username, email: `${username}@example.test`, profile: { create: { visibility: 'PUBLIC' } } } });
    userIds.push(user.id);
    return user;
  };
  const cookieFor = async (user) => {
    const name = 'authjs.session-token';
    const token = await encode({ token: { sub: user.id, username: user.username }, secret: process.env.AUTH_SECRET, salt: name, maxAge: 3600 });
    return `${name}=${encodeURIComponent(token)}`;
  };
  try {
    const reporter = await createUser('audit_reporter');
    const target = await createUser('audit_target');
    const moderator = await createUser('audit_mod');
    const report = await prisma.report.create({ data: { reporterId: reporter.id, targetType: 'USER', targetId: target.id, reason: 'SPAM' } });
    reportIds.push(report.id);
    process.env.ADMIN_USERNAMES = moderator.username;
    const response = await request(app).patch(`/api/admin/reports/${report.id}`).set('Cookie', await cookieFor(moderator)).send({ status: 'REVIEWED' });
    assert.equal(response.status, 200);
    const history = await request(app).get(`/api/admin/moderation-history?reportId=${report.id}`).set('Cookie', await cookieFor(moderator));
    assert.equal(history.status, 200);
    assert.equal(history.body.data.items.length, 1);
    assert.equal(history.body.data.items[0].action, 'REPORT_REVIEWED');
    assert.equal(history.body.data.items[0].moderatorUsername, moderator.username);
    assert.equal(history.body.data.items[0].previousStatus, 'OPEN');
    assert.equal(history.body.data.items[0].newStatus, 'REVIEWED');
  } finally {
    if (previousAdmins === undefined) delete process.env.ADMIN_USERNAMES; else process.env.ADMIN_USERNAMES = previousAdmins;
    await prisma.moderationAction.deleteMany({ where: { reportRef: { in: reportIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  }
});

test('Round four archives, pins, Close Friends, comment likes, reactions, and sharing', async (t) => {
  if (!process.env.DATABASE_URL) { t.skip('DATABASE_URL is not set; PostgreSQL integration tests need a disposable local database.'); return; }
  try { await prisma.$connect(); } catch (error) { await prisma.$disconnect(); t.skip(`PostgreSQL is unavailable: ${error.message.split('\n')[0]}`); return; }
  const suffix = crypto.randomBytes(8).toString('hex');
  const userIds = [];
  const createUser = async (prefix) => {
    const username = `${prefix}_${suffix}`.slice(0, 30);
    const user = await prisma.user.create({ data: { username, email: `${username}@example.test`, profile: { create: { visibility: 'PUBLIC' } } } });
    userIds.push(user.id);
    return user;
  };
  const cookieFor = async (user) => {
    const name = 'authjs.session-token';
    const token = await encode({ token: { sub: user.id, username: user.username }, secret: process.env.AUTH_SECRET, salt: name, maxAge: 3600 });
    return `${name}=${encodeURIComponent(token)}`;
  };
  try {
    const owner = await createUser('r4_owner');
    const viewer = await createUser('r4_viewer');
    const friend = await createUser('r4_friend');
    const outsider = await createUser('r4_outsider');
    const posts = await Promise.all(Array.from({ length: 5 }, (_, index) => prisma.post.create({ data: { authorId: owner.id, caption: `post ${index}` } })));
    await request(app).post(`/api/posts/${posts[0].id}/archive`).set('Cookie', await cookieFor(owner)).expect(200);
    await request(app).get(`/api/posts/${posts[0].id}`).set('Cookie', await cookieFor(viewer)).expect(404);
    await request(app).get(`/api/posts/${posts[0].id}`).set('Cookie', await cookieFor(owner)).expect(200);
    for (const post of posts.slice(1, 4)) await request(app).post(`/api/posts/${post.id}/pin`).set('Cookie', await cookieFor(owner)).expect(200);
    const archivedPin = await request(app).post(`/api/posts/${posts[0].id}/pin`).set('Cookie', await cookieFor(owner)).expect(409);
    assert.equal(archivedPin.body.error.code, 'POST_ARCHIVED');
    const pinLimit = await request(app).post(`/api/posts/${posts[4].id}/pin`).set('Cookie', await cookieFor(owner)).expect(409);
    assert.equal(pinLimit.body.error.code, 'PIN_LIMIT');

    const comment = await prisma.comment.create({ data: { postId: posts[1].id, userId: owner.id, body: 'like this' } });
    const liked = await request(app).post(`/api/comments/${comment.id}/like`).set('Cookie', await cookieFor(viewer)).expect(200);
    assert.equal(liked.body.data.liked, true);
    assert.equal(liked.body.data.count, 1);
    const unliked = await request(app).post(`/api/comments/${comment.id}/like`).set('Cookie', await cookieFor(viewer)).expect(200);
    assert.equal(unliked.body.data.liked, false);
    assert.equal(unliked.body.data.count, 0);

    await prisma.closeFriend.create({ data: { ownerId: owner.id, friendId: friend.id } });
    const story = await prisma.story.create({ data: { authorId: owner.id, audience: 'CLOSE_FRIENDS', expiresAt: new Date(Date.now() + 60_000), media: { create: { url: `/uploads/r4-${suffix}.jpg`, type: 'IMAGE', mimeType: 'image/jpeg', sizeBytes: 1 } } }, include: { media: true } });
    const friendStories = await request(app).get('/api/stories').set('Cookie', await cookieFor(friend)).expect(200);
    assert.equal(friendStories.body.data.users.some((group) => group.stories.some((item) => item.id === story.id)), true);
    const outsiderStories = await request(app).get('/api/stories').set('Cookie', await cookieFor(outsider)).expect(200);
    assert.equal(outsiderStories.body.data.users.some((group) => group.stories.some((item) => item.id === story.id)), false);
    await request(app).get(`/uploads/r4-${suffix}.jpg`).set('Cookie', await cookieFor(outsider)).expect(403);

    const conversation = await prisma.conversation.create({ data: { participants: { create: [{ userId: owner.id }, { userId: viewer.id }] } } });
    const message = await prisma.message.create({ data: { conversationId: conversation.id, senderId: owner.id, body: 'react to me' } });
    await request(app).post(`/api/messages/${message.id}/reactions`).set('Cookie', await cookieFor(outsider)).send({ emoji: '❤️' }).expect(403);
    await request(app).post(`/api/messages/${message.id}/reactions`).set('Cookie', await cookieFor(viewer)).send({ emoji: '😂' }).expect(200);
    await prisma.block.create({ data: { blockerId: owner.id, blockedId: outsider.id } });
    await request(app).post('/api/messages/share').set('Cookie', await cookieFor(owner)).send({ postId: posts[1].id, recipientUsernames: [outsider.username] }).expect(403);
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  }
});

test('Round five recommendation feed, event privacy, reset, and cascade', async (t) => {
  if (!process.env.DATABASE_URL) { t.skip('DATABASE_URL is not set; PostgreSQL integration tests need a disposable local database.'); return; }
  try { await prisma.$connect(); } catch (error) { await prisma.$disconnect(); t.skip(`PostgreSQL is unavailable: ${error.message.split('\n')[0]}`); return; }
  const suffix = crypto.randomBytes(8).toString('hex');
  const userIds = [];
  const createUser = async (prefix) => {
    const username = `${prefix}_${suffix}`.slice(0, 30);
    const user = await prisma.user.create({ data: { username, email: `${username}@example.test`, profile: { create: { visibility: 'PUBLIC' } } } });
    userIds.push(user.id);
    return user;
  };
  const cookieFor = async (user) => {
    const name = 'authjs.session-token';
    const token = await encode({ token: { sub: user.id, username: user.username }, secret: process.env.AUTH_SECRET, salt: name, maxAge: 3600 });
    return `${name}=${encodeURIComponent(token)}`;
  };
  const createReel = async (author, caption, archivedAt = null) => {
    const post = await prisma.post.create({ data: { authorId: author.id, caption, ...(archivedAt ? { archivedAt } : {}) } });
    const reel = await prisma.reel.create({ data: { authorId: author.id, postId: post.id, caption } });
    return { post, reel };
  };
  try {
    const viewer = await createUser('r5_viewer');
    const blockedCreator = await createUser('r5_blocked');
    const mutedCreator = await createUser('r5_muted');
    const archivedCreator = await createUser('r5_archived');
    const visibleCreator = await createUser('r5_visible');
    const outsider = await createUser('r5_outsider');
    const blocked = await createReel(blockedCreator, 'blocked');
    const muted = await createReel(mutedCreator, 'muted');
    const archived = await createReel(archivedCreator, 'archived', new Date());
    const visible = await createReel(visibleCreator, 'visible');
    const viewerCookie = await cookieFor(viewer);
    await request(app).post(`/api/blocks/${blockedCreator.username}/toggle`).set('Cookie', viewerCookie).expect(200);
    await request(app).post(`/api/mutes/${mutedCreator.username}/toggle`).set('Cookie', viewerCookie).expect(200);
    const feed = await request(app).get(`/api/reels/feed?sessionId=r5-${suffix}&size=20`).set('Cookie', viewerCookie).expect(200);
    const feedIds = feed.body.data.items.map((item) => item.id);
    assert.equal(feedIds.includes(blocked.reel.id), false);
    assert.equal(feedIds.includes(muted.reel.id), false);
    assert.equal(feedIds.includes(archived.reel.id), false);
    assert.equal(feedIds.includes(visible.reel.id), true);
    const repeatFeed = await request(app).get(`/api/reels/feed?sessionId=r5-${suffix}&size=20`).set('Cookie', viewerCookie).expect(200);
    assert.equal(repeatFeed.body.data.items.some((item) => item.id === visible.reel.id), false);
    const impression = feed.body.data.items.find((item) => item.id === visible.reel.id);
    const event = { eventId: `r5-event-${suffix}`, type: 'IMPRESSION_VISIBLE', reelId: visible.reel.id, impressionId: impression.impressionId, sessionId: `r5-${suffix}`, payload: { visibleMs: 2500 } };
    const first = await request(app).post('/api/reco/events').set('Cookie', viewerCookie).send({ events: [event] }).expect(200);
    const duplicate = await request(app).post('/api/reco/events').set('Cookie', viewerCookie).send({ events: [event] }).expect(200);
    assert.equal(first.body.data.accepted, 1);
    assert.equal(duplicate.body.data.duplicates, 1);
    assert.equal(await prisma.reelEvent.count({ where: { eventId: event.eventId } }), 1);
    const wrongOwner = await request(app).post('/api/reco/events').set('Cookie', await cookieFor(outsider)).send({ events: [{ ...event, eventId: `r5-owned-${suffix}` }] }).expect(200);
    assert.equal(wrongOwner.body.data.rejected, 1);

    await request(app).patch('/api/users/me/reco-settings').set('Cookie', viewerCookie).send({ personalizedRecs: false }).expect(200);
    const disabled = await request(app).post('/api/reco/events').set('Cookie', viewerCookie).send({ events: [{ ...event, eventId: `r5-disabled-${suffix}` }] }).expect(200);
    assert.equal(disabled.body.data.rejected, 1);
    assert.equal(await prisma.reelEvent.count({ where: { eventId: `r5-disabled-${suffix}` } }), 0);
    await prisma.userCreatorAffinity.create({ data: { userId: viewer.id, creatorId: visibleCreator.id, score: 1, lastInteractionAt: new Date() } });
    await prisma.userRecoFeatures.create({ data: { userId: viewer.id, features: { sample: true }, computedAt: new Date() } });
    await request(app).post('/api/reco/reset').set('Cookie', viewerCookie).expect(200);
    assert.equal(await prisma.reelEvent.count({ where: { userId: viewer.id } }), 0);
    assert.equal(await prisma.reelImpression.count({ where: { userId: viewer.id } }), 0);
    assert.equal(await prisma.userCreatorAffinity.count({ where: { userId: viewer.id } }), 0);
    assert.equal(await prisma.userRecoFeatures.count({ where: { userId: viewer.id } }), 0);

    const deleted = await createUser('r5_delete');
    const owned = await createReel(deleted, 'delete cascade');
    const recommendationRequestId = `r5-delete-${suffix}`;
    await prisma.recommendationRequest.create({ data: { id: recommendationRequestId, userId: deleted.id, sessionId: `r5-${suffix}`, feedSize: 1, featureSchemaVersion: 'gather-reco-v1', provider: 'cold_start_v1' } });
    const history = await prisma.reelImpression.create({ data: { requestId: recommendationRequestId, userId: deleted.id, reelId: owned.reel.id, creatorId: visibleCreator.id, sessionId: `r5-${suffix}`, position: 0, servedAt: new Date(), candidateSource: 'FRESH' } });
    await prisma.reelEvent.create({ data: { eventId: `r5-delete-event-${suffix}`, type: 'IMPRESSION_VISIBLE', userId: deleted.id, reelId: owned.reel.id, creatorId: visibleCreator.id, impressionId: history.id, occurredAt: new Date() } });
    await prisma.userCreatorAffinity.create({ data: { userId: deleted.id, creatorId: visibleCreator.id, score: 1, lastInteractionAt: new Date() } });
    await prisma.userRecoFeatures.create({ data: { userId: deleted.id, features: {}, computedAt: new Date() } });
    await request(app).delete('/api/users/me').set('Cookie', await cookieFor(deleted)).send({ confirmUsername: deleted.username }).expect(200);
    assert.equal(await prisma.recommendationRequest.count({ where: { id: recommendationRequestId } }), 0);
    assert.equal(await prisma.reelImpression.count({ where: { userId: deleted.id } }), 0);
    assert.equal(await prisma.reelEvent.count({ where: { userId: deleted.id } }), 0);
    assert.equal(await prisma.userCreatorAffinity.count({ where: { userId: deleted.id } }), 0);
    assert.equal(await prisma.userRecoFeatures.count({ where: { userId: deleted.id } }), 0);
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  }
});
