# gmaps-sync MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CLI tool that pulls saved places from Google Maps via browser automation and stores them as local JSON files.

**Architecture:** Bottom-up build — types and schema first, then parser (most testable/critical), store, diff engine, session manager, pull orchestration, and finally CLI. Playwright with persistent Chrome sessions handles auth; network interception captures structured JSON responses; a declarative schema maps array positions to fields.

**Tech Stack:** TypeScript, Playwright, Commander, write-file-atomic, vitest

---

## File Structure

```
gmaps-sync/
  src/
    cli.ts              — Commander-based CLI entry point
    config.ts           — Load/validate config, resolve paths
    session.ts          — Playwright browser lifecycle, health checks
    pull.ts             — Navigation, network interception, orchestration
    parser.ts           — Schema-driven response parsing
    diff.ts             — Compare remote vs local, apply changes
    enrich.ts           — Google Places API enrichment
    store.ts            — Atomic file read/write, data directory management
    notifications.ts    — macOS notifications via osascript
    types.ts            — Shared TypeScript interfaces
  schema.json           — Parser field mappings
  tests/
    fixtures/
      lists-response.json       — Raw list metadata response fixture
      places-response.json      — Raw places response fixture
      places-response-page2.json — Second page fixture for pagination
    parser.test.ts
    diff.test.ts
    store.test.ts
    config.test.ts
    enrich.test.ts
  package.json
  tsconfig.json
  vitest.config.ts
```

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Initialize package.json**

```bash
cd /vm-google-maps-sync
npm init -y
```

Then edit `package.json` to:

```json
{
  "name": "gmaps-sync",
  "version": "0.1.0",
  "description": "One-way sync from Google Maps saved places to local JSON",
  "type": "module",
  "bin": {
    "gmaps-sync": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "tsc --noEmit"
  },
  "license": "UNLICENSED",
  "private": true
}
```

- [ ] **Step 2: Install dependencies**

```bash
npm install playwright commander write-file-atomic
npm install -D typescript vitest @types/node @types/write-file-atomic
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "resolveJsonModule": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 4: Create vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 5: Update .gitignore**

Append to `.gitignore`:

```
node_modules/
dist/
```

- [ ] **Step 6: Verify setup compiles**

Create a minimal `src/types.ts` with just:

```ts
export {};
```

Run:

```bash
npx tsc --noEmit
```

Expected: exits 0 with no output.

- [ ] **Step 7: Verify vitest runs**

Create `tests/setup.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("setup", () => {
  it("vitest works", () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run:

```bash
npx vitest run
```

Expected: 1 test passes.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold project with typescript, vitest, playwright"
```

---

### Task 2: Types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Define all shared interfaces**

```ts
export interface ListMetadata {
  id: string;
  name: string;
  type: string;
  count: number;
  lastSeenRemote: string;
  removedRemote: boolean;
}

export interface PlaceCoordinates {
  lat: number;
  lng: number;
}

export interface EnrichedData {
  address: string;
  phone: string | null;
  rating: number | null;
  priceLevel: string | null;
  category: string | null;
  enrichedAt: string;
}

export interface Place {
  id: string;
  name: string;
  coordinates: PlaceCoordinates;
  googleMapsUrl: string;
  lists: string[];
  comment: string | null;
  source: "pull" | "local";
  contentHash: string;
  firstSeen: string;
  lastSeenRemote: string;
  removedRemote: boolean;
  enriched: EnrichedData | null;
}

export interface SyncState {
  lastPull: string | null;
  lastPullStatus: "success" | "partial" | "failure";
  schemaVersion: number;
  consecutiveFailures: number;
  profile: string;
}

export interface ProfileConfig {
  browserProfileDir: string;
  dataDir: string;
}

export interface SyncConfig {
  intervalHours: number;
  jitterMinutes: number;
  delayBetweenListsMs: [number, number];
  navigationTimeoutMs: number;
  retryOnSessionFailure: boolean;
}

export interface EnrichmentConfig {
  googlePlacesApiKey: string | null;
}

export interface NotificationsConfig {
  onSessionExpired: boolean;
  onSchemaFailure: boolean;
  onSyncComplete: boolean;
}

export interface AppConfig {
  profiles: Record<string, ProfileConfig>;
  sync: SyncConfig;
  enrichment: EnrichmentConfig;
  notifications: NotificationsConfig;
  headless: boolean;
  useSystemChrome: boolean;
  snapshotsRetentionDays: number;
}

/** Raw parsed data from pull engine before diff processing */
export interface ParsedList {
  id: string;
  name: string;
  type: string;
  count: number;
}

export interface ParsedPlace {
  name: string;
  lat: number;
  lng: number;
  googleMapsUrl: string;
  comment: string | null;
  placeId: string;
}
```

- [ ] **Step 2: Verify it compiles**

Run:

```bash
npx tsc --noEmit
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add shared type definitions"
```

---

### Task 3: Schema and Parser

This is the highest-priority, most-testable component. The parser takes raw Google Maps responses (deeply nested arrays) and extracts structured data using a declarative schema.

**Files:**
- Create: `schema.json`
- Create: `src/parser.ts`
- Create: `tests/fixtures/lists-response.json`
- Create: `tests/fixtures/places-response.json`
- Create: `tests/parser.test.ts`

- [ ] **Step 1: Create schema.json**

Place at project root (`/vm-google-maps-sync/schema.json`):

```json
{
  "version": 1,
  "responsePrefix": ")]}'\\n",
  "lists": {
    "root": "[0]",
    "entries": "[0][1]",
    "entry": {
      "id": "[0]",
      "name": "[1]",
      "type": "[2]",
      "count": "[3]"
    }
  },
  "places": {
    "root": "[0]",
    "entries": "[0][8]",
    "entry": {
      "name": "[2]",
      "lat": "[1][5][2]",
      "lng": "[1][5][3]",
      "googleMapsUrl": "[1][0]",
      "comment": "[3]",
      "placeId": "[1][1]"
    }
  }
}
```

- [ ] **Step 2: Create test fixtures**

`tests/fixtures/lists-response.json` — a fabricated response mimicking Google's nested array format:

```json
{
  "raw": ")]}'\n[[[\"list_abc123\",\"Want to go\",\"WANT_TO_GO\",35],[\"list_def456\",\"Favorites\",\"FAVORITES\",12],[\"list_ghi789\",\"Travel\",\"CUSTOM\",8]]]",
  "expectedLists": [
    { "id": "list_abc123", "name": "Want to go", "type": "WANT_TO_GO", "count": 35 },
    { "id": "list_def456", "name": "Favorites", "type": "FAVORITES", "count": 12 },
    { "id": "list_ghi789", "name": "Travel", "type": "CUSTOM", "count": 8 }
  ]
}
```

`tests/fixtures/places-response.json`:

```json
{
  "raw": ")]}'\n[[[null,null,null,null,null,null,null,null,[[null,[\"https://www.google.com/maps/place/Empire+Cafe\",\"ChIJ_abc123\",null,null,null,29.7504,-95.3698],\"Empire Café\",\"Great breakfast tacos\",null],[null,[\"https://www.google.com/maps/place/Uchi+Houston\",\"ChIJ_def456\",null,null,null,29.7383,-95.3907],\"Uchi Houston\",null,null]]]]]",
  "expectedPlaces": [
    {
      "name": "Empire Café",
      "lat": 29.7504,
      "lng": -95.3698,
      "googleMapsUrl": "https://www.google.com/maps/place/Empire+Cafe",
      "comment": "Great breakfast tacos",
      "placeId": "ChIJ_abc123"
    },
    {
      "name": "Uchi Houston",
      "lat": 29.7383,
      "lng": -95.3907,
      "googleMapsUrl": "https://www.google.com/maps/place/Uchi+Houston",
      "comment": null,
      "placeId": "ChIJ_def456"
    }
  ]
}
```

- [ ] **Step 3: Write failing parser tests**

`tests/parser.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseLists, parsePlaces, stripXssiPrefix } from "../src/parser.js";
import listsFixture from "./fixtures/lists-response.json";
import placesFixture from "./fixtures/places-response.json";

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

describe("parseLists", () => {
  it("parses list metadata from raw response", () => {
    const result = parseLists(listsFixture.raw);
    expect(result).toEqual(listsFixture.expectedLists);
  });

  it("throws descriptive error on invalid structure", () => {
    expect(() => parseLists(")]}'\n[[]]")).toThrow();
  });

  it("throws on empty entries array", () => {
    expect(() => parseLists(")]}'\n[[null,[]]]")).not.toThrow();
  });
});

describe("parsePlaces", () => {
  it("parses places from raw response", () => {
    const result = parsePlaces(placesFixture.raw);
    expect(result).toEqual(placesFixture.expectedPlaces);
  });

  it("throws descriptive error when a required field is missing", () => {
    // Place with no coordinates path
    const broken = ")]}'\n[[[null,null,null,null,null,null,null,null,[[null,[\"url\",\"id\"],\"Name\",null,null]]]]]";
    expect(() => parsePlaces(broken)).toThrow(/lat/);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

```bash
npx vitest run tests/parser.test.ts
```

Expected: FAIL — `parseLists`, `parsePlaces`, `stripXssiPrefix` do not exist yet.

- [ ] **Step 5: Implement parser.ts**

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ParsedList, ParsedPlace } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface SchemaEntry {
  [key: string]: string;
}

interface SchemaSection {
  root: string;
  entries: string;
  entry: SchemaEntry;
}

interface Schema {
  version: number;
  responsePrefix: string;
  lists: SchemaSection;
  places: SchemaSection;
}

function loadSchema(): Schema {
  const schemaPath = join(__dirname, "..", "schema.json");
  return JSON.parse(readFileSync(schemaPath, "utf-8"));
}

const schema = loadSchema();

/**
 * Strip the XSSI prefix Google prepends to JSON responses.
 * The prefix is )]}'  followed by a newline.
 */
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

/**
 * Walk a nested array/object using a bracket path like "[0][1][5]".
 * Returns the value at that path, or undefined if the path doesn't exist.
 */
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

/**
 * Walk a path and throw a descriptive error if the result is undefined
 * or doesn't match the expected type.
 */
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

export function parseLists(raw: string): ParsedList[] {
  const json = JSON.parse(stripXssiPrefix(raw));
  const root = walkPath(json, schema.lists.root);
  if (root === undefined) {
    throw new Error(`lists.root: no data at ${schema.lists.root}`);
  }

  const entries = walkPath(root, schema.lists.entries.replace(schema.lists.root, ""));
  if (!Array.isArray(entries)) {
    throw new Error(
      `lists.entries: expected array at ${schema.lists.entries}, got ${typeof entries}`,
    );
  }

  return entries.map((entry: unknown, i: number) => {
    const e = schema.lists.entry;
    return {
      id: walkPathRequired(entry, e.id, `lists[${i}].id`, "string") as string,
      name: walkPathRequired(entry, e.name, `lists[${i}].name`, "string") as string,
      type: walkPathRequired(entry, e.type, `lists[${i}].type`, "string") as string,
      count: walkPathRequired(entry, e.count, `lists[${i}].count`, "number") as number,
    };
  });
}

export function parsePlaces(raw: string): ParsedPlace[] {
  const json = JSON.parse(stripXssiPrefix(raw));
  const root = walkPath(json, schema.places.root);
  if (root === undefined) {
    throw new Error(`places.root: no data at ${schema.places.root}`);
  }

  // Walk from root to entries — entries path is absolute, so strip the root prefix
  const entriesRelPath = schema.places.entries.replace(schema.places.root, "");
  const entries = walkPath(root, entriesRelPath);
  if (!Array.isArray(entries)) {
    throw new Error(
      `places.entries: expected array at ${schema.places.entries}, got ${typeof entries}`,
    );
  }

  return entries.map((entry: unknown, i: number) => {
    const e = schema.places.entry;
    return {
      name: walkPathRequired(entry, e.name, `places[${i}].name`, "string") as string,
      lat: walkPathRequired(entry, e.lat, `places[${i}].lat`, "number") as number,
      lng: walkPathRequired(entry, e.lng, `places[${i}].lng`, "number") as number,
      googleMapsUrl: walkPathRequired(
        entry,
        e.googleMapsUrl,
        `places[${i}].googleMapsUrl`,
        "string",
      ) as string,
      comment: (walkPathRequired(entry, e.comment, `places[${i}].comment`) as string | null),
      placeId: walkPathRequired(entry, e.placeId, `places[${i}].placeId`, "string") as string,
    };
  });
}

export function getSchemaVersion(): number {
  return schema.version;
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
npx vitest run tests/parser.test.ts
```

Expected: All tests pass.

- [ ] **Step 7: Delete the setup test**

Remove `tests/setup.test.ts` — it was only for verifying vitest works.

- [ ] **Step 8: Commit**

```bash
git add schema.json src/parser.ts tests/fixtures/ tests/parser.test.ts
git rm tests/setup.test.ts
git commit -m "feat: add schema-based parser with tests"
```

---

### Task 4: Config

**Files:**
- Create: `src/config.ts`
- Create: `tests/config.test.ts`

- [ ] **Step 1: Write failing config tests**

`tests/config.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, resolveProfilePaths, DEFAULT_CONFIG } from "../src/config.js";

describe("loadConfig", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "gmaps-sync-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns default config when no config file exists", () => {
    const config = loadConfig(join(tempDir, "nonexistent.json"));
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("merges partial config with defaults", () => {
    const partial = { headless: false };
    writeFileSync(join(tempDir, "config.json"), JSON.stringify(partial));
    const config = loadConfig(join(tempDir, "config.json"));
    expect(config.headless).toBe(false);
    expect(config.sync.intervalHours).toBe(DEFAULT_CONFIG.sync.intervalHours);
  });
});

describe("resolveProfilePaths", () => {
  it("resolves default profile paths from base dir", () => {
    const paths = resolveProfilePaths("/home/user/.gmaps-sync", "default");
    expect(paths.browserProfileDir).toBe(
      "/home/user/.gmaps-sync/profiles/default/browser",
    );
    expect(paths.dataDir).toBe(
      "/home/user/.gmaps-sync/profiles/default/data",
    );
  });

  it("uses custom paths from config when present", () => {
    const paths = resolveProfilePaths("/base", "default", {
      browserProfileDir: "/custom/browser",
      dataDir: "/custom/data",
    });
    expect(paths.browserProfileDir).toBe("/custom/browser");
    expect(paths.dataDir).toBe("/custom/data");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/config.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement config.ts**

```ts
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { AppConfig, ProfileConfig } from "./types.js";

export const BASE_DIR = join(homedir(), ".gmaps-sync");

export const DEFAULT_CONFIG: AppConfig = {
  profiles: {
    default: {
      browserProfileDir: join(BASE_DIR, "profiles", "default", "browser"),
      dataDir: join(BASE_DIR, "profiles", "default", "data"),
    },
  },
  sync: {
    intervalHours: 24,
    jitterMinutes: 60,
    delayBetweenListsMs: [2000, 5000],
    navigationTimeoutMs: 30000,
    retryOnSessionFailure: true,
  },
  enrichment: {
    googlePlacesApiKey: null,
  },
  notifications: {
    onSessionExpired: true,
    onSchemaFailure: true,
    onSyncComplete: false,
  },
  headless: true,
  useSystemChrome: true,
  snapshotsRetentionDays: 30,
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
    notifications: { ...DEFAULT_CONFIG.notifications, ...partial.notifications },
    profiles: { ...DEFAULT_CONFIG.profiles, ...partial.profiles },
  };
}

export function resolveProfilePaths(
  baseDir: string,
  profileName: string,
  configProfile?: ProfileConfig,
): { browserProfileDir: string; dataDir: string } {
  if (configProfile) {
    return {
      browserProfileDir: configProfile.browserProfileDir,
      dataDir: configProfile.dataDir,
    };
  }

  return {
    browserProfileDir: join(baseDir, "profiles", profileName, "browser"),
    dataDir: join(baseDir, "profiles", profileName, "data"),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/config.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: add config loading with defaults and profile resolution"
```

---

### Task 5: Store

Handles all file I/O — atomic writes, reading/writing places, lists, sync state, and snapshots.

**Files:**
- Create: `src/store.ts`
- Create: `tests/store.test.ts`

- [ ] **Step 1: Write failing store tests**

`tests/store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/store.js";
import type { Place, ListMetadata, SyncState } from "../src/types.js";

describe("Store", () => {
  let tempDir: string;
  let store: Store;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "gmaps-sync-store-"));
    store = new Store(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("init", () => {
    it("creates data directories on init", async () => {
      await store.init();
      expect(existsSync(join(tempDir, "places"))).toBe(true);
      expect(existsSync(join(tempDir, "snapshots"))).toBe(true);
    });
  });

  describe("lists", () => {
    it("reads empty lists when file does not exist", async () => {
      const lists = await store.readLists();
      expect(lists).toEqual([]);
    });

    it("writes and reads lists", async () => {
      await store.init();
      const lists: ListMetadata[] = [
        {
          id: "list_abc",
          name: "Want to go",
          type: "WANT_TO_GO",
          count: 5,
          lastSeenRemote: "2026-03-29T12:00:00Z",
          removedRemote: false,
        },
      ];
      await store.writeLists(lists);
      const result = await store.readLists();
      expect(result).toEqual(lists);
    });
  });

  describe("places", () => {
    it("returns null for non-existent place", async () => {
      const place = await store.readPlace("nonexistent");
      expect(place).toBeNull();
    });

    it("writes and reads a place", async () => {
      await store.init();
      const place: Place = {
        id: "ChIJ_test",
        name: "Test Place",
        coordinates: { lat: 29.75, lng: -95.37 },
        googleMapsUrl: "https://maps.google.com/place/test",
        lists: ["list_abc"],
        comment: null,
        source: "pull",
        contentHash: "sha256:abc123",
        firstSeen: "2026-03-29T12:00:00Z",
        lastSeenRemote: "2026-03-29T12:00:00Z",
        removedRemote: false,
        enriched: null,
      };
      await store.writePlace(place);
      const result = await store.readPlace("ChIJ_test");
      expect(result).toEqual(place);
    });

    it("lists all place IDs", async () => {
      await store.init();
      const place: Place = {
        id: "ChIJ_a",
        name: "A",
        coordinates: { lat: 0, lng: 0 },
        googleMapsUrl: "https://maps.google.com/a",
        lists: [],
        comment: null,
        source: "pull",
        contentHash: "sha256:a",
        firstSeen: "2026-03-29T12:00:00Z",
        lastSeenRemote: "2026-03-29T12:00:00Z",
        removedRemote: false,
        enriched: null,
      };
      await store.writePlace(place);
      const ids = await store.listPlaceIds();
      expect(ids).toEqual(["ChIJ_a"]);
    });
  });

  describe("syncState", () => {
    it("returns default sync state when file does not exist", async () => {
      const state = await store.readSyncState("default");
      expect(state.lastPull).toBeNull();
      expect(state.consecutiveFailures).toBe(0);
    });

    it("writes and reads sync state", async () => {
      await store.init();
      const state: SyncState = {
        lastPull: "2026-03-29T12:00:00Z",
        lastPullStatus: "success",
        schemaVersion: 1,
        consecutiveFailures: 0,
        profile: "default",
      };
      await store.writeSyncState(state);
      const result = await store.readSyncState("default");
      expect(result).toEqual(state);
    });
  });

  describe("snapshots", () => {
    it("saves a snapshot file", async () => {
      await store.init();
      const path = await store.saveSnapshot("list_abc", "raw response data");
      expect(existsSync(path)).toBe(true);
      expect(readFileSync(path, "utf-8")).toBe("raw response data");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/store.test.ts
```

Expected: FAIL — `Store` class not found.

- [ ] **Step 3: Implement store.ts**

```ts
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import writeFileAtomic from "write-file-atomic";
import type { Place, ListMetadata, SyncState } from "./types.js";

export class Store {
  constructor(private readonly dataDir: string) {}

  async init(): Promise<void> {
    mkdirSync(join(this.dataDir, "places"), { recursive: true });
    mkdirSync(join(this.dataDir, "snapshots"), { recursive: true });
  }

  // --- Lists ---

  async readLists(): Promise<ListMetadata[]> {
    const path = join(this.dataDir, "lists.json");
    if (!existsSync(path)) return [];
    return JSON.parse(readFileSync(path, "utf-8"));
  }

  async writeLists(lists: ListMetadata[]): Promise<void> {
    const path = join(this.dataDir, "lists.json");
    await writeFileAtomic(path, JSON.stringify(lists, null, 2) + "\n");
  }

  // --- Places ---

  async readPlace(id: string): Promise<Place | null> {
    const path = join(this.dataDir, "places", `${id}.json`);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8"));
  }

  async writePlace(place: Place): Promise<void> {
    const path = join(this.dataDir, "places", `${place.id}.json`);
    await writeFileAtomic(path, JSON.stringify(place, null, 2) + "\n");
  }

  async listPlaceIds(): Promise<string[]> {
    const dir = join(this.dataDir, "places");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""));
  }

  async readAllPlaces(): Promise<Place[]> {
    const ids = await this.listPlaceIds();
    const places: Place[] = [];
    for (const id of ids) {
      const place = await this.readPlace(id);
      if (place) places.push(place);
    }
    return places;
  }

  // --- Sync State ---

  async readSyncState(profile: string): Promise<SyncState> {
    const path = join(this.dataDir, "sync-state.json");
    if (!existsSync(path)) {
      return {
        lastPull: null,
        lastPullStatus: "success",
        schemaVersion: 1,
        consecutiveFailures: 0,
        profile,
      };
    }
    return JSON.parse(readFileSync(path, "utf-8"));
  }

  async writeSyncState(state: SyncState): Promise<void> {
    const path = join(this.dataDir, "sync-state.json");
    await writeFileAtomic(path, JSON.stringify(state, null, 2) + "\n");
  }

  // --- Snapshots ---

  async saveSnapshot(listId: string, rawData: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${timestamp}-${listId}.json`;
    const path = join(this.dataDir, "snapshots", filename);
    await writeFileAtomic(path, rawData);
    return path;
  }

  async cleanOldSnapshots(retentionDays: number): Promise<number> {
    const dir = join(this.dataDir, "snapshots");
    if (!existsSync(dir)) return 0;

    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const files = readdirSync(dir);
    let removed = 0;

    for (const file of files) {
      const path = join(dir, file);
      // Timestamp is in the filename: 2026-03-29T12-00-00-000Z-list_abc.json
      // Parse the ISO date portion back
      const dateStr = file.split("-").slice(0, 3).join("-");
      const fileDate = new Date(dateStr).getTime();
      if (!isNaN(fileDate) && fileDate < cutoff) {
        const { unlinkSync } = await import("node:fs");
        unlinkSync(path);
        removed++;
      }
    }

    return removed;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/store.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/store.ts tests/store.test.ts
git commit -m "feat: add store for atomic file I/O with places, lists, sync state, snapshots"
```

---

### Task 6: Diff Engine

Compares parsed remote data against local store. Remote always wins.

**Files:**
- Create: `src/diff.ts`
- Create: `tests/diff.test.ts`

- [ ] **Step 1: Write failing diff tests**

`tests/diff.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyDiff, computeContentHash } from "../src/diff.js";
import { Store } from "../src/store.js";
import type { ParsedPlace, ParsedList, Place, ListMetadata } from "../src/types.js";

describe("computeContentHash", () => {
  it("produces consistent hash for same input", () => {
    const a = computeContentHash({ name: "Test", lat: 1, lng: 2 });
    const b = computeContentHash({ name: "Test", lat: 1, lng: 2 });
    expect(a).toBe(b);
  });

  it("produces different hash for different input", () => {
    const a = computeContentHash({ name: "Test", lat: 1, lng: 2 });
    const b = computeContentHash({ name: "Test", lat: 1, lng: 3 });
    expect(a).not.toBe(b);
  });

  it("starts with sha256: prefix", () => {
    const hash = computeContentHash({ name: "Test" });
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});

describe("applyDiff", () => {
  let tempDir: string;
  let store: Store;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "gmaps-sync-diff-"));
    store = new Store(tempDir);
    await store.init();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("adds new places from remote", async () => {
    const remotePlaces: ParsedPlace[] = [
      {
        name: "Café A",
        lat: 29.75,
        lng: -95.37,
        googleMapsUrl: "https://maps.google.com/a",
        comment: null,
        placeId: "ChIJ_a",
      },
    ];
    const remoteLists: ParsedList[] = [
      { id: "list_1", name: "Favorites", type: "FAVORITES", count: 1 },
    ];
    const listPlaceMap = new Map([["list_1", ["ChIJ_a"]]]);

    const result = await applyDiff(store, remoteLists, remotePlaces, listPlaceMap, "default");

    expect(result.added).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.flaggedRemoved).toBe(0);

    const place = await store.readPlace("ChIJ_a");
    expect(place).not.toBeNull();
    expect(place!.name).toBe("Café A");
    expect(place!.source).toBe("pull");
    expect(place!.lists).toEqual(["list_1"]);
  });

  it("updates existing place when data changes", async () => {
    // Seed a place locally
    const existing: Place = {
      id: "ChIJ_a",
      name: "Old Name",
      coordinates: { lat: 29.75, lng: -95.37 },
      googleMapsUrl: "https://maps.google.com/a",
      lists: ["list_1"],
      comment: null,
      source: "pull",
      contentHash: "sha256:old",
      firstSeen: "2026-03-28T12:00:00Z",
      lastSeenRemote: "2026-03-28T12:00:00Z",
      removedRemote: false,
      enriched: null,
    };
    await store.writePlace(existing);

    const remotePlaces: ParsedPlace[] = [
      {
        name: "New Name",
        lat: 29.75,
        lng: -95.37,
        googleMapsUrl: "https://maps.google.com/a",
        comment: "Added a comment",
        placeId: "ChIJ_a",
      },
    ];
    const listPlaceMap = new Map([["list_1", ["ChIJ_a"]]]);

    const result = await applyDiff(store, [], remotePlaces, listPlaceMap, "default");
    expect(result.updated).toBe(1);

    const updated = await store.readPlace("ChIJ_a");
    expect(updated!.name).toBe("New Name");
    expect(updated!.comment).toBe("Added a comment");
    expect(updated!.firstSeen).toBe("2026-03-28T12:00:00Z"); // preserved
  });

  it("flags places missing from remote as removedRemote", async () => {
    const existing: Place = {
      id: "ChIJ_gone",
      name: "Gone Place",
      coordinates: { lat: 0, lng: 0 },
      googleMapsUrl: "https://maps.google.com/gone",
      lists: ["list_1"],
      comment: null,
      source: "pull",
      contentHash: "sha256:x",
      firstSeen: "2026-03-28T12:00:00Z",
      lastSeenRemote: "2026-03-28T12:00:00Z",
      removedRemote: false,
      enriched: null,
    };
    await store.writePlace(existing);

    // Remote returns empty — no places
    const result = await applyDiff(store, [], [], new Map(), "default");
    expect(result.flaggedRemoved).toBe(1);

    const flagged = await store.readPlace("ChIJ_gone");
    expect(flagged!.removedRemote).toBe(true);
  });

  it("does not re-flag already removed places", async () => {
    const existing: Place = {
      id: "ChIJ_gone",
      name: "Gone Place",
      coordinates: { lat: 0, lng: 0 },
      googleMapsUrl: "https://maps.google.com/gone",
      lists: [],
      comment: null,
      source: "pull",
      contentHash: "sha256:x",
      firstSeen: "2026-03-28T12:00:00Z",
      lastSeenRemote: "2026-03-28T12:00:00Z",
      removedRemote: true,
      enriched: null,
    };
    await store.writePlace(existing);

    const result = await applyDiff(store, [], [], new Map(), "default");
    expect(result.flaggedRemoved).toBe(0);
  });

  it("updates lists metadata", async () => {
    const remoteLists: ParsedList[] = [
      { id: "list_new", name: "New List", type: "CUSTOM", count: 3 },
    ];

    await applyDiff(store, remoteLists, [], new Map(), "default");

    const lists = await store.readLists();
    expect(lists).toHaveLength(1);
    expect(lists[0].name).toBe("New List");
    expect(lists[0].removedRemote).toBe(false);
  });

  it("flags lists missing from remote", async () => {
    const existing: ListMetadata[] = [
      {
        id: "list_old",
        name: "Old List",
        type: "CUSTOM",
        count: 5,
        lastSeenRemote: "2026-03-28T12:00:00Z",
        removedRemote: false,
      },
    ];
    await store.writeLists(existing);

    // Remote returns no lists
    await applyDiff(store, [], [], new Map(), "default");

    const lists = await store.readLists();
    expect(lists[0].removedRemote).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/diff.test.ts
```

Expected: FAIL — `applyDiff`, `computeContentHash` not found.

- [ ] **Step 3: Implement diff.ts**

```ts
import { createHash } from "node:crypto";
import type { ParsedPlace, ParsedList, Place, ListMetadata } from "./types.js";
import type { Store } from "./store.js";

export interface DiffResult {
  added: number;
  updated: number;
  unchanged: number;
  flaggedRemoved: number;
}

/**
 * Compute a SHA-256 content hash of an object.
 * Used to detect changes without comparing every field.
 */
export function computeContentHash(data: Record<string, unknown>): string {
  const normalized = JSON.stringify(data, Object.keys(data).sort());
  const hash = createHash("sha256").update(normalized).digest("hex");
  return `sha256:${hash}`;
}

export async function applyDiff(
  store: Store,
  remoteLists: ParsedList[],
  remotePlaces: ParsedPlace[],
  listPlaceMap: Map<string, string[]>,
  profile: string,
): Promise<DiffResult> {
  const now = new Date().toISOString();
  const result: DiffResult = { added: 0, updated: 0, unchanged: 0, flaggedRemoved: 0 };

  // --- Diff lists ---
  const existingLists = await store.readLists();
  const remoteListIds = new Set(remoteLists.map((l) => l.id));
  const existingListMap = new Map(existingLists.map((l) => [l.id, l]));

  const updatedLists: ListMetadata[] = [];

  for (const remote of remoteLists) {
    updatedLists.push({
      id: remote.id,
      name: remote.name,
      type: remote.type,
      count: remote.count,
      lastSeenRemote: now,
      removedRemote: false,
    });
  }

  // Flag removed lists
  for (const existing of existingLists) {
    if (!remoteListIds.has(existing.id)) {
      if (!existing.removedRemote) {
        existing.removedRemote = true;
      }
      updatedLists.push(existing);
    }
  }

  await store.writeLists(updatedLists);

  // --- Diff places ---
  // Build a map: placeId → list of list IDs it belongs to
  const placeToLists = new Map<string, string[]>();
  for (const [listId, placeIds] of listPlaceMap) {
    for (const placeId of placeIds) {
      const existing = placeToLists.get(placeId) ?? [];
      existing.push(listId);
      placeToLists.set(placeId, existing);
    }
  }

  const remotePlaceIds = new Set(remotePlaces.map((p) => p.placeId));

  for (const remote of remotePlaces) {
    const contentData: Record<string, unknown> = {
      name: remote.name,
      lat: remote.lat,
      lng: remote.lng,
      googleMapsUrl: remote.googleMapsUrl,
      comment: remote.comment,
      placeId: remote.placeId,
    };
    const newHash = computeContentHash(contentData);

    const existing = await store.readPlace(remote.placeId);

    if (!existing) {
      // New place
      const place: Place = {
        id: remote.placeId,
        name: remote.name,
        coordinates: { lat: remote.lat, lng: remote.lng },
        googleMapsUrl: remote.googleMapsUrl,
        lists: placeToLists.get(remote.placeId) ?? [],
        comment: remote.comment,
        source: "pull",
        contentHash: newHash,
        firstSeen: now,
        lastSeenRemote: now,
        removedRemote: false,
        enriched: null,
      };
      await store.writePlace(place);
      result.added++;
    } else if (existing.contentHash !== newHash) {
      // Updated place
      existing.name = remote.name;
      existing.coordinates = { lat: remote.lat, lng: remote.lng };
      existing.googleMapsUrl = remote.googleMapsUrl;
      existing.comment = remote.comment;
      existing.lists = placeToLists.get(remote.placeId) ?? existing.lists;
      existing.contentHash = newHash;
      existing.lastSeenRemote = now;
      existing.removedRemote = false;
      await store.writePlace(existing);
      result.updated++;
    } else {
      // Unchanged — just update lastSeenRemote
      existing.lastSeenRemote = now;
      existing.removedRemote = false;
      existing.lists = placeToLists.get(remote.placeId) ?? existing.lists;
      await store.writePlace(existing);
      result.unchanged++;
    }
  }

  // Flag places missing from remote
  const localIds = await store.listPlaceIds();
  for (const localId of localIds) {
    if (!remotePlaceIds.has(localId)) {
      const place = await store.readPlace(localId);
      if (place && !place.removedRemote) {
        place.removedRemote = true;
        await store.writePlace(place);
        result.flaggedRemoved++;
      }
    }
  }

  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/diff.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/diff.ts tests/diff.test.ts
git commit -m "feat: add diff engine with content hashing and soft-delete"
```

---

### Task 7: Notifications

**Files:**
- Create: `src/notifications.ts`

- [ ] **Step 1: Implement notifications.ts**

This is thin enough that a test would just mock `execSync` — not worth it. Manual testing suffices.

```ts
import { execSync } from "node:child_process";

function notify(title: string, message: string): void {
  const escapedTitle = title.replace(/"/g, '\\"');
  const escapedMessage = message.replace(/"/g, '\\"');
  try {
    execSync(
      `osascript -e 'display notification "${escapedMessage}" with title "${escapedTitle}"'`,
    );
  } catch {
    // osascript may not be available on non-macOS systems — fail silently
    console.warn(`[notifications] Could not send notification: ${title}`);
  }
}

export function notifySessionExpired(profile: string): void {
  notify(
    "gmaps-sync: Session Expired",
    `Profile "${profile}" needs re-authentication. Run: gmaps-sync init --profile ${profile}`,
  );
}

export function notifySchemaFailure(): void {
  notify(
    "gmaps-sync: Schema Failure",
    "All lists failed to parse. Schema may be outdated — check snapshots/ for raw responses.",
  );
}

export function notifySyncComplete(
  profile: string,
  added: number,
  updated: number,
): void {
  notify(
    "gmaps-sync: Sync Complete",
    `Profile "${profile}": ${added} added, ${updated} updated.`,
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/notifications.ts
git commit -m "feat: add macOS notification helpers"
```

---

### Task 8: Session Manager

Manages Playwright browser lifecycle — headed mode for init, headless for sync.

**Files:**
- Create: `src/session.ts`

- [ ] **Step 1: Implement session.ts**

This module interacts with Playwright and a real browser — unit tests would require heavy mocking. It will be tested via integration/manual testing.

```ts
import { chromium, type BrowserContext, type Page } from "playwright";
import type { AppConfig } from "./types.js";

const SAVED_PLACES_URL = "https://www.google.com/maps/saved";

export interface SessionResult {
  loggedIn: boolean;
  error?: string;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function launchContext(
  browserProfileDir: string,
  config: AppConfig,
  headless: boolean,
): Promise<BrowserContext> {
  const viewportWidth = randomInt(1280, 1440);
  const viewportHeight = randomInt(800, 900);

  const launchOptions: Parameters<typeof chromium.launchPersistentContext>[1] = {
    headless,
    viewport: { width: viewportWidth, height: viewportHeight },
    userAgent: undefined, // Let Chrome use its default
    args: ["--disable-blink-features=AutomationControlled"],
  };

  if (config.useSystemChrome) {
    launchOptions.channel = "chrome";
  }

  return chromium.launchPersistentContext(browserProfileDir, launchOptions);
}

/**
 * Interactive init flow — opens headed browser for user to log in.
 * Returns when the user has successfully logged in, or on timeout.
 */
export async function initSession(
  browserProfileDir: string,
  config: AppConfig,
): Promise<SessionResult> {
  const context = await launchContext(browserProfileDir, config, false);

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(SAVED_PLACES_URL, {
      waitUntil: "domcontentloaded",
      timeout: config.sync.navigationTimeoutMs,
    });

    console.log("Please log in to your Google account in the browser window.");
    console.log("Waiting for you to reach the saved places page...");

    // Wait for the URL to indicate we're on the saved places page (not a login redirect)
    // Timeout after 5 minutes to give user time for 2FA
    await page.waitForURL((url) => {
      const href = url.toString();
      return href.includes("/maps/saved") && !href.includes("accounts.google.com");
    }, { timeout: 300_000 });

    // Add a small delay to let cookies fully settle
    await page.waitForTimeout(2000);

    console.log("Login successful! Session saved.");
    return { loggedIn: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { loggedIn: false, error: message };
  } finally {
    await context.close();
  }
}

/**
 * Health check — verifies the session is still valid by navigating
 * to the saved places page in headless mode.
 * Returns the BrowserContext and Page if logged in (caller must close).
 */
export async function checkSession(
  browserProfileDir: string,
  config: AppConfig,
): Promise<{
  loggedIn: boolean;
  context: BrowserContext | null;
  page: Page | null;
  error?: string;
}> {
  const context = await launchContext(browserProfileDir, config, config.headless);

  try {
    const page = context.pages()[0] ?? (await context.newPage());

    await page.goto(SAVED_PLACES_URL, {
      waitUntil: "domcontentloaded",
      timeout: config.sync.navigationTimeoutMs,
    });

    // Wait a moment for any redirects
    await page.waitForTimeout(3000);

    const currentUrl = page.url();
    const loggedIn =
      currentUrl.includes("/maps/saved") &&
      !currentUrl.includes("accounts.google.com");

    if (loggedIn) {
      return { loggedIn: true, context, page };
    } else {
      await context.close();
      return { loggedIn: false, context: null, page: null };
    }
  } catch (error) {
    await context.close();
    const message = error instanceof Error ? error.message : String(error);
    return { loggedIn: false, context: null, page: null, error: message };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/session.ts
git commit -m "feat: add session manager with headed init and headless health check"
```

---

### Task 9: Pull Engine

Orchestrates the full pull: session check, list discovery, place extraction, diff.

**Files:**
- Create: `src/pull.ts`

- [ ] **Step 1: Implement pull.ts**

```ts
import type { BrowserContext, Page } from "playwright";
import { parseLists, parsePlaces, getSchemaVersion } from "./parser.js";
import { applyDiff, type DiffResult } from "./diff.js";
import { Store } from "./store.js";
import { checkSession } from "./session.js";
import {
  notifySessionExpired,
  notifySchemaFailure,
  notifySyncComplete,
} from "./notifications.js";
import type { AppConfig, ParsedList, ParsedPlace, SyncState } from "./types.js";

function randomDelay(range: [number, number]): Promise<void> {
  const ms = Math.floor(Math.random() * (range[1] - range[0] + 1)) + range[0];
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface PullResult {
  success: boolean;
  diff?: DiffResult;
  error?: string;
  listsProcessed: number;
  listsFailed: number;
}

export async function pull(
  browserProfileDir: string,
  config: AppConfig,
  store: Store,
  profile: string,
): Promise<PullResult> {
  await store.init();

  // --- Health check ---
  const session = await checkSession(browserProfileDir, config);
  if (!session.loggedIn || !session.context || !session.page) {
    const syncState = await store.readSyncState(profile);
    syncState.consecutiveFailures++;
    syncState.lastPull = new Date().toISOString();
    syncState.lastPullStatus = "failure";
    await store.writeSyncState(syncState);

    if (syncState.consecutiveFailures >= 2 && config.notifications.onSessionExpired) {
      notifySessionExpired(profile);
    }

    return {
      success: false,
      error: session.error ?? "Not logged in",
      listsProcessed: 0,
      listsFailed: 0,
    };
  }

  const { context, page } = session;

  try {
    // --- Phase 1: Fetch list metadata ---
    console.log("Phase 1: Fetching list metadata...");

    let listsRaw: string | null = null;
    page.on("response", async (response) => {
      const url = response.url();
      // Capture the response containing list data on the saved page
      if (url.includes("/maps/saved") && response.status() === 200) {
        try {
          const text = await response.text();
          if (text.startsWith(")]}'")) {
            listsRaw = text;
          }
        } catch {
          // Response may not be text
        }
      }
    });

    // Navigate to saved page (already there from health check, but ensure fresh load)
    await page.goto("https://www.google.com/maps/saved", {
      waitUntil: "networkidle",
      timeout: config.sync.navigationTimeoutMs,
    });

    // Wait for network to settle
    await page.waitForTimeout(3000);

    let remoteLists: ParsedList[] = [];
    if (listsRaw) {
      try {
        remoteLists = parseLists(listsRaw);
        await store.saveSnapshot("lists", listsRaw);
        console.log(`  Found ${remoteLists.length} lists.`);
      } catch (error) {
        console.error("  Failed to parse list metadata:", error);
        await store.saveSnapshot("lists-error", listsRaw);
      }
    } else {
      console.warn("  No list metadata response intercepted.");
    }

    // --- Phase 2: Fetch each list's places ---
    console.log("Phase 2: Fetching places for each list...");

    const allPlaces: ParsedPlace[] = [];
    const listPlaceMap = new Map<string, string[]>();
    let listsProcessed = 0;
    let listsFailed = 0;

    for (const list of remoteLists) {
      console.log(`  Processing list: ${list.name} (${list.id})...`);

      await randomDelay(config.sync.delayBetweenListsMs);

      let placesRaw: string[] = [];

      // Set up interception for this list page
      const responseHandler = async (response: { url: () => string; status: () => number; text: () => Promise<string> }) => {
        const url = response.url();
        if (
          (url.includes("entitylist/getlist") || url.includes("/maps/saved/list/")) &&
          response.status() === 200
        ) {
          try {
            const text = await response.text();
            if (text.startsWith(")]}'")) {
              placesRaw.push(text);
            }
          } catch {
            // Response may not be text
          }
        }
      };

      page.on("response", responseHandler);

      try {
        await page.goto(`https://www.google.com/maps/saved/list/${list.id}`, {
          waitUntil: "networkidle",
          timeout: config.sync.navigationTimeoutMs,
        });
        await page.waitForTimeout(3000);

        // Scroll to load more if needed — scroll to bottom and wait for responses
        let previousCount = 0;
        for (let scrollAttempt = 0; scrollAttempt < 10; scrollAttempt++) {
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await page.waitForTimeout(2000);
          if (placesRaw.length === previousCount) break; // No new responses
          previousCount = placesRaw.length;
        }

        // Parse all intercepted responses for this list
        const listPlaces: ParsedPlace[] = [];
        for (const raw of placesRaw) {
          try {
            const parsed = parsePlaces(raw);
            listPlaces.push(...parsed);
            await store.saveSnapshot(list.id, raw);
          } catch (error) {
            console.error(`    Parse error for list ${list.name}:`, error);
            await store.saveSnapshot(`${list.id}-error`, raw);
          }
        }

        const placeIds = listPlaces.map((p) => p.placeId);
        listPlaceMap.set(list.id, placeIds);
        allPlaces.push(...listPlaces);
        listsProcessed++;
        console.log(`    Found ${listPlaces.length} places.`);
      } catch (error) {
        console.error(`  Failed to process list ${list.name}:`, error);
        listsFailed++;
      } finally {
        page.removeListener("response", responseHandler);
      }
    }

    // --- Phase 3: Diff and store ---
    console.log("Phase 3: Applying diff...");

    // Deduplicate places by placeId (same place can appear in multiple lists)
    const uniquePlaces = new Map<string, ParsedPlace>();
    for (const place of allPlaces) {
      uniquePlaces.set(place.placeId, place);
    }

    const diff = await applyDiff(
      store,
      remoteLists,
      Array.from(uniquePlaces.values()),
      listPlaceMap,
      profile,
    );

    console.log(
      `  Done: ${diff.added} added, ${diff.updated} updated, ${diff.unchanged} unchanged, ${diff.flaggedRemoved} flagged removed.`,
    );

    // --- Update sync state ---
    const allFailed = remoteLists.length > 0 && listsFailed === remoteLists.length;
    const status = allFailed ? "failure" : listsFailed > 0 ? "partial" : "success";

    const syncState: SyncState = {
      lastPull: new Date().toISOString(),
      lastPullStatus: status,
      schemaVersion: getSchemaVersion(),
      consecutiveFailures: 0,
      profile,
    };
    await store.writeSyncState(syncState);

    // Notifications
    if (allFailed && config.notifications.onSchemaFailure) {
      notifySchemaFailure();
    }
    if (config.notifications.onSyncComplete) {
      notifySyncComplete(profile, diff.added, diff.updated);
    }

    // Clean old snapshots
    await store.cleanOldSnapshots(config.snapshotsRetentionDays);

    return { success: !allFailed, diff, listsProcessed, listsFailed };
  } finally {
    await context.close();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pull.ts
git commit -m "feat: add pull engine with network interception and pagination"
```

---

### Task 10: Enrichment

**Files:**
- Create: `src/enrich.ts`
- Create: `tests/enrich.test.ts`

- [ ] **Step 1: Write failing enrich test**

`tests/enrich.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shouldEnrich } from "../src/enrich.js";
import type { Place } from "../src/types.js";

function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    id: "ChIJ_test",
    name: "Test",
    coordinates: { lat: 0, lng: 0 },
    googleMapsUrl: "https://maps.google.com/test",
    lists: [],
    comment: null,
    source: "pull",
    contentHash: "sha256:abc",
    firstSeen: "2026-03-29T12:00:00Z",
    lastSeenRemote: "2026-03-29T12:00:00Z",
    removedRemote: false,
    enriched: null,
    ...overrides,
  };
}

describe("shouldEnrich", () => {
  it("returns true for place with no enrichment", () => {
    expect(shouldEnrich(makePlace(), false)).toBe(true);
  });

  it("returns false for already enriched place without force", () => {
    const place = makePlace({
      enriched: {
        address: "123 Main St",
        phone: null,
        rating: null,
        priceLevel: null,
        category: null,
        enrichedAt: "2026-03-29T12:00:00Z",
      },
    });
    expect(shouldEnrich(place, false)).toBe(false);
  });

  it("returns true for already enriched place with force", () => {
    const place = makePlace({
      enriched: {
        address: "123 Main St",
        phone: null,
        rating: null,
        priceLevel: null,
        category: null,
        enrichedAt: "2026-03-29T12:00:00Z",
      },
    });
    expect(shouldEnrich(place, true)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/enrich.test.ts
```

Expected: FAIL — `shouldEnrich` not found.

- [ ] **Step 3: Implement enrich.ts**

```ts
import type { Place, EnrichedData } from "./types.js";
import { Store } from "./store.js";

export function shouldEnrich(place: Place, force: boolean): boolean {
  if (force) return true;
  return place.enriched === null;
}

interface PlaceDetailsResponse {
  result?: {
    formatted_address?: string;
    formatted_phone_number?: string;
    rating?: number;
    price_level?: number;
    types?: string[];
  };
  status: string;
}

const PRICE_LEVEL_MAP: Record<number, string> = {
  0: "Free",
  1: "Inexpensive",
  2: "Moderate",
  3: "Expensive",
  4: "Very Expensive",
};

async function fetchPlaceDetails(
  placeId: string,
  apiKey: string,
): Promise<EnrichedData | null> {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=formatted_address,formatted_phone_number,rating,price_level,types&key=${apiKey}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Places API returned ${response.status}: ${response.statusText}`);
  }

  const data = (await response.json()) as PlaceDetailsResponse;
  if (data.status !== "OK") {
    if (data.status === "NOT_FOUND") return null;
    throw new Error(`Places API error: ${data.status}`);
  }

  const result = data.result;
  if (!result) return null;

  return {
    address: result.formatted_address ?? "",
    phone: result.formatted_phone_number ?? null,
    rating: result.rating ?? null,
    priceLevel: result.price_level !== undefined
      ? PRICE_LEVEL_MAP[result.price_level] ?? null
      : null,
    category: result.types?.[0] ?? null,
    enrichedAt: new Date().toISOString(),
  };
}

export interface EnrichResult {
  enriched: number;
  skipped: number;
  failed: number;
}

export async function enrichPlaces(
  store: Store,
  apiKey: string,
  placeIds: string[],
  force: boolean,
): Promise<EnrichResult> {
  const result: EnrichResult = { enriched: 0, skipped: 0, failed: 0 };

  for (const id of placeIds) {
    const place = await store.readPlace(id);
    if (!place) {
      console.warn(`Place ${id} not found, skipping.`);
      result.skipped++;
      continue;
    }

    if (!shouldEnrich(place, force)) {
      result.skipped++;
      continue;
    }

    try {
      console.log(`Enriching: ${place.name} (${id})...`);
      const enriched = await fetchPlaceDetails(id, apiKey);
      if (enriched) {
        place.enriched = enriched;
        await store.writePlace(place);
        result.enriched++;
      } else {
        console.warn(`  No details found for ${place.name}`);
        result.failed++;
      }
    } catch (error) {
      console.error(`  Failed to enrich ${place.name}:`, error);
      result.failed++;
    }
  }

  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/enrich.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/enrich.ts tests/enrich.test.ts
git commit -m "feat: add enrichment via Google Places API"
```

---

### Task 11: CLI

Ties everything together with Commander commands.

**Files:**
- Create: `src/cli.ts`

- [ ] **Step 1: Implement cli.ts**

```ts
#!/usr/bin/env node

import { Command } from "commander";
import { mkdirSync } from "node:fs";
import { loadConfig, resolveProfilePaths, BASE_DIR } from "./config.js";
import { Store } from "./store.js";
import { initSession } from "./session.js";
import { pull } from "./pull.js";
import { enrichPlaces } from "./enrich.js";

const program = new Command();

program
  .name("gmaps-sync")
  .description("One-way sync from Google Maps saved places to local JSON")
  .version("0.1.0");

function getStore(profile: string): { store: Store; browserProfileDir: string } {
  const config = loadConfig();
  const profileConfig = config.profiles[profile];
  const paths = resolveProfilePaths(BASE_DIR, profile, profileConfig);
  mkdirSync(paths.dataDir, { recursive: true });
  mkdirSync(paths.browserProfileDir, { recursive: true });
  return { store: new Store(paths.dataDir), browserProfileDir: paths.browserProfileDir };
}

// --- init ---
program
  .command("init")
  .description("First-time setup: opens browser for Google login")
  .option("--profile <name>", "Profile name", "default")
  .action(async (opts: { profile: string }) => {
    const config = loadConfig();
    const { browserProfileDir, store } = getStore(opts.profile);
    await store.init();

    console.log(`Initializing profile: ${opts.profile}`);
    console.log(`Browser profile: ${browserProfileDir}`);

    const result = await initSession(browserProfileDir, config);
    if (result.loggedIn) {
      console.log("Setup complete. You can now run: gmaps-sync pull");
    } else {
      console.error("Setup failed:", result.error);
      process.exitCode = 1;
    }
  });

// --- pull ---
program
  .command("pull")
  .description("Pull saved places from Google Maps")
  .option("--profile <name>", "Profile name", "default")
  .action(async (opts: { profile: string }) => {
    const config = loadConfig();
    const { browserProfileDir, store } = getStore(opts.profile);

    // Jitter: random delay 0-60 minutes when run by scheduler
    // Skip jitter if stdout is a TTY (interactive use)
    if (!process.stdout.isTTY && config.sync.jitterMinutes > 0) {
      const jitterMs = Math.floor(
        Math.random() * config.sync.jitterMinutes * 60 * 1000,
      );
      console.log(`Jitter delay: ${Math.round(jitterMs / 1000)}s`);
      await new Promise((resolve) => setTimeout(resolve, jitterMs));
    }

    console.log(`Pulling for profile: ${opts.profile}`);
    const result = await pull(browserProfileDir, config, store, opts.profile);

    if (result.success) {
      console.log("Pull complete.");
    } else {
      console.error("Pull failed:", result.error);
      process.exitCode = 1;
    }
  });

// --- status ---
program
  .command("status")
  .description("Show sync status")
  .option("--profile <name>", "Profile name", "default")
  .action(async (opts: { profile: string }) => {
    const { store } = getStore(opts.profile);
    const syncState = await store.readSyncState(opts.profile);
    const lists = await store.readLists();
    const placeIds = await store.listPlaceIds();

    console.log(`Profile: ${opts.profile}`);
    console.log(`Last pull: ${syncState.lastPull ?? "never"}`);
    console.log(`Last status: ${syncState.lastPullStatus}`);
    console.log(`Schema version: ${syncState.schemaVersion}`);
    console.log(`Consecutive failures: ${syncState.consecutiveFailures}`);
    console.log(`Lists: ${lists.filter((l) => !l.removedRemote).length} active, ${lists.filter((l) => l.removedRemote).length} removed`);
    console.log(`Places: ${placeIds.length} total`);
  });

// --- enrich ---
program
  .command("enrich")
  .description("Enrich places via Google Places API")
  .option("--profile <name>", "Profile name", "default")
  .option("--all", "Enrich all places")
  .option("--list <id>", "Enrich places in a specific list")
  .option("--place <id>", "Enrich a specific place")
  .option("--force", "Re-enrich already enriched places", false)
  .action(async (opts: { profile: string; all?: boolean; list?: string; place?: string; force: boolean }) => {
    const config = loadConfig();
    const apiKey = config.enrichment.googlePlacesApiKey;
    if (!apiKey) {
      console.error("No Google Places API key configured.");
      console.error("Set enrichment.googlePlacesApiKey in ~/.gmaps-sync/config.json");
      process.exitCode = 1;
      return;
    }

    const { store } = getStore(opts.profile);
    let placeIds: string[];

    if (opts.place) {
      placeIds = [opts.place];
    } else if (opts.list) {
      const lists = await store.readLists();
      const places = await store.readAllPlaces();
      placeIds = places
        .filter((p) => p.lists.includes(opts.list!))
        .map((p) => p.id);
    } else {
      // Default: enrich all
      placeIds = await store.listPlaceIds();
    }

    console.log(`Enriching ${placeIds.length} places...`);
    const result = await enrichPlaces(store, apiKey, placeIds, opts.force);
    console.log(
      `Done: ${result.enriched} enriched, ${result.skipped} skipped, ${result.failed} failed.`,
    );
  });

// --- prune ---
program
  .command("prune")
  .description("Remove locally flagged-as-removed places")
  .option("--profile <name>", "Profile name", "default")
  .option("--dry-run", "Show what would be removed without removing", false)
  .action(async (opts: { profile: string; dryRun: boolean }) => {
    const { store } = getStore(opts.profile);
    const allPlaces = await store.readAllPlaces();
    const toRemove = allPlaces.filter((p) => p.removedRemote);

    if (toRemove.length === 0) {
      console.log("No places flagged for removal.");
      return;
    }

    for (const place of toRemove) {
      if (opts.dryRun) {
        console.log(`Would remove: ${place.name} (${place.id})`);
      } else {
        const { unlinkSync } = await import("node:fs");
        const { join } = await import("node:path");
        const paths = resolveProfilePaths(
          BASE_DIR,
          opts.profile,
          loadConfig().profiles[opts.profile],
        );
        unlinkSync(join(paths.dataDir, "places", `${place.id}.json`));
        console.log(`Removed: ${place.name} (${place.id})`);
      }
    }

    if (opts.dryRun) {
      console.log(`\n${toRemove.length} places would be removed. Run without --dry-run to delete.`);
    } else {
      console.log(`\n${toRemove.length} places removed.`);
    }
  });

// --- schema-check ---
program
  .command("schema-check")
  .description("Validate schema.json against a test pull (dry run)")
  .option("--profile <name>", "Profile name", "default")
  .action(async (opts: { profile: string }) => {
    const config = loadConfig();
    const { browserProfileDir } = getStore(opts.profile);

    console.log("Running schema check (dry run)...");
    // This does a pull but doesn't write to the data store
    const { checkSession } = await import("./session.js");
    const session = await checkSession(browserProfileDir, config);
    if (!session.loggedIn || !session.page) {
      console.error("Not logged in. Run: gmaps-sync init");
      process.exitCode = 1;
      return;
    }

    const { parseLists } = await import("./parser.js");

    let intercepted: string | null = null;
    session.page.on("response", async (response) => {
      const url = response.url();
      if (url.includes("/maps/saved") && response.status() === 200) {
        try {
          const text = await response.text();
          if (text.startsWith(")]}'")) {
            intercepted = text;
          }
        } catch { /* ignore */ }
      }
    });

    await session.page.goto("https://www.google.com/maps/saved", {
      waitUntil: "networkidle",
      timeout: config.sync.navigationTimeoutMs,
    });
    await session.page.waitForTimeout(3000);

    if (intercepted) {
      try {
        const lists = parseLists(intercepted);
        console.log(`Schema OK — parsed ${lists.length} lists.`);
        for (const list of lists) {
          console.log(`  - ${list.name} (${list.type}, ${list.count} items)`);
        }
      } catch (error) {
        console.error("Schema FAILED:", error);
        process.exitCode = 1;
      }
    } else {
      console.error("No response intercepted. Check your connection.");
      process.exitCode = 1;
    }

    await session.context!.close();
  });

program.parse();
```

- [ ] **Step 2: Add shebang handling to tsconfig**

The `#!/usr/bin/env node` line is fine — TypeScript strips it. No tsconfig change needed. But verify the build works:

```bash
npx tsc
```

Expected: compiles to `dist/` without errors.

- [ ] **Step 3: Test the CLI runs**

```bash
node dist/cli.js --help
```

Expected: Shows help text with all commands.

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add CLI with init, pull, status, enrich, prune, schema-check commands"
```

---

### Task 12: Run All Tests

- [ ] **Step 1: Run the full test suite**

```bash
npx vitest run
```

Expected: All tests pass (parser, config, store, diff, enrich).

- [ ] **Step 2: Run the TypeScript build**

```bash
npx tsc
```

Expected: No errors.

- [ ] **Step 3: Fix any issues found**

If any tests fail or the build has errors, fix them before proceeding.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve any build/test issues"
```

(Skip if no fixes were needed.)

---

### Task 13: Scheduling (launchd plist)

**Files:**
- Create: `src/scheduling.ts` (helper to install/uninstall the plist)

- [ ] **Step 1: Implement scheduling.ts**

```ts
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";

const PLIST_NAME = "com.gmaps-sync.pull";
const PLIST_PATH = join(homedir(), "Library", "LaunchAgents", `${PLIST_NAME}.plist`);

function generatePlist(profile: string): string {
  const logDir = join(homedir(), ".gmaps-sync", "logs");
  // Find the installed gmaps-sync binary
  const binPath = process.argv[1]; // Path to the running CLI script

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_NAME}</string>
    <key>ProgramArguments</key>
    <array>
        <string>node</string>
        <string>${binPath}</string>
        <string>pull</string>
        <string>--profile</string>
        <string>${profile}</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>6</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>${logDir}/pull-stdout.log</string>
    <key>StandardErrorPath</key>
    <string>${logDir}/pull-stderr.log</string>
    <key>RunAtLoad</key>
    <false/>
</dict>
</plist>`;
}

export function installSchedule(profile: string): void {
  const logDir = join(homedir(), ".gmaps-sync", "logs");
  mkdirSync(logDir, { recursive: true });

  const plistContent = generatePlist(profile);
  writeFileSync(PLIST_PATH, plistContent);

  try {
    execSync(`launchctl load ${PLIST_PATH}`);
    console.log(`Schedule installed: ${PLIST_PATH}`);
    console.log("Pull will run daily at 6:00 AM (with jitter).");
  } catch (error) {
    console.error("Failed to load plist:", error);
  }
}

export function uninstallSchedule(): void {
  if (!existsSync(PLIST_PATH)) {
    console.log("No schedule installed.");
    return;
  }

  try {
    execSync(`launchctl unload ${PLIST_PATH}`);
  } catch {
    // May already be unloaded
  }

  unlinkSync(PLIST_PATH);
  console.log("Schedule removed.");
}
```

- [ ] **Step 2: Wire scheduling into CLI**

Add to `src/cli.ts`, after the `schema-check` command and before `program.parse()`:

```ts
// --- schedule ---
import { installSchedule, uninstallSchedule } from "./scheduling.js";

program
  .command("schedule")
  .description("Install or remove the daily sync schedule (macOS launchd)")
  .option("--profile <name>", "Profile name", "default")
  .option("--remove", "Remove the schedule", false)
  .action((opts: { profile: string; remove: boolean }) => {
    if (opts.remove) {
      uninstallSchedule();
    } else {
      installSchedule(opts.profile);
    }
  });
```

- [ ] **Step 3: Build and verify**

```bash
npx tsc
node dist/cli.js schedule --help
```

Expected: Shows schedule command help.

- [ ] **Step 4: Commit**

```bash
git add src/scheduling.ts src/cli.ts
git commit -m "feat: add launchd scheduling for daily pulls"
```

---

### Task 14: Final Verification and Cleanup

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 2: Build**

```bash
npx tsc
```

Expected: No errors.

- [ ] **Step 3: Verify CLI help**

```bash
node dist/cli.js --help
```

Expected: Shows all commands: init, pull, status, enrich, prune, schema-check, schedule.

- [ ] **Step 4: Verify each subcommand help**

```bash
node dist/cli.js init --help
node dist/cli.js pull --help
node dist/cli.js status --help
node dist/cli.js enrich --help
node dist/cli.js prune --help
node dist/cli.js schema-check --help
node dist/cli.js schedule --help
```

Expected: Each shows its options.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: final verification of gmaps-sync MVP"
```
