-- Recommendation events gain explicit visibility/watch lifecycle types.
ALTER TYPE "ReelEventType" ADD VALUE IF NOT EXISTS 'IMPRESSION_VIEWABLE';
ALTER TYPE "ReelEventType" ADD VALUE IF NOT EXISTS 'WATCH_START';
ALTER TYPE "ReelEventType" ADD VALUE IF NOT EXISTS 'WATCH_PROGRESS';
ALTER TYPE "ReelEventType" ADD VALUE IF NOT EXISTS 'WATCH_COMPLETE';
ALTER TYPE "ReelEventType" ADD VALUE IF NOT EXISTS 'REPORT_REEL';

CREATE TABLE "RecommendationRequest" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sessionId" VARCHAR(128),
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "feedSize" INTEGER NOT NULL,
  "cursor" VARCHAR(256),
  "retrievalModelVersion" VARCHAR(64),
  "rankingModelVersion" VARCHAR(64),
  "featureSchemaVersion" VARCHAR(64) NOT NULL,
  "provider" VARCHAR(32) NOT NULL,
  "latencyMs" INTEGER,
  "status" VARCHAR(24) NOT NULL DEFAULT 'OK',
  CONSTRAINT "RecommendationRequest_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ReelImpression"
  ADD COLUMN "retrievalModelVersion" VARCHAR(64),
  ADD COLUMN "rankingModelVersion" VARCHAR(64),
  ADD COLUMN "featureSchemaVersion" VARCHAR(64),
  ADD COLUMN "reelFeaturesSnapshot" JSONB;

-- Preserve existing impression rows while linking request telemetry.
INSERT INTO "RecommendationRequest" ("id", "userId", "sessionId", "requestedAt", "feedSize", "featureSchemaVersion", "provider")
SELECT "requestId", MIN("userId"), MIN("sessionId"), MIN("servedAt"), COUNT(*)::INTEGER, 'legacy-r5', 'cold_start_v1'
FROM "ReelImpression"
GROUP BY "requestId"
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "ReelImpression"
  ADD CONSTRAINT "ReelImpression_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "RecommendationRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReelEvent"
  ADD COLUMN "requestId" TEXT,
  ADD COLUMN "schemaVersion" VARCHAR(32) NOT NULL DEFAULT 'gather-events-v1';
CREATE INDEX "ReelEvent_requestId_occurredAt_idx" ON "ReelEvent"("requestId", "occurredAt");

CREATE TABLE "ReelRecoFeatures" (
  "reelId" TEXT NOT NULL,
  "features" JSONB NOT NULL,
  "featureVersion" VARCHAR(64) NOT NULL DEFAULT 'gather-reel-v1',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReelRecoFeatures_pkey" PRIMARY KEY ("reelId")
);
CREATE TABLE "RecommendationModelVersion" (
  "id" TEXT NOT NULL,
  "provider" VARCHAR(32) NOT NULL,
  "retrievalModelVersion" VARCHAR(64),
  "rankingModelVersion" VARCHAR(64),
  "retrievalIndexVersion" VARCHAR(64),
  "featureSchemaVersion" VARCHAR(64) NOT NULL,
  "rankingFormulaVersion" VARCHAR(64) NOT NULL,
  "manifestReference" VARCHAR(512),
  "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecommendationModelVersion_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "ReelRecoFeatures" ADD CONSTRAINT "ReelRecoFeatures_reelId_fkey" FOREIGN KEY ("reelId") REFERENCES "Reel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecommendationRequest" ADD CONSTRAINT "RecommendationRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "RecommendationRequest_userId_requestedAt_idx" ON "RecommendationRequest"("userId", "requestedAt");
CREATE INDEX "RecommendationRequest_provider_requestedAt_idx" ON "RecommendationRequest"("provider", "requestedAt");
CREATE INDEX "RecommendationRequest_status_requestedAt_idx" ON "RecommendationRequest"("status", "requestedAt");
CREATE INDEX "RecommendationModelVersion_activatedAt_idx" ON "RecommendationModelVersion"("activatedAt");

ALTER TABLE "UserRecoFeatures" ADD COLUMN "featureVersion" VARCHAR(64) NOT NULL DEFAULT 'gather-user-v1';
