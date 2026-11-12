const { randomUUID } = require('node:crypto');
const { z } = require('zod');
const prisma = require('../config/prisma');
const { isBlockedBetween } = require('./blocks');
const { mutedIdsFor } = require('./relations');

const CLIENT_EVENT_TYPES = Object.freeze(['IMPRESSION_VISIBLE', 'WATCH_END', 'REPLAY', 'PROFILE_OPEN', 'NOT_INTERESTED']);
const EVENT_WEIGHTS = Object.freeze({
  LIKE: 1.25,
  SAVE: 2,
  SHARE: 2.25,
  COMMENT: 1.5,
  CREATOR_FOLLOW: 1.75,
  PROFILE_OPEN: 0.15,
  REPLAY: 0.35,
  LONG_WATCH: 0.5,
  NOT_INTERESTED: -4,
  REPORT: -5,
  CREATOR_BLOCK: -6,
  CREATOR_MUTE: -3.5,
  CREATOR_UNFOLLOW: -1.5,
  UNLIKE: -0.75,
  UNSAVE: -0.75
});
const AFFINITY_HALF_LIFE_DAYS = 14;
const COMPLETION_RATIO = 0.9;
const LABEL_THRESHOLDS = Object.freeze({ skipVisibleMs: 2000, shortViewRatio: 0.25, longViewRatio: 0.75, completeRatio: COMPLETION_RATIO });

const payloadSchema = z.object({
  visibleMs: z.number().int().nonnegative().max(30 * 60 * 1000).optional(),
  watchMs: z.number().int().nonnegative().max(60 * 60 * 1000).optional(),
  maxProgressMs: z.number().int().nonnegative().max(60 * 60 * 1000).optional(),
  replayCount: z.number().int().nonnegative().max(100).optional(),
  videoDurationMs: z.number().int().positive().max(60 * 60 * 1000).optional(),
  position: z.number().int().nonnegative().max(1000).optional()
}).strict();
const clientEventSchema = z.object({
  eventId: z.string().trim().min(1).max(128),
  type: z.enum(CLIENT_EVENT_TYPES),
  reelId: z.string().trim().min(1).max(64),
  impressionId: z.string().trim().min(1).max(64).optional(),
  sessionId: z.string().trim().min(1).max(128).optional(),
  occurredAt: z.coerce.date().optional(),
  payload: payloadSchema.optional(),
  appVersion: z.string().trim().max(32).optional()
}).strict();

function deriveCompleted(watchMs, durationMs) {
  return Number.isFinite(watchMs) && Number.isFinite(durationMs) && durationMs > 0 && watchMs >= durationMs * COMPLETION_RATIO;
}

function affinityDecay(score, lastAt, now, halfLifeDays = AFFINITY_HALF_LIFE_DAYS) {
  const previous = new Date(lastAt).getTime();
  const current = new Date(now).getTime();
  if (!Number.isFinite(score) || !Number.isFinite(previous) || !Number.isFinite(current) || !Number.isFinite(halfLifeDays) || halfLifeDays <= 0) return 0;
  const elapsedDays = Math.max(0, current - previous) / 86400000;
  return score * Math.pow(0.5, elapsedDays / halfLifeDays);
}

function clampOccurredAt(occurredAt, receivedAt = new Date()) {
  const received = new Date(receivedAt);
  const candidate = occurredAt ? new Date(occurredAt) : received;
  if (!Number.isFinite(candidate.getTime()) || candidate < new Date(received.getTime() - 86400000) || candidate > new Date(received.getTime() + 5 * 60000)) {
    return { occurredAt: received, clamped: true };
  }
  return { occurredAt: candidate, clamped: false };
}

function deriveTrainingLabels({ watchMs = 0, visibleMs = 0, videoDurationMs = null }, thresholds = LABEL_THRESHOLDS) {
  const duration = Number(videoDurationMs) || 0;
  const ratio = duration > 0 ? watchMs / duration : 0;
  return {
    skip: visibleMs < thresholds.skipVisibleMs,
    short_view: duration > 0 && ratio < thresholds.shortViewRatio,
    long_view: duration > 0 && ratio >= thresholds.longViewRatio,
    complete_view: duration > 0 && ratio >= thresholds.completeRatio
  };
}

function normalizePayload(payload = {}) {
  const normalized = { ...payload };
  const duration = payload.videoDurationMs;
  if (duration && Number.isFinite(duration)) {
    const maxWatch = Math.min(20, Math.max(1, 1 + (payload.replayCount || 0))) * duration;
    normalized.watchMs = Math.min(payload.watchMs || 0, maxWatch);
    normalized.maxProgressMs = Math.min(payload.maxProgressMs || 0, duration);
  } else {
    normalized.watchMs = Math.min(payload.watchMs || 0, 10 * 60 * 1000);
    normalized.maxProgressMs = Math.min(payload.maxProgressMs || 0, 10 * 60 * 1000);
  }
  normalized.visibleMs = Math.min(payload.visibleMs || 0, 10 * 60 * 1000);
  normalized.replayCount = Math.min(payload.replayCount || 0, 20);
  return normalized;
}

function eventWeight(type, payload = {}, durationMs = null) {
  if (type === 'WATCH_END') {
    const duration = payload.videoDurationMs || durationMs;
    return deriveCompleted(payload.watchMs || 0, duration) ? EVENT_WEIGHTS.LONG_WATCH : 0;
  }
  return EVENT_WEIGHTS[type] || 0;
}

function impressionOutcome(type) {
  return ({
    LIKE: { liked: true }, UNLIKE: { liked: false }, SAVE: { saved: true }, UNSAVE: { saved: false },
    SHARE: { shared: true }, COMMENT: { commented: true }, CREATOR_FOLLOW: { followed: true },
    CREATOR_UNFOLLOW: { followed: false }, PROFILE_OPEN: { profileOpened: true }, NOT_INTERESTED: { notInterested: true }
  })[type] || null;
}

function dailyIncrement(type, payload = {}, durationMs = null) {
  const values = {};
  if (type === 'IMPRESSION_VISIBLE') values.views = 1;
  if (type === 'WATCH_END') {
    values.watchMsSum = BigInt(payload.watchMs || 0);
    if (deriveCompleted(payload.watchMs || 0, payload.videoDurationMs || durationMs)) values.completes = 1;
  }
  if (type === 'LIKE') values.likes = 1;
  if (type === 'SAVE') values.saves = 1;
  if (type === 'SHARE') values.shares = 1;
  if (type === 'COMMENT') values.comments = 1;
  if (type === 'CREATOR_FOLLOW') values.follows = 1;
  if (type === 'NOT_INTERESTED') values.notInterested = 1;
  return values;
}

async function recordReelEvent(userId, input, { allowClientTypes = false } = {}) {
  const eventId = input.eventId || randomUUID();
  const clientTypes = new Set(CLIENT_EVENT_TYPES);
  if (allowClientTypes && !clientTypes.has(input.type)) return { accepted: false, rejected: true };
  const receivedAt = new Date();
  const { occurredAt } = clampOccurredAt(input.occurredAt, receivedAt);
  const payload = normalizePayload(input.payload || {});

  return prisma.$transaction(async (tx) => {
    const account = await tx.user.findUnique({ where: { id: userId }, select: { personalizedRecs: true } });
    if (!account || !account.personalizedRecs) return { accepted: false, disabled: true };

    let reel = null;
    if (input.reelId) {
      reel = await tx.reel.findUnique({ where: { id: input.reelId }, select: { id: true, authorId: true, durationMs: true, post: { select: { archivedAt: true } }, author: { select: { profile: { select: { visibility: true } } } } } });
      if (!reel || (reel.post?.archivedAt && reel.authorId !== userId)) return { accepted: false, rejected: true };
      if (reel.authorId !== userId) {
        if (await isBlockedBetween(userId, reel.authorId) || (await mutedIdsFor(userId)).includes(reel.authorId)) return { accepted: false, rejected: true };
        if (reel.author.profile?.visibility === 'PRIVATE') {
          const follow = await tx.follow.findUnique({ where: { followerId_followedId: { followerId: userId, followedId: reel.authorId } }, select: { accepted: true } });
          if (!follow?.accepted) return { accepted: false, rejected: true };
        }
      }
    }

    let impression = null;
    if (input.impressionId) {
      impression = await tx.reelImpression.findUnique({ where: { id: input.impressionId }, select: { id: true, userId: true, reelId: true, creatorId: true, seenAt: true, completed: true, visibleMs: true, watchMs: true, maxProgressMs: true, replayCount: true, videoDurationMs: true } });
      if (!impression || impression.userId !== userId || (input.reelId && impression.reelId !== input.reelId)) return { accepted: false, rejected: true };
      if (!reel) reel = await tx.reel.findUnique({ where: { id: impression.reelId }, select: { id: true, authorId: true, durationMs: true } });
      if (!reel) return { accepted: false, rejected: true };
    }

    const eventType = input.type;
    const creatorId = reel?.authorId || input.creatorId || null;
    const durationMs = payload.videoDurationMs || impression?.videoDurationMs || reel?.durationMs || null;
    const watchPayload = { ...payload, videoDurationMs: durationMs };
    const inserted = await tx.reelEvent.createMany({ data: [{
      eventId, type: eventType, userId, reelId: reel?.id || null, creatorId,
      impressionId: impression?.id || null, sessionId: input.sessionId || null,
      occurredAt, receivedAt, payload: watchPayload, appVersion: input.appVersion || null
    }], skipDuplicates: true });
    if (!inserted.count) return { accepted: false, duplicate: true };

    if (impression) {
      const outcome = impressionOutcome(eventType) || {};
      if (eventType === 'IMPRESSION_VISIBLE') outcome.seenAt = occurredAt;
      if (eventType === 'WATCH_END') {
        outcome.visibleMs = { increment: payload.visibleMs || 0 };
        outcome.watchMs = { increment: payload.watchMs || 0 };
        outcome.maxProgressMs = Math.max(impression.maxProgressMs, payload.maxProgressMs || 0);
        outcome.replayCount = { increment: payload.replayCount || 0 };
        outcome.videoDurationMs = durationMs;
        outcome.completed = impression.completed || deriveCompleted((impression.watchMs || 0) + (payload.watchMs || 0), durationMs);
        outcome.seenAt = impression.seenAt || occurredAt;
      }
      if (Object.keys(outcome).length) await tx.reelImpression.update({ where: { id: impression.id }, data: outcome });
    }

    const weight = eventWeight(eventType, watchPayload, durationMs);
    if (creatorId && weight) {
      const key = { userId_creatorId: { userId, creatorId } };
      const existing = await tx.userCreatorAffinity.findUnique({ where: key });
      const previousScore = existing ? affinityDecay(existing.score, existing.lastInteractionAt, occurredAt) : 0;
      const score = previousScore + weight;
      const positive = weight > 0;
      await tx.userCreatorAffinity.upsert({
        where: key,
        create: { userId, creatorId, score, positiveCount: positive ? 1 : 0, negativeCount: positive ? 0 : 1, lastInteractionAt: occurredAt },
        update: { score, positiveCount: { increment: positive ? 1 : 0 }, negativeCount: { increment: positive ? 0 : 1 }, lastInteractionAt: occurredAt }
      });
    }

    if (reel) {
      const increments = dailyIncrement(eventType, watchPayload, durationMs);
      if (Object.keys(increments).length) {
        const day = new Date(Date.UTC(occurredAt.getUTCFullYear(), occurredAt.getUTCMonth(), occurredAt.getUTCDate()));
        const update = Object.fromEntries(Object.entries(increments).map(([key, value]) => [key, { increment: value }]));
        await tx.reelStatsDaily.upsert({ where: { reelId_day: { reelId: reel.id, day } }, create: { reelId: reel.id, day, ...increments }, update });
      }
    }
    return { accepted: true, duplicate: false };
  });
}

function logReelEvent(input) {
  if (!input?.userId || !input?.type) return;
  const event = { ...input, eventId: input.eventId || randomUUID() };
  void Promise.resolve().then(() => recordReelEvent(event.userId, event)).catch(() => console.warn('[reco] event persistence failed'));
}

function logPostReelEvent(userId, postId, type, extra = {}) {
  if (!userId || !postId) return;
  void Promise.resolve().then(async () => {
    const reel = await prisma.reel.findUnique({ where: { postId }, select: { id: true } });
    if (reel) await recordReelEvent(userId, { ...extra, type, reelId: reel.id });
  }).catch(() => console.warn('[reco] event persistence failed'));
}

module.exports = {
  CLIENT_EVENT_TYPES, EVENT_WEIGHTS, AFFINITY_HALF_LIFE_DAYS, LABEL_THRESHOLDS,
  payloadSchema, clientEventSchema, deriveCompleted, affinityDecay, clampOccurredAt,
  deriveTrainingLabels, normalizePayload, eventWeight, recordReelEvent, logReelEvent, logPostReelEvent
};
