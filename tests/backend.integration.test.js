process.env.AUTH_SECRET ||= 'integration-test-session-secret-should-never-be-used-in-production';
process.env.INTERNAL_AUTH_SECRET ||= 'integration-test-internal-secret-not-production';
process.env.FRONTEND_URL ||= 'http://localhost:3000';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const http = require('node:http');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const backendRequire = createRequire(path.resolve(__dirname, '../backend/package.json'));
const request = backendRequire('supertest');
const { io: clientIo } = backendRequire('socket.io-client');
const { encode } = backendRequire('@auth/core/jwt');
const app = require('../backend/src/app');
const prisma = require('../backend/src/config/prisma');
const { createSocketServer } = require('../backend/src/sockets');
const { uploadDir } = require('../backend/src/config/env');

const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const video = Buffer.from('000000186674797069736f6d0000000069736f6d', 'hex');

async function authCookie(user) {
  const name = 'authjs.session-token';
  const token = await encode({ token: { sub: user.id, email: user.email, username: user.username }, secret: process.env.AUTH_SECRET, salt: name, maxAge: 3600 });
  return `${name}=${encodeURIComponent(token)}`;
}

function event(socket, name, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(name, handler); reject(new Error(`Timed out waiting for ${name}`)); }, timeoutMs);
    const handler = (payload) => { clearTimeout(timer); resolve(payload); };
    socket.once(name, handler);
  });
}

function connectSocket(url, cookie) {
  return new Promise((resolve, reject) => {
    const socket = clientIo(url, { transports: ['websocket'], extraHeaders: { Cookie: cookie }, reconnection: false, timeout: 5000 });
    const timer = setTimeout(() => { socket.close(); reject(new Error('Socket connection timed out')); }, 7000);
    socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
    socket.once('connect_error', (error) => { clearTimeout(timer); socket.close(); reject(error); });
  });
}

test('auth, social persistence, upload validation, messages, and call lifecycle', async (t) => {
  if (!process.env.DATABASE_URL) { t.skip('DATABASE_URL is not set; PostgreSQL integration tests need a disposable local database.'); return; }
  try { await prisma.$connect(); }
  catch (error) { await prisma.$disconnect(); t.skip(`PostgreSQL is unavailable: ${error.message.split('\n')[0]}`); return; }
  const suffix = crypto.randomBytes(5).toString('hex');
  const accounts = [
    { username: `test_${suffix}`, email: `first_${suffix}@example.test`, password: 'Secure-pass-123', displayName: 'First Tester' },
    { username: `second_${suffix}`, email: `second_${suffix}@example.test`, password: 'Secure-pass-123' },
    { username: `outsider_${suffix}`, email: `outside_${suffix}@example.test`, password: 'Secure-pass-123' }
  ];
  const createdUsers = [];
  const createdConversationIds = [];
  const mediaUrls = [];
  const server = http.createServer(app);
  const ioServer = createSocketServer(server, process.env.FRONTEND_URL);
  let sockets = [];
  let port;

  try {
    const firstSignup = await request(app).post('/api/auth/signup').send(accounts[0]).expect(201);
    const firstUser = firstSignup.body.data.user;
    assert.equal(firstUser.username, accounts[0].username);
    assert.equal('passwordHash' in firstUser, false);
    createdUsers.push(firstUser.id);
    const secondUser = (await request(app).post('/api/auth/signup').send(accounts[1]).expect(201)).body.data.user;
    createdUsers.push(secondUser.id);
    const outsider = (await request(app).post('/api/auth/signup').send(accounts[2]).expect(201)).body.data.user;
    createdUsers.push(outsider.id);

    const firstCookie = await authCookie(firstUser);
    const secondCookie = await authCookie(secondUser);
    const outsiderCookie = await authCookie(outsider);
    await request(app).get('/api/auth/me').expect(401);
    await request(app).get('/api/auth/me').set('Cookie', firstCookie).expect(200);
    await request(app).get('/api/auth/me').set('Cookie', 'authjs.session-token=invalid').expect(401);

    assert.equal((await request(app).get(`/api/users/check-username?username=${accounts[0].username.toUpperCase()}`).expect(200)).body.data.available, false);
    assert.equal((await request(app).get(`/api/users/check-email?email=${accounts[0].email.toUpperCase()}`).expect(200)).body.data.available, false);
    assert.equal((await request(app).get(`/api/users/check-username?username=fresh_${suffix}`).expect(200)).body.data.available, true);
    assert.equal((await request(app).get(`/api/users/check-email?email=fresh_${suffix}%40example.test`).expect(200)).body.data.available, true);
    await request(app).post('/api/auth/signup').send({ ...accounts[1], username: accounts[0].username.toUpperCase(), email: `different_${suffix}@example.test` }).expect(409);
    await request(app).post('/api/auth/signup').send({ ...accounts[1], username: `new_${suffix}`, email: accounts[0].email.toUpperCase() }).expect(409);
    await request(app).post('/api/auth/login').send({ identifier: accounts[0].username, password: 'wrong-password' }).expect(401);
    const login = await request(app).post('/api/auth/login').send({ identifier: accounts[0].email.toUpperCase(), password: accounts[0].password }).expect(200);
    assert.equal(login.body.data.user.id, firstUser.id);
    assert.equal('passwordHash' in login.body.data.user, false);

    const ownPostResponse = await request(app).post('/api/posts').set('Cookie', firstCookie).field('caption', 'A test moment #integration').attach('media', image, { filename: 'tiny.png', contentType: 'image/png' }).expect(201);
    const ownPost = ownPostResponse.body.data.post;
    mediaUrls.push(ownPost.media[0].url);
    assert.equal(ownPost.hashtags[0].hashtag.tag, 'integration');
    await request(app).delete(`/api/posts/${ownPost.id}`).set('Cookie', secondCookie).expect(403);
    assert.equal((await request(app).post(`/api/posts/${ownPost.id}/like`).set('Cookie', secondCookie).expect(200)).body.data.liked, true);
    assert.equal((await request(app).post(`/api/posts/${ownPost.id}/like`).set('Cookie', secondCookie).expect(200)).body.data.liked, false);
    assert.equal((await request(app).post(`/api/posts/${ownPost.id}/bookmark`).set('Cookie', firstCookie).expect(200)).body.data.bookmarked, true);
    const comment = await request(app).post(`/api/posts/${ownPost.id}/comments`).set('Cookie', secondCookie).send({ body: 'A persisted comment.' }).expect(201);
    await request(app).delete(`/api/comments/${comment.body.data.comment.id}`).set('Cookie', firstCookie).expect(403);
    await request(app).delete(`/api/comments/${comment.body.data.comment.id}`).set('Cookie', secondCookie).expect(200);
    await request(app).delete(`/api/posts/${ownPost.id}`).set('Cookie', firstCookie).expect(200);
    mediaUrls.pop();

    await request(app).post('/api/posts').set('Cookie', firstCookie).field('caption', 'bad').attach('media', Buffer.from('not an image'), { filename: 'bad.jpg', contentType: 'image/jpeg' }).expect(400);
    await request(app).post('/api/posts').attach('media', image, { filename: 'tiny.png', contentType: 'image/png' }).expect(401);
    const follow = await request(app).post(`/api/follows/${accounts[1].username}/toggle`).set('Cookie', firstCookie).expect(200);
    assert.equal(follow.body.data.following, true);
    await request(app).post(`/api/follows/${accounts[1].username}/toggle`).set('Cookie', firstCookie).expect(200);

    const story = await request(app).post('/api/stories').set('Cookie', firstCookie).attach('media', image, { filename: 'story.png', contentType: 'image/png' }).expect(201);
    mediaUrls.push(story.body.data.story.media[0].url);
    await request(app).post(`/api/stories/${story.body.data.story.id}/view`).set('Cookie', secondCookie).expect(200);
    assert.equal((await prisma.storyView.count({ where: { storyId: story.body.data.story.id, viewerId: secondUser.id } })), 1);

    const reel = await request(app).post('/api/reels').set('Cookie', firstCookie).field('caption', 'Test video').attach('media', video, { filename: 'tiny.mp4', contentType: 'video/mp4' }).expect(201);
    mediaUrls.push(reel.body.data.reel.media[0].url);
    assert.equal(reel.body.data.reel.authorId, undefined);
    assert.equal((await prisma.reel.findUnique({ where: { id: reel.body.data.reel.id } })).authorId, firstUser.id);

    const conversation = (await request(app).post(`/api/messages/conversations/${accounts[1].username}`).set('Cookie', firstCookie).expect(200)).body.data.conversation;
    createdConversationIds.push(conversation.id);
    const outsiderResponse = await request(app).get(`/api/messages/conversations/${conversation.id}`).set('Cookie', outsiderCookie).expect(403);
    assert.equal(outsiderResponse.body.error.code, 'FORBIDDEN');

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;
    const socketA = await connectSocket(baseUrl, firstCookie);
    const socketB = await connectSocket(baseUrl, secondCookie);
    const socketOutsider = await connectSocket(baseUrl, outsiderCookie);
    sockets = [socketA, socketB, socketOutsider];
    const incomingMessage = event(socketB, 'message:received');
    const ack = await new Promise((resolve) => socketA.emit('message:send', { conversationId: conversation.id, body: 'Socket persisted message' }, resolve));
    assert.equal(ack.data.body, 'Socket persisted message');
    assert.equal((await incomingMessage).id, ack.data.id);
    const unauthorizedMessage = await new Promise((resolve) => socketOutsider.emit('message:send', { conversationId: conversation.id, body: 'No access' }, resolve));
    assert.equal(unauthorizedMessage.error.code, 'FORBIDDEN');
    await request(app).post(`/api/messages/conversations/${conversation.id}/read`).set('Cookie', secondCookie).expect(200);
    assert.equal(await prisma.messageRead.count({ where: { messageId: ack.data.id, userId: secondUser.id } }), 1);
    assert.equal((await request(app).get(`/api/messages/conversations/${conversation.id}`).set('Cookie', secondCookie).expect(200)).body.data.messages.some((message) => message.id === ack.data.id), true);

    const ringing = event(socketB, 'call:ringing');
    const callAck = await new Promise((resolve) => socketA.emit('call:offer', { toUserId: secondUser.id, conversationId: conversation.id, type: 'VIDEO', offer: { type: 'offer', sdp: 'test-offer' } }, resolve));
    assert.equal(callAck.data.status, 'RINGING');
    assert.equal((await ringing).callId, callAck.data.callId);
    const accepted = event(socketA, 'call:accepted');
    socketB.emit('call:accepted', { callId: callAck.data.callId });
    await accepted;
    const answer = event(socketA, 'call:answer');
    socketB.emit('call:answer', { callId: callAck.data.callId, answer: { type: 'answer', sdp: 'test-answer' } });
    assert.equal((await answer).answer.sdp, 'test-answer');
    const candidate = event(socketA, 'call:ice-candidate');
    socketB.emit('call:ice-candidate', { callId: callAck.data.callId, candidate: { candidate: 'candidate:test' } });
    assert.equal((await candidate).candidate.candidate, 'candidate:test');
    const ended = event(socketB, 'call:ended');
    socketA.emit('call:ended', { callId: callAck.data.callId });
    await ended;
    assert.equal((await prisma.callSession.findUnique({ where: { id: callAck.data.callId } })).status, 'ENDED');

    const disconnectRinging = event(socketB, 'call:ringing');
    const disconnectAck = await new Promise((resolve) => socketA.emit('call:offer', { toUserId: secondUser.id, conversationId: conversation.id, type: 'VOICE', offer: { type: 'offer', sdp: 'disconnect-test' } }, resolve));
    await disconnectRinging;
    const disconnectEnded = event(socketA, 'call:ended');
    socketB.disconnect();
    sockets = [socketA, socketOutsider];
    await disconnectEnded;
    assert.equal((await prisma.callSession.findUnique({ where: { id: disconnectAck.data.callId } })).status, 'ENDED');
    t.diagnostic('Auth, privacy, posts, upload validation, story views, reel persistence, DM authorization/read state, and signaling/disconnect lifecycle passed.');
  } finally {
    sockets.forEach((socket) => socket.disconnect());
    if (server.listening) await new Promise((resolve) => ioServer.close(resolve));
    for (const conversationId of createdConversationIds) await prisma.conversation.delete({ where: { id: conversationId } }).catch(() => {});
    if (createdUsers.length) {
      const posts = await prisma.post.findMany({ where: { authorId: { in: createdUsers } }, include: { media: true } }).catch(() => []);
      const stories = await prisma.story.findMany({ where: { authorId: { in: createdUsers } }, include: { media: true } }).catch(() => []);
      const reels = await prisma.reel.findMany({ where: { authorId: { in: createdUsers } }, include: { media: true } }).catch(() => []);
      mediaUrls.push(...posts.flatMap((post) => post.media.map((item) => item.url)), ...stories.flatMap((story) => story.media.map((item) => item.url)), ...reels.flatMap((reel) => reel.media.map((item) => item.url)));
      await prisma.user.deleteMany({ where: { id: { in: createdUsers } } }).catch(() => {});
    }
    for (const url of new Set(mediaUrls)) if (url.startsWith('/uploads/')) await fs.rm(path.join(uploadDir, path.basename(url)), { force: true }).catch(() => {});
    await prisma.$disconnect();
  }
});
