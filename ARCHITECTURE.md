# Architecture

## Services

`frontend/` is a JavaScript Next.js App Router application. It renders the Gather interface, handles page navigation and form state, and talks to the backend at `NEXT_PUBLIC_API_URL`. `backend/` is an independent Express REST API plus Socket.IO server. Prisma connects that service to PostgreSQL. Local media is written through a storage abstraction to `uploads/` and served at `/uploads`; media binaries never go into database rows.

## Authentication boundary

Auth.js is the only session authority. Its JWT session strategy produces an encrypted JWE session cookie (`authjs.session-token` for local HTTP, `__Secure-authjs.session-token` for HTTPS). The cookie is HttpOnly, SameSite=Lax, scoped to `/`, and lasts 14 days. Browser JavaScript cannot read its contents.

For credential login, the Auth.js Credentials provider calls Express from the Next.js server runtime. Express normalizes the username/email, verifies the adaptive bcrypt hash, and returns the user record without a hash. Auth.js then creates the encrypted cookie. For Google login, the Auth.js server callback asks Express to upsert a local user using `INTERNAL_AUTH_SECRET`, then stores the database user ID as the Auth.js subject. The internal header is never sent to the browser.

Browser REST calls include same-site credentials to the backend. Express uses `@auth/core/jwt` with the server-only `AUTH_SECRET` and the exact cookie name as its JWE salt to decrypt the Auth.js session. It rejects invalid or expired cookies and uses the subject as the authenticated database user ID. Socket.IO performs the same validation during its handshake. Logout is Auth.js `signOut`, which expires the HttpOnly cookie; subsequent API and socket requests are unauthorized. No backend bearer token or signing secret is exposed to browser code.

This bridge requires the frontend and API to use the same hostname so the host-only cookie is sent to both ports. Local development uses `localhost` for each. In production, place the services on the same site (or proxy the API under the frontend origin), use HTTPS, and rotate the server secrets together. `AUTH_SECRET` is a shared trust root, so protect it as carefully as a session encryption key.

## Data and authorization

Prisma models users and profiles separately and defines indexed foreign keys for follows, posts, media, likes, comments, bookmarks, hashtags, notifications, conversations, stories, reels, and call records. Username and email are normalized with Unicode NFKC and lowercase before writes and indexed unique fields enforce race-safe uniqueness. Private follows are stored as pending until the owner accepts them. Feed, story, reel, post-detail, and connection-list reads apply visibility checks on the backend.

Messages are persisted before the server broadcasts them. A conversation `directKey` is the sorted pair of user IDs and is unique for one-to-one chats. Every REST and socket action verifies conversation membership. Delivery and read receipts are associated with persisted message rows.

Call records persist participant IDs, one-to-one conversation, voice/video type, lifecycle status, timestamps, and an optional failure reason. They never contain audio/video packets or mediasoup runtime objects. The browser authenticates once using its Auth.js session cookie; the backend associates call state and every runtime resource with that authenticated database user.

## Mediasoup SFU

### Worker, room, peer, and router lifecycle

`MediaWorkerPool` starts the configured number of mediasoup workers before the backend begins listening. Worker death is logged and emitted to the media service; every room on the failed worker is closed, its call is persisted as failed, both participants receive a terminal event, and a replacement worker is started. If startup cannot create a worker, the backend does not accept traffic. SIGINT/SIGTERM closes active calls, rooms, workers, Socket.IO, and Prisma in order.

`CallService` serializes call start/accept/reject/end/resume operations. It checks that the authenticated caller and recipient are the only participants in the supplied conversation, reserves both users against simultaneous calls, and creates the persistent call row. Each active `callId` has at most one `MediaRoom`; a promise map prevents concurrent requests from creating duplicate routers. Routers are created on the selected worker only after acceptance and are closed when the call ends, times out, the worker dies, or shutdown begins.

A room owns a peer map keyed by database user ID. Each peer owns at most one send transport, one receive transport, one producer per media kind, and one consumer per producer. Creation promises deduplicate concurrent calls. Every transport is tagged server-side with call ID, user ID, and direction. Each producer/consumer lookup is made from the authenticated peer's own map; client-supplied IDs never select another participant's resources.

### Browser negotiation flow

1. `call:start` validates the two-person conversation, persists `CALLING` then `RINGING`, reserves both users, and sends `call:ring` without any SDP or media data.
2. The recipient accepts or rejects. Acceptance is serialized and persisted before either client can request media resources.
3. Each client requests router RTP capabilities and loads a `mediasoup-client` `Device`.
4. Each client creates send and receive transports. Client `connect` handlers send DTLS parameters over authenticated Socket.IO; the server validates ownership and connects the matching mediasoup transport.
5. The send transport produces the local microphone and optional camera tracks. The server announces the producer ID and media kind to the other participant.
6. The receive transport requests authorized consumers using the loaded device RTP capabilities. Consumers start paused; the browser attaches the returned track and asks the server to resume the consumer.
7. Mute/camera controls pause/resume the corresponding SFU producer and update the local track, keeping UI and server state aligned. Closing a producer automatically closes remote subscriptions.

Socket.IO carries only authentication, call lifecycle, and negotiation/control objects. RTP audio/video flows through mediasoup WebRTC transports; it never flows through Socket.IO or PostgreSQL.

### Reconnect, timeout, and failure handling

The ring timeout defaults to 45 seconds. If an accepted participant's authenticated socket disconnects, the server retains the call for the configured reconnect grace period (15 seconds by default), notifies the other peer, and closes the call if the participant does not resume. The client keeps the call ID in session storage, closes stale local transports when signaling drops, and requests `call:resume` after reconnect. The server rebinds that user to the new socket and closes their old peer transports/producers before the client renegotiates. If recovery fails, the client ends the call and stops every local track. On backend restart, any persisted nonterminal call rows are marked failed because in-memory mediasoup resources cannot be restored.

Transport ICE/DTLS failure is reported to the owning peer and triggers the same bounded resume attempt. Call termination closes consumers, producers, transports, and the router; timers are cleared and both participants receive `call:ended` plus `peer:left`. No active row can remain after a detected disconnect beyond the bounded grace period.

### Network configuration

`MEDIASOUP_WORKER_COUNT` controls worker processes. `MEDIASOUP_LISTEN_IP` is the local bind address; `MEDIASOUP_ANNOUNCED_ADDRESS` is an optional reachable address advertised to browsers. `MEDIASOUP_RTC_MIN_PORT` and `MEDIASOUP_RTC_MAX_PORT` configure the worker RTC port range. UDP/TCP and UDP preference are controlled by `MEDIASOUP_ENABLE_UDP`, `MEDIASOUP_ENABLE_TCP`, and `MEDIASOUP_PREFER_UDP`. `CALL_RING_TIMEOUT_MS` and `CALL_RECONNECT_GRACE_MS` configure bounded call timers. The defaults bind to `127.0.0.1` for same-machine development and do not include a public IP.

Production must expose the selected interface and RTC UDP/TCP port range through host/container firewalls and any network security groups. Set an externally reachable `MEDIASOUP_ANNOUNCED_ADDRESS`; do not hard-code it. The current in-memory room registry and Socket.IO process support one backend instance. Multi-instance operation needs distributed call/presence coordination and a shared Socket.IO adapter; mediasoup workers remain local to their owning process.

## Media storage

Multer writes uploads to a temporary subfolder using random filenames. The storage service checks supported MIME types and file signatures, enforces image/video limits, then atomically moves the accepted file to `uploads/`. PostgreSQL stores URL, MIME type, byte size, media kind, and ordering. Local files are served through an authorization check that resolves ownership and applies post/story/reel visibility before returning media. `services/storage.js` is the replacement point for S3-compatible or managed media storage. The initial signature checks identify common formats; they are not a full antivirus or codec/transcoding pipeline.

## Deliberate limits

- The current call setup uses configurable STUN and no TURN credentials. Direct peer calls work where candidate connectivity permits; networks behind strict NAT/firewalls need a TURN service.
- Presence and active-call routing are in-memory and intended for a single backend instance.
- Stories are hidden as soon as their 24-hour `expiresAt` has passed. Physical cleanup of expired story rows and old local files can be scheduled separately.
- Google credentials and the TURN service are deployment configuration, not committed project secrets.
