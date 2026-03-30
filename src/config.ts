import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { AppConfig, ProfileConfig } from "./types.js";

export const BASE_DIR = join(homedir(), ".gmaps-sync");

export const DEFAULT_CONFIG: AppConfig = {
  profiles: {
    default: {
      browserProfileDir: join(BASE_DIR, "profiles", "default", "browser"),
      dataDir: join(BASE_DIR, "profiles", "default", "data"),
    },
  },
  sync: {
    intervalHours: 24,
    jitterMinutes: 60,
    delayBetweenListsMs: [2000, 5000],
    navigationTimeoutMs: 30000,
    retryOnSessionFailure: true,
  },
  enrichment: {
    googlePlacesApiKey: null,
  },
  notifications: {
    onSessionExpired: true,
    onSchemaFailure: true,
    onSyncComplete: false,
  },
  headless: true,
  useSystemChrome: true,
  snapshotsRetentionDays: 30,
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
    notifications: { ...DEFAULT_CONFIG.notifications, ...partial.notifications },
    profiles: { ...DEFAULT_CONFIG.profiles, ...partial.profiles },
  };
}

export function resolveProfilePaths(
  baseDir: string,
  profileName: string,
  configProfile?: ProfileConfig,
): { browserProfileDir: string; dataDir: string } {
  if (configProfile) {
    return {
      browserProfileDir: configProfile.browserProfileDir,
      dataDir: configProfile.dataDir,
    };
  }

  return {
    browserProfileDir: join(baseDir, "profiles", profileName, "browser"),
    dataDir: join(baseDir, "profiles", profileName, "data"),
  };
}
