---
id: 0021d
title: The search map covers all of Israel and opens where the seeker is looking (else Tel Aviv-Yafo)
status: verified
depends_on: [0021b]
reviewers: [code, qa, ux, perf]
estimate: 1 coder run
---

## Goal
The web side of going national, part 2 (PRODUCT.md "Launch area", Gilad 2026-11-17): the search map (full and
side), the place box and the locate button work anywhere in Israel, and the map opens on the seeker's first
preferred area, else Tel Aviv-Yafo.

## Scope
**In**
- **`components/map/config.ts`:** `GUSH_DAN_BOUNDS` → `ISRAEL_BOUNDS` `[34.2, 29.45, 35.9, 33.35]`;
  `MAP_POSITION_BOUNDS` = `ISRAEL_BOUNDS` widened by 0.5° on each side; `inLaunchArea` → `inIsrael`;
  `MAP_MIN_ZOOM` 8 → 6 (Israel is ~3.9° tall, about z6.5 at phone height); new
  `DEFAULT_VIEW = { center: [34.7818, 32.0853], zoom: 13 }` (Tel Aviv-Yafo, today's `places.ts` value), so a
  visitor never waits for `/areas`. Remove the "one launch area" shortcut comment.
- **`features/search/mapPosition.ts`:** `parseCenter` keeps dropping (not clamping) a URL centre outside
  `MAP_POSITION_BOUNDS`; update its doc comment and the zoom clamp to the new `MAP_MIN_ZOOM`.
- **Default view** (`SearchMap.tsx`, apartment and market maps), when the URL has no position:
  - a visitor: `DEFAULT_VIEW` at once;
  - signed in: the map's existing loading state until the profile (`useProfile`) and `areasQuery` (from `0021b`)
    have answered; then it mounts at the **first** `area_ids` entry's centre (zoom 13 for a settlement, 15 for a
    neighbourhood), or at `DEFAULT_VIEW` if either request failed, there is no looking part, or the list is empty.
  - The "fit the first answer once" behaviour (`fitPending`, L136) is **dropped** when the map opens at a default
    view: the view is now a deliberate place. It stays for nothing else.
- **Show all** (`SearchMap.tsx` L419/L465): shown when the answered box does not contain `ISRAEL_BOUNDS`; fits
  `ISRAEL_BOUNDS`; text `search.map.showAll` → "הצגת כל הארץ".
- **Side map** (`SideMap.tsx` L99): initial view `ISRAEL_BOUNDS`, then it fits the list's pins as today.
- **Locate button** (`LocateButton.tsx` L49): `inIsrael`; `search.map.locateOutside` → "נראה שהמיקום שלך מחוץ
  לישראל.".
- **Place box** (`PlaceSearch.tsx`): built on `0021b`'s `AreaSearch` over all areas (settlements and
  neighbourhoods); a pick flies to the area's centre at zoom 13 (settlement) or 15 (neighbourhood); not found keeps
  SearchMap's `placeNotFound` status. `places.ts`, `places.test.ts` and the `places.*` keys in `he.json` are deleted
  (the catalogue replaces the hand list; OSMF's 100-entry guideline no longer applies, the names are CBS and
  nadlan's).
- **Tests following the change:** `config.test.ts`, `mapPosition.test.ts` (L13 old literal), `cluster.test.ts`
  L123, `SearchMap.test.tsx` (L30, L807, L1071, L1135, L1178), `SideMap.test.tsx`, `LocateButton.test.tsx`.
- **e2e / screens (CI only, never run locally):** `search.spec.ts`, `map.spec.ts` (area fixtures),
  `screens/search.screens.ts` L516–556 (Haifa is now inside; `he.places.*` deleted; show-all). `promo/promo.capture.ts`
  L532/L575 (not in CI): update, or log in FOLLOWUPS.

**Out**
- Self-hosted tiles, a paid geocoder (PRODUCT.md "Launch area"). Area search filter.

**New dependencies:** none.

## Data
None.

## API
None (reads `GET /areas` through `areasQuery`, `GET /profile`, `GET /search` with its existing `bbox`).

## UI
Screens: search page full map (apartments and market), side map, place box, locate button. States: map loading
(existing) while a signed-in user's profile and areas load; success at the default view; error (profile or areas
failed) falls back to `DEFAULT_VIEW` silently; empty results keep the existing empty state plus show-all. RTL
unchanged; logical properties only. i18n: changed `search.map.showAll`, `search.map.locateOutside`; deleted
`places.*`.

## Acceptance criteria
- [ ] AC1 A URL centre in Eilat (29.56, 34.95) and in Metula (33.28, 35.57) is kept; one in Cairo is dropped; zoom
  is clamped to 6–max — `features/search/__tests__/mapPosition.test.ts::ac1_israel_bounds`
- [ ] AC2 With no URL position: a visitor opens at `DEFAULT_VIEW`; a seeker with areas [Haifa, Florentin] opens at
  Haifa's centre, zoom 13; a seeker without a looking part opens at `DEFAULT_VIEW`; the map does not auto-fit the
  first answer — `features/search/__tests__/SearchMap.test.tsx::ac2_default_view`
- [ ] AC3 With results only inside a small box, show-all reads "הצגת כל הארץ" and fits `ISRAEL_BOUNDS` —
  `SearchMap.test.tsx::ac3_show_all_israel`
- [ ] AC4 The place box flies to a city at zoom 13 and a neighbourhood at zoom 15 —
  `features/search/__tests__/PlaceSearch.test.tsx::ac4_jump`
- [ ] AC5 The locate button accepts a position in Haifa and refuses one in Amman with the new text —
  `features/search/__tests__/LocateButton.test.tsx::ac5_in_israel`
- [ ] AC6 `inIsrael` is true for Eilat and Metula and false for Amman — `components/map/__tests__/config.test.ts::ac6`
- [ ] NF1 A whole-country `bbox` search on the seed plus 2,000 generated listings stays within the existing search
  p95 budget (perf reviewer measures `GET /search?bbox=ISRAEL_BOUNDS` locally; numbers in the PR)

## Tests to write
Unit: `inIsrael`, `parseCenter`. Component: default view (visitor, seeker with areas, without), show-all, side map
initial view, place box jump, locate. E2E (CI only): a listing in Haifa found on the map after a place-box jump.

## Risks / open questions
None open. Decided 2026-11-17 (Gilad): default view Tel Aviv-Yafo at zoom 13 when there is no preferred area.
Recommendations from the 0021b verifier taken by the orchestrator (mechanical): show-all fits Israel, min zoom 6,
`fitPending` dropped at a default view.

## Blast radius
`graphify affected` on `main`, 2026-11-17 (depth 2), from the 0021b verification.
- `GUSH_DAN_BOUNDS`: `SearchMap.tsx` (L419, L465, L504), `SideMap.tsx` L99, `cluster.test.ts` L123,
  `SearchMap.test.tsx` L807/L1178; `SearchPage.tsx`, `SearchResults.tsx` reach it only through the maps: untouched.
- `inLaunchArea`: `LocateButton.tsx` L49, `config.test.ts` L84–90, `places.test.ts` (deleted).
- `MAP_POSITION_BOUNDS`: `mapPosition.ts` L31, `mapPosition.test.ts` L13; ListingPage, SideMap.test, LocateButton.test
  reach it via `mapPosition`: untouched unless a fixture centre leaves the box.
- `MAP_MIN_ZOOM`: `mapPosition.ts` (z clamp), `SearchMap.tsx`, `SideMap.tsx`. ListingPage imports only
  `APPROXIMATE_RADIUS_M`: untouched.
- `PLACES` / `places.ts`: `PlaceSearch.tsx` L6/L37, `places.test.ts`, `SearchMap.test.tsx` L30/L1071/L1135, `he.json`
  `places.*` (L1626), `screens/search.screens.ts` L539.
- `PlaceSearch`: `SearchMap.tsx` L480 only.
- `SideMap`: `SearchResults.tsx` L147 → `SearchPage`; `SideMap.test.tsx`.
- `SearchMap`: `SearchPage.tsx`; tests `SearchMap`, `SearchPage`, `LocateButton`, `SideMap`,
  `match/__tests__/logout.test.tsx` (transitive; untouched unless they assert initial bounds).
- `LocateButton`: `SearchMap.tsx` L380; `LocateButton.test.tsx`.

## Digest (filled by orchestrator after verification)
