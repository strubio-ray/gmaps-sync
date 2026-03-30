# Enrichment Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completely remove the enrichment feature from the codebase — all code, types, config, tests, CLI commands, and documentation references.

**Architecture:** Deletion-first approach. Remove the enrichment module and tests entirely, then surgically edit the files that reference enrichment types or config. Documentation updated last.

**Tech Stack:** TypeScript, vitest

---

### Task 1: Remove enrichment module and tests

**Files:**
- Delete: `src/enrich.ts`
- Delete: `tests/enrich.test.ts`

- [ ] **Step 1: Delete the enrichment source file**

```bash
rm src/enrich.ts
```

- [ ] **Step 2: Delete the enrichment test file**

```bash
rm tests/enrich.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor: remove enrichment module and tests"
```

---

### Task 2: Remove enrichment types

**Files:**
- Modify: `src/types.ts`

The `EnrichedData` interface (lines 15-22), `Place.enriched` field (line 36), `EnrichmentConfig` interface (lines 60-62), and `AppConfig.enrichment` field (line 73) must all be removed.

- [ ] **Step 1: Remove the `EnrichedData` interface**

In `src/types.ts`, remove these lines:

```typescript
export interface EnrichedData {
  address: string;
  phone: string | null;
  rating: number | null;
  priceLevel: string | null;
  category: string | null;
  enrichedAt: string;
}
```

- [ ] **Step 2: Remove the `enriched` field from `Place`**

In `src/types.ts`, in the `Place` interface, remove:

```typescript
  enriched: EnrichedData | null;
```

- [ ] **Step 3: Remove the `EnrichmentConfig` interface**

In `src/types.ts`, remove:

```typescript
export interface EnrichmentConfig {
  googlePlacesApiKey: string | null;
}
```

- [ ] **Step 4: Remove the `enrichment` field from `AppConfig`**

In `src/types.ts`, in the `AppConfig` interface, remove:

```typescript
  enrichment: EnrichmentConfig;
```

- [ ] **Step 5: Verify TypeScript compiles (expect errors in config.ts, cli.ts, diff.ts)**

```bash
npx tsc --noEmit 2>&1 || true
```

Expected: errors in `config.ts`, `cli.ts`, and `diff.ts` referencing removed types. These will be fixed in subsequent tasks.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts
git commit -m "refactor: remove enrichment types from types.ts"
```

---

### Task 3: Remove enrichment from config

**Files:**
- Modify: `src/config.ts`

Remove the `enrichment` block from `DEFAULT_CONFIG` and the merge line in `loadConfig`.

- [ ] **Step 1: Remove `enrichment` from `DEFAULT_CONFIG`**

In `src/config.ts`, remove these lines from the `DEFAULT_CONFIG` object:

```typescript
  enrichment: {
    googlePlacesApiKey: null,
  },
```

- [ ] **Step 2: Remove `enrichment` merge from `loadConfig`**

In `src/config.ts`, in the `loadConfig` function's return statement, remove:

```typescript
    enrichment: { ...DEFAULT_CONFIG.enrichment, ...partial.enrichment },
```

- [ ] **Step 3: Remove `EnrichmentConfig` from the import if present**

In `src/config.ts`, line 4 currently imports from `./types.js`. If `EnrichmentConfig` is in the import, remove it. (Currently it only imports `AppConfig` and `ProfileConfig`, so this may be a no-op.)

- [ ] **Step 4: Commit**

```bash
git add src/config.ts
git commit -m "refactor: remove enrichment config"
```

---

### Task 4: Remove enrich command from CLI

**Files:**
- Modify: `src/cli.ts`

Remove the `enrichPlaces` import and the entire `enrich` command block.

- [ ] **Step 1: Remove the `enrichPlaces` import**

In `src/cli.ts`, remove this line:

```typescript
import { enrichPlaces } from "./enrich.js";
```

- [ ] **Step 2: Remove the `enrich` command block**

In `src/cli.ts`, remove the entire `// --- enrich ---` section (lines 105-143):

```typescript
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
```

- [ ] **Step 3: Verify TypeScript compiles cleanly (expect only diff.ts errors remain)**

```bash
npx tsc --noEmit 2>&1 || true
```

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "refactor: remove enrich command from CLI"
```

---

### Task 5: Remove enrichment from diff engine

**Files:**
- Modify: `src/diff.ts`

Remove the `enriched: null` field from new place initialization.

- [ ] **Step 1: Remove `enriched: null` from the new place object**

In `src/diff.ts`, in the `applyDiff` function, find the new `Place` object (around line 89-102) and remove:

```typescript
        enriched: null,
```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

```bash
npx tsc --noEmit
```

Expected: success with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/diff.ts
git commit -m "refactor: remove enriched field from diff engine"
```

---

### Task 6: Update test mock objects

**Files:**
- Modify: `tests/diff.test.ts`
- Modify: `tests/store.test.ts`

Remove `enriched: null` from all mock `Place` objects in both test files.

- [ ] **Step 1: Remove `enriched: null` from diff test mocks**

In `tests/diff.test.ts`, remove `enriched: null,` from each mock `Place` object. There are 3 occurrences at lines 85, 123, and 147.

- [ ] **Step 2: Remove `enriched: null` from store test mocks**

In `tests/store.test.ts`, remove `enriched: null,` from each mock `Place` object. There are 2 occurrences at lines 73 and 94.

- [ ] **Step 3: Run all tests**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/diff.test.ts tests/store.test.ts
git commit -m "test: remove enriched field from mock place objects"
```

---

### Task 7: Update documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-03-29-gmaps-sync-design.md`
- Modify: `docs/superpowers/specs/2026-03-30-api-response-format-update.md`
- Modify: `docs/superpowers/plans/2026-03-30-api-response-format-update.md`

- [ ] **Step 1: Update the main design spec**

In `docs/superpowers/specs/2026-03-29-gmaps-sync-design.md`:

1. Remove the "Enrichment (on-demand)" box from the architecture diagram (lines 52-55):

```
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Enrichment (on-demand)                   │   │
│  │  gmaps-sync enrich — calls Google Places API          │   │
│  │  Fills: address, phone, rating, category              │   │
│  └──────────────────────────────────────────────────────┘   │
```

2. Remove "Section 5. Enrichment" (lines 239-248):

```markdown
### 5. Enrichment (enrich.ts)

On-demand command, not part of the pull pipeline.

- Calls Google Places API to fill in: full address, phone, rating, priceLevel, category
- Uses coordinates or Google Maps URL to look up the Place ID, then fetches details
- Runs once per place, cached in the `enriched` field with an `enrichedAt` timestamp
- Skips re-enrichment unless `--force` is passed
- Requires `enrichment.googlePlacesApiKey` in config (null by default)
- Cost: ~$17 per 1000 Place Details requests
```

3. Remove `"enriched": null` from the place JSON example (line 302) and the enriched example block (lines 306-317):

```markdown
  "enriched": null
}
```

And:

```markdown
The `enriched` field is `null` by default. After `gmaps-sync enrich`:

\```json
"enriched": {
  "address": "1732 Westheimer Rd, Houston, TX 77098",
  "phone": "+1 713-555-1234",
  "rating": 4.5,
  "priceLevel": "$10-20",
  "category": "Cafe",
  "enrichedAt": "2026-03-29T14:00:00Z"
}
\```
```

4. Remove the `gmaps-sync enrich` row from the CLI table (line 344):

```markdown
| `gmaps-sync enrich [--all\|--list <id>\|--place <id>]` | Enrich places via Google Places API |
```

5. Remove the `enrichment` block from the config JSON example (lines 381-383):

```json
  "enrichment": {
    "googlePlacesApiKey": null
  },
```

6. Remove `enrich.ts` from the project structure listing (line 408):

```
    enrich.ts           — Google Places API enrichment
```

7. Remove the `@googlemaps/google-maps-services-js` row from the tech stack table (line 428):

```markdown
| @googlemaps/google-maps-services-js | Places API enrichment (optional, used by `enrich` only) |
```

8. Remove "On-demand enrichment" from key design decisions (line 452):

```markdown
8. **On-demand enrichment.** Keeps the pull pipeline free of external API dependencies and costs. Users opt into enrichment when they need it.
```

- [ ] **Step 2: Update the API response format update spec**

In `docs/superpowers/specs/2026-03-30-api-response-format-update.md`, remove the "Enrichment" section (lines 105-107):

```markdown
## Enrichment (`enrich.ts`)

The new `placeId` (numeric ID pair) is not a valid Google Places API `place_id`. The `enrich` command currently passes `placeId` directly to the Places API `place_id` parameter, which expects `ChIJ...` format. For now, disable the `placeId`-based lookup in `enrich.ts` and use the `placeRef` field (`/g/...` reference) or name+coordinates as the lookup strategy. Document enrichment as degraded until a proper Places API integration is revisited.
```

Also remove the `enrich.ts` row from the files changed table (line 134):

```markdown
| `src/enrich.ts` | Disable `placeId`-based Places API lookup, use `placeRef` or name+coords |
```

And remove `enrich.test.ts` from the test changes section (line 121):

```markdown
- `enrich.test.ts`: update `makePlace()` helper to match new `Place` type (remove `googleMapsUrl`, add `address`)
```

- [ ] **Step 3: Update the API response format update plan**

In `docs/superpowers/plans/2026-03-30-api-response-format-update.md`, remove all enrichment references:

1. Remove `enriched: EnrichedData | null;` from the Place type definition (line 72)
2. Remove `enriched: null,` from all mock Place objects (lines 448, 552, 590, 614, 724)
3. Remove Task 5's enrich test content (lines 671-739 — the section about `tests/enrich.test.ts`)
4. Remove Task 6 entirely (lines 744-774 — "Update enrich.ts for new placeId format")

- [ ] **Step 4: Commit**

```bash
git add docs/
git commit -m "docs: remove all enrichment references from documentation"
```

---

### Task 8: Final verification

- [ ] **Step 1: TypeScript compilation check**

```bash
npx tsc --noEmit
```

Expected: clean compilation with no errors.

- [ ] **Step 2: Run all tests**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 3: Grep for any remaining enrichment references in src/ and tests/**

```bash
grep -ri "enrich" src/ tests/ || echo "No enrichment references found"
```

Expected: "No enrichment references found"

- [ ] **Step 4: Verify no remaining imports of deleted module**

```bash
grep -r "enrich" src/*.ts || echo "Clean"
```

Expected: "Clean"
