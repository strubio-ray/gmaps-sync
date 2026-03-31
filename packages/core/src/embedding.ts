import { isNull, eq } from "drizzle-orm";
import type { Database } from "better-sqlite3";
import type { Db } from "./db.js";
import { places } from "./schema.js";

export interface EmbeddingModel {
  embed(text: string): Promise<Float32Array>;
}

export interface EmbeddingInput {
  name: string;
  address: string;
  primaryType: string | null;
  editorialSummary: string | null;
  reviewsText: string | null;
  servesBreakfast: number | null;
  servesLunch: number | null;
  servesDinner: number | null;
  servesBrunch: number | null;
  servesBeer: number | null;
  servesWine: number | null;
  servesCocktails: number | null;
  servesCoffee: number | null;
  outdoorSeating: number | null;
  liveMusic: number | null;
  goodForChildren: number | null;
  goodForGroups: number | null;
  allowsDogs: number | null;
  dineIn: number | null;
}

const BOOLEAN_LABELS: Array<[keyof EmbeddingInput, string]> = [
  ["servesBreakfast", "serves breakfast"],
  ["servesLunch", "serves lunch"],
  ["servesDinner", "serves dinner"],
  ["servesBrunch", "serves brunch"],
  ["servesBeer", "serves beer"],
  ["servesWine", "serves wine"],
  ["servesCocktails", "serves cocktails"],
  ["servesCoffee", "serves coffee"],
  ["outdoorSeating", "outdoor seating"],
  ["liveMusic", "live music"],
  ["goodForChildren", "good for children"],
  ["goodForGroups", "good for groups"],
  ["allowsDogs", "allows dogs"],
  ["dineIn", "dine in"],
];

export function buildEmbeddingText(place: EmbeddingInput): string {
  // Unenriched: only name and address available
  if (!place.primaryType && !place.editorialSummary && !place.reviewsText) {
    const allBooleanNull = BOOLEAN_LABELS.every(([key]) => place[key] === null);
    if (allBooleanNull) {
      return `${place.name}. ${place.address}.`;
    }
  }

  const parts: string[] = [place.name];

  if (place.primaryType) {
    parts.push(place.primaryType.replace(/_/g, " "));
  }

  if (place.editorialSummary) {
    parts.push(place.editorialSummary);
  }

  if (place.reviewsText) {
    parts.push(place.reviewsText);
  }

  const activeLabels = BOOLEAN_LABELS
    .filter(([key]) => place[key] === 1)
    .map(([, label]) => label);

  if (activeLabels.length > 0) {
    parts.push(activeLabels.join(", "));
  }

  return parts.join(". ");
}

export function ensureVecTable(sqlite: Database): void {
  sqlite
    .prepare(
      `CREATE VIRTUAL TABLE IF NOT EXISTS places_vec USING vec0(
        google_place_id TEXT PRIMARY KEY,
        embedding float[384]
      )`,
    )
    .run();
}

export async function embedUnembeddedPlaces(
  db: Db,
  sqlite: Database,
  model: EmbeddingModel,
): Promise<{ embedded: number; failed: number }> {
  const unenriched = await db
    .select()
    .from(places)
    .where(isNull(places.embeddedAt));

  // Filter to only enriched places (enriched_at IS NOT NULL)
  const toEmbed = unenriched.filter((p) => p.enrichedAt !== null);

  let embedded = 0;
  let failed = 0;

  const insertVec = sqlite.prepare(
    `INSERT OR REPLACE INTO places_vec(google_place_id, embedding) VALUES (?, ?)`,
  );

  for (const place of toEmbed) {
    try {
      const text = buildEmbeddingText({
        name: place.name,
        address: place.address,
        primaryType: place.primaryType ?? null,
        editorialSummary: place.editorialSummary ?? null,
        reviewsText: place.reviewsText ?? null,
        servesBreakfast: place.servesBreakfast ?? null,
        servesLunch: place.servesLunch ?? null,
        servesDinner: place.servesDinner ?? null,
        servesBrunch: place.servesBrunch ?? null,
        servesBeer: place.servesBeer ?? null,
        servesWine: place.servesWine ?? null,
        servesCocktails: place.servesCocktails ?? null,
        servesCoffee: place.servesCoffee ?? null,
        outdoorSeating: place.outdoorSeating ?? null,
        liveMusic: place.liveMusic ?? null,
        goodForChildren: place.goodForChildren ?? null,
        goodForGroups: place.goodForGroups ?? null,
        allowsDogs: place.allowsDogs ?? null,
        dineIn: place.dineIn ?? null,
      });

      const vector = await model.embed(text);
      insertVec.run(place.googlePlaceId, Buffer.from(vector.buffer));

      const now = new Date().toISOString();
      await db
        .update(places)
        .set({ embeddedAt: now })
        .where(eq(places.googlePlaceId, place.googlePlaceId));

      embedded++;
    } catch {
      failed++;
    }
  }

  return { embedded, failed };
}
