# Gather media storage

Local development uses MinIO in Docker as a private S3-compatible object store.

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

MinIO stores the actual image/video bytes.

The browser does not receive media through Socket.IO and Express does not proxy the new objects. A media request goes to:

```text
GET /api/media?key=<encoded s3:// reference>
```

The backend checks ownership/privacy/block rules, then returns a short-lived presigned MinIO URL. The browser follows the redirect and downloads the media directly from MinIO.

## Upload lifecycle

```text
Multer temp file
    ↓
signature + MIME + size validation
    ↓
MinIO upload
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

## Delete lifecycle

When application data is deleted, the storage service attempts to delete the associated MinIO object. Old `/uploads/...` references are still supported for legacy local files created before this migration.

## Configuration

```env
MINIO_ENABLED=true
MINIO_ENDPOINT=http://localhost:9000
MINIO_PUBLIC_ENDPOINT=http://localhost:9000
MINIO_ACCESS_KEY=gatheradmin
MINIO_SECRET_KEY=gather_dev_storage_password
MINIO_BUCKET=gather-media
MINIO_REGION=us-east-1
MINIO_PRESIGN_EXPIRES_SECONDS=300
```

For production, keep the bucket private and replace the local MinIO endpoint with private/internal and publicly reachable object/CDN endpoints as appropriate. Never expose the access or secret key to browser JavaScript.
