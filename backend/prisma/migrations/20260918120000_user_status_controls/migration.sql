ALTER TABLE "User" ADD COLUMN "suspendedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "suspendedReason" TEXT;
ALTER TABLE "User" ADD COLUMN "bannedAt" TIMESTAMP(3);

CREATE INDEX "User_suspendedAt_idx" ON "User"("suspendedAt");
CREATE INDEX "User_bannedAt_idx" ON "User"("bannedAt");
