---
id: 0009y
title: On the search map a person jumps to their own area or to a named city or neighbourhood, an empty area offers to show the whole region, and the listing page shows an honest ~300 m area with a link to that spot on the search map
status: done
depends_on: [0009w]   # MapCanvas `camera` and `panel`, mapPosition.ts (c / z / pin), the first-open fit; independent of 0009x (may build in parallel with it)
reviewers: [code, qa, ux, security]   # security (Sonnet is enough): the device's position is personal data; check it is snapped before the URL or a request and never stored. ux: map buttons, messages, place box, listing page circle; qa: geolocation outcomes, place data checks, the link. No perf: no new request
estimate: 1 coder run   # coder Opus/medium (verifier): geolocation privacy, 0009t's focus and live-region rules and 0009w's camera interplay
---

## Goal
After this ships:
- on the full search map, "המיקום שלי" moves the map to the person's area (with a dot at their position) when it
  is inside the launch area, and says so plainly when it is outside, denied or unavailable. The map's centre is
  snapped to a ~200 m grid first, so the URL and the search request never carry the device's exact position;
- a place box above the map jumps to a Gush Dan city or neighbourhood picked from a fixed list ("פלורנטין");
- when the visible area has no listings, a button returns the map to the whole launch area (and, with filters
  set, "ניקוי" clears them);
- the listing page's circle shows an honest area of about 300 m around the approximate point (Gilad, 2026-11-13,
  decision 6) — today's 56 px circle is a ~113 m radius, smaller than the up-to-~290 m privacy offset;
- the listing page links to the search map at that spot, with the listing's card open.

Serves the map improvements job (Slice 9c, `specs/map-research/03-search-surface.md` sections 4–7).

## Scope
**In:**

1. **`web/src/components/map/config.ts`**
   - `inLaunchArea(lng, lat): boolean` — inside `GUSH_DAN_BOUNDS`.
   - `snapToGrid([lng, lat]): [lng, lat]` — each value rounded to the nearest 0.002° (~200 m, the grid of the
     listings' own privacy offset, spec 0003c), then to 4 decimals.
   - `metersToPixels(meters, lat, zoom): number` — `meters / (40075016.686 × cos(lat·π/180) / (512 × 2^zoom))`
     (MapLibre's world is 512 px per zoom level whatever the raster tile size).
   - `APPROXIMATE_RADIUS_M = 300` with a one-line why: the stored point is the street's point plus a fixed
     per-listing offset of up to ~220 m per axis (spec 0003c), so a smaller circle would claim more precision
     than the data has.
2. **`web/src/components/map/MapCanvas.tsx`**
   - `approximate?: boolean` is replaced by `approximateRadiusM?: number`: the circle's diameter is
     `2 × metersToPixels(radius, center lat, zoom)` px, still a fixed overlay on the static, non-zoomable map
     (`border-accent`, `bg-accent/25`, `aria-hidden`). Its only caller is the listing page.
   - `userPosition?: [lng, lat]`: a non-interactive `aria-hidden` marker (a 16 px `bg-accent` dot with a 2 px
     `border-on-ink` ring, `pointer-events-none`), with `zIndex '0'` and added before the pins, so every pin and
     bubble (0009v: `z` ≥ 1) paints above it.
3. **`web/src/components/map/__tests__/fakeMapCanvas.tsx`** learns `approximateRadiusM` and `userPosition`
   (recorded in the props; nothing rendered).
4. **`web/src/features/search/SearchMap.tsx`** owns the new state: the `camera` it sends (0009w), `userPosition`,
   and one `status` message shared by locate and the place box.
   - **The status line:** a `<p role="status">` with **no** `aria-live` attribute, directly under the count line,
     always mounted and empty until a press fills it (0009t section 2's pattern); a repeat of the same message is
     cleared and set again one animation frame later so it is re-announced; it clears on the next map move or
     press. This amends 0009t's single-live-region line: the count line stays the one results region (the
     `[aria-live="polite"]` count stays 1), and this line speaks only the answer to the person's own press.
   - **Any camera this spec sends** (locate, place, show all) cancels 0009w's pending first-open fit for that
     mount, so a fast press is never undone by the fit.
5. **Locate me** — `web/src/features/search/LocateButton.tsx` (new): `LocateButton({ onLocated(position: [lng,
   lat]): void; onMessage(key: 'locateOutside' | 'locateDenied' | 'locateFailed'): void })`, placed through
   `MapCanvas`'s `panel` on the full map only (not the side map) at the top inline-start corner (`top-3 start-3`).
   - An icon-only house `Button` (secondary, outline crosshair icon, ≥ 44 px), `aria-label` `search.map.locate`;
     not rendered when `'geolocation' in navigator` is false (read at render).
   - Press → `navigator.geolocation.getCurrentPosition(ok, fail, { enableHighAccuracy: false, timeout: 10_000,
     maximumAge: 60_000 })`; while waiting, the house `Button`'s `busy` state (`aria-busy` + `aria-disabled`, focus
     kept), never native `disabled` (it would drop focus to `<body>` mid-press).
   - `fail` compares `error.code` with the literals 1, 2, 3 (never the global `GeolocationPositionError`
     constants, which jsdom lacks): 1 → `onMessage('locateDenied')`; 2 or 3 → `onMessage('locateFailed')`.
   - `ok` inside the launch area (`inLaunchArea`) → `onLocated([lng, lat])`; outside →
     `onMessage('locateOutside')`.
   - `SearchMap.onLocated(position)`: `userPosition = position` (the raw fix, in memory only, until the next
     locate or unmount) and `camera { center: snapToGrid(position), zoom: 15 }`. So the URL's `c` (0009w) and the
     box sent to `GET /listings` are centred on the snapped point, never on the raw fix. The position is never
     written to storage, to the URL or to a request.
6. **Place search** — `web/src/features/search/places.ts` (new) and `PlaceSearch.tsx` (new):
   - `PLACES`: `{ id, center: [lng, lat], zoom }[]`, names in `he.json` as `places.<id>` (hard rule 4; ids are
     ASCII kebab-case without dots, since a dot is i18next's key separator). The candidates are the table below;
     the coder looks each one up and **drops** (never moves by hand) any with no result or a result outside
     `GUSH_DAN_BOUNDS`, and records every drop in the PR body. At least 40 must remain.

     | Zoom | id → Hebrew name |
     | --- | --- |
     | 13 (cities) | `tel-aviv-yafo` תל אביב-יפו · `ramat-gan` רמת גן · `givatayim` גבעתיים · `bnei-brak` בני ברק · `holon` חולון · `bat-yam` בת ים · `petah-tikva` פתח תקווה · `ramat-hasharon` רמת השרון · `herzliya` הרצליה (borderline: its centre sits at the box's north edge; kept only if the lookup lands inside) · `kiryat-ono` קריית אונו · `or-yehuda` אור יהודה · `yehud-monosson` יהוד-מונוסון · `givat-shmuel` גבעת שמואל · `rishon-lezion` ראשון לציון · `hod-hasharon` הוד השרון · `azor` אזור · `ganei-tikva` גני תקווה · `savyon` סביון · `beit-dagan` בית דגן |
     | 15 (Tel Aviv-Yafo) | `florentin` פלורנטין · `neve-tzedek` נווה צדק · `kerem-hateimanim` כרם התימנים · `lev-hair` לב העיר · `old-north` הצפון הישן · `new-north` הצפון החדש · `kikar-hamedina` כיכר המדינה · `bavli` בבלי · `montefiore` מונטיפיורי · `ramat-aviv` רמת אביב · `ramat-aviv-gimel` רמת אביב ג׳ · `neve-avivim` נווה אביבים · `tel-baruch` תל ברוך · `neot-afeka` נאות אפקה · `tzahala` צהלה · `ramat-hahayal` רמת החייל · `hadar-yosef` הדר יוסף · `yad-eliyahu` יד אליהו · `shapira` שפירא · `neve-shaanan` נווה שאנן · `hatikva` שכונת התקווה · `kiryat-shalom` קריית שלום · `jaffa` יפו · `ajami` עג׳מי · `jaffa-d` יפו ד׳ |
     | 15 (Ramat Gan, Givatayim) | `ramat-gan-center` מרכז רמת גן · `bursa` הבורסה · `ramat-chen` רמת חן · `nahalat-ganim` נחלת גנים · `tel-binyamin` תל בנימין · `marom-nave` מרום נווה · `ramat-amidar` רמת עמידר · `kiryat-krinitzi` קריית קריניצי · `borochov` שכונת בורוכוב · `givat-rambam` גבעת רמב״ם |

     Not candidates (outside the box): Ra'anana, Kfar Saba, Kfar Shmaryahu, Rosh HaAyin, Ness Ziona; Lod, Shoham
     and Elad sit on the edge and stay out.
   - **How the coordinates are obtained:** a throwaway `curl` loop, not committed, against Nominatim's public
     search (`format=jsonv2&countrycodes=il&accept-language=he&limit=1&viewbox=34.74,32.17,34.95,31.95&bounded=1`),
     at most one request per 1.1 s, with a generic User-Agent naming the app (no personal name or email). The
     returned `lat` / `lon` are stored rounded to 4 decimals. The file's comment says "© OpenStreetMap
     contributors, ODbL, via Nominatim, <date>"; the list stays under 100 entries. If Nominatim is unreachable
     from the coder's environment, the coder stops this item and messages the orchestrator; never coordinates
     from memory.
   - `PlaceSearch`: on the full map view, in the row above the map (with the count line), a `TextInput`
     `type="search"` with a visible label `search.map.placeLabel` and a native `<datalist>` of the place names.
     It jumps (`camera { center, zoom }` for that place) in two cases only: (a) Enter with a value (trimmed)
     exactly equal to a name; (b) a change whose value exactly equals a name that is **not a prefix of another
     name** in the list (a pick from the list, or a full unambiguous name). So typing "רמת אביב" on the way to
     "רמת אביב ג׳", or "יפו" before "יפו ד׳", waits for Enter. Enter on a name not in the list → the status line
     says `search.map.placeNotFound`. RTL: the input's `dir` follows the page; no physical positioning.
7. **The empty view's action** — `SearchMap.tsx`, and `SearchPage.tsx` passes it `hasFilters={active > 0}` and
   `onClear={clear}` as it does to `ResultsList` (the `clear` that 0009w makes keep `view=map` and the map
   params). When the box answers `total === 0`:
   - a secondary `Button` `search.map.showAll` under the count line, **only when the current box does not already
     contain `GUSH_DAN_BOUNDS`**; it sends `camera { bounds: GUSH_DAN_BOUNDS }`. When it unmounts after the wider
     box answers, focus moves to the count line (`countRef`), 0009t section 1's rule for an action that removes
     its own control;
   - with any filter set, the existing `search.clear` ("ניקוי") beside it, which clears the filters (its focus
     behaviour is today's: the count line).
   No extra request (the cheap version of `03-search-surface.md` section 6).
8. **The listing page** — `web/src/features/listings/ListingPage.tsx` (the "מיקום" section):
   - the static map uses `zoom={13}` (was 14) and `approximateRadiusM={APPROXIMATE_RADIUS_M}`: about 74 px radius
     at zoom 14, so 37 px at zoom 13, which keeps the ~300 m area well inside the 160 px phone map with streets
     around it;
   - under the address, a link `listing.showOnMap` ("הצגה במפת החיפוש") to `/search` with `listing_type=<type>`,
     `view=map`, and `c` = the listing's point, `z=15`, `pin=<id>` written by `writeMapPosition` (0009w), shown
     only when the listing has a point (also when the map itself failed). `listing_type` keeps the map to the
     listing's own kind; when the Slice 10 market moves rooms out of `/search`, its redirect of
     `?listing_type=room` links (PRODUCT.md "שוק השותפים", Q3) carries room links to the market search.
9. **`web/src/locales/he.json`**: `search.map.locate` `"הצגת המיקום שלי"`, `search.map.locateOutside`
   `"המיקום שלך מחוץ לאזור שבו יש כרגע מודעות."`, `search.map.locateDenied` `"אין הרשאה למיקום. אפשר לאשר
   אותה בהגדרות הדפדפן."`, `search.map.locateFailed` `"לא הצלחנו למצוא את המיקום. אפשר לנסות שוב."`,
   `search.map.placeLabel` `"מעבר לעיר או לשכונה"`, `search.map.placeNotFound` `"המקום הזה לא ברשימה. אפשר
   לבחור עיר או שכונה מהרשימה."`, `search.map.showAll` `"הצגת כל האזור"`, `listing.showOnMap` `"הצגה במפת
   החיפוש"`, and `places.<id>` for every place kept. (Texts are proposals in the brand voice; ux may reword;
   keys fixed.)

**Out:**
- MapLibre's `GeolocateControl`: it moves the camera to the raw position before the app can refuse or snap it,
  and tracks continuously; the own button is smaller and testable.
- Street-level place search and any geocoding endpoint (Nominatim's public service does not allow
  search-as-you-type from an app; a paid or self-hosted geocoder is a cost decision for later).
- "N listings outside this area" and fitting to where the results are (needs one more request or a `bounds`
  field on the API; `03-search-surface.md` section 6 "better" / "best").
- An interactive or expandable listing page map, and "other listings nearby".
- Neighbourhood outlines and typical prices (bundle 3; the places list is its first step).

**New dependencies:** none.

## Data
None. A static places list in the web bundle (ids, centres, zooms; names in `he.json`), OSM-derived (ODbL).

## API
None. Geolocation is the browser's; the map's box request is unchanged (its centre, after a locate, is the
snapped point).

## UI
Screens: `/search?view=map` and `/listings/:id`. No artboard draws these; design from the brand kit, existing
components (`Button`, `TextInput`) and tokens.

- Full map: the place box in the row above the map (full width below `lg`, `max-w-xs` beside the count line from
  `lg`); the locate button at the map's top inline-start (`top-3 start-3`); the status line under the count line.
- Listing page: the circle is larger, the map zoomed out one step; the link under the address, `text-body-sm`,
  the app's link style.
- RTL: logical properties only; the datalist and the input follow the page direction.

States:
- **Locate:** idle; waiting (busy, focus kept); success inside (map moves to the snapped centre, dot at the
  position); outside / denied / failed (status line, map unchanged); no geolocation (button absent).
- **Place box:** empty; typing (no jump until Enter or an unambiguous full name); a match (map moves); no match on
  Enter (status line).
- **Empty area:** the count line's empty text, plus "הצגת כל האזור" (unless the box already holds the whole area)
  and "ניקוי" with filters.
- **Listing page:** no point → no map and no link (as today, no map); map failed → no map, the link still shows.
- Loading and error states of the map are 0009t's, unchanged.

i18n keys added: `search.map.locate`, `locateOutside`, `locateDenied`, `locateFailed`, `placeLabel`,
`placeNotFound`, `showAll`, `listing.showOnMap`, `places.*`.

## Acceptance criteria
- [ ] AC1 `inLaunchArea` is true for Tel Aviv (34.78, 32.08) and false for Haifa (34.99, 32.79);
  `metersToPixels(300, 32.08, 14)` is within 1 px of 74 and halves at zoom 13; `snapToGrid([34.78123, 32.08167])`
  is `[34.782, 32.082]` — `web/src/components/map/__tests__/config.test.ts::ac1_launch_area_meters_and_grid`
- [ ] AC2 Rendering `SearchPage` at `/search?view=map` through the `SearchMap.test.tsx` harness (`renderRoutes`,
  `mockApi`, the fake canvas), with `navigator.geolocation` stubbed by `Object.defineProperty(navigator,
  'geolocation', { configurable: true, value: { getCurrentPosition: vi.fn() } })` and removed in `afterEach`:
  a fix at (34.78123, 32.08167) sends `camera { center: [34.782, 32.082], zoom: 15 }`, sets
  `lastProps().userPosition` to the raw fix, and after the fake reports that move the URL's `c` and the next
  `GET /listings` box are centred on the snapped point, never the raw one; a fix in Haifa sends no camera and the
  status line says `locateOutside`; `{ code: 1 }` → `locateDenied`, `{ code: 3 }` → `locateFailed`; while waiting
  the button has `aria-busy="true"` and `aria-disabled="true"` and keeps focus; without `navigator.geolocation` the
  button is absent; the `[aria-live="polite"]` count stays 1 —
  `web/src/features/search/__tests__/LocateButton.test.tsx::ac2_locate_outcomes_and_snapping`
- [ ] AC3 Every `PLACES` entry has a unique kebab-case id without dots, a centre inside `GUSH_DAN_BOUNDS`, a zoom
  of 13 or 15 and a non-empty `he.json` name; there are 40–99 entries —
  `web/src/features/search/__tests__/places.test.ts::ac3_places_data`
- [ ] AC4 Typing "פלורנטין" (a change to an exact, non-prefix name) sends its `camera` without Enter; a change to
  "רמת אביב" sends none, and Enter then sends its camera; Enter on an unknown name fills the status line with
  `placeNotFound` and sends none; a place jump before the first answer cancels 0009w's first-open fit (no fit
  camera follows) — `web/src/features/search/__tests__/SearchMap.test.tsx::ac4_place_search`
- [ ] AC5 Given an empty box that does not contain the launch area, Then "הצגת כל האזור" sends
  `camera { bounds: GUSH_DAN_BOUNDS }`, and once the wider box answers with results the button is gone and
  `document.activeElement` is the count line; given an empty box that already contains the launch area, Then
  the button is absent; with a filter set, "ניקוי" shows and clears the filters while `c` / `z` stay —
  `SearchMap.test.tsx::ac5_empty_view_actions`
- [ ] AC6 The listing page passes `zoom: 13` and `approximateRadiusM: 300` to its map; the "הצגה במפת החיפוש"
  link's `href`, parsed, has pathname `/search`, `listing_type=apartment`, `view=map`, `z=15`, `pin=<id>`, and
  `parseMapPosition(params).center` equal to `[34.8, 32.08]` for an apartment at (34.8, 32.08); a listing without
  a point shows neither map nor link; with the map failed the link still shows. This replaces the existing
  `ac6_listing_page_approximate_map` (it asserted `zoom: 14` and `approximate: true`) —
  `web/src/features/listings/__tests__/ListingPage.test.tsx::ac6_honest_circle_and_map_link`
- [ ] AC7 In the browser: from the test listing's page, "הצגה במפת החיפוש" opens the full map with that listing's
  card in the map and its pin pressed —
  `web/e2e/map.spec.ts::ac8_visitor_finds_a_listing_on_the_map` (step `ac7_listing_page_link`). Geolocation and
  place search are not exercised in e2e (no third-party dependency; unit-tested above).
- [ ] AC8 `make screens` adds: `map-locate` (Chromium context with `grantPermissions(['geolocation'])`;
  `setGeolocation` in Tel Aviv for the dot, in Haifa (32.79, 34.99) for the outside message), `map-place` (the box
  with a typed partial name, and the map after a jump; a native datalist popup is browser chrome and cannot be
  captured), `map-empty-actions`, all at 390 and 1440 — `web/e2e/screens/search.screens.ts`; the listing page
  circle is re-shot in 0009j's existing `apartment-visitor` state — `web/e2e/screens/listing.screens.ts`

## Tests to write
Unit: `config.test.ts` (AC1), new `LocateButton.test.tsx` (AC2), new `places.test.ts` (AC3), `SearchMap.test.tsx`
(AC4, AC5), `ListingPage.test.tsx` (AC6, replacing `ac6_listing_page_approximate_map`). E2E (CI only, never local
— Gilad 2026-11-12): AC7. Screens: AC8.

## Risks / open questions
- **Place coordinates by hand.** About 55 one-off Nominatim lookups by the coder; a wrong centre is a UX bug, not
  a privacy or cost one. AC3 catches anything outside the box; the ux reviewer spot-checks ten places on the
  screenshots. The OSMF guideline that fewer than 100 features is not a substantial extract is from memory: the
  coder confirms it on the OSMF licence pages when doing the lookups.
- **Locate privacy.** The snapped centre (~200 m) reaches the URL and the box request, as panning there would;
  the raw fix stays in memory for the dot. This is stricter than the first draft (verifier finding 1); a
  further trade-off would be Gilad's (Speed rule 9).
- **Datalist on iOS Safari** is supported (iOS 12.2+) but plain; the input still works as a free-text box with
  Enter and the not-found message. A custom combobox is out.
- **Shared files:** with 0009x (built in parallel): `MapCanvas.tsx`, `fakeMapCanvas.tsx`, `SearchPage.tsx`,
  `he.json`; with 0009v (merged before): `ListingPage.tsx` (its `markSeen` effect); with the Slice 10 market:
  `ListingPage.tsx` (step 1 changes the back link; steps 3–4 the photo band and room facts, not the location
  section) and `SearchPage.tsx`. Whoever merges second merges `main` first.
- No open product question: decision 6 (honest circle) is Gilad's; the static places list over a geocoder, the
  cheap empty-view action and the snapped locate centre are engineering choices inside the scope he accepted.

## Digest (filled by orchestrator after verification)
Spec 0009y — My location, place jump, empty-area action, honest listing circle   (verified 2026-11-13, one part)
What a user can do after this: jump the map to their own area (refused outside Gush Dan) or to one of ~55 cities and neighbourhoods; get back to the whole area from an empty view; see an honest ~300 m area on the listing page and jump from it to the search map.
Decisions I need from you: none (decision 6 is in; the locate centre is snapped to ~200 m before it reaches the URL or a request, stricter than the draft).
KPIs this slice moves: none measured; listing page circle radius ~113 m → ~300 m.
Acceptance targets: the raw position never reaches the URL, a request or storage (AC2); every place inside the launch box (AC3).
Risks: ~55 one-off Nominatim lookups by the coder (stops and asks if unreachable; never from memory).
Reviewers: code, qa, ux, security   Estimated: 1 coder run (Opus/medium), 1 review round
Links: specs/0009y-map-extras.md · PRODUCT.md "Map" · specs/map-research/03-search-surface.md

## Verifier findings
Checked 2026-11-13 against `main` 04c8356 plus 0009v/0009w as specced. The maths holds:
`metersToPixels(300, 32.08, 14)` = 300 / (40075016.686 × cos 32.08° / (512 × 2^14)) = 300 / 4.05 ≈ 74.1 px,
37 px at zoom 13; today's `h-14` circle is a 28 px (~113 m) radius. MapLibre's world is 512 px per zoom level
whatever the raster `tileSize` (256 in `osm-raster.json`), so the 512 formula is right. Decision 6 and the
Market Q3 redirect ("old search links filtered to rooms redirect to the market search") are respected.

1. **major — "locate me" writes the person's position into the URL and the request box; AC2's privacy claim is
   false as written.** Item 4 sends `camera { center: <the position>, zoom: 15 }`, so 0009w's `moveend` writes
   `c` = the position rounded to 4 decimals (~11 m) into the URL (history, a copied or shared link) and the box
   sent to `GET /listings` is centred on it. That is not "the same exposure as panning by hand": panning is a
   choice of where to look, this is the device's fix of where the person is (often their home). AC2's "the
   position never appears in the URL or in any request" passes only because of rounding. Fix: snap the camera
   centre before sending it — `[round(lng / 0.002) × 0.002, round(lat / 0.002) × 0.002]` (~200 m, the listing
   offset's own grid, 0003c `JITTER_DEG`); the dot (`userPosition`, never written anywhere) stays at the raw fix.
   AC2 then asserts the URL's `c` and the request box's centre equal the snapped point, not the raw one (use a
   raw fix like 34.78123, 32.08167 that does not land on the grid). Rewrite the Risks bullet accordingly. Add
   `security` to `reviewers:` (checklist 8: precise location is PII; a Sonnet pass is enough). If the
   orchestrator prefers the exact centre instead, it is a security trade-off for Gilad (Speed rule 9), not a
   spec-writer call.
2. **major — the places list is not enumerated; the coder would curate 40–80 places and their Hebrew names by
   guess (checklist 9).** "Florentin, Neve Tzedek, … and the rest the box holds" leaves the set, the ids and the
   names open, and two listed cities are at or near the box edge. Fix: list every candidate in the spec as
   `id` (ASCII kebab-case, no dots — i18next's key separator) → Hebrew name → zoom, about 60 candidates so drops
   still leave ≥ 40, and name the drop rule (a lookup with no result, or a result outside `GUSH_DAN_BOUNDS`, is
   dropped, never moved by hand). Box check (from general geography, confirm with the lookups): inside — Tel
   Aviv-Yafo, Ramat Gan, Givatayim, Bnei Brak, Holon, Bat Yam (~1 km in from the west edge), Petah Tikva, Ramat
   HaSharon, Kiryat Ono, Or Yehuda, Yehud-Monosson, Giv'at Shmuel, Rishon LeZion (centre ~31.96–31.97, most of the
   city is south of 31.95), plus Hod HaSharon (~34.89, 32.15), Azor, Ganei Tikva, Savyon, Beit Dagan, which the
   spec does not name. **Herzliya is borderline**: its centre is about 32.16–32.17 against the 32.17 north edge,
   and most of the city (Herzliya Pituach, the north) lies outside — keep it only if the lookup lands inside, and
   say so in the list. Outside the box, so never in the list: Ra'anana, Kfar Saba, Kfar Shmaryahu, Rosh HaAyin
   (~34.956), Ness Ziona (~31.93); Lod, Shoham and Elad sit on the edge — leave them out. Neighbourhood
   candidates for the list: Tel Aviv — פלורנטין, נווה צדק, כרם התימנים, לב העיר, הצפון הישן, הצפון החדש, כיכר
   המדינה, בבלי, רמת אביב, רמת אביב ג׳, נווה אביבים, צהלה, הדר יוסף, יד אליהו, שפירא, נווה שאנן, התקווה, יפו,
   עג׳מי, יפו ד׳, רמת החייל; Ramat Gan — מרכז העיר, הבורסה, רמת חן, נחלת גנים, תל בנימין, מרום נווה, רמת עמידר,
   קריית קריניצי; Givatayim — בורוכוב, גבעת רמב״ם, שינקין, ארלוזורוב. Watch the prefix pairs this creates
   (רמת אביב / רמת אביב ג׳, יפו / יפו ד׳): see finding 6.
3. **major — hidden dependency: the empty view's "ניקוי" needs `SearchPage.tsx`, which Scope does not list
   (checklist 10).** `SearchMap` has no clear action and does not know whether filters are set; only
   `ResultsList` gets `hasFilters={active > 0}` and `onClear={clear}` (`SearchPage.tsx:164-170`). Fix: add to
   Scope "`SearchPage.tsx`: pass `hasFilters` and `onClear={clear}` to `SearchMap`, as to `ResultsList`" (the
   `clear` that 0009w makes keep `view=map` and the map params).
4. **major — focus is lost after "הצגת כל האזור".** The button exists only while `total === 0`; once the wider
   box answers, it unmounts under the person's focus. 0009t section 1's standing rule is that an action that
   removes its own control moves focus (Clear already goes to the count line through `focusCount`). Fix: after
   the show-all press, focus the count line (`countRef`) when the button unmounts, and assert it in AC5
   (`document.activeElement` is the `[aria-live="polite"]` line after the next answer).
5. **major — who owns the camera, the dot and the status line is undefined, so AC2 cannot be written against
   `LocateButton` alone.** `LocateButton` sits in `MapCanvas`'s `panel`, but the camera (`seq`), `userPosition`
   and the status line live in `SearchMap`, and AC2 checks the URL and the requests. Fix: state the interface —
   `LocateButton({ onLocated(center: [lng, lat]): void; onMessage(key: LocateMessageKey): void })` (or
   equivalent), with `SearchMap` owning `camera`, `userPosition` and one `status` state shared with the place
   box. Say AC2 renders `SearchPage` at `/search?view=map` through the `SearchMap.test.tsx` harness
   (`renderRoutes`, `mockApi`, the fake canvas's `lastCamera()` / `lastProps().userPosition`). jsdom has **no**
   `navigator.geolocation` and no `GeolocationPositionError`: stub with
   `Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: vi.fn() } })`
   and delete it in `afterEach` (not `vi.stubGlobal('navigator', …)`, which replaces the whole navigator); call
   the failure callback with plain `{ code: 1 }` / `{ code: 3 }`, so the component must compare `error.code` with
   literals (1, 2, 3), never the global `GeolocationPositionError.*` constants. The "absent" check reads
   `'geolocation' in navigator` at render. Waiting state: use the house `Button`'s `busy` (aria-busy +
   aria-disabled, keeps focus), not native `disabled`, which drops focus to `<body>` mid-press; AC2 asserts
   `aria-busy="true"` and `aria-disabled="true"`.
6. **major — when a datalist pick is detected is undefined, and "exact name" on every keystroke jumps mid-typing.**
   A datalist pick fires an ordinary `input` event (React `onChange`), indistinguishable in jsdom from typing; if
   any exact match jumps, typing "רמת אביב" on the way to "רמת אביב ג׳" (or "יפו" before "יפו ד׳") moves the map
   early. Fix: the place box jumps (a) on Enter with an exact match, and (b) on a change whose value exactly
   matches a name that is **not a prefix of another name** in the list (that is the pick from the list; a
   prefix name waits for Enter). AC4 adds: a change to an exact, non-prefix name sends the camera without Enter;
   a change to "רמת אביב" sends none until Enter.
7. **major — AC6's literal URL cannot pass when built with `writeMapPosition`.** `URLSearchParams.toString()`
   encodes the comma (`c=32.08%2C34.8`), and the decimal format of `c` is 0009w's (`32.08` vs `32.0800`). Fix:
   AC6 parses the link's `href` — pathname `/search`, `listing_type=apartment`, `view=map`, `z=15`, `pin=<id>`,
   and `parseMapPosition(params).center` equal to `[34.8, 32.08]` — instead of comparing one string.
8. **major — AC8's "the place box with its list open" cannot be captured.** A native `<datalist>` popup is
   browser chrome, not page content, and does not appear in Playwright screenshots. Fix: `map-place` shoots the
   box with a typed partial name (and, separately if wanted, the map after a jump plus the not-found message).
   For `map-locate`, name the setup: `context.grantPermissions(['geolocation'])` and
   `context.setGeolocation({ latitude: 32.79, longitude: 34.99 })` (Haifa) for the "outside" message, Tel Aviv for
   the dot (both screens projects are Chromium).
9. **minor — the status line vs 0009t's single live region.** No conflict with the tests as long as the line
   carries `role="status"` and **no** `aria-live` attribute: `SearchMap.test.tsx:473,486` and
   `SearchPage.test.tsx:1035` count `[aria-live="polite"]` and must stay at 1, and e2e uses the same selector. But
   it is a second live region, so say so explicitly as an amendment of 0009t's "never a second aria-live region"
   line, and apply 0009t section 2's pattern: the `<p role="status">` is always mounted and empty, filled only
   after a press; to re-announce the same message on a repeat press, clear it and set it one frame later. Add to
   AC2: `[aria-live="polite"]` count stays 1.
10. **minor — 0009w's fit-once can override a fast locate or place jump.** On a first open without `c`, the first
    answer with pins sends the fit camera; a press before that answer is then undone. Fix: any user camera
    (locate, place, show-all) cancels the pending fit-once for that mount; one line in item 4/5 and a case in AC4.
11. **minor — "הצגת כל האזור" is a no-op when the box already covers the launch area** (filters exclude
    everything). Fix: show it only when the current box does not contain `GUSH_DAN_BOUNDS`; then only "ניקוי"
    (with filters) remains.
12. **minor — `locateOutside` says "מחוץ לגוש דן"**, which is wrong for someone in Herzliya Pituach or north
    Herzliya (Gush Dan to locals, outside the box). Fix the proposal to "המיקום שלך מחוץ לאזור שבו יש כרגע
    מודעות." (ux may still reword).
13. **minor — Nominatim procedure details.** Feasible: the coder has Bash, ~60 lookups at ≥ 1.1 s are under two
    minutes. Say: a throwaway `curl` loop is fine and is not committed; a generic User-Agent naming the app
    (no personal email or name, per the privacy rule); `format=jsonv2&countrycodes=il&accept-language=he&limit=1`
    with `viewbox=34.74,32.17,34.95,31.95&bounded=1` so results come from inside the box; store the returned
    `lat`/`lon` rounded to 4 decimals. Licence: the numbers are OSM-derived (ODbL); keep the list under 100
    entries (OSMF's substantial-extract guideline treats fewer than 100 features as insubstantial, as I recall —
    confirm) and put "© OpenStreetMap contributors, ODbL, via Nominatim, <date>" in the file's comment. If
    Nominatim is unreachable the coder stops and messages the orchestrator, as the spec says (never coordinates
    from memory).
14. **minor — existing tests and screens to update are not named.** `ListingPage.test.tsx::ac6_listing_page_approximate_map`
    (lines 225-250) asserts `zoom: 14` and `approximate: true` and fails after item 7; say it is replaced by the
    new AC6 test. The listing page circle already shows in 0009j's `apartment-visitor` screens state
    (`listing.screens.ts`): re-shoot that state instead of adding `listing-circle`, or say why both.
15. **minor — the dot's stacking is not specified in MapLibre terms.** Pins set `zIndex` `''` or `'1'`
    (`MapCanvas.tsx:248`); a marker added later with `''` paints above earlier ones, and a negative z-index can
    fall behind the canvas. Fix: idle pins and bubbles get `zIndex '1'`, the selected `'2'`, the dot `'0'` (or
    the dot is added before any pin); the screens show it.
16. **minor — shared files with the parallel specs are not listed in Risks.** 0009x also edits `MapCanvas.tsx`,
    `fakeMapCanvas.tsx` and `he.json` (`search.sideMap`); 0009v adds the `markSeen` effect to `ListingPage.tsx`.
    Add them to the shared-files bullet (second to merge rebases).
17. **minor — estimate and coder model.** One run fits once findings 2 and 5 pin the list and the interfaces
    (5 small pieces, 2 screens, 5 unit files, 1 e2e step, 4 screen states). The geolocation privacy, 0009t's
    focus/live-region rules and 0009w's camera interplay argue for Opus/medium rather than Sonnet/medium
    (Speed rule 6, "when in doubt, the stronger one").

**Applied by the orchestrator (2026-11-13):** all 17 findings, in Scope 1–9, the ACs, reviewers (`security` added) and the estimate (coder Opus/medium). Finding 1 took the snapped centre, which is stricter than the draft; no question for Gilad.
