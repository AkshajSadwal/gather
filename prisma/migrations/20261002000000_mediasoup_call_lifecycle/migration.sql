ALTER TYPE "CallStatus" ADD VALUE 'CONNECTING';
ALTER TYPE "CallStatus" ADD VALUE 'CONNECTED';

ALTER TABLE "CallSession"
ADD COLUMN "conversationId" TEXT,
ADD COLUMN "failureReason" VARCHAR(240);

CREATE INDEX "CallSession_conversationId_startedAt_idx"
ON "CallSession"("conversationId", "startedAt");

ALTER TABLE "CallSession"
ADD CONSTRAINT "CallSession_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
