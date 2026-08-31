-- Leagues become per-metric.
--
-- A user now has four independent progressions — steps, running, cycling,
-- swimming — each with its own point total, level and promotion history.
-- A level is no longer meaningful on its own: "League 3" means nothing,
-- "League 3 for running" does.
--
-- Existing data is preserved by attributing it to the metric it actually
-- came from, never by discarding it.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Denormalise metricKey onto the rows that need to reach a league.
--
-- RacePrizeSchedule needs it because the league FK is now composite and
-- Prisma needs the scalar locally. RacePointEntry needs it so a profile can
-- read one metric's point history without joining through Race per row.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE "RacePrizeSchedule" ADD COLUMN "metricKey" TEXT;
UPDATE "RacePrizeSchedule" s
SET "metricKey" = t."metricKey"
FROM "RaceType" t
WHERE t."key" = s."raceTypeKey";
ALTER TABLE "RacePrizeSchedule" ALTER COLUMN "metricKey" SET NOT NULL;

ALTER TABLE "RacePointEntry" ADD COLUMN "metricKey" TEXT;
UPDATE "RacePointEntry" pe
SET "metricKey" = r."metricKey"
FROM "Race" r
WHERE r."id" = pe."raceId";
-- Any orphaned point row (race deleted) falls back to steps rather than
-- blocking the migration; there are none in practice.
UPDATE "RacePointEntry" SET "metricKey" = 'steps' WHERE "metricKey" IS NULL;
ALTER TABLE "RacePointEntry" ALTER COLUMN "metricKey" SET NOT NULL;

DROP INDEX IF EXISTS "RacePointEntry_userId_createdAt_idx";
CREATE INDEX "RacePointEntry_userId_metricKey_createdAt_idx" ON "RacePointEntry"("userId", "metricKey", "createdAt");

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Drop the old single-column league FKs before rebuilding the table.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE "Race" DROP CONSTRAINT IF EXISTS "Race_leagueLevel_fkey";
ALTER TABLE "RacePrizeSchedule" DROP CONSTRAINT IF EXISTS "RacePrizeSchedule_leagueLevel_fkey";
ALTER TABLE "UserLeagueState" DROP CONSTRAINT IF EXISTS "UserLeagueState_currentLevel_fkey";

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Rebuild LeagueLevel with a composite (metricKey, level) key.
--
-- Every existing global level is replicated across all four metrics with the
-- same name and threshold — the "seeded identically" default. isOpen is
-- carried over only for steps, the one metric that actually has public races
-- running; the others start closed, which is the honest state for a metric
-- with nothing to enter yet.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE "LeagueLevel_new" (
    "metricKey" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "minPoints" INTEGER NOT NULL,
    "isOpen" BOOLEAN NOT NULL DEFAULT false,
    "openedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeagueLevel_new_pkey" PRIMARY KEY ("metricKey", "level")
);

INSERT INTO "LeagueLevel_new" ("metricKey", "level", "name", "minPoints", "isOpen", "openedAt", "createdAt")
SELECT m."key", l."level", l."name", l."minPoints",
       CASE WHEN m."key" = 'steps' THEN l."isOpen" ELSE (l."level" = 1) END,
       CASE WHEN m."key" = 'steps' THEN l."openedAt" WHEN l."level" = 1 THEN CURRENT_TIMESTAMP ELSE NULL END,
       l."createdAt"
FROM "LeagueLevel" l
CROSS JOIN "MetricTypeDefinition" m;

DROP TABLE "LeagueLevel";
ALTER TABLE "LeagueLevel_new" RENAME TO "LeagueLevel";
-- The temp PK name is only needed while both tables coexist; Postgres keeps
-- constraint names unique per schema, so it could not be the final name yet.
ALTER TABLE "LeagueLevel" RENAME CONSTRAINT "LeagueLevel_new_pkey" TO "LeagueLevel_pkey";
CREATE INDEX "LeagueLevel_metricKey_isOpen_idx" ON "LeagueLevel"("metricKey", "isOpen");

ALTER TABLE "LeagueLevel" ADD CONSTRAINT "LeagueLevel_metricKey_fkey"
  FOREIGN KEY ("metricKey") REFERENCES "MetricTypeDefinition"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Rebuild UserLeagueState keyed by (userId, metricKey).
--
-- An existing row becomes that user's STEPS standing, because every race run
-- to date has been a steps race. Their other three metrics are created
-- lazily on first use at League 1 with zero points, which is exactly what
-- "never raced it" should look like.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE "UserLeagueState_new" (
    "userId" TEXT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "totalPoints" INTEGER NOT NULL DEFAULT 0,
    "currentLevel" INTEGER NOT NULL DEFAULT 1,
    "qualifiedLevel" INTEGER NOT NULL DEFAULT 1,
    "racesEntered" INTEGER NOT NULL DEFAULT 0,
    "racesWon" INTEGER NOT NULL DEFAULT 0,
    "promotedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserLeagueState_new_pkey" PRIMARY KEY ("userId", "metricKey")
);

INSERT INTO "UserLeagueState_new" ("userId", "metricKey", "totalPoints", "currentLevel", "qualifiedLevel", "racesEntered", "racesWon", "promotedAt", "createdAt", "updatedAt")
SELECT "userId", 'steps', "totalPoints", "currentLevel", "qualifiedLevel", "racesEntered", "racesWon", "promotedAt", "createdAt", "updatedAt"
FROM "UserLeagueState";

DROP TABLE "UserLeagueState";
ALTER TABLE "UserLeagueState_new" RENAME TO "UserLeagueState";
ALTER TABLE "UserLeagueState" RENAME CONSTRAINT "UserLeagueState_new_pkey" TO "UserLeagueState_pkey";
CREATE INDEX "UserLeagueState_metricKey_currentLevel_idx" ON "UserLeagueState"("metricKey", "currentLevel");
CREATE INDEX "UserLeagueState_metricKey_qualifiedLevel_idx" ON "UserLeagueState"("metricKey", "qualifiedLevel");

ALTER TABLE "UserLeagueState" ADD CONSTRAINT "UserLeagueState_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserLeagueState" ADD CONSTRAINT "UserLeagueState_metricKey_fkey"
  FOREIGN KEY ("metricKey") REFERENCES "MetricTypeDefinition"("key") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserLeagueState" ADD CONSTRAINT "UserLeagueState_metricKey_currentLevel_fkey"
  FOREIGN KEY ("metricKey", "currentLevel") REFERENCES "LeagueLevel"("metricKey", "level") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Re-point Race and RacePrizeSchedule at the composite league key.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE "Race" ADD CONSTRAINT "Race_metricKey_leagueLevel_fkey"
  FOREIGN KEY ("metricKey", "leagueLevel") REFERENCES "LeagueLevel"("metricKey", "level") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RacePrizeSchedule" ADD CONSTRAINT "RacePrizeSchedule_metricKey_leagueLevel_fkey"
  FOREIGN KEY ("metricKey", "leagueLevel") REFERENCES "LeagueLevel"("metricKey", "level") ON DELETE RESTRICT ON UPDATE CASCADE;
