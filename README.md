# gmaps-sync

One-way sync from Google Maps saved places to a local JSON data store. Runs daily on macOS via launchd, using Playwright to scrape Google Maps API responses.

## Install

```bash
brew tap strubio-ray/tap
brew install gmaps-sync
```

Requires Google Chrome (`brew install --cask google-chrome`).

## Setup

### 1. Authenticate

Run on a machine with a display (or via screen sharing):

```bash
gmaps-sync init
```

This opens Chrome for you to log into your Google account. Navigate to your saved places — the tool detects the login automatically and saves the browser session.

### 2. Test a pull

```bash
gmaps-sync pull
```

Fetches all your saved lists and places, storing them as individual JSON files under `~/.gmaps-sync/profiles/default/data/`.

### 3. Verify

```bash
gmaps-sync status
```

Shows last pull time, sync status, list count, and place count.

### 4. Schedule daily sync

```bash
gmaps-sync schedule
```

Installs a launchd job that runs `pull` daily at 6:00 AM with random jitter (0-60 min).

To remove the schedule:

```bash
gmaps-sync schedule --remove
```

## Commands

| Command | Description |
|---------|-------------|
| `init` | First-time setup: opens browser for Google login |
| `pull` | Pull saved places from Google Maps |
| `status` | Show sync status |
| `prune` | Remove locally flagged-as-removed places |
| `schema-check` | Validate schema against a test pull (dry run) |
| `schedule` | Install or remove the daily sync schedule |

All commands accept `--profile <name>` (default: `"default"`) for multi-account support.

### Pull options

- `--headed` — Run browser in headed mode for debugging
- `--force` — Bypass the consecutive failure guard

## How it works

1. Launches a headless Chrome session using your saved browser profile
2. Navigates to Google Maps saved places and intercepts API responses
3. Parses list metadata and place details using a declarative schema (`schema.json`)
4. Diffs remote data against local store using SHA-256 content hashes
5. Writes changes as individual JSON files (one per place) with atomic writes

### Failure handling

- **Per-list isolation** — One list failing doesn't stop the sync
- **Consecutive failure guard** — After 2 consecutive session failures, sync pauses automatically. Use `--force` to bypass, or re-run `init` to re-authenticate
- **Soft deletes** — Places missing from remote are flagged `removedRemote: true`, not deleted. Use `prune` to review and remove

## Data layout

```
~/.gmaps-sync/
├── config.json                          # Optional config overrides
├── logs/
│   ├── pull-stdout.log                  # launchd stdout
│   └── pull-stderr.log                  # launchd stderr
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

## Configuration

Create `~/.gmaps-sync/config.json` to override defaults:

```json
{
  "sync": {
    "intervalHours": 24,
    "jitterMinutes": 60,
    "delayBetweenListsMs": [2000, 5000],
    "navigationTimeoutMs": 30000,
    "maxConsecutiveFailures": 2
  },
  "headless": true,
  "useSystemChrome": true,
  "snapshotsRetentionDays": 30
}
```

## Schema updates

When Google changes their API response format, update the array index paths in `schema.json` and bump the `version` field. Check `~/.gmaps-sync/profiles/default/data/snapshots/` for raw responses to debug against.

## Development

```bash
git clone https://github.com/strubio-ray/gmaps-sync.git
cd gmaps-sync
npm install
npm test             # Run tests
npm run dev -- pull  # Run CLI without building
npm run build        # Compile TypeScript
```

## License

MIT
