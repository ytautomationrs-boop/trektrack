"use strict";

const { spawnSync } = require("node:child_process");
const { chmodSync, readdirSync } = require("node:fs");
const { join } = require("node:path");

const backendDir = __dirname;
const schemaPath = join("prisma", "schema.prisma");
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
    process.exit(migration.status ?? 1);
  }
}

import("./dist/server.js")
  .then(({ startProductionServer }) => startProductionServer())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
