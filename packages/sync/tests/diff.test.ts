import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ParsedList, ParsedPlace } from "@gmaps/core";
import {
  createDb,
  pendingMutations,
  placeLists,
  places,
  runMigrations,
  syncMetadata,
} from "@gmaps/core";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyDiff, computeContentHash } from "../src/diff.js";

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
    const remotePlaces: ParsedPlace[] = [
      {
        name: "Cafe A",
        lat: 29.75,
        lng: -95.37,
        address: "123 Main St",
        comment: null,
        placeId: "-123_-456",
        placeRef: "/g/test",
      },
    ];
    const remoteLists: ParsedList[] = [{ id: "list_1", name: "Favorites", type: 2, count: 1 }];
    const listPlaceMap = new Map([["list_1", ["-123_-456"]]]);

    const result = applyDiff(db, remoteLists, remotePlaces, listPlaceMap);
    expect(result.added).toBe(1);

    const place = db.select().from(places).where(eq(places.googlePlaceId, "-123_-456")).get();
    expect(place?.name).toBe("Cafe A");
    expect(place?.legacyId).toBe("-123_-456");

    const placeListRows = db.select().from(placeLists).all();
    expect(placeListRows).toHaveLength(1);
    expect(placeListRows[0].listId).toBe("list_1");
  });

  it("flags places missing from remote", () => {
    const now = new Date().toISOString();
    db.insert(places)
      .values({
        googlePlaceId: "-789_-012",
        legacyId: "-789_-012",
        name: "Gone",
        lat: 0,
        lng: 0,
        contentHash: "sha256:x",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(syncMetadata)
      .values({
        googlePlaceId: "-789_-012",
        source: "pull",
        firstSeen: now,
        removedRemote: 0,
      })
      .run();

    const result = applyDiff(db, [], [], new Map());
    expect(result.flaggedRemoved).toBe(1);
  });

  it("skips places with pending mutations", () => {
    const now = new Date().toISOString();
    db.insert(places)
      .values({
        googlePlaceId: "-123_-456",
        legacyId: "-123_-456",
        name: "Locked",
        lat: 29.75,
        lng: -95.37,
        contentHash: "sha256:old",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(syncMetadata)
      .values({
        googlePlaceId: "-123_-456",
        source: "pull",
        firstSeen: now,
        removedRemote: 0,
      })
      .run();
    db.insert(pendingMutations)
      .values({
        type: "move_place_between_lists",
        status: "pending",
        placeId: "-123_-456",
        payload: "{}",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const remotePlaces: ParsedPlace[] = [
      {
        name: "Updated Name",
        lat: 29.75,
        lng: -95.37,
        address: "123 Main St",
        comment: null,
        placeId: "-123_-456",
        placeRef: null,
      },
    ];

    const result = applyDiff(db, [], remotePlaces, new Map());
    expect(result.skippedPending).toBe(1);
    expect(result.updated).toBe(0);

    const place = db.select().from(places).where(eq(places.googlePlaceId, "-123_-456")).get();
    expect(place?.name).toBe("Locked");
  });
});
