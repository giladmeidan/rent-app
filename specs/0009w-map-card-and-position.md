---
id: 0009w
title: Pressing a pin opens a compact card inside the map without moving the page, the map opens fitted to the results, and its position and selected pin live in the URL so Back, reload and a shared link reopen the same view
status: in-progress
depends_on: [0009v]   # same files (MapCanvas, fakeMapCanvas, SearchMap); uses 0009v's optional onMoveEnd `view` (centre + zoom), data-pin-id, bubbles and the same-place list
reviewers: [code, qa, ux]   # ux: the docked card at 390 and 1440, close and Escape, the attribution kept clear; qa: URL parsing of user input, the SearchPage traps, focus timing, Back/reload. No security: map position is public, parsed and clamped like the filters. No perf: no query change (one extra fit-driven box request on a first open)
estimate: 1 coder run   # upper end (verifier). Coder Opus/high: URL state shared with the filters form, focus timing under react-router's transitions (Speed rule 6, "when in doubt, the stronger one")
---

## Goal
After this ships, on `/search?view=map`:
- pressing a pin shows that listing's compact card **inside** the map (along the bottom on a phone, in a bottom
  corner on desktop), so the page no longer jumps (today 342 px on desktop, 374 px on a phone) and the pressed
  pin stays visible above the card; a close button and Escape dismiss it;
- the first open, with no position to restore, fits the map to the results instead of all of Gush Dan;
- the map's centre, zoom and selected pin are kept in the URL (`c`, `z`, `pin`), so Back from a listing, a
  reload, switching to the list and back, and a shared link reopen the same view with the same card (Gilad,
  2026-11-13, decision 4).

Serves the map improvements job (Slice 9c, `specs/map-research/03-search-surface.md` sections 1 and 2). It also
gives `MapCanvas` the two things 0009x and 0009y build on: a slot that accepts presses and a way to move the
camera after mount.

## Scope
**In:**

1. **`web/src/features/search/mapPosition.ts`** (new, pure; the map's URL params, as `filters.ts` is the
   filters'):
   - `MAP_PARAMS = ['c', 'z', 'pin'] as const`.
   - `parseMapPosition(params): { center?: [lng, lat]; zoom?: number; pin?: string }`. The URL is user input:
     - `c` is `lat,lng` (latitude first, as people read coordinates), each `-?\d{1,3}(\.\d{1,6})?`; it is kept
       only when the point lies inside `MAP_POSITION_BOUNDS` (new in `components/map/config.ts`: `GUSH_DAN_BOUNDS`
       widened by 0.5° on each side), so a hand-edited link never flies the map to another country;
     - `z` is a number with at most 2 decimals, clamped to `[MAP_MIN_ZOOM, MAP_MAX_ZOOM]`; it is used only
       together with a valid `c` (a centre without a zoom uses zoom 14; a zoom without a centre is ignored);
     - `pin` is kept only when it matches `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`
       case-insensitively, with no version check (test fixtures use `00000000-…` ids);
     - anything else is dropped silently, never an error, never a request.
   - `writeMapPosition(params, position: { center?; zoom?; pin? }): URLSearchParams` — a copy of `params` where
     **only the keys present in `position`** are touched (`'pin' in position`): `center` writes `c` as
     `String(Math.round(lat × 1e4) / 1e4) + ',' + String(Math.round(lng × 1e4) / 1e4)` (4 decimals, about 11 m,
     as `roundBbox`), `zoom` writes `z` as `String(Math.round(zoom × 100) / 100)`, `pin: undefined` removes `pin`.
     So a move write `{ center, zoom }` keeps the selected pin. Every other key and its order are kept.
   - `pickMapParams(params)` → a `URLSearchParams` holding only the map params, for carrying them across a
     filter change.
2. **`web/src/features/search/SearchPage.tsx`** — the two traps from `04-technical-notes.md`:
   - **The filters form must not remount on a map move.** Today `FiltersForm`'s `key` is
     `searchParams.toString()`. It becomes `filtersKey = toSearchParams(filters).toString()` (the parsed
     filters plus `view`; `parseFilters` already ignores `c`, `z`, `pin`). The focus effect's dependency uses
     `filtersKey`, and `setFilters`' "did the filters change" test compares **the filter part of the next URL
     only**: `toSearchParams(parseFilters(next)).toString() !== filtersKey`. So a map move never steals focus,
     and an Apply that changes nothing sets no stale focus flag for the next view toggle.
   - **Map params never enter a query key or a request.** They are not filters: `['search', filters]` and
     `['search-map', filters, bbox]` stay as they are (a test pins it).
   - Apply, Clear, a sort change and the view toggle **carry the map params along** (`pickMapParams` merged into
     the next params), so changing a filter keeps the map where it is and switching to the list and back
     restores it. Clear in map view keeps `view=map` and the map params.
3. **`web/src/components/map/MapCanvas.tsx`**
   - **Stacking:** the map container (`containerRef`'s div) gets `isolate`, so markers (0009v's `z` up to about
     51) and controls stack inside it and the later siblings `panel` and `overlay` always paint above them.
   - **Camera after mount:** `camera?: { seq: number } & ({ bounds: Bbox; maxZoom?: number } | { center: [lng,
     lat]; zoom: number })`. The latest camera whose `seq` has not been applied yet is applied once the map is
     ready (an effect on `[ready, camera?.seq]` with a last-applied-seq ref), so a camera set before `load` is not
     lost: bounds → `fitBounds(bounds, { padding: 48, maxZoom })`, centre → `easeTo({ center, zoom })`
     (animations skipped under reduced motion by MapLibre, `essential` not set). The initial `bounds` / `center` +
     `zoom` props keep their meaning (read once at creation).
   - **A slot that accepts presses:** `panel?: ReactNode`, rendered as given inside the (relative) region once
     loaded, with no wrapper: its elements position themselves (`absolute`) and receive presses, unlike
     `overlay`'s pointer-events-none content. A panel may hold several positioned elements (0009y adds a map
     button).
   - **Keep the pressed pin visible:** in an effect keyed on `selectedId` and `loaded` (not on every panel
     render), when the panel holds an element marked `data-map-card`, compare `[data-pin-id="<selectedId>"]`'s
     `getBoundingClientRect()` with that element's (8 px margin); when they intersect, `panBy([0, pinRect.bottom −
     cardRect.top + 8])` (vertical only; reduced motion respected).
   - The OpenStreetMap attribution must stay visible (licence): the panel never covers it (see UI).
4. **`web/src/components/map/__tests__/fakeMapCanvas.tsx`** learns `camera` (every distinct `seq` recorded, read
   by `cameras()`), `panel` (rendered inside the fake region) and passes 0009v's optional `view` with `moveTo`.
5. **`web/src/features/search/SearchMap.tsx`**
   - **Position in the URL** (`useSearchParams`):
     - initial view: `parseMapPosition` gives `center` + `zoom` → `MapCanvas center/zoom`; else
       `bounds={GUSH_DAN_BOUNDS}` as today. Whether the map **opened with a restored position** is captured once,
       in a `useState` initialiser at mount (the `load` move writes `c`/`z` before the first answer, so the URL
       cannot be re-read later for this);
     - `onMoveEnd(bbox, view)` sets the query box as today, and **only when `view` is given** writes `c` and `z`
       with `writeMapPosition(params, { center, zoom })` and `setSearchParams(…, { replace: true })` (no history
       entry per pan; `pin` kept). Existing tests that call `moveTo(bbox)` without a view keep their exact URLs;
     - the selected listing is `pin` from the URL, written with `replace` on a pin press and removed
       (`{ pin: undefined }`, replace) on close. The card shows only while that listing is in the current results
       (today's rule). When a non-placeholder answer lacks the selected listing, `pin` is removed (replace), so a
       later pan never reopens a card nobody pressed.
   - **First open fits the results:** when the map opened without a restored position, the first answer with at
     least one located listing sends one `camera` `{ bounds: those pins' extent, maxZoom: 15 }` (15 so a single
     pin does not zoom to street level); never again in that mount. An answer with no located listings leaves the
     Gush Dan view. Any later camera this mount sends (0009y) cancels a fit not yet sent.
   - **The card in the map:** the selected card moves from under the map into `MapCanvas`'s `panel`, inside a
     `relative` wrapper marked `data-map-card`, using `ListingCard`'s new `compact` layout (item 6) with the badge
     and match chips as today. The close button is a **sibling** of `ListingCard` in that wrapper (`absolute top-2
     end-2 z-10`, so it sits above the card's stretched title link and never opens the listing): the house
     `Button`, icon-only, outline X icon, `aria-label` = `search.map.closeCard`.
   - **The same-place list** (0009v) moves into the panel too, in the same `data-map-card` wrapper and with the
     same close button, scrolling inside it when taller than half the map (`max-h-[50%] overflow-y-auto`). It is
     component state, not in the URL (Back does not restore it); opening it removes `pin` (replace).
   - **Escape:** an `onKeyDown` on a wrapper `div` around `MapCanvas` in `SearchMap` (marker, canvas and panel
     keydowns bubble to it) closes whichever is open, the card or the list, exactly like its close button.
   - **Focus, after the URL-driven render** (react-router 7.18.5 wraps every location update in
     `React.startTransition`, so the render that shows the card comes after the press handler): the press and
     close handlers set a pending-focus ref; effects consume it once the render reflects the change:
     - pin press → keyed on `selected?.id`: focus the card's link (0009t's rule; with the card inside the map it
       scrolls nothing);
     - close or Escape on a card → keyed on the pins and bubbles: focus `[data-pin-id="<id>"]` if present, else
       the bubble whose members hold that id (`[data-pin-id="cluster:…"]`), else the map canvas (the pin is no
       longer kept apart, so it can fold into a bubble);
     - close or Escape on the same-place list → the bubble that opened it, else the canvas;
     - the selected listing leaving the results while focus is inside its card → the map canvas.
6. **`web/src/features/listings/ListingCard.tsx`**: `layout` gains `'compact'` — the row anatomy at **every**
   width (photo box at the inline start, `w-24`, 16:10, the same placeholder), title, price row and facts as in
   `row`, and the price row gets `pe-12` so the badge clears the close button; no other layout changes.
7. **`web/src/locales/he.json`**: `search.map.closeCard`: `"סגירת הכרטיס"`.

**Out:**
- The side map (0009x); locate me, place search, the empty-view action, the listing page link (0009y; that link
  uses this spec's params).
- A swipeable row of cards on a phone and a draggable bottom sheet (`03-search-surface.md` 1: later, or skipped).
- Hiding the sort select in map view, and a taller phone map: the sort still decides which 50 pins load, so it
  stays until a slim pins response exists (FOLLOWUPS 125–126 stay open).
- MapLibre's built-in `hash` option (it rewrites the URL behind React Router's back; research 03 section 2).

**New dependencies:** none.

## Data
None. New URL params on `/search`: `c=<lat>,<lng>`, `z=<zoom>`, `pin=<listing id>`; never sent to the API,
never part of a query key. `URLSearchParams` serialises `c`'s comma as `%2C` (`c=32.0712%2C34.8123`); parsing
accepts both, and tests and the 0009y link read params through `searchParams`, never a raw-string pattern.

## API
None (`GET /listings` with the box, unchanged).

## UI
Screen: `/search?view=map`. Artboards: `design/screens-v1/Search.dc.html` and `SearchDesktop.dc.html` draw the map;
neither draws the docked card, so its design is here, from the brand kit (`design/brand/`): no shadow on cards
(the card keeps its border), existing tokens only.

- **Phone (below `lg`):** the panel spans the map's width minus a 12 px gutter (`inset-x-3`), docked at
  `bottom-8`, above the attribution line (MapLibre's single 20 px line at a 358 px map); AC7 checks that the two
  boxes never intersect, and the coder raises the offset if they do.
- **Desktop (`lg` and up):** the panel is 360 px wide (`w-[22.5rem]`) at `bottom-3 end-3`, the corner free of
  controls (attribution at the bottom inline start, zoom at the top inline end).
- RTL: `start`/`end`/`inset-x` only; the close button at the card's top `end`.

States:
- **Loading / empty / error / unavailable:** unchanged from 0009t (above the map). No panel.
- **Success, nothing selected:** the map alone, fitted to the results on a first open.
- **Success, a pin selected:** the compact card in the panel, focus on its link, the pin visible above it.
- **Same-place list:** the list in the panel, focus on its first link; close or Escape returns to the bubble.
- **Selected listing gone** (filters or a new box removed it): the panel closes, `pin` is removed, focus (if it
  was in the card) goes to the canvas.
- **Restored view** (Back from a listing, reload, link): the same centre and zoom; the card is back once the
  results load.

i18n keys added: `search.map.closeCard`.

## Acceptance criteria
- [ ] AC1 `parseMapPosition` keeps `c=32.0712,34.8123&z=13.5&pin=<uuid>` (and `c=32.0712%2C34.8123`, and an
  `00000000-…` id); drops a `c` outside `MAP_POSITION_BOUNDS` (`c=40.7,-74.0`), a malformed `c` (`c=abc`,
  `c=32.07`), a non-UUID `pin`, and a lone `z`; clamps `z=25` to 19 and `z=2` to 8; `writeMapPosition` rounds to 4
  and 2 decimals, writing `{ center, zoom }` over `…&pin=<uuid>` keeps the pin, `{ pin: undefined }` removes it,
  and every other key keeps its order — `web/src/features/search/__tests__/mapPosition.test.ts::ac1_parse_and_write`
- [ ] AC2 Given the map view after a filter Apply (a pushed entry), with a half-typed price in the filters form,
  When the map reports a move with a `view`, Then the form keeps the typed value (no remount), focus does not
  move, the URL gained `c` and `z`, and Back returns to the URL before the Apply (no entry per move) —
  `web/src/features/search/__tests__/SearchPage.test.tsx::ac2_map_move_keeps_the_form`
- [ ] AC3 Given `/search?view=map&c=…&z=…`, Then no `GET /listings` request carries `c`, `z` or `pin` and the
  query cache holds no key containing them; When a filter is applied or cleared or the sort changes, Then the
  next URL still holds the same `c` and `z`; When an Apply changes nothing, Then focus stays on Apply, and a
  following view toggle leaves focus on the toggle; When the view switches to the list and back, Then the map
  opens at that `c` / `z` — `SearchPage.test.tsx::ac3_map_params_ride_along_not_in_queries`
- [ ] AC4 Given no position in the URL, When the fake reports a first `view` (writing `c`/`z`) and then three
  located listings arrive, Then `cameras()` holds exactly one camera with their extent and `maxZoom: 15`, and
  still one after a second answer; Given a restored position, Then `center`/`zoom` come from the URL and
  `cameras()` is empty; Given a first answer with no located listing, Then no camera —
  `web/src/features/search/__tests__/SearchMap.test.tsx::ac4_first_open_fits_once`
- [ ] AC5 Given a pin pressed, Then the card renders **inside** the map region in a `data-map-card` wrapper with
  the compact layout, its link has focus after the URL-driven render, and the URL has `pin=<id>` (replace: Back
  after a pushed Apply skips it); pressing the X does not navigate; When Escape is pressed inside the region or the
  X is pressed, Then the card is gone, `pin` is removed and focus is on that pin's button, or, with three located
  fixtures at one point and a zoom reported (the pin folds back into a bubble), on that bubble; Given the
  same-place list open, Then the X and Escape close it and focus returns to its bubble; Given `pin=<id>` in the
  URL and that listing in the results, Then its card shows without a press; Given a new answer without the
  selected listing, Then `pin` is removed —
  `SearchMap.test.tsx::ac5_card_in_the_map_close_and_escape`
- [ ] AC6 `ListingCard` with `layout="compact"` renders the row anatomy at every width (`data-layout="compact"`,
  the photo box `w-24`, the price row `pe-12`) —
  `web/src/features/listings/__tests__/ListingCard.test.tsx::ac6_compact_layout`
- [ ] AC7 In the browser, at 1440 × 900 and at 390 × 844, deterministic on CI's shared database: open
  `/search?view=map&price_min=P&price_max=P&c=<lat>,<lng>&z=16` (`P` from 0009v's unique-price plan, `lat`/`lng`
  from the polled `GET /listings/{id}`), so the test pin is alone at the map's centre; `region.scrollIntoViewIfNeeded()`,
  `pin.focus()`, read `scrollY`, then press Enter: `scrollY` is unchanged (±2 px), the card is inside the map
  region, `elementFromPoint` at the card's centre is inside `[data-map-card]`, the pin's bounding box does not
  intersect the card's, and the OpenStreetMap attribution's box does not intersect the card's. Before opening the
  listing, wait for `aria-busy="false"` and for `page.url()` to read the same value twice; after the listing page
  and Back, `c`, `z` and `pin` equal that URL's by parsed value (`URL.searchParams`), the card is shown and the pin
  is pressed (`aria-pressed="true"`) — `web/e2e/map.spec.ts::ac8_visitor_finds_a_listing_on_the_map` (steps
  `ac7_card_docked_desktop`, `ac7_card_docked_phone`, `ac7_back_restores_the_view`)
- [ ] AC8 `make screens` shows the docked card at 390 and 1440 and the same-place list in the panel — states `map`
  (the card, now docked) and 0009v's `map-same-place`, both updated, in `web/e2e/screens/search.screens.ts`

## Tests to write
Unit: `mapPosition.test.ts` (AC1), `SearchPage.test.tsx` (AC2, AC3; history shown by pushing a filter Apply first,
since `renderRoutes` starts `MemoryRouter` with one entry), `SearchMap.test.tsx` (AC4, AC5; the existing
`ac5_pin_opens_the_listing_card` now finds the card inside the region; AC2–AC5 call `moveTo(bbox, view)`),
`ListingCard.test.tsx` (AC6). E2E (CI only, never local — Gilad 2026-11-12): AC7 in `map.spec.ts`. Its existing
exact URL assertions (`map.spec.ts:82` after the toggle and `:134` after Back) become parsed-value checks, because
the map writes `c` and `z` as soon as it loads; no other e2e asserts an exact `view=map` URL. Screens: AC8.

## Risks / open questions
- **`replace` on every move** re-renders `SearchPage` per `moveend`. That is one render per settled move, not
  per frame; `FiltersForm` must not remount (AC2) and `MapCanvas` must not react to its initial-view props
  changing (it reads them once). If profiling shows a cost, debounce the URL write, not the box query.
- **The keep-visible pan** happens inside `MapCanvas` (it needs real boxes), so only AC7 covers it.
- **Back between two `/search` entries** (after an Apply in map view) is a POP inside the mounted `SearchMap`;
  `MapCanvas` reads its initial view once, so the map stays put while the URL shows the older `c`/`z` until the
  next move. Accepted: Back from another page (the listing) is what restores the view.
- **The listing page's back link** stays `/search` (no map params); Back is what restores the view. The market
  (Slice 10 step 1) changes that link by listing type; no conflict in intent.
- **Shared files with the Slice 10 market specs:** `SearchPage.tsx` (step 1 removes the type filter and may add a
  market search), `ListingCard.tsx` (step 3 photos change the photo box). Whoever merges second merges `main`
  first; the compact layout's photo box must follow whatever step 3 does to the others.
- No open product question: decision 4 (URL) is Gilad's; the card placement and fit-once rule are the research's
  recommendations in the scope he accepted.

## Digest (filled by orchestrator after verification)
Spec 0009w — The card inside the map, the map's position in the URL   (verified 2026-11-13, one part)
What a user can do after this: press a pin and read its compact card inside the map with no page jump; Back from the listing, reload or a shared link reopen the same view and card; the map opens fitted to the results.
Decisions I need from you: none (decision 4, the URL, is in).
KPIs this slice moves: page scroll on a pin press 342/374 px → 0; Back keeps the view (today it resets to all of Gush Dan).
Acceptance targets: scrollY unchanged ±2 px on a pin press at 1440 and 390, the card never covers the pin or the OSM attribution (AC7).
Risks: focus timing under react-router's transitions — every focus move runs after the URL-driven render.
Reviewers: code, qa, ux   Estimated: 1 coder run (upper end, Opus/high), 1 review round
Links: specs/0009w-map-card-and-position.md · PRODUCT.md "Map" · specs/map-research/03-search-surface.md

## Verifier findings
Checked 2026-11-13 against `main` 04c8356 plus 0009v (including its verifier findings: `onMoveEnd`'s `view` becomes
optional, the e2e pins one unique price `P`, bubble focus moves to the anchor). Every path, prop and test file named
exists or is marked new; `parseFilters` ignores `c`/`z`/`pin`; `useSearch`/`useMapSearch` keys hold only parsed
filters; `ActiveFilterTags` are static (no URL writes); `RouteFocus` scrolls only on a pathname change, so `replace`
writes never scroll; `FiltersForm` reads `filters` only in its `useState` initialiser, so the `filtersKey` key does
remove the remount trap; `search.spec.ts` and `a11y.spec.ts` hold no exact `view=map` URL assertion (only
`map.spec.ts:82` and `:134`). react-router is 7.18.5, whose `BrowserRouter` and `MemoryRouter` wrap every location
update in `React.startTransition` (findings 3 and 7 follow from that). Scope fits one Opus/high run, at its upper end.

1. **major. `writeMapPosition` would wipe `pin` on every move.** "`pin: undefined` removes it" with an optional `pin`
   means the moveend write `writeMapPosition(params, { center, zoom })` removes the pin, so the keep-visible pan's own
   `moveend` closes the card it made room for. **Fix:** only keys present in `position` are touched
   (`'pin' in position`); a moveend write passes `{ center, zoom }` and keeps `pin`; deselecting passes
   `{ pin: undefined }`. Add to AC1: writing `{ center, zoom }` over `…&pin=<uuid>` keeps the pin.
2. **major. `setFilters`' comparison against `filtersKey` is underspecified and, read literally, leaves a stale focus
   flag.** `next` now carries `c`/`z`/`pin`, so `next.toString() !== filtersKey` is always true: an Apply that changes
   nothing sets `focusCount`, the effect (keyed on `filtersKey`) does not run, and the stale flag fires on the next
   view toggle, pulling focus from the toggle to the count line. **Fix:** compare the filter part only:
   `toSearchParams(parseFilters(next)).toString() !== filtersKey`. Add to AC3: in map view with `c`/`z`, an Apply that
   changes nothing leaves focus on Apply, and a following view toggle leaves focus on the toggle.
3. **major. Focus to the card link breaks once the selection lives in the URL.** The pin press bumps `focusRequest`
   (urgent) and writes `pin` (a transition in RR 7.18.5). The focus effect runs on the urgent render, before the card
   exists, finds no link and never runs again. Close/Escape has the same timing problem in reverse: after `pin` leaves
   the URL, 0009v regroups without the `keepApart` pin, so the pin's button can be replaced by a bubble after the
   handler focused it. **Fix:** every focus move that depends on the URL-derived selection runs in an effect after
   the render that reflects it: a pending-focus ref set by the press/close handler, consumed in an effect keyed on
   `selected?.id` (press → card link) and on the pins/bubbles (close → `[data-pin-id="<id>"]` if present, else the
   bubble whose members hold the id, `[data-pin-id="cluster:…"]`, else the map canvas). AC5 asserts the bubble case
   with three located fixtures at one point and zoom reported.
4. **major. Pins paint over the docked card.** 0009v sets `marker.style.zIndex` up to about 51; neither the region
   nor the map container creates a stacking context, so a panel with `z-index: auto` sits under every pin, which also
   takes its presses. **Fix:** give `MapCanvas`'s map container (`containerRef` div) `isolate`, so markers and
   controls stack inside it and `panel`/`overlay` (later siblings) paint above. Add to AC7: `elementFromPoint` at
   the card's centre is inside `[data-map-card]`.
5. **major. The keep-visible check cannot satisfy AC7's box test.** It tests the pin's *point* with 16 px to spare,
   but the pin button is 44 px tall centred on the point (Marker anchor `center`) and a score chip is about 130 px
   wide, so a point 17 px above the card, or beside the 360 px desktop card, still leaves the pin's box over it. **Fix:**
   compare `[data-pin-id="<selectedId>"]`'s `getBoundingClientRect()` with `[data-map-card]`'s (8 px margin); when
   they intersect, `panBy([0, pinRect.bottom − cardRect.top + 8])` (vertical only; positive y moves the content up).
   Run it in an effect keyed on `selectedId` and `loaded`, not on every panel render.
6. **major. The close button collides with the card's stretched link and its badge.** `ListingCard`'s title link has
   `after:absolute after:inset-0` over the whole card, and the price row puts `badge` at its inline end, exactly where
   the close button goes. As written, a press on the X can open the listing, or the X covers the match badge.
   **Fix:** the close button is a sibling of `ListingCard` inside the `data-map-card` wrapper (`relative`),
   `absolute top-2 end-2 z-10`; the compact layout gives its price row `pe-12` so the badge clears it. Add to AC5:
   pressing the X does not navigate.
7. **major. The same-place list in the panel has no close, Escape, URL or focus rule.** Scope 5 gives the close
   button and Escape to "the card" only, and "focus to the map canvas when the pin is inside a bubble" cannot happen
   for a selected pin (it is always `keepApart`). **Fix:** say that the list gets the same close button (same key);
   Escape closes it; focus returns to the bubble that opened it (`[data-pin-id="cluster:…"]`), else the canvas; the
   list is component state, not in the URL (Back does not restore it); opening it removes `pin` (replace), which is
   0009v finding 6 expressed as a URL write. Name where Escape is caught: an `onKeyDown` on a wrapper `div` around
   `MapCanvas` in `SearchMap` (marker and canvas keydowns bubble to it). Add the list's close/Escape to AC5.
8. **major. AC7 is not deterministic.** The test listing's point is random per run (fake geocoder hash of the random
   street), so after a fit it can sit in a bubble, under a control or below the fold at 390 × 844, and
   `pin.press('Enter')` scrolls it into view before the press, so `scrollY` changes before the card exists. The
   keep-visible pan also writes `c` after the press, so the URL read before the click may not be the one Back
   restores. **Fix:** in both steps open `/search?view=map&price_min=P&price_max=P&c=<lat>,<lng>&z=16` (P from 0009v's
   plan, lat/lng from the polled `GET /listings/{id}`), so the test pin is alone at the map's centre; call
   `region.scrollIntoViewIfNeeded()` and `pin.focus()`, then read `scrollY`, then press Enter; before clicking the
   card link, wait for `aria-busy="false"` and for `page.url()` to read the same value twice; compare `c`, `z` and
   `pin` after Back by parsed value (`URL.searchParams`), not by string.
9. **minor. Write `c`/`z` only when `view` is given.** After 0009v's fix the second `onMoveEnd` argument is optional.
   Say that `SearchMap` writes the position only when `view` arrives; then the existing exact-path tests that call
   `moveTo(BOX)` keep passing (e.g. `SearchMap.test.tsx:561`), and AC2–AC5 call `moveTo(bbox, view)`.
10. **minor. "Opened without a restored position" must be fixed at mount.** The `load` moveend writes `c`/`z` before
    the first answer, so re-reading the URL at answer time always finds a position and the fit never runs. **Fix:**
    capture it in a `useState` initialiser; AC4's no-position case reports a `view` first and still expects the fit.
11. **minor. AC4 cannot count cameras with `lastCamera()`.** **Fix:** the fake records every distinct `seq` in
    `cameras()`; AC4 expects `cameras()` to have length 1 after a second answer.
12. **minor. A camera given before the map is ready.** 0009x/0009y may set one early. **Fix:** `MapCanvas` applies
    the latest camera once ready (one sentence in Scope 3).
13. **minor. UUID rule.** Test fixtures use `00000000-0000-0000-0000-…` ids (`fixtures.ts:11`), which fail a
    version-strict check. **Fix:** `pin` matches `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
    case-insensitive, no version check.
14. **minor. History assertions in unit tests.** `renderRoutes` starts `MemoryRouter` with one entry, so "Back leaves
    `/search`" (AC2) and "pin … (replace)" (AC5) cannot be shown by a Back. **Fix:** push a filter Apply first, then
    move/press, then Back returns to the pre-Apply URL.
15. **minor. `c`'s comma is serialised as `%2C`** by `URLSearchParams.toString()`, so a shared link reads
    `c=32.0712%2C34.8123`. Fine for parsing; say it in Data so e2e patterns and the 0009y link use `searchParams`,
    not a raw-string regex.
16. **minor. The card vanishing under focus.** When a new answer drops the selected listing while focus is inside
    the card, focus falls to `<body>` (0009t rule). **Fix:** move focus to the map canvas then. Also a stale `pin`
    re-opens the card with no press when a later pan brings the listing back; either accept it in Risks or remove
    `pin` (replace) when a non-placeholder answer lacks it (recommended).
17. **minor. Phone bottom offset.** "The coder measures the attribution" needs a browser the coder may only reach
    through `make screens`. **Fix:** default `bottom-8` (MapLibre's attribution is one 20 px line,
    "MapLibre | © OpenStreetMap contributors", at a 358 px map width), with AC7 as the check.
18. **minor. AC8's state names.** `search.screens.ts` has no `map-card` state; the card state is `map` (`:256`).
    **Fix:** "state `map` (card docked) and 0009v's `map-same-place`, both updated".
19. **minor. Back between two `/search` entries.** After an Apply in map view, Back is a POP within the mounted
    `SearchMap`; `MapCanvas` reads its initial view once, so the map stays put while the URL shows the older `c`/`z`
    until the next move. **Fix:** accept it in Risks (only Back from another page restores the view).

**Applied by the orchestrator (2026-11-13):** all 19 findings, in Scope 1–6, Data, UI, AC1–AC8 and Risks (19 accepted as a known limit). No question for Gilad.
