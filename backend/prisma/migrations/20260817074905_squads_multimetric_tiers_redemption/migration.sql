/*
  Warnings:

  - You are about to drop the column `dailyTarget` on the `Challenge` table. All the data in the column will be lost.
  - You are about to drop the column `metricKey` on the `Challenge` table. All the data in the column will be lost.
  - You are about to drop the column `actualValue` on the `DailyCheckIn` table. All the data in the column will be lost.
  - You are about to drop the column `anomalyScore` on the `DailyCheckIn` table. All the data in the column will be lost.
  - You are about to drop the column `targetValue` on the `DailyCheckIn` table. All the data in the column will be lost.
  - Added the required column `advancedTarget` to the `MetricTypeDefinition` table without a default value. This is not possible if the table is not empty.
  - Added the required column `beginnerTarget` to the `MetricTypeDefinition` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ChallengeMode" AS ENUM ('SOLO', 'SQUAD');

-- CreateEnum
CREATE TYPE "ChallengeTier" AS ENUM ('BEGINNER', 'ADVANCED');

-- CreateEnum
CREATE TYPE "EliminationScope" AS ENUM ('INDIVIDUAL');

-- AlterEnum
ALTER TYPE "CheckInResult" ADD VALUE 'REDEEMED';

-- AlterEnum
ALTER TYPE "LedgerEntryType" ADD VALUE 'REDEMPTION_FEE';

-- DropForeignKey
ALTER TABLE "Challenge" DROP CONSTRAINT "Challenge_metricKey_fkey";

-- DropIndex
DROP INDEX "Challenge_metricKey_idx";

-- AlterTable
ALTER TABLE "Challenge" DROP COLUMN "dailyTarget",
DROP COLUMN "metricKey",
ADD COLUMN     "eliminationScope" "EliminationScope" NOT NULL DEFAULT 'INDIVIDUAL',
ADD COLUMN     "maxParticipants" INTEGER,
ADD COLUMN     "mode" "ChallengeMode" NOT NULL DEFAULT 'SOLO',
ADD COLUMN     "tier" "ChallengeTier";

-- AlterTable
ALTER TABLE "ChallengeParticipant" ADD COLUMN     "redemptionFeeCents" INTEGER,
ADD COLUMN     "redemptionPurchased" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "redemptionUsed" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "DailyCheckIn" DROP COLUMN "actualValue",
DROP COLUMN "anomalyScore",
DROP COLUMN "targetValue",
ADD COLUMN     "redemptionApplied" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "MetricTypeDefinition" ADD COLUMN     "advancedTarget" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "beginnerTarget" DOUBLE PRECISION NOT NULL;

-- CreateTable
CREATE TABLE "ChallengeMetricRequirement" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "dailyTarget" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ChallengeMetricRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyMetricResult" (
    "id" TEXT NOT NULL,
    "checkInId" TEXT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "targetValue" DOUBLE PRECISION NOT NULL,
    "actualValue" DOUBLE PRECISION NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "anomalyScore" DOUBLE PRECISION,

    CONSTRAINT "DailyMetricResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChallengeMetricRequirement_metricKey_idx" ON "ChallengeMetricRequirement"("metricKey");

-- CreateIndex
CREATE UNIQUE INDEX "ChallengeMetricRequirement_challengeId_metricKey_key" ON "ChallengeMetricRequirement"("challengeId", "metricKey");

-- CreateIndex
CREATE UNIQUE INDEX "DailyMetricResult_checkInId_metricKey_key" ON "DailyMetricResult"("checkInId", "metricKey");

-- CreateIndex
CREATE INDEX "Challenge_mode_tier_idx" ON "Challenge"("mode", "tier");

-- AddForeignKey
ALTER TABLE "ChallengeMetricRequirement" ADD CONSTRAINT "ChallengeMetricRequirement_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeMetricRequirement" ADD CONSTRAINT "ChallengeMetricRequirement_metricKey_fkey" FOREIGN KEY ("metricKey") REFERENCES "MetricTypeDefinition"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyMetricResult" ADD CONSTRAINT "DailyMetricResult_checkInId_fkey" FOREIGN KEY ("checkInId") REFERENCES "DailyCheckIn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
