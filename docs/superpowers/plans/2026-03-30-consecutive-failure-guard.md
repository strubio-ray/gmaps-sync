# Consecutive Failure Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop attempting scrape runs after a configurable number of consecutive session failures, with a `--force` flag to override, and remove all OS notifications.

**Architecture:** Add an early-exit guard at the top of `pull()` that checks `consecutiveFailures >= config.sync.maxConsecutiveFailures` before launching a browser. The `pull()` function gains a `force` parameter to bypass this check. All `osascript` notification code is removed since the tool runs on a headless server.

**Tech Stack:** TypeScript (ESM), Vitest, Commander.js

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/types.ts` | Modify | Add `maxConsecutiveFailures` to `SyncConfig`, remove `NotificationsConfig` and its reference in `AppConfig` |
| `src/config.ts` | Modify | Add `maxConsecutiveFailures: 2` default, remove `notifications` defaults and merge logic |
| `src/pull.ts` | Modify | Add early-exit guard, add `force` + `options` param, remove notification imports/calls |
| `src/cli.ts` | Modify | Add `--force` option to pull command, pass it through to `pull()` |
| `src/notifications.ts` | Delete | No longer needed |
| `tests/pull.test.ts` | Create | Test consecutive failure guard and force bypass |

---

### Task 1: Remove Notification Types and Add `maxConsecutiveFailures`

**Files:**
- Modify: `src/types.ts:42-63`

- [ ] **Step 1: Update `SyncConfig` to add `maxConsecutiveFailures` and remove `retryOnSessionFailure`**

In `src/types.ts`, replace the `SyncConfig` interface (lines 42-48):

```typescript
export interface SyncConfig {
  intervalHours: number;
  jitterMinutes: number;
  delayBetweenListsMs: [number, number];
  navigationTimeoutMs: number;
  maxConsecutiveFailures: number;
}
```

- [ ] **Step 2: Remove `NotificationsConfig` and its reference in `AppConfig`**

In `src/types.ts`, delete the `NotificationsConfig` interface (lines 50-54) entirely.

Then update `AppConfig` (lines 56-63) to remove the `notifications` field:

```typescript
export interface AppConfig {
  profiles: Record<string, ProfileConfig>;
  sync: SyncConfig;
  headless: boolean;
  useSystemChrome: boolean;
  snapshotsRetentionDays: number;
}
```

- [ ] **Step 3: Run type check to see expected errors**

Run: `npx tsc --noEmit 2>&1 | head -40`

Expected: Errors in `config.ts`, `pull.ts`, and `cli.ts` referencing `notifications`, `retryOnSessionFailure`, and removed types. These will be fixed in subsequent tasks.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts && git commit -m "refactor: replace retryOnSessionFailure with maxConsecutiveFailures, remove NotificationsConfig"
```

---

### Task 2: Update Config Defaults

**Files:**
- Modify: `src/config.ts:1-48`

- [ ] **Step 1: Update `DEFAULT_CONFIG` to use `maxConsecutiveFailures` and remove notifications**

In `src/config.ts`, replace the `DEFAULT_CONFIG` object (lines 8-30):

```typescript
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
    maxConsecutiveFailures: 2,
  },
  headless: true,
  useSystemChrome: true,
  snapshotsRetentionDays: 30,
};
```

- [ ] **Step 2: Remove `notifications` merge from `loadConfig`**

In `src/config.ts`, replace the `loadConfig` return statement (lines 41-47):

```typescript
  return {
    ...DEFAULT_CONFIG,
    ...partial,
    sync: { ...DEFAULT_CONFIG.sync, ...partial.sync },
    profiles: { ...DEFAULT_CONFIG.profiles, ...partial.profiles },
  };
```

- [ ] **Step 3: Run type check**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: Errors only in `pull.ts` (notification imports/usage). `config.ts` and `types.ts` should be clean.

- [ ] **Step 4: Commit**

```bash
git add src/config.ts && git commit -m "refactor: update config defaults for maxConsecutiveFailures, remove notifications"
```

---

### Task 3: Delete Notifications Module, Update `pull()` — Add Failure Guard

**Files:**
- Delete: `src/notifications.ts`
- Modify: `src/pull.ts:1-173`

- [ ] **Step 1: Delete `src/notifications.ts` and write the failing test**

```bash
rm src/notifications.ts
```

Create `tests/pull.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/store.js";
import type { AppConfig, SyncState } from "../src/types.js";

// Mock session module to avoid launching real browsers
vi.mock("../src/session.js", () => ({
  checkSession: vi.fn(),
  interceptMasResponse: vi.fn(),
}));

import { checkSession } from "../src/session.js";
import { pull } from "../src/pull.js";

const mockCheckSession = vi.mocked(checkSession);

function makeConfig(overrides?: Partial<AppConfig["sync"]>): AppConfig {
  return {
    profiles: {},
    sync: {
      intervalHours: 24,
      jitterMinutes: 0,
      delayBetweenListsMs: [0, 0],
      navigationTimeoutMs: 5000,
      maxConsecutiveFailures: 2,
      ...overrides,
    },
    headless: true,
    useSystemChrome: false,
    snapshotsRetentionDays: 30,
  };
}

describe("pull — consecutive failure guard", () => {
  let tempDir: string;
  let store: Store;
  const profile = "test";
  const config = makeConfig();

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "gmaps-sync-pull-"));
    store = new Store(tempDir);
    await store.init();
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("blocks pull after reaching maxConsecutiveFailures", async () => {
    // Seed sync state with 2 consecutive failures (at threshold)
    const state: SyncState = {
      lastPull: "2026-03-29T12:00:00Z",
      lastPullStatus: "failure",
      schemaVersion: 1,
      consecutiveFailures: 2,
      profile,
    };
    await store.writeSyncState(state);

    const result = await pull("/fake/browser", config, store, profile);

    // Should return early without calling checkSession
    expect(mockCheckSession).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toContain("consecutive failures");
  });

  it("allows pull when consecutiveFailures is below threshold", async () => {
    const state: SyncState = {
      lastPull: "2026-03-29T12:00:00Z",
      lastPullStatus: "failure",
      schemaVersion: 1,
      consecutiveFailures: 1,
      profile,
    };
    await store.writeSyncState(state);

    // checkSession will fail, but it should be called
    mockCheckSession.mockResolvedValue({
      loggedIn: false,
      context: null,
      page: null,
      error: "Not logged in",
    });

    const result = await pull("/fake/browser", config, store, profile);

    expect(mockCheckSession).toHaveBeenCalledOnce();
    expect(result.success).toBe(false);
  });

  it("bypasses guard when force is true", async () => {
    const state: SyncState = {
      lastPull: "2026-03-29T12:00:00Z",
      lastPullStatus: "failure",
      schemaVersion: 1,
      consecutiveFailures: 5,
      profile,
    };
    await store.writeSyncState(state);

    mockCheckSession.mockResolvedValue({
      loggedIn: false,
      context: null,
      page: null,
      error: "Not logged in",
    });

    const result = await pull("/fake/browser", config, store, profile, {
      force: true,
    });

    // Should call checkSession despite high failure count
    expect(mockCheckSession).toHaveBeenCalledOnce();
    expect(result.success).toBe(false);
  });

  it("increments consecutiveFailures on session failure", async () => {
    mockCheckSession.mockResolvedValue({
      loggedIn: false,
      context: null,
      page: null,
      error: "Not logged in",
    });

    await pull("/fake/browser", config, store, profile);

    const state = await store.readSyncState(profile);
    expect(state.consecutiveFailures).toBe(1);

    // Second call still below threshold (1 < 2), so pull proceeds
    await pull("/fake/browser", config, store, profile);

    const state2 = await store.readSyncState(profile);
    expect(state2.consecutiveFailures).toBe(2);

    // Third call should be blocked by guard (2 >= 2)
    const result = await pull("/fake/browser", config, store, profile);
    expect(result.error).toContain("consecutive failures");

    // Counter stays at 2 — guard returned early, no increment
    const state3 = await store.readSyncState(profile);
    expect(state3.consecutiveFailures).toBe(2);
  });

  it("blocks on third attempt after two session failures", async () => {
    mockCheckSession.mockResolvedValue({
      loggedIn: false,
      context: null,
      page: null,
      error: "Not logged in",
    });

    // First two calls: session fails, counter increments
    await pull("/fake/browser", config, store, profile);
    await pull("/fake/browser", config, store, profile);

    expect(mockCheckSession).toHaveBeenCalledTimes(2);

    // Third call: should be blocked by guard
    mockCheckSession.mockClear();
    const result = await pull("/fake/browser", config, store, profile);

    expect(mockCheckSession).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toContain("consecutive failures");
    expect(result.error).toContain("--force");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/pull.test.ts 2>&1 | tail -20`

Expected: FAIL — `pull()` does not accept an `options` parameter yet, has no guard logic, and the deleted notification imports cause module resolution errors.

- [ ] **Step 3: Update `pull.ts` — remove notification imports and calls, add guard and force param**

Replace the entire `src/pull.ts` with:

```typescript
import { parseLists, parsePlaces, getSchemaVersion } from "./parser.js";
import { applyDiff, type DiffResult } from "./diff.js";
import type { Store } from "./store.js";
import { checkSession, interceptMasResponse } from "./session.js";
import type { AppConfig, ParsedList, ParsedPlace, SyncState } from "./types.js";

const GETLIST_BASE = "https://www.google.com/maps/preview/entitylist/getlist";

function randomDelay(range: [number, number]): Promise<void> {
  const ms = Math.floor(Math.random() * (range[1] - range[0] + 1)) + range[0];
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildGetlistUrl(listId: string, sessionToken: string): string {
  // !3e2 requests full entry details (not just metadata)
  const pb = `!1m4!1s${listId}!2e1!3m1!1e1!2e2!3e2!4i500!6m3!1s${sessionToken}!7e81!28e2!8i3!16b1`;
  return `${GETLIST_BASE}?authuser=0&hl=en&gl=us&pb=${pb}`;
}

export interface PullResult {
  success: boolean;
  diff?: DiffResult;
  error?: string;
  listsProcessed: number;
  listsFailed: number;
}

export interface PullOptions {
  force?: boolean;
}

export async function pull(
  browserProfileDir: string,
  config: AppConfig,
  store: Store,
  profile: string,
  options?: PullOptions,
): Promise<PullResult> {
  await store.init();

  // --- Consecutive failure guard ---
  if (!options?.force) {
    const prevState = await store.readSyncState(profile);
    if (prevState.consecutiveFailures >= config.sync.maxConsecutiveFailures) {
      console.error(
        `Sync paused after ${prevState.consecutiveFailures} consecutive failures. ` +
        `Run \`gmaps-sync init --profile ${profile}\` to re-authenticate, or use \`--force\` to try anyway.`,
      );
      return {
        success: false,
        error:
          `Sync paused after ${prevState.consecutiveFailures} consecutive failures. ` +
          `Run \`gmaps-sync init --profile ${profile}\` to re-authenticate, or use \`--force\` to try anyway.`,
        listsProcessed: 0,
        listsFailed: 0,
      };
    }
  }

  // --- Health check ---
  const session = await checkSession(browserProfileDir, config);
  if (!session.loggedIn || !session.context || !session.page) {
    const syncState = await store.readSyncState(profile);
    syncState.consecutiveFailures++;
    syncState.lastPull = new Date().toISOString();
    syncState.lastPullStatus = "failure";
    await store.writeSyncState(syncState);

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

    const { masRaw, sessionToken } = await interceptMasResponse(
      page,
      config.sync.navigationTimeoutMs,
    );

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

    const uniquePlaces = new Map<string, ParsedPlace>();
    const listPlaceMap = new Map<string, string[]>();
    let listsProcessed = 0;
    let listsFailed = 0;

    // Filter to lists with an ID (built-in lists with null ID can't be fetched via getlist)
    const fetchableLists = remoteLists.filter((l) => l.id !== null);

    for (const list of fetchableLists) {
      console.log(`  Processing list: ${list.name} (${list.id})...`);

      await randomDelay(config.sync.delayBetweenListsMs);

      try {
        const getlistUrl = buildGetlistUrl(list.id!, sessionToken);

        const rawResponse = await page.evaluate(async (url: string) => {
          const res = await fetch(url, { credentials: "include" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.text();
        }, getlistUrl);

        await store.saveSnapshot(list.id!, rawResponse);
        const listPlaces = parsePlaces(rawResponse);

        const placeIds = listPlaces.map((p) => p.placeId);
        listPlaceMap.set(list.id!, placeIds);
        for (const place of listPlaces) {
          uniquePlaces.set(place.placeId, place);
        }
        listsProcessed++;
        console.log(`    Found ${listPlaces.length} places.`);
      } catch (error) {
        console.error(`  Failed to process list ${list.name}:`, error);
        listsFailed++;
      }
    }

    // --- Phase 3: Diff and store ---
    console.log("Phase 3: Applying diff...");

    const diff = await applyDiff(
      store,
      fetchableLists as ParsedList[],
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

    await store.cleanOldSnapshots(config.snapshotsRetentionDays);

    return { success: !allFailed, diff, listsProcessed, listsFailed };
  } finally {
    await context.close();
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/pull.test.ts 2>&1 | tail -20`

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notifications.ts src/pull.ts tests/pull.test.ts && git commit -m "feat: add consecutive failure guard to pull, remove notifications module"
```

---

### Task 4: Add `--force` Flag to CLI

**Files:**
- Modify: `src/cli.ts:52-83`

- [ ] **Step 1: Add `--force` option and pass it to `pull()`**

In `src/cli.ts`, update the pull command definition (lines 52-83). Replace:

```typescript
// --- pull ---
program
  .command("pull")
  .description("Pull saved places from Google Maps")
  .option("--profile <name>", "Profile name", "default")
  .option("--headed", "Run browser in headed mode for debugging", false)
  .action(async (opts: { profile: string; headed: boolean }) => {
    const config = loadConfig();
    if (opts.headed) {
      config.headless = false;
    }
    const { browserProfileDir, store } = getStore(opts.profile, config);

    // Jitter: random delay when run by scheduler (non-TTY)
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
```

With:

```typescript
// --- pull ---
program
  .command("pull")
  .description("Pull saved places from Google Maps")
  .option("--profile <name>", "Profile name", "default")
  .option("--headed", "Run browser in headed mode for debugging", false)
  .option("--force", "Bypass consecutive failure guard", false)
  .action(async (opts: { profile: string; headed: boolean; force: boolean }) => {
    const config = loadConfig();
    if (opts.headed) {
      config.headless = false;
    }
    const { browserProfileDir, store } = getStore(opts.profile, config);

    // Jitter: random delay when run by scheduler (non-TTY)
    if (!process.stdout.isTTY && config.sync.jitterMinutes > 0) {
      const jitterMs = Math.floor(
        Math.random() * config.sync.jitterMinutes * 60 * 1000,
      );
      console.log(`Jitter delay: ${Math.round(jitterMs / 1000)}s`);
      await new Promise((resolve) => setTimeout(resolve, jitterMs));
    }

    console.log(`Pulling for profile: ${opts.profile}`);
    const result = await pull(browserProfileDir, config, store, opts.profile, {
      force: opts.force,
    });

    if (result.success) {
      console.log("Pull complete.");
    } else {
      console.error("Pull failed:", result.error);
      process.exitCode = 1;
    }
  });
```

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit 2>&1`

Expected: No errors.

- [ ] **Step 3: Run all tests**

Run: `npx vitest run 2>&1 | tail -20`

Expected: All tests pass (pull tests + existing store/diff/config/parser tests).

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts && git commit -m "feat: add --force flag to pull command"
```

---

### Task 5: Verify All Tests Pass

The existing config tests (`tests/config.test.ts`) compare against the imported `DEFAULT_CONFIG` object, so they automatically reflect the updated shape — no manual changes needed.

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run 2>&1 | tail -30`

Expected: All tests pass — store, diff, config, parser, and the new pull tests.

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit 2>&1`

Expected: No type errors.

---

### Task 6: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Remove notification references and update failure behavior description**

In `CLAUDE.md`, make these changes:

1. In the project overview paragraph, remove "and osascript for notifications" from the sentence about target platform.
2. In the "Supporting Modules" section, delete the `notifications.ts` bullet entirely.
3. In the "Key Design Decisions" section, update the "Consecutive failure counter triggers notifications after threshold" text to: "**Consecutive failure guard**: After `maxConsecutiveFailures` (default: 2) consecutive session failures, `pull()` exits early without launching a browser. Use `--force` to bypass."
4. Remove `config.notifications` from any references to the config structure.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md && git commit -m "docs: update CLAUDE.md to reflect notification removal and failure guard"
```
