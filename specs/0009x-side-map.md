---
id: 0009x
title: On a desktop 1280 px or wider, the search list has a map beside it that shows the listed results, highlights the pin of the card under the pointer or focus, scrolls to a card when its pin is pressed, and opens the full map at the same place
status: verified
depends_on: [0009v, 0009w]   # 0009v: useListingPins, clusterPins, bubbles; 0009w: MapCanvas `camera` (applied once ready), writeMapPosition / parseMapPosition
reviewers: [code, qa, ux, perf]   # perf: the ~1 MB map chunk and OSM tiles now load on every wide-desktop list view (0003d's rule changes), plus a seeker's likes/applications requests; ux: three-column layout, hover sync, keyboard path; qa: the mirror rules, lazy mount, the e2e suite at 1280. No security: public data, no new endpoint
estimate: 1 coder run   # coder Opus/medium
---

## Goal
After this ships, on `/search` (list view) at 1280 px and wider:
- a map sits beside the result list (filters | list | map, as `design/screens-v1/SearchDesktop.dc.html` draws);
- it **mirrors the list** (Gilad, 2026-11-13, decision 3): its pins are the listings the list has loaded,
  "load more" adds pins, and panning or zooming it never changes the list;
- pointing at or focusing a card highlights its pin; pressing a pin scrolls its card into view and highlights it;
- a "פתיחת המפה המלאה" button opens the full map view at the same place;
- the cards are the keyboard and screen-reader path; the side map's pins, bubbles, zoom buttons and canvas are
  neither tab stops nor exposed to assistive tech (decision 7);
- it loads only after the list has rendered, never below 1280 px, on public OSM tiles (decision 5).

The full map view (`?view=map`) is unchanged and stays a feature of its own. Serves the map improvements job
(Slice 9c, `specs/map-research/03-search-surface.md` section 3). Closes `specs/FOLLOWUPS.md` lines 196 and 216
(0009i desktop map pairing): Gilad chose a map beside the list instead of a list beside the map.

## Scope
**In:**

1. **`web/src/components/useMediaQuery.ts`**: `useIsWide()` → `useMediaQuery('(min-width: 1280px)')` (Tailwind
   `xl`), next to `useIsDesktop`.
2. **`web/src/components/map/MapCanvas.tsx`**: `keyboard?: boolean` (default `true`). `false` (the side map):
   - every pin and bubble element and the `NavigationControl` container get `aria-hidden="true"`, and their
     buttons `tabindex="-1"`;
   - the canvas is treated as the static map's is (no `role`, no label, `aria-hidden`, `tabindex="-1"`);
   - so the region exposes only the OSM attribution link (which stays: licence); mouse and touch behaviour is
     unchanged. axe's `aria-hidden-focus` passes because nothing inside is tabbable.
   - The highlight needs no new prop: the side map has no selection, so it passes `selectedId={highlightedId}` and
     reuses 0009v's accent-filled selected chip, which `clusterPins` keeps apart and draws on top. (0009w's
     keep-visible pan does nothing here: the side map has no `data-map-card`.)
3. **`web/src/components/map/__tests__/fakeMapCanvas.tsx`** learns `keyboard`: when false it renders its pin and
   bubble buttons with `tabindex="-1"` and `aria-hidden="true"`.
4. **`web/src/features/search/SideMap.tsx`** (new)
   - Props: the list's loaded items, `filtersKey`, `highlightedId`, `onPinPress(id)`, `onOpenFullMap(position)`.
   - Pins: `useListingPins(items)` (0009v), clustered with `clusterPins(pins, zoom, keepApart = {highlightedId})`
     at the side map's own zoom; bubbles labelled as 0009v.
   - `MapCanvas` with `label = t('search.sideMap.label')`, `bounds={GUSH_DAN_BOUNDS}`, `minZoom={MAP_MIN_ZOOM}`,
     `keyboard={false}`, `selectedId={highlightedId}`, `onPinClick={onPinPress}`, and
     `onBubbleOpen={(ids) => onPinPress(ids[0])}` (a bubble that never separates scrolls to and highlights its
     best member's card; members are sorted by `z`). Its moves only update the zoom (for clustering) and the
     position the "open" button uses; it sends no `GET /listings` of its own.
   - **Fitting:** one `camera` `{ bounds: located pins' extent, maxZoom: 15 }` whenever a **first page** arrives
     for a `filtersKey` (the first mount, a new filter or sort, or a same-key refetch such as after logout or a
     profile save) and it holds located pins. "Load more" never refits (the map would jump while the person
     reads). 0009w's `MapCanvas` applies a camera set before the map is ready once it is.
   - **"פתיחת המפה המלאה"**: a `Button` (secondary, small) in a row **above** the map, inside the side map's
     column (not over the map, so it never covers a pin and the map stays free of tab stops). It calls
     `onOpenFullMap` with the side map's last reported `{ center, zoom }`.
5. **`web/src/features/search/SearchResults.tsx`** (new, between `SearchPage` and the list): holds
   `highlightedId` so a hover re-renders only the list and the side map, never `FiltersForm`; renders
   `ResultsList` and, when shown, `SideMap`. `flattenPages(search.data)` is memoised on `search.data`, so the pins
   are rebuilt only when the data changes.
   - **Layout and mount:** the two-column layout (list `27.5rem`, one card per row | side map `minmax(0,1fr)`)
     depends only on `useIsWide() && view !== 'map'`. The side map **mounts** the first time a first page
     answers with `total > 0` (after the browser is idle: `requestIdleCallback` with a 2 s timeout, else
     `setTimeout` 200 ms; the list never waits for it) and **stays mounted** until the view or the width changes.
     While a new first page loads it shows no pins; after a `total === 0` answer or an error it stays with no
     pins. Before its first mount the column is empty.
   - The side map column is `sticky` at `top-4` with height `calc(100vh-2rem)` (`min-h-[360px]`): the "open" row,
     then the map filling the rest. The header is not sticky, so no header offset.
   - **Highlight rules:** the pointer wins while it is over a card (`pointerenter` on its `<li>`); on
     `pointerleave` the highlight falls back to the card that holds focus, else clears; `focusin` on a card sets
     it, `focusout` that leaves the card applies the same fallback; a pin press sets it and scrolls that card into
     view (`scrollIntoView({ block: 'nearest', behavior: reduced motion ? 'auto' : 'smooth' })`), and that
     highlight lasts until the next card pointer or focus event. Focus never moves on a pin press (the cards are
     the keyboard path).
   - **The highlighted card's cue is not an outline** (`Card`'s focus style is an accent outline): the `<li>`
     carries `data-highlighted`, and the card shows `border-accent` and `bg-accent-soft` while it is set (ux may
     pick another cue, as long as it differs from the focus ring). One highlight at a time.
6. **`web/src/features/search/SearchPage.tsx`**
   - Renders `SearchResults` in place of `ResultsList` in list view; at `xl` in list view the toolbar row (tags,
     sort, view toggle) and the profile nudge span the list and the side map. Below `xl`, and in map view at any
     width, the layout is today's.
   - `onOpenFullMap(position)` navigates (push) to the current filters with `view=map` and `c` / `z` from
     `writeMapPosition` (0009w), and then focus moves to the view toggle's pressed "map" button (the button that
     was used is gone; 0009t's rule), through a ref and flag like today's `focusListButton`.
7. **`web/src/features/search/ResultsList.tsx`**: each `<li>` takes optional `onPointerEnter` / `onPointerLeave` /
   `onFocus` / `onBlur` handlers and `data-highlighted` from new optional props, and the grid stays one column
   when the side map is shown (`xl:grid-cols-1` under that condition). No other change.
8. **`web/src/locales/he.json`** under `search.sideMap`: `label` `"מפת התוצאות שברשימה"`, `open` `"פתיחת המפה
   המלאה"`, `unavailable` `"המפה לא זמינה בדפדפן הזה."`.
9. **e2e at the default viewport.** Playwright's `Desktop Chrome` is 1280 × 720, exactly `xl`, and seeker signup
   lands on `/search` (`web/e2e/helpers.ts:54`), so the side map would mount across the suite
   (`likes.spec.ts:126`, `applications.spec.ts:209,263`, `landing.spec.ts:79`, `a11y.spec.ts:19,110`, …) and fetch
   public tiles from CI:
   - new `web/e2e/fixtures.ts` exports a `test` with an **auto fixture** that calls `routeTiles(page)` for every
     test, and every spec imports `test` from it instead of `@playwright/test` (mechanical; the coder greps
     `web/e2e` for every `/search` visit to be sure none fetches real tiles);
   - `a11y.spec.ts::ac5_public_pages_pass_axe` checks the `/search` list at 1024 × 800 (AC6 owns the side map's
     axe run);
   - `map.spec.ts::ac8`'s "a visitor on the list never downloads the library" step runs at 1024 × 800.
10. **`specs/FOLLOWUPS.md`**: lines 196 and 216 (0009i) ticked as closed by 0009x (decision 3: a map beside the
    list replaces a list beside the map).

**Out:**
- A map that drives the list ("search as I move" on the list): rejected by decision 3; the full map view is for
  searching by area.
- A side map below 1280 px, or on other pages (inbox, likes).
- Moving the full map view to a two-column layout (FOLLOWUPS 196/216 asked for it; decision 3 replaces it).
- Protomaps tiles (decision 5: they keep their place before launch; this spec raises OSM tile traffic, accepted
  while traffic is testers).

**New dependencies:** none.

## Data
None.

## API
No new endpoint and no `GET /listings` from the side map. Tiles come from `MAP_STYLE_URL` (public OSM). For a
seeker, the list view now also sends `GET /me/likes` and `GET /me/applications` once the side map mounts
(0009v's `useListingPins`), which the list view did not send before.

## UI
Screen: `/search` list view at `xl` and wider. Artboard: `design/screens-v1/SearchDesktop.dc.html` (three
columns: filters 280, list 440, map); the brand kit (`design/brand/`) wins for colour and type. Its "search as I
move" checkbox and "save search" stay out (`03-search-surface.md` section 8). At exactly 1280 px the map column
gets about 440–456 px (verifier), about 576 px at 1440.

RTL: columns in reading order (filters at the inline start, map at the inline end); the "open" row above the map
aligned to the inline start; zoom controls at the inline end as everywhere; `scrollIntoView` is direction-free.

States:
- **Before the first results (loading):** the column is empty; the list's skeleton.
- **Side map loading:** `MapCanvas`'s skeleton in the column, the "open" row above it.
- **Empty (`total === 0`):** before any mount, no side map (the list's empty state is the message); after a mount,
  the side map stays with no pins.
- **Error (list):** the list's `ErrorState`; the side map, if mounted, stays with no pins.
- **Map unavailable** (no WebGL, library failed): the column shows `EmptyState` with `search.sideMap.unavailable`;
  the list is unaffected.
- **Success:** pins and bubbles for the loaded cards; listings without a point have a card and no pin.

i18n keys added: `search.sideMap.label`, `search.sideMap.open`, `search.sideMap.unavailable`.

## Acceptance criteria
`SideMap.test.tsx` renders `SearchPage` with the fake `MapCanvas` and a `matchMedia` stub that matches both
`(min-width: 1024px)` and `(min-width: 1280px)`.
- [ ] AC1 Given the wide stub and a first page of 20 results, Then after idle a `MapCanvas` labelled
  `search.sideMap.label` renders with one pin per located listing, `keyboard: false`, and no `GET /listings` of its
  own; Given a narrow viewport, or the map view, Then it never renders; Given a first answer with `total: 0`, Then
  it does not mount — `web/src/features/search/__tests__/SideMap.test.tsx::ac1_mounts_only_wide_list_with_results`
- [ ] AC2 Given the side map mounted, When "load more" appends 20 listings, Then the side map has their pins and
  `cameras()` gained nothing; When a filter is applied, Then the side map stays mounted (same instance), shows no
  pins while the first page loads, and gains exactly one camera fitting the new results when it arrives; When the
  side map reports a move, Then the list's requests and URL do not change —
  `SideMap.test.tsx::ac2_mirror_fits_on_first_pages_not_on_more`
- [ ] AC3 When a card is hovered or receives focus, Then the side map's `selectedId` is that listing and its pin is
  kept out of any bubble; When the pointer leaves while another card holds focus, Then the highlight moves to that
  card, else clears; When a side-map pin is pressed, Then its card is scrolled into view (`scrollIntoView` called
  with `block: 'nearest'`), its `<li>` carries `data-highlighted`, and focus is not inside that card; When a
  never-separating bubble opens, Then its best member's card is scrolled to and highlighted; a hover does not
  re-render `FiltersForm` — `SideMap.test.tsx::ac3_hover_focus_and_press_sync`
- [ ] AC4 When "פתיחת המפה המלאה" is pressed after the side map reported centre (34.80, 32.08) at zoom 13.2, Then
  the URL is the same filters plus `view=map`, and `parseMapPosition` of it gives centre `[34.8, 32.08]` and zoom
  13.2, as a new history entry; focus is on the view toggle's "map" button —
  `SideMap.test.tsx::ac4_open_full_map_here`
- [ ] AC5 Given the side map's library fails, Then the column shows `search.sideMap.unavailable` and the list
  still renders and pages — `SideMap.test.tsx::ac5_unavailable_keeps_the_list`
- [ ] AC6 In the browser (tiles routed by the auto fixture): at 1024 × 800 a visitor on `/search` downloads no
  `maplibre` URL; at 1440 × 900 the first card is visible, then the side map region appears; hovering the test
  listing's card gives its pin (`[data-pin-id=<id>]`, kept apart from bubbles while highlighted) the selected
  chip; the side map's `.maplibregl-marker` elements are `aria-hidden`; tabbing through the whole page reaches
  the "open" button and never a side-map pin, bubble, zoom button or canvas; after `page.mouse.move(0, 0)` with no
  card focused, `expectNoAxeViolations` passes; pressing "open" lands on `?view=map` with `c`/`z` and focus on
  the toggle's map button — `web/e2e/map.spec.ts` (new test `ac6_side_map_mirrors_the_list`; the existing ac8
  visitor-list step moves to 1024 × 800)
- [ ] AC7 The e2e suite fetches no real OSM tile: every spec imports `test` from `web/e2e/fixtures.ts`, whose auto
  fixture routes `https://tile.openstreetmap.org/**`; `a11y.spec.ts` ac5 checks the list at 1024 × 800 —
  `web/e2e/fixtures.ts` and the CI e2e run
- [ ] AC8 `make screens` adds `/search` at 1440 with the side map, a highlighted card and pin next to a focused
  card, and the unavailable state; the existing 1440 list states wait for the side map region's
  `aria-busy="false"` before the shot — `web/e2e/screens/search.screens.ts` (states `side-map`,
  `side-map-highlight`, `side-map-unavailable`)
- [ ] NF1 Bundle: after `make build-web`, the entry script named in `web/dist/index.html` contains no
  `maplibregl-ctrl-attrib` (0003d NF2's check: the library stays in its lazy chunk), and `web/scripts/build-check.mjs`
  passes (the service worker still does not precache it); the perf reviewer writes the chunk size and the tile
  requests for one wide list view into the digest

## Tests to write
Unit: new `SideMap.test.tsx` (AC1–AC5); existing `SearchPage.test.tsx` keeps passing (jsdom has no `matchMedia`,
and its `stubDesktop` matches only `(min-width: 1024px)`, so no side map). E2E (CI only, never local — Gilad
2026-11-12): AC6, AC7. Screens: AC8. Build: NF1.

## Risks / open questions
- **The 0003d performance rule is relaxed on purpose** (the map chunk and tiles on every wide list view). Gilad
  accepted the tile cost while traffic is testers (decision 5); the perf reviewer checks the lazy mount and that
  phones and narrow windows never pay it.
- **OSM tile policy.** Every wide-desktop search now requests public OSM tiles. Before launch the Protomaps switch
  (PRODUCT.md "Search") must happen; this spec makes it more urgent and the orchestrator notes it in the Slice 13
  (launch) queue.
- **axe and `aria-hidden` pins.** If axe's target-size rule still inspects `aria-hidden`, untabbable markers and
  fails AC6, the coder messages the orchestrator with the node; never an exemption (0009v's rule).
- **The side map shows at most what the list loaded** (20 per page). A person who expects every listing in an area
  uses the full map; the "open" button is that path.
- **Shared files:** with 0009y (built in parallel): `MapCanvas.tsx`, `fakeMapCanvas.tsx`, `SearchPage.tsx`,
  `he.json`, and every e2e spec's import line (item 9); with the Slice 10 market specs: `SearchPage.tsx` and
  `ResultsList.tsx` (step 1 changes the main search). Whoever merges second merges `main` first. If the market's
  room search reuses `SearchPage`, it gets the side map for free.
- No open product question: decisions 3, 5 and 7 are Gilad's (2026-11-13).

## Digest (filled by orchestrator after verification)
Spec 0009x — A map beside the list on wide desktops   (verified 2026-11-13, one part)
What a user can do after this: at 1280 px and up, see the listed results on a map beside the list, with the pin of the card under the pointer highlighted, and open the full map at the same place.
Decisions I need from you: none (decisions 3, 5 and 7 are in).
KPIs this slice moves: closes the 0009i desktop pairing follow-ups.
Acceptance targets: the list never waits for the map; below 1280 px the map chunk is never downloaded; the entry bundle has no map code (NF1); the e2e suite fetches no real OSM tile (AC7).
Risks: OSM tiles on every wide-desktop search (accepted while traffic is testers; makes the Protomaps switch before launch more urgent).
Reviewers: code, qa, ux, perf   Estimated: 1 coder run, 1 review round
Links: specs/0009x-side-map.md · PRODUCT.md "Map" · design/screens-v1/SearchDesktop.dc.html

## Verifier findings
Checked against `main` 04c8356 plus the 0009v and 0009w drafts. The width works: at exactly 1280 px the wide
container leaves 1216 px (1199 px with a classic 17 px scrollbar; the media query counts the scrollbar). After
filters 288, list 440 and two 16 px gaps the map gets about 440 to 456 px, and about 576 px at 1440. The header
is not sticky (`Layout.tsx`), and no fixed bar exists at `lg` and up, so `top-4` is right. Under jsdom
`useMediaQuery` returns false, and `SearchPage.test.tsx`'s `stubDesktop` matches only `(min-width: 1024px)`,
so the existing unit tests keep the side map off. It fits one coder run. The spec stays `draft` until these are
applied.

1. **major — The mount rule and the fit rule contradict each other.** `useSearch` has no `placeholderData`. On a
   filter or sort change `search.data` becomes `undefined`, so Scope 5's condition ("the first page has
   answered with `total > 0`") unmounts the side map and remounts it after idle. That rebuilds the WebGL map and
   loses the position the "open" button uses. Scope 4's "camera whenever `filtersKey` changes" then never runs on
   a live map, and AC2's "one new `camera`" cannot be observed. **Fix:** the layout (list 27.5rem | map column)
   depends only on `useIsWide() && view !== 'map'`. The side map mounts the first time a first page answers with
   `total > 0` and stays mounted until the view or the width changes. While a new first page loads, it shows no
   pins. When a first page for a new `filtersKey` arrives with located pins, it sends one fit `camera` (a
   same-key refetch after logout or a profile save counts too). "Load more" never refits. On `total === 0` or an
   error after mounting, it stays with no pins. Before the first mount the column is empty. Rewrite States
   (Loading, Empty, Error) and AC1/AC2 to this rule.
2. **major — The first fit is sent before the map is ready.** The side map mounts with items already loaded, so
   its first `camera` exists at mount. 0009w defines `camera` as applied "whenever `seq` changes after the map is
   ready", which a coder can read as skipping a camera that was set before `load`. The side map would then open
   on Gush Dan, and the fake-canvas tests cannot catch it. **Fix:** add to Scope 2 (MapCanvas): "a `camera` whose
   `seq` has not been applied yet is applied once the map is ready (an effect on `[ready, camera?.seq]` with a
   last-applied-seq ref)". If 0009w lands without this, 0009x adds it.
3. **major — e2e: the default 1280×720 viewport now mounts the side map across the suite.** Playwright's
   `Desktop Chrome` is 1280×720, which is exactly `xl`. Every seeker `signUp` lands on `/search`
   (`helpers.ts:54`), and `likes.spec.ts:126`, `applications.spec.ts:209,263`, `landing.spec.ts:79` and
   `a11y.spec.ts:19,110` all open the list there. None of them routes tiles, so CI would fetch public
   `tile.openstreetmap.org` tiles in many tests (against `04-technical-notes.md`'s "avoid … third-party tiles"
   and against the OSM policy) and run SwiftShader WebGL in each. `a11y.spec.ts::ac5_public_pages_pass_axe`
   also becomes racy: on a shared database with listings, the side map mounts after idle, possibly after
   `settled()` returned, so axe can run on a half-built map. **Fix:** Scope 8 adds two changes. (a) Route the OSM
   tiles for every e2e test: an auto fixture in `web/e2e/fixtures.ts` that calls `routeTiles`, with each spec's
   `test` import switched to it (mechanical). The alternative is `routeTiles` in `signUp` plus every listed
   `goto('/search')`. (b) `a11y.spec.ts` ac5 checks the list at 1024 × 800, since AC6 owns the side map's axe
   run. Brief the coder to grep `web/e2e` for every `/search` visit.
4. **major — AC6's "the side map region appears with the test listing's pin" is flaky on the shared CI
   database.** `FakeGeocoder` scatters every e2e listing over the middle half of the same area box. On a 440 px
   map fitted to 20 pins, chips of about 84 px will often cluster, so the test listing can sit inside a bubble.
   **Fix:** AC6 hovers the test listing's card first. The highlighted pin is in `keepApart`, so it is always a
   single pin. Then assert the pin `[data-pin-id=<id>]` exists with `data-highlighted`. Call `routeTiles(page)`
   before the `goto`.
5. **major — axe at 1440 can fail on `target-size` overlaps that the spec creates.** (a) The highlighted pin is
   kept out of clustering and drawn on top, so while a card is hovered it can overlap a neighbour. The Playwright
   mouse also stays where it last clicked, which may be over a card. (b) The "open" button sits over the map at
   `top-3 start-3`. A pin at the fitted extent's top inline-start edge (48 px padding, 44 px hit rect, so it spans
   y 26–70) lies under the button (y 12–48), and 0009v's clustering ignores controls. **Fix:** AC6 runs
   `expectNoAxeViolations` after `page.mouse.move(0, 0)` with no card focused. Move the "open" button out of the
   canvas into a row above the map, inside the column. That ends the overlap and drops the reliance on 0009w's
   `panel` for this spec. If the button stays in the panel, the fit needs `padding: { top: 64 + button height }`,
   and the risk note must follow 0009v's rule: message the orchestrator, never exempt.
6. **major — Screen-reader users can activate the pins but get no result.** With `keyboard={false}` the pins and
   zoom buttons stay exposed as buttons with `tabindex="-1"`. A screen-reader user in browse mode finds 20 or
   more buttons that duplicate the cards next to them. Activating one scrolls a card and moves no focus, so
   nothing is announced. Decision 7 says the cards are the path, so the pins add noise and a dead end. **Fix:**
   with `keyboard={false}`, every marker element (pins and bubbles) and the `NavigationControl` container also
   get `aria-hidden="true"`. This is the static map's pattern, and axe's `aria-hidden-focus` passes it because
   nothing is tabbable. The region then exposes the "open" button and the OSM attribution link only. AC6 asserts
   `aria-hidden` on `.maplibregl-marker`, and the fake renders `aria-hidden` when `keyboard` is false. Rewrite
   Scope 2's "holds only its pins for a screen reader user" sentence to match.
7. **major — The card highlight looks exactly like the focus indicator.** `Card`'s focus style is `outline-2
   outline-offset-2 outline-accent` (`Card.tsx:34`). Scope 5's `ring-2 ring-accent ring-offset-2` draws the same
   pixels, so a hovered card looks focused and a keyboard user sees two "focused" cards. **Fix:** a cue that is
   not an outline. For example, `[data-highlighted]` on the `<li>` sets the card's border to `border-accent`
   (one `group`/child selector) and the background to `bg-accent-soft`, or the ux reviewer picks one, as long as
   it differs from the focus ring. AC7's `side-map-highlight` screen shows it next to a focused card.
8. **major — The pin highlight cannot be seen on high-tier pins.** In 0009v a `high` chip already has
   `border-accent`, so "a 2 px `border-accent` ring on its tier colours" changes a high chip by 0.5 px. Those are
   the pins that matter most. **Fix:** the side map has no selection, so pass `selectedId={highlightedId}` and
   reuse the accent-filled selected chip. This drops the new `highlightedId` prop. `aria-pressed` does not matter
   once markers are `aria-hidden` (item 6), and 0009w's card-pan needs a `data-map-card`, which the side map does
   not have. If ux wants it distinct from "selected", use `ring-2 ring-accent-strong ring-offset-2` plus a
   scale. Either way, name the classes.
9. **major — Focus after "open the full map" is undefined.** The button is removed when the view switches, so
   focus falls to `<body>`. This breaks 0009t's rule that an action which removes its own control moves focus
   (`SearchPage.tsx:53-55`). The side map's tab stop leads keyboard users here. **Fix:** after the navigation,
   focus moves to the view toggle's pressed "map" button, through a ref and flag like `focusListButton`. Add it
   to AC4 (`toHaveFocus`) and to AC6.
10. **major — A bubble on the side map that can never separate has no behaviour.** Scope 2's third bullet keeps
    0009v's rule (`onBubbleOpen` for members that never separate). In 0009v that shows a same-place list under
    the full map, but SideMap's props have no `onBubbleOpen`, and the coder would have to guess (checklist 9).
    **Fix:** SideMap passes `onBubbleOpen={(ids) => onPinPress(ids[0])}`, which scrolls to and highlights the
    first member's card (members are sorted by `z`, so the best one comes first). Add a case to AC3.
11. **minor — AC3's "focus has not moved" fails under a real click.** A click focuses a `tabindex="-1"` button
    in Chrome, and in jsdom with `userEvent.click`. **Fix:** assert "focus is not inside the card". Or, if
    mouse-down focus on pins is unwanted, MapCanvas calls `preventDefault` on `mousedown` for pins when
    `keyboard` is false; say which.
12. **minor — "the side map's one tab stop"** (Scope 4) is wrong. The OSM attribution link
    (`osm-raster.json`) is a second tab stop, and it must stay. **Fix:** say "the 'open' button and the
    attribution link". AC6's never-reached list already leaves the link out.
13. **minor — Perf: each hover re-renders the whole page.** `highlightedId` in `SearchPage` re-renders
    `FiltersForm`, every `ListingCard`, and SideMap per `pointerenter`. `flattenPages(search.data)` builds a new
    array each render, so `useListingPins`, `clusterPins` and MapCanvas's marker effect all run again per hover.
    **Fix:** memoise the items on `search.data`, and hold `highlightedId` in a small list-plus-side-map wrapper
    below `SearchPage` (or memoise the rows).
14. **minor — "No new request" is not true for seekers.** `useListingPins` (0009v) sends `GET /me/likes` and
    `GET /me/applications` for a seeker, and the list view sends neither today. **Fix:** say so in API and in the
    reviewers comment. AC1's "no `GET /listings` of its own" stays.
15. **minor — AC4 pins a number format that 0009w leaves open.** `c=32.08,34.8` assumes `writeMapPosition`
    writes `String(Math.round(x * 1e4) / 1e4)`, not `toFixed(4)`. **Fix:** compare through `parseMapPosition`,
    or fix the format in 0009w's AC1.
16. **minor — NF1 names a check that does not exist.** `build-check.mjs` checks only that the service worker
    does not precache `maplibre-gl`; it does not check chunk separation. **Fix:** reuse 0003d NF2's check: the
    entry script in `dist/index.html` contains no `maplibregl-ctrl-attrib`.
17. **minor — Ticking FOLLOWUPS is not in Scope.** The spec closes `specs/FOLLOWUPS.md` lines 196 and 216, but no
    Scope item ticks them. **Fix:** add a Scope item, as 0009v item 10 does.
18. **minor — AC1–AC5 wording.** AC1 says "a second `MapCanvas`", but in list view the side map is the only
    one. These ACs render `SearchPage` (mount rule, hover sync), not `SideMap` alone. **Fix:** say "a
    `MapCanvas`", and note that `SideMap.test.tsx` renders `SearchPage` with the fake canvas and a matchMedia
    stub that matches both 1024 and 1280.
19. **minor — Highlight clearing is unspecified.** When a pin press sets the highlight, nothing says what
    clears it. When the pointer leaves a card while focus is in another card, the highlight is lost. **Fix:**
    "the pointer wins while over a card; on `pointerleave` the highlight falls back to the card holding focus,
    else clears; a pin-press highlight lasts until the next card pointer or focus event".
20. **minor — Existing 1440 screens become timing-dependent.** The 1440 list states in `search.screens.ts` will
    now show the side map, sometimes still as a skeleton. **Fix:** those states wait for the side map region's
    `aria-busy="false"` before the shot.

**Applied by the orchestrator (2026-11-13):** all 20 findings, in Scope 1–10, API, UI, States, AC1–AC8, NF1 and Risks. Finding 5 took the "open" button out of the map (a row above it); finding 8 reuses the selected chip for the highlight (no new prop). No question for Gilad.
