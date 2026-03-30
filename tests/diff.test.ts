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
