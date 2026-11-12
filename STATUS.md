# Status

Last reviewed: 2026-11-12

## Current implementation

- JavaScript Next.js App Router frontend and separate Express/Socket.IO backend.
- PostgreSQL + Prisma relational data model with checked-in migrations.
- Auth.js credentials and Google providers with server-side session validation.
- Profiles, public/private accounts, follow requests, follower removal, following/unfollowing, posts/carousels, likes/comments/bookmarks, search/hashtags, notifications, messages/read receipts, stories, reels, and one-to-one mediasoup SFU calling.
- Private MinIO/S3-compatible media storage behind a storage service with MIME/signature/size checks. New uploads use `s3://` object references and short-lived presigned URLs; legacy `/uploads` serving remains for older local media during migration.
- Server-side block system that removes existing follow edges in both directions and blocks follow/message/call/content/media access across the blocked boundary.
- Availability endpoints have dedicated rate limiting. Notification unread totals are available to the UI so Updates can show a badge.
- Signup/login and Socket.IO message sends are rate-limited; avatar, post, story, and reel uploads now have per-account and per-IP hourly limits before multipart parsing.
- Notifications deduplicate identical unread events, expose an unread-count alias, and link to their target. Account owners can remove comments from their posts; rate limits cover search, reads, deletes, and authenticated-account keys.
- Mute preferences hide selected accounts' feed posts, reels, and stories. Blocked profiles return a minimal unblock view to the blocker and 404 to the blocked viewer.
- Comments support cursor pagination, one-level replies, comment mentions, replies notifications, and a shared panel across posts and reels.
- Own profiles have a Saved tab; post owners can edit captions, re-sync hashtags, and notify newly added mentions.
- Message senders can unsend their messages; REST previews redact the body and participants receive `message:deleted` in real time.
- Settings supports password changes and confirmed account deletion; a periodic cleanup removes expired stories, stale temporary files, and old read notifications.
- Settings includes a **Blocked accounts** section (`GET /api/blocks`) where blocked accounts can be reviewed and unblocked.
- Users can **report** accounts, posts, and comments. Reports are private, deduplicated per reporter/target, and limited to 10 per hour per account.

## Recent hardening/features

- Profile editing remains server-owned by `req.user.id`; the profile patch no longer accepts a client-controlled `avatarUrl` field.
- `authController.me` counts only accepted followers/following.
- Google account sync retries username conflicts instead of relying on `Math.random` existence checks alone.
- Notification creation suppresses notifications across a block boundary.
- Feed, explore, search, stories, reels, post detail/media access, messaging, and call initiation consult the block boundary server-side.
- Added regression coverage for block behavior and notification unread totals.

## Validation status

Backend syntax checks, frontend lint, and Prisma schema validation pass. PostgreSQL integration tests, mediasoup behavior, and Playwright were not run in this environment.

## Latest pass (2026-10-03, second update)

- Added `GET /api/blocks` and the Blocked accounts section in Settings.
- Added `Report` model + migration `20261003120000_user_and_post_reports`, `POST /api/reports`, a shared `ReportDialog` component, a Report button on profiles and a "Report post" item in the post menu.
- Added integration coverage (blocked list, report validation/dedupe/visibility) and a unit test for the report payload schema.
- Validation in the packaging environment was limited to JavaScript/JSX syntax checks and a controller smoke test with an in-memory fake database. Run `npm run db:generate`, `npm run db:migrate`, `npm test`, `npm run lint` and `npm run build` in your working copy.

## Known limits

- Google OAuth needs real provider credentials to exercise the full flow.
- TURN is not configured by default.
- Presence and live call rooms are single-process in memory.
- Legacy local media migration to MinIO, lifecycle policies for orphaned object-storage keys, and production-grade media processing/CDN remain follow-up work.
- Stories, reels, and direct messages cannot be reported individually yet; posts, comments, and accounts can be reported.

## Latest infrastructure pass (2026-10-04)

- Added Kubernetes liveness/readiness endpoints (`/health/live`, `/health/ready`) and deployment probes.
- Added container build files for the backend and Next.js frontend; frontend now uses Next.js standalone output for container packaging.
- Added Kubernetes baseline manifests for PostgreSQL, MinIO AIStor, the single backend replica, frontend, and a separate migration Job.
- Hardened uploads so media-type detection reads only a bounded header buffer instead of loading an entire video/image into memory.
- Added startup cleanup for stale Multer temporary uploads and immutable-object cache metadata for new MinIO objects.

## Latest feature pass (2026-11-12)

- Added account/IP request limits, unread notification links and count, comment owner deletion, block/mute controls, visible-target reporting, paginated replies, saved posts, editable captions, message unsend, account management, and scheduled cleanup.
- Added schema migration `20261112000000_blocks_reports_replies` and compact feature integration coverage. Prisma validate and workspace lint passed; PostgreSQL integration and E2E tests were not run.

## Round 2 feature pass (2026-11-12)

- Added password-change session revocation and migration `20261113000000_password_changed_and_report_review` with report reviewer metadata.
- Added an admin report queue configured by `ADMIN_USERNAMES`, including status updates and optional post/comment removal with media cleanup.
- Added public hashtag pages, the popular-this-week Explore tab, mutual-follower-ranked suggestions, blocked-comment filtering, 30-second session existence caching, and deleted-message unread count fixes.
- Backend and frontend lint plus Prisma validation passed. Integration tests were added but not run; a local database, Prisma client generation, and migrations are still required.

## Moderation audit history

- Added transactional audit records for report decisions and post/comment removal, with moderator and report snapshots that remain after related records are deleted.
- Added the admin-only paginated moderation-history endpoint and responsive history page. Prisma validation, backend lint, frontend lint, and targeted Node syntax checks passed; the database integration test was added but not run.

## Round 4 social features

- Added post pin/archive controls, Close Friends audiences and story rings, comment likes/pins, story replies, realtime message reactions, and multi-recipient post/reel sharing in Messages.
- Prisma schema changes are in migration `20261115000000_close_friends_pins_reactions`; the migration has not been applied or generated against the local database by this development session.
- Backend and frontend lint, Prisma validation, targeted syntax checks, and 9 unit tests passed. The production build compiled and generated static pages, then failed while copying traces into `frontend/.next/standalone` with Windows `EPERM`; integration tests were added but not run because they need PostgreSQL.

## Round 5 recommendation data foundation

- Added migration `20261116000000_reel_reco_events` for viewer-owned reel impressions/events, creator affinities, feature snapshots, and daily reel statistics.
- Added the `heuristic_v0` personalized feed, bounded idempotent event ingestion, opt-out/reset controls, batched feature snapshots, retention cleanup, and local JSONL training export. Recommendation event and impression privacy rules are documented in `docs/RECOMMENDATION_DATA.md`.
- Backend/frontend syntax lint and feature unit coverage were added; PostgreSQL integration and export runs were intentionally not run because they require a migrated local database.
