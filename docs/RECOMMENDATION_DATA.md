# Reel recommendation data contract

This document describes the first-party event and impression records used to improve reel ordering and build opt-in training exports.

## Event envelope

Client batches use `POST /reco/events` and contain at most 50 events. Every event has a caller-generated unique `eventId`, a client event `type`, and a `reelId`. `impressionId`, `sessionId`, `occurredAt`, `payload`, and `appVersion` are optional. `occurredAt` is UTC and server-clamped to the interval from 24 hours before receipt through 5 minutes after receipt. Event IDs make retries idempotent.

Client event taxonomy: `IMPRESSION_VISIBLE`, `WATCH_END`, `REPLAY`, `PROFILE_OPEN`, and `NOT_INTERESTED`. Server-generated engagement types include `LIKE`, `UNLIKE`, `SAVE`, `UNSAVE`, `SHARE`, `COMMENT`, `CREATOR_FOLLOW`, `CREATOR_UNFOLLOW`, `REPORT`, `CREATOR_BLOCK`, and `CREATOR_MUTE`.

Watch payloads may include `visibleMs`, `watchMs`, `maxProgressMs`, `replayCount`, `videoDurationMs`, and `position`. The service caps values and derives completion when watched time reaches 90% of duration. Training labels are derived at export time: skip (<2 seconds visible), short view (<25% watched), long view (>=75%), and complete view (>=90%). These thresholds are export configuration, not persisted labels.

## Privacy and retention

Reel tracking is disabled when the account has `personalizedRecs` set to false. An impression belongs to exactly one viewer; client events cannot attach to another viewer's impression. Blocked, muted, private, archived, and otherwise inaccessible reels are rejected. Reset removes the viewer's impressions, events, affinity rows, and feature snapshot and records a reset boundary. Retention is controlled by `RECO_EVENT_RETENTION_DAYS` (default 180; `0` disables event/impression cleanup).

Model-label mapping is pending because no ranker heads or model training contract exist yet. No head-specific label mapping is persisted. The export derives general behavior labels from raw event/impression records and applies privacy filters at export time.

## Training export

Run `npm run reco:export --workspace=@instagram-clone/backend -- exports/reco-training.jsonl` after applying the schema migration and generating Prisma. Optional label settings are `--skip-visible-ms`, `--short-view-ratio`, `--long-view-ratio`, and `--complete-view-ratio` (defaults: 2000, 0.25, 0.75, and 0.9). The command streams cursor batches as JSON Lines; it was added for local analyst-controlled use and is not run automatically. It exports seen impressions only, excludes accounts currently opted out and impressions that predate a later reset, uses stable opaque SHA-256 identifiers instead of database IDs/usernames, attaches impression-linked actions as outcomes, and includes only aggregate reel statistics from days before the served day. Treat the resulting file as sensitive behavioral data and keep it outside version control.
