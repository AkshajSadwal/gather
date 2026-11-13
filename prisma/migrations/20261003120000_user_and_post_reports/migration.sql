-- User and post reports for the moderation/abuse-response path.
-- A report always names the account it concerns (targetUserId). For a post report,
-- targetUserId is the post author and postId identifies the post.

-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('SPAM', 'HARASSMENT', 'HATE_OR_ABUSE', 'NUDITY_OR_SEXUAL', 'VIOLENCE', 'SELF_HARM', 'IMPERSONATION', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED');

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "postId" TEXT,
    "reason" "ReportReason" NOT NULL,
    "details" VARCHAR(1000) NOT NULL DEFAULT '',
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Report_status_createdAt_idx" ON "Report"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Report_targetUserId_createdAt_idx" ON "Report"("targetUserId", "createdAt");

-- CreateIndex
CREATE INDEX "Report_postId_idx" ON "Report"("postId");

-- CreateIndex
CREATE INDEX "Report_reporterId_createdAt_idx" ON "Report"("reporterId", "createdAt");

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Defense in depth: the service already rejects self-reports; Prisma cannot model CHECK
-- constraints, so this one lives only in SQL.
ALTER TABLE "Report" ADD CONSTRAINT "Report_no_self_report_check" CHECK ("reporterId" <> "targetUserId");
