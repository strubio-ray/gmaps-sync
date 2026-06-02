import { createRequire } from "node:module";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

export function createDb(dbPath: string): {
  db: ReturnType<typeof drizzle<typeof schema>>;
  sqlite: DatabaseType;
} {
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

export function loadVecExtension(sqlite: DatabaseType): boolean {
  try {
    const require = createRequire(import.meta.url);
    const sqliteVec = require("sqlite-vec");
    sqliteVec.load(sqlite);
    return true;
  } catch {
    console.warn("sqlite-vec extension not available — vector search disabled");
    return false;
  }
}

export type Db = ReturnType<typeof createDb>["db"];
