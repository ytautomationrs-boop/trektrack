-- Squad join policy + shareable invite code.
--
-- A squad is invite-only unless its captain deliberately opens it. See
-- schema.prisma RaceSquad.joinPolicy for the reasoning.

-- CreateEnum
CREATE TYPE "RaceSquadJoinPolicy" AS ENUM ('INVITE_ONLY', 'OPEN');

-- AlterTable
ALTER TABLE "RaceSquad" ADD COLUMN "joinPolicy" "RaceSquadJoinPolicy" NOT NULL DEFAULT 'INVITE_ONLY';

-- inviteCode is NOT NULL UNIQUE, so it is added nullable, backfilled, then
-- tightened. Adding it NOT NULL in one step would fail against any table that
-- already has rows, and a squad created before this migration still needs a
-- usable code rather than a null one.
-- AlterTable
ALTER TABLE "RaceSquad" ADD COLUMN "inviteCode" TEXT;

-- Backfill: 8 hex characters, matching the format generated in
-- modules/races/service.ts. gen_random_uuid() is built in from PostgreSQL 13.
UPDATE "RaceSquad"
SET "inviteCode" = substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)
WHERE "inviteCode" IS NULL;

ALTER TABLE "RaceSquad" ALTER COLUMN "inviteCode" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "RaceSquad_inviteCode_key" ON "RaceSquad"("inviteCode");
