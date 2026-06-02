import { createHash } from "node:crypto";
import type { Db, ParsedList, ParsedPlace } from "@gmaps/core";
import { lists, pendingMutations, placeLists, places, syncMetadata } from "@gmaps/core";
import { eq, inArray } from "drizzle-orm";

export interface DiffResult {
  added: number;
  updated: number;
  unchanged: number;
  flaggedRemoved: number;
  skippedPending: number;
}

export function computeContentHash(data: Record<string, unknown>): string {
  const normalized = JSON.stringify(data, Object.keys(data).sort());
  const hash = createHash("sha256").update(normalized).digest("hex");
  return `sha256:${hash}`;
}

export function applyDiff(
  db: Db,
  remoteLists: ParsedList[],
  remotePlaces: ParsedPlace[],
  listPlaceMap: Map<string, string[]>,
): DiffResult {
  const now = new Date().toISOString();
  const result: DiffResult = {
    added: 0,
    updated: 0,
    unchanged: 0,
    flaggedRemoved: 0,
    skippedPending: 0,
  };

  // Get place IDs with pending mutations
  const pendingPlaceIds = new Set(
    db
      .select({ placeId: pendingMutations.placeId })
      .from(pendingMutations)
      .where(inArray(pendingMutations.status, ["pending", "in_progress"]))
      .all()
      .filter((row): row is { placeId: string } => row.placeId !== null)
      .map((row) => row.placeId),
  );

  // --- Diff lists ---
  const existingLists = db.select().from(lists).all();
  const existingListIds = new Set(existingLists.map((l) => l.id));
  const remoteListIds = new Set(
    remoteLists.filter((l): l is ParsedList & { id: string } => l.id !== null).map((l) => l.id),
  );

  for (const remote of remoteLists) {
    if (remote.id === null) continue;
    if (existingListIds.has(remote.id)) {
      db.update(lists)
        .set({ name: remote.name, type: remote.type, lastSeenRemote: now, removedRemote: 0 })
        .where(eq(lists.id, remote.id))
        .run();
    } else {
      db.insert(lists)
        .values({
          id: remote.id,
          name: remote.name,
          type: remote.type,
          lastSeenRemote: now,
          removedRemote: 0,
        })
        .run();
    }
  }

  for (const existing of existingLists) {
    if (!remoteListIds.has(existing.id) && !existing.removedRemote) {
      db.update(lists).set({ removedRemote: 1 }).where(eq(lists.id, existing.id)).run();
    }
  }

  // --- Diff places ---
  const placeToLists = new Map<string, string[]>();
  for (const [listId, placeIds] of listPlaceMap) {
    for (const placeId of placeIds) {
      const existing = placeToLists.get(placeId) ?? [];
      existing.push(listId);
      placeToLists.set(placeId, existing);
    }
  }

  const allLocalPlaces = db.select().from(places).all();
  const localPlaceMap = new Map(allLocalPlaces.map((p) => [p.legacyId ?? p.googlePlaceId, p]));
  const remotePlaceIds = new Set(remotePlaces.map((p) => p.placeId));

  for (const remote of remotePlaces) {
    if (pendingPlaceIds.has(remote.placeId)) {
      result.skippedPending++;
      continue;
    }

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
    const listIds = placeToLists.get(remote.placeId) ?? [];

    if (!existing) {
      db.insert(places)
        .values({
          googlePlaceId: remote.placeId,
          legacyId: remote.placeId,
          name: remote.name,
          lat: remote.lat,
          lng: remote.lng,
          address: remote.address,
          comment: remote.comment,
          contentHash: newHash,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      db.insert(syncMetadata)
        .values({
          googlePlaceId: remote.placeId,
          source: "pull",
          firstSeen: now,
          lastSeenRemote: now,
          removedRemote: 0,
        })
        .run();

      for (const listId of listIds) {
        db.insert(placeLists)
          .values({ googlePlaceId: remote.placeId, listId })
          .onConflictDoNothing()
          .run();
      }
      result.added++;
    } else if (existing.contentHash !== newHash) {
      db.update(places)
        .set({
          name: remote.name,
          lat: remote.lat,
          lng: remote.lng,
          address: remote.address,
          comment: remote.comment,
          contentHash: newHash,
          updatedAt: now,
        })
        .where(eq(places.googlePlaceId, existing.googlePlaceId))
        .run();

      db.update(syncMetadata)
        .set({ lastSeenRemote: now, removedRemote: 0 })
        .where(eq(syncMetadata.googlePlaceId, existing.googlePlaceId))
        .run();

      db.delete(placeLists).where(eq(placeLists.googlePlaceId, existing.googlePlaceId)).run();
      for (const listId of listIds) {
        db.insert(placeLists)
          .values({ googlePlaceId: existing.googlePlaceId, listId })
          .onConflictDoNothing()
          .run();
      }
      result.updated++;
    } else {
      db.update(syncMetadata)
        .set({ lastSeenRemote: now, removedRemote: 0 })
        .where(eq(syncMetadata.googlePlaceId, existing.googlePlaceId))
        .run();

      db.delete(placeLists).where(eq(placeLists.googlePlaceId, existing.googlePlaceId)).run();
      for (const listId of listIds) {
        db.insert(placeLists)
          .values({ googlePlaceId: existing.googlePlaceId, listId })
          .onConflictDoNothing()
          .run();
      }
      result.unchanged++;
    }
  }

  // Flag places missing from remote
  for (const [legacyId, place] of localPlaceMap) {
    if (!remotePlaceIds.has(legacyId) && !pendingPlaceIds.has(legacyId)) {
      const syncMeta = db
        .select()
        .from(syncMetadata)
        .where(eq(syncMetadata.googlePlaceId, place.googlePlaceId))
        .get();
      if (syncMeta && !syncMeta.removedRemote) {
        db.update(syncMetadata)
          .set({ removedRemote: 1 })
          .where(eq(syncMetadata.googlePlaceId, place.googlePlaceId))
          .run();
        result.flaggedRemoved++;
      }
    }
  }

  return result;
}
