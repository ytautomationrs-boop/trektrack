"use strict";

const { spawnSync } = require("node:child_process");
const { chmodSync, readdirSync } = require("node:fs");
const { join } = require("node:path");

const backendDir = __dirname;
const schemaPath = join("prisma", "schema.prisma");
const runtimeSchemaCheckSqlPath = join("prisma", "hostinger-runtime-schema-check.sql");
const runtimeRepairSqlPath = join("prisma", "hostinger-runtime-repair.sql");
const prismaCli = require.resolve("prisma/build/index.js", {
  paths: [backendDir],
});
const prismaEnginesDir = join(backendDir, "node_modules", "@prisma", "engines");
const isProduction = process.env.NODE_ENV === "production";
const maintenanceDisabled = process.env.DISABLE_STARTUP_DATABASE_MAINTENANCE === "true";
const runStartupDatabaseMaintenance =
  !maintenanceDisabled && (process.env.RUN_STARTUP_DATABASE_MAINTENANCE === "true" || isProduction);
const forceRuntimeRepair = process.env.FORCE_DATABASE_RUNTIME_REPAIR === "true";
let migrationFailed = false;
let runtimeSchemaMissing = forceRuntimeRepair;

if (isProduction && process.env.RUN_STARTUP_DATABASE_MAINTENANCE === "false" && !maintenanceDisabled) {
  console.warn("[startup] RUN_STARTUP_DATABASE_MAINTENANCE=false is ignored in production. Set DISABLE_STARTUP_DATABASE_MAINTENANCE=true only if migrations are handled elsewhere.");
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

if (runStartupDatabaseMaintenance && !runtimeSchemaMissing) {
  const schemaCheck = spawnSync(
    process.execPath,
    [prismaCli, "db", "execute", "--schema", schemaPath, "--file", runtimeSchemaCheckSqlPath],
    {
      cwd: backendDir,
      env: process.env,
      stdio: "ignore",
      timeout: 15_000,
    },
  );

  if (schemaCheck.status !== 0) {
    runtimeSchemaMissing = true;
    console.warn("[startup] Database schema check failed; running Hostinger runtime repair.");
  }
}

// Hostinger deployments have previously had Prisma migration history drift
// from the actual database shape. This idempotent repair only runs when the
// schema probe fails, migrate fails, or repair is explicitly forced.
if (runStartupDatabaseMaintenance && (migrationFailed || runtimeSchemaMissing)) {
  const repair = spawnSync(
    process.execPath,
    [prismaCli, "db", "execute", "--schema", schemaPath, "--file", runtimeRepairSqlPath],
    {
      cwd: backendDir,
      env: process.env,
      stdio: "inherit",
      timeout: 30_000,
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

import("./dist/server.js")
  .then(({ startProductionServer }) => startProductionServer())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
