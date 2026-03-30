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
