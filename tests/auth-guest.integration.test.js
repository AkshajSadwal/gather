process.env.AUTH_SECRET ||= 'auth-guest-test-secret-not-for-production';
process.env.INTERNAL_AUTH_SECRET ||= 'auth-guest-internal-test-secret';
process.env.FRONTEND_URL ||= 'http://localhost:3000';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { createRequire } = require('node:module');
const path = require('node:path');
const backendRequire = createRequire(path.resolve(__dirname, '../backend/package.json'));
const request = backendRequire('supertest');
const app = require('../backend/src/app');
const prisma = require('../backend/src/config/prisma');

test('Google subjects keep their Gather ID and never claim a legacy account by email', async (t) => {
  if (!process.env.DATABASE_URL) { t.skip('Disposable PostgreSQL is required.'); return; }
  const suffix = randomBytes(6).toString('hex');
  const created = [];
  const sync = (payload, secret = process.env.INTERNAL_AUTH_SECRET) => request(app)
    .post('/api/auth/google-sync').set('x-internal-auth', secret).send(payload);
  try {
    const legacy = await prisma.user.create({ data: {
      username: `legacy_${suffix}`, email: `legacy_${suffix}@example.test`,
      profile: { create: { displayName: 'Legacy owner' } }
    } });
    created.push(legacy.id);
    const oldPost = await prisma.post.create({ data: { authorId: legacy.id, caption: 'Preserve me' } });
    const payload = { providerAccountId: `google-${suffix}`, name: 'Google user' };
    await sync(payload, 'incorrect-internal-secret').expect(401);
    await sync({ ...payload, providerAccountId: '' }).expect(400);
    await sync({ ...payload, email: legacy.email }).expect(409);
    assert.equal(await prisma.oAuthIdentity.count({ where: { providerAccountId: payload.providerAccountId } }), 0);
    assert.equal((await prisma.post.findUnique({ where: { id: oldPost.id } })).authorId, legacy.id);

    const first = await sync(payload).expect(200);
    created.push(first.body.data.user.id);
    const second = await sync(payload).expect(200);
    assert.equal(second.body.data.user.id, first.body.data.user.id);
    assert.equal(await prisma.oAuthIdentity.count({ where: { providerAccountId: payload.providerAccountId } }), 1);
    assert.equal((await prisma.user.findUnique({ where: { id: first.body.data.user.id } })).email, null);
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: created } } });
    await prisma.$disconnect();
  }
});

test('anonymous discovery pages remain public, diverse and duplicate-free', async (t) => {
  if (!process.env.DATABASE_URL) { t.skip('Disposable PostgreSQL is required.'); return; }
  const suffix = randomBytes(6).toString('hex');
  const ids = [];
  try {
    for (const visibility of ['PUBLIC', 'PUBLIC', 'PUBLIC', 'PRIVATE']) {
      const user = await prisma.user.create({ data: {
        username: `guest_${suffix}_${ids.length}`, profile: { create: { visibility } }
      } });
      ids.push(user.id);
      for (let number = 0; number < 3; number++) {
        const post = await prisma.post.create({ data: { authorId: user.id, caption: 'Guest Reel', ...(number === 2 && visibility === 'PRIVATE' ? { archivedAt: new Date() } : {}) } });
        await prisma.reel.create({ data: { authorId: user.id, postId: post.id,
          media: { create: { url: `/uploads/guest-${suffix}-${number}.mp4`, mimeType: 'video/mp4', sizeBytes: 1024 } }
        } });
      }
    }
    const sessionId = `guest-${suffix}`;
    const loaded = [];
    for (let page = 0; page < 3; page++) {
      const response = await request(app).post(`/api/reels/discover?size=3&sessionId=${sessionId}`)
        .send({ excludeReelIds: loaded }).expect(200);
      const items = response.body.data.items;
      assert.equal(items.length, 3);
      assert.equal(items.every((item) => item.author.profile.visibility === 'PUBLIC'), true);
      assert.equal(items.every((item) => !item.impressionId), true);
      loaded.push(...items.map((item) => item.id));
    }
    assert.equal(new Set(loaded).size, 9);
    const invalidPost = await prisma.post.create({ data: { authorId: ids[0], caption: 'Invalid media record' } });
    await prisma.reel.create({ data: { authorId: ids[0], postId: invalidPost.id,
      media: { create: { url: '   ', mimeType: 'video/mp4', sizeBytes: 1024 } }
    } });
    const exhausted = await request(app).post(`/api/reels/discover?size=3&sessionId=${sessionId}`)
      .send({ excludeReelIds: loaded }).expect(200);
    assert.deepEqual(exhausted.body.data.items, []);
    await request(app).post('/api/reco/events').send({ events: [] }).expect(401);
    await request(app).post('/api/reels/discover').send({ excludeReelIds: [] }).expect(400);
    await request(app).post(`/api/reels/discover?sessionId=${sessionId}`).send({ excludeReelIds: 'bad' }).expect(400);
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  }
});
