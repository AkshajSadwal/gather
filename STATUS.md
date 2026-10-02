# Status

Last reviewed: 2026-10-03

## Current implementation

- JavaScript Next.js App Router frontend and separate Express/Socket.IO backend.
- PostgreSQL + Prisma relational data model with checked-in migrations.
- Auth.js credentials and Google providers with server-side session validation.
- Profiles, public/private accounts, follow requests, follower removal, following/unfollowing, posts/carousels, likes/comments/bookmarks, search/hashtags, notifications, messages/read receipts, stories, reels, and one-to-one mediasoup SFU calling.
- Local media storage behind a storage service with MIME/signature/size checks and authorization-gated `/uploads`.
- Server-side block system that removes existing follow edges in both directions and blocks follow/message/call/content/media access across the blocked boundary.
- Availability endpoints have dedicated rate limiting. Notification unread totals are available to the UI so Updates can show a badge.

## Recent hardening/features

- Profile editing remains server-owned by `req.user.id`; the profile patch no longer accepts a client-controlled `avatarUrl` field.
- `authController.me` counts only accepted followers/following.
- Google account sync retries username conflicts instead of relying on `Math.random` existence checks alone.
- Notification creation suppresses notifications across a block boundary.
- Feed, explore, search, stories, reels, post detail/media access, messaging, and call initiation consult the block boundary server-side.
- Added regression coverage for block behavior and notification unread totals.

## Validation status

The source changes were reviewed for consistency and JavaScript/JSX syntax should be re-run in the user's working copy after applying this update. Full live PostgreSQL/mediasoup/Playwright validation is environment-dependent and is not claimed for this patch artifact.

## Known limits

- Google OAuth needs real provider credentials to exercise the full flow.
- TURN is not configured by default.
- Presence and live call rooms are single-process in memory.
- Story/file physical cleanup and production-grade media processing are still follow-up work.
- Production moderation/reporting and blocked-user management UI remain to be expanded.
