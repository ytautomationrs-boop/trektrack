import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "./prisma.js";

let repairPromise: Promise<void> | null = null;

export function isMissingRuntimeSchemaError(err: unknown) {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? (err as { code?: unknown }).code : null;
  if (code === "P2021" || code === "P2022") return true;
  const message = "message" in err ? String((err as { message?: unknown }).message ?? "") : "";
  return /relation .* does not exist/i.test(message) || /column .* does not exist/i.test(message) || /type .* does not exist/i.test(message);
}

export async function withRuntimeSchemaRepair<T>(label: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (err) {
    if (!isMissingRuntimeSchemaError(err)) throw err;
    console.warn(`[runtime-repair] ${label} hit missing database schema; running repair and retrying once.`);
    await ensureRuntimeSchema();
    return operation();
  }
}

export function ensureRuntimeSchema() {
  repairPromise ??= runRuntimeSchemaRepair().finally(() => {
    repairPromise = null;
  });
  return repairPromise;
}

async function runRuntimeSchemaRepair() {
  const repairSqlPath = join(dirname(fileURLToPath(import.meta.url)), "../../prisma/hostinger-runtime-repair.sql");
  const sql = await readFile(repairSqlPath, "utf8");
  const statements = splitSqlStatements(sql);
  console.warn(`[runtime-repair] running ${statements.length} database repair statements`);

  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }

  console.warn("[runtime-repair] database repair completed");
}

function splitSqlStatements(sql: string) {
  const statements: string[] = [];
  let current = "";
  let singleQuoted = false;
  let doubleQuoted = false;
  let lineComment = false;
  let blockComment = false;
  let dollarTag: string | null = null;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i]!;
    const next = sql[i + 1];

    if (lineComment) {
      current += char;
      if (char === "\n") lineComment = false;
      continue;
    }

    if (blockComment) {
      current += char;
      if (char === "*" && next === "/") {
        current += next;
        i += 1;
        blockComment = false;
      }
      continue;
    }

    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) {
        current += dollarTag;
        i += dollarTag.length - 1;
        dollarTag = null;
      } else {
        current += char;
      }
      continue;
    }

    if (singleQuoted) {
      current += char;
      if (char === "'" && next === "'") {
        current += next;
        i += 1;
      } else if (char === "'") {
        singleQuoted = false;
      }
      continue;
    }

    if (doubleQuoted) {
      current += char;
      if (char === '"' && next === '"') {
        current += next;
        i += 1;
      } else if (char === '"') {
        doubleQuoted = false;
      }
      continue;
    }

    if (char === "-" && next === "-") {
      current += char + next;
      i += 1;
      lineComment = true;
      continue;
    }

    if (char === "/" && next === "*") {
      current += char + next;
      i += 1;
      blockComment = true;
      continue;
    }

    if (char === "'") {
      current += char;
      singleQuoted = true;
      continue;
    }

    if (char === '"') {
      current += char;
      doubleQuoted = true;
      continue;
    }

    if (char === "$") {
      const match = sql.slice(i).match(/^\$[A-Za-z_0-9]*\$/);
      if (match) {
        dollarTag = match[0];
        current += dollarTag;
        i += dollarTag.length - 1;
        continue;
      }
    }

    if (char === ";") {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = "";
      continue;
    }

    current += char;
  }

  const last = current.trim();
  if (last) statements.push(last);
  return statements;
}
