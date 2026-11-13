---
id: 0009v
title: On the search map a seeker sees their best matches on top and coloured by fit, the rooms they liked, the listings they applied to and the ones they already opened, and pins that would overlap fold into count bubbles that zoom in when pressed
status: done
depends_on: []   # web only, on main at 04c8356 (0009t's map landmark, pill and focus rules are merged)
reviewers: [code, qa, ux]   # ux: chip tiers, marks, bubbles, copy; qa: the cluster maths, the joins, the a11y check without its exemption. No security: listing ids in this browser's own storage, no new endpoint. No perf: at most 50 pins, O(n × bubbles) in the browser, no query change
estimate: 1 coder run   # upper end, ~3.5–4 h (verifier). Coder Opus/medium. If a split is ever needed: clusters (Scope 1–3, 7, 9) vs tiers, marks and seen (Scope 4–6)
---

## Goal
After this ships, on `/search?view=map`:
- the best match is drawn on top of worse ones (today the lowest score paints over the best);
- each chip's colour says the match tier (high 80+, good 60–79, partial below 60); only a high match shows its
  score on the chip, the others show the price alone (Gilad, 2026-11-13, decision 1);
- a seeker sees a heart on rooms they liked, a check on listings they applied to (applied wins), and a lighter
  chip on listings they already opened on this device ("seen", Gilad decision 2);
- pins whose hit areas would overlap fold into one round count bubble; pressing it zooms in until they separate,
  and where they can never separate (two points metres apart) it lists their cards under the map instead;
- because drawn pins no longer overlap, the pins leave 0009t's WCAG 2.5.8 "essential" exemption.

Serves the map improvements job (Slice 9c, `specs/map-research/`: README decisions 1 and 2, `02-pins.md`
sections 1–4). Closes `specs/FOLLOWUPS.md` line 218 (0009t clustering) and the display half of line 186 (0008c
heart on map pins). Gilad decided the scope and the two product calls on 2026-11-13 (PRODUCT.md row "Map").

## Scope
**In:**

1. **`web/src/components/map/MapCanvas.tsx`** (the only module that loads `maplibre-gl`; keep it a thin renderer)
   - `Pin` gains `tier: PinTier` (`'high' | 'good' | 'partial' | 'none'`, exported from this file), `mark:
     'applied' | 'liked' | null`, `seen: boolean` and `z: number` (stacking order, higher on top, at least 1).
   - New exported type `Bubble = { id: string; lng: number; lat: number; count: number; tier: PinTier; z:
     number; label: string; members: Pin[]; separates: boolean }` (`separates`: the members part at
     `MAP_MAX_ZOOM`, computed once by `clusterPins`, item 3, and read by the label, the real press and the fake). New props `bubbles?: Bubble[]` and `onBubbleOpen?: (ids: string[])
     => void`. The existing `pins` prop stays the single pins (no rename, so existing tests keep reading
     `lastProps().pins`).
   - `onMoveEnd` becomes `(bbox: Bbox, view?: { center: [lng: number, lat: number]; zoom: number }) => void`
     (`map.getCenter()`, `map.getZoom()`), reported at the same moments as today (on `load` and every
     `moveend`). The real `MapCanvas` always passes `view`; it is optional only so the fake can omit it and the
     existing tests stay unclustered (verifier finding 1). 0009w uses `center`; this spec uses `zoom`.
   - Markers stay diffed by id; bubbles are markers too, keyed by their `id`, in the same diff (a pin and a
     bubble never share an id: bubble ids start with `cluster:`).
   - Marker stacking: `marker.getElement().style.zIndex` = the pin's or bubble's `z`; the selected pin gets the
     largest `z` in the current set plus 1 (today: `'1'` or `''`).
   - Chip classes per tier (existing tokens only; the selected chip is unchanged and stays the one
     accent-filled element on the map):

     | Tier | Background | Border | Text |
     | --- | --- | --- | --- |
     | `high` | `bg-accent-soft` | `border-accent` | `text-accent-strong`, bold |
     | `good` and `none` | `bg-surface` | `border-border-strong` | `text-ink`, bold (today's chip) |
     | `partial` | `bg-surface-subtle` | `border-border` | `text-ink-muted`, medium |
     | selected (any tier) | `bg-accent` | `border-on-ink` | `text-on-ink`, bold (today's) |

     `seen` changes weight and depth only, never colour: `font-normal` instead of bold/medium, and no
     `shadow-pin`. A `mark` adds one inline outline SVG before the price (14 px, `stroke="currentColor"`,
     1.75 px stroke, `aria-hidden`): a heart for `liked`, a check for `applied`. Brand rule: outline icons only.
     The coder checks contrast with a tool for `text-accent-strong` on `bg-accent-soft` and `text-ink-muted` on
     `bg-surface-subtle` at 13 px (research estimated 5.9:1 and 5.5:1; both must be ≥ 4.5:1) and writes the
     numbers in the PR body; if one fails, the coder uses the next darker text token and says so.
   - Bubble element: a `<button>` (same `pinButton` hit area, ≥ 44 × 44 px) holding a round chip (`h-11 min-w-11
     rounded-full px-2`, centred digits, 13 px bold) with the bubble's tier colours (as the table, `none`
     like `good`) and `shadow-pin`; `aria-label` = `bubble.label`; it has no `aria-pressed`.
   - Pressing a bubble: if `bubble.separates` is true, the map zooms in on the members by **at least one level per
     press**, so a bubble can never get stuck (members may span ~300 px, wider than a phone's fit area): take
     `{ center, zoom: fitZoom }` from `map.cameraForBounds(members' bounds, { padding: 64 })`, then `easeTo({
     center, zoom: Math.min(MAP_MAX_ZOOM, Math.max(fitZoom, map.getZoom() + 1)) })` (MapLibre skips the animation
     under `prefers-reduced-motion`, so `essential` is not set); repeated presses end at `MAP_MAX_ZOOM`, where the
     members part by construction. Otherwise it calls `onBubbleOpen(member ids)` and the camera does not move.
   - **Focus after a bubble zoom** (0009t's rule: focus lands on what replaced the control): when the focused
     element was a bubble that the next marker diff removes, focus moves to the marker whose `data-pin-id` is the
     old anchor's id, or `cluster:` + that id, whichever exists; if neither exists, to the map canvas.
   - Every pin and bubble button gets `data-pin-id` (the pin's id; for a bubble, its `id`), so tests and later
     specs find a marker by id without reading classes.
2. **`web/src/components/map/__tests__/fakeMapCanvas.tsx`** learns every new prop: it renders each bubble as a
   button (its `label`, text = `count`) whose click reads the same flag as the real one (`separates` → records
   `lastZoomedTo()` = the members' ids; else `onBubbleOpen(ids)`); pins render `data-tier`, `data-mark`,
   `data-seen` and `data-pin-id`; `moveTo(bbox, view?)` passes `view` only when given, so the existing
   `moveTo(bbox)` callers report no view and their pins stay unclustered.
3. **`web/src/components/map/cluster.ts`** (new, pure, no React, no `maplibre-gl`; tests next to it):
   - `project(lng, lat, zoom): [x, y]` — Web Mercator world pixels with MapLibre's 512 px tiles:
     `W = 512 × 2^zoom`, `x = (lng + 180) / 360 × W`,
     `y = (1 − ln(tan(lat·π/180) + 1/cos(lat·π/180)) / π) / 2 × W`.
   - `hitRect(pin)`: the marker's hit area centred on its point: height 44, width
     `max(44, chipWidth(pin))` with `chipWidth = 28 + 8 × pin.text.length + (pin.mark !== null ? 20 : 0)` — a
     deliberately generous estimate of the 13 px chip plus its padding, border and icon (84 px for "7,200 ₪"
     against the 74 px measured). A bubble's rect is 44 × 44 at the same centre, so it always fits inside its
     anchor pin's rect.
   - "Intersects" means two rects overlap with positive area **after growing each by 1 px on every side**
     (MapLibre rounds marker positions to whole pixels, so rects under 1 px apart can touch on screen).
   - `clusterPins(pins, zoom, keepApart: ReadonlySet<string>): { pins: Pin[]; bubbles: Omit<Bubble, 'label'>[]
     }`. Deterministic greedy grouping: pins in `keepApart` (the selected pin; 0009x adds the highlighted one)
     are always returned as single pins and take no part in grouping. The rest are visited by `z` descending
     (ties by id): a pin whose rect intersects the rect of an existing anchor joins the first such anchor;
     otherwise it becomes a new anchor. An anchor with one member is returned as a pin; with two or more, as a
     bubble at the **anchor's** point (the best-ranked member, a true listing position, not a centroid), `id =
     'cluster:' + anchor.id`, `count`, `members` (by `z` descending), `z` = the anchor's `z`, `tier` = the best
     member tier (`high` > `good` > `partial` > `none`), and `separates = separatesAt(members, MAP_MAX_ZOOM)`.
   - **Invariant (tested):** at the given zoom, the hit rects (grown by 1 px) of all returned items except the
     `keepApart` pins are pairwise disjoint. This is what lets the pins leave the axe exemption.
   - `separatesAt(members, zoom)`: `clusterPins(members, zoom, ∅)` returns more than one item.
4. **`web/src/features/search/pins.ts`** (new, pure): `toPins(items, ctx): Pin[]` with `ctx = { t, seen,
   liked, applied }` (three `ReadonlySet<string>` of listing ids). It moves today's pin building out of
   `SearchMap` and adds:
   - items without `lat` / `lng` are skipped (as today);
   - `tier` = `bucket(match.score)` (`features/match/bucket.ts`), `none` when `match === null`;
   - `text`: `` `${price} ${t('listings.units.ils')}` `` for every tier except `high`, which keeps
     `t('search.map.pinTextMatch', { price, score })`;
   - `label`: today's `search.map.pin` + `search.map.pinMatch` (whenever `match` is set, every tier) + one of
     `search.map.pinApplied` / `search.map.pinLiked` + `search.map.pinSeen` (each only when it applies);
   - `mark`: `applied` if the id is in `applied`, else `liked` if in `liked`, else `null`; `seen` from `seen`;
   - `z`: rank by score descending (no match ranks below every score), ties in the API's order; the best gets
     the highest `z`, the worst `1`.
   - `bubbleLabel(t, bubble)`: `search.map.bubble` (plural) when `bubble.separates`, else
     `search.map.bubbleSamePlace` (plural).
5. **`web/src/features/search/useListingPins.ts`** (new): `useListingPins(items): Pin[]` — the joins, in one hook
   so 0009x's side map reuses them:
   - `const isSeeker = useMe().data?.role === 'seeker'`;
   - liked = `useMyLikes(isSeeker)` → `data.mine[].listing.id` (rooms only can be liked);
   - applied = `useMyApplications(isSeeker)` → `listing.id` of applications whose `status` is `submitted` or
     `shortlisted` (a declined or withdrawn one gets no check);
   - seen = `readSeen()` (item 6), read once per render of the pins memo;
   - a visitor or an owner sends neither request; an error in either is ignored (pins without that mark; the
     hooks' own 401 handling stays).
   - `useMyLikes` gains `enabled = true` as its parameter, the same shape as `useMyApplications(enabled)`; its
     existing callers pass nothing and behave as today.
6. **`web/src/features/listings/seen.ts`** (new): listings opened on this device. `localStorage` key
   `rent-app:seen`, a JSON array of listing ids, newest last, at most 300 (the oldest dropped); `markSeen` on an
   id already stored removes the old copy and appends it, so there are no duplicates and the cap drops the least
   recently opened. `markSeen(id)`,
   `readSeen(): Set<string>`, `clearSeen()`. Every storage call is guarded as in `app/drafts.ts` (a throwing or
   missing storage, or a malformed value, reads as empty and writes nothing). Ids only; no titles or times.
   - Written by `ListingPage` in an effect when its listing query succeeds (`markSeen(id)`), so "seen" means
     the listing page was opened, not that a pin was pressed.
   - Cleared by an explicit logout only: `useLogout`'s `onSuccess` calls `clearSeen()` next to
     `clearAllDrafts()`. `clearSession` (login, 401) does not clear it: the person on the device has not
     changed. (Gilad decision 2: per device, cleared on logout.)
7. **`web/src/features/search/SearchMap.tsx`**
   - Pins come from `useListingPins(data?.items ?? [])`; the zoom from the last `onMoveEnd` view; until a zoom
     is known (fake canvas tests that never report one), pins are drawn unclustered.
   - `clusterPins(pins, zoom, new Set(selected ? [selected.id] : []))`, memoised on pins, zoom and selection
     (regrouping happens on zoom or data change, never per pan frame: `moveend` is the only zoom source);
     bubble labels via `bubbleLabel`.
   - `onBubbleOpen(ids)` → the card area under the map (today's `max-w-md` box) shows those listings' cards in
     a `<section aria-labelledby>` with an `<h2>` `search.map.samePlace` (plural) and one `ListingCard` per
     member (as today's selected card: badge, chips, `seekerBirthYear`), and focus moves to the first card's link
     (the 0009t pin rule). Pressing any pin, pressing another bubble, or the members leaving the results
     replaces or removes the list. Opening the list clears the selected pin (no pin stays `aria-pressed` without
     its card). A single pin press is unchanged (one card, focus to its link).
8. **`web/src/locales/he.json`** under `search.map` (texts are proposals inside the brand voice: no gender, no
   slash forms; ux may reword, keys are fixed):
   - `pinLiked`: `", בחדרים שאהבתי"`
   - `pinApplied`: `", כבר הגשת מועמדות"`
   - `pinSeen`: `", כבר נפתחה"`
   - `bubble_one` / `bubble_two` / `bubble_other`: `"מודעה אחת קרובה, לחיצה מגדילה את המפה"` /
     `"2 מודעות קרובות, לחיצה מגדילה את המפה"` / `"{{count}} מודעות קרובות, לחיצה מגדילה את המפה"`
   - `bubbleSamePlace_one` / `_two` / `_other`: `"מודעה אחת באותה נקודה, לחיצה מציגה אותה"` /
     `"2 מודעות באותה נקודה, לחיצה מציגה אותן"` / `"{{count}} מודעות באותה נקודה, לחיצה מציגה אותן"`
   - `samePlace_one` / `_two` / `_other`: `"מודעה אחת בנקודה הזאת"` / `"2 מודעות בנקודה הזאת"` /
     `"{{count}} מודעות בנקודה הזאת"`
9. **The a11y exemption ends.** `web/e2e/a11y.ts` loses the `markerTargetSizeExempt` option and the
   `.maplibregl-marker` exclusion; its two callers (`web/e2e/a11y.spec.ts:32`, `web/e2e/map.spec.ts:107`) call
   `expectNoAxeViolations` without it, and their "essential" comments go. PRODUCT.md's 0009t map-pins sentence is
   superseded by the "Map" row (written by the orchestrator with this spec).
   **The map e2e on CI's shared database** (verifier finding 2): at the first view every e2e listing sits in the
   middle of Gush Dan, so the test listing would almost surely be inside a bubble. `map.spec.ts::ac8` therefore
   posts **two** listings at one unique price `P` (`7001 + random 0..898`), opens
   `/search?view=map&price_min=P&price_max=P` so only they are on the map, presses zoom-out until it is disabled
   (`MAP_MIN_ZOOM`: the two points then lie within ~40 px and make one bubble of 2), presses the bubble with
   Enter, and asserts zoom-out is enabled again, both streets' pins are visible by name, and a `[data-pin-id]`
   button has focus. Only then the axe step and the existing pin → card → listing page flow run. (A ~0.4 % chance
   the two points never fold at z8 is accepted.)
10. **`specs/FOLLOWUPS.md`**: line 218 (0009t clustering) and the display half of line 186 (0008c) ticked as
    closed by 0009v; liking from the map itself stays out, as 0008c decided.

**Out:**
- The card's position (inside the map), the position in the URL and fitting the first view to the results:
  0009w. The side map: 0009x. Locate me, place search, empty-view action, listing page circle: 0009y.
- Liking from a pin or a card in search (0008c's Out stands). "Seen" per account (Gilad: not planned).
- More than 50 pins / a slim pins response, dots at low zoom, a room glyph on the chip (`02-pins.md`: later or
  dropped). The "מוצגות 50 מתוך N" line stays; bubbles count only what the response holds.
- Marking list cards as seen (the store makes it free later; not asked for now).

**New dependencies:** none (MapLibre's own GeoJSON clustering is deliberately not used: it runs in the map's
worker, is invisible to the unit tests that fake `MapCanvas`, and would need a `glyphs` font endpoint the
raster style lacks; `02-pins.md` section 4).

## Data
None. One new browser storage key, `rent-app:seen` (listing ids, this device only, cleared on logout).

## API
None. Uses `GET /listings` (unchanged), `GET /me/likes` and `GET /me/applications` (existing, seeker-only, auth
as today).

## UI
Screen: `/search?view=map` (and every other `MapCanvas` user keeps working: the listing page passes no pins).
No artboard covers tiers or bubbles; the design is the table in Scope 1, from `design/brand/` tokens and
`02-pins.md`. RTL: the mark icon sits at the chip's inline start (before the price in reading order, flex with
`gap-1`); bubbles hold digits only; no new physical positioning.

States (the 0009t states above the map are unchanged):
- **Loading:** the map skeleton, then the "updating" pill while a box loads; pins and bubbles of the previous box
  stay (`keepPreviousData`).
- **Empty:** the count line's empty text; no pins, no bubbles.
- **Error:** the `ErrorState` above the map; likes or applications failing only removes the marks.
- **Success:** pins and bubbles; a bubble press zooms or, for members that never separate, shows the
  same-place list under the map.

i18n keys added: `search.map.pinLiked`, `pinApplied`, `pinSeen`, `bubble_one|_two|_other`,
`bubbleSamePlace_one|_two|_other`, `samePlace_one|_two|_other`. `make i18n-check` passes.

## Acceptance criteria
- [ ] AC1 Given 4 located listings with scores 92, 81, 64, 40 and one with `match: null` in API order 40, 92,
  null, 64, 81, When the pins are built, Then `z` ranks 92 > 81 > 64 > 40 > null (null lowest), tiers are high,
  high, good, partial, none, only the two high chips show the score in `text`, and every label with a match
  speaks the score — `web/src/features/search/__tests__/pins.test.ts::ac1_tiers_text_and_z`
- [ ] AC2 Given a seeker who liked room R, applied to A (`submitted`) and S (`shortlisted`), was declined on D,
  withdrew from W, liked and applied to X, and opened A and Q on this device, Then R is `liked`, A, S and X are
  `applied` (applied wins), D and W have no mark, A and Q are `seen`, and each label carries its words in the
  order match → mark → seen — `pins.test.ts::ac2_marks_and_seen`
- [ ] AC3 Given two pins whose points are 10 px apart at zoom 14, Then `clusterPins` returns one bubble at the
  higher-`z` pin's point with `count: 2`; Given them 200 px apart, two pins; Given two rects 0.5 px apart, one
  bubble (the 1 px growth); Given the selected pin inside a group, Then it is returned as a single pin and the
  others group without it; a bubble's `separates` is true for members 300 m apart and false for 5 m apart —
  `web/src/components/map/__tests__/cluster.test.ts::ac3_groups_by_hit_area`
- [ ] AC4 Given 200 pins from a seeded pseudo-random generator inside `GUSH_DAN_BOUNDS` with mixed texts and
  marks, at zooms 9, 12, 14 and 17, Then the returned items' hit rects grown by 1 px (excluding `keepApart`)
  are pairwise disjoint, every input pin appears exactly once (as a pin or a bubble member), and a bubble's tier is its best
  member's — `cluster.test.ts::ac4_no_overlap_invariant`
- [ ] AC5 `project` matches known values (lng 0 / lat 0 → centre of the world; lng 180 → `x = W`; Tel Aviv at
  zoom 0 within 0.01 px of a hand-computed value), and `separatesAt` is false for two points 5 m apart at
  `MAP_MAX_ZOOM` and true for points 300 m apart — `cluster.test.ts::ac5_projection_and_separation`
- [ ] AC6 Given the fake map reporting zoom 8 with three located results, Then `lastProps()` holds one bubble with
  count 3 and its spoken plural label; When it is pressed and its members separate at max zoom, Then the fake
  records a zoom to those ids and no card opens; Given three results at one point (separating never), When the
  bubble is pressed, Then the same-place heading with the plural count and three cards render under the map, the
  first card's link has focus, and no pin is `aria-pressed`; Given the fake reporting no view (`moveTo(bbox)`),
  Then pins are unclustered and no bubble is drawn — `web/src/features/search/__tests__/SearchMap.test.tsx::ac6_bubbles_zoom_or_list`
- [ ] AC7 Given a signed-in seeker with one liked room and one submitted application among the results, Then the
  map sends `GET /me/likes` and `GET /me/applications` once each and the two pins carry `data-mark` `liked` and
  `applied`; Given a visitor and an owner, Then neither request is sent and no pin has a mark; Given
  `GET /me/likes` failing with 500, Then the pins render without the liked mark —
  `SearchMap.test.tsx::ac7_seeker_marks_only`
- [ ] AC8 Given a visitor opens `/listings/L1` successfully, Then `readSeen()` holds `L1`; a 404 listing is not
  stored; 301 ids keep the newest 300; re-opening a stored id moves it to the end without a duplicate; a
  throwing `localStorage` leaves the page working (each of these test files clears `localStorage` in
  `afterEach`) —
  `web/src/features/listings/__tests__/seen.test.ts::ac8_seen_store` and
  `web/src/features/listings/__tests__/ListingPage.test.tsx::ac8_opening_marks_seen`
- [ ] AC9 Given seen ids stored, When the person logs out, Then `readSeen()` is empty; When instead a seeker call
  answers 401 (`clearSession`), Then the seen ids remain —
  `web/src/features/listings/__tests__/logout.test.tsx::ac9_logout_clears_seen_not_401`
- [ ] AC10 In the browser, with the axe exemption removed: `/search?view=map` passes `expectNoAxeViolations`
  with no exclusion, in `a11y.spec.ts` and in `map.spec.ts`; and with the two listings at the unique price
  (Scope 9), zooming out to the minimum shows one bubble whose name matches `search.map.bubble`; pressing it with
  Enter re-enables zoom-out, shows both streets' pins by name and leaves focus on a `[data-pin-id]` button —
  `web/e2e/map.spec.ts::ac8_visitor_finds_a_listing_on_the_map` (steps `ac10_no_marker_exemption`,
  `ac10_bubble_zooms_in`) and `web/e2e/a11y.spec.ts` (existing test, exemption removed)
- [ ] AC11 `make screens` adds the map at 390 and 1440 px with the three tiers, a liked and an applied mark, a
  seen chip, a bubble and the same-place list, written to `screens/0009v/`; the ux reviewer checks them. Fixtures
  (verifier finding 5): the existing `map` state (`search.screens.ts:256-263`, which presses a pin that now folds
  with a neighbour) zooms in with the zoom-in button until the pins separate, or its fixture coordinates are
  spread; the seeker states mock `/me/likes` (`mine: [{ listing: <listing 2> }]`, `liked_me: []`) and
  `/me/applications` (one `submitted` on listing 3); `rent-app:seen` is written with `page.addInitScript`; two
  listings share one point for `map-same-place` and one tight pair makes `map-bubble` —
  `web/e2e/screens/search.screens.ts` (states `map` fixed, new `map-tiers`, `map-bubble`, `map-same-place`)

## Tests to write
Unit (vitest): `cluster.test.ts` (AC3–AC5), `pins.test.ts` (AC1, AC2), `seen.test.ts` (AC8), additions to
`SearchMap.test.tsx` (AC6, AC7; existing tests keep passing with `pins` unclustered when no zoom is reported),
`ListingPage.test.tsx` (AC8), `logout.test.tsx` (AC9), and `useMyLikes` with `enabled: false` sending nothing
(in AC7). E2E (CI only, never local — Gilad 2026-11-12): the `map.spec.ts` steps and the `a11y.spec.ts` change
(AC10). Screens: AC11 (`make screens` runs locally).

## Risks / open questions
- **The chip-width estimate.** Clustering is computed from text length, not measured DOM boxes. The estimate is
  generous on purpose (it over-clusters slightly rather than letting chips touch). AC10's axe run is the real
  check; if it flags a marker, widen the constant, do not restore the exemption.
- **Markers under the map's own controls.** Axe may flag a pin that sits under the zoom buttons or the
  attribution (both are MapLibre controls, outside the clustering). If AC10 fails only for that reason, the
  coder messages the orchestrator with the axe node before changing anything (the fix is a design call: e.g.
  map padding for controls), and keeps every other part of the spec going.
- **The selected pin may overlap a neighbour** (it is kept apart and drawn on top). The e2e axe runs before any
  pin is pressed. Accepted: one deliberate overlap of the pin the person is looking at.
- **Liked marks after the market move.** Only rooms can be liked; when Slice 10 step 1 moves rooms out of
  `/search`, liked marks appear only if the market's room search reuses `SearchMap` / `useListingPins`. The code
  is type-agnostic so that reuse is free; nothing here blocks the market.
- **Shared files with the Slice 10 market specs:** `ListingPage.tsx` (one effect), `useLogout.ts` (one line),
  `he.json`. Whoever merges second merges `main` first (rule 3).
- No open product question: decisions 1 and 2 are Gilad's (2026-11-13); the mark precedence, the "seen" trigger
  (listing page opened) and the 300-id cap are the research's recommendations, accepted with the scope.

## Digest (filled by orchestrator after verification)
Spec 0009v — Map pins that say more   (verified 2026-11-13, one part)
What a user can do after this: on the search map, see the best matches on top and coloured by fit (score on the chip only at 80+), hearts on liked rooms, checks on applications, lighter chips on listings already opened on this device, and count bubbles instead of overlapping pins.
Decisions I need from you: none (decisions 1 and 2 of 2026-11-13 are in; "seen" is written when the listing page opens, cleared on logout only).
KPIs this slice moves: readable pins on first open (today 23 of 38 chips at least half hidden on desktop).
Acceptance targets: no axe exemption for map pins (AC10); the cluster invariant proved over 200 random pins at four zooms (AC4).
Risks: the chip-width estimate (axe is the check; widen, never exempt); pins under the map's own controls (coder asks the orchestrator).
Reviewers: code, qa, ux   Estimated: 1 coder run (upper end), 1 review round
Links: specs/0009v-map-pins.md · PRODUCT.md "Map" · specs/map-research/02-pins.md

## Verifier findings
Checked 2026-11-13 against `main` 04c8356. Paths, props, hooks, test files and tokens all exist as named (`accent-soft`
#E8F0FE, `accent-strong` #1D4ED8, `border-strong`, `surface-subtle`, `ink-muted`, `on-ink`, `shadow-pin`). Contrast
computed from the token values: `accent-strong` on `accent-soft` 5.85:1, `ink-muted` on `surface-subtle` 5.51:1 (both
pass). The clustering invariant holds as written: a new anchor is created only when its rect misses every earlier
anchor's rect, so anchor rects are pairwise disjoint, and every returned item's rect is its anchor's rect or (a bubble)
a 44 × 44 rect inside it. The chip-width estimate is sane: 84 px for "7,200 ₪" against the 74 px measured, about 132 px
for "7,200 ₪ · 87%" against about 111 px estimated from the glyphs.

1. **blocker. The fake's default zoom clusters every existing `SearchMap` test.** Scope 2 has `moveTo(bbox)` report zoom
   `13` by default, but every existing test calls `moveTo(BOX)` and every `located()` fixture sits at the same point
   (`SearchMap.test.tsx:87-88`, `lat: 32.08, lng: 34.8`). So `ac3_map_searches_the_visible_box`, `ac5_pin_opens_the_listing_card`,
   `ac6_pins_show_match` and `ac4_room_pin_label` would get one bubble instead of 2 pins. That contradicts "existing tests
   keep passing with `pins` unclustered when no zoom is reported". **Fix:** type the second argument as optional,
   `onMoveEnd?: (bbox: Bbox, view?: { center; zoom }) => void`. The real `MapCanvas` always passes it. The fake's
   `moveTo(bbox)` without a `view` calls `onMoveEnd(bbox)` alone, and `moveTo(bbox, view)` passes it through. `SearchMap`
   draws unclustered while no `view` has arrived. Remove "default: the box's centre and zoom `13`" from Scope 2.
2. **blocker. The map e2e cannot find its pin on CI's shared database.** At the first view (Gush Dan fitted, about z10 at
   1280 × 720) the fake geocoder puts every e2e listing in the middle half of the box, which is about 175 × 216 px. With
   up to 50 listings there, the test listing is almost surely inside a bubble. Then today's `map.spec.ts:88`
   (`getByRole('button', { name: street })`) and `:113` (`pin.press('Enter')`) fail. AC10's "zoom out to the minimum,
   press the bubble" fits to all of that bubble's members, which is roughly the first view again, so it does not help.
   **Fix:** write the e2e plan into Scope 9 / AC10:
   - Post both listings with one unique price `P` (e.g. `7001 + random(0..898)`) and open
     `/search?view=map&price_min=P&price_max=P`, so only the test's listings are on the map.
   - Click zoom-out until it is disabled (`MAP_MIN_ZOOM`). At z8 the two points lie within about 38 × 47 px, so they make
     one bubble of count 2 whose name matches `search.map.bubble` (about 0.4% residual chance they do not; accepted, or
     retry the posting).
   - Press the bubble with Enter. Assert that zoom-out is enabled again (the observable "higher zoom") and that both
     streets' pins are visible by name.
   - Only then run the axe step and the existing pin → card → listing page flow.
3. **major. A bubble can get stuck.** `fitBounds(members, padding 64)` does not always zoom in far enough. A member joins
   its anchor whenever the rects meet, so members can span up to about 300 px horizontally (score chips with marks on
   both sides of the anchor). On a 390 px phone the fit area is 358 − 128 = 230 px, so the fit can zoom out, or zoom in
   too little for the members to separate. A second press fits the same bounds, the camera does not move, and the bubble
   never opens. **Fix:** in Scope 1, take the centre and `fitZoom` from `map.cameraForBounds(bounds, { padding: 64 })`,
   then `easeTo({ center, zoom: Math.min(MAP_MAX_ZOOM, Math.max(fitZoom, map.getZoom() + 1)) })`. Each press then gains
   at least one zoom level and ends at max zoom, where `separatesAt` is true by construction.
4. **major. Focus is lost after a bubble zoom.** A keyboard user presses a bubble. The camera moves, `moveend` regroups,
   and the pressed bubble's marker is removed, so focus falls to `<body>`. This breaks 0009t's standing rule ("focus
   lands on what replaced it"). **Fix:**
   - Scope 1: when the focused element was a removed bubble, the next marker diff after that move focuses the marker
     whose `data-pin-id` is the old anchor's id, or `cluster:` + that id, whichever exists. If neither exists, focus goes
     to the map canvas.
   - AC10 `ac10_bubble_zooms_in`: press with Enter and expect a `[data-pin-id]` button to have focus. The fake cannot
     cover this.
5. **major. AC11's screens cannot be produced as written, and the existing `map` state breaks.**
   - `search.screens.ts:256-263` waits for and clicks the כצנלסון pin. At the fitted first view, listings 1 and 3
     (34.811/32.0707 and 34.8147/32.0824) are about 6 px apart and fold into a bubble, so `pin.waitFor()` times out.
   - `mockApi` answers `/me/likes` and `/me/applications` with 404, nothing seeds `rent-app:seen`, and no two fixtures
     share a point, so `map-tiers` and `map-same-place` cannot show what AC11 lists.

   **Fix:** spell the fixtures out in AC11:
   - the `map` state and the new states zoom in with the zoom-in button until the four pins separate, or spread the
     coordinates;
   - for the seeker, mock `/me/likes` (`mine: [{ listing: <listing 2> }]`, `liked_me: []`) and `/me/applications` (one
     `submitted` on listing 3);
   - write `rent-app:seen` with `page.addInitScript`;
   - add two listings at one identical point for `map-same-place`, and one tight pair for `map-bubble`;
   - write the screenshots to `screens/0009v/`.
6. **minor. Bubble-open and the selected pin.** Scope 7 does not say what happens to `selectedId` when a same-place list
   opens. If it is kept, the pin stays `aria-pressed` and kept apart while its card is gone. **Fix:** `onBubbleOpen`
   clears `selectedId`. Assert this in AC6.
7. **minor. Re-opening a seen listing.** `markSeen` on an id that is already stored is unspecified. **Fix:** remove the
   old copy and append, so there are no duplicates and the 300 cap drops the least recently opened. Add a case to
   `ac8_seen_store`. `seen.test.ts`, `ListingPage.test.tsx` and `logout.test.tsx` clear `localStorage` in `afterEach`
   (jsdom keeps it across the tests of a file).
8. **minor. Spell out `bubbleSamePlace_*`.** Scope 8 gives only "…" for these strings. **Fix:** write all three, e.g.
   `"מודעה אחת באותה נקודה, לחיצה מציגה אותה"` / `"2 מודעות באותה נקודה, לחיצה מציגה אותן"` /
   `"{{count}} מודעות באותה נקודה, לחיצה מציגה אותן"`.
9. **minor. Define "intersects".** MapLibre rounds marker positions to whole pixels (`subpixelPositioning` is off), so
   two rects that are less than 1 px apart in world pixels can touch on screen. **Fix:** in Scope 3, "intersects" means
   the rects overlap with positive area, computed on rects grown by 1 px on each side. AC4 checks disjointness on the
   same grown rects.
10. **minor (simplification).** `separatesAt(members, MAP_MAX_ZOOM)` is run three times per bubble: in `bubbleLabel`,
    on the real press and on the fake press. **Fix:** `clusterPins` (or `SearchMap`) sets `separates: boolean` on
    `Bubble` once. `bubbleLabel`, `MapCanvas` and the fake read it. The fake's press rule becomes "`separates` →
    `lastZoomedTo`, else `onBubbleOpen`", with no maths duplicated.

Scope check: one screen, no endpoint, no table. It fits one coder run at the upper end (~3.5–4 h with items 2–5). If it
ever needs splitting, the seam is Scope 1–3 + 7 + 9 (clusters) vs. Scope 4–6 (tiers, marks, seen). Reviewers `[code,
qa, ux]` are correct.

**Applied by the orchestrator (2026-11-13):** all 10 findings — `view` optional on `onMoveEnd` (1), the unique-price e2e plan in Scope 9 and AC10 (2), at least one zoom level per bubble press (3), focus after a bubble zoom (4), the screens fixtures in AC11 (5), the list clears the selection (6), seen de-duplication (7), the `bubbleSamePlace_*` strings (8), the 1 px growth (9), `separates` on `Bubble` (10).
