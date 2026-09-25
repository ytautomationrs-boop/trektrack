"use strict";

/** Detect migration-history drift with one read, without taking DDL locks. */
async function findMissingRuntimeColumns(prisma, models) {
  const expected = models.flatMap((model) => model.fields
    .filter((field) => field.kind !== "object")
    .map((field) => ({ table: model.dbName || model.name, column: field.dbName || field.name })));
  return prisma.$queryRawUnsafe(`
    SELECT expected."table", expected."column"
    FROM jsonb_to_recordset($1::jsonb) AS expected("table" text, "column" text)
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns actual
      WHERE actual.table_schema = current_schema()
        AND actual.table_name = expected."table"
        AND actual.column_name = expected."column"
    )
  `, JSON.stringify(expected));
}

module.exports = { findMissingRuntimeColumns };
