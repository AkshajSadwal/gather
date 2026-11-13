process.env.AUTH_SECRET ||= 'integration-test-session-secret-should-never-be-used-in-production';
process.env.INTERNAL_AUTH_SECRET ||= 'integration-test-internal-secret-not-production';
process.env.FRONTEND_URL ||= 'http://localhost:3000';
process.env.CALL_RECONNECT_GRACE_MS ||= '3000';

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
const { sessionUserFromCookie } = require('../backend/src/middleware/auth');
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
    assert.notEqual(firstUser.id, secondUser.id);
    const [firstSession, secondSession] = await Promise.all([sessionUserFromCookie(firstCookie), sessionUserFromCookie(secondCookie)]);
    assert.equal(firstSession?.id, firstUser.id);
    assert.equal(secondSession?.id, secondUser.id);
    await request(app).get('/api/auth/me').expect(401);
    assert.equal((await request(app).get('/api/auth/me').set('Cookie', firstCookie).expect(200)).body.data.user.id, firstUser.id);
    const secondMe = await request(app).get('/api/auth/me').set('Cookie', secondCookie).expect(200);
    assert.equal(secondMe.body.data.user.id, secondUser.id);
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
    assert.equal(ownPost.authorId, firstUser.id);
    mediaUrls.push(ownPost.media[0].url);
    assert.equal(ownPost.hashtags[0].hashtag.tag, 'integration');
    const secondIdentityBeforeDelete = (await request(app).get('/api/auth/me').set('Cookie', secondCookie).expect(200)).body.data.user.id;
    const persistedPostBeforeDelete = await prisma.post.findUnique({ where: { id: ownPost.id }, select: { id: true, authorId: true } });
    assert.equal(secondIdentityBeforeDelete, secondUser.id);
    assert.equal(persistedPostBeforeDelete.authorId, firstUser.id);
    assert.notEqual(persistedPostBeforeDelete.authorId, secondIdentityBeforeDelete);
    await request(app).delete(`/api/posts/${ownPost.id}`).expect(401);
    assert.ok(await prisma.post.findUnique({ where: { id: ownPost.id }, select: { id: true } }));
    const rejectedDelete = await request(app).delete(`/api/posts/${ownPost.id}`).set('Cookie', secondCookie);
    const postAfterRejectedDelete = await prisma.post.findUnique({ where: { id: ownPost.id }, select: { id: true } });
    assert.equal(rejectedDelete.status, 403, `Expected 403 for requester ${secondUser.id} deleting post owned by ${firstUser.id}; received ${rejectedDelete.status}.`);
    assert.equal(rejectedDelete.body.error.code, 'FORBIDDEN');
    assert.ok(postAfterRejectedDelete);
    assert.equal((await request(app).post(`/api/posts/${ownPost.id}/like`).set('Cookie', secondCookie).expect(200)).body.data.liked, true);
    assert.equal((await request(app).post(`/api/posts/${ownPost.id}/like`).set('Cookie', secondCookie).expect(200)).body.data.liked, false);
    assert.equal((await request(app).post(`/api/posts/${ownPost.id}/bookmark`).set('Cookie', firstCookie).expect(200)).body.data.bookmarked, true);
    const comment = await request(app).post(`/api/posts/${ownPost.id}/comments`).set('Cookie', secondCookie).send({ body: 'A persisted comment.' }).expect(201);
    await request(app).delete(`/api/comments/${comment.body.data.comment.id}`).set('Cookie', outsiderCookie).expect(403);
    await request(app).delete(`/api/comments/${comment.body.data.comment.id}`).set('Cookie', secondCookie).expect(200);
    await request(app).delete(`/api/posts/${ownPost.id}`).set('Cookie', firstCookie).expect(200);
    assert.equal(await prisma.post.findUnique({ where: { id: ownPost.id }, select: { id: true } }), null);
    mediaUrls.pop();

    await request(app).post('/api/posts').set('Cookie', firstCookie).field('caption', 'bad').attach('media', Buffer.from('not an image'), { filename: 'bad.jpg', contentType: 'image/jpeg' }).expect(400);
    await request(app).post('/api/posts').attach('media', image, { filename: 'tiny.png', contentType: 'image/png' }).expect(401);
    const follow = await request(app).post(`/api/follows/${accounts[1].username}/toggle`).set('Cookie', firstCookie).expect(200);
    assert.equal(follow.body.data.following, true);
    await request(app).post(`/api/follows/${accounts[1].username}/toggle`).set('Cookie', firstCookie).expect(200);

    const followAgain = await request(app).post(`/api/follows/${accounts[1].username}/toggle`).set('Cookie', firstCookie).expect(200);
    assert.equal(followAgain.body.data.following, true);
    await request(app).delete(`/api/follows/followers/${accounts[0].username}`).set('Cookie', secondCookie).expect(200);
    assert.equal(await prisma.follow.findUnique({ where: { followerId_followedId: { followerId: firstUser.id, followedId: secondUser.id } } }), null);

    await request(app).patch('/api/users/me/profile').set('Cookie', secondCookie).send({ visibility: 'PRIVATE' }).expect(200);
    const pendingFollow = await request(app).post(`/api/follows/${accounts[1].username}/toggle`).set('Cookie', firstCookie).expect(200);
    assert.equal(pendingFollow.body.data.following, false);
    assert.equal(pendingFollow.body.data.pending, true);
    const pendingRequests = await request(app).get('/api/follows/requests').set('Cookie', secondCookie).expect(200);
    const pendingRequest = pendingRequests.body.data.requests.find((item) => item.follower.id === firstUser.id);
    assert.ok(pendingRequest);
    assert.equal((await prisma.follow.findUnique({ where: { id: pendingRequest.id } })).accepted, false);
    const acceptedRequest = await request(app).patch(`/api/follows/requests/${pendingRequest.id}`).set('Cookie', secondCookie).send({ accepted: true }).expect(200);
    assert.equal(acceptedRequest.body.data.accepted, true);
    assert.equal((await prisma.follow.findUnique({ where: { id: pendingRequest.id } })).accepted, true);
    await request(app).patch('/api/users/me/profile').set('Cookie', secondCookie).send({ visibility: 'PUBLIC' }).expect(200);

    const unreadNotifications = await request(app).get('/api/notifications/unread').set('Cookie', secondCookie).expect(200);
    assert.equal(typeof unreadNotifications.body.data.total, 'number');

    // Block is reciprocal for interactions: it removes existing follow links and blocks
    // future follow/message/call operations without deleting the target account.
    const blockResponse = await request(app).post(`/api/blocks/${accounts[1].username}/toggle`).set('Cookie', firstCookie).expect(200);
    assert.equal(blockResponse.body.data.blocked, true);
    await request(app).post(`/api/follows/${accounts[1].username}/toggle`).set('Cookie', firstCookie).expect(403);
    await request(app).post(`/api/messages/conversations/${accounts[1].username}`).set('Cookie', firstCookie).expect(403);

    // Blocked-accounts list is private to the blocker and reflects unblocking.
    await request(app).get('/api/blocks').expect(401);
    const blockList = await request(app).get('/api/blocks').set('Cookie', firstCookie).expect(200);
    assert.equal(blockList.body.data.blocks.length, 1);
    assert.equal(blockList.body.data.blocks[0].user.username, accounts[1].username);
    assert.equal(blockList.body.data.blocks[0].user.id, secondUser.id);
    assert.equal('email' in blockList.body.data.blocks[0].user, false);
    assert.equal((await request(app).get('/api/blocks').set('Cookie', secondCookie).expect(200)).body.data.blocks.length, 0);

    await request(app).post(`/api/blocks/${accounts[1].username}/toggle`).set('Cookie', firstCookie).expect(200);
    assert.equal((await request(app).get('/api/blocks').set('Cookie', firstCookie).expect(200)).body.data.blocks.length, 0);

    // Reports: validated, never self-directed, idempotent, and gated by post visibility.
    const reportedPost = (await request(app).post('/api/posts').set('Cookie', secondCookie).field('caption', 'Report target').attach('media', image, { filename: 'report.png', contentType: 'image/png' }).expect(201)).body.data.post;
    mediaUrls.push(reportedPost.media[0].url);
    await request(app).post('/api/reports').send({ targetType: 'USER', targetId: secondUser.id, reason: 'SPAM' }).expect(401);
    await request(app).post('/api/reports').set('Cookie', firstCookie).send({ targetType: 'USER', targetId: secondUser.id, reason: 'NOT_A_REASON' }).expect(400);
    await request(app).post('/api/reports').set('Cookie', firstCookie).send({ targetType: 'USER', reason: 'SPAM' }).expect(400);
    await request(app).post('/api/reports').set('Cookie', firstCookie).send({ targetType: 'INVALID', targetId: secondUser.id, reason: 'SPAM' }).expect(400);
    await request(app).post('/api/reports').set('Cookie', secondCookie).send({ targetType: 'USER', targetId: secondUser.id, reason: 'SPAM' }).expect(400);
    await request(app).post('/api/reports').set('Cookie', secondCookie).send({ targetType: 'POST', targetId: reportedPost.id, reason: 'SPAM' }).expect(400);
    await request(app).post('/api/reports').set('Cookie', firstCookie).send({ targetType: 'USER', targetId: `missing_${suffix}`, reason: 'SPAM' }).expect(404);
    await request(app).post('/api/reports').set('Cookie', firstCookie).send({ targetType: 'POST', targetId: 'does-not-exist', reason: 'SPAM' }).expect(404);

    const userReport = await request(app).post('/api/reports').set('Cookie', firstCookie).send({ targetType: 'USER', targetId: secondUser.id, reason: 'HARASSMENT', details: '  rude  ' }).expect(201);
    assert.equal(userReport.body.data.alreadyReported, false);
    const repeatedReport = await request(app).post('/api/reports').set('Cookie', firstCookie).send({ targetType: 'USER', targetId: secondUser.id, reason: 'SPAM' }).expect(200);
    assert.equal(repeatedReport.body.data.alreadyReported, true);
    assert.equal(repeatedReport.body.data.report.id, userReport.body.data.report.id);
    const storedUserReport = await prisma.report.findUnique({ where: { id: userReport.body.data.report.id } });
    assert.equal(storedUserReport.reporterId, firstUser.id);
    assert.equal(storedUserReport.targetType, 'USER');
    assert.equal(storedUserReport.targetId, secondUser.id);
    assert.equal(storedUserReport.reason, 'HARASSMENT');
    assert.equal(storedUserReport.details, 'rude');
    assert.equal(storedUserReport.status, 'OPEN');

    const postReport = await request(app).post('/api/reports').set('Cookie', firstCookie).send({ targetType: 'POST', targetId: reportedPost.id, reason: 'SPAM' }).expect(201);
    const storedPostReport = await prisma.report.findUnique({ where: { id: postReport.body.data.report.id } });
    assert.equal(storedPostReport.targetType, 'POST');
    assert.equal(storedPostReport.targetId, reportedPost.id);
    assert.equal(await prisma.report.count({ where: { reporterId: firstUser.id } }), 2);

    // A reporter must be able to see the post: private posts cannot be probed through reports.
    await request(app).patch('/api/users/me/profile').set('Cookie', secondCookie).send({ visibility: 'PRIVATE' }).expect(200);
    await request(app).post('/api/reports').set('Cookie', outsiderCookie).send({ targetType: 'POST', targetId: reportedPost.id, reason: 'SPAM' }).expect(403);
    await request(app).patch('/api/users/me/profile').set('Cookie', secondCookie).send({ visibility: 'PUBLIC' }).expect(200);
    assert.equal(await prisma.report.count({ where: { reporterId: outsider.id } }), 0);

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

    await prisma.message.createMany({
      data: [
        { conversationId: conversation.id, senderId: firstUser.id, body: 'Unread one' },
        { conversationId: conversation.id, senderId: firstUser.id, body: 'Unread two' }
      ]
    });
    const unreadSummary = await request(app).get('/api/messages/unread').set('Cookie', secondCookie).expect(200);
    assert.equal(unreadSummary.body.data.total, 2);
    assert.equal(unreadSummary.body.data.unreadByConversation[conversation.id], 2);
    const secondConversations = await request(app).get('/api/messages/conversations').set('Cookie', secondCookie).expect(200);
    assert.equal(secondConversations.body.data.conversations.find((item) => item.id === conversation.id).unreadCount, 2);
    await request(app).post(`/api/messages/conversations/${conversation.id}/read`).set('Cookie', secondCookie).expect(200);
    const clearedUnread = await request(app).get('/api/messages/unread').set('Cookie', secondCookie).expect(200);
    assert.equal(clearedUnread.body.data.total, 0);
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
    const incomingPayload = await incomingMessage;
    assert.equal(incomingPayload.id, ack.data.id);
    assert.equal(incomingPayload.unreadCount, 1);
    const unauthorizedMessage = await new Promise((resolve) => socketOutsider.emit('message:send', { conversationId: conversation.id, body: 'No access' }, resolve));
    assert.equal(unauthorizedMessage.error.code, 'FORBIDDEN');
    await request(app).post(`/api/messages/conversations/${conversation.id}/read`).set('Cookie', secondCookie).expect(200);
    assert.equal(await prisma.messageRead.count({ where: { messageId: ack.data.id, userId: secondUser.id } }), 1);
    assert.equal((await request(app).get(`/api/messages/conversations/${conversation.id}`).set('Cookie', secondCookie).expect(200)).body.data.messages.some((message) => message.id === ack.data.id), true);

    await ioServer.callService.ready;
    const ringing = event(socketB, 'call:ring');
    const callAck = await new Promise((resolve) => socketA.emit('call:start', { toUserId: secondUser.id, conversationId: conversation.id, type: 'VIDEO' }, resolve));
    assert.equal(callAck.data.status, 'RINGING');
    assert.equal((await ringing).callId, callAck.data.callId);
    const accepted = event(socketA, 'call:accepted');
    const acceptedAck = await new Promise((resolve) => socketB.emit('call:accept', { callId: callAck.data.callId }, resolve));
    assert.equal(acceptedAck.data.status, 'ACCEPTED');
    await accepted;
    const capabilitiesA = await new Promise((resolve) => socketA.emit('mediasoup:get-router-capabilities', { callId: callAck.data.callId }, resolve));
    const capabilitiesB = await new Promise((resolve) => socketB.emit('mediasoup:get-router-capabilities', { callId: callAck.data.callId }, resolve));
    assert.ok(capabilitiesA.data.rtpCapabilities.codecs.some((codec) => codec.mimeType === 'audio/opus'));
    assert.ok(capabilitiesB.data.rtpCapabilities.codecs.some((codec) => codec.mimeType === 'audio/opus'));
    const transportA = await new Promise((resolve) => socketA.emit('mediasoup:create-transport', { callId: callAck.data.callId, direction: 'send' }, resolve));
    const transportARepeat = await new Promise((resolve) => socketA.emit('mediasoup:create-transport', { callId: callAck.data.callId, direction: 'send' }, resolve));
    const receiveA = await new Promise((resolve) => socketA.emit('mediasoup:create-transport', { callId: callAck.data.callId, direction: 'recv' }, resolve));
    const transportB = await new Promise((resolve) => socketB.emit('mediasoup:create-transport', { callId: callAck.data.callId, direction: 'send' }, resolve));
    const receiveB = await new Promise((resolve) => socketB.emit('mediasoup:create-transport', { callId: callAck.data.callId, direction: 'recv' }, resolve));
    assert.equal(transportA.data.transport.id, transportARepeat.data.transport.id);
    assert.notEqual(transportA.data.transport.id, receiveA.data.transport.id);
    assert.notEqual(transportB.data.transport.id, receiveB.data.transport.id);
    const outsiderMedia = await new Promise((resolve) => socketOutsider.emit('mediasoup:create-transport', { callId: callAck.data.callId, direction: 'send' }, resolve));
    assert.equal(outsiderMedia.error.code, 'FORBIDDEN');
    const crossPeerTransport = await new Promise((resolve) => socketB.emit('mediasoup:connect-transport', { callId: callAck.data.callId, transportId: transportA.data.transport.id, dtlsParameters: {} }, resolve));
    assert.equal(crossPeerTransport.error.code, 'INVALID_TRANSPORT');
    const ended = event(socketB, 'call:ended');
    const endAck = await new Promise((resolve) => socketA.emit('call:end', { callId: callAck.data.callId }, resolve));
    assert.equal(endAck.data.ended, true);
    await ended;
    assert.equal((await prisma.callSession.findUnique({ where: { id: callAck.data.callId } })).status, 'ENDED');

    const disconnectRinging = event(socketB, 'call:ring');
    const disconnectAck = await new Promise((resolve) => socketA.emit('call:start', { toUserId: secondUser.id, conversationId: conversation.id, type: 'VOICE' }, resolve));
    await disconnectRinging;
    const disconnectAccepted = event(socketA, 'call:accepted');
    await new Promise((resolve) => socketB.emit('call:accept', { callId: disconnectAck.data.callId }, resolve));
    await disconnectAccepted;
    socketB.disconnect();
    const resumed = await connectSocket(baseUrl, secondCookie);
    sockets = [socketA, resumed, socketOutsider];
    const resumeAck = await new Promise((resolve) => resumed.emit('call:resume', { callId: disconnectAck.data.callId }, resolve));
    assert.equal(resumeAck.data.callId, disconnectAck.data.callId);
    const recoveredCapabilities = await new Promise((resolve) => resumed.emit('mediasoup:get-router-capabilities', { callId: disconnectAck.data.callId }, resolve));
    assert.ok(recoveredCapabilities.data.rtpCapabilities.codecs.some((codec) => codec.mimeType === 'audio/opus'));
    const recoveredEnd = event(resumed, 'call:ended');
    await new Promise((resolve) => socketA.emit('call:end', { callId: disconnectAck.data.callId }, resolve));
    await recoveredEnd;
    assert.equal((await prisma.callSession.findUnique({ where: { id: disconnectAck.data.callId } })).status, 'ENDED');

    const timeoutRing = event(resumed, 'call:ring');
    const timeoutAck = await new Promise((resolve) => socketA.emit('call:start', { toUserId: secondUser.id, conversationId: conversation.id, type: 'VOICE' }, resolve));
    await timeoutRing;
    const timeoutAccepted = event(socketA, 'call:accepted');
    await new Promise((resolve) => resumed.emit('call:accept', { callId: timeoutAck.data.callId }, resolve));
    await timeoutAccepted;
    const disconnectEnded = event(socketA, 'call:ended', 6000);
    resumed.disconnect();
    sockets = [socketA, socketOutsider];
    const disconnectEvent = await disconnectEnded;
    assert.equal(disconnectEvent.reason, 'peer_disconnected');
    assert.equal((await prisma.callSession.findUnique({ where: { id: timeoutAck.data.callId } })).status, 'FAILED');
    t.diagnostic('Credentials auth, privacy, social persistence, upload validation, stories/reels, DM authorization/read state, SFU workers/routers/transports, call authorization, reconnect recovery, and disconnect cleanup passed.');
  } finally {
    sockets.forEach((socket) => socket.disconnect());
    await ioServer.callService.close();
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
