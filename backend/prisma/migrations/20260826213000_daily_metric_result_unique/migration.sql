-- One result row per required metric per check-in, so ingestion can upsert
-- as more samples arrive during the day instead of accumulating duplicates.
CREATE UNIQUE INDEX "DailyMetricResult_checkInId_metricKey_key" ON "DailyMetricResult"("checkInId", "metricKey");
