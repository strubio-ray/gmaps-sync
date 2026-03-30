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
