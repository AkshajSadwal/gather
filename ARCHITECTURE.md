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
- `Report(reporterId, targetType, targetId)` stores private post/comment/user reports with `OPEN`, `REVIEWED`, or `DISMISSED` status and a unique reporter/target key.
- `Comment.parentId` supports one level of replies; `Message.deletedAt` retains an unsent message record while REST responses redact its body.
- Post/media, story/media, and reel/media are separate tables so one content item can own multiple media records.
- Messages are stored before Socket.IO broadcast.
- `MessageRead` stores per-user read state.
- Call records store metadata only; mediasoup runtime objects remain in memory.

## Blocks and privacy

`services/relations.js` centralizes block and mute lookups. A block is reciprocal for application behavior: either direction blocks follow, messaging, calling, story viewing, post access, media access, and relevant discovery. Creating a block also removes existing follow rows in both directions so previously granted social access cannot remain active through a stale relationship. A mute only hides the selected account's posts, reels, and stories from the muter's lists; it does not change follows or access rights.

Reports can target posts, comments, or accounts visible to the reporter. The reporter cannot report themselves or their own content. Duplicate reports are unique per reporter and target; moderator review tooling is not implemented.

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

`services/cleanup.js` periodically removes stories expired for more than one hour and their media, temporary upload files older than one hour, and read notifications older than 90 days. `CLEANUP_INTERVAL_MS` defaults to 30 minutes; the timer is unreferenced, skipped in tests, and cleared during shutdown.

Admin access is configured by normalized usernames in `ADMIN_USERNAMES`. The admin report queue records review status, reviewer, and review time; post deletion shares the same media cleanup helper as owner deletion. Hashtag pages and popular Explore queries filter private, blocked, and muted authors before returning posts.

Admin report decisions and content removals write `ModerationAction` rows inside the same database transaction as the report update/content deletion. Each row stores report and moderator snapshots; nullable foreign keys use `SET NULL` so deleting a report or moderator does not erase the history. The admin-only history API reads these rows with cursor pagination and no per-row lookups.

Sessions are checked against a 30-second in-process user-existence cache shared by HTTP and Socket.IO authentication. Password changes record `passwordChangedAt`; sessions without a newer `authAt` are rejected, and account deletion/password changes invalidate the local cache entry immediately.

## Security layers

- request validation with Zod
- in-process rate limits keyed by account when authenticated and IP otherwise; upload caps also include a separate per-IP limit
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

## Round 4 social features

Posts can be pinned (up to three per owner) or archived. Archived posts are excluded from public grids, feeds, discovery, tags, saved posts, reels, search, and shared-post previews; owners can view and restore their own archive. Top-level comments support likes and one post-owner pin, with viewer like state and counts loaded in bounded page queries.

Close Friends membership is stored per owner/target pair. Story audience checks are applied in the story list, view tracking, and media authorization. A membership change or block takes effect immediately; blocking removes Close Friends rows in both directions. Close-friends stories use a distinct green ring.

Story replies become direct messages that retain a short story caption preview after the story expires. Message reactions are persisted per message/user and broadcast as participant-scoped `message:reaction` updates. Sharing a post or reel creates one linked message per selected recipient; recipient payloads are shaped against current block, archive, and private-account visibility, and unavailable posts return a placeholder.

## Round 5 recommendations and moderation

Block and mute relations are account-to-account rows with indexes in both directions. Blocks remove follow and Close Friends relations and are enforced across content, messaging, media, and calls; mutes filter feed, reels, and stories without notifying the muted account. Reports are unique per reporter/target and remain queued for admin review; user-facing report creation exists, while broader moderation tooling remains follow-up work.

Reel recommendation serving is behind a provider interface (`services/recommender`) with `heuristic_v0` as the default. It filters private, archived, blocked, muted, and recently served reels, applies a two-per-creator cap, and records viewer-owned impressions only when personalization is enabled. Event ingestion is idempotent, event payloads are bounded, and affinity scores decay with a 14-day half-life. Grouped feature snapshots run on a configurable timer. Reset deletes viewer activity and affinities; account erasure cascades viewer-owned data. Cleanup removes expired stories, temporary uploads, old read notifications, and recommendation events/impressions according to retention settings.

Training export streams seen impressions in cursor batches, excludes currently opted-out users and rows older than a later reset, replaces database identifiers with stable opaque IDs, and includes aggregate reel stats only from before the served day. Behavior labels are derived at export time; model-specific label mapping is pending until ranker heads are defined.
