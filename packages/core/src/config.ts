import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AppConfig } from "./types.js";

export const BASE_DIR = join(homedir(), ".gmaps-sync");
export const DB_PATH = join(BASE_DIR, "places.db");

export const DEFAULT_CONFIG: AppConfig = {
  browserProfileDir: join(BASE_DIR, "browser"),
  sync: {
    delayBetweenListsMs: [2000, 5000],
    navigationTimeoutMs: 30000,
    maxConsecutiveFailures: 2,
  },
  headless: true,
  useSystemChrome: true,
  snapshotsRetentionDays: 30,
  enrichment: {
    reEnrichAfterDays: 30,
  },
};

export function loadConfig(configPath?: string): AppConfig {
  const path = configPath ?? join(BASE_DIR, "config.json");
  if (!existsSync(path)) {
    return { ...DEFAULT_CONFIG };
  }

  const raw = readFileSync(path, "utf-8");
  const partial = JSON.parse(raw) as Partial<AppConfig>;

  return {
    ...DEFAULT_CONFIG,
    ...partial,
    sync: { ...DEFAULT_CONFIG.sync, ...partial.sync },
    enrichment: { ...DEFAULT_CONFIG.enrichment, ...partial.enrichment },
  };
}
