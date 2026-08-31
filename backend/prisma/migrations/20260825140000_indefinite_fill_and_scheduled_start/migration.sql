-- Fill logic becomes indefinite: a race waits for its exact headcount with
-- no deadline, LOCKS the instant it fills, and starts at the next midnight
-- in a timezone fixed at creation. Adds voluntary withdrawal while FILLING,
-- and a lower-league opt-in path that pays/wins normally but earns zero
-- league points.
--
-- Current DB state at migration time: 4 FILLING races, 3 CANCELLED_UNFILLED,
-- nothing RUNNING/LOCKED/RESOLVING/COMPLETED — so there is no startedAt
-- backfill to reason about.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. New enum values.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TYPE "RaceStatus" ADD VALUE 'LOCKED';
ALTER TYPE "RaceEntryStatus" ADD VALUE 'WITHDRAWN';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. RaceType: drop signupWindowHours — fill is indefinite, there is no
--    window to configure.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE "RaceType" DROP COLUMN "signupWindowHours";

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Race: add scheduling fields, drop the deadline.
--
-- anchorTimezone is backfilled to the platform default for existing rows
-- (all FILLING/CANCELLED_UNFILLED today, none of which have started, so the
-- backfilled value only matters for the 4 still-FILLING races going
-- forward).
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE "Race" ADD COLUMN "anchorTimezone" TEXT;
UPDATE "Race" SET "anchorTimezone" = 'Africa/Johannesburg' WHERE "anchorTimezone" IS NULL;
ALTER TABLE "Race" ALTER COLUMN "anchorTimezone" SET NOT NULL;

ALTER TABLE "Race" ADD COLUMN "lockedAt" TIMESTAMP(3);
ALTER TABLE "Race" ADD COLUMN "scheduledStartAt" TIMESTAMP(3);

DROP INDEX IF EXISTS "Race_status_signupClosesAt_idx";
ALTER TABLE "Race" DROP COLUMN "signupClosesAt";
CREATE INDEX "Race_status_scheduledStartAt_idx" ON "Race"("status", "scheduledStartAt");

-- ─────────────────────────────────────────────────────────────────────────
-- 4. RaceEntry: lower-league opt-in flag.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE "RaceEntry" ADD COLUMN "lowerLeagueOptIn" BOOLEAN NOT NULL DEFAULT false;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. RacePointEntry: denormalised mirror, for audit/display.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE "RacePointEntry" ADD COLUMN "lowerLeagueOptIn" BOOLEAN NOT NULL DEFAULT false;
