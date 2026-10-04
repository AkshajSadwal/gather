ALTER TABLE "PostMedia" ADD COLUMN "objectKey" TEXT;
ALTER TABLE "StoryMedia" ADD COLUMN "objectKey" TEXT;
ALTER TABLE "ReelMedia" ADD COLUMN "objectKey" TEXT;

-- Best-effort backfill for existing MinIO-backed media. Legacy local /uploads URLs are left NULL.
UPDATE "PostMedia"
SET "objectKey" = substring("url" from '^s3://[^/]+/(.+)$')
WHERE "objectKey" IS NULL AND "url" LIKE 's3://%';

UPDATE "StoryMedia"
SET "objectKey" = substring("url" from '^s3://[^/]+/(.+)$')
WHERE "objectKey" IS NULL AND "url" LIKE 's3://%';

UPDATE "ReelMedia"
SET "objectKey" = substring("url" from '^s3://[^/]+/(.+)$')
WHERE "objectKey" IS NULL AND "url" LIKE 's3://%';
