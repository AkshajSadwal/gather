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

Call records hold call type and lifecycle status, not media. The socket layer checks shared conversation membership before creating a call and verifies caller/callee identity for every signal. Socket.IO relays SDP and ICE payloads only. Browser `RTCPeerConnection` carries the encrypted audio/video stream directly. An in-memory active-call registry is suitable for one backend process; a multi-instance deployment would need a shared Socket.IO adapter and distributed call/presence state.

## Media storage

Multer writes uploads to a temporary subfolder using random filenames. The storage service checks supported MIME types and file signatures, enforces image/video limits, then atomically moves the accepted file to `uploads/`. PostgreSQL stores URL, MIME type, byte size, media kind, and ordering. Local files are served through an authorization check that resolves ownership and applies post/story/reel visibility before returning media. `services/storage.js` is the replacement point for S3-compatible or managed media storage. The initial signature checks identify common formats; they are not a full antivirus or codec/transcoding pipeline.

## Deliberate limits

- The current call setup uses configurable STUN and no TURN credentials. Direct peer calls work where candidate connectivity permits; networks behind strict NAT/firewalls need a TURN service.
- Presence and active-call routing are in-memory and intended for a single backend instance.
- Stories are hidden as soon as their 24-hour `expiresAt` has passed. Physical cleanup of expired story rows and old local files can be scheduled separately.
- Google credentials and the TURN service are deployment configuration, not committed project secrets.
