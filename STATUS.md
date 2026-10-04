# Status

Last reviewed: 2026-10-03

## Current implementation

- JavaScript Next.js App Router frontend and separate Express/Socket.IO backend.
- PostgreSQL + Prisma relational data model with checked-in migrations.
- Auth.js credentials and Google providers with server-side session validation.
- Profiles, public/private accounts, follow requests, follower removal, following/unfollowing, posts/carousels, likes/comments/bookmarks, search/hashtags, notifications, messages/read receipts, stories, reels, and one-to-one mediasoup SFU calling.
- Private MinIO/S3-compatible media storage behind a storage service with MIME/signature/size checks. New uploads use `s3://` object references and short-lived presigned URLs; legacy `/uploads` serving remains for older local media during migration.
- Server-side block system that removes existing follow edges in both directions and blocks follow/message/call/content/media access across the blocked boundary.
- Availability endpoints have dedicated rate limiting. Notification unread totals are available to the UI so Updates can show a badge.
- Settings includes a **Blocked accounts** section (`GET /api/blocks`) where blocked accounts can be reviewed and unblocked.
- Users can **report** accounts (profile) and posts (post menu). Reports are stored privately in a `Report` table with a status workflow; repeat reports for the same open target are deduplicated and reports are rate-limited.

## Recent hardening/features

- Profile editing remains server-owned by `req.user.id`; the profile patch no longer accepts a client-controlled `avatarUrl` field.
- `authController.me` counts only accepted followers/following.
- Google account sync retries username conflicts instead of relying on `Math.random` existence checks alone.
- Notification creation suppresses notifications across a block boundary.
- Feed, explore, search, stories, reels, post detail/media access, messaging, and call initiation consult the block boundary server-side.
- Added regression coverage for block behavior and notification unread totals.

## Validation status

The source changes were reviewed for consistency and JavaScript/JSX syntax should be re-run in the user's working copy after applying this update. Full live PostgreSQL/mediasoup/Playwright validation is environment-dependent and is not claimed for this patch artifact.

## Latest pass (2026-10-03, second update)

- Added `GET /api/blocks` and the Blocked accounts section in Settings.
- Added `Report` model + migration `20261003120000_user_and_post_reports`, `POST /api/reports`, a shared `ReportDialog` component, a Report button on profiles and a "Report post" item in the post menu.
- Added integration coverage (blocked list, report validation/dedupe/visibility) and a unit test for the report payload schema.
- Validation in the packaging environment was limited to JavaScript/JSX syntax checks and a controller smoke test with an in-memory fake database. Run `npm run db:generate`, `npm run db:migrate`, `npm test`, `npm run lint` and `npm run build` in your working copy.

## Known limits

- Google OAuth needs real provider credentials to exercise the full flow.
- TURN is not configured by default.
- Presence and live call rooms are single-process in memory.
- Legacy local media migration to MinIO, object-storage lifecycle cleanup, and production-grade media processing/CDN remain follow-up work.
- Reports have no admin review UI or endpoints yet (review via the database), no reporter notifications, and no automated action on reported content.
- Comments, stories, reels and direct messages cannot be reported individually yet; report the account or the post instead.
