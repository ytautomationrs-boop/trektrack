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

for (const fileName of readdirSync(prismaEnginesDir)) {
  if (fileName.startsWith("schema-engine") || fileName.startsWith("query-engine")) {
    chmodSync(join(prismaEnginesDir, fileName), 0o755);
  }
}

if (process.env.SKIP_PRISMA_MIGRATE !== "true") {
  const migration = spawnSync(
    process.execPath,
    [prismaCli, "migrate", "deploy", "--schema", schemaPath],
    {
      cwd: backendDir,
      env: process.env,
      stdio: "inherit",
    },
  );

  if (migration.status !== 0) {
    console.warn("[startup] Prisma migrate deploy failed; continuing to start the web app. New database-backed features may not work until migrations are applied.");
  }
}

const repair = spawnSync(
  process.execPath,
  [prismaCli, "db", "execute", "--schema", schemaPath, "--file", runtimeRepairSqlPath],
  {
    cwd: backendDir,
    env: process.env,
    stdio: "inherit",
  },
);

if (repair.status !== 0) {
  console.warn("[startup] Database runtime repair failed; continuing to start the web app. Social/profile/admin features may need manual migration.");
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
