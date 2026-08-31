-- Evidence trail + anomaly flags for StreakPot check-ins, mirroring
-- RaceHealthSample / RaceAnomalyFlag. Purely additive.
--
-- Scoring is deliberately unchanged: DailyMetricResult.actualValue is still
-- computed from the submitted payload, not by summing these rows. This table
-- exists for auditability and for the anomaly baseline, which previously had
-- only race samples to draw on and so was permanently empty for anyone who
-- had only ever done challenges.

-- CreateTable
CREATE TABLE "ChallengeHealthSample" (
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
    "dataSource" "MetricDataSource" NOT NULL DEFAULT 'NATIVE_HEALTH',
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChallengeHealthSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChallengeAnomalyFlag" (
    "id" TEXT NOT NULL,
    "sampleId" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "severity" "AnomalySeverity" NOT NULL,
    "details" JSONB NOT NULL,
    "status" "AnomalyStatus" NOT NULL DEFAULT 'OPEN',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChallengeAnomalyFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChallengeHealthSample_participantId_metricKey_idx" ON "ChallengeHealthSample"("participantId", "metricKey");

-- CreateIndex
CREATE INDEX "ChallengeHealthSample_participantId_startTime_idx" ON "ChallengeHealthSample"("participantId", "startTime");

-- CreateIndex
CREATE INDEX "ChallengeHealthSample_checkInId_idx" ON "ChallengeHealthSample"("checkInId");

-- CreateIndex
CREATE INDEX "ChallengeAnomalyFlag_status_severity_idx" ON "ChallengeAnomalyFlag"("status", "severity");

-- CreateIndex
CREATE INDEX "ChallengeAnomalyFlag_participantId_status_idx" ON "ChallengeAnomalyFlag"("participantId", "status");

-- CreateIndex
CREATE INDEX "ChallengeAnomalyFlag_challengeId_status_idx" ON "ChallengeAnomalyFlag"("challengeId", "status");

-- AddForeignKey
ALTER TABLE "ChallengeHealthSample" ADD CONSTRAINT "ChallengeHealthSample_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "ChallengeParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeHealthSample" ADD CONSTRAINT "ChallengeHealthSample_checkInId_fkey" FOREIGN KEY ("checkInId") REFERENCES "DailyCheckIn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeHealthSample" ADD CONSTRAINT "ChallengeHealthSample_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeAnomalyFlag" ADD CONSTRAINT "ChallengeAnomalyFlag_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "ChallengeHealthSample"("id") ON DELETE CASCADE ON UPDATE CASCADE;

