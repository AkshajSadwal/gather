const path = require('node:path');
const fs = require('node:fs');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');
const { test, expect } = require('@playwright/test');
const { removeLocal } = require('../../backend/src/services/storage');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
const prisma = new PrismaClient();
const fixtureImage = path.join(__dirname, '.e2e-image-fixture.png');
const runId = Date.now().toString(36);
const newUsername = `e2e${runId}`;
const newEmail = `e2e-${runId}@example.test`;
const demoPassword = 'GatherDemo2026!';
const createdPostCaption = `Browser journey ${runId} #gathertest`;
const createdComment = `Realtime-ready comment ${runId}`;
const createdMessage = `Two-context message ${runId}`;
const startedAt = new Date();

test.beforeAll(() => {
  fs.writeFileSync(fixtureImage, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+bTrkAAAAASUVORK5CYII=', 'base64'));
});

test.afterAll(async () => {
  const testPosts = await prisma.post.findMany({ where: { caption: { startsWith: 'Browser journey ' } }, select: { id: true, media: { select: { url: true } } } });
  await Promise.all(testPosts.flatMap((post) => post.media.map((media) => removeLocal(media.url).catch(() => {}))));
  if (testPosts.length) await prisma.post.deleteMany({ where: { id: { in: testPosts.map((post) => post.id) } } });
  await prisma.message.deleteMany({ where: { body: createdMessage } });
  await prisma.callSession.deleteMany({ where: { startedAt: { gte: startedAt }, status: { in: ['ENDED', 'REJECTED', 'FAILED'] }, OR: [{ initiator: { username: 'maya' } }, { initiator: { username: 'amara' } }] } });
  await prisma.user.deleteMany({ where: { username: newUsername } });
  await prisma.$disconnect();
  fs.rmSync(fixtureImage, { force: true });
});

async function signIn(page, identifier = 'maya') {
  await page.goto('/login');
  await page.getByLabel('Username or email').fill(identifier);
  await page.getByLabel('Password').fill(demoPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('link', { name: 'Profile' })).toBeVisible();
}

async function openConversation(page, username) {
  await page.goto('/messages');
  await page.getByRole('button', { name: new RegExp(username, 'i') }).first().click();
  await expect(page.getByPlaceholder('Write a message…')).toBeVisible();
}

test('signup, availability, login persistence, protected settings, and logout', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('Display name').fill('Gather E2E');
  await page.getByLabel('Username', { exact: true }).fill(newUsername);
  await page.getByLabel('Email', { exact: true }).fill(newEmail);
  await page.getByLabel('Password', { exact: true }).fill('BrowserJourney2026!');
  await expect(page.getByText('Available')).toHaveCount(2);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('link', { name: 'Profile' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible();

  const duplicateUsername = await page.request.post('http://localhost:4000/api/auth/signup', {
    data: { username: newUsername, email: `different-${runId}@example.test`, password: 'BrowserJourney2026!' }
  });
  expect(duplicateUsername.status()).toBe(409);
  const duplicateEmail = await page.request.post('http://localhost:4000/api/auth/signup', {
    data: { username: `other${runId}`, email: newEmail, password: 'BrowserJourney2026!' }
  });
  expect(duplicateEmail.status()).toBe(409);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/login/);
});

test('post upload, feed actions, search, follow, and story viewer', async ({ browser }) => {
  const mayaContext = await browser.newContext();
  const amaraContext = await browser.newContext();
  const maya = await mayaContext.newPage();
  const amara = await amaraContext.newPage();
  try {
    await signIn(maya);
    await maya.getByRole('button', { name: 'Create', exact: true }).click();
    const composer = maya.getByRole('dialog', { name: 'Create a moment' });
    await composer.locator('input[type="file"]').setInputFiles(fixtureImage);
    await composer.getByPlaceholder(/Write a caption/i).fill(createdPostCaption);
    await composer.getByRole('button', { name: 'Share' }).click();
    const post = maya.locator('article').filter({ hasText: createdPostCaption });
    await expect(post).toBeVisible();
    await post.getByRole('button', { name: 'Like' }).click();
    await expect(post.getByRole('button', { name: 'Unlike' })).toBeVisible();
    await post.getByRole('button', { name: 'Unlike' }).click();
    await expect(post.getByRole('button', { name: 'Like' })).toBeVisible();
    await post.getByRole('button', { name: 'Comments', exact: true }).click();
    await post.getByPlaceholder('Add a comment…').fill(createdComment);
    await post.getByRole('button', { name: 'Post', exact: true }).click();
    await expect(post.getByText(createdComment)).toBeVisible();
    await post.getByRole('button', { name: 'Save post' }).click();
    await expect(post.getByRole('button', { name: 'Unsave post' })).toBeVisible();
    await post.getByRole('button', { name: 'Unsave post' }).click();
    await post.getByRole('button', { name: 'Post options' }).click();
    await post.getByRole('button', { name: 'Delete post' }).click();
    await expect(maya.getByText(createdPostCaption)).toHaveCount(0);

    await maya.goto('/search');
    await maya.getByPlaceholder('People, hashtags, or a moment…').fill('amara');
    await expect(maya.getByText('@amara')).toBeVisible();
    await maya.goto('/profile/sofia');
    await maya.getByRole('button', { name: 'Follow', exact: true }).click();
    await expect(maya.getByRole('button', { name: 'Following', exact: true })).toBeVisible();
    await maya.getByRole('button', { name: 'Following', exact: true }).click();
    await expect(maya.getByRole('button', { name: 'Follow', exact: true })).toBeVisible();

    await maya.goto('/');
    await maya.locator('input[type="file"]').last().setInputFiles(fixtureImage);
    await expect(maya.getByText('Your story is up for the next 24 hours.')).toBeVisible();
    await signIn(amara, 'amara');
    const mayaStory = amara.getByRole('button', { name: 'maya', exact: true });
    await mayaStory.click();
    await expect(amara.getByRole('dialog', { name: 'Story by maya' })).toBeVisible();
    await expect(amara.getByRole('button', { name: 'Viewers' })).toHaveCount(0);
    await expect.poll(async () => {
      const story = await prisma.story.findFirst({ where: { author: { username: 'maya' }, caption: '' }, orderBy: { createdAt: 'desc' }, select: { views: { where: { viewer: { username: 'amara' } }, select: { id: true } } } });
      return story?.views.length || 0;
    }).toBeGreaterThan(0);
    await amara.getByRole('dialog', { name: 'Story by maya' }).press('Escape');
    const uploadedStory = await prisma.story.findFirst({ where: { author: { username: 'maya' }, caption: '' }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    if (uploadedStory) {
      const response = await maya.request.delete(`http://localhost:4000/api/stories/${uploadedStory.id}`);
      expect(response.ok()).toBeTruthy();
    }

    await maya.goto('/reels');
    await expect(maya.getByRole('heading', { name: 'Reels' })).toBeVisible();
    await expect(maya.locator('video').first()).toHaveJSProperty('muted', true);
    await expect(maya.getByRole('button', { name: /reel/i }).first()).toBeVisible();
  } finally {
    await mayaContext.close();
    await amaraContext.close();
  }
});

test('two browser contexts exchange messages and establish a mediasoup video call', async ({ browser }) => {
  const mayaContext = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const amaraContext = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const maya = await mayaContext.newPage();
  const amara = await amaraContext.newPage();
  try {
    await maya.addInitScript(() => sessionStorage.setItem('gather:call-debug', 'true'));
    await amara.addInitScript(() => sessionStorage.setItem('gather:call-debug', 'true'));
    maya.on('console', (entry) => console.log(`[maya browser ${entry.type()}] ${entry.text()}`));
    amara.on('console', (entry) => console.log(`[amara browser ${entry.type()}] ${entry.text()}`));
    maya.on('pageerror', (error) => console.log(`[maya page error] ${error.message}`));
    amara.on('pageerror', (error) => console.log(`[amara page error] ${error.message}`));
    await signIn(maya, 'maya');
    await signIn(amara, 'amara');
    await openConversation(maya, 'amara');
    await openConversation(amara, 'maya');

    await maya.getByPlaceholder('Write a message…').fill(createdMessage);
    await expect(amara.getByText('maya is typing…')).toBeVisible();
    await maya.getByRole('button', { name: 'Send message' }).click();
    await expect(amara.locator('p').filter({ hasText: createdMessage })).toBeVisible();
    await expect(maya.getByText('· Seen').last()).toBeVisible();

    const callStartedAt = new Date();
    await maya.getByRole('button', { name: 'Start video call' }).click();
    const incoming = amara.getByRole('dialog', { name: 'video call' });
    await expect(incoming).toBeVisible();
    await incoming.getByRole('button', { name: 'Answer' }).click();
    const caller = maya.getByRole('dialog', { name: 'video call' });
    await expect(caller).toBeVisible();
    await expect.poll(async () => {
      const record = await prisma.callSession.findFirst({ where: { initiator: { username: 'maya' }, recipient: { username: 'amara' }, startedAt: { gte: callStartedAt } }, orderBy: { startedAt: 'desc' }, select: { status: true } });
      return record?.status || 'MISSING';
    }, { timeout: 30_000 }).toMatch(/^(CONNECTED|ENDED|FAILED)$/);
    const callRecord = await prisma.callSession.findFirst({ where: { initiator: { username: 'maya' }, recipient: { username: 'amara' }, startedAt: { gte: callStartedAt } }, orderBy: { startedAt: 'desc' }, select: { status: true } });
    expect(callRecord?.status).toBe('CONNECTED');
    await expect(caller.getByText('connected', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(incoming.getByText('connected', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => maya.evaluate(() => document.querySelector('[role="dialog"][aria-label="video call"] audio')?.srcObject?.getAudioTracks().filter((track) => track.readyState === 'live').length || 0)).toBeGreaterThan(0);
    await expect.poll(async () => amara.evaluate(() => document.querySelector('[role="dialog"][aria-label="video call"] audio')?.srcObject?.getAudioTracks().filter((track) => track.readyState === 'live').length || 0)).toBeGreaterThan(0);
    await expect.poll(async () => maya.evaluate(() => document.querySelector('[role="dialog"][aria-label="video call"] video.h-full')?.srcObject?.getVideoTracks().length || 0)).toBeGreaterThan(0);
    await expect.poll(async () => amara.evaluate(() => document.querySelector('[role="dialog"][aria-label="video call"] video.h-full')?.srcObject?.getVideoTracks().length || 0)).toBeGreaterThan(0);

    await caller.getByRole('button', { name: 'Mute microphone' }).click();
    await expect(caller.getByRole('button', { name: 'Unmute microphone' })).toBeVisible();
    await expect.poll(async () => amara.evaluate(() => document.querySelector('[role="dialog"][aria-label="video call"] audio')?.srcObject?.getAudioTracks().every((track) => !track.enabled) || false)).toBe(true);
    await caller.getByRole('button', { name: 'Turn camera off' }).click();
    await expect(caller.getByRole('button', { name: 'Turn camera on' })).toBeVisible();
    await expect.poll(async () => amara.evaluate(() => document.querySelector('[role="dialog"][aria-label="video call"] video.h-full')?.srcObject?.getVideoTracks().every((track) => !track.enabled) || false)).toBe(true);
    await caller.getByRole('button', { name: 'Turn camera on' }).click();
    await expect(caller.getByRole('button', { name: 'Turn camera off' })).toBeVisible();
    await expect.poll(async () => amara.evaluate(() => document.querySelector('[role="dialog"][aria-label="video call"] video.h-full')?.srcObject?.getVideoTracks().some((track) => track.enabled) || false)).toBe(true);

    await maya.reload();
    await expect.poll(async () => {
      const record = await prisma.callSession.findFirst({ where: { initiator: { username: 'maya' }, recipient: { username: 'amara' }, startedAt: { gte: callStartedAt } }, orderBy: { startedAt: 'desc' }, select: { status: true } });
      return record?.status || 'MISSING';
    }, { timeout: 30_000 }).toMatch(/^(CONNECTED|ENDED|FAILED)$/);
    const refreshedCall = await prisma.callSession.findFirst({ where: { initiator: { username: 'maya' }, recipient: { username: 'amara' }, startedAt: { gte: callStartedAt } }, orderBy: { startedAt: 'desc' }, select: { status: true } });
    if (refreshedCall?.status === 'CONNECTED') {
      await expect(caller).toBeVisible({ timeout: 20_000 });
      await expect.poll(async () => maya.evaluate(() => document.querySelector('[role="dialog"][aria-label="video call"] audio')?.srcObject?.getAudioTracks().filter((track) => track.readyState === 'live').length || 0), { timeout: 20_000 }).toBeGreaterThan(0);
      await expect.poll(async () => maya.evaluate(() => document.querySelector('[role="dialog"][aria-label="video call"] video.h-full')?.srcObject?.getVideoTracks().length || 0), { timeout: 20_000 }).toBeGreaterThan(0);
      await caller.getByRole('button', { name: 'End call' }).click();
      await expect(caller).toHaveCount(0);
      await expect(incoming).toHaveCount(0);
    } else {
      await expect(maya.getByRole('dialog', { name: 'video call' })).toHaveCount(0);
      await expect(incoming).toHaveCount(0);
    }
    await openConversation(maya, 'amara');

    const voiceStartedAt = new Date();
    await maya.getByRole('button', { name: 'Start voice call' }).click();
    const acceptedVoice = amara.getByRole('dialog', { name: 'voice call' });
    await expect(acceptedVoice).toBeVisible();
    await acceptedVoice.getByRole('button', { name: 'Answer' }).click();
    const voiceCaller = maya.getByRole('dialog', { name: 'voice call' });
    await expect.poll(async () => {
      const record = await prisma.callSession.findFirst({ where: { initiator: { username: 'maya' }, recipient: { username: 'amara' }, startedAt: { gte: voiceStartedAt } }, orderBy: { startedAt: 'desc' }, select: { status: true } });
      return record?.status || 'MISSING';
    }, { timeout: 30_000 }).toBe('CONNECTED');
    await expect.poll(async () => amara.evaluate(() => document.querySelector('[role="dialog"][aria-label="voice call"] audio')?.srcObject?.getAudioTracks().filter((track) => track.readyState === 'live').length || 0)).toBeGreaterThan(0);
    await voiceCaller.getByRole('button', { name: 'End call' }).click();
    await expect(voiceCaller).toHaveCount(0);
    await expect(acceptedVoice).toHaveCount(0);

    await maya.getByRole('button', { name: 'Start voice call' }).click();
    const rejected = amara.getByRole('dialog', { name: 'voice call' });
    await expect(rejected).toBeVisible();
    await rejected.getByRole('button', { name: 'Decline' }).click();
    await expect(rejected).toHaveCount(0);

    await maya.getByRole('button', { name: 'Start voice call' }).click();
    const ringing = amara.getByRole('dialog', { name: 'voice call' });
    await expect(ringing).toBeVisible();
    await maya.getByRole('button', { name: 'Cancel call' }).click();
    await expect(ringing).toHaveCount(0);
  } finally {
    const callerAction = maya.getByRole('button', { name: /End call|Cancel call|Close call window/ });
    if (await callerAction.count()) await callerAction.last().click({ timeout: 1000 }).catch(() => {});
    const receiverAction = amara.getByRole('button', { name: /Decline|End call|Close call window/ });
    if (await receiverAction.count()) await receiverAction.last().click({ timeout: 1000 }).catch(() => {});
    await mayaContext.close();
    await amaraContext.close();
  }
});
