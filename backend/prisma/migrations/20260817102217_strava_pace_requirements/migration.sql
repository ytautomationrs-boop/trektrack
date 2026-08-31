-- CreateEnum
CREATE TYPE "MetricDataSource" AS ENUM ('NATIVE_HEALTH', 'STRAVA');

-- AlterEnum
ALTER TYPE "DataSourceCategory" ADD VALUE 'RUNNING_WORKOUT';

-- AlterTable
ALTER TABLE "ChallengeMetricRequirement" ADD COLUMN     "paceTargetSecPerKm" INTEGER;

-- AlterTable
ALTER TABLE "DailyMetricResult" ADD COLUMN     "actualPaceSecPerKm" DOUBLE PRECISION,
ADD COLUMN     "dataSource" "MetricDataSource" NOT NULL DEFAULT 'NATIVE_HEALTH',
ADD COLUMN     "paceTargetSecPerKm" INTEGER;

-- AlterTable
ALTER TABLE "MetricTypeDefinition" ADD COLUMN     "supportsPaceTarget" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "StravaConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stravaAthleteId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "scope" TEXT NOT NULL,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "StravaConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StravaConnection_userId_key" ON "StravaConnection"("userId");

-- AddForeignKey
ALTER TABLE "StravaConnection" ADD CONSTRAINT "StravaConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
