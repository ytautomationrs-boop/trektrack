-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('IOS', 'ANDROID');

-- CreateEnum
CREATE TYPE "HealthProvider" AS ENUM ('HEALTHKIT', 'GOOGLE_FIT', 'HEALTH_CONNECT');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "AttestationProvider" AS ENUM ('APP_ATTEST', 'PLAY_INTEGRITY');

-- CreateEnum
CREATE TYPE "AttestationStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'FAILED');

-- CreateEnum
CREATE TYPE "DataSourceCategory" AS ENUM ('STEPS', 'CYCLING_WORKOUT', 'SWIMMING_WORKOUT', 'SLEEP', 'GENERIC_WORKOUT');

-- CreateEnum
CREATE TYPE "TargetFieldType" AS ENUM ('COUNT', 'DISTANCE_METERS', 'DURATION_MINUTES', 'HOURS');

-- CreateEnum
CREATE TYPE "VizType" AS ENUM ('RING', 'BAR', 'DOT_GRID', 'ROUTE_BAR');

-- CreateEnum
CREATE TYPE "ChallengeVisibility" AS ENUM ('PUBLIC', 'INVITE_ONLY');

-- CreateEnum
CREATE TYPE "ChallengeStatus" AS ENUM ('DRAFT', 'OPEN', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ParticipantStatus" AS ENUM ('ACTIVE', 'ELIMINATED', 'COMPLETED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "EscrowStatus" AS ENUM ('PENDING', 'HELD', 'CAPTURED_TO_POOL', 'REFUNDED', 'PAID_OUT');

-- CreateEnum
CREATE TYPE "CheckInResult" AS ENUM ('PENDING', 'PASS', 'FAIL', 'FLAGGED', 'SYNC_ISSUE');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('NONE', 'PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AnomalySeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "AnomalyStatus" AS ENUM ('OPEN', 'DISMISSED', 'CONFIRMED_CHEAT');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'REVIEWED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('STAKE_HOLD', 'STAKE_CAPTURED', 'STAKE_FORFEITED', 'PAYOUT', 'REFUND', 'PLATFORM_FEE', 'DISPUTE_REVERSAL', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "LedgerEntryStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING_REVIEW', 'SCHEDULED', 'RELEASED', 'HELD', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "stripeCustomerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "deviceModel" TEXT NOT NULL,
    "osVersion" TEXT NOT NULL,
    "attestationProvider" "AttestationProvider" NOT NULL,
    "attestationStatus" "AttestationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "lastAttestedAt" TIMESTAMP(3),
    "isEmulatorSuspected" BOOLEAN NOT NULL DEFAULT false,
    "isJailbrokenOrRooted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "HealthProvider" NOT NULL,
    "grantedScopes" TEXT[],
    "status" "ConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "HealthConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricTypeDefinition" (
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "targetFieldType" "TargetFieldType" NOT NULL,
    "dataSourceCategory" "DataSourceCategory" NOT NULL,
    "vizType" "VizType" NOT NULL,
    "icon" TEXT NOT NULL,
    "validationRuleKey" TEXT NOT NULL,
    "anomalyRuleKey" TEXT NOT NULL,
    "minTarget" DOUBLE PRECISION NOT NULL,
    "maxTarget" DOUBLE PRECISION NOT NULL,
    "defaultTarget" DOUBLE PRECISION NOT NULL,
    "stepSize" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetricTypeDefinition_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Challenge" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "dailyTarget" DOUBLE PRECISION NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "stakeCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "visibility" "ChallengeVisibility" NOT NULL DEFAULT 'PUBLIC',
    "inviteCode" TEXT,
    "status" "ChallengeStatus" NOT NULL DEFAULT 'OPEN',
    "gracePeriodMinutes" INTEGER NOT NULL DEFAULT 180,
    "platformFeeBps" INTEGER NOT NULL DEFAULT 750,
    "reviewHoldHours" INTEGER NOT NULL DEFAULT 48,
    "creatorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Challenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChallengeInvite" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "inviteeEmail" TEXT,
    "code" TEXT NOT NULL,
    "status" "InviteStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "ChallengeInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChallengeParticipant" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ParticipantStatus" NOT NULL DEFAULT 'ACTIVE',
    "timezone" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eliminatedOnDay" INTEGER,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "stakeCents" INTEGER NOT NULL,
    "stripePaymentIntentId" TEXT,
    "escrowStatus" "EscrowStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "ChallengeParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyCheckIn" (
    "id" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "challengeDay" INTEGER NOT NULL,
    "localDate" TEXT NOT NULL,
    "targetValue" DOUBLE PRECISION NOT NULL,
    "actualValue" DOUBLE PRECISION,
    "result" "CheckInResult" NOT NULL DEFAULT 'PENDING',
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'NONE',
    "verifiedAt" TIMESTAMP(3),
    "cutoffAt" TIMESTAMP(3) NOT NULL,
    "anomalyScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyCheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthSample" (
    "id" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "checkInId" TEXT,
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
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnomalyFlag" (
    "id" TEXT NOT NULL,
    "checkInId" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "severity" "AnomalySeverity" NOT NULL,
    "details" JSONB NOT NULL,
    "status" "AnomalyStatus" NOT NULL DEFAULT 'OPEN',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnomalyFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reportedUserId" TEXT NOT NULL,
    "challengeId" TEXT,
    "reason" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "challengeId" TEXT,
    "type" "LedgerEntryType" NOT NULL,
    "status" "LedgerEntryStatus" NOT NULL DEFAULT 'PENDING',
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "description" TEXT NOT NULL,
    "stripeObjectId" TEXT,
    "stripeObjectType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "scheduledReleaseAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "stripeObjectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Badge" (
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" TEXT NOT NULL,

    CONSTRAINT "Badge_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "UserBadge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "badgeKey" TEXT NOT NULL,
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBadge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "Device_userId_idx" ON "Device"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "HealthConnection_userId_provider_key" ON "HealthConnection"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "PushToken_token_key" ON "PushToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Challenge_inviteCode_key" ON "Challenge"("inviteCode");

-- CreateIndex
CREATE INDEX "Challenge_status_visibility_idx" ON "Challenge"("status", "visibility");

-- CreateIndex
CREATE INDEX "Challenge_metricKey_idx" ON "Challenge"("metricKey");

-- CreateIndex
CREATE UNIQUE INDEX "ChallengeInvite_code_key" ON "ChallengeInvite"("code");

-- CreateIndex
CREATE INDEX "ChallengeParticipant_challengeId_status_idx" ON "ChallengeParticipant"("challengeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ChallengeParticipant_challengeId_userId_key" ON "ChallengeParticipant"("challengeId", "userId");

-- CreateIndex
CREATE INDEX "DailyCheckIn_localDate_idx" ON "DailyCheckIn"("localDate");

-- CreateIndex
CREATE INDEX "DailyCheckIn_result_idx" ON "DailyCheckIn"("result");

-- CreateIndex
CREATE UNIQUE INDEX "DailyCheckIn_participantId_challengeDay_key" ON "DailyCheckIn"("participantId", "challengeDay");

-- CreateIndex
CREATE INDEX "HealthSample_participantId_metricKey_idx" ON "HealthSample"("participantId", "metricKey");

-- CreateIndex
CREATE INDEX "HealthSample_checkInId_idx" ON "HealthSample"("checkInId");

-- CreateIndex
CREATE INDEX "AnomalyFlag_status_severity_idx" ON "AnomalyFlag"("status", "severity");

-- CreateIndex
CREATE INDEX "LedgerEntry_userId_createdAt_idx" ON "LedgerEntry"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_challengeId_idx" ON "LedgerEntry"("challengeId");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_participantId_key" ON "Payout"("participantId");

-- CreateIndex
CREATE UNIQUE INDEX "UserBadge_userId_badgeKey_key" ON "UserBadge"("userId", "badgeKey");

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthConnection" ADD CONSTRAINT "HealthConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushToken" ADD CONSTRAINT "PushToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_metricKey_fkey" FOREIGN KEY ("metricKey") REFERENCES "MetricTypeDefinition"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeInvite" ADD CONSTRAINT "ChallengeInvite_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeInvite" ADD CONSTRAINT "ChallengeInvite_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeParticipant" ADD CONSTRAINT "ChallengeParticipant_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeParticipant" ADD CONSTRAINT "ChallengeParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyCheckIn" ADD CONSTRAINT "DailyCheckIn_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "ChallengeParticipant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthSample" ADD CONSTRAINT "HealthSample_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "ChallengeParticipant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthSample" ADD CONSTRAINT "HealthSample_checkInId_fkey" FOREIGN KEY ("checkInId") REFERENCES "DailyCheckIn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthSample" ADD CONSTRAINT "HealthSample_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnomalyFlag" ADD CONSTRAINT "AnomalyFlag_checkInId_fkey" FOREIGN KEY ("checkInId") REFERENCES "DailyCheckIn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reportedUserId_fkey" FOREIGN KEY ("reportedUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "ChallengeParticipant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_badgeKey_fkey" FOREIGN KEY ("badgeKey") REFERENCES "Badge"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
