# API Response Format Update

## Context

Google has removed the `/maps/saved` URL (returns 404). Saved places are now accessed via the main Maps UI with data parameters, and the backend uses different API endpoints. The current parser, pull engine, and session code are all built around the old URL and response format. This update adapts the codebase to the new endpoints and response structures while keeping the existing schema-driven parser architecture.

## New API Endpoints

### Lists: `locationhistory/preview/mas`

- **URL**: `https://www.google.com/locationhistory/preview/mas?authuser=0&hl=en&gl=us&pb=...`
- **Response**: Plain JSON array (no XSSI `)]}'` prefix)
- **Contains**: All saved lists with metadata (name, ID, type, count, timestamps, emoji)
- **Session token**: Embedded in the request URL at `!1s<token>` — changes per session, must be extracted at runtime

### Places: `maps/preview/entitylist/getlist`

- **URL**: `https://www.google.com/maps/preview/entitylist/getlist?authuser=0&hl=en&gl=us&pb=...`
- **Response**: Plain JSON array
- **Contains**: All places within a single list
- **URL template**: `!1m4!1s${listId}!2e1!3m1!1e1!2e2!3e${listType}!4i500!6m3!1s${sessionToken}!7e81!28e2!8i3!16b1`
  - `listId`: from `mas` response `[0][0]`
  - `listType`: from `mas` response `[0][1]`
  - `sessionToken`: extracted from intercepted `mas` request URL

## Schema Changes (`schema.json` v2)

### Lists (from `mas` response)

- Root: `[29][3]`
- Entry fields:
  - `id`: `[0][0]` — list ID string
  - `name`: `[4]` — list name
  - `type`: `[0][1]` — numeric (1=user-created, 2=favorites, 3=want-to-go, 5=travel-plans, 6=saved-places)
  - `count`: `[12]` — place count

### Places (from `getlist` response)

- Root: `[0]`
- Entries: `[0][8]`
- Entry fields:
  - `name`: `[2]`
  - `lat`: `[1][5][2]`
  - `lng`: `[1][5][3]`
  - `address`: `[1][2]` (new field)
  - `comment`: `[3]`
  - `placeId`: concat of `[1][6][0]` + `_` + `[1][6][1]` (numeric ID pair as stable key)
  - `placeRef`: `[1][7]` (the `/g/...` reference, optional)

### Removed

- `responsePrefix` — new responses are plain JSON
- `googleMapsUrl` — not present in new response format

## Type Changes

### `ParsedList`

- `type`: `string` → `number`

### `ParsedPlace`

- Remove `googleMapsUrl`
- Add `address: string`
- `placeId` becomes the numeric ID pair string (e.g., `"-8772799911369865815_-4757512616063040366"`)

### `ListMetadata`

- `type`: `string` → `number` (same change as `ParsedList`)

### `Place`

- Remove `googleMapsUrl`
- Add `address: string`

### Content hash

- Updated fields: `{name, lat, lng, address, comment, placeId}` (replaces `googleMapsUrl` with `address`)
- All existing places will get new hashes on first pull — acceptable since this is pre-release

## Session Changes (`session.ts`)

- `SAVED_PLACES_URL` → `https://www.google.com/maps/@0,0,2z/data=!4m2!10m1!1e1`
- `initSession`: verify login by waiting for `mas` network request (replaces URL pattern matching)
- `checkSession`: same — use `mas` request as login verification signal

## Pull Engine Changes (`pull.ts`)

### New flow

1. `checkSession` confirms login, returns `context` and `page`
2. Navigate to saved places URL
3. Intercept `mas` **request** URL → extract session token
4. Intercept `mas` **response** → parse lists
5. For each list: construct `getlist` URL → `page.evaluate(fetch)` → parse places
6. Apply diff

### Key changes

- Phase 2 uses `page.evaluate(fetch)` instead of `page.goto()` — keeps Maps page loaded, lower bot detection risk, better performance
- No scroll-to-paginate logic — `getlist` `!4i500` param requests up to 500 places per call
- Session token extracted from intercepted `mas` request URL pattern `!1s<token>`
- `getlist` URL constructed from template using `listId`, `listType`, `sessionToken`

## Enrichment (`enrich.ts`)

The new `placeId` (numeric ID pair) is not a valid Google Places API `place_id`. The `enrich` command currently passes `placeId` directly to the Places API `place_id` parameter, which expects `ChIJ...` format. For now, disable the `placeId`-based lookup in `enrich.ts` and use the `placeRef` field (`/g/...` reference) or name+coordinates as the lookup strategy. Document enrichment as degraded until a proper Places API integration is revisited.

## CLI (`cli.ts`)

The `schema-check` command navigates to `https://www.google.com/maps/saved` and checks for the XSSI prefix. Update it to:
- Navigate to the new saved places URL
- Intercept the `mas` response instead
- Remove the XSSI prefix check

## Test Changes

- `parser.test.ts`: import from `mas-response.json` and `getlist-response.json`, fixtures are raw JSON arrays (pass `JSON.stringify(fixture)` to parser functions which expect string input), update expected outputs for new fields
- `diff.test.ts`: update mock data (remove `googleMapsUrl`, add `address`, new content hash, `ListMetadata.type` to number)
- `store.test.ts`: update mock place objects to match new `Place` type
- `enrich.test.ts`: update `makePlace()` helper to match new `Place` type (remove `googleMapsUrl`, add `address`)

## Files Changed

| File | Change |
|---|---|
| `schema.json` | New v2 paths for `mas` and `getlist` responses |
| `src/types.ts` | Update `ParsedList`, `ParsedPlace`, `Place` types |
| `src/parser.ts` | Update to use new schema paths, add `extractSessionToken` |
| `src/session.ts` | New saved places URL, verify login via `mas` request |
| `src/pull.ts` | New endpoint interception, `fetch`-based getlist calls, remove scroll logic |
| `src/diff.ts` | Update content hash fields |
| `tests/parser.test.ts` | New fixtures, new expected outputs |
| `src/enrich.ts` | Disable `placeId`-based Places API lookup, use `placeRef` or name+coords |
| `src/cli.ts` | Update `schema-check` command for new URL and response format |
## Verification

1. `npm run build` — compiles cleanly
2. `npm test` — all tests pass with new fixtures and expected outputs
3. `npm run dev -- init` — opens browser, navigates to saved places, detects `mas` request as login confirmation
4. `npm run dev -- pull` — intercepts `mas` response, parses lists, fetches each list via `getlist`, parses places, applies diff, writes to `~/.gmaps-sync/profiles/default/data/`
5. `npm run dev -- status` — shows correct list and place counts matching Google Maps UI
