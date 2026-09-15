UPDATE "RaceType"
SET "entrantCount" = 2
WHERE "format" = 'SQUAD';

UPDATE "RacePrizeTier" tier
SET "amountCents" = CASE
  WHEN race_type."durationDays" = 1 THEN 15000
  ELSE 30000
END
FROM "RacePrizeSchedule" schedule
JOIN "RaceType" race_type ON race_type."key" = schedule."raceTypeKey"
WHERE tier."scheduleId" = schedule."id"
  AND race_type."format" = 'SQUAD'
  AND tier."position" = 1;
