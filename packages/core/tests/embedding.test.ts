import { describe, expect, it } from "vitest";
import { buildEmbeddingText } from "../src/embedding.js";

describe("buildEmbeddingText", () => {
  it("builds rich text for enriched place", () => {
    const text = buildEmbeddingText({
      name: "Osteria",
      address: "1234 Walnut St, Philadelphia",
      primaryType: "italian_restaurant",
      editorialSummary: "Upscale Italian dining",
      reviewsText: "Amazing pasta. Romantic atmosphere.",
      servesBreakfast: 0,
      servesLunch: 1,
      servesDinner: 1,
      servesBrunch: 0,
      servesBeer: 1,
      servesWine: 1,
      servesCocktails: 1,
      servesCoffee: 0,
      outdoorSeating: 1,
      liveMusic: 0,
      goodForChildren: 0,
      goodForGroups: 1,
      allowsDogs: 0,
      dineIn: 1,
    });

    expect(text).toContain("Osteria");
    expect(text).toContain("italian restaurant");
    expect(text).toContain("Upscale Italian dining");
    expect(text).toContain("outdoor seating");
    expect(text).toContain("good for groups");
  });

  it("falls back to name + address for unenriched place", () => {
    const text = buildEmbeddingText({
      name: "Cool Bar",
      address: "456 Main St, Austin",
      primaryType: null,
      editorialSummary: null,
      reviewsText: null,
      servesBreakfast: null,
      servesLunch: null,
      servesDinner: null,
      servesBrunch: null,
      servesBeer: null,
      servesWine: null,
      servesCocktails: null,
      servesCoffee: null,
      outdoorSeating: null,
      liveMusic: null,
      goodForChildren: null,
      goodForGroups: null,
      allowsDogs: null,
      dineIn: null,
    });

    expect(text).toBe("Cool Bar. 456 Main St, Austin.");
  });
});
