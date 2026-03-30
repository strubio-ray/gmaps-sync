import { createHash } from "node:crypto";
import type { ParsedPlace, ParsedList, Place, ListMetadata } from "./types.js";
import type { Store } from "./store.js";

export interface DiffResult {
  added: number;
  updated: number;
  unchanged: number;
  flaggedRemoved: number;
}

/**
 * Compute a SHA-256 content hash of an object.
 * Used to detect changes without comparing every field.
 */
export function computeContentHash(data: Record<string, unknown>): string {
  const normalized = JSON.stringify(data, Object.keys(data).sort());
  const hash = createHash("sha256").update(normalized).digest("hex");
  return `sha256:${hash}`;
}

export async function applyDiff(
  store: Store,
  remoteLists: ParsedList[],
  remotePlaces: ParsedPlace[],
  listPlaceMap: Map<string, string[]>,
): Promise<DiffResult> {
  const now = new Date().toISOString();
  const result: DiffResult = { added: 0, updated: 0, unchanged: 0, flaggedRemoved: 0 };

  // Load all local places once to avoid N+1 reads
  const allLocalPlaces = await store.readAllPlaces();
  const localPlaceMap = new Map(allLocalPlaces.map((p) => [p.id, p]));

  // --- Diff lists ---
  const existingLists = await store.readLists();
  const remoteListIds = new Set(remoteLists.map((l) => l.id));

  const updatedLists: ListMetadata[] = [];

  for (const remote of remoteLists) {
    if (remote.id === null) continue; // Skip built-in lists with no ID
    updatedLists.push({
      id: remote.id,
      name: remote.name,
      type: remote.type,
      count: remote.count,
      lastSeenRemote: now,
      removedRemote: false,
    });
  }

  // Flag removed lists
  for (const existing of existingLists) {
    if (!remoteListIds.has(existing.id)) {
      if (!existing.removedRemote) {
        existing.removedRemote = true;
      }
      updatedLists.push(existing);
    }
  }

  await store.writeLists(updatedLists);

  // --- Diff places ---
  // Build a map: placeId → list of list IDs it belongs to
  const placeToLists = new Map<string, string[]>();
  for (const [listId, placeIds] of listPlaceMap) {
    for (const placeId of placeIds) {
      const existing = placeToLists.get(placeId) ?? [];
      existing.push(listId);
      placeToLists.set(placeId, existing);
    }
  }

  const remotePlaceIds = new Set(remotePlaces.map((p) => p.placeId));

  for (const remote of remotePlaces) {
    const contentData: Record<string, unknown> = {
      name: remote.name,
      lat: remote.lat,
      lng: remote.lng,
      address: remote.address,
      comment: remote.comment,
      placeId: remote.placeId,
    };
    const newHash = computeContentHash(contentData);

    const existing = localPlaceMap.get(remote.placeId) ?? null;

    if (!existing) {
      // New place
      const place: Place = {
        id: remote.placeId,
        name: remote.name,
        coordinates: { lat: remote.lat, lng: remote.lng },
        address: remote.address,
        lists: placeToLists.get(remote.placeId) ?? [],
        comment: remote.comment,
        source: "pull",
        contentHash: newHash,
        firstSeen: now,
        lastSeenRemote: now,
        removedRemote: false,
      };
      await store.writePlace(place);
      result.added++;
    } else if (existing.contentHash !== newHash) {
      // Updated place
      existing.name = remote.name;
      existing.coordinates = { lat: remote.lat, lng: remote.lng };
      existing.address = remote.address;
      existing.comment = remote.comment;
      existing.lists = placeToLists.get(remote.placeId) ?? existing.lists;
      existing.contentHash = newHash;
      existing.lastSeenRemote = now;
      existing.removedRemote = false;
      await store.writePlace(existing);
      result.updated++;
    } else {
      // Unchanged — just update lastSeenRemote
      existing.lastSeenRemote = now;
      existing.removedRemote = false;
      existing.lists = placeToLists.get(remote.placeId) ?? existing.lists;
      await store.writePlace(existing);
      result.unchanged++;
    }
  }

  // Flag places missing from remote
  for (const [localId, place] of localPlaceMap) {
    if (!remotePlaceIds.has(localId)) {
      if (!place.removedRemote) {
        place.removedRemote = true;
        await store.writePlace(place);
        result.flaggedRemoved++;
      }
    }
  }

  return result;
}
