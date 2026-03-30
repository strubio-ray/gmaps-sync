import { parseLists, parsePlaces, getSchemaVersion, extractSessionToken } from "./parser.js";
import { applyDiff, type DiffResult } from "./diff.js";
import type { Store } from "./store.js";
import { checkSession } from "./session.js";
import {
  notifySessionExpired,
  notifySchemaFailure,
  notifySyncComplete,
} from "./notifications.js";
import type { AppConfig, ParsedList, ParsedPlace, SyncState } from "./types.js";

const GETLIST_BASE = "https://www.google.com/maps/preview/entitylist/getlist";

function randomDelay(range: [number, number]): Promise<void> {
  const ms = Math.floor(Math.random() * (range[1] - range[0] + 1)) + range[0];
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildGetlistUrl(listId: string, listType: number, sessionToken: string): string {
  const pb = `!1m4!1s${listId}!2e1!3m1!1e1!2e2!3e${listType}!4i500!6m3!1s${sessionToken}!7e81!28e2!8i3!16b1`;
  return `${GETLIST_BASE}?authuser=0&hl=en&gl=us&pb=${pb}`;
}

export interface PullResult {
  success: boolean;
  diff?: DiffResult;
  error?: string;
  listsProcessed: number;
  listsFailed: number;
}

export async function pull(
  browserProfileDir: string,
  config: AppConfig,
  store: Store,
  profile: string,
): Promise<PullResult> {
  await store.init();

  // --- Health check ---
  const session = await checkSession(browserProfileDir, config);
  if (!session.loggedIn || !session.context || !session.page) {
    const syncState = await store.readSyncState(profile);
    syncState.consecutiveFailures++;
    syncState.lastPull = new Date().toISOString();
    syncState.lastPullStatus = "failure";
    await store.writeSyncState(syncState);

    if (syncState.consecutiveFailures >= 2 && config.notifications.onSessionExpired) {
      notifySessionExpired(profile);
    }

    return {
      success: false,
      error: session.error ?? "Not logged in",
      listsProcessed: 0,
      listsFailed: 0,
    };
  }

  const { context, page } = session;

  try {
    // --- Phase 1: Intercept mas response for list metadata and session token ---
    console.log("Phase 1: Fetching list metadata...");

    let masRaw: string | null = null;
    let sessionToken: string | null = null;

    page.on("request", (request) => {
      const url = request.url();
      if (url.includes("locationhistory/preview/mas")) {
        sessionToken = extractSessionToken(url);
      }
    });

    page.on("response", async (response) => {
      const url = response.url();
      if (url.includes("locationhistory/preview/mas") && response.status() === 200) {
        try {
          masRaw = await response.text();
        } catch {
          // Response may not be text
        }
      }
    });

    // Reload to capture the mas request/response via our interceptors.
    // Use domcontentloaded (not networkidle) — Google Maps SPA never goes idle.
    await page.reload({ waitUntil: "domcontentloaded", timeout: config.sync.navigationTimeoutMs });

    // Wait for the mas response to arrive (up to navigationTimeout)
    const masDeadline = Date.now() + config.sync.navigationTimeoutMs;
    while (!masRaw && Date.now() < masDeadline) {
      await page.waitForTimeout(1000);
    }

    if (!sessionToken) {
      console.error("  Failed to extract session token from mas request.");
      return { success: false, error: "No session token", listsProcessed: 0, listsFailed: 0 };
    }

    let remoteLists: ParsedList[] = [];
    if (masRaw) {
      try {
        remoteLists = parseLists(masRaw);
        await store.saveSnapshot("mas", masRaw);
        console.log(`  Found ${remoteLists.length} lists.`);
      } catch (error) {
        console.error("  Failed to parse list metadata:", error);
        await store.saveSnapshot("mas-error", masRaw);
      }
    } else {
      console.warn("  No mas response intercepted.");
    }

    // --- Phase 2: Fetch each list's places via getlist ---
    console.log("Phase 2: Fetching places for each list...");

    const allPlaces: ParsedPlace[] = [];
    const listPlaceMap = new Map<string, string[]>();
    let listsProcessed = 0;
    let listsFailed = 0;

    // Filter to lists with an ID (built-in lists with null ID can't be fetched via getlist)
    const fetchableLists = remoteLists.filter((l) => l.id !== null);

    for (const list of fetchableLists) {
      console.log(`  Processing list: ${list.name} (${list.id})...`);

      await randomDelay(config.sync.delayBetweenListsMs);

      try {
        const getlistUrl = buildGetlistUrl(list.id!, list.type, sessionToken);

        const rawResponse = await page.evaluate(async (url: string) => {
          const res = await fetch(url, { credentials: "include" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.text();
        }, getlistUrl);

        const listPlaces = parsePlaces(rawResponse);
        await store.saveSnapshot(list.id!, rawResponse);

        const placeIds = listPlaces.map((p) => p.placeId);
        listPlaceMap.set(list.id!, placeIds);
        allPlaces.push(...listPlaces);
        listsProcessed++;
        console.log(`    Found ${listPlaces.length} places.`);
      } catch (error) {
        console.error(`  Failed to process list ${list.name}:`, error);
        listsFailed++;
      }
    }

    // --- Phase 3: Diff and store ---
    console.log("Phase 3: Applying diff...");

    // Deduplicate places by placeId
    const uniquePlaces = new Map<string, ParsedPlace>();
    for (const place of allPlaces) {
      uniquePlaces.set(place.placeId, place);
    }

    const diff = await applyDiff(
      store,
      remoteLists.filter((l) => l.id !== null) as ParsedList[],
      Array.from(uniquePlaces.values()),
      listPlaceMap,
    );

    console.log(
      `  Done: ${diff.added} added, ${diff.updated} updated, ${diff.unchanged} unchanged, ${diff.flaggedRemoved} flagged removed.`,
    );

    // --- Update sync state ---
    const allFailed = fetchableLists.length > 0 && listsFailed === fetchableLists.length;
    const status = allFailed ? "failure" : listsFailed > 0 ? "partial" : "success";

    const syncState: SyncState = {
      lastPull: new Date().toISOString(),
      lastPullStatus: status,
      schemaVersion: getSchemaVersion(),
      consecutiveFailures: 0,
      profile,
    };
    await store.writeSyncState(syncState);

    if (allFailed && config.notifications.onSchemaFailure) {
      notifySchemaFailure();
    }
    if (config.notifications.onSyncComplete) {
      notifySyncComplete(profile, diff.added, diff.updated);
    }

    await store.cleanOldSnapshots(config.snapshotsRetentionDays);

    return { success: !allFailed, diff, listsProcessed, listsFailed };
  } finally {
    await context.close();
  }
}
