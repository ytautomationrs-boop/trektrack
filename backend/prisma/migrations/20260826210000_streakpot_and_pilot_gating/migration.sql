-- Restores StreakPot (pooled-stake challenges) alongside the race/league
-- model, and adds the pilot invite gate + admin creation flag.
--
-- Hand-written rather than raw `prisma migrate diff` output: the old
-- pooled-model cleanup dropped every Challenge*-family TABLE but left eight
-- of its ENUM TYPES orphaned in the database (zero columns reference them —
-- verified before writing this file). Because one of those orphaned names
-- (EscrowStatus) collides with a new enum this migration wants to create,
-- the raw diff tool tried to "rename" the old type into the new one via an
-- ALTER TABLE on ChallengeParticipant — a table that does not exist yet at
-- that point in the very same script. Dropping the dead types up front
-- avoids that entirely.

-- DropEnum (orphaned by the earlier cleanup migration — zero live columns;
-- verified against pg_type/pg_attribute before writing this file)
DROP TYPE "ChallengeMode";
DROP TYPE "ChallengeStatus";
DROP TYPE "ChallengeTier";
DROP TYPE "ChallengeVisibility";
DROP TYPE "CheckInResult";
DROP TYPE "EliminationScope";
DROP TYPE "EscrowStatus";
DROP TYPE "InviteStatus";
DROP TYPE "ParticipantStatus";
DROP TYPE "PayoutStatus";
DROP TYPE "ReviewStatus";

-- CreateEnum
CREATE TYPE "MetricVizType" AS ENUM ('RING', 'ROUTE_BAR', 'BAR');

-- CreateEnum
CREATE TYPE "ChallengeVisibility" AS ENUM ('PUBLIC', 'INVITE_ONLY');

-- CreateEnum
CREATE TYPE "ChallengeStatus" AS ENUM ('DRAFT', 'OPEN', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChallengeMode" AS ENUM ('SOLO', 'SQUAD');

-- CreateEnum
CREATE TYPE "ChallengeEliminationScope" AS ENUM ('INDIVIDUAL', 'WHOLE_GROUP');

-- CreateEnum
CREATE TYPE "ChallengeInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ChallengeParticipantStatus" AS ENUM ('ACTIVE', 'ELIMINATED', 'WITHDRAWN', 'FINISHED');

-- CreateEnum
CREATE TYPE "EscrowStatus" AS ENUM ('HELD', 'RELEASED', 'FORFEITED');

-- CreateEnum
CREATE TYPE "DailyCheckInResult" AS ENUM ('PENDING', 'PASSED', 'FAILED', 'SYNC_ISSUE');

-- CreateEnum
CREATE TYPE "CheckInReviewStatus" AS ENUM ('NONE', 'FLAGGED', 'CONFIRMED_CHEAT', 'DISMISSED');

-- AlterEnum
ALTER TYPE "DataSourceCategory" ADD VALUE 'SLEEP';

-- AlterEnum
ALTER TYPE "MetricValueType" ADD VALUE 'HOURS';

-- AlterEnum
ALTER TYPE "LedgerEntryType" ADD VALUE 'STAKE_HOLD';
ALTER TYPE "LedgerEntryType" ADD VALUE 'STAKE_REFUND';
ALTER TYPE "LedgerEntryType" ADD VALUE 'STAKE_FORFEITED';
ALTER TYPE "LedgerEntryType" ADD VALUE 'POOL_PAYOUT';
ALTER TYPE "LedgerEntryType" ADD VALUE 'REDEMPTION_FEE';

-- AlterTable
ALTER TABLE "User" ADD COLUMN "isAdmin" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "MetricTypeDefinition"
  ADD COLUMN "minTarget" DOUBLE PRECISION,
  ADD COLUMN "maxTarget" DOUBLE PRECISION,
  ADD COLUMN "defaultTarget" DOUBLE PRECISION,
  ADD COLUMN "beginnerTarget" DOUBLE PRECISION,
  ADD COLUMN "advancedTarget" DOUBLE PRECISION,
  ADD COLUMN "stepSize" DOUBLE PRECISION,
  ADD COLUMN "supportsPaceTarget" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "vizType" "MetricVizType";

-- AlterTable
ALTER TABLE "Report" ADD COLUMN "challengeId" TEXT;

-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN "challengeId" TEXT;

-- CreateTable
CREATE TABLE "InviteCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "usedByUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "InviteCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Challenge" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "stakeCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'zar',
    "visibility" "ChallengeVisibility" NOT NULL DEFAULT 'INVITE_ONLY',
    "inviteCode" TEXT,
    "status" "ChallengeStatus" NOT NULL DEFAULT 'DRAFT',
    "gracePeriodMinutes" INTEGER NOT NULL DEFAULT 180,
    "platformFeeBps" INTEGER NOT NULL DEFAULT 0,
    "reviewHoldHours" INTEGER NOT NULL DEFAULT 48,
    "mode" "ChallengeMode" NOT NULL,
    "maxParticipants" INTEGER,
    "eliminationScope" "ChallengeEliminationScope",
    "tier" TEXT,
    "creatorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Challenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChallengeMetricRequirement" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "dailyTarget" DOUBLE PRECISION NOT NULL,
    "paceTargetSecPerKm" DOUBLE PRECISION,
    "startTimeMinutes" INTEGER,
    "endTimeMinutes" INTEGER,

    CONSTRAINT "ChallengeMetricRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChallengeInvite" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "inviteeEmail" TEXT,
    "code" TEXT NOT NULL,
    "status" "ChallengeInviteStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "ChallengeInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChallengeParticipant" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ChallengeParticipantStatus" NOT NULL DEFAULT 'ACTIVE',
    "timezone" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eliminatedOnDay" INTEGER,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "stakeCents" INTEGER NOT NULL,
    "escrowStatus" "EscrowStatus" NOT NULL DEFAULT 'HELD',
    "redemptionPurchased" BOOLEAN NOT NULL DEFAULT false,
    "redemptionUsed" BOOLEAN NOT NULL DEFAULT false,
    "redemptionFeeCents" INTEGER,

    CONSTRAINT "ChallengeParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyCheckIn" (
    "id" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "challengeDay" INTEGER NOT NULL,
    "localDate" TEXT NOT NULL,
    "result" "DailyCheckInResult" NOT NULL,
    "reviewStatus" "CheckInReviewStatus" NOT NULL DEFAULT 'NONE',
    "redemptionApplied" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "cutoffAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyCheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyMetricResult" (
    "id" TEXT NOT NULL,
    "checkInId" TEXT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "targetValue" DOUBLE PRECISION NOT NULL,
    "actualValue" DOUBLE PRECISION NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "anomalyScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paceTargetSecPerKm" DOUBLE PRECISION,
    "actualPaceSecPerKm" DOUBLE PRECISION,
    "dataSource" "MetricDataSource" NOT NULL DEFAULT 'NATIVE_HEALTH',

    CONSTRAINT "DailyMetricResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Badge" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Badge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBadge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "badgeId" TEXT NOT NULL,
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBadge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InviteCode_code_key" ON "InviteCode"("code");
CREATE INDEX "InviteCode_code_idx" ON "InviteCode"("code");

CREATE UNIQUE INDEX "Challenge_inviteCode_key" ON "Challenge"("inviteCode");
CREATE INDEX "Challenge_status_idx" ON "Challenge"("status");
CREATE INDEX "Challenge_creatorId_idx" ON "Challenge"("creatorId");

CREATE INDEX "ChallengeMetricRequirement_challengeId_idx" ON "ChallengeMetricRequirement"("challengeId");
CREATE UNIQUE INDEX "ChallengeMetricRequirement_challengeId_metricKey_key" ON "ChallengeMetricRequirement"("challengeId", "metricKey");

CREATE UNIQUE INDEX "ChallengeInvite_code_key" ON "ChallengeInvite"("code");
CREATE INDEX "ChallengeInvite_challengeId_idx" ON "ChallengeInvite"("challengeId");

CREATE INDEX "ChallengeParticipant_challengeId_status_idx" ON "ChallengeParticipant"("challengeId", "status");
CREATE INDEX "ChallengeParticipant_userId_idx" ON "ChallengeParticipant"("userId");
CREATE UNIQUE INDEX "ChallengeParticipant_challengeId_userId_key" ON "ChallengeParticipant"("challengeId", "userId");

CREATE INDEX "DailyCheckIn_participantId_idx" ON "DailyCheckIn"("participantId");
CREATE UNIQUE INDEX "DailyCheckIn_participantId_challengeDay_key" ON "DailyCheckIn"("participantId", "challengeDay");

CREATE INDEX "DailyMetricResult_checkInId_idx" ON "DailyMetricResult"("checkInId");

CREATE UNIQUE INDEX "Badge_key_key" ON "Badge"("key");
CREATE UNIQUE INDEX "UserBadge_userId_badgeId_key" ON "UserBadge"("userId", "badgeId");

CREATE INDEX "LedgerEntry_challengeId_idx" ON "LedgerEntry"("challengeId");

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChallengeMetricRequirement" ADD CONSTRAINT "ChallengeMetricRequirement_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChallengeMetricRequirement" ADD CONSTRAINT "ChallengeMetricRequirement_metricKey_fkey" FOREIGN KEY ("metricKey") REFERENCES "MetricTypeDefinition"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChallengeInvite" ADD CONSTRAINT "ChallengeInvite_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChallengeInvite" ADD CONSTRAINT "ChallengeInvite_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChallengeParticipant" ADD CONSTRAINT "ChallengeParticipant_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChallengeParticipant" ADD CONSTRAINT "ChallengeParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DailyCheckIn" ADD CONSTRAINT "DailyCheckIn_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "ChallengeParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DailyMetricResult" ADD CONSTRAINT "DailyMetricResult_checkInId_fkey" FOREIGN KEY ("checkInId") REFERENCES "DailyCheckIn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_badgeId_fkey" FOREIGN KEY ("badgeId") REFERENCES "Badge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE SET NULL ON UPDATE CASCADE;
