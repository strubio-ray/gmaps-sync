import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function saveSnapshot(snapshotsDir: string, listId: string, rawData: string): string {
  mkdirSync(snapshotsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${timestamp}-${listId}.json`;
  const path = join(snapshotsDir, filename);
  writeFileSync(path, rawData);
  return path;
}

export function cleanOldSnapshots(snapshotsDir: string, retentionDays: number): number {
  if (!existsSync(snapshotsDir)) return 0;

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const files = readdirSync(snapshotsDir);
  let removed = 0;

  for (const file of files) {
    const path = join(snapshotsDir, file);
    const dateStr = file.split("T")[0];
    const fileDate = new Date(dateStr).getTime();
    if (!Number.isNaN(fileDate) && fileDate < cutoff) {
      unlinkSync(path);
      removed++;
    }
  }

  return removed;
}
