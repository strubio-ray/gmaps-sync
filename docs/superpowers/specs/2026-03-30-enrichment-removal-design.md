# Enrichment Feature Removal

**Date:** 2026-03-30
**Status:** Approved

## Summary

Remove the enrichment feature entirely from the project. Enrichment was disabled in commit `bf1adcb` because the new Google Maps API placeId format (numeric pair) is incompatible with the Google Places API. Rather than implement a new lookup strategy, the feature is being removed to reduce complexity.

## Motivation

- Enrichment has been non-functional since the API format migration
- Re-enabling it would require a new lookup strategy (placeRef or name+coords) that adds complexity with unclear value
- Removing dead code keeps the codebase lean and maintainable

## Scope

### Delete entirely

| File | Reason |
|------|--------|
| `src/enrich.ts` | Enrichment module (shouldEnrich, enrichPlaces, fetchPlaceDetails) |
| `tests/enrich.test.ts` | Enrichment tests |

### Modify

| File | Change |
|------|--------|
| `src/types.ts` | Remove `EnrichedData` interface, `EnrichmentConfig` interface, `Place.enriched` field |
| `src/config.ts` | Remove `enrichment` from default config and config merge logic |
| `src/cli.ts` | Remove `enrich` command, its import, and all related options/handler code |
| `src/diff.ts` | Remove `enriched: null` initialization on new places |
| `tests/diff.test.ts` | Remove `enriched: null` from mock places |
| `tests/store.test.ts` | Remove `enriched: null` from mock places |

### Documentation

| File | Change |
|------|--------|
| `docs/superpowers/specs/2026-03-29-gmaps-sync-design.md` | Remove enrichment section and all references |
| `docs/superpowers/specs/2026-03-30-api-response-format-update.md` | Remove enrichment mentions |
| `docs/superpowers/plans/2026-03-30-api-response-format-update.md` | Remove enrichment tasks |

### No action needed

- **npm dependencies:** Enrichment used built-in `fetch`; nothing to uninstall
- **Stored data files:** `~/.gmaps-sync/` has no data files yet, so no migration required

## Verification

- All tests pass after removal
- `npx tsc --noEmit` compiles cleanly
- No remaining references to "enrich" in src/ or tests/
