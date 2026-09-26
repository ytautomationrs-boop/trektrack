"use strict";

const { spawnSync } = require("node:child_process");
const { chmodSync, readdirSync } = require("node:fs");
const { join } = require("node:path");

const backendDir = __dirname;
const schemaPath = join("prisma", "schema.prisma");
const runtimeRepairSqlPath = join("prisma", "hostinger-runtime-repair.sql");
const prismaCli = require.resolve("prisma/build/index.js", {
  paths: [backendDir],
});
const prismaEnginesDir = join(backendDir, "node_modules", "@prisma", "engines");
const maintenanceDisabled = process.env.DISABLE_STARTUP_DATABASE_MAINTENANCE === "true";
const runStartupDatabaseMaintenance = !maintenanceDisabled;
const skipRuntimeRepair = process.env.SKIP_DATABASE_RUNTIME_REPAIR === "true";
let migrationFailed = false;

if (process.env.RUN_STARTUP_DATABASE_MAINTENANCE === "false" && !maintenanceDisabled) {
  console.warn("[startup] RUN_STARTUP_DATABASE_MAINTENANCE=false is ignored by Hostinger startup. Set DISABLE_STARTUP_DATABASE_MAINTENANCE=true only if migrations are handled elsewhere.");
}

for (const fileName of readdirSync(prismaEnginesDir)) {
  if (fileName.startsWith("schema-engine") || fileName.startsWith("query-engine")) {
    chmodSync(join(prismaEnginesDir, fileName), 0o755);
  }
}

if (runStartupDatabaseMaintenance && process.env.SKIP_PRISMA_MIGRATE !== "true") {
  const migration = spawnSync(
    process.execPath,
    [prismaCli, "migrate", "deploy", "--schema", schemaPath],
    {
      cwd: backendDir,
      env: process.env,
      stdio: "inherit",
      timeout: 45_000,
    },
  );

  if (migration.status !== 0) {
    migrationFailed = true;
    console.warn("[startup] Prisma migrate deploy failed; continuing to start the web app. New database-backed features may not work until migrations are applied.");
  }
}

async function start() {
  // Keep deployment migrations above. Only run the expensive DDL repair when
  // a single read detects drift, or migration/probing failed. Healthy cold
  // starts no longer replay the entire repair script before serving requests.
  let repairNeeded = migrationFailed;
  let schemaClient;
  const { findMissingRuntimeColumns } = require("./startup-schema.cjs");
  const { PrismaClient, Prisma } = require("@prisma/client");
  if (runStartupDatabaseMaintenance && !skipRuntimeRepair) {
    schemaClient = new PrismaClient();
    try {
      const { ensureSocialFeatureSchema } = require("./startup-social-schema.cjs");
      await ensureSocialFeatureSchema(schemaClient);
      await require("./startup-settings-schema.cjs").ensureSettingsSchema(schemaClient);
      const missing = await findMissingRuntimeColumns(schemaClient, Prisma.dmmf.datamodel.models);
      repairNeeded = missing.length > 0;
      if (repairNeeded) console.warn(`[startup] Database schema is missing ${missing.length} expected columns; running runtime repair.`);
    } catch (err) {
      repairNeeded = true;
      console.warn("[startup] Database schema check failed; running runtime repair fallback.", err.message);
    } finally {
      await schemaClient.$disconnect();
    }
  }

  if (runStartupDatabaseMaintenance && !skipRuntimeRepair && repairNeeded) {
    if (migrationFailed) {
      console.warn("[startup] Prisma migrate failed; running Hostinger runtime repair fallback.");
    }

    const repair = spawnSync(
      process.execPath,
      [prismaCli, "db", "execute", "--schema", schemaPath, "--file", runtimeRepairSqlPath],
      {
        cwd: backendDir,
        env: process.env,
        stdio: "inherit",
        timeout: 60_000,
      },
    );

    if (repair.status !== 0) {
      console.warn("[startup] Database runtime repair failed; continuing to start the web app. Database-backed features may need manual migration.");
    }
  }

  if (process.env.RUN_PRISMA_SEED_ON_START === "true") {
    const seed = spawnSync("npm", ["run", "seed"], {
      cwd: backendDir,
      env: process.env,
      stdio: "inherit",
      timeout: 45_000,
    });

    if (seed.status !== 0) {
      console.warn("[startup] Prisma seed failed; continuing to start the web app. Race/pool catalog data may need manual seeding.");
    }
  }

  const { startProductionServer } = await import("./dist/server.js");
  await startProductionServer();
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
