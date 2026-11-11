process.env.AUTH_SECRET ||= 'feature-test-session-secret-should-never-be-used-in-production';
process.env.FRONTEND_URL ||= 'http://localhost:3000';

const { test } = require('node:test');
const assert = require('node:assert/strict');
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
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
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
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
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
