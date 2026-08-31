-- Remove the pooled-stake model entirely.
--
-- DESTRUCTIVE. A full logical backup is taken by `npm run db:backup` into
-- backups/ before this runs; combined with the migration history, that JSON
-- is the restore path for anything dropped here.
--
-- Order matters: ledger rows referencing pooled enum values must go before
-- the enum can be rebuilt, and child tables before parents.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Drop pooled ledger rows.
--
-- PostgreSQL cannot remove a value from an enum type while any row uses it,
-- and there is no ALTER TYPE ... DROP VALUE at all — the type has to be
-- rebuilt. So the stake/pot-era transactions are deleted first. This does
-- rewrite wallet history for existing users; the backup holds the originals.
-- ─────────────────────────────────────────────────────────────────────────
DELETE FROM "LedgerEntry"
WHERE "type" IN (
  'STAKE_HOLD', 'STAKE_CAPTURED', 'STAKE_FORFEITED',
  'PAYOUT', 'REFUND', 'PLATFORM_FEE', 'REDEMPTION_FEE'
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Report: re-point from challenges to races.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE "Report" DROP COLUMN IF EXISTS "challengeId";
ALTER TABLE "Report" ADD COLUMN "raceId" TEXT;
CREATE INDEX "Report_status_idx" ON "Report"("status");
ALTER TABLE "Report" ADD CONSTRAINT "Report_raceId_fkey"
  FOREIGN KEY ("raceId") REFERENCES "Race"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Drop pooled tables, children first.
-- ─────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS "DailyMetricResult" CASCADE;
DROP TABLE IF EXISTS "AnomalyFlag" CASCADE;
DROP TABLE IF EXISTS "HealthSample" CASCADE;
DROP TABLE IF EXISTS "DailyCheckIn" CASCADE;
DROP TABLE IF EXISTS "Payout" CASCADE;
DROP TABLE IF EXISTS "ChallengeParticipant" CASCADE;
DROP TABLE IF EXISTS "ChallengeInvite" CASCADE;
DROP TABLE IF EXISTS "ChallengeMetricRequirement" CASCADE;
DROP TABLE IF EXISTS "Challenge" CASCADE;
-- Gamification stubs: modelled but referenced by zero code.
DROP TABLE IF EXISTS "UserBadge" CASCADE;
DROP TABLE IF EXISTS "Badge" CASCADE;

-- LedgerEntry.challengeId is now dangling.
ALTER TABLE "LedgerEntry" DROP COLUMN IF EXISTS "challengeId";

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Rebuild LedgerEntryType without the pooled values.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TYPE "LedgerEntryType" RENAME TO "LedgerEntryType_old";

CREATE TYPE "LedgerEntryType" AS ENUM (
  'DEPOSIT', 'WITHDRAWAL',
  'RACE_ENTRY_FEE', 'RACE_ENTRY_REVENUE', 'RACE_PRIZE',
  'RACE_PRIZE_EXPENSE', 'RACE_ENTRY_REFUND',
  'ADJUSTMENT', 'DISPUTE_REVERSAL'
);

ALTER TABLE "LedgerEntry"
  ALTER COLUMN "type" TYPE "LedgerEntryType"
  USING ("type"::text::"LedgerEntryType");

DROP TYPE "LedgerEntryType_old";

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Metric registry: drop sleep, drop every target-shaped column.
--
-- min/max/default/stepSize and beginner/advancedTarget existed only to
-- configure a DAILY TARGET; supportsPaceTarget only to offer a pace
-- requirement. Races rank on a cumulative total and have neither. vizType
-- drove daily-progress rings, which no longer render anywhere.
-- ─────────────────────────────────────────────────────────────────────────
DELETE FROM "MetricTypeDefinition" WHERE "key" = 'sleep';

ALTER TABLE "MetricTypeDefinition" DROP COLUMN IF EXISTS "minTarget";
ALTER TABLE "MetricTypeDefinition" DROP COLUMN IF EXISTS "maxTarget";
ALTER TABLE "MetricTypeDefinition" DROP COLUMN IF EXISTS "defaultTarget";
ALTER TABLE "MetricTypeDefinition" DROP COLUMN IF EXISTS "beginnerTarget";
ALTER TABLE "MetricTypeDefinition" DROP COLUMN IF EXISTS "advancedTarget";
ALTER TABLE "MetricTypeDefinition" DROP COLUMN IF EXISTS "stepSize";
ALTER TABLE "MetricTypeDefinition" DROP COLUMN IF EXISTS "supportsPaceTarget";
ALTER TABLE "MetricTypeDefinition" DROP COLUMN IF EXISTS "vizType";

-- targetFieldType -> valueType: same data, name no longer implies a target.
CREATE TYPE "MetricValueType" AS ENUM ('COUNT', 'DISTANCE_METERS', 'DURATION_MINUTES');
ALTER TABLE "MetricTypeDefinition" ADD COLUMN "valueType" "MetricValueType";
UPDATE "MetricTypeDefinition"
SET "valueType" = CASE
  WHEN "targetFieldType"::text = 'DISTANCE_METERS' THEN 'DISTANCE_METERS'::"MetricValueType"
  WHEN "targetFieldType"::text = 'DURATION_MINUTES' THEN 'DURATION_MINUTES'::"MetricValueType"
  ELSE 'COUNT'::"MetricValueType"
END;
ALTER TABLE "MetricTypeDefinition" ALTER COLUMN "valueType" SET NOT NULL;
ALTER TABLE "MetricTypeDefinition" DROP COLUMN "targetFieldType";
DROP TYPE IF EXISTS "TargetFieldType";
DROP TYPE IF EXISTS "VizType";

-- SLEEP leaves DataSourceCategory; GOOGLE_FIT leaves HealthProvider (the
-- Google Fit APIs are deprecated and were never used).
ALTER TYPE "DataSourceCategory" RENAME TO "DataSourceCategory_old";
CREATE TYPE "DataSourceCategory" AS ENUM ('STEPS', 'CYCLING_WORKOUT', 'RUNNING_WORKOUT', 'SWIMMING_WORKOUT', 'GENERIC_WORKOUT');
ALTER TABLE "MetricTypeDefinition"
  ALTER COLUMN "dataSourceCategory" TYPE "DataSourceCategory"
  USING ("dataSourceCategory"::text::"DataSourceCategory");
DROP TYPE "DataSourceCategory_old";

ALTER TYPE "HealthProvider" RENAME TO "HealthProvider_old";
CREATE TYPE "HealthProvider" AS ENUM ('HEALTHKIT', 'HEALTH_CONNECT');
DELETE FROM "HealthConnection" WHERE "provider"::text = 'GOOGLE_FIT';
ALTER TABLE "HealthConnection"
  ALTER COLUMN "provider" TYPE "HealthProvider"
  USING ("provider"::text::"HealthProvider");
DROP TYPE "HealthProvider_old";

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Races gain a name, visibility, creator and invite code.
--
-- Existing races are platform-opened public ones: creator null, no code, and
-- a generated name so the NOT NULL constraint holds.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TYPE "RaceVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

ALTER TABLE "Race" ADD COLUMN "name" TEXT;
UPDATE "Race" SET "name" = initcap("metricKey") || ' · ' || "durationDays" || 'd ' ||
  CASE WHEN "format"::text = 'SQUAD' THEN 'squad' ELSE 'solo' END
WHERE "name" IS NULL;
ALTER TABLE "Race" ALTER COLUMN "name" SET NOT NULL;

ALTER TABLE "Race" ADD COLUMN "visibility" "RaceVisibility" NOT NULL DEFAULT 'PUBLIC';
ALTER TABLE "Race" ADD COLUMN "createdByUserId" TEXT;
ALTER TABLE "Race" ADD COLUMN "inviteCode" TEXT;

CREATE UNIQUE INDEX "Race_inviteCode_key" ON "Race"("inviteCode");
CREATE INDEX "Race_createdByUserId_idx" ON "Race"("createdByUserId");
ALTER TABLE "Race" ADD CONSTRAINT "Race_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. RaceType: may users create private races of this format?
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE "RaceType" ADD COLUMN "allowUserCreated" BOOLEAN NOT NULL DEFAULT true;

-- RaceHealthSample.deviceId gains its FK (Device lost its pooled relation).
ALTER TABLE "RaceHealthSample" ADD CONSTRAINT "RaceHealthSample_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Cascades on user-owned rows, so deleting a user no longer strands data.
ALTER TABLE "Device" DROP CONSTRAINT IF EXISTS "Device_userId_fkey";
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HealthConnection" DROP CONSTRAINT IF EXISTS "HealthConnection_userId_fkey";
ALTER TABLE "HealthConnection" ADD CONSTRAINT "HealthConnection_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StravaConnection" DROP CONSTRAINT IF EXISTS "StravaConnection_userId_fkey";
ALTER TABLE "StravaConnection" ADD CONSTRAINT "StravaConnection_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PushToken" DROP CONSTRAINT IF EXISTS "PushToken_userId_fkey";
ALTER TABLE "PushToken" ADD CONSTRAINT "PushToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" DROP CONSTRAINT IF EXISTS "LedgerEntry_userId_fkey";
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Withdrawal" DROP CONSTRAINT IF EXISTS "Withdrawal_userId_fkey";
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserLeagueState" DROP CONSTRAINT IF EXISTS "UserLeagueState_userId_fkey";
ALTER TABLE "UserLeagueState" ADD CONSTRAINT "UserLeagueState_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RacePointEntry" DROP CONSTRAINT IF EXISTS "RacePointEntry_userId_fkey";
ALTER TABLE "RacePointEntry" ADD CONSTRAINT "RacePointEntry_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RacePrizeSchedule" DROP CONSTRAINT IF EXISTS "RacePrizeSchedule_raceTypeKey_fkey";
ALTER TABLE "RacePrizeSchedule" ADD CONSTRAINT "RacePrizeSchedule_raceTypeKey_fkey"
  FOREIGN KEY ("raceTypeKey") REFERENCES "RaceType"("key") ON DELETE CASCADE ON UPDATE CASCADE;
