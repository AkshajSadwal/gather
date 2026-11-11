const fs = require('node:fs/promises');
const path = require('node:path');
const prisma = require('../config/prisma');
const { uploadDir } = require('../config/env');
const { removeLocal } = require('./storage');

async function runCleanup() {
  const now = Date.now();
  const storyCutoff = new Date(now - 60 * 60 * 1000);
  const tempCutoff = now - 60 * 60 * 1000;
  const notificationCutoff = new Date(now - 90 * 24 * 60 * 60 * 1000);
  const result = { stories: 0, tempFiles: 0, notifications: 0, failures: 0 };

  try {
    const stories = await prisma.story.findMany({ where: { expiresAt: { lt: storyCutoff } }, select: { id: true, media: { select: { url: true } } } });
    if (stories.length) {
      await prisma.story.deleteMany({ where: { id: { in: stories.map((story) => story.id) } } });
      await Promise.all(stories.flatMap((story) => story.media.map((item) => removeLocal(item.url).catch(() => { result.failures += 1; }))));
      result.stories = stories.length;
    }
  } catch { result.failures += 1; }

  try {
    const tempDir = path.join(uploadDir, '.tmp');
    const entries = await fs.readdir(tempDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const filePath = path.join(tempDir, entry.name);
      try {
        const stat = await fs.stat(filePath);
        if (stat.mtimeMs < tempCutoff) { await fs.rm(filePath, { force: true }); result.tempFiles += 1; }
      } catch { result.failures += 1; }
    }
  } catch (error) { if (error.code !== 'ENOENT') result.failures += 1; }

  try {
    const deleted = await prisma.notification.deleteMany({ where: { readAt: { lt: notificationCutoff } } });
    result.notifications = deleted.count;
  } catch { result.failures += 1; }

  console.log(`[cleanup] stories=${result.stories} temp=${result.tempFiles} notifications=${result.notifications} failures=${result.failures}`);
}

function startCleanup() {
  if (process.env.NODE_ENV === 'test') return null;
  const configured = Number(process.env.CLEANUP_INTERVAL_MS);
  const intervalMs = Number.isFinite(configured) && configured > 0 ? configured : 30 * 60 * 1000;
  const timer = setInterval(() => { void runCleanup(); }, intervalMs);
  timer.unref();
  return timer;
}

function stopCleanup(timer) {
  if (timer) clearInterval(timer);
}

module.exports = { runCleanup, startCleanup, stopCleanup };
