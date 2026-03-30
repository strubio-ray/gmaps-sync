import type { Place, EnrichedData } from "./types.js";
import type { Store } from "./store.js";

export function shouldEnrich(place: Place, force: boolean): boolean {
  if (force) return true;
  return place.enriched === null;
}

interface PlaceDetailsResponse {
  result?: {
    formatted_address?: string;
    formatted_phone_number?: string;
    rating?: number;
    price_level?: number;
    types?: string[];
  };
  status: string;
}

const PRICE_LEVEL_MAP: Record<number, string> = {
  0: "Free",
  1: "Inexpensive",
  2: "Moderate",
  3: "Expensive",
  4: "Very Expensive",
};

async function fetchPlaceDetails(
  placeId: string,
  apiKey: string,
): Promise<EnrichedData | null> {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=formatted_address,formatted_phone_number,rating,price_level,types&key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Places API returned ${response.status}: ${response.statusText}`);
  }

  const data = (await response.json()) as PlaceDetailsResponse;
  if (data.status !== "OK") {
    if (data.status === "NOT_FOUND") return null;
    throw new Error(`Places API error: ${data.status}`);
  }

  const result = data.result;
  if (!result) return null;

  return {
    address: result.formatted_address ?? "",
    phone: result.formatted_phone_number ?? null,
    rating: result.rating ?? null,
    priceLevel: result.price_level !== undefined
      ? PRICE_LEVEL_MAP[result.price_level] ?? null
      : null,
    category: result.types?.[0] ?? null,
    enrichedAt: new Date().toISOString(),
  };
}

export interface EnrichResult {
  enriched: number;
  skipped: number;
  failed: number;
}

export async function enrichPlaces(
  store: Store,
  apiKey: string,
  placeIds: string[],
  force: boolean,
): Promise<EnrichResult> {
  const result: EnrichResult = { enriched: 0, skipped: 0, failed: 0 };

  for (const id of placeIds) {
    const place = await store.readPlace(id);
    if (!place) {
      console.warn(`Place ${id} not found, skipping.`);
      result.skipped++;
      continue;
    }

    if (!shouldEnrich(place, force)) {
      result.skipped++;
      continue;
    }

    try {
      console.log(`Enriching: ${place.name} (${id})...`);
      // New placeId format (numeric pair) is not a valid Google Places API place_id.
      // Enrichment is disabled until a lookup strategy using placeRef or name+coords is implemented.
      console.warn(`  Skipped: enrichment not yet supported with new place ID format`);
      result.skipped++;
    } catch (error) {
      console.error(`  Failed to enrich ${place.name}:`, error);
      result.failed++;
    }
  }

  return result;
}
