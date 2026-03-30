# API Response Format Update — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the parser, pull engine, session, and tests to work with Google's current API endpoints (`mas` for lists, `getlist` for places) instead of the defunct `/maps/saved` URL.

**Architecture:** Keep the existing schema-driven parser (`schema.json` + `walkPath`). Update field paths, endpoint URLs, and network interception logic. Switch from `page.goto()` to `page.evaluate(fetch)` for per-list place fetching. Replace `googleMapsUrl` with `address` throughout.

**Tech Stack:** TypeScript, Playwright, Vitest

---

### Task 1: Update types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Update `ParsedList.type` from `string` to `number`**

```typescript
export interface ParsedList {
  id: string | null;
  name: string;
  type: number;
  count: number;
}
```

Note: `id` becomes `string | null` because built-in lists (Saved places, Travel plans) have `null` IDs.

- [ ] **Step 2: Update `ParsedPlace` — remove `googleMapsUrl`, add `address`**

```typescript
export interface ParsedPlace {
  name: string;
  lat: number;
  lng: number;
  address: string;
  comment: string | null;
  placeId: string;
}
```

- [ ] **Step 3: Update `ListMetadata.type` from `string` to `number`**

```typescript
export interface ListMetadata {
  id: string;
  name: string;
  type: number;
  count: number;
  lastSeenRemote: string;
  removedRemote: boolean;
}
```

- [ ] **Step 4: Update `Place` — remove `googleMapsUrl`, add `address`**

```typescript
export interface Place {
  id: string;
  name: string;
  coordinates: PlaceCoordinates;
  address: string;
  lists: string[];
  comment: string | null;
  source: "pull" | "local";
  contentHash: string;
  firstSeen: string;
  lastSeenRemote: string;
  removedRemote: boolean;
  enriched: EnrichedData | null;
}
```

- [ ] **Step 5: Verify types compile**

Run: `npx tsc --noEmit 2>&1 | head -40`
Expected: Multiple errors in files that reference old fields — this is correct, we'll fix them in subsequent tasks.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts
git commit -m "refactor: update types for new Google Maps API response format"
```

---

### Task 2: Update schema.json

**Files:**
- Modify: `schema.json`

- [ ] **Step 1: Replace schema.json with v2 paths**

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
      "placeIdPart2": "[1][6][1]"
    }
  }
}
```

Note: `lists.entries` and `places.entries` are gone — the root now points directly at the array. `responsePrefix` is removed. `places.root` is `[0][8]` because the getlist response wraps the list metadata at `[0]` with entries at `[0][8]`.

- [ ] **Step 2: Commit**

```bash
git add schema.json
git commit -m "refactor: update schema.json to v2 for new API response paths"
```

---

### Task 3: Update parser and write tests

**Files:**
- Modify: `src/parser.ts`
- Modify: `tests/parser.test.ts`

- [ ] **Step 1: Write failing parser tests**

Replace the contents of `tests/parser.test.ts`:

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

    // Should have 49 lists total
    expect(result.length).toBe(49);

    // First list: "Want to go"
    expect(result[0]).toEqual({
      id: "1x5yjcIYJ3nW-DmNRQr9BuNTu9ig",
      name: "Want to go",
      type: 3,
      count: 35,
    });

    // Check a user-created list
    const houston = result.find((l) => l.name === "Houston Drinking New");
    expect(houston).toBeDefined();
    expect(houston!.type).toBe(1);
    expect(houston!.count).toBe(31);
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
  it("parses places from getlist response", () => {
    const result = parsePlaces(JSON.stringify(getlistFixture));

    // Houston Drinking New has 31 places
    expect(result.length).toBe(31);

    // First place: Marquis II
    expect(result[0]).toEqual({
      name: "Marquis II",
      lat: 29.7252297,
      lng: -95.4200982,
      address: "Marquis II, 2631 Bissonnet St, Houston, TX 77005",
      comment: "",
      placeId: "-8772799911369865815_-4757512616063040366",
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

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/parser.test.ts 2>&1 | tail -20`
Expected: FAIL — `extractSessionToken` is not exported, `parseLists` and `parsePlaces` fail on new fixture format.

- [ ] **Step 3: Update parser.ts**

Replace the contents of `src/parser.ts`:

```typescript
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

/**
 * Strip the XSSI prefix Google prepends to some JSON responses.
 * The prefix is )]}' followed by a newline.
 * New endpoints return plain JSON, so this is a safe no-op.
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

/**
 * Extract the session token from a mas request URL.
 * The token is in the pb parameter after "!1s" prefix.
 */
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
    throw new Error(
      `places.root: expected array at ${schema.places.root}, got ${typeof entries}`,
    );
  }

  return entries.map((entry: unknown, i: number) => {
    const e = schema.places.entry;
    const idPart1 = walkPathRequired(entry, e.placeIdPart1, `places[${i}].placeIdPart1`, "string") as string;
    const idPart2 = walkPathRequired(entry, e.placeIdPart2, `places[${i}].placeIdPart2`, "string") as string;

    return {
      name: walkPathRequired(entry, e.name, `places[${i}].name`, "string") as string,
      lat: walkPathRequired(entry, e.lat, `places[${i}].lat`, "number") as number,
      lng: walkPathRequired(entry, e.lng, `places[${i}].lng`, "number") as number,
      address: (walkPathRequired(entry, e.address, `places[${i}].address`) ?? "") as string,
      comment: walkPathRequired(entry, e.comment, `places[${i}].comment`) as string | null,
      placeId: `${idPart1}_${idPart2}`,
    };
  });
}

export function getSchemaVersion(): number {
  return schema.version;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/parser.test.ts 2>&1 | tail -20`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/parser.ts tests/parser.test.ts
git commit -m "feat: update parser for new mas/getlist API response format"
```

---

### Task 4: Update diff engine and tests

**Files:**
- Modify: `src/diff.ts`
- Modify: `tests/diff.test.ts`

- [ ] **Step 1: Update diff.ts — replace `googleMapsUrl` with `address`**

In `src/diff.ts`, replace the content hash computation and place construction. Change the `contentData` object (around line 74):

```typescript
    const contentData: Record<string, unknown> = {
      name: remote.name,
      lat: remote.lat,
      lng: remote.lng,
      address: remote.address,
      comment: remote.comment,
      placeId: remote.placeId,
    };
```

Change the new place construction (around line 88):

```typescript
      const place: Place = {
        id: remote.placeId,
        name: remote.name,
        coordinates: { lat: remote.lat, lng: remote.lng },
        address: remote.address,
        lists: placeToLists.get(remote.placeId) ?? [],
        comment: remote.comment,
        source: "pull",
        contentHash: newHash,
        firstSeen: now,
        lastSeenRemote: now,
        removedRemote: false,
        enriched: null,
      };
```

Change the update path (around line 106):

```typescript
      existing.name = remote.name;
      existing.coordinates = { lat: remote.lat, lng: remote.lng };
      existing.address = remote.address;
      existing.comment = remote.comment;
```

Remove the line `existing.googleMapsUrl = remote.googleMapsUrl;`.

- [ ] **Step 2: Update diff tests**

Replace `tests/diff.test.ts`:

```typescript
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
        address: "123 Main St, Houston, TX",
        comment: null,
        placeId: "-123_-456",
      },
    ];
    const remoteLists: ParsedList[] = [
      { id: "list_1", name: "Favorites", type: 2, count: 1 },
    ];
    const listPlaceMap = new Map([["list_1", ["-123_-456"]]]);

    const result = await applyDiff(store, remoteLists, remotePlaces, listPlaceMap);

    expect(result.added).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.flaggedRemoved).toBe(0);

    const place = await store.readPlace("-123_-456");
    expect(place).not.toBeNull();
    expect(place!.name).toBe("Café A");
    expect(place!.address).toBe("123 Main St, Houston, TX");
    expect(place!.source).toBe("pull");
    expect(place!.lists).toEqual(["list_1"]);
  });

  it("updates existing place when data changes", async () => {
    const existing: Place = {
      id: "-123_-456",
      name: "Old Name",
      coordinates: { lat: 29.75, lng: -95.37 },
      address: "123 Main St, Houston, TX",
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
        address: "123 Main St, Houston, TX",
        comment: "Added a comment",
        placeId: "-123_-456",
      },
    ];
    const listPlaceMap = new Map([["list_1", ["-123_-456"]]]);

    const result = await applyDiff(store, [], remotePlaces, listPlaceMap);
    expect(result.updated).toBe(1);

    const updated = await store.readPlace("-123_-456");
    expect(updated!.name).toBe("New Name");
    expect(updated!.comment).toBe("Added a comment");
    expect(updated!.firstSeen).toBe("2026-03-28T12:00:00Z");
  });

  it("flags places missing from remote as removedRemote", async () => {
    const existing: Place = {
      id: "-789_-012",
      name: "Gone Place",
      coordinates: { lat: 0, lng: 0 },
      address: "",
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

    const result = await applyDiff(store, [], [], new Map());
    expect(result.flaggedRemoved).toBe(1);

    const flagged = await store.readPlace("-789_-012");
    expect(flagged!.removedRemote).toBe(true);
  });

  it("does not re-flag already removed places", async () => {
    const existing: Place = {
      id: "-789_-012",
      name: "Gone Place",
      coordinates: { lat: 0, lng: 0 },
      address: "",
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

    const result = await applyDiff(store, [], [], new Map());
    expect(result.flaggedRemoved).toBe(0);
  });

  it("updates lists metadata", async () => {
    const remoteLists: ParsedList[] = [
      { id: "list_new", name: "New List", type: 1, count: 3 },
    ];

    await applyDiff(store, remoteLists, [], new Map());

    const lists = await store.readLists();
    expect(lists).toHaveLength(1);
    expect(lists[0].name).toBe("New List");
    expect(lists[0].type).toBe(1);
    expect(lists[0].removedRemote).toBe(false);
  });

  it("flags lists missing from remote", async () => {
    const existing: ListMetadata[] = [
      {
        id: "list_old",
        name: "Old List",
        type: 1,
        count: 5,
        lastSeenRemote: "2026-03-28T12:00:00Z",
        removedRemote: false,
      },
    ];
    await store.writeLists(existing);

    await applyDiff(store, [], [], new Map());

    const lists = await store.readLists();
    expect(lists[0].removedRemote).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/diff.test.ts 2>&1 | tail -20`
Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/diff.ts tests/diff.test.ts
git commit -m "refactor: update diff engine for new API response format"
```

---

### Task 5: Update store and enrich tests

**Files:**
- Modify: `tests/store.test.ts`
- Modify: `tests/enrich.test.ts`

- [ ] **Step 1: Update store tests — replace `googleMapsUrl` with `address`**

In `tests/store.test.ts`, update all `Place` objects. Replace every occurrence of:
```typescript
googleMapsUrl: "https://maps.google.com/place/test",
```
with:
```typescript
address: "123 Test St",
```

And replace:
```typescript
googleMapsUrl: "https://maps.google.com/a",
```
with:
```typescript
address: "",
```

Also update `ListMetadata` type values from strings to numbers:
```typescript
type: "WANT_TO_GO",
```
becomes:
```typescript
type: 3,
```

- [ ] **Step 2: Update enrich test — replace `makePlace` helper**

In `tests/enrich.test.ts`, update the `makePlace` function:

```typescript
function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    id: "-123_-456",
    name: "Test",
    coordinates: { lat: 0, lng: 0 },
    address: "",
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
```

- [ ] **Step 3: Run all tests**

Run: `npx vitest run 2>&1 | tail -20`
Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/store.test.ts tests/enrich.test.ts
git commit -m "test: update store and enrich tests for new Place type"
```

---

### Task 6: Update enrich.ts for new placeId format

**Files:**
- Modify: `src/enrich.ts`

- [ ] **Step 1: Update `fetchPlaceDetails` to warn about incompatible placeId**

The new `placeId` (numeric ID pair) is not a valid Google Places API `place_id`. For now, log a warning and skip enrichment. Replace the `fetchPlaceDetails` call in `enrichPlaces` (line 89):

```typescript
    try {
      console.log(`Enriching: ${place.name} (${id})...`);
      // New placeId format (numeric pair) is not a valid Google Places API place_id.
      // Enrichment is disabled until a lookup strategy using placeRef or name+coords is implemented.
      console.warn(`  Skipped: enrichment not yet supported with new place ID format`);
      result.skipped++;
    } catch (error) {
```

Remove the inner `if (enriched)` / `else` block so the try body is just the two console lines and `result.skipped++`.

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit 2>&1 | tail -10`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/enrich.ts
git commit -m "refactor: disable enrichment until placeRef lookup is implemented"
```

---

### Task 7: Update session.ts

**Files:**
- Modify: `src/session.ts`

- [ ] **Step 1: Update SAVED_PLACES_URL and initSession**

Replace the contents of `src/session.ts`:

```typescript
import { chromium, type BrowserContext, type Page } from "playwright";
import type { AppConfig } from "./types.js";

const SAVED_PLACES_URL = "https://www.google.com/maps/@0,0,2z/data=!4m2!10m1!1e1";

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
    userAgent: undefined,
    args: ["--disable-blink-features=AutomationControlled"],
  };

  if (config.useSystemChrome) {
    launchOptions.channel = "chrome";
  }

  return chromium.launchPersistentContext(browserProfileDir, launchOptions);
}

/**
 * Interactive init flow — opens headed browser for user to log in.
 * Detects successful login by intercepting the mas API request
 * (which only fires when the Saved panel loads with an authenticated session).
 */
export async function initSession(
  browserProfileDir: string,
  config: AppConfig,
): Promise<SessionResult> {
  let context: BrowserContext;
  try {
    context = await launchContext(browserProfileDir, config, false);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { loggedIn: false, error: `Failed to launch browser: ${message}` };
  }

  try {
    const page = context.pages()[0] ?? (await context.newPage());

    // Wait for the mas request as proof of authenticated saved places access
    const masPromise = page.waitForRequest(
      (req) => req.url().includes("locationhistory/preview/mas"),
      { timeout: 300_000 },
    );

    await page.goto(SAVED_PLACES_URL, {
      waitUntil: "domcontentloaded",
      timeout: config.sync.navigationTimeoutMs,
    });

    console.log("Please log in to your Google account in the browser window.");
    console.log("Waiting for you to reach the saved places page...");

    await masPromise;

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
 * to the saved places page and checking for the mas API request.
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
  let context: BrowserContext;
  try {
    context = await launchContext(browserProfileDir, config, config.headless);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { loggedIn: false, context: null, page: null, error: `Failed to launch browser: ${message}` };
  }

  try {
    const page = context.pages()[0] ?? (await context.newPage());

    const masPromise = page.waitForRequest(
      (req) => req.url().includes("locationhistory/preview/mas"),
      { timeout: config.sync.navigationTimeoutMs },
    );

    await page.goto(SAVED_PLACES_URL, {
      waitUntil: "domcontentloaded",
      timeout: config.sync.navigationTimeoutMs,
    });

    try {
      await masPromise;
      return { loggedIn: true, context, page };
    } catch {
      // mas request never fired — not logged in or page didn't load saved panel
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

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit 2>&1 | tail -10`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/session.ts
git commit -m "feat: update session to use new saved places URL and mas detection"
```

---

### Task 8: Update pull engine

**Files:**
- Modify: `src/pull.ts`

- [ ] **Step 1: Rewrite pull.ts for new API flow**

Replace the contents of `src/pull.ts`:

```typescript
import { parseLists, parsePlaces, getSchemaVersion, extractSessionToken } from "./parser.js";
import { applyDiff, type DiffResult } from "./diff.js";
import type { Store } from "./store.js";
import { checkSession } from "./session.js";
import {
  notifySessionExpired,
  notifySchemaFailure,
  notifySyncComplete,
} from "./notifications.js";
import type { AppConfig, ParsedList, ParsedPlace, SyncState } from "./types.js";

const GETLIST_BASE = "https://www.google.com/maps/preview/entitylist/getlist";

function randomDelay(range: [number, number]): Promise<void> {
  const ms = Math.floor(Math.random() * (range[1] - range[0] + 1)) + range[0];
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildGetlistUrl(listId: string, listType: number, sessionToken: string): string {
  const pb = `!1m4!1s${listId}!2e1!3m1!1e1!2e2!3e${listType}!4i500!6m3!1s${sessionToken}!7e81!28e2!8i3!16b1`;
  return `${GETLIST_BASE}?authuser=0&hl=en&gl=us&pb=${pb}`;
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
    // --- Phase 1: Intercept mas response for list metadata and session token ---
    console.log("Phase 1: Fetching list metadata...");

    let masRaw: string | null = null;
    let sessionToken: string | null = null;

    page.on("request", (request) => {
      const url = request.url();
      if (url.includes("locationhistory/preview/mas")) {
        sessionToken = extractSessionToken(url);
      }
    });

    page.on("response", async (response) => {
      const url = response.url();
      if (url.includes("locationhistory/preview/mas") && response.status() === 200) {
        try {
          masRaw = await response.text();
        } catch {
          // Response may not be text
        }
      }
    });

    // Navigate to saved places — checkSession already navigated,
    // but we may need to reload to capture the intercepted response.
    // The mas request may have already fired during checkSession.
    // Reload to ensure we capture it.
    await page.reload({ waitUntil: "networkidle", timeout: config.sync.navigationTimeoutMs });
    await page.waitForTimeout(3000);

    if (!sessionToken) {
      console.error("  Failed to extract session token from mas request.");
      return { success: false, error: "No session token", listsProcessed: 0, listsFailed: 0 };
    }

    let remoteLists: ParsedList[] = [];
    if (masRaw) {
      try {
        remoteLists = parseLists(masRaw);
        await store.saveSnapshot("mas", masRaw);
        console.log(`  Found ${remoteLists.length} lists.`);
      } catch (error) {
        console.error("  Failed to parse list metadata:", error);
        await store.saveSnapshot("mas-error", masRaw);
      }
    } else {
      console.warn("  No mas response intercepted.");
    }

    // --- Phase 2: Fetch each list's places via getlist ---
    console.log("Phase 2: Fetching places for each list...");

    const allPlaces: ParsedPlace[] = [];
    const listPlaceMap = new Map<string, string[]>();
    let listsProcessed = 0;
    let listsFailed = 0;

    // Filter to lists with an ID (built-in lists with null ID can't be fetched via getlist)
    const fetchableLists = remoteLists.filter((l) => l.id !== null);

    for (const list of fetchableLists) {
      console.log(`  Processing list: ${list.name} (${list.id})...`);

      await randomDelay(config.sync.delayBetweenListsMs);

      try {
        const getlistUrl = buildGetlistUrl(list.id!, list.type, sessionToken);

        const rawResponse = await page.evaluate(async (url: string) => {
          const res = await fetch(url, { credentials: "include" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.text();
        }, getlistUrl);

        const listPlaces = parsePlaces(rawResponse);
        await store.saveSnapshot(list.id!, rawResponse);

        const placeIds = listPlaces.map((p) => p.placeId);
        listPlaceMap.set(list.id!, placeIds);
        allPlaces.push(...listPlaces);
        listsProcessed++;
        console.log(`    Found ${listPlaces.length} places.`);
      } catch (error) {
        console.error(`  Failed to process list ${list.name}:`, error);
        listsFailed++;
      }
    }

    // --- Phase 3: Diff and store ---
    console.log("Phase 3: Applying diff...");

    // Deduplicate places by placeId
    const uniquePlaces = new Map<string, ParsedPlace>();
    for (const place of allPlaces) {
      uniquePlaces.set(place.placeId, place);
    }

    const diff = await applyDiff(
      store,
      remoteLists.filter((l) => l.id !== null) as ParsedList[],
      Array.from(uniquePlaces.values()),
      listPlaceMap,
    );

    console.log(
      `  Done: ${diff.added} added, ${diff.updated} updated, ${diff.unchanged} unchanged, ${diff.flaggedRemoved} flagged removed.`,
    );

    // --- Update sync state ---
    const allFailed = fetchableLists.length > 0 && listsFailed === fetchableLists.length;
    const status = allFailed ? "failure" : listsFailed > 0 ? "partial" : "success";

    const syncState: SyncState = {
      lastPull: new Date().toISOString(),
      lastPullStatus: status,
      schemaVersion: getSchemaVersion(),
      consecutiveFailures: 0,
      profile,
    };
    await store.writeSyncState(syncState);

    if (allFailed && config.notifications.onSchemaFailure) {
      notifySchemaFailure();
    }
    if (config.notifications.onSyncComplete) {
      notifySyncComplete(profile, diff.added, diff.updated);
    }

    await store.cleanOldSnapshots(config.snapshotsRetentionDays);

    return { success: !allFailed, diff, listsProcessed, listsFailed };
  } finally {
    await context.close();
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit 2>&1 | tail -10`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/pull.ts
git commit -m "feat: update pull engine for mas/getlist endpoints with fetch-based retrieval"
```

---

### Task 9: Update CLI schema-check command

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Update the schema-check command**

In `src/cli.ts`, replace the `schema-check` action (the `.action(async ...)` block for the `schema-check` command) with:

```typescript
  .action(async (opts: { profile: string }) => {
    const config = loadConfig();
    const { browserProfileDir } = getStore(opts.profile);

    console.log("Running schema check (dry run)...");
    const session = await checkSession(browserProfileDir, config);
    if (!session.loggedIn || !session.page) {
      console.error("Not logged in. Run: gmaps-sync init");
      process.exitCode = 1;
      return;
    }

    let intercepted: string | null = null;
    session.page.on("response", async (response) => {
      const url = response.url();
      if (url.includes("locationhistory/preview/mas") && response.status() === 200) {
        try {
          intercepted = await response.text();
        } catch { /* ignore */ }
      }
    });

    await session.page.reload({ waitUntil: "networkidle", timeout: config.sync.navigationTimeoutMs });
    await session.page.waitForTimeout(3000);

    if (intercepted) {
      try {
        const lists = parseLists(intercepted);
        console.log(`Schema OK — parsed ${lists.length} lists.`);
        for (const list of lists) {
          console.log(`  - ${list.name} (type ${list.type}, ${list.count} items)`);
        }
      } catch (error) {
        console.error("Schema FAILED:", error);
        process.exitCode = 1;
      }
    } else {
      console.error("No mas response intercepted. Check your connection.");
      process.exitCode = 1;
    }

    await session.context!.close();
  });
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit 2>&1 | tail -10`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "fix: update schema-check command for new mas endpoint"
```

---

### Task 10: Full build and test verification

- [ ] **Step 1: Run full build**

Run: `npm run build 2>&1`
Expected: Clean compilation, no errors.

- [ ] **Step 2: Run full test suite**

Run: `npm test 2>&1`
Expected: All tests pass.

- [ ] **Step 3: Push all changes**

```bash
git push origin feat/gmaps-sync-mvp
```

---

### Task 11: Manual integration testing (on macOS host)

- [ ] **Step 1: Test init**

Run: `npm run dev -- init`
Expected: Browser opens, navigates to Google Maps saved view, detects `mas` request when user logs in, prints "Login successful!".

- [ ] **Step 2: Test pull**

Run: `npm run dev -- pull`
Expected: Intercepts `mas` response, extracts session token, fetches each list via `getlist`, parses places, applies diff, writes JSON files to `~/.gmaps-sync/profiles/default/data/`.

- [ ] **Step 3: Test status**

Run: `npm run dev -- status`
Expected: Shows correct list and place counts matching Google Maps UI.

- [ ] **Step 4: Spot-check stored data**

Run: `ls ~/.gmaps-sync/profiles/default/data/places/ | head -5`
Then: `cat ~/.gmaps-sync/profiles/default/data/places/<any-file>.json`
Expected: Place JSON has `address` field, no `googleMapsUrl` field, `id` is numeric pair format.
