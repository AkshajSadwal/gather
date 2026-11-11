# API and realtime contract

Backend base URL: `http://localhost:4000`.

JSON success responses use `{ "data": ... }`; failures use `{ "error": { "code": "...", "message": "...", "details": ... } }`.

## REST endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | API + PostgreSQL health |
| POST | `/api/auth/signup` | Register a credential account |
| POST | `/api/auth/login` | Validate credentials for Auth.js |
| POST | `/api/auth/change-password` | Change credential password (`{ currentPassword, newPassword }`); Google-only accounts receive `PASSWORD_NOT_CONFIGURED` |
| GET | `/api/auth/me` | Current account and accepted social counts |
| POST | `/api/auth/google-sync` | Internal Google account upsert |
| GET | `/api/users/check-username?username=` | Rate-limited username availability |
| GET | `/api/users/check-email?email=` | Rate-limited email availability |
| GET/PATCH | `/api/users/:username` / `/api/users/me/profile` | Read profile / update only current user |
| DELETE | `/api/users/me` | Permanently delete the current account and its media |
| DELETE | `/api/users/me` | Permanently delete the current account and its media |
| POST | `/api/users/me/avatar` | Upload only current user's avatar |
| GET | `/api/blocks` | Accounts the current user has blocked (newest first, max 200); never lists who blocked you |
| POST | `/api/blocks/:username/toggle` | Block/unblock another account; removes mutual follow edges when blocking |
| GET | `/api/mutes` | List accounts muted by the current user (max 200, newest first) |
| POST | `/api/mutes/:username/toggle` | Mute/unmute another account; mute hides their feed posts, reels, and stories |
| POST | `/api/reports` | Report a visible post, comment, or account (`{ targetType, targetId, reason, details? }`); limited to 10/hour/account |
| GET | `/api/users/:username/followers` | Accepted followers, subject to privacy/block checks |
| GET | `/api/users/:username/following` | Accepted following, subject to privacy/block checks |
| POST | `/api/follows/:username/toggle` | Follow, request, cancel, or unfollow |
| GET/PATCH | `/api/follows/requests[/:id]` | Incoming private-account requests |
| GET | `/api/posts/feed` | Cursor-paginated feed excluding blocked authors |
| GET | `/api/posts/explore` | Public explore feed excluding blocked authors |
| GET | `/api/posts/saved?cursor=&limit=` | Current user's visible saved posts, newest saved first |
| POST | `/api/posts` | Create media post |
| GET/PATCH/DELETE | `/api/posts/:id` | Read visible post / edit own caption / delete own post |
| POST | `/api/posts/:id/like` | Toggle like |
| POST | `/api/posts/:id/bookmark` | Toggle bookmark |
| GET/POST | `/api/posts/:id/comments` | Cursor-paginated top-level comments / create a comment or one-level reply (`{ body, parentId? }`) |
| GET | `/api/comments/:commentId/replies` | Cursor-paginated replies for a top-level comment |
| DELETE | `/api/comments/:commentId` | Delete own comment |
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

Comments are returned newest first with `nextCursor`; each top-level comment includes `_count.replies`. Replies are limited to one level and must reference a top-level comment on the same post. Reply, comment, and mention notifications are deduplicated by recipient for each new comment; self and blocked recipients are skipped.

`PATCH /api/posts/:id` accepts `{ "caption": "..." }` up to 2200 characters and is owner-only. It replaces hashtag links, notifies only newly mentioned accounts, and syncs the linked reel caption. Saved-post pagination uses bookmark IDs as cursors and excludes posts that are no longer visible.

There is no admin endpoint or UI yet; reports are reviewed directly in the database (`Report.status`: `OPEN`, `REVIEWING`, `RESOLVED`, `DISMISSED`).

## Request limits

- Signup and login are limited to 30 requests per 15 minutes per authenticated account, or client IP when anonymous.
- Avatar, post, story, and reel uploads are limited to 10 per hour per account and 30 per hour per client IP. These checks run before multipart files are written to temporary storage.
- Socket.IO message sends are limited to 60 per minute per account.
- Search and username/email availability checks are limited to 60 requests per minute; notification read actions are limited to 30 per minute. Authenticated requests key limits by account, otherwise by IP. Authenticated writes and deletes use the existing 50-per-minute limit.

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
