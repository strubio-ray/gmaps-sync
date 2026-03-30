import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import writeFileAtomic from "write-file-atomic";
import type { Place, ListMetadata, SyncState } from "./types.js";

export class Store {
  constructor(private readonly dataDir: string) {}

  async init(): Promise<void> {
    mkdirSync(join(this.dataDir, "places"), { recursive: true });
    mkdirSync(join(this.dataDir, "snapshots"), { recursive: true });
  }

  // --- Lists ---

  async readLists(): Promise<ListMetadata[]> {
    const path = join(this.dataDir, "lists.json");
    if (!existsSync(path)) return [];
    return JSON.parse(readFileSync(path, "utf-8"));
  }

  async writeLists(lists: ListMetadata[]): Promise<void> {
    const path = join(this.dataDir, "lists.json");
    await writeFileAtomic(path, JSON.stringify(lists, null, 2) + "\n");
  }

  // --- Places ---

  async readPlace(id: string): Promise<Place | null> {
    const path = join(this.dataDir, "places", `${id}.json`);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8"));
  }

  async writePlace(place: Place): Promise<void> {
    const path = join(this.dataDir, "places", `${place.id}.json`);
    await writeFileAtomic(path, JSON.stringify(place, null, 2) + "\n");
  }

  async deletePlace(id: string): Promise<void> {
    const path = join(this.dataDir, "places", `${id}.json`);
    unlinkSync(path);
  }

  async listPlaceIds(): Promise<string[]> {
    const dir = join(this.dataDir, "places");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""));
  }

  async readAllPlaces(): Promise<Place[]> {
    const ids = await this.listPlaceIds();
    const places: Place[] = [];
    for (const id of ids) {
      const place = await this.readPlace(id);
      if (place) places.push(place);
    }
    return places;
  }

  // --- Sync State ---

  async readSyncState(profile: string): Promise<SyncState> {
    const path = join(this.dataDir, "sync-state.json");
    if (!existsSync(path)) {
      return {
        lastPull: null,
        lastPullStatus: "success",
        schemaVersion: 1,
        consecutiveFailures: 0,
        profile,
      };
    }
    return JSON.parse(readFileSync(path, "utf-8"));
  }

  async writeSyncState(state: SyncState): Promise<void> {
    const path = join(this.dataDir, "sync-state.json");
    await writeFileAtomic(path, JSON.stringify(state, null, 2) + "\n");
  }

  // --- Snapshots ---

  async saveSnapshot(listId: string, rawData: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${timestamp}-${listId}.json`;
    const path = join(this.dataDir, "snapshots", filename);
    await writeFileAtomic(path, rawData);
    return path;
  }

  async cleanOldSnapshots(retentionDays: number): Promise<number> {
    const dir = join(this.dataDir, "snapshots");
    if (!existsSync(dir)) return 0;

    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const files = readdirSync(dir);
    let removed = 0;

    for (const file of files) {
      const path = join(dir, file);
      const dateStr = file.split("T")[0];
      const fileDate = new Date(dateStr).getTime();
      if (!isNaN(fileDate) && fileDate < cutoff) {
        unlinkSync(path);
        removed++;
      }
    }

    return removed;
  }
}
