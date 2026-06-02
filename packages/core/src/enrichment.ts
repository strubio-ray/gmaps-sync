import { eq, isNull } from "drizzle-orm";
import type { Db } from "./db.js";
import { places } from "./schema.js";

export interface PlacesApiClient {
  findPlace(name: string, lat: number, lng: number): Promise<{ googlePlaceId: string } | null>;
  getPlaceDetails(googlePlaceId: string): Promise<PlaceDetailsResult>;
}

export type PlaceDetailsResult = {
  rating: number | null;
  userRatingCount: number | null;
  priceLevel: number | null;
  primaryType: string | null;
  types: string[] | null;
  editorialSummary: string | null;
  reviewsText: string | null;
  generativeSummary: string | null;
  servesBreakfast: number | null;
  servesLunch: number | null;
  servesDinner: number | null;
  servesBrunch: number | null;
  servesBeer: number | null;
  servesWine: number | null;
  servesCocktails: number | null;
  servesCoffee: number | null;
  servesDessert: number | null;
  servesVegetarianFood: number | null;
  outdoorSeating: number | null;
  liveMusic: number | null;
  goodForChildren: number | null;
  goodForGroups: number | null;
  allowsDogs: number | null;
  dineIn: number | null;
  delivery: number | null;
  takeout: number | null;
  businessStatus: string | null;
  websiteUri: string | null;
  phoneNumber: string | null;
};

function isLegacyId(googlePlaceId: string): boolean {
  return googlePlaceId.startsWith("-");
}

export async function enrichUnenrichedPlaces(
  db: Db,
  client: PlacesApiClient,
): Promise<{ enriched: number; failed: number }> {
  const unenriched = await db.select().from(places).where(isNull(places.enrichedAt));

  let enriched = 0;
  let failed = 0;

  for (const place of unenriched) {
    const now = new Date().toISOString();
    let resolvedId = place.googlePlaceId;

    if (isLegacyId(place.googlePlaceId)) {
      const found = await client.findPlace(place.name, place.lat, place.lng);
      if (!found) {
        // Mark as failed: set enrichedAt but leave enrichment fields null
        await db
          .update(places)
          .set({ enrichedAt: now })
          .where(eq(places.googlePlaceId, place.googlePlaceId));
        failed++;
        continue;
      }
      resolvedId = found.googlePlaceId;

      // Update the PK via raw SQL and cascade FK references
      // We need to access the underlying sqlite instance through Drizzle's internals.
      // Use Drizzle's prepared statement approach by running raw SQL via the db's session.
      const session = (db as unknown as { session: { client: import("better-sqlite3").Database } })
        .session;
      const sqlite = session.client;

      sqlite
        .prepare("UPDATE sync_metadata SET google_place_id = ? WHERE google_place_id = ?")
        .run(resolvedId, place.googlePlaceId);
      sqlite
        .prepare("UPDATE place_lists SET google_place_id = ? WHERE google_place_id = ?")
        .run(resolvedId, place.googlePlaceId);
      sqlite
        .prepare("UPDATE places SET google_place_id = ? WHERE google_place_id = ?")
        .run(resolvedId, place.googlePlaceId);
    }

    const details = await client.getPlaceDetails(resolvedId);

    await db
      .update(places)
      .set({
        rating: details.rating,
        userRatingCount: details.userRatingCount,
        priceLevel: details.priceLevel,
        primaryType: details.primaryType,
        types: details.types ? JSON.stringify(details.types) : null,
        editorialSummary: details.editorialSummary,
        reviewsText: details.reviewsText,
        generativeSummary: details.generativeSummary,
        servesBreakfast: details.servesBreakfast,
        servesLunch: details.servesLunch,
        servesDinner: details.servesDinner,
        servesBrunch: details.servesBrunch,
        servesBeer: details.servesBeer,
        servesWine: details.servesWine,
        servesCocktails: details.servesCocktails,
        servesCoffee: details.servesCoffee,
        servesDessert: details.servesDessert,
        servesVegetarianFood: details.servesVegetarianFood,
        outdoorSeating: details.outdoorSeating,
        liveMusic: details.liveMusic,
        goodForChildren: details.goodForChildren,
        goodForGroups: details.goodForGroups,
        allowsDogs: details.allowsDogs,
        dineIn: details.dineIn,
        delivery: details.delivery,
        takeout: details.takeout,
        businessStatus: details.businessStatus,
        websiteUri: details.websiteUri,
        phoneNumber: details.phoneNumber,
        enrichedAt: now,
      })
      .where(eq(places.googlePlaceId, resolvedId));

    enriched++;
  }

  return { enriched, failed };
}
