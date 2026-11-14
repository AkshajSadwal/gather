# Gather media storage

Local development uses MinIO in Docker as a private S3-compatible object store. Production uses a private OCI Object Storage bucket through the same S3-compatible AWS SDK; `MINIO_*` remains the application's legacy configuration prefix.

## Containers

- PostgreSQL: `localhost:5432`
- MinIO S3 API: `http://localhost:9000`
- MinIO Console: `http://localhost:9001`

The default local bucket is `gather-media`. It is created automatically by the backend during startup.

## Data split

PostgreSQL stores media metadata and an opaque object reference such as:

```text
s3://gather-media/posts/2d6b...jpg
```

The object store (local MinIO or production OCI Object Storage) stores the actual image/video bytes.

The browser does not receive media through Socket.IO and Express does not proxy the new objects. A media request goes to:

```text
GET /api/media?key=<encoded s3:// reference>
```

The backend checks ownership/privacy/block rules, then returns a short-lived presigned S3-compatible URL. The browser follows the redirect and downloads media directly from the private object store.

## Upload lifecycle

```text
Multer temp file
    ↓
signature + MIME + size validation
    ↓
Private object-store upload
    ↓
Prisma record stores object reference + metadata
    ↓
temp file deleted
```

Object prefixes:

- `avatars/`
- `posts/`
- `stories/`
- `reels/`
- `misc/`
- Existing bulk imports use `bulk-imports/<user-id>/posts/` and `bulk-imports/<user-id>/reels/`; preserve these references and their existing database rows.

## Delete lifecycle

When application data is deleted, the storage service attempts to delete the associated object. Old `/uploads/...` references are still supported for legacy local files created before this migration.

## Configuration

```env
MINIO_ENABLED=true
MINIO_ENDPOINT=http://localhost:9000
MINIO_PUBLIC_ENDPOINT=http://localhost:9000
MINIO_ACCESS_KEY=<development-only access key>
MINIO_SECRET_KEY=<development-only secret>
MINIO_BUCKET=gather-media
MINIO_REGION=us-east-1
MINIO_PRESIGN_EXPIRES_SECONDS=300
```

For production, keep the OCI bucket private. Configure the S3-compatible endpoint used for backend operations and the endpoint used to sign URLs that browsers can reach. Verify signed URL behavior against OCI before rollout. Never expose access credentials or signed URLs in browser JavaScript logs, server logs, tickets, or documentation. Do not copy local MinIO credentials into production.

## Operational hardening

Uploads are validated from a small file header buffer rather than loading the entire media file into memory just to detect its type. Temporary Multer files older than 24 hours are removed during backend startup so interrupted/crashed uploads do not accumulate indefinitely.

New immutable object keys are uploaded with long-lived `Cache-Control` metadata so an object-storage/CDN layer can cache media efficiently without requiring cache invalidation for later edits.
