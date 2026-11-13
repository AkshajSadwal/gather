-- CreateEnum
CREATE TYPE "ModerationActionType" AS ENUM ('REPORT_REVIEWED', 'CONTENT_REMOVED');

-- CreateTable
CREATE TABLE "ModerationAction" (
    "id" TEXT NOT NULL,
    "reportId" TEXT,
    "reportRef" TEXT NOT NULL,
    "targetType" "ReportTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" "ReportReason" NOT NULL,
    "moderatorId" TEXT,
    "moderatorUsername" VARCHAR(30) NOT NULL,
    "action" "ModerationActionType" NOT NULL,
    "previousStatus" "ReportStatus",
    "newStatus" "ReportStatus",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ModerationAction_reportRef_createdAt_idx" ON "ModerationAction"("reportRef", "createdAt");

-- CreateIndex
CREATE INDEX "ModerationAction_moderatorId_createdAt_idx" ON "ModerationAction"("moderatorId", "createdAt");

-- CreateIndex
CREATE INDEX "ModerationAction_createdAt_id_idx" ON "ModerationAction"("createdAt", "id");

-- AddForeignKey
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_moderatorId_fkey" FOREIGN KEY ("moderatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

