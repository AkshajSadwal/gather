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
  const retentionSetting = Number(process.env.RECO_EVENT_RETENTION_DAYS ?? 180);
  const recoRetentionDays = Number.isFinite(retentionSetting) && retentionSetting >= 0 ? retentionSetting : 180;
  const recoCutoff = new Date(now - recoRetentionDays * 86400000);
  const result = { stories: 0, tempFiles: 0, notifications: 0, recoEvents: 0, recoImpressions: 0, failures: 0 };

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

  if (recoRetentionDays > 0) {
    try {
      while (true) {
        const rows = await prisma.reelEvent.findMany({ where: { occurredAt: { lt: recoCutoff } }, orderBy: { id: 'asc' }, take: 1000, select: { id: true } });
        if (!rows.length) break;
        const deleted = await prisma.reelEvent.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } });
        result.recoEvents += deleted.count;
        if (rows.length < 1000) break;
      }
      while (true) {
        const rows = await prisma.reelImpression.findMany({ where: { servedAt: { lt: recoCutoff } }, orderBy: { id: 'asc' }, take: 1000, select: { id: true } });
        if (!rows.length) break;
        const deleted = await prisma.reelImpression.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } });
        result.recoImpressions += deleted.count;
        if (rows.length < 1000) break;
      }
    } catch { result.failures += 1; }
  }

  if (result.stories || result.tempFiles || result.notifications || result.recoEvents || result.recoImpressions || result.failures) {
    console.log(`[cleanup] stories=${result.stories} temp=${result.tempFiles} notifications=${result.notifications} recoEvents=${result.recoEvents} recoImpressions=${result.recoImpressions} failures=${result.failures}`);
  }
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
