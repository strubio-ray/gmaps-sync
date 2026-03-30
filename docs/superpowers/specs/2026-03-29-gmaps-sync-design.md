# gmaps-sync — Design Spec

## Purpose

A CLI tool that maintains a one-way sync from Google Maps saved places to a local JSON data store on a Mac Studio. Enables programmatic access to saved places for scripts, LLM querying, format conversion, and bulk management — while keeping the official Google Maps app as the primary UI.

Pull-only for MVP. The architecture supports adding a push engine later without rearchitecting.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       Mac Studio                             │
│                                                              │
│  ┌──────────┐      launchd plist      ┌──────────────────┐  │
│  │  launchd  │ ─── daily + jitter ──→ │  gmaps-sync pull │  │
│  └──────────┘                          └────────┬─────────┘  │
│                                                 │            │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Playwright + System Chrome               │   │
│  │         (persistent userDataDir session)              │   │
│  │                                                       │   │
│  │  1. Health check: verify logged-in state              │   │
│  │  2. Navigate to saved lists                           │   │
│  │  3. Intercept entitylist/getlist XHR responses        │   │
│  └──────────────────────┬───────────────────────────────┘   │
│                          │                                    │
│                          ▼                                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                 Schema-Based Parser                   │   │
│  │  schema.json defines array paths → field names        │   │
│  │  On failure: dump raw response to snapshots/          │   │
│  └──────────────────────┬───────────────────────────────┘   │
│                          │                                    │
│                          ▼                                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                   Diff Engine                         │   │
│  │  Compare parsed remote state against local store      │   │
│  │  Apply changes (add/update/flag removals)             │   │
│  └──────────────────────┬───────────────────────────────┘   │
│                          │                                    │
│                          ▼                                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                 Local Data Store                      │   │
│  │  data/                                                │   │
│  │    lists.json         — list metadata                 │   │
│  │    places/<id>.json   — one file per place            │   │
│  │    sync-state.json    — last sync, content hashes     │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Snapshots (debug/audit)                  │   │
│  │  snapshots/<timestamp>-<list-id>.json                 │   │
│  │  Raw responses preserved on every successful pull     │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Components

### 1. Session Manager (session.ts)

Manages browser lifecycle and authentication state.

**Init flow (`gmaps-sync init`):**

1. Launches Playwright Chromium in headed mode with `launchPersistentContext` using the profile's `browserProfileDir` (default: `~/.gmaps-sync/profiles/default/browser/`) as `userDataDir`
2. Navigates to `google.com/maps/saved`
3. User logs in manually (handles 2FA, CAPTCHAs naturally)
4. Tool watches for the URL to land on the saved places page (no login redirect)
5. Confirms success, stores initial session timestamp in `sync-state.json`
6. Closes browser

**Sync flow (headless):**

1. Launches Playwright Chromium in headless mode with the same `userDataDir`
2. Health check: navigates to `google.com/maps/saved`, waits for either content or a login redirect
3. If logged in: proceeds to pull
4. If logged out: records failure in `sync-state.json`, increments `consecutiveFailures` counter:
   - First failure: log warning, retry on next scheduled cycle
   - Second consecutive failure: send macOS notification via `osascript`, pause scheduling
   - User runs `gmaps-sync init` to re-authenticate, which resets the counter

**Account configuration:**

- `config.json` stores the account label (for logging/notifications only — auth is in the browser profile)
- To switch accounts: `gmaps-sync init --profile secondary` creates a separate `userDataDir`
- Default profile is `default`; all commands accept `--profile <name>`

**Stealth considerations:**

- Use `channel: 'chrome'` to use system-installed Chrome instead of bundled Chromium (avoids the `webdriver` flag and other Playwright-specific fingerprints)
- Add randomized delays (300ms-1s) between navigations
- Randomize viewport size slightly between sessions (within a realistic range)

### 2. Pull Engine (pull.ts)

Core data extraction pipeline. Runs on each sync cycle.

**Phase 1 — Fetch list metadata:**

1. Navigate to `google.com/maps/saved`
2. Set up network interception via `page.on('response')` to capture the response containing list data (names, internal IDs, item counts)
3. Wait for the page to settle (network idle or a timeout)
4. Parse the intercepted response using the schema-based parser
5. Update `data/lists.json`
6. Save raw response to `snapshots/`

**Phase 2 — Fetch each list's places:**

1. For each list from Phase 1, navigate to its page (`google.com/maps/saved/list/<id>`)
2. Intercept the `entitylist/getlist` response
3. Pagination handling: if the list has more items than one response contains, scroll to trigger additional loads and intercept each subsequent response
4. Parse all responses for this list, merge into a single place array
5. Save raw responses to `snapshots/`

**Phase 3 — Diff and store:**

1. Hand parsed data to the diff engine

**Request timing:**

- Randomized delay of 2-5 seconds between list page navigations
- Wait for network idle after each navigation before proceeding
- Total sync time for ~20 lists: roughly 1-3 minutes

**Error handling:**

- Parse failure on a single list: log error, save raw response to `snapshots/`, continue with remaining lists. The failed list retains its previous local data.
- Parse failure on all lists: likely a schema change. Log error with clear message ("Schema may be outdated — check snapshots/ for raw responses"), send macOS notification, mark sync as partial failure in `sync-state.json`.
- Network timeout: retry the page load once, then skip and log.
- Intercepted response is empty or missing: retry navigation once with a longer wait.

**What the pull does NOT do:**

- Call any external API (no Places API, no geocoding)
- Modify any data on Google Maps
- Store anything outside the profile's `data/` and `snapshots/` directories

### 3. Schema-Based Parser (parser.ts + schema.json)

The single most likely maintenance point, isolated for easy updates.

`schema.json` is a declarative mapping from field names to array paths within the raw response:

```json
{
  "version": 1,
  "responsePrefix": ")]}'\n",
  "lists": {
    "root": "[0]",
    "entries": "[0][1]",
    "entry": {
      "id": "[0]",
      "name": "[1]",
      "type": "[2]",
      "count": "[3]"
    }
  },
  "places": {
    "root": "[0]",
    "entries": "[0][8]",
    "entry": {
      "name": "[2]",
      "lat": "[1][5][2]",
      "lng": "[1][5][3]",
      "googleMapsUrl": "[1][0]",
      "comment": "[3]",
      "placeId": "[1][1]"
    }
  }
}
```

**Parsing behavior:**

1. Strip the XSSI prefix (the `)]}'` characters Google prepends to prevent direct JSON execution)
2. Parse the remaining string as JSON
3. Walk the array paths defined in the schema to extract each field
4. Type validation at each step: if a path resolves to `undefined` or an unexpected type, throw a descriptive error identifying exactly which field and path failed (e.g., `"places.entry.lat: expected number at [1][5][2], got undefined"`)
5. Return typed objects

**When Google changes the format:**

1. The parser throws a descriptive error
2. The raw response is in `snapshots/`
3. You open the snapshot, inspect the structure, find the new positions
4. Update `schema.json` — no code changes
5. Run `gmaps-sync pull` again

**Schema versioning:**

- `schema.json` is checked into the repo with a `version` field
- The parser logs which schema version it used on each pull
- `sync-state.json` records the schema version of the last successful pull
- If you update the schema, the next pull logs the version change

**Limitations:**

- The schema can handle positional changes (fields move to different indices)
- It cannot handle structural changes (e.g., arrays become objects, nesting depth changes)
- For structural changes, `parser.ts` itself needs updating — but the schema handles the common case

### 4. Diff Engine (diff.ts)

Compares parsed remote state against local store. Remote wins always (pull-only).

| Scenario | Action |
|---|---|
| Place exists remotely, not locally | Create `places/<id>.json` with `source: "pull"` |
| Place exists both, data unchanged | Update `lastSeenRemote` timestamp only |
| Place exists both, data changed | Overwrite with remote data, log what changed |
| Place exists locally, missing from remote | Flag as `removedRemote: true`, preserve local file |
| List exists remotely, not locally | Add to `lists.json` |
| List exists locally, missing from remote | Flag as `removedRemote: true` in `lists.json` |

**Key design decisions:**

- **Remote wins, always.** Google Maps is the source of truth.
- **Soft-delete for removals.** When a place disappears from Google Maps, we add a `removedRemote` flag and timestamp instead of deleting the local file. Prevents accidental data loss. `gmaps-sync prune` hard-deletes flagged places when the user is ready.
- **Change detection via content hash.** Each place file stores a `contentHash` (SHA-256 of the parsed remote fields, excluding local-only metadata like `lastSeenRemote`). On each pull, we hash the new data and compare. No hash change = no write. Keeps `lastModified` timestamps meaningful and avoids unnecessary disk writes.
- **Atomic writes.** Use `write-file-atomic` for all file writes to prevent corruption if the process is interrupted mid-sync.

**Future push extensibility:**

When push is added later, this engine gains a `source` field check:

- `source: "pull"` + remote disappeared: safe to flag as removed
- `source: "local"` + not yet on remote: pending push, don't flag

That is the only change needed. The soft-delete pattern already preserves the data either way.

### 5. Store (store.ts)

Handles all file I/O for the data directory.

- Atomic writes via `write-file-atomic`
- Read/write individual place files by ID
- Read/write `lists.json` and `sync-state.json`
- Snapshot management: save raw responses, clean up old snapshots based on `snapshotsRetentionDays`
- All paths resolved relative to the active profile's `dataDir`

### 6. Notifications (notifications.ts)

macOS notifications via `osascript -e 'display notification ...'`.

Triggered on:

- Session expired (second consecutive failure)
- Schema parse failure across all lists
- Optionally on sync complete (disabled by default)

## Data Model

### data/lists.json

```json
[
  {
    "id": "list_abc123",
    "name": "Want to go",
    "type": "WANT_TO_GO",
    "count": 35,
    "lastSeenRemote": "2026-03-29T12:00:00Z",
    "removedRemote": false
  }
]
```

### data/places/\<place-id\>.json

```json
{
  "id": "ChIJ...",
  "name": "Empire Café",
  "coordinates": { "lat": 29.7504, "lng": -95.3698 },
  "googleMapsUrl": "https://www.google.com/maps/place/...",
  "lists": ["list_abc123"],
  "comment": "Great breakfast tacos",
  "source": "pull",
  "contentHash": "sha256:a1b2c3...",
  "firstSeen": "2026-03-29T12:00:00Z",
  "lastSeenRemote": "2026-03-29T12:00:00Z",
  "removedRemote": false
}
```

### data/sync-state.json

```json
{
  "lastPull": "2026-03-29T12:00:00Z",
  "lastPullStatus": "success",
  "schemaVersion": 1,
  "consecutiveFailures": 0,
  "profile": "default"
}
```

**Design notes:**

- `lists` in place files stores list IDs, not names. Names can change; IDs are stable. Resolved via `lists.json` for display.
- `comment` (not `notes`) matches what Google's response calls this field.
- `firstSeen` tracks when a place was first pulled. `lastSeenRemote` tracks the most recent pull that included it.

## CLI Interface

| Command | Description |
|---|---|
| `gmaps-sync init [--profile <name>]` | First-time setup: opens headed browser for Google login, creates data/ directory |
| `gmaps-sync pull [--profile <name>]` | On-demand pull from Google Maps |
| `gmaps-sync status [--profile <name>]` | Show last sync time, place count, any warnings |
| `gmaps-sync prune [--dry-run]` | Remove local files for places flagged `removedRemote` |
| `gmaps-sync schema-check` | Validate current schema.json against a test pull (dry run, no data written) |

**Future commands (not in MVP):**

- `push` / `queue` for write-back
- `export` for format conversion (GeoJSON, KML, CSV)
- `serve` for an MCP server
- `search` / `query` for local searching

## Scheduling

A `com.gmaps-sync.pull.plist` installed to `~/Library/LaunchAgents/`:

- Runs `gmaps-sync pull` once daily
- Jitter: the tool sleeps for a random 0-60 minutes at the start of each run before doing anything, avoiding a predictable cron pattern
- `StandardOutPath` and `StandardErrorPath` point to `~/.gmaps-sync/logs/`
- `gmaps-sync init` installs the plist

## Configuration (~/.gmaps-sync/config.json)

```json
{
  "profiles": {
    "default": {
      "browserProfileDir": "~/.gmaps-sync/profiles/default/browser",
      "dataDir": "~/.gmaps-sync/profiles/default/data"
    }
  },
  "sync": {
    "intervalHours": 24,
    "jitterMinutes": 60,
    "delayBetweenListsMs": [2000, 5000],
    "navigationTimeoutMs": 30000,
    "retryOnSessionFailure": true
  },
  "notifications": {
    "onSessionExpired": true,
    "onSchemaFailure": true,
    "onSyncComplete": false
  },
  "headless": true,
  "useSystemChrome": true,
  "snapshotsRetentionDays": 30
}
```

**All state lives under `~/.gmaps-sync/`** — browser profiles, data, logs, config. Snapshots live under each profile's data directory (e.g., `~/.gmaps-sync/profiles/default/data/snapshots/`).

## Project Structure

```
gmaps-sync/
  src/
    cli.ts              — Commander-based CLI entry point
    config.ts           — Load/validate config, resolve paths
    session.ts          — Playwright browser lifecycle, health checks
    pull.ts             — Navigation, network interception, orchestration
    parser.ts           — Schema-driven response parsing
    diff.ts             — Compare remote vs local, apply changes
    store.ts            — Atomic file read/write, data directory management
    notifications.ts    — macOS notifications via osascript
    types.ts            — Shared TypeScript interfaces
  schema.json           — Parser field mappings (checked into repo)
  package.json
  tsconfig.json
  vitest.config.ts
  README.md
```

## Tech Stack

| Dependency | Purpose |
|---|---|
| TypeScript | Type safety, especially for nested response parsing |
| Playwright | Browser automation, network interception, persistent sessions |
| Commander | CLI framework |
| write-file-atomic | Safe file writes |
| vitest | Testing |
**Not in the stack:**

- No Stagehand / no LLM dependency — pull-only needs no AI-powered UI interaction
- No database — JSON files only
- No Homebrew formula — npm global install for MVP
- No bundled Chromium — uses system Chrome by default

## Testing Strategy

- **Parser tests are the priority.** Snapshot raw responses from real pulls, use them as fixtures. When Google changes the format, the failing test shows exactly what broke.
- **Diff engine tests** with synthetic before/after states.
- **Session and pull are integration tests** — tested manually or with mocked responses.

## Key Design Decisions

1. **Pull-only for MVP.** Bidirectional sync carries high complexity and account risk with no official write API. Push can be layered on later via a pending-ops queue and browser automation module without changing the pull pipeline or data model.
2. **Network interception over DOM scraping.** The entitylist/getlist response contains structured data. Parsing JSON arrays is more stable than CSS selectors and costs zero LLM tokens.
3. **Schema-based parser.** Declarative field mappings in `schema.json` mean the most common breakage (positional changes in Google's response) can be fixed with a config update, not a code change.
4. **Raw response snapshots.** Every pull preserves the raw responses. Provides an audit trail and makes format changes easy to diagnose by comparing before/after snapshots.
5. **Soft-delete for removals.** Places that disappear from Google Maps are flagged, not deleted. Prevents accidental data loss. `gmaps-sync prune` cleans up when the user is ready.
6. **JSON files over SQLite.** At this scale, individual JSON files are simpler, human-readable, git-diffable, and easy for other tools to consume.
7. **System Chrome over bundled Chromium.** Reduces bot detection fingerprint by using the same browser binary the user normally runs.
8. **Daily sync with jitter.** Balances freshness against detection risk. Randomized timing avoids predictable automation patterns.

## What's NOT in MVP

- Push engine / write-back to Google Maps
- Browser extension for real-time capture
- MCP server for LLM querying
- Web UI
- Format export (GeoJSON, KML, CSV)
- Automatic schema repair (LLM-assisted parsing)
- Homebrew formula
- Multi-device sync of local store

All of these can be layered on later without rearchitecting.
