ALTER TYPE "SocialEventStatus" ADD VALUE IF NOT EXISTS 'LIVE';
ALTER TABLE "SocialEvent" ADD COLUMN IF NOT EXISTS "game" JSONB;
ALTER TABLE "SocialPost" ADD COLUMN IF NOT EXISTS "eventId" TEXT REFERENCES "SocialEvent"("id") ON DELETE SET NULL;
CREATE TABLE IF NOT EXISTS "AppNotification" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
 "kind" TEXT NOT NULL, "title" TEXT NOT NULL, "body" TEXT NOT NULL, "data" JSONB NOT NULL,
 "dedupeKey" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "readAt" TIMESTAMP(3));
CREATE UNIQUE INDEX IF NOT EXISTS "AppNotification_userId_dedupeKey_key" ON "AppNotification"("userId", "dedupeKey");
CREATE INDEX IF NOT EXISTS "AppNotification_userId_readAt_createdAt_idx" ON "AppNotification"("userId", "readAt", "createdAt");
CREATE TABLE IF NOT EXISTS "MediaAsset" (
 "id" TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
 "contentType" TEXT NOT NULL, "bytes" BYTEA NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS "MediaAsset_ownerId_createdAt_idx" ON "MediaAsset"("ownerId", "createdAt");
CREATE INDEX IF NOT EXISTS "DirectMessage_unread_thread_idx" ON "DirectMessage"("recipientId", "senderId", "createdAt") WHERE "readAt" IS NULL;
