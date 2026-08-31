-- Fixed-prize races (parallel model). Purely additive: no existing table is
-- altered except LedgerEntry's enum, which only gains values. The
-- pooled-payout model's tables, constraints and semantics are untouched.

-- AlterEnum
-- New ledger entry types. PostgreSQL 12+ permits ALTER TYPE ... ADD VALUE
-- inside a transaction as long as the new value is not itself used in the
-- same transaction; nothing below references these, so this is safe as a
-- normal Prisma migration.
ALTER TYPE "LedgerEntryType" ADD VALUE 'RACE_ENTRY_FEE';
ALTER TYPE "LedgerEntryType" ADD VALUE 'RACE_ENTRY_REVENUE';
ALTER TYPE "LedgerEntryType" ADD VALUE 'RACE_PRIZE';
ALTER TYPE "LedgerEntryType" ADD VALUE 'RACE_PRIZE_EXPENSE';
ALTER TYPE "LedgerEntryType" ADD VALUE 'RACE_ENTRY_REFUND';

-- CreateEnum
CREATE TYPE "RaceFormat" AS ENUM ('INDIVIDUAL', 'SQUAD');

-- CreateEnum
CREATE TYPE "RaceStatus" AS ENUM ('FILLING', 'RUNNING', 'RESOLVING', 'COMPLETED', 'CANCELLED_UNFILLED');

-- CreateEnum
CREATE TYPE "RaceEntryStatus" AS ENUM ('ENTERED', 'REFUNDED', 'DISQUALIFIED', 'SCORED');

-- CreateTable
CREATE TABLE "LeagueLevel" (
    "level" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "minPoints" INTEGER NOT NULL,
    "isOpen" BOOLEAN NOT NULL DEFAULT false,
    "openedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeagueLevel_pkey" PRIMARY KEY ("level")
);

-- CreateTable
CREATE TABLE "RaceType" (
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "format" "RaceFormat" NOT NULL,
    "metricKey" TEXT NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "entrantCount" INTEGER NOT NULL,
    "squadSize" INTEGER,
    "signupWindowHours" INTEGER NOT NULL DEFAULT 72,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RaceType_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "RacePrizeSchedule" (
    "id" TEXT NOT NULL,
    "raceTypeKey" TEXT NOT NULL,
    "leagueLevel" INTEGER NOT NULL,
    "entryFeeCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'zar',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RacePrizeSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RacePrizeTier" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,

    CONSTRAINT "RacePrizeTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Race" (
    "id" TEXT NOT NULL,
    "raceTypeKey" TEXT NOT NULL,
    "leagueLevel" INTEGER NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "status" "RaceStatus" NOT NULL DEFAULT 'FILLING',
    "metricKey" TEXT NOT NULL,
    "format" "RaceFormat" NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "entrantCount" INTEGER NOT NULL,
    "squadSize" INTEGER,
    "entryFeeCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'zar',
    "prizeSnapshot" JSONB NOT NULL,
    "totalPrizeCents" INTEGER NOT NULL,
    "signupOpensAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signupClosesAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Race_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RaceSquad" (
    "id" TEXT NOT NULL,
    "raceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slotIndex" INTEGER NOT NULL,
    "captainUserId" TEXT NOT NULL,
    "aggregateValue" DOUBLE PRECISION,
    "finishPosition" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RaceSquad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RaceEntry" (
    "id" TEXT NOT NULL,
    "raceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "squadId" TEXT,
    "timezone" TEXT NOT NULL,
    "entryFeeCents" INTEGER NOT NULL,
    "status" "RaceEntryStatus" NOT NULL DEFAULT 'ENTERED',
    "aggregateValue" DOUBLE PRECISION,
    "finishPosition" INTEGER,
    "pointsAwarded" INTEGER,
    "prizeCents" INTEGER,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RaceEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RaceHealthSample" (
    "id" TEXT NOT NULL,
    "raceEntryId" TEXT NOT NULL,
    "deviceId" TEXT,
    "metricKey" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "sourceBundleId" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "wasManualEntry" BOOLEAN NOT NULL DEFAULT false,
    "isWearableSourced" BOOLEAN NOT NULL DEFAULT false,
    "corroboration" JSONB,
    "dataSource" "MetricDataSource" NOT NULL DEFAULT 'NATIVE_HEALTH',
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RaceHealthSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RaceAnomalyFlag" (
    "id" TEXT NOT NULL,
    "sampleId" TEXT NOT NULL,
    "raceId" TEXT NOT NULL,
    "raceEntryId" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "severity" "AnomalySeverity" NOT NULL,
    "details" JSONB NOT NULL,
    "status" "AnomalyStatus" NOT NULL DEFAULT 'OPEN',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RaceAnomalyFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserLeagueState" (
    "userId" TEXT NOT NULL,
    "totalPoints" INTEGER NOT NULL DEFAULT 0,
    "currentLevel" INTEGER NOT NULL DEFAULT 1,
    "qualifiedLevel" INTEGER NOT NULL DEFAULT 1,
    "racesEntered" INTEGER NOT NULL DEFAULT 0,
    "racesWon" INTEGER NOT NULL DEFAULT 0,
    "promotedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserLeagueState_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "RacePointEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "raceId" TEXT NOT NULL,
    "raceEntryId" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "pointsBefore" INTEGER NOT NULL,
    "pointsAfter" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RacePointEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RacePrizeSchedule_raceTypeKey_leagueLevel_key" ON "RacePrizeSchedule"("raceTypeKey", "leagueLevel");

-- CreateIndex
CREATE UNIQUE INDEX "RacePrizeTier_scheduleId_position_key" ON "RacePrizeTier"("scheduleId", "position");

-- CreateIndex
CREATE INDEX "Race_status_raceTypeKey_leagueLevel_idx" ON "Race"("status", "raceTypeKey", "leagueLevel");

-- CreateIndex
CREATE INDEX "Race_status_signupClosesAt_idx" ON "Race"("status", "signupClosesAt");

-- CreateIndex
CREATE INDEX "Race_status_endsAt_idx" ON "Race"("status", "endsAt");

-- CreateIndex
CREATE INDEX "RaceSquad_raceId_idx" ON "RaceSquad"("raceId");

-- CreateIndex
CREATE UNIQUE INDEX "RaceSquad_raceId_slotIndex_key" ON "RaceSquad"("raceId", "slotIndex");

-- CreateIndex
CREATE INDEX "RaceEntry_raceId_status_idx" ON "RaceEntry"("raceId", "status");

-- CreateIndex
CREATE INDEX "RaceEntry_userId_idx" ON "RaceEntry"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RaceEntry_raceId_userId_key" ON "RaceEntry"("raceId", "userId");

-- CreateIndex
CREATE INDEX "RaceHealthSample_raceEntryId_metricKey_idx" ON "RaceHealthSample"("raceEntryId", "metricKey");

-- CreateIndex
CREATE INDEX "RaceHealthSample_raceEntryId_startTime_idx" ON "RaceHealthSample"("raceEntryId", "startTime");

-- CreateIndex
CREATE INDEX "RaceAnomalyFlag_status_severity_idx" ON "RaceAnomalyFlag"("status", "severity");

-- CreateIndex
CREATE INDEX "RaceAnomalyFlag_raceEntryId_status_idx" ON "RaceAnomalyFlag"("raceEntryId", "status");

-- CreateIndex
CREATE INDEX "RaceAnomalyFlag_raceId_status_idx" ON "RaceAnomalyFlag"("raceId", "status");

-- CreateIndex
CREATE INDEX "UserLeagueState_currentLevel_idx" ON "UserLeagueState"("currentLevel");

-- CreateIndex
CREATE INDEX "UserLeagueState_qualifiedLevel_idx" ON "UserLeagueState"("qualifiedLevel");

-- CreateIndex
CREATE UNIQUE INDEX "RacePointEntry_raceEntryId_key" ON "RacePointEntry"("raceEntryId");

-- CreateIndex
CREATE INDEX "RacePointEntry_userId_createdAt_idx" ON "RacePointEntry"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "RacePointEntry_raceId_idx" ON "RacePointEntry"("raceId");

-- AddForeignKey
ALTER TABLE "RaceType" ADD CONSTRAINT "RaceType_metricKey_fkey" FOREIGN KEY ("metricKey") REFERENCES "MetricTypeDefinition"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RacePrizeSchedule" ADD CONSTRAINT "RacePrizeSchedule_raceTypeKey_fkey" FOREIGN KEY ("raceTypeKey") REFERENCES "RaceType"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RacePrizeSchedule" ADD CONSTRAINT "RacePrizeSchedule_leagueLevel_fkey" FOREIGN KEY ("leagueLevel") REFERENCES "LeagueLevel"("level") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RacePrizeTier" ADD CONSTRAINT "RacePrizeTier_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "RacePrizeSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Race" ADD CONSTRAINT "Race_raceTypeKey_fkey" FOREIGN KEY ("raceTypeKey") REFERENCES "RaceType"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Race" ADD CONSTRAINT "Race_leagueLevel_fkey" FOREIGN KEY ("leagueLevel") REFERENCES "LeagueLevel"("level") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Race" ADD CONSTRAINT "Race_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "RacePrizeSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaceSquad" ADD CONSTRAINT "RaceSquad_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaceSquad" ADD CONSTRAINT "RaceSquad_captainUserId_fkey" FOREIGN KEY ("captainUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaceEntry" ADD CONSTRAINT "RaceEntry_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaceEntry" ADD CONSTRAINT "RaceEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaceEntry" ADD CONSTRAINT "RaceEntry_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "RaceSquad"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaceHealthSample" ADD CONSTRAINT "RaceHealthSample_raceEntryId_fkey" FOREIGN KEY ("raceEntryId") REFERENCES "RaceEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaceAnomalyFlag" ADD CONSTRAINT "RaceAnomalyFlag_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "RaceHealthSample"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserLeagueState" ADD CONSTRAINT "UserLeagueState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserLeagueState" ADD CONSTRAINT "UserLeagueState_currentLevel_fkey" FOREIGN KEY ("currentLevel") REFERENCES "LeagueLevel"("level") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RacePointEntry" ADD CONSTRAINT "RacePointEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
-- Additive nullable column so a ledger entry can point at a race. Existing
-- rows are unaffected, and every existing query filters on challengeId.
ALTER TABLE "LedgerEntry" ADD COLUMN     "raceId" TEXT;

-- CreateIndex
CREATE INDEX "LedgerEntry_raceId_idx" ON "LedgerEntry"("raceId");

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race"("id") ON DELETE SET NULL ON UPDATE CASCADE;
