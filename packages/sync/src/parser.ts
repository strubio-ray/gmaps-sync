import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ParsedList, ParsedPlace } from "@gmaps/core";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface SchemaEntry {
  [key: string]: string;
}

interface SchemaSection {
  root: string;
  entry: SchemaEntry;
}

interface Schema {
  version: number;
  lists: SchemaSection;
  places: SchemaSection;
}

function loadSchema(): Schema {
  const schemaPath = join(__dirname, "..", "schema.json");
  return JSON.parse(readFileSync(schemaPath, "utf-8"));
}

const schema = loadSchema();

export function stripXssiPrefix(raw: string): string {
  const prefix = ")]}'";
  if (raw.startsWith(prefix)) {
    const newlineIdx = raw.indexOf("\n", prefix.length);
    if (newlineIdx !== -1) {
      return raw.slice(newlineIdx + 1);
    }
    return raw.slice(prefix.length);
  }
  return raw;
}

function walkPath(data: unknown, path: string): unknown {
  const indices = path.match(/\[(\d+)\]/g);
  if (!indices) return data;

  let current: unknown = data;
  for (const indexStr of indices) {
    const idx = parseInt(indexStr.slice(1, -1), 10);
    if (!Array.isArray(current) || idx >= current.length) {
      return undefined;
    }
    current = current[idx];
  }
  return current;
}

function walkPathRequired(
  data: unknown,
  path: string,
  fieldName: string,
  expectedType?: string,
): unknown {
  const result = walkPath(data, path);
  if (result === undefined || result === null) {
    if (expectedType) {
      throw new Error(
        `${fieldName}: expected ${expectedType} at ${path}, got ${result === null ? "null" : "undefined"}`,
      );
    }
    return null;
  }
  if (expectedType && typeof result !== expectedType) {
    throw new Error(`${fieldName}: expected ${expectedType} at ${path}, got ${typeof result}`);
  }
  return result;
}

export function extractSessionToken(url: string): string | null {
  const match = url.match(/!1s([^!]+)/);
  return match ? match[1] : null;
}

export function parseLists(raw: string): ParsedList[] {
  const json = JSON.parse(stripXssiPrefix(raw));
  const entries = walkPath(json, schema.lists.root);
  if (!Array.isArray(entries)) {
    throw new Error(`lists.root: expected array at ${schema.lists.root}, got ${typeof entries}`);
  }

  return entries.map((entry: unknown, i: number) => {
    const e = schema.lists.entry;
    return {
      id: walkPathRequired(entry, e.id, `lists[${i}].id`) as string | null,
      name: walkPathRequired(entry, e.name, `lists[${i}].name`, "string") as string,
      type: walkPathRequired(entry, e.type, `lists[${i}].type`, "number") as number,
      count: walkPathRequired(entry, e.count, `lists[${i}].count`, "number") as number,
    };
  });
}

export function parsePlaces(raw: string): ParsedPlace[] {
  const json = JSON.parse(stripXssiPrefix(raw));
  const entries = walkPath(json, schema.places.root);
  if (!Array.isArray(entries)) {
    return [];
  }

  const e = schema.places.entry;
  const results: ParsedPlace[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const idPart1 = walkPath(entry, e.placeIdPart1);
    const idPart2 = walkPath(entry, e.placeIdPart2);

    if (typeof idPart1 !== "string" || typeof idPart2 !== "string") {
      continue;
    }

    const placeRef = walkPath(entry, e.placeRef);

    results.push({
      name: walkPathRequired(entry, e.name, `places[${i}].name`, "string") as string,
      lat: walkPathRequired(entry, e.lat, `places[${i}].lat`, "number") as number,
      lng: walkPathRequired(entry, e.lng, `places[${i}].lng`, "number") as number,
      address: (walkPathRequired(entry, e.address, `places[${i}].address`) ?? "") as string,
      comment: walkPathRequired(entry, e.comment, `places[${i}].comment`) as string | null,
      placeId: `${idPart1}_${idPart2}`,
      placeRef: typeof placeRef === "string" ? placeRef : null,
    });
  }

  return results;
}

export function getSchemaVersion(): number {
  return schema.version;
}
