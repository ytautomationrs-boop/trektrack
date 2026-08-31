-- Squad all-fail-together (spec 1 update): WHOLE_GROUP is now mandatory for
-- every SQUAD-mode challenge (forced at creation, see
-- modules/challenges/routes.ts). Backfill any squad challenges created
-- before this migration so they aren't left on the old per-member default.
UPDATE "Challenge" SET "eliminationScope" = 'WHOLE_GROUP' WHERE "mode" = 'SQUAD';
