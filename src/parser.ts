import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ParsedList, ParsedPlace } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface SchemaEntry {
  [key: string]: string;
}

interface SchemaSection {
  root: string;
  entries: string;
  entry: SchemaEntry;
}

interface Schema {
  version: number;
  responsePrefix: string;
  lists: SchemaSection;
  places: SchemaSection;
}

function loadSchema(): Schema {
  const schemaPath = join(__dirname, "..", "schema.json");
  return JSON.parse(readFileSync(schemaPath, "utf-8"));
}

const schema = loadSchema();

/**
 * Strip the XSSI prefix Google prepends to JSON responses.
 * The prefix is )]}' followed by a newline.
 */
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

/**
 * Walk a nested array/object using a bracket path like "[0][1][5]".
 * Returns the value at that path, or undefined if the path doesn't exist.
 */
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

/**
 * Walk a path and throw a descriptive error if the result is undefined
 * or doesn't match the expected type.
 */
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
    throw new Error(
      `${fieldName}: expected ${expectedType} at ${path}, got ${typeof result}`,
    );
  }
  return result;
}

export function parseLists(raw: string): ParsedList[] {
  const json = JSON.parse(stripXssiPrefix(raw));
  const root = walkPath(json, schema.lists.root);
  if (root === undefined) {
    throw new Error(`lists.root: no data at ${schema.lists.root}`);
  }

  const entriesRelPath = schema.lists.entries.replace(schema.lists.root, "");
  const entries = walkPath(root, entriesRelPath);
  if (!Array.isArray(entries)) {
    throw new Error(
      `lists.entries: expected array at ${schema.lists.entries}, got ${typeof entries}`,
    );
  }

  return entries.map((entry: unknown, i: number) => {
    const e = schema.lists.entry;
    return {
      id: walkPathRequired(entry, e.id, `lists[${i}].id`, "string") as string,
      name: walkPathRequired(entry, e.name, `lists[${i}].name`, "string") as string,
      type: walkPathRequired(entry, e.type, `lists[${i}].type`, "string") as string,
      count: walkPathRequired(entry, e.count, `lists[${i}].count`, "number") as number,
    };
  });
}

export function parsePlaces(raw: string): ParsedPlace[] {
  const json = JSON.parse(stripXssiPrefix(raw));
  const root = walkPath(json, schema.places.root);
  if (root === undefined) {
    throw new Error(`places.root: no data at ${schema.places.root}`);
  }

  const entriesRelPath = schema.places.entries.replace(schema.places.root, "");
  const entries = walkPath(root, entriesRelPath);
  if (!Array.isArray(entries)) {
    throw new Error(
      `places.entries: expected array at ${schema.places.entries}, got ${typeof entries}`,
    );
  }

  return entries.map((entry: unknown, i: number) => {
    const e = schema.places.entry;
    return {
      name: walkPathRequired(entry, e.name, `places[${i}].name`, "string") as string,
      lat: walkPathRequired(entry, e.lat, `places[${i}].lat`, "number") as number,
      lng: walkPathRequired(entry, e.lng, `places[${i}].lng`, "number") as number,
      googleMapsUrl: walkPathRequired(
        entry,
        e.googleMapsUrl,
        `places[${i}].googleMapsUrl`,
        "string",
      ) as string,
      comment: walkPathRequired(entry, e.comment, `places[${i}].comment`) as string | null,
      placeId: walkPathRequired(entry, e.placeId, `places[${i}].placeId`, "string") as string,
    };
  });
}

export function getSchemaVersion(): number {
  return schema.version;
}
