"use strict";

const { spawnSync } = require("node:child_process");
const { join } = require("node:path");

const backendDir = __dirname;
const schemaPath = join("prisma", "schema.prisma");
const prismaCli = require.resolve("prisma/build/index.js", {
  paths: [backendDir],
});

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

import("./dist/server.js")
  .then(({ startProductionServer }) => startProductionServer())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
