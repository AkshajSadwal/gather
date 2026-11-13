# API and realtime contract

Backend base URL: `http://localhost:4000`.

JSON success responses use `{ "data": ... }`; failures use `{ "error": { "code": "...", "message": "...", "details": ... } }`.

## REST endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | API + PostgreSQL health |
| POST | `/api/auth/signup` | Register a credential account |
| POST | `/api/auth/login` | Validate credentials for Auth.js |
| POST | `/api/auth/change-password` | Change credential password (`{ currentPassword, newPassword }`); returns `reauthRequired: true`; Google-only accounts receive `PASSWORD_NOT_CONFIGURED` |
| GET | `/api/auth/me` | Current account, accepted social counts, and `isAdmin` |
| POST | `/api/auth/google-sync` | Internal Google account upsert |
| GET | `/api/users/check-username?username=` | Rate-limited username availability |
| GET | `/api/users/check-email?email=` | Rate-limited email availability |
| GET/PATCH | `/api/users/:username` / `/api/users/me/profile` | Read profile / update only current user |
| DELETE | `/api/users/me` | Permanently delete the current account and its media |
| POST | `/api/users/me/avatar` | Upload only current user's avatar |
| GET | `/api/blocks` | Accounts the current user has blocked (newest first, max 200); never lists who blocked you |
| POST | `/api/blocks/:username/toggle` | Block/unblock another account; removes mutual follow edges when blocking |
| GET | `/api/mutes` | List accounts muted by the current user (max 200, newest first) |
| POST | `/api/mutes/:username/toggle` | Mute/unmute another account; mute hides their feed posts, reels, and stories |
| POST | `/api/reports` | Report a visible post, comment, or account (`{ targetType, targetId, reason, details? }`); limited to 10/hour/account |
| GET | `/api/admin/reports?status=&cursor=&limit=` | Admin-only report queue with safe target previews and cursor pagination |
| PATCH | `/api/admin/reports/:id` | Admin-only `{ status: "REVIEWED"|"DISMISSED", removeContent? }`; records reviewer/time and can remove post/comment content |
| GET | `/api/admin/moderation-history?reportId=&cursor=&limit=` | Admin-only paginated moderation audit history; optional filter by report ID |
| GET | `/api/users/:username/followers` | Accepted followers, subject to privacy/block checks |
| GET | `/api/users/:username/following` | Accepted following, subject to privacy/block checks |
| POST | `/api/follows/:username/toggle` | Follow, request, cancel, or unfollow |
| GET/PATCH | `/api/follows/requests[/:id]` | Incoming private-account requests |
| GET | `/api/posts/feed` | Cursor-paginated feed excluding blocked and muted authors |
| GET | `/api/posts/explore` | Latest public explore feed; `sort=popular&page=1..10` ranks public posts from the last 7 days by likes (12/page) |
| GET | `/api/tags/:tag?cursor=&limit=` | Cursor-paginated posts with a hashtag; only public posts, excluding blocked and muted authors |
| GET | `/api/posts/saved?cursor=&limit=` | Current user's visible saved posts, newest saved first |
| POST | `/api/posts` | Create media post |
| GET/PATCH/DELETE | `/api/posts/:id` | Read visible post / edit own caption / delete own post |
| POST | `/api/posts/:id/like` | Toggle like |
| POST | `/api/posts/:id/bookmark` | Toggle bookmark |
| GET/POST | `/api/posts/:id/comments` | Cursor-paginated top-level comments / create a comment or one-level reply (`{ body, parentId? }`) |
| GET | `/api/comments/:commentId/replies` | Cursor-paginated replies for a top-level comment |
| DELETE | `/api/comments/:commentId` | Delete own comment or any comment on a post you own |
| GET | `/api/search?q=` | Search users/hashtags/public captions, excluding blocked accounts where applicable |
| GET | `/api/notifications` | Notification list |
| GET | `/api/notifications/unread` | Current user's unread notification total |
| GET | `/api/notifications/unread-count` | Alias for the current user's unread notification total |
| POST | `/api/notifications/:id/read` | Mark one notification or `all` as read |
| GET | `/api/messages/conversations` | User's conversations + unread counts |
| POST | `/api/messages/conversations/:username` | Open/create one-to-one conversation, blocked users rejected |
| GET | `/api/messages/conversations/:id` | Persisted messages; blocked conversations rejected |
| DELETE | `/api/messages/:messageId` | Unsend a message authored by the current user |
| POST | `/api/messages/conversations/:id/read` | Mark incoming messages read |
| GET/POST | `/api/stories` | Active stories / create story |
| POST/DELETE | `/api/stories/:id/view` / `/api/stories/:id` | Record view / delete own story |
| GET | `/api/stories/:id/viewers` | Story owner viewer list |
| GET/POST | `/api/reels` | Visible reels / create reel |

## Report rules

`POST /api/reports` takes a `targetType` (`POST`, `COMMENT`, `USER`), a database `targetId`, a `reason` (`SPAM`, `HARASSMENT`, `INAPPROPRIATE`, `IMPERSONATION`, `OTHER`) and optional `details` (max 500 characters).

- Returns `201` with `{ report, alreadyReported: false }` for a new report.
- A repeat from the same reporter for the same type and target returns `200` with the existing report and `alreadyReported: true`.
- Self-reports and reports of the reporter's own posts/comments are rejected (`CANNOT_REPORT_SELF`).
- Posts and comments can only be reported by someone allowed to view their post; accounts across a block boundary are not reportable (`POST_NOT_FOUND` / `USER_NOT_FOUND`).
- The reported account is never told who reported them. Reports have `OPEN`, `REVIEWED`, or `DISMISSED` status.
- Limited to 10 reports per hour per authenticated account.

Credential passwords must be 8–72 characters and no more than 72 UTF-8 bytes. `DELETE /api/users/me` accepts `{ confirmUsername, password? }`; password is required for credential accounts. It cascades account records, removes owned media best-effort, and disconnects the account's sockets.

Comments are returned newest first with `nextCursor`; each top-level comment includes `_count.replies` after blocked authors are filtered. Replies are limited to one level and must reference a top-level comment on the same post. Reply, comment, and mention notifications are deduplicated by recipient for each new comment; self and blocked recipients are skipped.

`PATCH /api/posts/:id` accepts `{ "caption": "..." }` up to 2200 characters and is owner-only. It replaces hashtag links, notifies only newly mentioned accounts, and syncs the linked reel caption. Saved-post pagination uses bookmark IDs as cursors and excludes posts that are no longer visible.

Reports use `OPEN`, `REVIEWED`, and `DISMISSED`. `GET /api/admin/reports` and `PATCH /api/admin/reports/:id` require a username listed in comma-separated `ADMIN_USERNAMES` (case-insensitive); an empty value grants no admin access. Admin previews do not expose reporter identity fields beyond the reporting username. The legacy `/uploads/*` media gate permits admin preview only for media attached to a post that currently has an `OPEN` report.

Every admin review creates a `REPORT_REVIEWED` audit row with moderator, report/target snapshots, previous status, new status, and timestamp. If the same decision removes a post or comment, a second `CONTENT_REMOVED` row records that action. Audit rows survive deletion of their report or moderator account using stored report and username snapshots. The history endpoint uses the standard read limit and only admins can access it.

Credential sign-in sessions include an `authAt` timestamp in the signed Auth.js JWT. After `passwordChangedAt` is set, requests and socket handshakes reject sessions with a missing or earlier `authAt`; password change returns `{ changed: true, reauthRequired: true }`.

Hashtag pages and popular Explore results respect public-account visibility and hide posts by accounts the viewer blocked or muted. Suggestion results include `mutualFollowers` and rank by mutual follows.

## Request limits

- Signup and login are limited to 30 requests per 15 minutes per authenticated account, or client IP when anonymous.
- Avatar, post, story, and reel uploads are limited to 10 per hour per account and 30 per hour per client IP. These checks run before multipart files are written to temporary storage.
- Socket.IO message sends are limited to 60 per minute per account.
- Search and username/email availability checks are limited to 60 requests per minute; notification read actions are limited to 30 per minute. Authenticated requests key limits by account, otherwise by IP. Authenticated writes and deletes use the existing 50-per-minute limit.
- Admin report listing and review use the existing read/write limits; admin access is checked separately on every request.

Upload limit responses use HTTP `429` with the standard `{ "error": { "code": "RATE_LIMITED", "message": "..." } }` envelope. Limits use the backend's in-memory rate-limit store and therefore apply per backend process.

## Block rules

Blocking is server-side. When A blocks B:

- existing follow rows between A and B are removed in both directions
- B cannot follow A and A cannot follow B
- messaging/conversation access across the pair is rejected
- call initiation across the pair is rejected
- private/public content access is rejected across the pair
- relevant notifications are suppressed
- blocked users are excluded from discovery/feeds where applicable

Unblocking does not automatically restore the previous follow relationship.

Muting is one-way and only filters that user's posts, reels, and stories from the muter's lists. It does not block access, change follows, or emit an event. The blocker receives a minimal profile with `isBlocked: true` to allow unblocking; the blocked viewer gets `USER_NOT_FOUND`.

## Socket.IO

Connect with `withCredentials: true`. Authentication comes from the Auth.js cookie. Important event families include presence, messaging/read receipts, call lifecycle, and mediasoup transport/producer/consumer negotiation.

All client → server events validate payloads and authenticate/authorize the current user. Client-supplied resource IDs never substitute for server-side ownership checks.

RTP audio/video is carried by mediasoup WebRTC transports, not Socket.IO.

`message:deleted { conversationId, messageId }` is emitted to every conversation participant after a sender unsends a message. REST responses retain the message record and `deletedAt`, but return an empty `body`; clients display “Message unsent.”

### Media delivery

`GET /api/media?key=<encoded s3://bucket/object-key>` validates the authenticated viewer's access to a media object and responds with a short-lived redirect to the private MinIO/S3-compatible object. New image/video clients should use the `url` returned by APIs through the frontend `mediaUrl()` helper rather than constructing object-storage URLs themselves.

### Comment likes and pinning
- `POST /comments/:commentId/like` — authenticated and rate limited; toggles a comment like, returns `{ liked, count }`, and notifies the author with a deduplicated `COMMENT_LIKE` notification.
- `POST /comments/:commentId/pin` — authenticated and rate limited; post owner toggles one top-level pinned comment per post. Pinning a different comment replaces the existing pin.
- Comment pages include `likeCount` and `likedByMe` without per-comment queries.

### Close Friends stories
- `GET /close-friends` — authenticated; returns the viewer's members.
- `GET /close-friends/candidates?q=` — authenticated; returns up to 50 unblocked followers or followed accounts matching the optional username query.
- `POST /close-friends/:username/toggle` — authenticated and rate limited; toggles membership. The target must follow the viewer or be followed by the viewer.
- `POST /stories` accepts optional `audience` (`EVERYONE` or `CLOSE_FRIENDS`, default `EVERYONE`). Story lists, view tracking, and media access enforce the audience.

### Story replies and message reactions
- `POST /stories/:id/reply` with `{ text }` — authenticated and rate limited; verifies story visibility, then sends a message into the sender/owner direct conversation.
- `POST /messages/:messageId/reactions` with `{ emoji }` — authenticated and rate limited; participants can toggle one supported emoji per message. Reactions are included with message pages and broadcast to participants.
- Socket `message:reaction` broadcasts `{ conversationId, messageId, userId, emoji }`; `emoji` is `null` when the reaction is removed.
- Socket `message:new` delivers story replies and shared-post messages. Story replies use notification type `STORY_REPLY` and link to Messages.

### Sharing posts and reels in Messages
- `GET /messages/share-recipients?q=` — authenticated and rate limited; searches up to 50 unblocked accounts the viewer follows or has previously messaged.
- `POST /messages/share` with `{ postId, recipientUsernames, note? }` — authenticated and rate limited; sends a linked message to one to five distinct recipients after sender post visibility and recipient message-access checks. Readers receive a compact safe preview or an unavailable placeholder.

### Reel recommendation events
- `POST /reco/events` — authenticated, limited to 120 requests per minute, accepts `{ events: [...] }` with up to 50 client events per request. Each event requires a unique `eventId`, client event `type`, and `reelId`; optional fields are `impressionId`, `requestId`, `sessionId`, `occurredAt`, `payload`, and `appVersion`. The server derives request and creator attribution from an owned impression and ignores a client request ID for persistence. Supported lifecycle types include `IMPRESSION_VIEWABLE`, `WATCH_START`, `WATCH_PROGRESS`, `WATCH_END`, and `WATCH_COMPLETE`, alongside the existing action events. Returns accepted, duplicate, and rejected counts. Events for disabled personalization, inaccessible reels, or impressions owned by another user are not stored.
- `GET /reels/feed?size=10&sessionId=&exclude=` — authenticated and rate limited; returns `{ requestId, modelVersion, provider, items }` with normal reel payloads plus `impressionId`, `position`, and `candidateSource`. `modelVersion` names the target `two_stage_v1`; `provider` reports `two_stage_v1` only when the private model service returns validated Gather candidates, otherwise `cold_start_v1`. Each served item creates a viewer-owned impression and request record. `/reels` remains available for anonymous and legacy clients.
- `PATCH /users/me/reco-settings` with `{ personalizedRecs: boolean }` — authenticated; updates the account's recommendation personalization preference.
- `POST /reco/reset` — authenticated; deletes the caller's recommendation events, impressions, creator affinities, and feature snapshot and records a reset timestamp.
- Reel like, save, comment, follow, and message-share writes may carry `X-Reco-Impression-Id` to associate the server-recorded engagement with the feed impression. The header never grants access to the referenced reel.

### Media upload validation
- Post, story, and reel upload endpoints continue to use the existing authenticated upload routes and limits.
- Uploads are accepted only when the file signature matches the declared supported image/video MIME type. Mismatches return `400 INVALID_MEDIA_CONTENT` and temporary files are removed.
