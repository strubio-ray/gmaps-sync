import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../src/db.js";
import { runMigrations } from "../src/migrate.js";
import { placeLists, places } from "../src/schema.js";

describe("database", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "gmaps-db-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates all tables via migration", () => {
    const dbPath = join(tempDir, "test.db");
    const { sqlite } = createDb(dbPath);
    runMigrations(sqlite);

    const tableNames = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tableNames).toContain("places");
    expect(tableNames).toContain("lists");
    expect(tableNames).toContain("place_lists");
    expect(tableNames).toContain("sync_metadata");
    expect(tableNames).toContain("discovery_metadata");
    expect(tableNames).toContain("sync_state");
    expect(tableNames).toContain("pending_mutations");
    expect(tableNames).toContain("places_fts");

    sqlite.close();
  });

  it("can insert and query a place via drizzle", () => {
    const dbPath = join(tempDir, "test.db");
    const { db, sqlite } = createDb(dbPath);
    runMigrations(sqlite);

    const now = new Date().toISOString();
    db.insert(places)
      .values({
        googlePlaceId: "ChIJ_test123",
        name: "Test Place",
        lat: 29.75,
        lng: -95.37,
        address: "123 Main St",
        contentHash: "sha256:abc",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const result = db.select().from(places).all();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Test Place");
    expect(result[0].googlePlaceId).toBe("ChIJ_test123");

    sqlite.close();
  });

  it("enforces foreign key on place_lists", () => {
    const dbPath = join(tempDir, "test.db");
    const { db, sqlite } = createDb(dbPath);
    runMigrations(sqlite);

    expect(() => {
      db.insert(placeLists)
        .values({
          googlePlaceId: "nonexistent",
          listId: "also_nonexistent",
        })
        .run();
    }).toThrow();

    sqlite.close();
  });

  it("FTS5 index is queryable", () => {
    const dbPath = join(tempDir, "test.db");
    const { db, sqlite } = createDb(dbPath);
    runMigrations(sqlite);

    const now = new Date().toISOString();
    db.insert(places)
      .values({
        googlePlaceId: "ChIJ_fts_test",
        name: "Osteria Philadelphia",
        lat: 39.95,
        lng: -75.17,
        address: "1234 Walnut St, Philadelphia, PA",
        contentHash: "sha256:fts",
        createdAt: now,
        updatedAt: now,
        editorialSummary: "Upscale Italian restaurant",
      })
      .run();

    const ftsResults = sqlite
      .prepare("SELECT * FROM places_fts WHERE places_fts MATCH 'Philadelphia'")
      .all();
    expect(ftsResults).toHaveLength(1);

    sqlite.close();
  });

  it("is idempotent — running migrations twice is safe", () => {
    const dbPath = join(tempDir, "test.db");
    const { sqlite } = createDb(dbPath);
    runMigrations(sqlite);
    runMigrations(sqlite); // Should not throw

    sqlite.close();
  });
});
