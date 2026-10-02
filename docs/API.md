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
| POST | `/api/blocks/:username/toggle` | Block/unblock another account; removes mutual follow edges when blocking |
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
