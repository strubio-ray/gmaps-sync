import { parseLists, parsePlaces, getSchemaVersion } from "./parser.js";
import { applyDiff, type DiffResult } from "./diff.js";
import type { Store } from "./store.js";
import { checkSession } from "./session.js";
import {
  notifySessionExpired,
  notifySchemaFailure,
  notifySyncComplete,
} from "./notifications.js";
import type { AppConfig, ParsedList, ParsedPlace, SyncState } from "./types.js";

function randomDelay(range: [number, number]): Promise<void> {
  const ms = Math.floor(Math.random() * (range[1] - range[0] + 1)) + range[0];
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    // --- Phase 1: Fetch list metadata ---
    console.log("Phase 1: Fetching list metadata...");

    let listsRaw: string | null = null;
    page.on("response", async (response) => {
      const url = response.url();
      if (url.includes("/maps/saved") && response.status() === 200) {
        try {
          const text = await response.text();
          if (text.startsWith(")]}'")) {
            listsRaw = text;
          }
        } catch {
          // Response may not be text
        }
      }
    });

    await page.goto("https://www.google.com/maps/saved", {
      waitUntil: "networkidle",
      timeout: config.sync.navigationTimeoutMs,
    });

    await page.waitForTimeout(3000);

    let remoteLists: ParsedList[] = [];
    if (listsRaw) {
      try {
        remoteLists = parseLists(listsRaw);
        await store.saveSnapshot("lists", listsRaw);
        console.log(`  Found ${remoteLists.length} lists.`);
      } catch (error) {
        console.error("  Failed to parse list metadata:", error);
        await store.saveSnapshot("lists-error", listsRaw);
      }
    } else {
      console.warn("  No list metadata response intercepted.");
    }

    // --- Phase 2: Fetch each list's places ---
    console.log("Phase 2: Fetching places for each list...");

    const allPlaces: ParsedPlace[] = [];
    const listPlaceMap = new Map<string, string[]>();
    let listsProcessed = 0;
    let listsFailed = 0;

    for (const list of remoteLists) {
      console.log(`  Processing list: ${list.name} (${list.id})...`);

      await randomDelay(config.sync.delayBetweenListsMs);

      const placesRaw: string[] = [];

      const responseHandler = async (response: { url: () => string; status: () => number; text: () => Promise<string> }) => {
        const url = response.url();
        if (
          (url.includes("entitylist/getlist") || url.includes("/maps/saved/list/")) &&
          response.status() === 200
        ) {
          try {
            const text = await response.text();
            if (text.startsWith(")]}'")) {
              placesRaw.push(text);
            }
          } catch {
            // Response may not be text
          }
        }
      };

      page.on("response", responseHandler);

      try {
        await page.goto(`https://www.google.com/maps/saved/list/${list.id}`, {
          waitUntil: "networkidle",
          timeout: config.sync.navigationTimeoutMs,
        });
        await page.waitForTimeout(3000);

        // Scroll to load more if needed
        let previousCount = 0;
        for (let scrollAttempt = 0; scrollAttempt < 10; scrollAttempt++) {
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await page.waitForTimeout(2000);
          if (placesRaw.length === previousCount) break;
          previousCount = placesRaw.length;
        }

        const listPlaces: ParsedPlace[] = [];
        for (const raw of placesRaw) {
          try {
            const parsed = parsePlaces(raw);
            listPlaces.push(...parsed);
            await store.saveSnapshot(list.id, raw);
          } catch (error) {
            console.error(`    Parse error for list ${list.name}:`, error);
            await store.saveSnapshot(`${list.id}-error`, raw);
          }
        }

        const placeIds = listPlaces.map((p) => p.placeId);
        listPlaceMap.set(list.id, placeIds);
        allPlaces.push(...listPlaces);
        listsProcessed++;
        console.log(`    Found ${listPlaces.length} places.`);
      } catch (error) {
        console.error(`  Failed to process list ${list.name}:`, error);
        listsFailed++;
      } finally {
        page.removeListener("response", responseHandler);
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
      remoteLists,
      Array.from(uniquePlaces.values()),
      listPlaceMap,
    );

    console.log(
      `  Done: ${diff.added} added, ${diff.updated} updated, ${diff.unchanged} unchanged, ${diff.flaggedRemoved} flagged removed.`,
    );

    // --- Update sync state ---
    const allFailed = remoteLists.length > 0 && listsFailed === remoteLists.length;
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
