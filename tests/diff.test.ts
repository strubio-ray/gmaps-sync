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

    const result = await applyDiff(store, remoteLists, remotePlaces, listPlaceMap);

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

    const result = await applyDiff(store, [], remotePlaces, listPlaceMap);
    expect(result.updated).toBe(1);

    const updated = await store.readPlace("ChIJ_a");
    expect(updated!.name).toBe("New Name");
    expect(updated!.comment).toBe("Added a comment");
    expect(updated!.firstSeen).toBe("2026-03-28T12:00:00Z");
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

    const result = await applyDiff(store, [], [], new Map());
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

    const result = await applyDiff(store, [], [], new Map());
    expect(result.flaggedRemoved).toBe(0);
  });

  it("updates lists metadata", async () => {
    const remoteLists: ParsedList[] = [
      { id: "list_new", name: "New List", type: "CUSTOM", count: 3 },
    ];

    await applyDiff(store, remoteLists, [], new Map());

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

    await applyDiff(store, [], [], new Map());

    const lists = await store.readLists();
    expect(lists[0].removedRemote).toBe(true);
  });
});
