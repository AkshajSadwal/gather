-- CreateEnum
CREATE TYPE "ReportTargetType" AS ENUM ('POST', 'COMMENT', 'USER');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'REPLY';

-- AlterEnum
BEGIN;
CREATE TYPE "ReportReason_new" AS ENUM ('SPAM', 'HARASSMENT', 'INAPPROPRIATE', 'IMPERSONATION', 'OTHER');
ALTER TABLE "Report" ALTER COLUMN "reason" TYPE "ReportReason_new" USING (CASE WHEN "reason"::text IN ('HATE_OR_ABUSE', 'NUDITY_OR_SEXUAL', 'VIOLENCE', 'SELF_HARM') THEN 'INAPPROPRIATE' ELSE "reason"::text END::"ReportReason_new");
ALTER TYPE "ReportReason" RENAME TO "ReportReason_old";
ALTER TYPE "ReportReason_new" RENAME TO "ReportReason";
DROP TYPE "ReportReason_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "ReportStatus_new" AS ENUM ('OPEN', 'REVIEWED', 'DISMISSED');
ALTER TABLE "Report" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Report" ALTER COLUMN "status" TYPE "ReportStatus_new" USING (CASE WHEN "status"::text IN ('REVIEWING', 'RESOLVED') THEN 'REVIEWED' ELSE "status"::text END::"ReportStatus_new");
ALTER TYPE "ReportStatus" RENAME TO "ReportStatus_old";
ALTER TYPE "ReportStatus_new" RENAME TO "ReportStatus";
DROP TYPE "ReportStatus_old";
ALTER TABLE "Report" ALTER COLUMN "status" SET DEFAULT 'OPEN';
COMMIT;

-- DropForeignKey
ALTER TABLE "Report" DROP CONSTRAINT "Report_targetUserId_fkey";

-- DropForeignKey
ALTER TABLE "Report" DROP CONSTRAINT "Report_postId_fkey";

-- DropIndex
DROP INDEX "Report_targetUserId_createdAt_idx";

-- DropIndex
DROP INDEX "Report_postId_idx";

-- DropIndex
DROP INDEX "Report_reporterId_createdAt_idx";

-- AlterTable
UPDATE "Report" SET "details" = LEFT("details", 500) WHERE LENGTH("details") > 500;

ALTER TABLE "Report" DROP COLUMN "updatedAt",
ADD COLUMN     "targetId" TEXT,
ADD COLUMN     "targetType" "ReportTargetType",
ALTER COLUMN "details" DROP NOT NULL,
ALTER COLUMN "details" DROP DEFAULT,
ALTER COLUMN "details" SET DATA TYPE VARCHAR(500);

UPDATE "Report" SET "targetType" = CASE WHEN "postId" IS NULL THEN 'USER'::"ReportTargetType" ELSE 'POST'::"ReportTargetType" END,
"targetId" = COALESCE("postId", "targetUserId");

DELETE FROM "Report" report USING (
    SELECT "id", ROW_NUMBER() OVER (PARTITION BY "reporterId", "targetType", "targetId" ORDER BY "createdAt" DESC, "id" DESC) AS duplicate_rank
    FROM "Report"
) ranked WHERE report."id" = ranked."id" AND ranked.duplicate_rank > 1;

ALTER TABLE "Report" DROP COLUMN "targetUserId",
DROP COLUMN "postId",
ALTER COLUMN "targetId" SET NOT NULL,
ALTER COLUMN "targetType" SET NOT NULL;

-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "parentId" TEXT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Mute" (
    "id" TEXT NOT NULL,
    "muterId" TEXT NOT NULL,
    "mutedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Mute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Mute_muterId_createdAt_idx" ON "Mute"("muterId", "createdAt");

-- CreateIndex
CREATE INDEX "Mute_mutedId_createdAt_idx" ON "Mute"("mutedId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Mute_muterId_mutedId_key" ON "Mute"("muterId", "mutedId");

-- CreateIndex
CREATE INDEX "Block_blockerId_createdAt_idx" ON "Block"("blockerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Report_reporterId_targetType_targetId_key" ON "Report"("reporterId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "Comment_postId_parentId_createdAt_idx" ON "Comment"("postId", "parentId", "createdAt");

-- AddForeignKey
ALTER TABLE "Mute" ADD CONSTRAINT "Mute_muterId_fkey" FOREIGN KEY ("muterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mute" ADD CONSTRAINT "Mute_mutedId_fkey" FOREIGN KEY ("mutedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

