# API and realtime contract

Backend base URL: `http://localhost:4000`. All JSON responses use `{ "data": ... }`; failures use `{ "error": { "code": "...", "message": "...", "details": ... } }`. REST routes that require login validate the HttpOnly Auth.js cookie. IDs in write requests are checked against database ownership and membership. Local files at `/uploads/*` are also checked against their owning record and account visibility before being served; they are not unrestricted static files.

## REST endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | API and PostgreSQL connectivity |
| POST | `/api/auth/signup` | Register username, normalized email, and bcrypt password |
| POST | `/api/auth/login` | Validate credentials for the Auth.js Credentials provider |
| GET | `/api/auth/me` | Current account and counts |
| POST | `/api/auth/google-sync` | Internal-only Google account upsert; requires `x-internal-auth` |
| GET | `/api/users/check-username?username=` | Normalized username availability |
| GET | `/api/users/check-email?email=` | Normalized email availability |
| GET/PATCH | `/api/users/:username` / `/api/users/me/profile` | Read profile / update own profile |
| POST | `/api/users/me/avatar` | Upload own profile image |
| GET | `/api/users/suggestions` | Public profile suggestions |
| GET | `/api/users/:username/followers` | Accepted followers |
| GET | `/api/users/:username/following` | Accepted follows |
| POST | `/api/follows/:username/toggle` | Follow, request, cancel, or unfollow |
| GET/PATCH | `/api/follows/requests[/:id]` | Review incoming private-account follow requests |
| GET | `/api/posts/feed?cursor=&limit=` | Cursor-paginated posts from accepted follows and self |
| GET | `/api/posts/explore?cursor=&limit=` | Cursor-paginated public posts |
| POST | `/api/posts` | Create multipart image/video carousel with caption, mentions, hashtags |
| GET/DELETE | `/api/posts/:id` | Read visible post / delete own post |
| POST | `/api/posts/:id/like` | Toggle a like |
| POST | `/api/posts/:id/bookmark` | Toggle a saved post |
| GET/POST | `/api/posts/:id/comments` | List or create comments |
| DELETE | `/api/comments/:commentId` | Delete own comment |
| GET | `/api/search?q=` | Search users, hashtags, and public caption matches |
| GET/POST | `/api/notifications` / `/api/notifications/:id/read` | List and mark notifications read (`all` marks all) |
| GET | `/api/messages/conversations` | Current user's conversations and latest message |
| POST | `/api/messages/conversations/:username` | Get or create one-to-one conversation |
| GET | `/api/messages/conversations/:id?cursor=&limit=` | Persisted, paginated message history |
| POST | `/api/messages/conversations/:id/read` | Mark incoming messages as read |
| GET/POST | `/api/stories` | List active stories / create 24-hour story |
| POST/DELETE | `/api/stories/:id/view` / `/api/stories/:id` | Record a view / delete own story |
| GET | `/api/stories/:id/viewers` | Story owner views |
| GET/POST | `/api/reels` | Public/visible reels feed / create a video reel |

Profile patch accepts `displayName`, `bio`, `website`, and `visibility` (`PUBLIC` or `PRIVATE`). Follow acceptance uses `{ "accepted": true|false }`. API pagination limits are capped server-side.

## Socket.IO

Connect to the backend with credentials enabled. Socket authentication uses the same Auth.js cookie. On connection, the user joins `user:<id>` and conversation rooms they are authorized to access. Message events are persisted before broadcast.

| Event | Direction | Payload / behavior |
| --- | --- | --- |
| `user:online`, `user:offline` | server → clients | `{ userId }` presence changes |
| `presence:snapshot` | server → socket | `{ userIds: [] }` currently online users |
| `message:send` | client → server | `{ conversationId, body }`, optional ack `{ data }` / `{ error }` |
| `message:received` | server → participants | Persisted message, sender, delivery timestamp |
| `message:delivered` | server → sender | `{ conversationId, messageId }` when recipient is online |
| `message:read` | server → sender | `{ conversationId, userId, messageIds, readAt }` |
| `typing:start`, `typing:stop` | both | `{ conversationId, userId }`; server verifies membership |
| `call:offer` | client → server; server → callee | `{ toUserId, conversationId, type, offer }`; type is `VOICE` or `VIDEO` |
| `call:ringing` | server → callee | `{ callId, fromUserId, type, offer }` |
| `call:accepted` | client/server | Acceptance state notification |
| `call:answer` | client/server | `{ callId, answer }` SDP relayed to the other participant |
| `call:ice-candidate` | client/server | `{ callId, candidate }` relayed only to the other call participant |
| `call:rejected` | client/server | Callee declines; persisted as rejected |
| `call:ended` | client/server | Hangup, timeout, or disconnect cleanup |

Audio/video tracks use browser WebRTC and never pass through Socket.IO. The included single-process server keeps live calls and presence in memory; scale-out requires shared state and a Socket.IO adapter.
