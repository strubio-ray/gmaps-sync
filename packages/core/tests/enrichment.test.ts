import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb } from "../src/db.js";
import { enrichUnenrichedPlaces, type PlacesApiClient } from "../src/enrichment.js";
import { runMigrations } from "../src/migrate.js";
import { places } from "../src/schema.js";

function makeMockClient(overrides?: Partial<PlacesApiClient>): PlacesApiClient {
  return {
    findPlace: vi.fn().mockResolvedValue({ googlePlaceId: "ChIJ_resolved_123" }),
    getPlaceDetails: vi.fn().mockResolvedValue({
      rating: 4.5,
      userRatingCount: 200,
      priceLevel: 2,
      primaryType: "italian_restaurant",
      types: ["restaurant", "food"],
      editorialSummary: "A cozy Italian spot",
      reviewsText: "Great pasta.",
      generativeSummary: null,
      servesBreakfast: 0,
      servesLunch: 1,
      servesDinner: 1,
      servesBrunch: 0,
      servesBeer: 1,
      servesWine: 1,
      servesCocktails: 1,
      servesCoffee: 0,
      servesDessert: 1,
      servesVegetarianFood: 1,
      outdoorSeating: 1,
      liveMusic: 0,
      goodForChildren: 0,
      goodForGroups: 1,
      allowsDogs: 0,
      dineIn: 1,
      delivery: 1,
      takeout: 1,
      businessStatus: "OPERATIONAL",
      websiteUri: "https://example.com",
      phoneNumber: "+1234567890",
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
    db = created.db;
    sqlite = created.sqlite;
    runMigrations(sqlite);
  });

  afterEach(() => {
    sqlite.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("enriches unenriched places", async () => {
    const now = new Date().toISOString();
    db.insert(places)
      .values({
        googlePlaceId: "-123_-456",
        legacyId: "-123_-456",
        name: "Test Place",
        lat: 29.75,
        lng: -95.37,
        contentHash: "sha256:abc",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const client = makeMockClient();
    const result = await enrichUnenrichedPlaces(db, client);
    expect(result.enriched).toBe(1);
    expect(result.failed).toBe(0);
  });

  it("skips already enriched places", async () => {
    const now = new Date().toISOString();
    db.insert(places)
      .values({
        googlePlaceId: "ChIJ_already",
        name: "Done",
        lat: 0,
        lng: 0,
        contentHash: "sha256:x",
        createdAt: now,
        updatedAt: now,
        enrichedAt: now,
      })
      .run();

    const client = makeMockClient();
    const result = await enrichUnenrichedPlaces(db, client);
    expect(result.enriched).toBe(0);
    expect(client.findPlace).not.toHaveBeenCalled();
  });

  it("marks failed lookups with enriched_at but null fields", async () => {
    const now = new Date().toISOString();
    db.insert(places)
      .values({
        googlePlaceId: "-bad_-id",
        legacyId: "-bad_-id",
        name: "Unknown",
        lat: 0,
        lng: 0,
        contentHash: "sha256:y",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const client = makeMockClient({ findPlace: vi.fn().mockResolvedValue(null) });
    const result = await enrichUnenrichedPlaces(db, client);
    expect(result.failed).toBe(1);

    const place = db.select().from(places).where(eq(places.googlePlaceId, "-bad_-id")).get();
    expect(place?.enrichedAt).toBeTruthy();
    expect(place?.rating).toBeNull();
  });
});
