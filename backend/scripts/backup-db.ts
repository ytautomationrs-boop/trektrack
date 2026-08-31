import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Full logical backup of every table to a single JSON file.
 *
 * Written because pg_dump is not installed on this machine (the PostgreSQL
 * server is present, the client tools are not). Together with
 * prisma/migrations — which fully reconstructs the schema — this JSON is a
 * complete restore path for the data.
 *
 * Run:  npm run db:backup
 *
 * Restoring is a manual job: check out the migration set that matches the
 * dump, `prisma migrate deploy`, then insert the rows in the order listed in
 * TABLES below (it is dependency-ordered, parents first).
 */

const prisma = new PrismaClient();

// Dependency order — parents before children, so a restore can replay it
// top to bottom without violating foreign keys.
const TABLES = [
  "user",
  "metricTypeDefinition",
  "device",
  "healthConnection",
  "stravaConnection",
  "pushToken",
  "badge",
  "userBadge",
  "challenge",
  "challengeMetricRequirement",
  "challengeInvite",
  "challengeParticipant",
  "dailyCheckIn",
  "dailyMetricResult",
  "healthSample",
  "anomalyFlag",
  "report",
  "payout",
  "leagueLevel",
  "raceType",
  "racePrizeSchedule",
  "racePrizeTier",
  "race",
  "raceSquad",
  "raceEntry",
  "raceHealthSample",
  "raceAnomalyFlag",
  "userLeagueState",
  "racePointEntry",
  "ledgerEntry",
  "withdrawal",
] as const;

async function main() {
  const dump: Record<string, unknown[]> = {};
  let total = 0;

  for (const table of TABLES) {
    // Raw SQL rather than the Prisma client on purpose: a backup has to work
    // when the client and the database have drifted apart, which is exactly
    // the moment you most want one — mid-migration, or just before a risky
    // change. Going through the client fails on any column it believes
    // should exist but does not yet.
    const relation = table.charAt(0).toUpperCase() + table.slice(1);
    let rows: unknown[];
    try {
      rows = await prisma.$queryRawUnsafe<unknown[]>(`SELECT * FROM "${relation}"`);
    } catch {
      console.warn(`  (skipped ${table} — no such table)`);
      continue;
    }
    dump[table] = rows;
    total += rows.length;
    if (rows.length > 0) console.log(`  ${table}: ${rows.length}`);
  }

  const dir = join(process.cwd(), "..", "backups");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = join(dir, `streak-db-${stamp}.json`);

  writeFileSync(
    file,
    JSON.stringify(
      {
        takenAt: new Date().toISOString(),
        note: "Full logical dump. Schema lives in backend/prisma/migrations. Tables are dependency-ordered for replay.",
        tableOrder: TABLES,
        data: dump,
      },
      // Dates serialise to ISO strings by default; BigInt would not, so guard it.
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
      2
    )
  );

  console.log(`\n${total} rows across ${Object.keys(dump).length} tables`);
  console.log(`written to ${file}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
