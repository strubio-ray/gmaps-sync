#!/usr/bin/env node

import { mkdirSync } from "node:fs";
import {
  BASE_DIR,
  createDb,
  DB_PATH,
  lists,
  loadConfig,
  pendingMutations,
  placeLists,
  places,
  runMigrations,
  syncMetadata,
  syncState,
} from "@gmaps/core";
import { initSession, pull } from "@gmaps/sync";
import { Command } from "commander";
import { eq, isNull, sql } from "drizzle-orm";

const JITTER_MINUTES = 60;

function getDb() {
  mkdirSync(BASE_DIR, { recursive: true });
  const { db, sqlite } = createDb(DB_PATH);
  runMigrations(sqlite);
  return { db, sqlite };
}

const program = new Command();

program.name("places").description("Google Maps Places Platform");

program
  .command("init")
  .description("Create DB, open headed browser for login")
  .action(async () => {
    try {
      mkdirSync(BASE_DIR, { recursive: true });
      const { sqlite } = createDb(DB_PATH);
      runMigrations(sqlite);
      sqlite.close();

      const config = loadConfig();
      await initSession(config.browserProfileDir, config);
      console.log("Init complete.");
    } catch (err) {
      console.error("Init failed:", err);
      process.exit(1);
    }
  });

program
  .command("pull")
  .description("Run the sync")
  .option("--headed", "Run browser in headed mode")
  .option("--force", "Bypass consecutive failure guard")
  .action(async (opts: { headed?: boolean; force?: boolean }) => {
    // Jitter when not TTY
    if (!process.stdout.isTTY && JITTER_MINUTES > 0) {
      const jitterMs = Math.floor(Math.random() * JITTER_MINUTES * 60 * 1000);
      console.log(`Jitter delay: ${Math.round(jitterMs / 1000)}s`);
      await new Promise((resolve) => setTimeout(resolve, jitterMs));
    }

    const { db, sqlite } = getDb();
    const config = loadConfig();
    if (opts.headed) {
      config.headless = false;
    }

    try {
      const result = await pull(db, config, { force: opts.force ?? false });

      if (result.success) {
        console.log("Pull complete.");
      } else {
        console.error("Pull failed:", result.error);
      }

      if (result.diff) {
        const d = result.diff;
        console.log(
          `Diff: ${d.added} added, ${d.updated} updated, ${d.unchanged} unchanged, ${d.flaggedRemoved} flagged removed`,
        );
      }

      console.log(`Lists: ${result.listsProcessed} processed, ${result.listsFailed} failed`);

      const unenrichedCount = db
        .select({ count: sql<number>`count(*)` })
        .from(places)
        .where(isNull(places.enrichedAt))
        .get();
      console.log(`Unenriched places: ${unenrichedCount?.count ?? 0}`);
    } finally {
      sqlite.close();
    }
  });

program
  .command("status")
  .description("Show sync state")
  .action(() => {
    const { db, sqlite } = getDb();

    try {
      const state = db.select().from(syncState).where(eq(syncState.id, 1)).get();

      const activeLists = db
        .select({ count: sql<number>`count(*)` })
        .from(lists)
        .where(eq(lists.removedRemote, 0))
        .get();
      const removedLists = db
        .select({ count: sql<number>`count(*)` })
        .from(lists)
        .where(eq(lists.removedRemote, 1))
        .get();

      const totalPlaces = db.select({ count: sql<number>`count(*)` }).from(places).get();
      const enrichedCount = db
        .select({ count: sql<number>`count(*)` })
        .from(places)
        .where(sql`enriched_at IS NOT NULL`)
        .get();
      const unenrichedCount = db
        .select({ count: sql<number>`count(*)` })
        .from(places)
        .where(isNull(places.enrichedAt))
        .get();

      console.log("=== Sync Status ===");
      console.log(`Last pull:            ${state?.lastPull ?? "never"}`);
      console.log(`Status:               ${state?.lastPullStatus ?? "n/a"}`);
      console.log(`Schema version:       ${state?.schemaVersion ?? "n/a"}`);
      console.log(`Consecutive failures: ${state?.consecutiveFailures ?? 0}`);
      console.log(`Active lists:         ${activeLists?.count ?? 0}`);
      console.log(`Removed lists:        ${removedLists?.count ?? 0}`);
      console.log(`Total places:         ${totalPlaces?.count ?? 0}`);
      console.log(`Enriched:             ${enrichedCount?.count ?? 0}`);
      console.log(`Unenriched:           ${unenrichedCount?.count ?? 0}`);
    } finally {
      sqlite.close();
    }
  });

program
  .command("enrich")
  .description("Enrich places via Google Places API (placeholder)")
  .action(() => {
    console.log("Enrichment requires a Google Places API key. Set GOOGLE_PLACES_API_KEY env var.");
    console.log("Implementation pending — PlacesApiClient not yet wired.");
  });

program
  .command("pending")
  .description("Show pending mutations")
  .action(() => {
    const { db, sqlite } = getDb();

    try {
      const mutations = db.select().from(pendingMutations).all();

      if (mutations.length === 0) {
        console.log("No pending mutations.");
        return;
      }

      console.log(`Pending mutations (${mutations.length}):`);
      for (const m of mutations) {
        console.log(`  [${m.id}] type=${m.type} status=${m.status} placeId=${m.placeId ?? "n/a"}`);
      }
    } finally {
      sqlite.close();
    }
  });

program
  .command("prune")
  .description("Delete soft-removed places")
  .option("--dry-run", "Show what would be removed without deleting")
  .action((opts: { dryRun?: boolean }) => {
    const { db, sqlite } = getDb();

    try {
      const toRemove = db
        .select({ googlePlaceId: places.googlePlaceId, name: places.name })
        .from(places)
        .innerJoin(syncMetadata, eq(places.googlePlaceId, syncMetadata.googlePlaceId))
        .where(eq(syncMetadata.removedRemote, 1))
        .all();

      if (toRemove.length === 0) {
        console.log("No soft-removed places to prune.");
        return;
      }

      if (opts.dryRun) {
        console.log(`Would prune ${toRemove.length} place(s):`);
        for (const p of toRemove) {
          console.log(`  ${p.googlePlaceId} — ${p.name}`);
        }
        return;
      }

      const ids = toRemove.map((p) => p.googlePlaceId);
      for (const id of ids) {
        db.delete(placeLists).where(eq(placeLists.googlePlaceId, id)).run();
        db.delete(syncMetadata).where(eq(syncMetadata.googlePlaceId, id)).run();
        db.delete(places).where(eq(places.googlePlaceId, id)).run();
      }

      console.log(`Pruned ${ids.length} place(s).`);
    } finally {
      sqlite.close();
    }
  });

program.parse(process.argv);
