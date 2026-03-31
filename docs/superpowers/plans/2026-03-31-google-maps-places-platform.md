# Google Maps Places Platform — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **This plan is designed for a single implementation session.** All tasks are sequential and build on each other. Do not stop between tasks — complete the full plan in one pass.

**Goal:** Transform gmaps-sync from a standalone JSON-file scraper into a monorepo platform with a shared SQLite data layer, Google Places API enrichment, and vector embeddings for semantic search.

**Architecture:** pnpm monorepo with 5 packages (core, sync, discovery, push, cli). Core owns the SQLite database (via Drizzle ORM + better-sqlite3), enrichment pipeline, and embedding engine. Sync is the refactored gmaps-sync scraping logic. Discovery and push are boilerplate stubs. CLI wires everything together via Commander.js.

**Tech Stack:** TypeScript (ESM, Node16), pnpm workspaces, Drizzle ORM, better-sqlite3, sqlite-vec, onnxruntime-node, Playwright, Vitest

**Spec:** `docs/superpowers/specs/2026-03-31-google-maps-places-platform-design.md`

---

### Task 1: Monorepo Root Scaffolding

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Modify: `package.json` (convert to workspace root)
- Create: `.npmrc`

- [ ] **Step 1: Create pnpm workspace config**

```yaml
# pnpm-workspace.yaml
packages:
  - "packages/*"
```

- [ ] **Step 2: Create shared tsconfig base**

```json
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "resolveJsonModule": true,
    "sourceMap": true,
    "composite": true
  }
}
```

- [ ] **Step 3: Create .npmrc for pnpm**

```ini
# .npmrc
shamefully-hoist=false
strict-peer-dependencies=false
```

- [ ] **Step 4: Convert root package.json to workspace root**

Replace the entire `package.json` with:

```json
{
  "name": "google-maps-places",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -b",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "tsc -b --noEmit"
  },
  "devDependencies": {
    "@types/node": "^25.5.0",
    "tsx": "^4.21.0",
    "typescript": "^6.0.2",
    "vitest": "^4.1.2"
  }
}
```

- [ ] **Step 5: Move existing vitest.config.ts to root**

Update `vitest.config.ts` to find tests across all packages:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["packages/*/tests/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 6: Delete the old tsconfig.json**

Remove `tsconfig.json` (replaced by `tsconfig.base.json` and per-package configs).

- [ ] **Step 7: Commit**

```
git add -A && git commit -m "chore: convert to pnpm monorepo workspace root"
```

---

### Task 2: Core Package — Scaffolding & Types

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/types.ts`

- [ ] **Step 1: Create core package.json**

```json
{
  "name": "@gmaps/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc"
  },
  "dependencies": {
    "better-sqlite3": "^11.9.1",
    "dotenv": "^16.5.0",
    "drizzle-orm": "^0.44.2"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.13",
    "drizzle-kit": "^0.31.1"
  }
}
```

- [ ] **Step 2: Create core tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create shared types**

Create `packages/core/src/types.ts`:

```typescript
/** Simplified config — no profiles */
export interface SyncConfig {
  delayBetweenListsMs: [number, number];
  navigationTimeoutMs: number;
  maxConsecutiveFailures: number;
}

export interface EnrichmentConfig {
  reEnrichAfterDays: number;
}

export interface AppConfig {
  browserProfileDir: string;
  sync: SyncConfig;
  headless: boolean;
  useSystemChrome: boolean;
  snapshotsRetentionDays: number;
  enrichment: EnrichmentConfig;
}

/** Raw parsed data from the scraper before diff processing */
export interface ParsedList {
  id: string | null;
  name: string;
  type: number;
  count: number;
}

export interface ParsedPlace {
  name: string;
  lat: number;
  lng: number;
  address: string;
  comment: string | null;
  placeId: string;
  placeRef: string | null;
}
```

- [ ] **Step 4: Commit**

```
git add -A && git commit -m "feat: scaffold core package with types"
```

---

### Task 3: Core Package — Drizzle Schema & Database

**Files:**
- Create: `packages/core/src/schema.ts`
- Create: `packages/core/src/db.ts`
- Create: `drizzle.config.ts`

- [ ] **Step 1: Create Drizzle schema**

Create `packages/core/src/schema.ts`:

```typescript
import { sqliteTable, text, real, integer, primaryKey, index } from "drizzle-orm/sqlite-core";

export const places = sqliteTable("places", {
  googlePlaceId: text("google_place_id").primaryKey(),
  legacyId: text("legacy_id").unique(),
  name: text("name").notNull(),
  lat: real("lat").notNull(),
  lng: real("lng").notNull(),
  address: text("address").notNull().default(""),
  comment: text("comment"),
  contentHash: text("content_hash").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),

  // Enrichment fields (nullable until enriched)
  rating: real("rating"),
  userRatingCount: integer("user_rating_count"),
  priceLevel: integer("price_level"),
  primaryType: text("primary_type"),
  types: text("types"), // JSON array
  editorialSummary: text("editorial_summary"),
  reviewsText: text("reviews_text"),
  generativeSummary: text("generative_summary"),

  // Boolean service/amenity attributes (0/1)
  servesBreakfast: integer("serves_breakfast"),
  servesLunch: integer("serves_lunch"),
  servesDinner: integer("serves_dinner"),
  servesBrunch: integer("serves_brunch"),
  servesBeer: integer("serves_beer"),
  servesWine: integer("serves_wine"),
  servesCocktails: integer("serves_cocktails"),
  servesCoffee: integer("serves_coffee"),
  servesDessert: integer("serves_dessert"),
  servesVegetarianFood: integer("serves_vegetarian_food"),
  outdoorSeating: integer("outdoor_seating"),
  liveMusic: integer("live_music"),
  goodForChildren: integer("good_for_children"),
  goodForGroups: integer("good_for_groups"),
  allowsDogs: integer("allows_dogs"),
  dineIn: integer("dine_in"),
  delivery: integer("delivery"),
  takeout: integer("takeout"),

  // Other enrichment
  businessStatus: text("business_status"),
  websiteUri: text("website_uri"),
  phoneNumber: text("phone_number"),

  // Pipeline timestamps
  enrichedAt: text("enriched_at"),
  embeddedAt: text("embedded_at"),
});

export const lists = sqliteTable("lists", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: integer("type").notNull(),
  lastSeenRemote: text("last_seen_remote"),
  removedRemote: integer("removed_remote").notNull().default(0),
});

export const placeLists = sqliteTable(
  "place_lists",
  {
    googlePlaceId: text("google_place_id")
      .notNull()
      .references(() => places.googlePlaceId),
    listId: text("list_id")
      .notNull()
      .references(() => lists.id),
  },
  (table) => [
    primaryKey({ columns: [table.googlePlaceId, table.listId] }),
  ],
);

export const syncMetadata = sqliteTable("sync_metadata", {
  googlePlaceId: text("google_place_id")
    .primaryKey()
    .references(() => places.googlePlaceId),
  source: text("source").notNull().default("pull"),
  firstSeen: text("first_seen").notNull(),
  lastSeenRemote: text("last_seen_remote"),
  removedRemote: integer("removed_remote").notNull().default(0),
});

export const discoveryMetadata = sqliteTable("discovery_metadata", {
  googlePlaceId: text("google_place_id")
    .primaryKey()
    .references(() => places.googlePlaceId),
  discoveredAt: text("discovered_at").notNull(),
  discoveryQuery: text("discovery_query"),
  discoveryLat: real("discovery_lat"),
  discoveryLng: real("discovery_lng"),
  discoveryRadius: integer("discovery_radius"),
});

export const syncState = sqliteTable("sync_state", {
  id: integer("id").primaryKey().default(1),
  lastPull: text("last_pull"),
  lastPullStatus: text("last_pull_status"),
  schemaVersion: integer("schema_version").notNull().default(1),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
});

export const pendingMutations = sqliteTable(
  "pending_mutations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    type: text("type").notNull(),
    status: text("status").notNull().default("pending"),
    placeId: text("place_id"),
    listId: text("list_id"),
    payload: text("payload").notNull().default("{}"),
    groupId: text("group_id"),
    seq: integer("seq").notNull().default(0),
    retryCount: integer("retry_count").notNull().default(0),
    maxRetries: integer("max_retries").notNull().default(3),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    pushedAt: text("pushed_at"),
  },
  (table) => [
    index("idx_pending_mutations_place_status").on(table.placeId, table.status),
    index("idx_pending_mutations_status").on(table.status, table.createdAt),
    index("idx_pending_mutations_group").on(table.groupId, table.seq),
    index("idx_pending_mutations_list").on(table.listId, table.status),
  ],
);
```

- [ ] **Step 2: Create database connection module**

Create `packages/core/src/db.ts`:

```typescript
import Database from "better-sqlite3";
import { createRequire } from "node:module";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

export function createDb(dbPath: string) {
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

export function loadVecExtension(sqlite: Database.Database): boolean {
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
```

- [ ] **Step 3: Create drizzle.config.ts at repo root**

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./packages/core/src/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
});
```

- [ ] **Step 4: Create core barrel export**

Create `packages/core/src/index.ts`:

```typescript
export * from "./schema.js";
export * from "./db.js";
export * from "./types.js";
export * from "./config.js";
```

Note: `migrate.js`, `enrichment.js`, and `embedding.js` will be added to this barrel in later tasks.

- [ ] **Step 5: Commit**

```
git add -A && git commit -m "feat(core): add drizzle schema and database connection"
```

---

### Task 4: Core Package — Config

**Files:**
- Create: `packages/core/src/config.ts`
- Create: `packages/core/tests/config.test.ts`

- [ ] **Step 1: Write the config test**

Create `packages/core/tests/config.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, DEFAULT_CONFIG } from "../src/config.js";

describe("loadConfig", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "gmaps-config-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns default config when no config file exists", () => {
    const config = loadConfig(join(tempDir, "nonexistent.json"));
    expect(config.headless).toBe(true);
    expect(config.sync.maxConsecutiveFailures).toBe(2);
    expect(config.enrichment.reEnrichAfterDays).toBe(30);
  });

  it("does not have profiles", () => {
    const config = loadConfig(join(tempDir, "nonexistent.json"));
    expect(config).not.toHaveProperty("profiles");
  });

  it("merges partial config with defaults", () => {
    const partial = { headless: false, enrichment: { reEnrichAfterDays: 7 } };
    writeFileSync(join(tempDir, "config.json"), JSON.stringify(partial));
    const config = loadConfig(join(tempDir, "config.json"));
    expect(config.headless).toBe(false);
    expect(config.enrichment.reEnrichAfterDays).toBe(7);
    expect(config.sync.maxConsecutiveFailures).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/tests/config.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the config module**

Create `packages/core/src/config.ts`:

```typescript
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { AppConfig } from "./types.js";

export const BASE_DIR = join(homedir(), ".gmaps-sync");
export const DB_PATH = join(BASE_DIR, "places.db");

export const DEFAULT_CONFIG: AppConfig = {
  browserProfileDir: join(BASE_DIR, "browser"),
  sync: {
    delayBetweenListsMs: [2000, 5000],
    navigationTimeoutMs: 30000,
    maxConsecutiveFailures: 2,
  },
  headless: true,
  useSystemChrome: true,
  snapshotsRetentionDays: 30,
  enrichment: {
    reEnrichAfterDays: 30,
  },
};

export function loadConfig(configPath?: string): AppConfig {
  const path = configPath ?? join(BASE_DIR, "config.json");
  if (!existsSync(path)) {
    return { ...DEFAULT_CONFIG };
  }

  const raw = readFileSync(path, "utf-8");
  const partial = JSON.parse(raw) as Partial<AppConfig>;

  return {
    ...DEFAULT_CONFIG,
    ...partial,
    sync: { ...DEFAULT_CONFIG.sync, ...partial.sync },
    enrichment: { ...DEFAULT_CONFIG.enrichment, ...partial.enrichment },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/tests/config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```
git add -A && git commit -m "feat(core): add simplified config without profiles"
```

---

### Task 5: Core Package — Database Migration & Init

**Files:**
- Create: `packages/core/src/migrate.ts`
- Create: `packages/core/tests/db.test.ts`

- [ ] **Step 1: Write the database init test**

Create `packages/core/tests/db.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDb } from "../src/db.js";
import { runMigrations } from "../src/migrate.js";
import { places, lists, placeLists } from "../src/schema.js";

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
      .map((row: any) => row.name);

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
    db.insert(places).values({
      googlePlaceId: "ChIJ_test123",
      name: "Test Place",
      lat: 29.75,
      lng: -95.37,
      address: "123 Main St",
      contentHash: "sha256:abc",
      createdAt: now,
      updatedAt: now,
    }).run();

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
      db.insert(placeLists).values({
        googlePlaceId: "nonexistent",
        listId: "also_nonexistent",
      }).run();
    }).toThrow();

    sqlite.close();
  });

  it("FTS5 index is queryable", () => {
    const dbPath = join(tempDir, "test.db");
    const { db, sqlite } = createDb(dbPath);
    runMigrations(sqlite);

    const now = new Date().toISOString();
    db.insert(places).values({
      googlePlaceId: "ChIJ_fts_test",
      name: "Osteria Philadelphia",
      lat: 39.95,
      lng: -75.17,
      address: "1234 Walnut St, Philadelphia, PA",
      contentHash: "sha256:fts",
      createdAt: now,
      updatedAt: now,
      editorialSummary: "Upscale Italian restaurant",
    }).run();

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/tests/db.test.ts`
Expected: FAIL — migrate module not found

- [ ] **Step 3: Write the migration module**

Create `packages/core/src/migrate.ts`:

```typescript
import type Database from "better-sqlite3";

export function runMigrations(sqlite: Database.Database): void {
  sqlite.pragma("foreign_keys = ON");

  const hasPlaces = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='places'")
    .get();

  if (hasPlaces) return;

  sqlite.exec(`
    CREATE TABLE places (
      google_place_id    TEXT PRIMARY KEY,
      legacy_id          TEXT UNIQUE,
      name               TEXT NOT NULL,
      lat                REAL NOT NULL,
      lng                REAL NOT NULL,
      address            TEXT NOT NULL DEFAULT '',
      comment            TEXT,
      content_hash       TEXT NOT NULL,
      created_at         TEXT NOT NULL,
      updated_at         TEXT NOT NULL,

      rating             REAL,
      user_rating_count  INTEGER,
      price_level        INTEGER,
      primary_type       TEXT,
      types              TEXT,
      editorial_summary  TEXT,
      reviews_text       TEXT,
      generative_summary TEXT,

      serves_breakfast   INTEGER,
      serves_lunch       INTEGER,
      serves_dinner      INTEGER,
      serves_brunch      INTEGER,
      serves_beer        INTEGER,
      serves_wine        INTEGER,
      serves_cocktails   INTEGER,
      serves_coffee      INTEGER,
      serves_dessert     INTEGER,
      serves_vegetarian_food INTEGER,
      outdoor_seating    INTEGER,
      live_music         INTEGER,
      good_for_children  INTEGER,
      good_for_groups    INTEGER,
      allows_dogs        INTEGER,
      dine_in            INTEGER,
      delivery           INTEGER,
      takeout            INTEGER,

      business_status    TEXT,
      website_uri        TEXT,
      phone_number       TEXT,

      enriched_at        TEXT,
      embedded_at        TEXT
    );

    CREATE TABLE lists (
      id                 TEXT PRIMARY KEY,
      name               TEXT NOT NULL,
      type               INTEGER NOT NULL,
      last_seen_remote   TEXT,
      removed_remote     INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE place_lists (
      google_place_id    TEXT NOT NULL REFERENCES places(google_place_id),
      list_id            TEXT NOT NULL REFERENCES lists(id),
      PRIMARY KEY (google_place_id, list_id)
    );

    CREATE TABLE sync_metadata (
      google_place_id    TEXT PRIMARY KEY REFERENCES places(google_place_id),
      source             TEXT NOT NULL DEFAULT 'pull',
      first_seen         TEXT NOT NULL,
      last_seen_remote   TEXT,
      removed_remote     INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE discovery_metadata (
      google_place_id    TEXT PRIMARY KEY REFERENCES places(google_place_id),
      discovered_at      TEXT NOT NULL,
      discovery_query    TEXT,
      discovery_lat      REAL,
      discovery_lng      REAL,
      discovery_radius   INTEGER
    );

    CREATE TABLE sync_state (
      id                     INTEGER PRIMARY KEY DEFAULT 1,
      last_pull              TEXT,
      last_pull_status       TEXT CHECK (last_pull_status IN ('success', 'partial', 'failure')),
      schema_version         INTEGER NOT NULL DEFAULT 1,
      consecutive_failures   INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE pending_mutations (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      type          TEXT NOT NULL CHECK (type IN (
                        'add_place_to_list',
                        'remove_place_from_list',
                        'move_place_between_lists',
                        'rename_list',
                        'create_list',
                        'delete_list'
                    )),
      status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                        'pending', 'in_progress', 'pushed', 'failed'
                    )),
      place_id      TEXT,
      list_id       TEXT,
      payload       TEXT NOT NULL DEFAULT '{}',
      group_id      TEXT,
      seq           INTEGER NOT NULL DEFAULT 0,
      retry_count   INTEGER NOT NULL DEFAULT 0,
      max_retries   INTEGER NOT NULL DEFAULT 3,
      last_error    TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      pushed_at     TEXT
    );

    CREATE INDEX idx_pending_mutations_place_status
        ON pending_mutations (place_id, status)
        WHERE place_id IS NOT NULL AND status IN ('pending', 'in_progress');

    CREATE INDEX idx_pending_mutations_status
        ON pending_mutations (status, created_at);

    CREATE INDEX idx_pending_mutations_group
        ON pending_mutations (group_id, seq)
        WHERE group_id IS NOT NULL AND status = 'pending';

    CREATE INDEX idx_pending_mutations_list
        ON pending_mutations (list_id, status)
        WHERE list_id IS NOT NULL;

    CREATE VIRTUAL TABLE places_fts USING fts5(
      name,
      address,
      editorial_summary,
      reviews_text,
      content=places,
      content_rowid=rowid
    );

    CREATE TRIGGER places_fts_insert AFTER INSERT ON places BEGIN
      INSERT INTO places_fts(rowid, name, address, editorial_summary, reviews_text)
      VALUES (NEW.rowid, NEW.name, NEW.address, NEW.editorial_summary, NEW.reviews_text);
    END;

    CREATE TRIGGER places_fts_update AFTER UPDATE ON places BEGIN
      INSERT INTO places_fts(places_fts, rowid, name, address, editorial_summary, reviews_text)
      VALUES ('delete', OLD.rowid, OLD.name, OLD.address, OLD.editorial_summary, OLD.reviews_text);
      INSERT INTO places_fts(rowid, name, address, editorial_summary, reviews_text)
      VALUES (NEW.rowid, NEW.name, NEW.address, NEW.editorial_summary, NEW.reviews_text);
    END;

    CREATE TRIGGER places_fts_delete AFTER DELETE ON places BEGIN
      INSERT INTO places_fts(places_fts, rowid, name, address, editorial_summary, reviews_text)
      VALUES ('delete', OLD.rowid, OLD.name, OLD.address, OLD.editorial_summary, OLD.reviews_text);
    END;

    INSERT INTO sync_state (id) VALUES (1);
  `);
}
```

- [ ] **Step 4: Add migrate.ts to core barrel export**

In `packages/core/src/index.ts`, add:

```typescript
export * from "./migrate.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/core/tests/db.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 6: Commit**

```
git add -A && git commit -m "feat(core): add database migration with all tables and FTS5"
```

---

### Task 6: Sync Package — Scaffolding & Refactored Parser

**Files:**
- Create: `packages/sync/package.json`
- Create: `packages/sync/tsconfig.json`
- Move & Modify: `src/parser.ts` -> `packages/sync/src/parser.ts`
- Move: `schema.json` -> `packages/sync/schema.json`
- Move & Modify: `tests/parser.test.ts` -> `packages/sync/tests/parser.test.ts`
- Move: `tests/fixtures/` -> `packages/sync/tests/fixtures/`

- [ ] **Step 1: Create sync package.json**

```json
{
  "name": "@gmaps/sync",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc"
  },
  "dependencies": {
    "@gmaps/core": "workspace:*",
    "playwright": "^1.58.2"
  }
}
```

- [ ] **Step 2: Create sync tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"],
  "references": [
    { "path": "../core" }
  ]
}
```

- [ ] **Step 3: Move fixtures and schema.json**

Copy `tests/fixtures/*.json` to `packages/sync/tests/fixtures/` and `schema.json` to `packages/sync/schema.json`.

- [ ] **Step 4: Refactor parser to extract placeRef**

Create `packages/sync/src/parser.ts`. This is the existing parser with two changes: (1) imports `ParsedList`/`ParsedPlace` from `@gmaps/core`, and (2) extracts the new `placeRef` field from `[1][7]`.

```typescript
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ParsedList, ParsedPlace } from "@gmaps/core";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface SchemaEntry {
  [key: string]: string;
}

interface SchemaSection {
  root: string;
  entry: SchemaEntry;
}

interface Schema {
  version: number;
  lists: SchemaSection;
  places: SchemaSection;
}

function loadSchema(): Schema {
  const schemaPath = join(__dirname, "..", "schema.json");
  return JSON.parse(readFileSync(schemaPath, "utf-8"));
}

const schema = loadSchema();

export function stripXssiPrefix(raw: string): string {
  const prefix = ")]}'";
  if (raw.startsWith(prefix)) {
    const newlineIdx = raw.indexOf("\n", prefix.length);
    if (newlineIdx !== -1) {
      return raw.slice(newlineIdx + 1);
    }
    return raw.slice(prefix.length);
  }
  return raw;
}

function walkPath(data: unknown, path: string): unknown {
  const indices = path.match(/\[(\d+)\]/g);
  if (!indices) return data;

  let current: unknown = data;
  for (const indexStr of indices) {
    const idx = parseInt(indexStr.slice(1, -1), 10);
    if (!Array.isArray(current) || idx >= current.length) {
      return undefined;
    }
    current = current[idx];
  }
  return current;
}

function walkPathRequired(
  data: unknown,
  path: string,
  fieldName: string,
  expectedType?: string,
): unknown {
  const result = walkPath(data, path);
  if (result === undefined || result === null) {
    if (expectedType) {
      throw new Error(
        `${fieldName}: expected ${expectedType} at ${path}, got ${result === null ? "null" : "undefined"}`,
      );
    }
    return null;
  }
  if (expectedType && typeof result !== expectedType) {
    throw new Error(
      `${fieldName}: expected ${expectedType} at ${path}, got ${typeof result}`,
    );
  }
  return result;
}

export function extractSessionToken(url: string): string | null {
  const match = url.match(/!1s([^!]+)/);
  return match ? match[1] : null;
}

export function parseLists(raw: string): ParsedList[] {
  const json = JSON.parse(stripXssiPrefix(raw));
  const entries = walkPath(json, schema.lists.root);
  if (!Array.isArray(entries)) {
    throw new Error(
      `lists.root: expected array at ${schema.lists.root}, got ${typeof entries}`,
    );
  }

  return entries.map((entry: unknown, i: number) => {
    const e = schema.lists.entry;
    return {
      id: walkPathRequired(entry, e.id, `lists[${i}].id`) as string | null,
      name: walkPathRequired(entry, e.name, `lists[${i}].name`, "string") as string,
      type: walkPathRequired(entry, e.type, `lists[${i}].type`, "number") as number,
      count: walkPathRequired(entry, e.count, `lists[${i}].count`, "number") as number,
    };
  });
}

export function parsePlaces(raw: string): ParsedPlace[] {
  const json = JSON.parse(stripXssiPrefix(raw));
  const entries = walkPath(json, schema.places.root);
  if (!Array.isArray(entries)) {
    return [];
  }

  const e = schema.places.entry;
  const results: ParsedPlace[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const idPart1 = walkPath(entry, e.placeIdPart1);
    const idPart2 = walkPath(entry, e.placeIdPart2);

    if (typeof idPart1 !== "string" || typeof idPart2 !== "string") {
      continue;
    }

    const placeRef = walkPath(entry, e.placeRef);

    results.push({
      name: walkPathRequired(entry, e.name, `places[${i}].name`, "string") as string,
      lat: walkPathRequired(entry, e.lat, `places[${i}].lat`, "number") as number,
      lng: walkPathRequired(entry, e.lng, `places[${i}].lng`, "number") as number,
      address: (walkPathRequired(entry, e.address, `places[${i}].address`) ?? "") as string,
      comment: walkPathRequired(entry, e.comment, `places[${i}].comment`) as string | null,
      placeId: `${idPart1}_${idPart2}`,
      placeRef: typeof placeRef === "string" ? placeRef : null,
    });
  }

  return results;
}

export function getSchemaVersion(): number {
  return schema.version;
}
```

- [ ] **Step 5: Update schema.json with placeRef field**

Create `packages/sync/schema.json`:

```json
{
  "version": 2,
  "lists": {
    "root": "[29][3]",
    "entry": {
      "id": "[0][0]",
      "name": "[4]",
      "type": "[0][1]",
      "count": "[12]"
    }
  },
  "places": {
    "root": "[0][8]",
    "entry": {
      "name": "[2]",
      "lat": "[1][5][2]",
      "lng": "[1][5][3]",
      "address": "[1][2]",
      "comment": "[3]",
      "placeIdPart1": "[1][6][0]",
      "placeIdPart2": "[1][6][1]",
      "placeRef": "[1][7]"
    }
  }
}
```

- [ ] **Step 6: Create parser test**

Create `packages/sync/tests/parser.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseLists, parsePlaces, stripXssiPrefix, extractSessionToken } from "../src/parser.js";
import masFixture from "./fixtures/mas-response.json";
import getlistFixture from "./fixtures/getlist-response.json";

describe("stripXssiPrefix", () => {
  it("strips the XSSI prefix from a response", () => {
    const input = ")]}'\n{\"data\": true}";
    expect(stripXssiPrefix(input)).toBe("{\"data\": true}");
  });

  it("returns the string unchanged if no prefix", () => {
    const input = "{\"data\": true}";
    expect(stripXssiPrefix(input)).toBe("{\"data\": true}");
  });
});

describe("extractSessionToken", () => {
  it("extracts session token from mas request URL", () => {
    const url = "https://www.google.com/locationhistory/preview/mas?authuser=0&hl=en&gl=us&pb=!2m3!1svNjKacyKCO-zqtsPmJ-8oAY!7e81!15i20393";
    expect(extractSessionToken(url)).toBe("vNjKacyKCO-zqtsPmJ-8oAY");
  });

  it("returns null if no token found", () => {
    const url = "https://www.google.com/maps/something";
    expect(extractSessionToken(url)).toBeNull();
  });
});

describe("parseLists", () => {
  it("parses list metadata from mas response", () => {
    const result = parseLists(JSON.stringify(masFixture));
    expect(result.length).toBe(49);

    expect(result[0]).toEqual({
      id: "FAKE_PLID_0010_XXXXXXXXXXXXX",
      name: "Want to go",
      type: 3,
      count: 35,
    });
  });

  it("handles built-in lists with null IDs", () => {
    const result = parseLists(JSON.stringify(masFixture));
    const savedPlaces = result.find((l) => l.name === "Saved places");
    expect(savedPlaces).toBeDefined();
    expect(savedPlaces!.id).toBeNull();
    expect(savedPlaces!.type).toBe(6);
  });

  it("throws on invalid structure", () => {
    expect(() => parseLists("[[]]")).toThrow();
  });
});

describe("parsePlaces", () => {
  it("parses places from getlist response with placeRef", () => {
    const result = parsePlaces(JSON.stringify(getlistFixture));
    expect(result.length).toBe(31);

    expect(result[0]).toEqual({
      name: "Marquis II",
      lat: 39.73,
      lng: -85.42,
      address: "Marquis II, 101 Birch St, Faketown, CA 90210",
      comment: "",
      placeId: "-0000000000000000002_-0000000000000000003",
      placeRef: "/g/fake_place_14",
    });
  });

  it("handles places with empty address", () => {
    const result = parsePlaces(JSON.stringify(getlistFixture));
    const ojeman = result.find((p) => p.name === "Eighteen Ten Ojeman");
    expect(ojeman).toBeDefined();
    expect(ojeman!.address).toBe("");
  });
});
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run packages/sync/tests/parser.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```
git add -A && git commit -m "feat(sync): scaffold sync package with refactored parser"
```

---

### Task 7: Sync Package — Session, Diff, Pull (Refactored for SQLite)

**Files:**
- Create: `packages/sync/src/session.ts`
- Create: `packages/sync/src/diff.ts`
- Create: `packages/sync/src/pull.ts`
- Create: `packages/sync/src/snapshots.ts`
- Create: `packages/sync/src/index.ts`
- Create: `packages/sync/tests/diff.test.ts`

- [ ] **Step 1: Copy session.ts with updated import**

Create `packages/sync/src/session.ts` — identical to `src/session.ts` except the type import changes from `import type { AppConfig } from "./types.js"` to `import type { AppConfig } from "@gmaps/core"`. Copy the full file contents from the existing `src/session.ts` and make only that import change.

- [ ] **Step 2: Create snapshot utility**

Create `packages/sync/src/snapshots.ts`:

```typescript
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function saveSnapshot(snapshotsDir: string, listId: string, rawData: string): string {
  mkdirSync(snapshotsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${timestamp}-${listId}.json`;
  const path = join(snapshotsDir, filename);
  writeFileSync(path, rawData);
  return path;
}

export function cleanOldSnapshots(snapshotsDir: string, retentionDays: number): number {
  if (!existsSync(snapshotsDir)) return 0;

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const files = readdirSync(snapshotsDir);
  let removed = 0;

  for (const file of files) {
    const path = join(snapshotsDir, file);
    const dateStr = file.split("T")[0];
    const fileDate = new Date(dateStr).getTime();
    if (!isNaN(fileDate) && fileDate < cutoff) {
      unlinkSync(path);
      removed++;
    }
  }

  return removed;
}
```

- [ ] **Step 3: Create the refactored diff module**

Create `packages/sync/src/diff.ts`. Key changes from old diff.ts: reads/writes via Drizzle instead of JSON Store, uses `place_lists` join table, writes `sync_metadata`, skips places with pending mutations, returns `skippedPending` count.

```typescript
import { createHash } from "node:crypto";
import { eq, and, inArray } from "drizzle-orm";
import type { Db, ParsedPlace, ParsedList } from "@gmaps/core";
import { places, lists, placeLists, syncMetadata, pendingMutations } from "@gmaps/core";

export interface DiffResult {
  added: number;
  updated: number;
  unchanged: number;
  flaggedRemoved: number;
  skippedPending: number;
}

export function computeContentHash(data: Record<string, unknown>): string {
  const normalized = JSON.stringify(data, Object.keys(data).sort());
  const hash = createHash("sha256").update(normalized).digest("hex");
  return `sha256:${hash}`;
}

export function applyDiff(
  db: Db,
  remoteLists: ParsedList[],
  remotePlaces: ParsedPlace[],
  listPlaceMap: Map<string, string[]>,
): DiffResult {
  const now = new Date().toISOString();
  const result: DiffResult = { added: 0, updated: 0, unchanged: 0, flaggedRemoved: 0, skippedPending: 0 };

  // Get place IDs with pending mutations
  const pendingPlaceIds = new Set(
    db.select({ placeId: pendingMutations.placeId })
      .from(pendingMutations)
      .where(inArray(pendingMutations.status, ["pending", "in_progress"]))
      .all()
      .filter((row) => row.placeId !== null)
      .map((row) => row.placeId!),
  );

  // --- Diff lists ---
  const existingLists = db.select().from(lists).all();
  const existingListIds = new Set(existingLists.map((l) => l.id));
  const remoteListIds = new Set(remoteLists.filter((l) => l.id !== null).map((l) => l.id!));

  for (const remote of remoteLists) {
    if (remote.id === null) continue;
    if (existingListIds.has(remote.id)) {
      db.update(lists).set({ name: remote.name, type: remote.type, lastSeenRemote: now, removedRemote: 0 })
        .where(eq(lists.id, remote.id)).run();
    } else {
      db.insert(lists).values({ id: remote.id, name: remote.name, type: remote.type, lastSeenRemote: now, removedRemote: 0 }).run();
    }
  }

  for (const existing of existingLists) {
    if (!remoteListIds.has(existing.id) && !existing.removedRemote) {
      db.update(lists).set({ removedRemote: 1 }).where(eq(lists.id, existing.id)).run();
    }
  }

  // --- Diff places ---
  const placeToLists = new Map<string, string[]>();
  for (const [listId, placeIds] of listPlaceMap) {
    for (const placeId of placeIds) {
      const existing = placeToLists.get(placeId) ?? [];
      existing.push(listId);
      placeToLists.set(placeId, existing);
    }
  }

  const allLocalPlaces = db.select().from(places).all();
  const localPlaceMap = new Map(allLocalPlaces.map((p) => [p.legacyId ?? p.googlePlaceId, p]));
  const remotePlaceIds = new Set(remotePlaces.map((p) => p.placeId));

  for (const remote of remotePlaces) {
    if (pendingPlaceIds.has(remote.placeId)) {
      result.skippedPending++;
      continue;
    }

    const contentData: Record<string, unknown> = {
      name: remote.name, lat: remote.lat, lng: remote.lng,
      address: remote.address, comment: remote.comment, placeId: remote.placeId,
    };
    const newHash = computeContentHash(contentData);
    const existing = localPlaceMap.get(remote.placeId) ?? null;
    const listIds = placeToLists.get(remote.placeId) ?? [];

    if (!existing) {
      db.insert(places).values({
        googlePlaceId: remote.placeId, legacyId: remote.placeId,
        name: remote.name, lat: remote.lat, lng: remote.lng, address: remote.address,
        comment: remote.comment, contentHash: newHash, createdAt: now, updatedAt: now,
      }).run();

      db.insert(syncMetadata).values({
        googlePlaceId: remote.placeId, source: "pull", firstSeen: now, lastSeenRemote: now, removedRemote: 0,
      }).run();

      for (const listId of listIds) {
        db.insert(placeLists).values({ googlePlaceId: remote.placeId, listId }).onConflictDoNothing().run();
      }
      result.added++;
    } else if (existing.contentHash !== newHash) {
      db.update(places).set({
        name: remote.name, lat: remote.lat, lng: remote.lng, address: remote.address,
        comment: remote.comment, contentHash: newHash, updatedAt: now,
      }).where(eq(places.googlePlaceId, existing.googlePlaceId)).run();

      db.update(syncMetadata).set({ lastSeenRemote: now, removedRemote: 0 })
        .where(eq(syncMetadata.googlePlaceId, existing.googlePlaceId)).run();

      db.delete(placeLists).where(eq(placeLists.googlePlaceId, existing.googlePlaceId)).run();
      for (const listId of listIds) {
        db.insert(placeLists).values({ googlePlaceId: existing.googlePlaceId, listId }).onConflictDoNothing().run();
      }
      result.updated++;
    } else {
      db.update(syncMetadata).set({ lastSeenRemote: now, removedRemote: 0 })
        .where(eq(syncMetadata.googlePlaceId, existing.googlePlaceId)).run();

      db.delete(placeLists).where(eq(placeLists.googlePlaceId, existing.googlePlaceId)).run();
      for (const listId of listIds) {
        db.insert(placeLists).values({ googlePlaceId: existing.googlePlaceId, listId }).onConflictDoNothing().run();
      }
      result.unchanged++;
    }
  }

  // Flag places missing from remote
  for (const [legacyId, place] of localPlaceMap) {
    if (!remotePlaceIds.has(legacyId) && !pendingPlaceIds.has(legacyId)) {
      const syncMeta = db.select().from(syncMetadata)
        .where(eq(syncMetadata.googlePlaceId, place.googlePlaceId)).get();
      if (syncMeta && !syncMeta.removedRemote) {
        db.update(syncMetadata).set({ removedRemote: 1 })
          .where(eq(syncMetadata.googlePlaceId, place.googlePlaceId)).run();
        result.flaggedRemoved++;
      }
    }
  }

  return result;
}
```

- [ ] **Step 4: Write diff test**

Create `packages/sync/tests/diff.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDb, runMigrations, places, lists, placeLists, syncMetadata, pendingMutations } from "@gmaps/core";
import type { ParsedPlace, ParsedList } from "@gmaps/core";
import { applyDiff, computeContentHash } from "../src/diff.js";
import { eq } from "drizzle-orm";

describe("computeContentHash", () => {
  it("produces consistent hash for same input", () => {
    const a = computeContentHash({ name: "Test", lat: 1, lng: 2 });
    const b = computeContentHash({ name: "Test", lat: 1, lng: 2 });
    expect(a).toBe(b);
  });

  it("starts with sha256: prefix", () => {
    const hash = computeContentHash({ name: "Test" });
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});

describe("applyDiff", () => {
  let tempDir: string;
  let db: ReturnType<typeof createDb>["db"];
  let sqlite: ReturnType<typeof createDb>["sqlite"];

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "gmaps-diff-"));
    const created = createDb(join(tempDir, "test.db"));
    db = created.db;
    sqlite = created.sqlite;
    runMigrations(sqlite);
  });

  afterEach(() => {
    sqlite.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("adds new places from remote", () => {
    const remotePlaces: ParsedPlace[] = [{
      name: "Cafe A", lat: 29.75, lng: -95.37, address: "123 Main St",
      comment: null, placeId: "-123_-456", placeRef: "/g/test",
    }];
    const remoteLists: ParsedList[] = [{ id: "list_1", name: "Favorites", type: 2, count: 1 }];
    const listPlaceMap = new Map([["list_1", ["-123_-456"]]]);

    const result = applyDiff(db, remoteLists, remotePlaces, listPlaceMap);
    expect(result.added).toBe(1);

    const place = db.select().from(places).where(eq(places.googlePlaceId, "-123_-456")).get();
    expect(place!.name).toBe("Cafe A");
    expect(place!.legacyId).toBe("-123_-456");

    const placeListRows = db.select().from(placeLists).all();
    expect(placeListRows).toHaveLength(1);
    expect(placeListRows[0].listId).toBe("list_1");
  });

  it("flags places missing from remote", () => {
    const now = new Date().toISOString();
    db.insert(places).values({
      googlePlaceId: "-789_-012", legacyId: "-789_-012", name: "Gone", lat: 0, lng: 0,
      contentHash: "sha256:x", createdAt: now, updatedAt: now,
    }).run();
    db.insert(syncMetadata).values({
      googlePlaceId: "-789_-012", source: "pull", firstSeen: now, removedRemote: 0,
    }).run();

    const result = applyDiff(db, [], [], new Map());
    expect(result.flaggedRemoved).toBe(1);
  });

  it("skips places with pending mutations", () => {
    const now = new Date().toISOString();
    db.insert(places).values({
      googlePlaceId: "-123_-456", legacyId: "-123_-456", name: "Locked", lat: 29.75, lng: -95.37,
      contentHash: "sha256:old", createdAt: now, updatedAt: now,
    }).run();
    db.insert(syncMetadata).values({
      googlePlaceId: "-123_-456", source: "pull", firstSeen: now, removedRemote: 0,
    }).run();
    db.insert(pendingMutations).values({
      type: "move_place_between_lists", status: "pending", placeId: "-123_-456",
      payload: "{}", createdAt: now, updatedAt: now,
    }).run();

    const remotePlaces: ParsedPlace[] = [{
      name: "Updated Name", lat: 29.75, lng: -95.37, address: "123 Main St",
      comment: null, placeId: "-123_-456", placeRef: null,
    }];

    const result = applyDiff(db, [], remotePlaces, new Map());
    expect(result.skippedPending).toBe(1);
    expect(result.updated).toBe(0);

    const place = db.select().from(places).where(eq(places.googlePlaceId, "-123_-456")).get();
    expect(place!.name).toBe("Locked");
  });
});
```

- [ ] **Step 5: Run diff tests**

Run: `npx vitest run packages/sync/tests/diff.test.ts`
Expected: PASS

- [ ] **Step 6: Create refactored pull module**

Create `packages/sync/src/pull.ts`. This replaces the old pull.ts — reads/writes sync_state from SQLite, uses the new diff module. The function signature changes to accept `db: Db` and `config: AppConfig` instead of `store`, `profile`, and `browserProfileDir`.

The implementer should reference the existing `src/pull.ts` for the full 3-phase logic (intercept mas, fetch getlist per list, apply diff) and adapt it to use:
- `db` (Drizzle) instead of `store` (JSON Store) for sync state reads/writes
- `saveSnapshot`/`cleanOldSnapshots` from `./snapshots.js` instead of `store.saveSnapshot`
- `config.browserProfileDir` instead of a separate `browserProfileDir` parameter
- No `profile` parameter (profiles removed)
- Snapshots dir: `join(BASE_DIR, "snapshots")`

- [ ] **Step 7: Create sync barrel export**

Create `packages/sync/src/index.ts`:

```typescript
export { pull, type PullResult, type PullOptions } from "./pull.js";
export { initSession, checkSession } from "./session.js";
export { parseLists, parsePlaces, getSchemaVersion } from "./parser.js";
export { applyDiff, computeContentHash, type DiffResult } from "./diff.js";
```

- [ ] **Step 8: Commit**

```
git add -A && git commit -m "feat(sync): refactor session, diff, pull to use SQLite via drizzle"
```

---

### Task 8: Core Package — Enrichment Pipeline

**Files:**
- Create: `packages/core/src/enrichment.ts`
- Create: `packages/core/tests/enrichment.test.ts`

- [ ] **Step 1: Write enrichment test**

Create `packages/core/tests/enrichment.test.ts`. The test should verify:

1. `enrichUnenrichedPlaces` enriches places with `enriched_at IS NULL`
2. It skips already-enriched places
3. Failed enrichments (findPlace returns null) set `enriched_at` but leave fields null
4. When a legacy ID is resolved to a real `google_place_id`, the row's PK is updated

Use a mock `PlacesApiClient` interface with `findPlace(name, lat, lng)` and `getPlaceDetails(googlePlaceId)` methods. See the spec's "Enrichment Pipeline" section for the full interface.

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDb } from "../src/db.js";
import { runMigrations } from "../src/migrate.js";
import { places } from "../src/schema.js";
import { enrichUnenrichedPlaces, type PlacesApiClient } from "../src/enrichment.js";
import { eq } from "drizzle-orm";

function makeMockClient(overrides?: Partial<PlacesApiClient>): PlacesApiClient {
  return {
    findPlace: vi.fn().mockResolvedValue({ googlePlaceId: "ChIJ_resolved_123" }),
    getPlaceDetails: vi.fn().mockResolvedValue({
      rating: 4.5, userRatingCount: 200, priceLevel: 2,
      primaryType: "italian_restaurant", types: ["restaurant", "food"],
      editorialSummary: "A cozy Italian spot",
      reviewsText: "Great pasta.", generativeSummary: null,
      servesBreakfast: 0, servesLunch: 1, servesDinner: 1, servesBrunch: 0,
      servesBeer: 1, servesWine: 1, servesCocktails: 1, servesCoffee: 0,
      servesDessert: 1, servesVegetarianFood: 1, outdoorSeating: 1,
      liveMusic: 0, goodForChildren: 0, goodForGroups: 1, allowsDogs: 0,
      dineIn: 1, delivery: 1, takeout: 1,
      businessStatus: "OPERATIONAL", websiteUri: "https://example.com", phoneNumber: "+1234567890",
    }),
    ...overrides,
  };
}

describe("enrichUnenrichedPlaces", () => {
  let tempDir: string;
  let db: ReturnType<typeof createDb>["db"];
  let sqlite: ReturnType<typeof createDb>["sqlite"];

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "gmaps-enrich-"));
    const created = createDb(join(tempDir, "test.db"));
    db = created.db; sqlite = created.sqlite;
    runMigrations(sqlite);
  });

  afterEach(() => { sqlite.close(); rmSync(tempDir, { recursive: true, force: true }); });

  it("enriches unenriched places", async () => {
    const now = new Date().toISOString();
    db.insert(places).values({
      googlePlaceId: "-123_-456", legacyId: "-123_-456", name: "Test Place",
      lat: 29.75, lng: -95.37, contentHash: "sha256:abc", createdAt: now, updatedAt: now,
    }).run();

    const client = makeMockClient();
    const result = await enrichUnenrichedPlaces(db, client);
    expect(result.enriched).toBe(1);
    expect(result.failed).toBe(0);
  });

  it("skips already enriched places", async () => {
    const now = new Date().toISOString();
    db.insert(places).values({
      googlePlaceId: "ChIJ_already", name: "Done", lat: 0, lng: 0,
      contentHash: "sha256:x", createdAt: now, updatedAt: now, enrichedAt: now,
    }).run();

    const client = makeMockClient();
    const result = await enrichUnenrichedPlaces(db, client);
    expect(result.enriched).toBe(0);
    expect(client.findPlace).not.toHaveBeenCalled();
  });

  it("marks failed lookups with enriched_at but null fields", async () => {
    const now = new Date().toISOString();
    db.insert(places).values({
      googlePlaceId: "-bad_-id", legacyId: "-bad_-id", name: "Unknown",
      lat: 0, lng: 0, contentHash: "sha256:y", createdAt: now, updatedAt: now,
    }).run();

    const client = makeMockClient({ findPlace: vi.fn().mockResolvedValue(null) });
    const result = await enrichUnenrichedPlaces(db, client);
    expect(result.failed).toBe(1);

    const place = db.select().from(places).where(eq(places.googlePlaceId, "-bad_-id")).get();
    expect(place!.enrichedAt).toBeTruthy();
    expect(place!.rating).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/tests/enrichment.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write enrichment module**

Create `packages/core/src/enrichment.ts`. This module:
- Defines the `PlacesApiClient` interface (findPlace, getPlaceDetails)
- Defines the `PlaceDetailsResult` type with all enrichment fields
- Implements `enrichUnenrichedPlaces(db, client)` which queries for `enriched_at IS NULL`, resolves legacy IDs via findPlace, fetches details, and updates the places row
- Uses raw SQL for PK updates when resolving legacy IDs (Drizzle doesn't support updating primary keys)

The implementer should reference the test above and the spec's "Enrichment Pipeline" section for the full field list and behavior.

- [ ] **Step 4: Add enrichment to core barrel export**

In `packages/core/src/index.ts`, add:

```typescript
export * from "./enrichment.js";
```

- [ ] **Step 5: Run enrichment tests**

Run: `npx vitest run packages/core/tests/enrichment.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```
git add -A && git commit -m "feat(core): add enrichment pipeline with Places API client interface"
```

---

### Task 9: Core Package — Embedding Pipeline

**Files:**
- Create: `packages/core/src/embedding.ts`
- Create: `packages/core/tests/embedding.test.ts`

- [ ] **Step 1: Add native dependencies to core package.json**

Add to `packages/core/package.json` dependencies:

```json
{
  "sqlite-vec": "^0.1.6",
  "onnxruntime-node": "^1.21.0"
}
```

Run: `pnpm install`

- [ ] **Step 2: Write embedding text construction test**

Create `packages/core/tests/embedding.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildEmbeddingText } from "../src/embedding.js";

describe("buildEmbeddingText", () => {
  it("builds rich text for enriched place", () => {
    const text = buildEmbeddingText({
      name: "Osteria", address: "1234 Walnut St, Philadelphia",
      primaryType: "italian_restaurant", editorialSummary: "Upscale Italian dining",
      reviewsText: "Amazing pasta. Romantic atmosphere.",
      servesBreakfast: 0, servesLunch: 1, servesDinner: 1, servesBrunch: 0,
      servesBeer: 1, servesWine: 1, servesCocktails: 1, servesCoffee: 0,
      outdoorSeating: 1, liveMusic: 0, goodForChildren: 0, goodForGroups: 1,
      allowsDogs: 0, dineIn: 1,
    });

    expect(text).toContain("Osteria");
    expect(text).toContain("italian restaurant");
    expect(text).toContain("Upscale Italian dining");
    expect(text).toContain("outdoor seating");
    expect(text).toContain("good for groups");
  });

  it("falls back to name + address for unenriched place", () => {
    const text = buildEmbeddingText({
      name: "Cool Bar", address: "456 Main St, Austin",
      primaryType: null, editorialSummary: null, reviewsText: null,
      servesBreakfast: null, servesLunch: null, servesDinner: null, servesBrunch: null,
      servesBeer: null, servesWine: null, servesCocktails: null, servesCoffee: null,
      outdoorSeating: null, liveMusic: null, goodForChildren: null, goodForGroups: null,
      allowsDogs: null, dineIn: null,
    });

    expect(text).toBe("Cool Bar. 456 Main St, Austin.");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run packages/core/tests/embedding.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Write embedding module**

Create `packages/core/src/embedding.ts`. This module:
- Defines the `EmbeddingModel` interface with `embed(text: string): Promise<Float32Array>`
- Implements `buildEmbeddingText(place)` which concatenates name, primaryType, editorialSummary, reviewsText, and boolean attributes into a single string for embedding
- Implements `ensureVecTable(sqlite)` to create the `places_vec` virtual table if it doesn't exist
- Implements `embedUnembeddedPlaces(db, sqlite, model)` which embeds all places with `embedded_at IS NULL`

The implementer should use the test above and the spec's "Embedding Pipeline" section for the exact text construction format and sqlite-vec table definition (`vec0` with `float[384]`).

- [ ] **Step 5: Run embedding tests**

Run: `npx vitest run packages/core/tests/embedding.test.ts`
Expected: PASS

- [ ] **Step 6: Add embedding to core barrel export**

In `packages/core/src/index.ts`, add:

```typescript
export * from "./embedding.js";
```

- [ ] **Step 7: Commit**

```
git add -A && git commit -m "feat(core): add embedding pipeline with sqlite-vec and ONNX model interface"
```

---

### Task 10: Discovery & Push Stubs

**Files:**
- Create: `packages/discovery/package.json`
- Create: `packages/discovery/tsconfig.json`
- Create: `packages/discovery/src/index.ts`
- Create: `packages/push/package.json`
- Create: `packages/push/tsconfig.json`
- Create: `packages/push/src/index.ts`

- [ ] **Step 1: Create discovery stub**

`packages/discovery/package.json`:
```json
{
  "name": "@gmaps/discovery",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": "./dist/index.js" },
  "scripts": { "build": "tsc" },
  "dependencies": { "@gmaps/core": "workspace:*" }
}
```

`packages/discovery/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "./dist", "rootDir": "./src" },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"],
  "references": [{ "path": "../core" }]
}
```

`packages/discovery/src/index.ts`:
```typescript
// Discovery package — not yet implemented.
```

- [ ] **Step 2: Create push stub**

`packages/push/package.json`:
```json
{
  "name": "@gmaps/push",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": "./dist/index.js" },
  "scripts": { "build": "tsc" },
  "dependencies": { "@gmaps/core": "workspace:*" }
}
```

`packages/push/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "./dist", "rootDir": "./src" },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"],
  "references": [{ "path": "../core" }]
}
```

`packages/push/src/index.ts`:
```typescript
// Push package — not yet implemented.
```

- [ ] **Step 3: Commit**

```
git add -A && git commit -m "chore: scaffold discovery and push package stubs"
```

---

### Task 11: CLI Package

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/src/cli.ts`

- [ ] **Step 1: Create CLI package.json**

```json
{
  "name": "@gmaps/cli",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "places": "./dist/cli.js" },
  "scripts": { "build": "tsc" },
  "dependencies": {
    "@gmaps/core": "workspace:*",
    "@gmaps/sync": "workspace:*",
    "commander": "^14.0.3"
  }
}
```

- [ ] **Step 2: Create CLI tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "./dist", "rootDir": "./src" },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"],
  "references": [{ "path": "../core" }, { "path": "../sync" }]
}
```

- [ ] **Step 3: Write the CLI**

Create `packages/cli/src/cli.ts`. This is the Commander.js entry point that wires together core and sync. It implements these commands:

- `places init` — create DB via `runMigrations`, open browser via `initSession`
- `places pull` — call `pull(db, config, opts)`, report results, log unenriched count
- `places status` — query sync_state, count places/lists, show enrichment stats
- `places enrich` — placeholder that logs "requires PlacesApiClient implementation"
- `places pending` — query pending_mutations, display results
- `places prune` — delete places where sync_metadata.removed_remote = 1

Each command should call `getDb()` which does `mkdirSync(BASE_DIR)`, `createDb(DB_PATH)`, `runMigrations(sqlite)`. Each command should `sqlite.close()` before exiting.

The implementer should reference the existing `src/cli.ts` for the jitter logic and flag patterns, and the spec's CLI section for the exact command list.

- [ ] **Step 4: Commit**

```
git add -A && git commit -m "feat(cli): add places CLI with init, pull, status, enrich, pending, prune"
```

---

### Task 12: Clean Up & Verify

**Files:**
- Delete: `src/` (entire directory)
- Delete: `schema.json` (moved to packages/sync/)
- Delete: `tests/` (replaced by per-package tests)

- [ ] **Step 1: Remove old source and test directories**

Delete `src/`, `tests/`, and root `schema.json`. These have been replaced by the packages.

- [ ] **Step 2: Update .gitignore**

Ensure patterns cover the monorepo:

```gitignore
node_modules/
dist/
*.tgz
.env
```

- [ ] **Step 3: Install all dependencies**

Run: `pnpm install`

- [ ] **Step 4: Verify the build**

Run: `pnpm run build`
Expected: tsc builds all packages in dependency order without errors.

- [ ] **Step 5: Run all tests**

Run: `pnpm test`
Expected: All tests pass.

- [ ] **Step 6: Verify CLI commands work**

Run: `npx tsx packages/cli/src/cli.ts status`
Expected: Shows "Last pull: never", 0 places, 0 lists.

Run: `npx tsx packages/cli/src/cli.ts pending`
Expected: "No pending mutations."

- [ ] **Step 7: Verify SQLite DB is created with all tables**

Run: `sqlite3 ~/.gmaps-sync/places.db ".tables"`
Expected: Shows `discovery_metadata`, `lists`, `pending_mutations`, `place_lists`, `places`, `places_fts`, `sync_metadata`, `sync_state`.

- [ ] **Step 8: Commit**

```
git add -A && git commit -m "chore: remove old source files, finalize monorepo structure"
```
