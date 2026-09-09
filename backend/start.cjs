"use strict";

const { spawnSync } = require("node:child_process");
const { join } = require("node:path");

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const backendDir = __dirname;
const schemaPath = join("prisma", "schema.prisma");

const migration = spawnSync(
  npmCmd,
  ["exec", "--", "prisma", "migrate", "deploy", "--schema", schemaPath],
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
