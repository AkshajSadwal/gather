// Usage: node backend/scripts/export-reco-training-data.js exports/reco-training.jsonl
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const prisma = require('../src/config/prisma');
const { deriveTrainingLabels, LABEL_THRESHOLDS } = require('../src/services/recoEvents');

const BATCH_SIZE = 250;

function opaqueId(kind, id) {
  return createHash('sha256').update(`gather-reco-v1:${kind}:${id}`).digest('hex').slice(0, 32);
}

async function writeChunk(stream, text) {
  if (!stream.write(text)) await new Promise((resolve) => stream.once('drain', resolve));
}

async function exportTrainingData(outputPath) {
  const thresholds = { ...LABEL_THRESHOLDS };
  const options = new Map([['--skip-visible-ms', 'skipVisibleMs'], ['--short-view-ratio', 'shortViewRatio'], ['--long-view-ratio', 'longViewRatio'], ['--complete-view-ratio', 'completeRatio']]);
  for (let index = 3; index < process.argv.length; index += 2) {
    const key = options.get(process.argv[index]);
    const value = Number(process.argv[index + 1]);
    if (!key || !Number.isFinite(value) || value < 0 || (key !== 'skipVisibleMs' && value > 1)) throw new Error('Invalid label threshold option.');
    thresholds[key] = value;
  }
  if (thresholds.shortViewRatio > thresholds.longViewRatio || thresholds.longViewRatio > thresholds.completeRatio) throw new Error('View ratio thresholds must be ordered short <= long <= complete.');
  const target = path.resolve(outputPath);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const stream = fs.createWriteStream(target, { encoding: 'utf8' });
  let cursor;
  let exported = 0;
  try {
    while (true) {
      const impressions = await prisma.reelImpression.findMany({
        where: { seenAt: { not: null } },
        orderBy: [{ servedAt: 'asc' }, { id: 'asc' }],
        take: BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: { user: { select: { personalizedRecs: true, recsResetAt: true } } }
      });
      if (!impressions.length) break;
      cursor = impressions.at(-1).id;
      const impressionIds = impressions.map((row) => row.id);
      const reelIds = [...new Set(impressions.map((row) => row.reelId))];
      const maxServedAt = impressions.at(-1).servedAt;
      const [events, stats] = await Promise.all([
        prisma.reelEvent.findMany({ where: { impressionId: { in: impressionIds } }, select: { impressionId: true, type: true, occurredAt: true } }),
        prisma.reelStatsDaily.findMany({ where: { reelId: { in: reelIds }, day: { lt: new Date(Date.UTC(maxServedAt.getUTCFullYear(), maxServedAt.getUTCMonth(), maxServedAt.getUTCDate())) } }, select: { reelId: true, day: true, impressions: true, views: true, watchMsSum: true, completes: true, likes: true, saves: true, shares: true, comments: true, follows: true }, orderBy: { day: 'asc' } })
      ]);
      const eventsByImpression = new Map();
      for (const event of events) {
        const list = eventsByImpression.get(event.impressionId) || [];
        list.push(event);
        eventsByImpression.set(event.impressionId, list);
      }
      for (const impression of impressions) {
        if (!impression.user.personalizedRecs || (impression.user.recsResetAt && impression.user.recsResetAt > impression.servedAt)) continue;
        const dayStart = new Date(Date.UTC(impression.servedAt.getUTCFullYear(), impression.servedAt.getUTCMonth(), impression.servedAt.getUTCDate()));
        const priorStats = stats.filter((row) => row.reelId === impression.reelId && row.day < dayStart);
        const actions = (eventsByImpression.get(impression.id) || []).map((event) => event.type);
        const record = {
          impressionKey: opaqueId('impression', impression.id),
          viewerKey: opaqueId('viewer', impression.userId),
          reelKey: opaqueId('reel', impression.reelId),
          creatorKey: impression.creatorId ? opaqueId('creator', impression.creatorId) : null,
          servedAt: impression.servedAt.toISOString(),
          seenAt: impression.seenAt?.toISOString() || null,
          position: impression.position,
          candidateSource: impression.candidateSource,
          watchMs: impression.watchMs,
          visibleMs: impression.visibleMs,
          videoDurationMs: impression.videoDurationMs,
          completed: impression.completed,
          labels: deriveTrainingLabels({ watchMs: impression.watchMs, visibleMs: impression.visibleMs, videoDurationMs: impression.videoDurationMs }, thresholds),
          // Impression-linked actions are supervised outcomes; prior stats are limited to days before servedAt below.
          actions: [...new Set(actions)],
          statsBeforeServedDay: priorStats.reduce((total, row) => ({
            impressions: total.impressions + row.impressions,
            views: total.views + row.views,
            watchMsSum: total.watchMsSum + Number(row.watchMsSum),
            completes: total.completes + row.completes,
            likes: total.likes + row.likes,
            saves: total.saves + row.saves,
            shares: total.shares + row.shares,
            comments: total.comments + row.comments,
            follows: total.follows + row.follows
          }), { impressions: 0, views: 0, watchMsSum: 0, completes: 0, likes: 0, saves: 0, shares: 0, comments: 0, follows: 0 })
        };
        await writeChunk(stream, `${JSON.stringify(record)}\n`);
        exported += 1;
      }
      if (impressions.length < BATCH_SIZE) break;
    }
    await new Promise((resolve, reject) => { stream.end(resolve); stream.once('error', reject); });
    console.log(`[reco-export] records=${exported} output=${target}`);
  } catch (error) {
    stream.destroy();
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

if (!process.argv[2]) {
  console.error('Usage: node backend/scripts/export-reco-training-data.js <output.jsonl> [--skip-visible-ms 2000] [--short-view-ratio 0.25] [--long-view-ratio 0.75] [--complete-view-ratio 0.9]');
  process.exitCode = 2;
} else {
  exportTrainingData(process.argv[2]).catch((error) => {
    console.error(`[reco-export] failed: ${error.message}`);
    process.exitCode = 1;
  });
}
