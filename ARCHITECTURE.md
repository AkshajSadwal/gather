# Architecture

## Runtime

```text
Browser
  ├─ Next.js / React UI
  ├─ Auth.js session cookie
  ├─ REST requests ───────────────► Express
  └─ Socket.IO control/signaling ─► Express + Socket.IO
                                      │
                                      ├─ Prisma ─► PostgreSQL
                                      └─ mediasoup ─► WebRTC RTP

Actual image/video files ─► local storage in development ─► object storage/CDN later
```

## Authentication boundary

Auth.js is the only browser-session authority. The session is an encrypted JWT/JWE in an HttpOnly, SameSite cookie. The backend validates the exact configured Auth.js cookie and uses its verified `sub` as the database user ID. Legacy cookie names are rejected. Socket.IO performs the same validation in its handshake.

Credentials login delegates password verification to Express. Google sign-in calls an internal backend account-sync route protected by `INTERNAL_AUTH_SECRET`; that header exists only on the server side.

The frontend/backend local topology uses the same host (`localhost`) on different ports. Production should use a same-site HTTPS topology or proxy the API under the frontend origin.

## Relational data

PostgreSQL is the system of record. Prisma provides the JavaScript data access layer.

Key rules:
- `User.username` and `User.email` are normalized and database-unique.
- `Follow(followerId, followedId)` is unique; `accepted=false` represents a private-account request.
- `Block(blockerId, blockedId)` is unique and is used to enforce an interaction/privacy boundary.
- `Report(reporterId, targetUserId, postId?)` stores private user/post reports with a `status` workflow (`OPEN` → `REVIEWING` → `RESOLVED`/`DISMISSED`). Post reports also set `targetUserId` to the post author so all reports about an account can be queried together.
- Post/media, story/media, and reel/media are separate tables so one content item can own multiple media records.
- Messages are stored before Socket.IO broadcast.
- `MessageRead` stores per-user read state.
- Call records store metadata only; mediasoup runtime objects remain in memory.

## Blocks and privacy

`services/blocks.js` centralizes block-state checks. A block is reciprocal for application behavior: either direction blocks follow, messaging, calling, story viewing, post access, media access, and relevant discovery. Creating a block also removes existing follow rows in both directions so previously granted social access cannot remain active through a stale relationship.

This is deliberately enforced server-side. Hiding buttons in React is not considered authorization.

## Mediasoup SFU

Each accepted one-to-one call gets an in-memory media room backed by a mediasoup router. Each peer owns at most one send transport, one receive transport, one producer per media kind, and one consumer per remote producer. Promise maps serialize concurrent creation so duplicate transport/producer/consumer requests do not create duplicate resources.

Flow:
1. authenticate socket
2. create/persist call lifecycle
3. accept call
4. get router RTP capabilities
5. load client `Device`
6. create send/receive transports
7. connect transports with DTLS parameters
8. produce microphone/camera
9. announce producers
10. create authorized consumers
11. resume consumers after the browser attaches tracks
12. pause/resume producers for mute/camera controls
13. clean up resources on leave/failure/reconnect

Socket.IO carries only control/negotiation metadata. RTP audio/video is routed by mediasoup WebRTC transports.

## Reconnect and failure handling

The call service serializes lifecycle transitions. Accepted calls have a bounded reconnect grace period. A reconnect closes the peer's stale media resources and rebinds it to the new socket before renegotiation. Worker failure marks affected persisted calls failed and closes their in-memory rooms.

## Media storage

Multer first writes a random temporary upload under `uploads/.tmp`. `services/storage.js` checks file signatures against the declared MIME type, enforces per-kind byte limits, then uploads the accepted file into a private MinIO/S3-compatible bucket. PostgreSQL stores only media metadata plus an `s3://bucket/object-key` reference.

New browser media URLs go through `GET /api/media?key=...`; the backend authenticates/authorizes access using the post/story/reel/profile owner and privacy/block rules, then returns a short-lived presigned object-storage URL. The browser therefore downloads media directly from MinIO rather than making Express proxy the video/image bytes. Legacy `/uploads/*` remains only for older files created before the MinIO migration.

## Security layers

- request validation with Zod
- authentication middleware
- server-side ownership/membership checks
- rate limits for auth, availability checks, and writes
- Helmet + CORS
- bounded request body and socket message sizes
- upload signature/MIME/size validation
- HttpOnly session cookies
- no secret values in frontend bundles
- block enforcement across social/realtime/media access
- generic production error responses

## Scaling boundary

The current design intentionally supports one backend instance. Presence, busy-call state, and mediasoup rooms are in memory. A multi-instance deployment needs a shared Socket.IO adapter and distributed coordination for presence/call ownership. Mediasoup workers remain attached to their owning backend process.

## Kubernetes packaging

The repository includes container images and a Kubernetes baseline. The backend remains a single replica because mediasoup rooms, active calls, presence, and busy-user state are process-local. The backend uses `hostNetwork` for direct mediasoup RTC port binding; `MEDIASOUP_ANNOUNCED_ADDRESS` must be browser-reachable. PostgreSQL and MinIO are represented as single-replica StatefulSets with persistent volumes for local/small deployments; serious production should prefer managed HA database/object storage.
