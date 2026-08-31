-- Push notifications: a web-capable platform enum for push tokens, and a
-- dedupe log for sends driven by a periodic scan rather than a one-time
-- state transition.

-- CreateEnum
-- Separate from Platform (IOS/ANDROID) rather than adding WEB to it: Platform
-- exists for device ATTESTATION (App Attest / Play Integrity), which is
-- native-only. A push token can legitimately be a web one; an attested device
-- cannot.
CREATE TYPE "PushPlatform" AS ENUM ('IOS', 'ANDROID', 'WEB');

-- AlterTable
-- Written as an in-place cast rather than the DROP COLUMN + ADD COLUMN that
-- `prisma migrate diff` generates. The table is empty today so both are
-- equivalent here, but a drop/add silently discards data if this ever runs
-- against a populated database. The old and new enums share their IOS and
-- ANDROID members, so the cast is total.
ALTER TABLE "PushToken"
  ALTER COLUMN "platform" TYPE "PushPlatform"
  USING ("platform"::text::"PushPlatform");

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationLog_userId_createdAt_idx" ON "NotificationLog"("userId", "createdAt");

-- The dedupe guard itself: a unique constraint, so two concurrent job ticks
-- race on the INSERT rather than on a check-then-act read, and exactly one
-- of them gets to send.
CREATE UNIQUE INDEX "NotificationLog_userId_kind_dedupeKey_key" ON "NotificationLog"("userId", "kind", "dedupeKey");

-- CreateIndex
CREATE INDEX "PushToken_userId_idx" ON "PushToken"("userId");

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
