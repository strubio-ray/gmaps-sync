# AGENTS.md

This file provides guidance to coding agents (Claude Code and others) when working with code in this repository. This repo follows Rubio-Enterprises standards — run `/audit-standards` from a Claude Code session to check conformance.

## Project Overview

**gmaps-sync** is a CLI tool that maintains a one-way sync from Google Maps saved places to a local JSON data store. It uses Playwright for browser automation to scrape Google Maps API responses, parse them via a schema-driven approach, and persist places as individual JSON files.

Target platform: macOS. Scheduling via `brew services` (Homebrew service DSL).

## Repository Layout

This is a pnpm workspace monorepo (`pnpm-workspace.yaml` → `packages/*`). All
source lives under `packages/`, split across five private workspace packages
that depend on each other via `workspace:*`. TypeScript is ESM throughout
(Node16 module resolution).

```
├── packages/
│   ├── cli/         # @gmaps/cli — Commander.js entry point; bin `places` → dist/cli.js
│   ├── core/        # @gmaps/core — config, db (drizzle), schema, migrate, embedding, types
│   ├── sync/        # @gmaps/sync — pull pipeline: session, pull, parser, diff, snapshots
│   ├── discovery/   # @gmaps/discovery
│   └── push/        # @gmaps/push
├── packages/sync/schema.json   # Declarative field mapping for Google API responses
├── drizzle.config.ts
├── pnpm-workspace.yaml
├── tsconfig.base.json / tsconfig.json
└── vitest.config.ts
```

## Build & Development Commands

This repo uses **pnpm** (the authoritative package manager — `pnpm-lock.yaml`).

```bash
pnpm install                 # install workspace deps
pnpm -r build                # tsc -b across all packages → dist/
pnpm test                    # vitest run (root script)
pnpm test:watch              # vitest watch mode
pnpm lint                    # tsc -b --noEmit (type checking only)
```

Run a single test file:

```bash
pnpm vitest run packages/sync/tests/parser.test.ts
```

## Architecture

### Data Flow (Pull Pipeline)

1. **session.ts** — Launches Playwright persistent browser context with stealth settings (randomized viewport, system Chrome, no automation flags). Manages Google login via `init` (headed) and session health checks.
2. **pull.ts** — Orchestrates 3-phase extraction: fetch list metadata via `mas` endpoint → fetch each list's places via `entitylist/getlist` with pagination → apply diff to local store. Random delays between requests.
3. **parser.ts** — Schema-driven parsing. `schema.json` maps array index paths (e.g., `[1][5][2]`) to named fields. Strips XSSI prefix from responses. All parsing is declarative — no hardcoded indices.
4. **diff.ts** — Compares remote vs. local using SHA-256 content hashes. Tracks additions, updates, and soft-deletes (`removedRemote` flag). Never re-flags already-removed items.
5. **packages/core/db.ts** — SQLite persistence (better-sqlite3 + drizzle-orm, WAL mode) under `~/.gmaps-sync/profiles/<name>/`. Schema lives in `packages/core/src/schema.ts`; migrations in `migrate.ts`.
6. **packages/sync/snapshots.ts** — Timestamped snapshots of raw API responses for audit/debugging, with retention-based cleanup.

### Supporting Modules

- **packages/core/config.ts** — JSON config at `~/.gmaps-sync/config.json` with defaults. Multi-profile support (isolated browser sessions and data dirs per Google account).
- **packages/cli/cli.ts** — Commander.js entry point (bin `places`). Commands include `init`, `pull`, `status`, `prune`, `schema-check`.

### Key Design Decisions

- **Schema-driven parsing**: Single maintenance point when Google changes API response structure. Version field enables compatibility tracking.
- **Snapshot audit trail**: Raw API responses saved on every pull for debugging schema changes.
- **Soft deletes**: Places missing from remote are flagged `removedRemote: true`, not deleted. `prune` command handles actual removal.
- **Per-list error isolation**: One list failing doesn't stop the sync.
- **Consecutive failure guard**: After `maxConsecutiveFailures` (default: 2) consecutive session failures, `pull()` exits early without launching a browser. Use `--force` to bypass.

## Test Structure

Tests live in each package's `tests/` dir (`packages/sync/tests/`, `packages/core/tests/`) and cover parser, diff, config, db, embedding, and enrichment modules. Test fixtures in `packages/sync/tests/fixtures/` contain real (anonymized) API response samples. Vitest globals are enabled — no imports needed for `describe`, `it`, `expect`.

## Important Conventions

- **ESM throughout**: All imports use `.js` extensions (TypeScript Node16 module resolution). New files must follow this pattern.
- **`--profile` flag**: Every CLI command accepts `--profile <name>` (default: `"default"`). Profiles provide isolated browser sessions and data directories per Google account.
- **Runtime data**: All user data lives under `~/.gmaps-sync/` — config, per-profile browser state, and per-profile place data. Never hardcode paths; use `config.ts` helpers (`BASE_DIR`, `resolveProfilePaths`).
- **Schema updates**: When Google changes API response structure, update `packages/sync/schema.json` array index paths and bump the `version` field. The parser reads the schema at startup — no code changes needed for path adjustments.
- **`schema.json` loads relative to `dist/`**: `packages/sync/src/parser.ts` resolves it via `join(__dirname, "..", "schema.json")`, so it expects `schema.json` at the `@gmaps/sync` package root relative to `dist/parser.js`. This works both in `tsx` dev mode and after `tsc` build.
