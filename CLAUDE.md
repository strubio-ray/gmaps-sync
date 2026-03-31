# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**gmaps-sync** is a CLI tool that maintains a one-way sync from Google Maps saved places to a local JSON data store. It uses Playwright for browser automation to scrape Google Maps API responses, parse them via a schema-driven approach, and persist places as individual JSON files.

Target platform: macOS. Scheduling via `brew services` (Homebrew service DSL).

## Repository Layout

All source code lives on the `main` branch at the repo root.

```
├── src/          # TypeScript source (ESM, Node16 module resolution)
├── tests/        # Vitest tests + fixtures/
├── schema.json   # Declarative field mapping for Google API responses
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Build & Development Commands

```bash
npm run build        # tsc → dist/
npm run dev          # Run CLI via tsx (no build step)
npm test             # Vitest single run
npm run test:watch   # Vitest watch mode
npm run lint         # tsc --noEmit (type checking only)
```

Run a single test file:
```bash
npx vitest run tests/parser.test.ts
```

## Architecture

### Data Flow (Pull Pipeline)

1. **session.ts** — Launches Playwright persistent browser context with stealth settings (randomized viewport, system Chrome, no automation flags). Manages Google login via `init` (headed) and session health checks.
2. **pull.ts** — Orchestrates 3-phase extraction: fetch list metadata via `mas` endpoint → fetch each list's places via `entitylist/getlist` with pagination → apply diff to local store. Random delays between requests.
3. **parser.ts** — Schema-driven parsing. `schema.json` maps array index paths (e.g., `[1][5][2]`) to named fields. Strips XSSI prefix from responses. All parsing is declarative — no hardcoded indices.
4. **diff.ts** — Compares remote vs. local using SHA-256 content hashes. Tracks additions, updates, and soft-deletes (`removedRemote` flag). Never re-flags already-removed items.
5. **store.ts** — File-per-place persistence under `~/.gmaps-sync/profiles/<name>/data/`. Uses `write-file-atomic` for crash safety. Also manages `lists.json`, `sync-state.json`, and timestamped snapshots of raw API responses.

### Supporting Modules

- **config.ts** — JSON config at `~/.gmaps-sync/config.json` with defaults. Multi-profile support (isolated browser sessions and data dirs per Google account).
- **cli.ts** — Commander.js entry point. Commands: `init`, `pull`, `status`, `prune`, `schema-check`.

### Key Design Decisions

- **Schema-driven parsing**: Single maintenance point when Google changes API response structure. Version field enables compatibility tracking.
- **Snapshot audit trail**: Raw API responses saved on every pull for debugging schema changes.
- **Soft deletes**: Places missing from remote are flagged `removedRemote: true`, not deleted. `prune` command handles actual removal.
- **Per-list error isolation**: One list failing doesn't stop the sync.
- **Consecutive failure guard**: After `maxConsecutiveFailures` (default: 2) consecutive session failures, `pull()` exits early without launching a browser. Use `--force` to bypass.

## Test Structure

Tests cover parser, diff, store, and config modules. Test fixtures in `tests/fixtures/` contain real (anonymized) API response samples. Vitest globals are enabled — no imports needed for `describe`, `it`, `expect`.

## Important Conventions

- **ESM throughout**: All imports use `.js` extensions (TypeScript Node16 module resolution). New files must follow this pattern.
- **`--profile` flag**: Every CLI command accepts `--profile <name>` (default: `"default"`). Profiles provide isolated browser sessions and data directories per Google account.
- **Runtime data**: All user data lives under `~/.gmaps-sync/` — config, per-profile browser state, and per-profile place data. Never hardcode paths; use `config.ts` helpers (`BASE_DIR`, `resolveProfilePaths`).
- **Schema updates**: When Google changes API response structure, update `schema.json` array index paths and bump the `version` field. The parser reads the schema at startup — no code changes needed for path adjustments.
- **`schema.json` loads relative to `dist/`**: `parser.ts` resolves schema.json via `join(__dirname, "..", "schema.json")`, which means it expects `schema.json` at the package root relative to `dist/parser.js`. This works both in `tsx` dev mode and after `tsc` build.
