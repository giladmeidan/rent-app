---
id: 0003d
title: Anyone switches /search to a map of the results (MapLibre on public OSM tiles), pans and zooms to search that area, opens a listing from its pin, and sees the approximate location on the listing page
status: in-review
depends_on: [0003c]
reviewers: [code, qa, ux, perf]   # ux: new map view, toggle, pins, listing-page map; perf: a ~1 MB library on the search page (must stay lazy) and third-party tile traffic; no security: public read-only data, no credentials, no new endpoint
estimate: 1 coder run
---

## Goal
After this ships, a visitor on `/search` presses "מפה" and sees the matching live apartments as price pins on a
MapLibre map of Gush Dan (public OpenStreetMap raster tiles, attribution always visible); moving or zooming the
map re-runs the search for the visible area; pressing a pin shows that listing's card with a link to its page;
"רשימה" returns to the list. The choice is in the URL (`?view=map`), so it survives reload, sharing and Back. The
public listing page shows a small non-interactive map with an approximate-area circle when the listing has a
point. The map style comes from one env var, so moving to self-hosted Protomaps later is a config change. Serves Dev
Plan slice 3 (Seeker search), part d of four, on `0003c` (`lat` / `lng`, bbox params) and `0003b` (search page,
listing page). PRODUCT.md rows: "Search — map tiles: public OSM tiles while traffic is tiny, self-hosted Protomaps
on R2 once R2 is approved", "Stack — MapLibre+OSM tiles", "Search — the street without a house number".

## Scope
**In:**
- `web/package.json`: dependency `maplibre-gl` **`6.16.0`** exact (published 2026-10-25, BSD-3-Clause, ships its
  own TypeScript types); `pnpm-lock.yaml` updated. If that exact version does not resolve, pin the newest stable
  release at least 14 days old, write it into this Scope line, and check the option names used here (`locale`,
  `cooperativeGestures`, `AttributionControl` `compact`, `minZoom`) against it.
- `web/src/components/map/config.ts` (new, no JSX): `MAP_STYLE_URL = import.meta.env.VITE_MAP_STYLE_URL ||
  '/map/osm-raster.json'`; `GUSH_DAN_BOUNDS: [number, number, number, number] = [34.74, 31.95, 34.95, 32.17]`
  (west, south, east, north; same box as `api/scripts/seed.py`'s `GUSH_DAN_WKT`; comment `shortcut: one launch
  area, read the area's box from the API when a second area is added`); `MAP_RESULTS_LIMIT = 50`;
  `MAP_MIN_ZOOM = 8` (the search map cannot zoom out past central Israel); `MAP_MAX_ZOOM = 19` (the raster
  source's `maxzoom`; above it tiles are only upscaled, and at z21–22 a phone-width box rounds to zero width);
  `roundBbox(b)` (lng clamped to [-180, 180], lat to [-90, 90], then each value to 4 decimals; MapLibre's world
  copies can report longitudes beyond +-180 when zoomed out, which `0003c` answers with a 422; never a degenerate
  box: if rounding leaves `west >= east`, `east = west + 0.0001`, or `west = 180 - 0.0001` when that passes 180,
  and the same for `south >= north` with 90); `mapLocale(t)` → the MapLibre `locale` object
  for the controls this app shows: at least `Map.Title`, `NavigationControl.ZoomIn`, `NavigationControl.ZoomOut`,
  `NavigationControl.ResetBearing`, `AttributionControl.ToggleAttribution` and `Marker.Title`, plus any other key
  the pinned version's `defaultLocale` uses for a shown control (the coder checks the names against it), mapped to
  the `map.*` keys.
- `web/src/components/map/MapCanvas.tsx` (new; the **only** module that imports `maplibre-gl` or its CSS, both
  through `import()` inside an effect, so the library is a separate chunk loaded only when a map is shown). Props:
  `label: string` (region name), `bounds?: [w, s, e, n]` (initial `fitBounds`) or `center?: [lng, lat]` + `zoom?:
  number`, `pins?: Pin[]` (`{ id, lng, lat, text, label }`), `selectedId?: string`, `onPinClick?: (id) => void`,
  `onMoveEnd?: (bbox: [w, s, e, n]) => void` (from `map.getBounds()`, fired on every `moveend`; the first box is
  reported on `load`, for the initial fit), `interactive?: boolean` (default `true`), `approximate?: boolean` (draws a ~56 px
  translucent accent circle at `center`, `aria-hidden`), `busy?: boolean` (results pending), `minZoom?: number`,
  `onError?: () => void`, `className?: string`. `onError` fires **only** when the `import()` fails, when `new
  Map()` throws or emits `webglcontextcreationerror`, or on an `error` event before `load`; `error` events after
  `load` (a failed tile, an OSM 429, going offline) are ignored, and tile and source errors before `load` are
  ignored too (events carrying `tile` or `sourceId`), so one bad tile never replaces the map. The
  effect sets a `cancelled` flag in its cleanup and checks it after the `import()` resolves, so React `StrictMode`
  (`main.tsx`) mounting twice in dev never creates two maps in one container. Renders `<div role="region"
  aria-label={label} aria-busy={busy || !loaded}>` containing the map container and, until the map's `load`
  event, a `Skeleton` covering it. Map options: `style: MAP_STYLE_URL`, `minZoom`, `maxZoom: MAP_MAX_ZOOM`, `locale: mapLocale(t)`,
  `attributionControl: false` plus an
  `AttributionControl({ compact: false })` (OSM attribution always expanded), a `NavigationControl({ showCompass:
  false })` when interactive, `dragRotate: false`, `pitchWithRotate: false`, `touchPitch: false`,
  `cooperativeGestures: false`. Control positions are derived from `i18n.dir()`: zoom buttons at the inline end
  (`'top-left'` in RTL), attribution at the inline start bottom (`'bottom-right'` in RTL); these are MapLibre
  option strings, not CSS, so they are computed from the direction rather than written as raw `left` / `right`.
  Pins are `maplibregl.Marker({ element })` where `element` is a wrapper `<div>` created per pin (`Marker` sets its
  own `aria-label`, from `Marker.Title`, plus its class and transform on the element it is given), holding a
  `<button type="button">` with `aria-label={pin.label}`, `aria-pressed={pin.id === selectedId}`, the visible chip text `pin.text`, a ≥ 44 px hit
  area around a smaller chip (artboard: white chip, accent fill when selected), a visible focus ring; clicking it
  calls `onPinClick(id)`. Markers are diffed by `id` on prop change (no full rebuild per render) and removed on
  unmount; `map.remove()` on unmount.
- `web/public/map/osm-raster.json` (new): a MapLibre style v8 with one raster source `osm` (`tiles:
  ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"]`, `tileSize: 256`, `maxzoom: 19`, `attribution: "&copy; <a
  href=\"https://www.openstreetmap.org/copyright\" target=\"_blank\" rel=\"noopener\">OpenStreetMap</a>
  contributors"`) and one raster layer. The attribution is the tile provider's legal notice and lives with the
  source (a Protomaps style carries its own), so it is not an i18n key; `i18n-check` does not scan `public/`.
- `web/src/vite-env.d.ts`: `readonly VITE_MAP_STYLE_URL?: string`. `infra/docker-compose.yml` `web.environment`:
  `VITE_MAP_STYLE_URL: ${VITE_MAP_STYLE_URL:-/map/osm-raster.json}`. `.env.example`: `VITE_MAP_STYLE_URL=/map/osm-raster.json`
  with a comment: the MapLibre style URL; switching to self-hosted Protomaps = pointing this at that style (plus the
  RTL text plugin, see Risks).
- `web/src/features/search/filters.ts`: `Filters` gains `view?: 'map'`; `parseFilters` keeps `view` only for the
  exact string `map`; `toSearchParams` writes it last (after `sort`); `countActive` ignores it; `searchListings`
  never sends it (it already sends only known filter keys).
- `web/src/features/search/api.ts`: `searchListings(filters, offset, opts?: { bbox?: [w, s, e, n]; limit?: number })`
  sends `west`, `south`, `east`, `north` and `limit` when given (unchanged without `opts`).
- `web/src/features/search/useMapSearch.ts` (new): `useQuery({ queryKey: ['search-map', filtersWithoutView, bbox],
  queryFn: () => searchListings(filters, 0, { bbox, limit: MAP_RESULTS_LIMIT }), enabled: bbox !== undefined,
  placeholderData: keepPreviousData })` (old pins stay while the next box loads).
- `web/src/features/search/ViewToggle.tsx` (new) and `web/src/features/search/SearchMap.tsx` (new), see UI.
- `web/src/features/search/useSearch.ts`: gains an `enabled` argument (`useSearch(filters, enabled = true)`).
- `web/src/features/search/SearchPage.tsx`: computes `filtersWithoutView` (the parsed filters minus `view`) and
  calls `useSearch(filtersWithoutView, filters.view !== 'map')`, so the map view sends no list request and the list
  query key never contains `view`; the toolbar gains `ViewToggle`; `view === 'map'` renders `SearchMap`
  (given `filtersWithoutView`) instead of `ResultsList`; Clear keeps `view` (`setSearchParams(filters.view ? { view: 'map' } : {})`); Apply and
  sort already merge `parseFilters(current)`, so `view` survives them.
- `web/src/features/listings/ListingPage.tsx`: the "מיקום" section gains the small map (UI) when `lat` and `lng`
  are non-null.
- `web/src/locales/he.json`: the keys in UI.
- Tests: `web/src/features/search/__tests__/SearchMap.test.tsx` (new), `filters.test.ts` (new `it` for `view`),
  `web/src/features/listings/__tests__/ListingPage.test.tsx` (new `it`), `web/src/components/map/__tests__/config.test.ts`
  (new), e2e `web/e2e/map.spec.ts` (new). Unit tests replace `MapCanvas` with `vi.mock('…/components/map/MapCanvas')`:
  a fake that renders the region (with `aria-busy={busy}`), one `<button>` per pin (its `aria-label`,
  `aria-pressed`, calling `onPinClick`), records its last props, and exposes the `onMoveEnd` / `onError` callbacks to the test (jsdom has no WebGL).
- `web/playwright.config.ts`: always add `launchOptions: { args: ['--use-angle=swiftshader',
  '--enable-unsafe-swiftshader'] }` to the chromium project (software WebGL; recent Chrome no longer falls back to
  it on its own, and the GPU-less `ubuntu-latest` e2e job needs it even though the Mac has GPU WebGL). Nothing else
  in the e2e setup changes.

**Out:**
- Side-by-side list + map on desktop (`SearchDesktop.dc.html`): question 1; this spec toggles on every width.
- The artboard's "חיפוש בעת הזזת המפה" checkbox: the map always searches on move (the artboard's checked default);
  a "search this area" button instead is Slice 9 polish if testers dislike it.
- Clustering or more than 50 pins: the map shows up to 50 (newest first, or the chosen sort) and says how many
  more there are; clustering when a real dataset needs it.
- The bbox in the URL (sharing an exact map viewport): the map always opens on Gush Dan; `view=map` is in the URL.
- Match % on pins ("7,200 ₪ · 87%"): Slice 6. Nearby-places line on the listing page ("4 דק׳ לרכבת הקלה"): later.
- "My location" (geolocation), fullscreen, scale controls; self-hosted Protomaps (once R2 is approved).
- Area name chip on the listing-page map ("אזור כצנלסון / ויצמן"): the street is already in the text below it.

**New dependencies:** `maplibre-gl@6.16.0` (map rendering; lazy-loaded chunk). No `react-map-gl`, no `pmtiles`, no
RTL text plugin yet (raster tiles carry their labels as images; see Risks).

## Data
None. Consumes `0003c`.

## API
No new endpoints. Consumes `0003c`: `GET /listings` with optional `west`, `south`, `east`, `north` (all four or none)
and `limit` ≤ 50 (public; 200 `ListingSearchOut` whose items have `lat` / `lng`; 422 on a bad box, which the clamped
`roundBbox` and `MAP_MIN_ZOOM` keep the client from sending: `0003c` wants all four values, `west < east`,
`south < north`, lng within +-180 and lat within +-90), and `GET /listings/{id}`'s new `lat` / `lng` (public).
Tile requests go from the browser to `tile.openstreetmap.org` (no auth, no cookie; the browser's default
`Referer` policy sends the origin, which the OSM tile policy requires).

## UI
Artboards: `design/screens-v1/Search.dc.html` (the "רשימה / מפה" segmented toggle beside the count),
`SearchDesktop.dc.html` (map pane: white price chips, accent chip for the selected one, zoom +/−), `Listing.dc.html`
("מיקום": a 150 px rounded map with an accent dot and the "exact location after approval" chip). Logical CSS
properties only; every string from `he.json`.

**`ViewToggle`** (toolbar row of `/search`, between the filters button and `SortSelect`): `<div role="group"
aria-label={search.view.label}>` with two buttons `search.view.list` / `search.view.map`, `aria-pressed` on the
current one, ≥ 44 px targets, styled as the artboard's segmented control. Pressing the other one pushes a history
entry (`setSearchParams(toSearchParams({ ...filters, view: 'map' | undefined }))`).

**Map view (`SearchMap`)**, rendered when `filters.view === 'map'`:
- An always-mounted count line `<p aria-live="polite">` (as `ResultsList`'s), then `<MapCanvas label={search.map.label}
  bounds={GUSH_DAN_BOUNDS} minZoom={MAP_MIN_ZOOM} busy={…} …>` at `h-[60vh] min-h-[360px] rounded-2xl`, then the
  selected card.
- `onMoveEnd(b)` → `setBbox(roundBbox(b))` (component state); the query is disabled until the first box arrives.
  The map viewport is **view state by design** (see Out: no bbox in the URL). This amends `0003b`'s NF3 ("filter
  state lives only in the URL"): the filters stay URL-only, the bbox is the one deliberate exception, and the code
  reviewer does not flag it.
- States:
  - map loading (library, style, first tiles): `MapCanvas`'s own skeleton with `aria-busy`; the count line empty.
  - results loading (first box): the map is shown without pins; `SearchMap` passes `busy` while the first answer
    for the current box is pending, so the region gets `aria-busy="true"`; later boxes
    keep the previous pins until the new answer (`keepPreviousData`).
  - error: `ErrorState` (retry = `refetch`, same box) under the map; the map stays usable.
  - empty (`total === 0`): count line empty, `EmptyState` `search.map.empty` under the map.
  - success: count line `search.countOne` / `search.count` when `total <= items.length`, else `search.map.tooMany`
    (`{{shown}}`, `{{total}}`); one pin per item with non-null `lat` / `lng`: `text` = `formatIls(price_ils)` + ` ` +
    `listings.units.ils`, `label` = `search.map.pin` (`{{title}}` = the `listings.card.title` string, `{{price}}` =
    `formatIls(price_ils)`).
  - map unavailable (`onError`, which `MapCanvas` fires only for a failed import, no WebGL, or an error before
    `load`): the map area is replaced by a container (`data-testid="map-unavailable"`) holding `EmptyState`
    `search.map.unavailable` and a button `search.view.list` that switches to the list view.
- Pin pressed → `selectedId` state; under the map a `ListingCard to={`/listings/${id}`}` for that item, and focus
  moves to the card's title link (so keyboard and screen-reader users land on what they chose). Pressing another
  pin replaces the card. When a new answer no longer contains the selected id, the card is removed.
- Filters panel and sort work as in the list (the query key includes the filters); "load more" does not exist here.

**Listing page map** (`ListingPage`, section `listing.location`, only when `lat !== null && lng !== null`): between
the `<h2>` and the address line, `<MapCanvas label={listing.mapLabel} center={[lng, lat]} zoom={14}
interactive={false} approximate className="h-[150px] rounded-2xl">` (no pins, no zoom buttons, attribution shown).
States: loading = `MapCanvas`'s skeleton (150 px); error (`onError`) = the map is removed, the text stays; no
point = the section exactly as `0003b` (address + `listing.locationHint`).

**RTL**: the page stays `dir="rtl"`; the map itself is not mirrored (north up, east right; a map is not text). Zoom
buttons sit at the inline end and attribution at the bottom inline start, computed from `i18n.dir()` (Scope). Pin
chips inherit `dir="rtl"`, so "7,200 ₪" reads as in the cards. The view toggle sits between the filters button and
the sort select, as in the artboard's count row.

**Accessibility**: the list view is the full alternative to the map (same results, all of them) and is the default;
the map region is labelled; pins are real `<button>`s reachable with Tab, named by title and price, with
`aria-pressed`; MapLibre's canvas keyboard handling (arrows pan, +/− zoom) stays on; the result count is announced
through the live line; focus moves to the opened card; zoom-control labels come from `he.json` via `locale`.

**i18n keys added to `he.json`** (placeholder copy; Slice 9 owns final wording). Reused unchanged:
`search.count`, `search.countOne`, `listings.card.title`, `listings.units.ils`, `listing.location`,
`listing.locationHint`, `common.error`, `common.retry`.

| key | value |
| --- | --- |
| `search.view.label` | `תצוגת תוצאות` |
| `search.view.list` | `רשימה` |
| `search.view.map` | `מפה` |
| `search.map.label` | `מפת התוצאות` |
| `search.map.empty` | `אין דירות באזור הזה. אפשר להזיז את המפה או לשנות את המסננים.` |
| `search.map.tooMany` | `מוצגות {{shown}} מתוך {{total}} דירות. אפשר להתקרב כדי לראות את כולן.` |
| `search.map.unavailable` | `המפה לא זמינה בדפדפן הזה. אפשר לראות את התוצאות ברשימה.` |
| `search.map.pin` | `{{title}}, {{price}} ₪ לחודש` |
| `map.title` | `מפה` |
| `map.zoomIn` | `הגדלה` |
| `map.zoomOut` | `הקטנה` |
| `map.resetBearing` | `איפוס כיוון` |
| `map.toggleAttribution` | `הצגת קרדיטים של המפה` |
| `map.marker` | `סימון במפה` |
| `listing.mapLabel` | `מפת המיקום המשוער` |

## Acceptance criteria
Unit tests reuse `web/src/features/auth/__tests__/harness.tsx` (`mockApi`, `renderRoutes`, `currentPath`) and the
search fixtures (`publicListing` now with `lat` / `lng`, from `0003c`); `MapCanvas` is the fake described in Scope.
Request params are compared as a set from `new URL(call.request.url).searchParams`.
- [ ] AC1 Given `/search`, Then the group `search.view.label` shows `search.view.list` with `aria-pressed="true"` and the list renders; When `search.view.map` is pressed, Then the location is `?view=map`, the region `search.map.label` renders, no `ResultsList` is shown, and the filters toggle still reads `search.filters` (view is not a filter); Given `/search?view=map&pets=true`, When the "to" price 8000 is applied, Then `?price_max=8000&pets=true&view=map`; When `search.clear` is pressed, Then `?view=map`; When the history goes back (the `0003b` probe button), Then `?price_max=8000&pets=true&view=map` again; When `search.view.list` is pressed, Then `view` is gone and the list renders — `web/src/features/search/__tests__/SearchMap.test.tsx::ac1_view_toggle_lives_in_the_url`
- [ ] AC2 `parseFilters` keeps `view=map` and drops `view=list`, `view=MAP`, `view=`; `toSearchParams` writes `view` after `sort`; `countActive` ignores it; `searchListings({ ...filters, view: 'map' }, 0)` sends no `view` param; `searchListings(filters, 0, { bbox: [34.7712, 32.0412, 34.8299, 32.1099], limit: 50 })` sends exactly the filters plus `west`, `south`, `east`, `north`, `limit=50`, `offset=0` — `web/src/features/search/__tests__/filters.test.ts::ac2_view_param_and_bbox_query`
- [ ] AC3 Given `/search?view=map&price_max=8000`, Then no `GET /listings` is sent before the map reports a box (neither the list query, which is disabled in map view, nor the map query); When the fake calls `onMoveEnd([34.7712345, 32.0412345, 34.8298765, 32.1098765])`, Then exactly one `GET /listings` with `price_max=8000`, `west=34.7712`, `south=32.0412`, `east=34.8299`, `north=32.1099`, `limit=50`, `offset=0` and no `view`; Given the answer has three items, one with `lat: null`, Then the fake receives two pins, each `label` built from `search.map.pin` and `text` matching `/7,200[\s\u200e\u200f]*\u20aa/` for a 7200 listing; When `onMoveEnd` fires with another box and that request is pending, Then the two pins are still passed; on its answer the pins are the new items — `web/src/features/search/__tests__/SearchMap.test.tsx::ac3_map_searches_the_visible_box`
- [ ] AC4 Given the map view after a first box, When `GET /listings` fails, Then `ErrorState` under the map and retry re-requests the same box; When it answers `{"items": [], "total": 0}`, Then `search.map.empty`; When it answers 3 items with `total: 3`, Then the live line reads `3 \u05d3\u05d9\u05e8\u05d5\u05ea`; When it answers 50 items with `total: 120`, Then the live line is `search.map.tooMany` with `50` and `120`; while the first answer is pending, the region has `aria-busy="true"`; When the fake calls `onError`, Then `search.map.unavailable` and, inside the `map-unavailable` container (`within(getByTestId('map-unavailable'))`; the toggle has a second button of the same name), a `search.view.list` button that, pressed, leads to the list (no `view` in the URL) — `web/src/features/search/__tests__/SearchMap.test.tsx::ac4_map_result_states`
- [ ] AC5 Given two pins, When the first pin button is pressed, Then the fake receives `selectedId` = its id (its button `aria-pressed="true"`), a `ListingCard` for it appears under the map with its title linking to `/listings/{id}`, and that link has focus; When the second pin is pressed, Then the card is the second listing's; When a new answer no longer contains the selected listing, Then no card is shown — `web/src/features/search/__tests__/SearchMap.test.tsx::ac5_pin_opens_the_listing_card`
- [ ] AC6 Given `GET /listings/{id}` answers with `lat: 32.08, lng: 34.8`, Then the region `listing.mapLabel` renders inside the `listing.location` section and the fake received `center: [34.8, 32.08]`, `zoom: 14`, `interactive: false`, `approximate: true` and no pins; the address and `listing.locationHint` still show; Given `lat: null, lng: null`, Then no `listing.mapLabel` region and the section is as before; Given the fake calls `onError`, Then the region is removed and the text stays — `web/src/features/listings/__tests__/ListingPage.test.tsx::ac6_listing_page_approximate_map`
- [ ] AC7 With `vi.stubEnv('VITE_MAP_STYLE_URL', 'https://tiles.example/style.json')` and a fresh module import, `MAP_STYLE_URL` is that URL, and without it `/map/osm-raster.json`; `roundBbox([34.77123, 32.04126, 34.82999, 32.10994])` is `[34.7712, 32.0413, 34.83, 32.1099]` and `roundBbox([-200.1, 31.9, 200.2, 32.2])` is `[-180, 31.9, 180, 32.2]`; `mapLocale(t)` contains at least `Map.Title`, `NavigationControl.ZoomIn`, `NavigationControl.ZoomOut`, `AttributionControl.ToggleAttribution` and `Marker.Title`, and each value equals the matching `he.json` `map.*` string (compared with the imported JSON, since i18next returns the key itself for a missing one); `web/public/map/osm-raster.json` parses as `version: 8` with exactly one raster source whose `tiles` is `["https://tile.openstreetmap.org/{z}/{x}/{y}.png"]`, `maxzoom` 19, and an `attribution` containing `https://www.openstreetmap.org/copyright` and `OpenStreetMap` — `web/src/components/map/__tests__/config.test.ts::ac7_style_url_bbox_rounding_locale_and_osm_style`
- [ ] AC8 Given `make dev` is up (worker on `GEOCODER=fake`), When Playwright signs up a fresh owner and posts a listing with street `e2e <run id>` through `page.request` exactly as `web/e2e/search.spec.ts` does, then polls `GET /listings/{id}` (no cookie) until `lat` is non-null (timeout 30 s; the sweep runs every 10 s), then routes `https://tile.openstreetmap.org/**` with `page.context().route(...)` (so requests from MapLibre's workers are caught too) to a 1x1 PNG (so CI never calls OSM), clears cookies and opens `/search`, Then no request URL contains `maplibre` while the list is shown; When `search.view.map` is pressed, Then `search.map.unavailable` has count 0 (a WebGL failure reports as such, not as a pin timeout), a `maplibre` module is requested (AC8 runs on the compose Vite dev server, so this is the pre-bundled `/node_modules/.vite/deps/maplibre-gl.js`), the region `search.map.label` is visible, the attribution text `OpenStreetMap` is visible, and a pin button whose accessible name contains the street is visible within 15 s; When it is pressed, Then a card with that street appears; When the card's title is pressed, Then the URL is `/listings/{id}` and the region `listing.mapLabel` is visible; When the page is reloaded on `/search?view=map`, Then the map view is shown again — `web/e2e/map.spec.ts::ac8_visitor_finds_a_listing_on_the_map`
- [ ] NF1 `make i18n-check`, `eslint`, `prettier --check`, `tsc --noEmit`, `make build-web` clean; `0003b`'s and `0002b`'s tests pass unchanged except for the `view` additions — CI `web` job
- [ ] NF2 Bundle: `maplibre-gl` (JS and CSS) is only in a lazily loaded chunk. After `make build-web`, the entry script named in `web/dist/index.html` contains no string unique to the library's code (e.g. `maplibregl-ctrl-attrib`; the bare name `maplibre` is not a valid check, since the entry refers to the lazy chunk by file name), and the entry grows by less than about 10 kB against `main`; AC8 proves the list view never downloads the library; the perf reviewer writes the chunk size and the number of tile requests for one open + three pans at 390 px into the digest — perf review + AC8
- [ ] NF3 (amends `0003b` NF3: the map viewport is component state by design; filters stay URL-only) OSM tile usage policy: tiles only from the style file (no prefetch, no extra sources), `maxzoom` 19, no service-worker caching of tile URLs (the PWA's workbox has no runtime route matching `tile.openstreetmap.org`, and `globIgnores` keeps the lazy `maplibre-gl-*` chunks out of the precache), attribution expanded and visible (AC8), the browser's default referrer policy kept; and Nominatim is never called from the browser — code review
- [ ] NF4 Accessibility: every control labelled; toggle buttons with `aria-pressed`; pins are `<button>`s with names (AC3), ≥ 44 px hit area and a visible focus ring; count line `aria-live="polite"`; focus to the opened card (AC5); the ux reviewer checks 390 px and 1280 px in a browser, keyboard only: toolbar → toggle → map → pins → card → listing → back — ux review

## Tests to write
Unit (vitest): AC1–AC7 (`MapCanvas` faked; no WebGL in jsdom). E2E: AC8 (`make e2e`), on the shared e2e database
under the default newest sort, so the fresh listing is among the first 50 pins; tiles fulfilled locally. The real
`MapCanvas` is exercised only by AC8 and the ux review.

## Risks / open questions
- **Product assumptions taken by the orchestrator (2026-11-10), for Gilad's batch approval via the digest; the
  coder follows them as written:** (1) list stays the default view; the map is one tap away and in the URL;
  (2) the map always searches on move (no checkbox); (3) at most 50 pins, with a "zoom in to see all N" line;
  (4) the listing page shows an approximate-area circle, never a pin, consistent with "the exact location is sent
  after approval"; (5) a list/map toggle on every width (question 1).
- **Question 1 for Gilad — the map on desktop.** (a) The same list/map toggle on every width, in today's 640 px
  column (as specced; cheapest, one layout); (b) at ≥ 1024 px, list and map side by side as in
  `SearchDesktop.dc.html` (widens `/search` beyond the column; about half a coder run more, and overlaps the
  pending 0003b decision on the desktop layout); (c) no map on desktop until Slice 9's layout pass. **Recommend
  (a) now and (b) inside Slice 9's desktop layout**, so the side panel, card grid and map pane are designed
  together once.
- **Question 2 for Gilad — when to leave public OSM tiles.** PRODUCT.md settles "public OSM tiles while traffic is
  tiny"; the OSM tile policy forbids heavy use and offers no SLA, and every map view sends the visitor's IP and
  viewed area to the OpenStreetMap Foundation (worth one line in the privacy policy, Slice 12). (a) Switch to
  Protomaps on R2 before public launch (Slice 12), whatever the traffic; (b) switch when tile requests pass a
  threshold (e.g. ~10k/day, measured from our own logs of map opens); (c) a free-tier keyed provider (MapTiler /
  Stadia) as a stop-gap. **Recommend (a):** it removes the policy and privacy question before any real traffic,
  and the switch is `VITE_MAP_STYLE_URL` plus the RTL text plugin below.
- The Protomaps switch is not purely one env change: vector tiles render Hebrew labels in the browser, which needs
  MapLibre's RTL text plugin (`setRTLTextPlugin`, the `@mapbox/mapbox-gl-rtl-text` script) and a style with glyphs.
  That small change belongs to the switch spec; raster OSM tiles need neither.
- Headless Chromium lacks GPU WebGL in CI; the Scope's unconditional SwiftShader `launchOptions` cover it, AC8
  fails fast on `search.map.unavailable`, and in a real browser without WebGL the map shows that message rather than
  breaking the page.
- jsdom cannot run MapLibre, so the real `MapCanvas` is covered only by AC8 and the ux review. Its logic is kept
  thin (options, markers diff, callbacks); everything decidable is in `config.ts`, `SearchMap`, `useMapSearch`
  (unit-tested).
- Pins are DOM markers (≤ 50), simple and accessible; WebGL symbol layers or clustering only if a larger cap is
  ever needed.
- Builds after `0003c`'s PR is open (Speed rule 3): branch from `spec/0003c-map-api`, run `make client` against it,
  rebase after it merges. Only one web spec builds at a time on port 5173 (Speed rule 2).
- **Open question from the build (coder, 2026-11-10) — the service worker precaches the map library.** The PWA's
  `generateSW` precaches every `**/*.{js,css,html}` in `dist/`, so after `make build-web` the lazy
  `maplibre-gl-*.js` (1,104 kB, 298 kB gzip) and `maplibre-gl-*.css` (71 kB) are in the precache manifest
  (8 entries, 1,511 KiB, was 5 entries, 352 KiB): every visitor whose browser installs the service worker
  downloads the library in the background on the first visit, list view or not. The code split itself holds
  (NF2's entry check passes and AC8 proves the page never requests it), but in production the laziness is
  undone by the precache. NF3 says the workbox config is unchanged, so the build leaves it as it is. Options:
  (a) `workbox.globIgnores: ['**/maplibre-gl-*']` in `vite.config.ts` (one line; the map then needs the network
  the first time, which it does anyway for tiles) **[recommended]**; (b) (a) plus a `runtimeCaching` CacheFirst
  rule for those files, so a map opened once is cached; (c) keep the precache (offline-ready library, ~300 kB
  gzip extra for every first visit). Not changed in this build; the perf reviewer will see it.

## Verifier findings — one round, 10 findings, all applied
1. `useSearch(filtersWithoutView, filters.view !== 'map')`: no list request in map view; `useMapSearch` keys on `filtersWithoutView` (Scope `useSearch.ts` / `SearchPage.tsx`, AC3).
2. `MapCanvas` gains `busy`; region `aria-busy={busy || !loaded}`; the fake renders it; `SearchMap` passes it (Scope, UI states, AC4).
3. `roundBbox` clamps lng/lat before rounding and the search map sets `MAP_MIN_ZOOM = 8`, matching `0003c`'s bbox validation (Scope config, UI, API, AC7).
4. SwiftShader launch args are unconditional; AC8 asserts `search.map.unavailable` count 0 after opening the map (Scope, AC8, Risks).
5. `Marker` gets a wrapper `<div>` with the `<button>` inside; `Marker.Title` in `mapLocale`, new key `map.marker` (Scope, i18n table).
6. NF2 checks the entry script from `dist/index.html` for `maplibregl-ctrl-attrib` and < ~10 kB growth; AC8 names the Vite dev pre-bundle path (NF2, AC8).
7. AC7 compares each `mapLocale` value with the `he.json` string and requires the five keys (AC7).
8. The bbox-as-component-state amendment to `0003b` NF3 is stated (UI map view, NF3).
9. `onError` only for import failure, no WebGL / `webglcontextcreationerror`, or an error before `load`; `cancelled` guard against StrictMode double mount (Scope MapCanvas, UI states).
10. AC4 presses the fallback button inside `map-unavailable`; AC8 uses `page.context().route`; version fallback rule for `maplibre-gl` (UI, AC4, AC8, Scope package line).

## Digest (filled by orchestrator after verification)

    Spec 0003d - Map web: /search map view + listing-page map   (verified, part d of 4, web only, depends on 0003c)
    What a user can do after this: on /search, press "מפה" to see the matching apartments as price pins on a MapLibre map
             of Gush Dan (public OSM tiles, attribution always shown); moving the map searches that area (up to 50 pins,
             "zoom in to see all N" beyond that); a pin opens the listing card; "רשימה" goes back; ?view=map survives
             reload and Back. The listing page shows a small map with an approximate-area circle when it has a point.
    Decisions I need from you (built on the recommendation meanwhile):
      Q1. Map on desktop: (a) same list/map toggle on every width, 640 px column [rec now] (b) list + map side by side
          at >= 1024 px as the artboard [rec inside Slice 9's layout pass] (c) no desktop map until Slice 9.
      Q2. Leaving public OSM tiles: (a) switch to Protomaps on R2 before launch, whatever the traffic [rec] (b) at a
          traffic threshold (~10k tile requests/day) (c) a free keyed provider (MapTiler/Stadia) as a stop-gap.
    Acceptance targets: NF2 maplibre-gl only in a lazy chunk (entry grows < ~10 kB) · NF3 OSM tile policy (no prefetch,
             no SW tile cache, attribution expanded) · NF4 pins are named buttons, toggle aria-pressed, focus to the card.
    Risks: WebGL in headless CI - mitigation: unconditional SwiftShader args, and AC8 fails fast on "map unavailable".
    Reviewers: code, qa, ux, perf   Estimated: 1 coder run, 1 review round
