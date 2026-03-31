# Brew Services Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the custom `scheduling.ts` launchd plist management with Homebrew's `service` DSL, remove the `schedule` CLI command, clean up orphaned config fields, and bump to v0.2.0.

**Architecture:** Delete `scheduling.ts` and its CLI command. Remove `intervalHours`/`jitterMinutes` from config types and defaults (hardcode jitter in `cli.ts`). Update the Homebrew formula with a `service` block, `post_install` migration hook, and `caveats`. Tag v0.2.0 to trigger the bump-homebrew workflow.

**Tech Stack:** TypeScript (ESM), Vitest, Homebrew (Ruby formula), GitHub Actions

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/scheduling.ts` | Delete | No longer needed |
| `src/types.ts` | Modify | Remove `intervalHours` and `jitterMinutes` from `SyncConfig` |
| `src/config.ts` | Modify | Remove `intervalHours` and `jitterMinutes` from `DEFAULT_CONFIG` |
| `src/cli.ts` | Modify | Remove `schedule` command, scheduling import, hardcode jitter default |
| `tests/pull.test.ts` | Modify | Remove `intervalHours` and `jitterMinutes` from `makeConfig` |
| `tests/config.test.ts` | Modify | Update assertion that references `intervalHours` |
| `package.json` | Modify | Bump version to `0.2.0` |
| `CLAUDE.md` | Modify | Update scheduling references |
| `README.md` | Modify | Update scheduling section, data layout, config example |
| `homebrew-tap: Formula/gmaps-sync.rb` | Modify | Add `service` block, `post_install`, `caveats` |

---

### Task 1: Remove Orphaned Config Fields from Types

**Files:**
- Modify: `src/types.ts:42-48`

- [ ] **Step 1: Remove `intervalHours` and `jitterMinutes` from `SyncConfig`**

In `src/types.ts`, replace the `SyncConfig` interface (lines 42-48):

```typescript
export interface SyncConfig {
  delayBetweenListsMs: [number, number];
  navigationTimeoutMs: number;
  maxConsecutiveFailures: number;
}
```

- [ ] **Step 2: Run type check to see expected errors**

Run: `npm run lint 2>&1 | head -20`

Expected: Errors in `config.ts` (still has the fields in defaults), `cli.ts` (references `jitterMinutes`), and `tests/` (references in `makeConfig`).

- [ ] **Step 3: Commit**

```bash
git add src/types.ts && git commit -m "refactor!: remove intervalHours and jitterMinutes from SyncConfig"
```

---

### Task 2: Update Config Defaults

**Files:**
- Modify: `src/config.ts:15-21`

- [ ] **Step 1: Remove `intervalHours` and `jitterMinutes` from `DEFAULT_CONFIG`**

In `src/config.ts`, replace the `sync` block in `DEFAULT_CONFIG` (lines 15-21):

```typescript
  sync: {
    delayBetweenListsMs: [2000, 5000],
    navigationTimeoutMs: 30000,
    maxConsecutiveFailures: 2,
  },
```

- [ ] **Step 2: Run type check**

Run: `npm run lint 2>&1 | head -20`

Expected: Errors only in `cli.ts` (references `config.sync.jitterMinutes`) and test files.

- [ ] **Step 3: Commit**

```bash
git add src/config.ts && git commit -m "refactor: remove intervalHours and jitterMinutes from config defaults"
```

---

### Task 3: Delete scheduling.ts, Remove schedule Command, Hardcode Jitter

**Files:**
- Delete: `src/scheduling.ts`
- Modify: `src/cli.ts:1-197`

- [ ] **Step 1: Delete `src/scheduling.ts`**

```bash
rm src/scheduling.ts
```

- [ ] **Step 2: Update `src/cli.ts`**

Remove the scheduling import (line 11), remove the schedule command (lines 183-195), hardcode the jitter default, and bump the version string. Replace the entire file:

```typescript
#!/usr/bin/env node

import { Command } from "commander";
import { mkdirSync } from "node:fs";
import { loadConfig, resolveProfilePaths, BASE_DIR } from "./config.js";
import type { AppConfig } from "./types.js";
import { Store } from "./store.js";
import { initSession, checkSession, interceptMasResponse } from "./session.js";
import { pull } from "./pull.js";
import { parseLists } from "./parser.js";

const program = new Command();

const JITTER_MINUTES = 60;

program
  .name("gmaps-sync")
  .description("One-way sync from Google Maps saved places to local JSON")
  .version("0.2.0");

function getStore(
  profile: string,
  config: AppConfig,
): { store: Store; browserProfileDir: string } {
  const profileConfig = config.profiles[profile];
  const paths = resolveProfilePaths(BASE_DIR, profile, profileConfig);
  return { store: new Store(paths.dataDir), browserProfileDir: paths.browserProfileDir };
}

// --- init ---
program
  .command("init")
  .description("First-time setup: opens browser for Google login")
  .option("--profile <name>", "Profile name", "default")
  .action(async (opts: { profile: string }) => {
    const config = loadConfig();
    const { browserProfileDir, store } = getStore(opts.profile, config);
    mkdirSync(browserProfileDir, { recursive: true });
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
  .option("--force", "Bypass consecutive failure guard", false)
  .action(async (opts: { profile: string; headed: boolean; force: boolean }) => {
    const config = loadConfig();
    if (opts.headed) {
      config.headless = false;
    }
    const { browserProfileDir, store } = getStore(opts.profile, config);

    // Jitter: random delay when run by scheduler (non-TTY)
    if (!process.stdout.isTTY && JITTER_MINUTES > 0) {
      const jitterMs = Math.floor(
        Math.random() * JITTER_MINUTES * 60 * 1000,
      );
      console.log(`Jitter delay: ${Math.round(jitterMs / 1000)}s`);
      await new Promise((resolve) => setTimeout(resolve, jitterMs));
    }

    console.log(`Pulling for profile: ${opts.profile}`);
    const result = await pull(browserProfileDir, config, store, opts.profile, {
      force: opts.force,
    });

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
    const config = loadConfig();
    const { store } = getStore(opts.profile, config);
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

// --- prune ---
program
  .command("prune")
  .description("Remove locally flagged-as-removed places")
  .option("--profile <name>", "Profile name", "default")
  .option("--dry-run", "Show what would be removed without removing", false)
  .action(async (opts: { profile: string; dryRun: boolean }) => {
    const config = loadConfig();
    const { store } = getStore(opts.profile, config);
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
        await store.deletePlace(place.id);
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
    const { browserProfileDir } = getStore(opts.profile, config);

    console.log("Running schema check (dry run)...");
    const session = await checkSession(browserProfileDir, config);
    if (!session.loggedIn || !session.page) {
      console.error("Not logged in. Run: gmaps-sync init");
      process.exitCode = 1;
      return;
    }

    const { masRaw } = await interceptMasResponse(
      session.page,
      config.sync.navigationTimeoutMs,
    );

    if (masRaw) {
      try {
        const lists = parseLists(masRaw);
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

program.parse();
```

- [ ] **Step 3: Run type check**

Run: `npm run lint 2>&1`

Expected: No errors (test files may have issues but `tsc --noEmit` only checks `src/`).

- [ ] **Step 4: Commit**

```bash
git add src/scheduling.ts src/cli.ts && git commit -m "feat!: remove schedule command, use brew services for scheduling"
```

---

### Task 4: Update Tests

**Files:**
- Modify: `tests/pull.test.ts:19-34`
- Modify: `tests/config.test.ts:28`

- [ ] **Step 1: Update `makeConfig` in `tests/pull.test.ts`**

Replace the `makeConfig` function (lines 19-34):

```typescript
function makeConfig(overrides?: Partial<AppConfig["sync"]>): AppConfig {
  return {
    profiles: {},
    sync: {
      delayBetweenListsMs: [0, 0],
      navigationTimeoutMs: 5000,
      maxConsecutiveFailures: 2,
      ...overrides,
    },
    headless: true,
    useSystemChrome: false,
    snapshotsRetentionDays: 30,
  };
}
```

- [ ] **Step 2: Update config test assertion**

In `tests/config.test.ts`, replace line 28:

```typescript
    expect(config.sync.intervalHours).toBe(DEFAULT_CONFIG.sync.intervalHours);
```

With:

```typescript
    expect(config.sync.maxConsecutiveFailures).toBe(DEFAULT_CONFIG.sync.maxConsecutiveFailures);
```

- [ ] **Step 3: Run all tests**

Run: `npx vitest run 2>&1 | tail -15`

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/pull.test.ts tests/config.test.ts && git commit -m "test: update tests for removed scheduling config fields"
```

---

### Task 5: Bump Version

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update version in `package.json`**

In `package.json`, change `"version": "0.1.0"` to `"version": "0.2.0"`.

- [ ] **Step 2: Run type check and tests**

Run: `npm run lint 2>&1 && npx vitest run 2>&1 | tail -10`

Expected: No type errors, all tests pass.

- [ ] **Step 3: Commit**

```bash
git add package.json && git commit -m "chore: bump version to 0.2.0"
```

---

### Task 6: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update project overview**

In `CLAUDE.md`, replace line 9:

```
Target platform: macOS. Uses launchd for scheduling.
```

With:

```
Target platform: macOS. Scheduling via `brew services` (Homebrew service DSL).
```

- [ ] **Step 2: Remove scheduling.ts from Supporting Modules**

In `CLAUDE.md`, delete the `scheduling.ts` bullet from the Supporting Modules section:

```
- **scheduling.ts** — Installs/removes macOS launchd plist for daily automated pulls.
```

- [ ] **Step 3: Update CLI commands list**

In `CLAUDE.md`, replace the `cli.ts` bullet:

```
- **cli.ts** — Commander.js entry point. Commands: `init`, `pull`, `status`, `prune`, `schema-check`, `schedule`.
```

With:

```
- **cli.ts** — Commander.js entry point. Commands: `init`, `pull`, `status`, `prune`, `schema-check`.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md && git commit -m "docs: update CLAUDE.md for brew services scheduling"
```

---

### Task 7: Update README.md

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the "Schedule daily sync" section**

In `README.md`, replace the "4. Schedule daily sync" section (lines 42-54):

```markdown
### 4. Schedule daily sync

```bash
brew services start gmaps-sync
```

Registers a launchd job that runs `pull` daily at 6:00 AM with random jitter (0-60 min). Managed by Homebrew — `brew uninstall` automatically stops the service.

To stop the schedule:

```bash
brew services stop gmaps-sync
```
```

- [ ] **Step 2: Remove `schedule` from commands table**

In `README.md`, delete this row from the commands table (line 65):

```
| `schedule` | Install or remove the daily sync schedule |
```

- [ ] **Step 3: Update data layout**

In `README.md`, replace the data layout section (lines 90-106):

```markdown
## Data layout

```
~/.gmaps-sync/
├── config.json                          # Optional config overrides
└── profiles/
    └── default/
        ├── browser/                     # Playwright persistent session
        └── data/
            ├── lists.json               # List metadata
            ├── sync-state.json          # Sync status and failure counter
            ├── places/
            │   ├── ChIJ_abc123.json     # One file per place
            │   └── ...
            └── snapshots/               # Raw API responses (30-day retention)
```

Service logs are at `$(brew --prefix)/var/log/gmaps-sync/`.
```

- [ ] **Step 4: Update configuration example**

In `README.md`, replace the configuration JSON example (lines 112-124):

```json
{
  "sync": {
    "delayBetweenListsMs": [2000, 5000],
    "navigationTimeoutMs": 30000,
    "maxConsecutiveFailures": 2
  },
  "headless": true,
  "useSystemChrome": true,
  "snapshotsRetentionDays": 30
}
```

- [ ] **Step 5: Commit**

```bash
git add README.md && git commit -m "docs: update README for brew services scheduling"
```

---

### Task 8: Update Homebrew Formula

**Files:**
- Modify: `/tmp/homebrew-tap/Formula/gmaps-sync.rb`

- [ ] **Step 1: Push all changes to gmaps-sync and tag v0.2.0**

```bash
git push
git tag v0.2.0
git push origin v0.2.0
```

- [ ] **Step 2: Get the new tarball SHA256**

```bash
curl -sL https://github.com/strubio-ray/gmaps-sync/archive/refs/tags/v0.2.0.tar.gz | shasum -a 256
```

Copy the hash (first field).

- [ ] **Step 3: Wait for the bump-homebrew workflow**

```bash
gh run list --repo strubio-ray/gmaps-sync --workflow bump-homebrew.yml --limit 1
```

The workflow should auto-update the formula's URL and SHA in the tap. If it succeeds, pull the tap and verify it updated. If it fails (because this is a major formula change), proceed to update the formula manually in Step 4.

- [ ] **Step 4: Update the formula with service block, post_install, and caveats**

Pull the latest tap, then replace `Formula/gmaps-sync.rb` with:

```ruby
class GmapsSync < Formula
  desc "One-way sync from Google Maps saved places to local JSON"
  homepage "https://github.com/strubio-ray/gmaps-sync"
  url "https://github.com/strubio-ray/gmaps-sync/archive/refs/tags/v0.2.0.tar.gz"
  sha256 "<PASTE_SHA256_HERE>"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "ci"
    system "npm", "run", "build"
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec/"bin/gmaps-sync"
  end

  def post_install
    old_plist = Pathname.new(Dir.home)/"Library/LaunchAgents/com.gmaps-sync.pull.plist"
    if old_plist.exist?
      opoo "Found old gmaps-sync scheduling plist at #{old_plist}"
      opoo "Remove it with: launchctl unload #{old_plist} && rm #{old_plist}"
      opoo "Then use: brew services start gmaps-sync"
    end
  end

  def caveats
    <<~EOS
      To start the daily sync:
        brew services start gmaps-sync

      If you previously used `gmaps-sync schedule`, remove the old plist first:
        launchctl unload ~/Library/LaunchAgents/com.gmaps-sync.pull.plist
        rm ~/Library/LaunchAgents/com.gmaps-sync.pull.plist
    EOS
  end

  service do
    run [opt_bin/"gmaps-sync", "pull"]
    run_type :cron
    cron "0 6 * * *"
    log_path var/"log/gmaps-sync/pull-stdout.log"
    error_log_path var/"log/gmaps-sync/pull-stderr.log"
  end

  test do
    assert_match "gmaps-sync", shell_output("#{bin}/gmaps-sync --help")
  end
end
```

Replace `<PASTE_SHA256_HERE>` with the hash from Step 2.

- [ ] **Step 5: Commit and push the formula**

```bash
cd /tmp/homebrew-tap
git pull
git add Formula/gmaps-sync.rb
git commit -m "feat: gmaps-sync 0.2.0 — brew services scheduling, remove schedule command"
git push
```

- [ ] **Step 6: Verify lint passes**

```bash
gh run watch --repo strubio-ray/homebrew-tap $(gh run list --repo strubio-ray/homebrew-tap --limit 1 --json databaseId --jq '.[0].databaseId')
```

Expected: Lint passes.

- [ ] **Step 7: Upgrade and verify**

```bash
brew update
brew upgrade gmaps-sync
brew services start gmaps-sync
brew services list | grep gmaps
```

Expected: Service shows as `started` with the cron schedule.
