import { join } from "node:path";
import type { AppConfig, Db, ParsedList, ParsedPlace } from "@gmaps/core";
import { BASE_DIR, syncState } from "@gmaps/core";
import { eq } from "drizzle-orm";
import { applyDiff, type DiffResult } from "./diff.js";
import { getSchemaVersion, parseLists, parsePlaces } from "./parser.js";
import { checkSession, interceptMasResponse } from "./session.js";
import { cleanOldSnapshots, saveSnapshot } from "./snapshots.js";

const GETLIST_BASE = "https://www.google.com/maps/preview/entitylist/getlist";

function randomDelay(range: [number, number]): Promise<void> {
  const ms = Math.floor(Math.random() * (range[1] - range[0] + 1)) + range[0];
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildGetlistUrl(listId: string, sessionToken: string): string {
  const pb = `!1m4!1s${listId}!2e1!3m1!1e1!2e2!3e2!4i500!6m3!1s${sessionToken}!7e81!28e2!8i3!16b1`;
  return `${GETLIST_BASE}?authuser=0&hl=en&gl=us&pb=${pb}`;
}

export interface PullResult {
  success: boolean;
  diff?: DiffResult;
  error?: string;
  listsProcessed: number;
  listsFailed: number;
}

export interface PullOptions {
  force?: boolean;
}

export async function pull(db: Db, config: AppConfig, options?: PullOptions): Promise<PullResult> {
  // Read sync state from DB
  const stateRow = db.select().from(syncState).where(eq(syncState.id, 1)).get();

  // Consecutive failure guard
  if (
    !options?.force &&
    stateRow &&
    stateRow.consecutiveFailures >= config.sync.maxConsecutiveFailures
  ) {
    const msg = `Sync paused after ${stateRow.consecutiveFailures} consecutive failures. Run \`places init\` to re-authenticate, or use \`--force\` to try anyway.`;
    console.error(msg);
    return { success: false, error: msg, listsProcessed: 0, listsFailed: 0 };
  }

  // Health check
  const session = await checkSession(config.browserProfileDir, config);
  if (!session.loggedIn || !session.context || !session.page) {
    db.update(syncState)
      .set({
        consecutiveFailures: (stateRow?.consecutiveFailures ?? 0) + 1,
        lastPull: new Date().toISOString(),
        lastPullStatus: "failure",
      })
      .where(eq(syncState.id, 1))
      .run();

    return {
      success: false,
      error: session.error ?? "Not logged in",
      listsProcessed: 0,
      listsFailed: 0,
    };
  }

  const { context, page } = session;

  try {
    // Phase 1: Intercept mas response
    console.log("Phase 1: Fetching list metadata...");
    const { masRaw, sessionToken } = await interceptMasResponse(
      page,
      config.sync.navigationTimeoutMs,
    );

    if (!sessionToken) {
      console.error("  Failed to extract session token from mas request.");
      return { success: false, error: "No session token", listsProcessed: 0, listsFailed: 0 };
    }

    const snapshotsDir = join(BASE_DIR, "snapshots");
    let remoteLists: ParsedList[] = [];
    if (masRaw) {
      try {
        remoteLists = parseLists(masRaw);
        saveSnapshot(snapshotsDir, "mas", masRaw);
        console.log(`  Found ${remoteLists.length} lists.`);
      } catch (error) {
        console.error("  Failed to parse list metadata:", error);
        saveSnapshot(snapshotsDir, "mas-error", masRaw);
      }
    }

    // Phase 2: Fetch each list's places
    console.log("Phase 2: Fetching places for each list...");
    const uniquePlaces = new Map<string, ParsedPlace>();
    const listPlaceMap = new Map<string, string[]>();
    let listsProcessed = 0;
    let listsFailed = 0;

    const fetchableLists = remoteLists.filter(
      (l): l is ParsedList & { id: string } => l.id !== null,
    );
    for (const list of fetchableLists) {
      console.log(`  Processing list: ${list.name} (${list.id})...`);
      await randomDelay(config.sync.delayBetweenListsMs);
      try {
        const getlistUrl = buildGetlistUrl(list.id, sessionToken);
        const rawResponse = await page.evaluate(async (url: string) => {
          const res = await fetch(url, { credentials: "include" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.text();
        }, getlistUrl);

        saveSnapshot(snapshotsDir, list.id, rawResponse);
        const listPlaces = parsePlaces(rawResponse);
        const placeIds = listPlaces.map((p) => p.placeId);
        listPlaceMap.set(list.id, placeIds);
        for (const place of listPlaces) {
          uniquePlaces.set(place.placeId, place);
        }
        listsProcessed++;
        console.log(`    Found ${listPlaces.length} places.`);
      } catch (error) {
        console.error(`  Failed to process list ${list.name}:`, error);
        listsFailed++;
      }
    }

    // Phase 3: Diff
    console.log("Phase 3: Applying diff...");
    const diff = applyDiff(db, fetchableLists, Array.from(uniquePlaces.values()), listPlaceMap);
    console.log(
      `  Done: ${diff.added} added, ${diff.updated} updated, ${diff.unchanged} unchanged, ${diff.flaggedRemoved} flagged removed.`,
    );

    // Update sync state
    const allFailed = fetchableLists.length > 0 && listsFailed === fetchableLists.length;
    const status = allFailed ? "failure" : listsFailed > 0 ? "partial" : "success";
    db.update(syncState)
      .set({
        lastPull: new Date().toISOString(),
        lastPullStatus: status,
        schemaVersion: getSchemaVersion(),
        consecutiveFailures: 0,
      })
      .where(eq(syncState.id, 1))
      .run();

    cleanOldSnapshots(snapshotsDir, config.snapshotsRetentionDays);
    return { success: !allFailed, diff, listsProcessed, listsFailed };
  } finally {
    await context.close();
  }
}
