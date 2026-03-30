#!/usr/bin/env node

import { Command } from "commander";
import { mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, resolveProfilePaths, BASE_DIR } from "./config.js";
import { Store } from "./store.js";
import { initSession, checkSession } from "./session.js";
import { pull } from "./pull.js";
import { enrichPlaces } from "./enrich.js";
import { parseLists } from "./parser.js";
import { installSchedule, uninstallSchedule } from "./scheduling.js";

const program = new Command();

program
  .name("gmaps-sync")
  .description("One-way sync from Google Maps saved places to local JSON")
  .version("0.1.0");

function getStore(profile: string): { store: Store; browserProfileDir: string } {
  const config = loadConfig();
  const profileConfig = config.profiles[profile];
  const paths = resolveProfilePaths(BASE_DIR, profile, profileConfig);
  mkdirSync(paths.dataDir, { recursive: true });
  mkdirSync(paths.browserProfileDir, { recursive: true });
  return { store: new Store(paths.dataDir), browserProfileDir: paths.browserProfileDir };
}

// --- init ---
program
  .command("init")
  .description("First-time setup: opens browser for Google login")
  .option("--profile <name>", "Profile name", "default")
  .action(async (opts: { profile: string }) => {
    const config = loadConfig();
    const { browserProfileDir, store } = getStore(opts.profile);
    await store.init();

    console.log(`Initializing profile: ${opts.profile}`);
    console.log(`Browser profile: ${browserProfileDir}`);

    const result = await initSession(browserProfileDir, config);
    if (result.loggedIn) {
      console.log("Setup complete. You can now run: gmaps-sync pull");
    } else {
      console.error("Setup failed:", result.error);
      process.exitCode = 1;
    }
  });

// --- pull ---
program
  .command("pull")
  .description("Pull saved places from Google Maps")
  .option("--profile <name>", "Profile name", "default")
  .option("--headed", "Run browser in headed mode for debugging", false)
  .action(async (opts: { profile: string; headed: boolean }) => {
    const config = loadConfig();
    if (opts.headed) {
      config.headless = false;
    }
    const { browserProfileDir, store } = getStore(opts.profile);

    // Jitter: random delay when run by scheduler (non-TTY)
    if (!process.stdout.isTTY && config.sync.jitterMinutes > 0) {
      const jitterMs = Math.floor(
        Math.random() * config.sync.jitterMinutes * 60 * 1000,
      );
      console.log(`Jitter delay: ${Math.round(jitterMs / 1000)}s`);
      await new Promise((resolve) => setTimeout(resolve, jitterMs));
    }

    console.log(`Pulling for profile: ${opts.profile}`);
    const result = await pull(browserProfileDir, config, store, opts.profile);

    if (result.success) {
      console.log("Pull complete.");
    } else {
      console.error("Pull failed:", result.error);
      process.exitCode = 1;
    }
  });

// --- status ---
program
  .command("status")
  .description("Show sync status")
  .option("--profile <name>", "Profile name", "default")
  .action(async (opts: { profile: string }) => {
    const { store } = getStore(opts.profile);
    const syncState = await store.readSyncState(opts.profile);
    const lists = await store.readLists();
    const placeIds = await store.listPlaceIds();

    console.log(`Profile: ${opts.profile}`);
    console.log(`Last pull: ${syncState.lastPull ?? "never"}`);
    console.log(`Last status: ${syncState.lastPullStatus}`);
    console.log(`Schema version: ${syncState.schemaVersion}`);
    console.log(`Consecutive failures: ${syncState.consecutiveFailures}`);
    console.log(`Lists: ${lists.filter((l) => !l.removedRemote).length} active, ${lists.filter((l) => l.removedRemote).length} removed`);
    console.log(`Places: ${placeIds.length} total`);
  });

// --- enrich ---
program
  .command("enrich")
  .description("Enrich places via Google Places API")
  .option("--profile <name>", "Profile name", "default")
  .option("--all", "Enrich all places")
  .option("--list <id>", "Enrich places in a specific list")
  .option("--place <id>", "Enrich a specific place")
  .option("--force", "Re-enrich already enriched places", false)
  .action(async (opts: { profile: string; all?: boolean; list?: string; place?: string; force: boolean }) => {
    const config = loadConfig();
    const apiKey = config.enrichment.googlePlacesApiKey;
    if (!apiKey) {
      console.error("No Google Places API key configured.");
      console.error("Set enrichment.googlePlacesApiKey in ~/.gmaps-sync/config.json");
      process.exitCode = 1;
      return;
    }

    const { store } = getStore(opts.profile);
    let placeIds: string[];

    if (opts.place) {
      placeIds = [opts.place];
    } else if (opts.list) {
      const places = await store.readAllPlaces();
      placeIds = places
        .filter((p) => p.lists.includes(opts.list!))
        .map((p) => p.id);
    } else {
      placeIds = await store.listPlaceIds();
    }

    console.log(`Enriching ${placeIds.length} places...`);
    const result = await enrichPlaces(store, apiKey, placeIds, opts.force);
    console.log(
      `Done: ${result.enriched} enriched, ${result.skipped} skipped, ${result.failed} failed.`,
    );
  });

// --- prune ---
program
  .command("prune")
  .description("Remove locally flagged-as-removed places")
  .option("--profile <name>", "Profile name", "default")
  .option("--dry-run", "Show what would be removed without removing", false)
  .action(async (opts: { profile: string; dryRun: boolean }) => {
    const { store } = getStore(opts.profile);
    const config = loadConfig();
    const allPlaces = await store.readAllPlaces();
    const toRemove = allPlaces.filter((p) => p.removedRemote);

    if (toRemove.length === 0) {
      console.log("No places flagged for removal.");
      return;
    }

    for (const place of toRemove) {
      if (opts.dryRun) {
        console.log(`Would remove: ${place.name} (${place.id})`);
      } else {
        const profileConfig = config.profiles[opts.profile];
        const paths = resolveProfilePaths(BASE_DIR, opts.profile, profileConfig);
        unlinkSync(join(paths.dataDir, "places", `${place.id}.json`));
        console.log(`Removed: ${place.name} (${place.id})`);
      }
    }

    if (opts.dryRun) {
      console.log(`\n${toRemove.length} places would be removed. Run without --dry-run to delete.`);
    } else {
      console.log(`\n${toRemove.length} places removed.`);
    }
  });

// --- schema-check ---
program
  .command("schema-check")
  .description("Validate schema.json against a test pull (dry run)")
  .option("--profile <name>", "Profile name", "default")
  .action(async (opts: { profile: string }) => {
    const config = loadConfig();
    const { browserProfileDir } = getStore(opts.profile);

    console.log("Running schema check (dry run)...");
    const session = await checkSession(browserProfileDir, config);
    if (!session.loggedIn || !session.page) {
      console.error("Not logged in. Run: gmaps-sync init");
      process.exitCode = 1;
      return;
    }

    let intercepted: string | null = null;
    session.page.on("response", async (response) => {
      const url = response.url();
      if (url.includes("locationhistory/preview/mas") && response.status() === 200) {
        try {
          intercepted = await response.text();
        } catch { /* ignore */ }
      }
    });

    await session.page.reload({ waitUntil: "domcontentloaded", timeout: config.sync.navigationTimeoutMs });

    // Wait for the mas response to arrive
    const masDeadline = Date.now() + config.sync.navigationTimeoutMs;
    while (!intercepted && Date.now() < masDeadline) {
      await session.page.waitForTimeout(1000);
    }

    if (intercepted) {
      try {
        const lists = parseLists(intercepted);
        console.log(`Schema OK — parsed ${lists.length} lists.`);
        for (const list of lists) {
          console.log(`  - ${list.name} (type ${list.type}, ${list.count} items)`);
        }
      } catch (error) {
        console.error("Schema FAILED:", error);
        process.exitCode = 1;
      }
    } else {
      console.error("No mas response intercepted. Check your connection.");
      process.exitCode = 1;
    }

    await session.context!.close();
  });

// --- schedule ---
program
  .command("schedule")
  .description("Install or remove the daily sync schedule (macOS launchd)")
  .option("--profile <name>", "Profile name", "default")
  .option("--remove", "Remove the schedule", false)
  .action((opts: { profile: string; remove: boolean }) => {
    if (opts.remove) {
      uninstallSchedule();
    } else {
      installSchedule(opts.profile);
    }
  });

program.parse();
