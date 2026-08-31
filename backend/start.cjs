"use strict";

import("./dist/server.js")
  .then(({ startProductionServer }) => startProductionServer())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
