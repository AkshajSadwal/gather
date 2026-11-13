-- Add Block relationships for account-level interaction/privacy boundaries.
CREATE TABLE "Block" (
    "id" TEXT NOT NULL,
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Block_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Block_blockerId_blockedId_key" ON "Block"("blockerId", "blockedId");
CREATE INDEX "Block_blockedId_createdAt_idx" ON "Block"("blockedId", "createdAt");

ALTER TABLE "Block" ADD CONSTRAINT "Block_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Block" ADD CONSTRAINT "Block_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A user should not be able to block itself. Prisma cannot express this as a model
-- constraint portably, so the service enforces it server-side.
