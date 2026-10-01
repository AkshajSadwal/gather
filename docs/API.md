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
| `call:start` | client → server | `{ toUserId, conversationId, type }`; verifies both conversation members, rejects busy users, persists the call, and emits `call:ring` to the callee. Type is `VOICE` or `VIDEO`. |
| `call:ring` | server → callee | `{ callId, fromUserId, fromUser, conversationId, type, status }`; contains no SDP or media data. |
| `call:accept` / `call:reject` | callee → server | `{ callId }`; serialized so only one terminal/accepted transition wins. |
| `call:cancel` | caller → server | `{ callId }`; cancels an outgoing call before acceptance. |
| `call:end` | either participant → server | `{ callId }`; ends an accepted call. During ringing it maps to caller cancellation or callee decline, and is used as best-effort page-hide cleanup. |
| `call:state` | server → participants | `{ callId, status, type, conversationId }`; status is `CALLING`, `RINGING`, `ACCEPTED`, `CONNECTING`, or `CONNECTED`. |
| `call:accepted`, `call:rejected`, `call:ended` | server → participants | Lifecycle notifications. `call:ended` includes terminal `status` and a safe `reason`. |
| `call:resume` | client → server | `{ callId }`; authenticates membership, rebinds the participant to the new socket, and resets that peer's old transports. |
| `mediasoup:get-router-capabilities` | client → server | `{ callId }`; returns `{ rtpCapabilities }` for the call router. |
| `mediasoup:create-transport` | client → server | `{ callId, direction: "send"|"recv" }`; returns `{ transport }` with ICE and DTLS parameters/candidates. Concurrent duplicate requests return the existing owned transport. |
| `mediasoup:connect-transport` | client → server | `{ callId, transportId, dtlsParameters }`; validates that the authenticated peer owns the transport. |
| `mediasoup:produce` | client → server | `{ callId, transportId, kind, rtpParameters }`; audio is required and video is allowed only in a video call. Returns producer ID. |
| `media:producer-created`, `media:producer-closed`, `media:producer-state` | server → other peer | Producer lifecycle notifications `{ callId, producerId, userId, kind, paused }`. |
| `mediasoup:consume` | client → server | `{ callId, transportId, producerId, rtpCapabilities }`; only a producer owned by the other call peer can be consumed. Consumer is created paused. |
| `mediasoup:resume-consumer`, `mediasoup:close-consumer` | client → server | `{ callId, consumerId }`; checks consumer ownership before resuming or closing. |
| `mediasoup:list-producers` | client → server | `{ callId }`; returns current remote producer metadata for missed-event/reconnect recovery. |
| `media:pause-producer`, `media:resume-producer` | client → server | `{ callId, producerId }`; only the owning peer can change microphone/camera forwarding state. |
| `peer:joined`, `peer:reconnecting`, `peer:reconnected`, `peer:left` | server → participants | Peer lifecycle updates; reconnect is bounded by `CALL_RECONNECT_GRACE_MS`. |
| `media:transport-failed` | server → owner | `{ callId, transportId, reason }`; client makes one bounded recovery attempt, then ends the call if recovery fails. |

Every client → server call event is authenticated from the Auth.js cookie, validates its payload, checks call membership, and acknowledges `{ data }` or `{ error: { code, message } }`. Transport, producer, and consumer IDs are resolved from the authenticated peer's server-side resource maps. SDP offer/answer and ICE candidate relay events are not used by the SFU implementation. Browser audio/video RTP uses mediasoup WebRTC transports and never passes through Socket.IO or PostgreSQL.

Worker/router/room/peer lifecycle, reconnect recovery, cleanup, environment values, and production port requirements are documented in [ARCHITECTURE.md](../ARCHITECTURE.md#mediasoup-sfu). The current single-process server keeps calls and presence in memory; scale-out requires distributed call state and a shared Socket.IO adapter.
