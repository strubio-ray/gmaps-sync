export interface ListMetadata {
  id: string;
  name: string;
  type: number;
  count: number;
  lastSeenRemote: string;
  removedRemote: boolean;
}

export interface PlaceCoordinates {
  lat: number;
  lng: number;
}

export interface Place {
  id: string;
  name: string;
  coordinates: PlaceCoordinates;
  address: string;
  lists: string[];
  comment: string | null;
  source: "pull" | "local";
  contentHash: string;
  firstSeen: string;
  lastSeenRemote: string;
  removedRemote: boolean;
}

export interface SyncState {
  lastPull: string | null;
  lastPullStatus: "success" | "partial" | "failure";
  schemaVersion: number;
  consecutiveFailures: number;
  profile: string;
}

export interface ProfileConfig {
  browserProfileDir: string;
  dataDir: string;
}

export interface SyncConfig {
  intervalHours: number;
  jitterMinutes: number;
  delayBetweenListsMs: [number, number];
  navigationTimeoutMs: number;
  maxConsecutiveFailures: number;
}

export interface AppConfig {
  profiles: Record<string, ProfileConfig>;
  sync: SyncConfig;
  headless: boolean;
  useSystemChrome: boolean;
  snapshotsRetentionDays: number;
}

/** Raw parsed data from pull engine before diff processing */
export interface ParsedList {
  id: string | null;
  name: string;
  type: number;
  count: number;
}

export interface ParsedPlace {
  name: string;
  lat: number;
  lng: number;
  address: string;
  comment: string | null;
  placeId: string;
}
