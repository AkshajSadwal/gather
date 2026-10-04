# API and realtime contract

Backend base URL: `http://localhost:4000`.

JSON success responses use `{ "data": ... }`; failures use `{ "error": { "code": "...", "message": "...", "details": ... } }`.

## REST endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | API + PostgreSQL health |
| POST | `/api/auth/signup` | Register a credential account |
| POST | `/api/auth/login` | Validate credentials for Auth.js |
| GET | `/api/auth/me` | Current account and accepted social counts |
| POST | `/api/auth/google-sync` | Internal Google account upsert |
| GET | `/api/users/check-username?username=` | Rate-limited username availability |
| GET | `/api/users/check-email?email=` | Rate-limited email availability |
| GET/PATCH | `/api/users/:username` / `/api/users/me/profile` | Read profile / update only current user |
| POST | `/api/users/me/avatar` | Upload only current user's avatar |
| GET | `/api/blocks` | Accounts the current user has blocked (newest first, max 200); never lists who blocked you |
| POST | `/api/blocks/:username/toggle` | Block/unblock another account; removes mutual follow edges when blocking |
| POST | `/api/reports` | Report an account (`{ username, reason, details? }`) or a post (`{ postId, reason, details? }`); rate-limited |
| GET | `/api/users/:username/followers` | Accepted followers, subject to privacy/block checks |
| GET | `/api/users/:username/following` | Accepted following, subject to privacy/block checks |
| POST | `/api/follows/:username/toggle` | Follow, request, cancel, or unfollow |
| GET/PATCH | `/api/follows/requests[/:id]` | Incoming private-account requests |
| GET | `/api/posts/feed` | Cursor-paginated feed excluding blocked authors |
| GET | `/api/posts/explore` | Public explore feed excluding blocked authors |
| POST | `/api/posts` | Create media post |
| GET/DELETE | `/api/posts/:id` | Read visible post / delete own post |
| POST | `/api/posts/:id/like` | Toggle like |
| POST | `/api/posts/:id/bookmark` | Toggle bookmark |
| GET/POST | `/api/posts/:id/comments` | List/create comments |
| DELETE | `/api/comments/:commentId` | Delete own comment |
| GET | `/api/search?q=` | Search users/hashtags/public captions, excluding blocked accounts where applicable |
| GET | `/api/notifications` | Notification list |
| GET | `/api/notifications/unread` | Current user's unread notification total |
| POST | `/api/notifications/:id/read` | Mark one notification or `all` as read |
| GET | `/api/messages/conversations` | User's conversations + unread counts |
| POST | `/api/messages/conversations/:username` | Open/create one-to-one conversation, blocked users rejected |
| GET | `/api/messages/conversations/:id` | Persisted messages; blocked conversations rejected |
| POST | `/api/messages/conversations/:id/read` | Mark incoming messages read |
| GET/POST | `/api/stories` | Active stories / create story |
| POST/DELETE | `/api/stories/:id/view` / `/api/stories/:id` | Record view / delete own story |
| GET | `/api/stories/:id/viewers` | Story owner viewer list |
| GET/POST | `/api/reels` | Visible reels / create reel |

## Report rules

`POST /api/reports` takes exactly one target (`username` or `postId`), a `reason` (`SPAM`, `HARASSMENT`, `HATE_OR_ABUSE`, `NUDITY_OR_SEXUAL`, `VIOLENCE`, `SELF_HARM`, `IMPERSONATION`, `OTHER`) and optional `details` (max 1000 characters).

- Returns `201` with `{ report, duplicate: false }` for a new report.
- If the same reporter already has an open (`OPEN`/`REVIEWING`) report for the same target, returns `200` with the existing report and `duplicate: true` rather than creating another.
- Self-reports are rejected (`CANNOT_REPORT_SELF`).
- A post can only be reported by someone allowed to view it, so reports cannot probe private posts or content across a block boundary (`PRIVATE_ACCOUNT` / `BLOCKED`).
- The reported account is never told who reported them. A post report also records the post author as the report's `targetUserId`.
- Limited to 20 reports per hour per client.

There is no admin endpoint or UI yet; reports are reviewed directly in the database (`Report.status`: `OPEN`, `REVIEWING`, `RESOLVED`, `DISMISSED`).

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

## Socket.IO

Connect with `withCredentials: true`. Authentication comes from the Auth.js cookie. Important event families include presence, messaging/read receipts, call lifecycle, and mediasoup transport/producer/consumer negotiation.

All client → server events validate payloads and authenticate/authorize the current user. Client-supplied resource IDs never substitute for server-side ownership checks.

RTP audio/video is carried by mediasoup WebRTC transports, not Socket.IO.

### Media delivery

`GET /api/media?key=<encoded s3://bucket/object-key>` validates the authenticated viewer's access to a media object and responds with a short-lived redirect to the private MinIO/S3-compatible object. New image/video clients should use the `url` returned by APIs through the frontend `mediaUrl()` helper rather than constructing object-storage URLs themselves.
