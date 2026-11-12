-- CreateEnum
CREATE TYPE "ReelCandidateSource" AS ENUM ('FOLLOWING', 'POPULAR', 'FRESH', 'EXPLORE', 'AFFINITY', 'MODEL1');

-- CreateEnum
CREATE TYPE "ReelEventType" AS ENUM ('IMPRESSION_VISIBLE', 'WATCH_END', 'REPLAY', 'LIKE', 'UNLIKE', 'SAVE', 'UNSAVE', 'SHARE', 'COMMENT', 'CREATOR_FOLLOW', 'CREATOR_UNFOLLOW', 'PROFILE_OPEN', 'NOT_INTERESTED', 'REPORT', 'CREATOR_BLOCK', 'CREATOR_MUTE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "personalizedRecs" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "recsResetAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Reel" ADD COLUMN     "durationMs" INTEGER,
ADD COLUMN     "language" VARCHAR(8);

-- CreateTable
CREATE TABLE "ReelImpression" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reelId" TEXT NOT NULL,
    "creatorId" TEXT,
    "sessionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "servedAt" TIMESTAMP(3) NOT NULL,
    "seenAt" TIMESTAMP(3),
    "visibleMs" INTEGER NOT NULL DEFAULT 0,
    "watchMs" INTEGER NOT NULL DEFAULT 0,
    "maxProgressMs" INTEGER NOT NULL DEFAULT 0,
    "replayCount" INTEGER NOT NULL DEFAULT 0,
    "videoDurationMs" INTEGER,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "candidateSource" "ReelCandidateSource" NOT NULL,
    "retrievalScore" DOUBLE PRECISION,
    "rankingScore" DOUBLE PRECISION,
    "modelVersion" VARCHAR(64),
    "experimentId" VARCHAR(64),
    "appVersion" VARCHAR(32),
    "userFeaturesSnapshot" JSONB,
    "liked" BOOLEAN NOT NULL DEFAULT false,
    "saved" BOOLEAN NOT NULL DEFAULT false,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "commented" BOOLEAN NOT NULL DEFAULT false,
    "followed" BOOLEAN NOT NULL DEFAULT false,
    "profileOpened" BOOLEAN NOT NULL DEFAULT false,
    "notInterested" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ReelImpression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReelEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" "ReelEventType" NOT NULL,
    "userId" TEXT NOT NULL,
    "reelId" TEXT,
    "creatorId" TEXT,
    "impressionId" TEXT,
    "sessionId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB,
    "appVersion" VARCHAR(32),

    CONSTRAINT "ReelEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserCreatorAffinity" (
    "userId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "positiveCount" INTEGER NOT NULL DEFAULT 0,
    "negativeCount" INTEGER NOT NULL DEFAULT 0,
    "lastInteractionAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserCreatorAffinity_pkey" PRIMARY KEY ("userId","creatorId")
);

-- CreateTable
CREATE TABLE "UserRecoFeatures" (
    "userId" TEXT NOT NULL,
    "features" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserRecoFeatures_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "ReelStatsDaily" (
    "reelId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "views" INTEGER NOT NULL DEFAULT 0,
    "watchMsSum" BIGINT NOT NULL DEFAULT 0,
    "completes" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "saves" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "follows" INTEGER NOT NULL DEFAULT 0,
    "notInterested" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ReelStatsDaily_pkey" PRIMARY KEY ("reelId","day")
);

-- CreateIndex
CREATE INDEX "ReelImpression_userId_servedAt_idx" ON "ReelImpression"("userId", "servedAt");

-- CreateIndex
CREATE INDEX "ReelImpression_reelId_servedAt_idx" ON "ReelImpression"("reelId", "servedAt");

-- CreateIndex
CREATE INDEX "ReelImpression_requestId_idx" ON "ReelImpression"("requestId");

-- CreateIndex
CREATE INDEX "ReelImpression_userId_reelId_idx" ON "ReelImpression"("userId", "reelId");

-- CreateIndex
CREATE INDEX "ReelImpression_creatorId_servedAt_idx" ON "ReelImpression"("creatorId", "servedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReelImpression_requestId_position_key" ON "ReelImpression"("requestId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ReelEvent_eventId_key" ON "ReelEvent"("eventId");

-- CreateIndex
CREATE INDEX "ReelEvent_userId_occurredAt_idx" ON "ReelEvent"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "ReelEvent_reelId_occurredAt_idx" ON "ReelEvent"("reelId", "occurredAt");

-- CreateIndex
CREATE INDEX "ReelEvent_impressionId_idx" ON "ReelEvent"("impressionId");

-- CreateIndex
CREATE INDEX "ReelEvent_type_occurredAt_idx" ON "ReelEvent"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "UserCreatorAffinity_userId_score_idx" ON "UserCreatorAffinity"("userId", "score");

-- CreateIndex
CREATE INDEX "UserCreatorAffinity_creatorId_idx" ON "UserCreatorAffinity"("creatorId");

-- CreateIndex
CREATE INDEX "ReelStatsDaily_day_idx" ON "ReelStatsDaily"("day");

-- AddForeignKey
ALTER TABLE "ReelImpression" ADD CONSTRAINT "ReelImpression_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReelImpression" ADD CONSTRAINT "ReelImpression_reelId_fkey" FOREIGN KEY ("reelId") REFERENCES "Reel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReelImpression" ADD CONSTRAINT "ReelImpression_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReelEvent" ADD CONSTRAINT "ReelEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReelEvent" ADD CONSTRAINT "ReelEvent_reelId_fkey" FOREIGN KEY ("reelId") REFERENCES "Reel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReelEvent" ADD CONSTRAINT "ReelEvent_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReelEvent" ADD CONSTRAINT "ReelEvent_impressionId_fkey" FOREIGN KEY ("impressionId") REFERENCES "ReelImpression"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCreatorAffinity" ADD CONSTRAINT "UserCreatorAffinity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCreatorAffinity" ADD CONSTRAINT "UserCreatorAffinity_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRecoFeatures" ADD CONSTRAINT "UserRecoFeatures_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReelStatsDaily" ADD CONSTRAINT "ReelStatsDaily_reelId_fkey" FOREIGN KEY ("reelId") REFERENCES "Reel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
