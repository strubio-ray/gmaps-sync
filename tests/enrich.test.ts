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
