---
id: 0023a
title: A seeker narrows apartments and rooms to chosen cities or neighbourhoods, sees how many results a filter gives before applying it, and edits filters comfortably on a phone
status: done
depends_on: []
reviewers: [code, qa, ux, perf]   # perf: a new search predicate and a new source of search requests
estimate: 1 long coder run        # full-stack on purpose; if it must shrink, the room chips move out first
---

## Goal
Make search usable now that the app covers all of Israel (PRODUCT.md "Launch area", "Search"): `/search` and
`/market` can be filtered by city or neighbourhood, the apply button says how many listings it will show, active
filters can be removed in one tap, and a phone edits filters in a full-screen sheet.

## Scope
**In**
- **API:** `GET /listings` gains `area_ids`.
- **Area filter** in `FiltersForm`, first in the form: `AreaSearch` over settlements and neighbourhoods plus
  removable chips, as on the profile. In the URL, the API query and the search query keys. Both sides (`/search`,
  `/market`), list and map.
- **Map follows the filter:** applying a newly added area moves the full map there; applying one from the list drops
  the old map position; a full map opened with an area filter and no URL position opens on the first filtered area.
- **Phone sheet:** below `lg` the filters open in a full-screen `Dialog` and close on Apply or Clear. The inline
  phone panel goes. The desktop side panel stays where it is.
- **Live count:** the apply button says how many listings the edited filters give, in the list view.
- **Removable active-filter tags** (`ActiveFilterTags`).
- **Rooms quick choices:** 1, 2, 3, 4, 5+ replace the two 19-option selects.

**Out**
- New filters (size, floor, air conditioning, room-only facts), "fill from my profile", the desktop top bar: phase 2.
- Saved searches and alerts, people-browse filters: phase 3.
- A count-only endpoint; a live count in the map view (see UI).
- Price sliders and histograms.
- The open `search.count_zero` and tag-range follow-ups in `specs/FOLLOWUPS.md` (0009b, 0009i).

**New dependencies:** none.

## Data
No table or column changes, no migration. `listings.area_id` and `listings.neighbourhood_id` are already indexed
(`ix_listings_area_id`, `ix_listings_neighbourhood_id`).

## API
| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | `/listings` | Public, unchanged (`limits.read_limit`) | Existing params plus optional repeated `area_ids` (UUID, 1 to `AREA_IDS_MAX` = 20) | `ListingSearchOut`, unchanged | 422 for a malformed id or more than 20; 429 and 503 as today |

- `api/app/schemas/search.py`, `SearchParams`: `area_ids: Annotated[list[uuid.UUID], Field(max_length=AREA_IDS_MAX)] | None = None`.
  Reuse `AREA_IDS_MAX` from the profile schema. A repeated id is harmless and is not an error.
- `api/app/services/search.py`, `_filtered`: when `area_ids` is non-empty,
  `or_(Listing.area_id.in_(ids), Listing.neighbourhood_id.in_(ids))`. This is the rule `match_columns` already uses
  for a seeker's areas: a city id matches every listing in that city, a neighbourhood id only listings placed in it,
  and a listing with no `neighbourhood_id` never matches a neighbourhood id (Gilad 2026-11-18).
- No id in the catalogue is an error. An unknown id or an inactive city matches nothing; an inactive neighbourhood
  still matches the public listings placed in it. The filter applies to the list, the count and the map box alike,
  because all three go through `_filtered`. `search_listings` stays at exactly two statements.
- Run `make client` so `web/src/api` gains the parameter.

## UI
Layout anatomy: `Search.dc.html` and `SearchDesktop.dc.html` under `design/screens-v*/`; brand tokens win. The phone sheet is a deliberate change from the inline panel. Logical properties only; all text in
`he.json`.

**`features/search/filters.ts`**
- `Filters.area_ids?: string[]`. The URL holds it as repeated `area_ids` params, in the order picked, placed first
  in `KEYS`. `parseFilters` uses `getAll`, keeps valid UUIDs in lower case, drops repeats, keeps the first 20, and
  leaves the key unset when none remain. `toSearchParams` appends one param per id.
- `countActive` counts each area as one filter.
- `searchListings` sends `area_ids` when set. A test asserts the repeated-param form reaches the request.
- Pure helpers, unit tested: `roomChipsOn(range)` and `toggleRoomChip(range, chip)` (rules below).

**Area field (`FiltersForm`)**
- Label `search.area` "עיר או שכונה". `AreaSearch` with `kinds` settlement and neighbourhood and no `value`, so each
  pick clears the input. Chips above it, labelled by `areaLabel`, each removed with `search.tags.remove`. Enter on
  typed text picks or shows `areas.notFound` and does not submit; Enter on the empty input applies the form, like the
  other fields (`AreaSearch` is not changed). Backspace in the empty input removes the last chip.
- Picking a chosen area does nothing. A 21st pick shows the existing `profile.errors.areasMax`, which clears on the
  next area change.
- After a chip's remove button is pressed, focus goes to the picker, as on the profile.
- `/areas` failed: `AreaSearch`'s own error and retry; every other filter still works.
- Extract the profile's remove button into `components/TagRemoveButton.tsx` (24 px look, 44 px hit area, `REMOVE`
  icon, required `aria-label`). `ProfilePage`, this field and `ActiveFilterTags` all use it.

**Rooms**
- Legend `search.rooms`, then pill checkboxes in the features' style: 1, 2, 3, 4 and `search.roomsFivePlus` "5+"
  (rendered `dir="ltr"`, or RTL shows "+5"). `n` means `n` to `n + 0.5`; 5+ means 5 and up with no maximum.
- A chip is on when its whole interval lies inside the draft range and at least one bound is set.
- Tap: nothing on → that chip alone; outside the on run → extend the run to it; the end of a longer run → shrink by
  that end; the only chip on → clear; the middle of a run → that chip alone.
- A URL range the chips cannot express exactly (`rooms_min=2.5`) is kept unchanged on Apply until a chip is tapped.
  The URL parser still accepts every half step.
- The `rooms_max` form error goes and `search.errors.roomsOrder` leaves `he.json`, since the chips cannot invert a
  range.

**Live count**
- New `useFilterCount(draft, enabled)` in `features/search`: waits for 400 ms without edits, then calls
  `searchListings({ ...draft, listing_type, sort: 'newest' }, 0, { limit: 1 })` and reads `total`. `sort: 'newest'`
  avoids ordering by match score. Query key `['search', 'count', { ...draft, listing_type }]`, so the two sides never
  share a count and logout and a profile save reset it with the other search queries. Options: `staleTime: 60_000`,
  `retry: false`, `refetchOnWindowFocus: false`.
- **No request** when the draft equals the URL's filters, when the draft fails `validate`, in the map view, when the
  form is not mounted, or after a 429 until the form remounts. So opening the page costs no extra read.
- Button text: `search.apply` "הצגת תוצאות" whenever no fresh count is known (no edit yet, waiting, loading, invalid,
  map view, any error including 429). Otherwise `search.applyCount_one` "הצגת מודעה אחת", `_two` "הצגת 2 מודעות",
  `_other` "הצגת {{count}} מודעות", or at zero `search.applyNone` "אין מודעות בסינון הזה". The button stays enabled
  at zero. A previous count is never shown for a newer draft.
- A visually hidden `<p role="status">` repeats a known count for screen readers. It must not carry an `aria-live`
  attribute: `web/e2e/search.spec.ts` locates the results count line by `[aria-live="polite"]`.
- A failed count shows no error message: the form still works.

**Phone sheet (`SearchPage`, `components/Dialog.tsx`)**
- `Dialog` gains `size="sheet"`, with classes that override the browser's modal limits: `m-0 h-dvh max-h-none w-full
  max-w-none rounded-none border-0 overflow-y-auto overscroll-contain`; the inner panel gets `min-h-full`. A backdrop
  press does not close a sheet (on a tablet the form is shorter than the screen). Existing sizes do not change.
- `Dialog` gains optional `closeLabel`, which renders an X button. `SearchPage` passes `search.closeFilters`
  "סגירת המסננים". RTL: title at the inline start, X at the inline end, Apply and Clear in logical order. The X comes
  before the content in the DOM, so `showModal` focuses it and the phone keyboard stays shut.
- Below `lg`, the toggle opens the sheet titled `search.filters`. `<Dialog>` stays mounted, because focus restore
  needs it; only its child `FiltersForm` is conditional, so closing with the X or Esc discards the draft and reopening
  starts from the URL.
- `const sheetOpen = open && !isDesktop`, with `if (isDesktop && open) setOpen(false)` during render, so rotating
  across `lg` never shows two forms. The desktop `Card` renders only when `isDesktop`.
- The toggle drops `aria-expanded`, `aria-controls` and `panelId`, and gains `aria-haspopup="dialog"`.
- The form's Apply and Clear row is sticky at the bottom of the sheet, on `bg-surface`, and gets `flex-wrap`, because
  `search.applyNone` plus Clear does not fit the 240 px desktop panel on one line.
- A valid Apply and any Clear close the sheet. If the filters changed, focus goes to the results count line
  (existing behaviour); otherwise it returns to the toggle.
- **Back (Gilad 2026-11-18):** a phone's Back while the sheet is open only closes the sheet. The draft is discarded,
  as with the X; the URL, the applied filters and the results stay as they were. Opening the sheet pushes a history
  entry for this. Apply and Clear take that entry over, the X and Esc remove it, and the map's `replace` writes neither
  close the sheet nor disturb it.
- The form's own `<h2>` renders only in the desktop panel. The desktop `Card` region named by it is unchanged.

**Removable tags (`ActiveFilterTags`)**
- Each tag gets a `TagRemoveButton`, label `search.tags.remove` "הסרת {{name}}". Price and rooms each remove both
  bounds with one press; each area and each feature has its own tag.
- `SearchPage` applies the removal through `setFilters` (map position kept, focus to the count line) and fires
  `search_run` with the new count, values never included.
- Area tags come first, in URL order. An area tag shows `areaLabel`. While `/areas` is loading, after it fails, or
  for an id not in the catalogue it shows `search.tags.areaFallback` "אזור נבחר", and can still be removed. The
  component enables its `/areas` query only when `area_ids` is set.
- React keys: `price`, `rooms`, `available_by`, the feature name, `area:<id>`. The list gets `py-1`, so its horizontal
  scroll does not clip the 44 px hit area.
- When `rooms_max === rooms_min + 0.5` the rooms tag shows `formatRooms(rooms_min)`, so one chip reads "3".
  `countActive` stays per bound.
- The tags are already visible above the empty state, so the empty state itself does not change.

**Map (`SearchMap`)**
- `useDefaultView` takes `filters.area_ids`. Its `/areas` query is enabled when `signedIn || ids.length > 0`. The
  filter branch runs **before** `if (!signedIn)` and waits on `areas.isPending` only when there are ids (a disabled
  query is also pending). The first id found in the catalogue gives `areaView`; a failed `/areas` or no id found falls
  through to today's rules. A URL position still wins.
- New ids are detected **during render**, as `SideMap.tsx` does, not in an effect, or the request has already left.
  For the first new id in the catalogue, call `setBbox(undefined)` and `sendCamera(areaView(area))` together. The
  disabled query keeps the old pins, and `moveend` supplies the new box, so the new filter is never searched in the
  old box. Removing an area never moves the map. The side map keeps mirroring the list.
- `SearchPage.apply`: when `view !== 'map'` and the applied `area_ids` has an id the URL lacked, remove `c`, `z` and
  `pin` from `next`, so the map opened afterwards is not left at the old place.

**States:** results keep their existing loading, empty and error states. New text keys: `search.area`,
`search.roomsFivePlus`, `search.applyCount_one|_two|_other`, `search.applyNone`, `search.closeFilters`,
`search.tags.remove`, `search.tags.areaFallback`.

## Blast radius
`graphify affected` (its graph is 48 commits behind this worktree), each code hit confirmed by grep and read here.
Hits in old specs are left out.
- `SearchParams`: `api/app/routers/search.py` L91 (`GET /listings`) and `api/app/services/search.py` (`_filtered`, `search_listings`); no other code uses it. Additive and optional, so `api/tests/test_search.py`, `test_map_search.py` and `test_room_search.py` keep passing.
- `_filtered`: only `services/search.py::search_listings` L177, which the list, count and map box all go through.
- `parseFilters`: `SearchPage.tsx` (`SearchView`, `apply`, `setFilters`), `FiltersForm.tsx::toFilters`, `__tests__/filters.test.ts`.
- `toSearchParams`: `SearchPage.tsx` (`filtersKey`, `apply`, `sort`, `switchView`, `onOpenFullMap`), `__tests__/filters.test.ts`. `writeMapPosition`, `pickMapParams` and the `/market` redirect copy the params and keep repeated `area_ids` untouched.
- `countActive`: `SearchPage.tsx` (toggle label, `hasFilters`, `search_run`), `ActiveFilterTags.tsx`, `__tests__/filters.test.ts`.
- `Dialog`: direct `DeleteAccountSection`, `ReportDialog`, `ClosureDialog`, `SlotPicker`, `CalendarFeedButton`; through `useConfirm` `ApplicantsPage`, `ChatThreadPage`, `FlatmatesPage`, `MyFlatsPage`, `ListingWizard`, `TourCard`, `ToursPage`, `TourTimesPage`, `CalendarFeedButton`, `KitPreview`; all untouched because `size` and the new props are optional. `components/__tests__/Dialog.test.tsx` gains AC19; `test-setup.ts` already stubs `showModal`/`close`.
- `FiltersForm`: only `SearchPage.tsx`. Must change: `SearchPage.test.tsx` (`openPanel` L85, `roomsFrom`/`roomsTo` L91-92, panel and `aria-expanded` L124-136 and L950-955, `roomsOrder` L292-298), `SearchMap.test.tsx` (L158-165, L598-602, L909-911 open the panel), `web/e2e/search.spec.ts` (L78-81 assert tags with the panel open, which a modal makes inert: assert before opening; L91-102; L94 and L169 find the button by a label that now changes, so use `locator('button[type="submit"]')` inside `getByRole('dialog')` on the phone and inside `panel` on the desktop), `web/e2e/screens/search.screens.ts` L362 (`filters-active` phone shot now shows the sheet). Desktop tests (`SearchPage.test.tsx` `stubDesktop`, `SideMap.test.tsx`, which also wraps `FiltersForm` at L28-34) now mount `AreaSearch`, so they need a `GET /areas` mock or get a 599 and its error state.
- `ActiveFilterTags`: only `SearchPage.tsx`, which must pass the remove handler; covered through `SearchPage.test.tsx`.
- `SearchMap`: only `SearchPage.tsx` and `SearchMap.test.tsx`. `LocateButton.test.tsx`, `SideMap.test.tsx` and `features/match/__tests__/logout.test.tsx` render it only through `SearchPage`; untouched apart from the `/areas` note above. `SideMap` is a separate component and is not changed.
- `searchListings`: `useSearch.ts`, `useMapSearch.ts`, `landing/LatestListings.tsx` (sends no filters, untouched), `__tests__/filters.test.ts`, and the new `useFilterCount`.
- `ProfilePage`: the remove button (`REMOVE` L70, L282-296, used nowhere else) moves to `TagRemoveButton`. Imported by `app/routes.tsx`, `ProfilePage.test.tsx` (finds the button by `profile.areas.remove`, L97-98, so that label must stay), `PersonPhoto.test.tsx`; `app/__tests__/pageWidths.test.ts` names the file only.

## Acceptance criteria
- [ ] AC1 Given listings in two cities, When `area_ids` holds one city, Then only that city's listings return and `total` agrees — `api/tests/test_search.py::test_ac1_area_filter_by_city`
- [ ] AC2 Given a neighbourhood id, Then listings placed in it return, and a listing in the same city with another or no `neighbourhood_id` does not — `api/tests/test_search.py::test_ac2_area_filter_by_neighbourhood`
- [ ] AC3 Given several ids (a city and another city's neighbourhood), Then the result is their union, combined with the other filters and with a map box — `api/tests/test_search.py::test_ac3_area_filter_union_with_filters_and_bbox`
- [ ] AC4 An unknown id gives 200 and no items; a malformed id or a 21st id gives 422 — `api/tests/test_search.py::test_ac4_area_ids_validation`
- [ ] AC5 `listing_type=room` honours `area_ids` and the room-fit hiding still applies — `api/tests/test_room_search.py::test_ac5_area_filter_on_rooms`
- [ ] AC6 `parseFilters` keeps valid ids in order, lower-cases, drops invalid and repeated ids, caps at 20; `toSearchParams` round-trips; each area counts as one active filter — `web/src/features/search/__tests__/filters.test.ts::ac6_area_ids_url`
- [ ] AC7 Picking two areas and applying puts both in the URL and in the request as repeated params, on `/search` and `/market` — `SearchPage.test.tsx::ac7_area_filter_applies`
- [ ] AC8 Enter on typed text picks or shows `areas.notFound` and does not submit; Enter on the empty input applies the form; a repeated pick does nothing; a 21st shows the limit message — `SearchPage.test.tsx::ac8_area_picker_rules`
- [ ] AC9 On a phone layout the toggle opens a modal sheet; a valid Apply closes it and focus lands on the count line — `SearchPage.test.tsx::ac9_sheet_apply_closes`
- [ ] AC10 Closing the sheet without applying discards the draft; reopening shows the URL's filters and focus is back on the toggle — `SearchPage.test.tsx::ac10_sheet_discard`
- [ ] AC11 An invalid price keeps the sheet open with the error focused; Clear empties the URL and closes the sheet — `SearchPage.test.tsx::ac11_sheet_invalid_and_clear`
- [ ] AC12 After an edit and 400 ms the button shows the count from a `limit=1&sort=newest` request; singular, two, many and zero use their keys; the same draft on `/search` and `/market` sends two requests — `SearchPage.test.tsx::ac12_live_count_labels`
- [ ] AC13 No count request on load, for a draft equal to the URL, for an invalid draft, or in the map view; rapid edits send one request — `SearchPage.test.tsx::ac13_live_count_requests`
- [ ] AC14 While a newer draft is waiting or loading, and after a failed or 429 count, the button reads `search.apply` and Apply still works; after a 429 no more counts are sent until the form remounts — `SearchPage.test.tsx::ac14_live_count_stale_and_error`
- [ ] AC15 Removing each kind of tag updates the URL, keeps sort, view and map position, moves focus to the count line, and sends `search_run` with a number only — `SearchPage.test.tsx::ac15_remove_tags`
- [ ] AC16 An area tag falls back to `search.tags.areaFallback` when the id is not in the catalogue or `/areas` failed, and can be removed — `SearchPage.test.tsx::ac16_area_tag_fallback`
- [ ] AC17 `toggleRoomChip` and `roomChipsOn` follow every tap rule, 5+ has no maximum, and an inexact URL range survives Apply until a chip is tapped — `filters.test.ts::ac17_room_chips`, `SearchPage.test.tsx::ac17_rooms_url_range_kept`
- [ ] AC18 In the map view a newly applied area moves the camera there with one `GET /listings` after Apply, using the new box, and no `search.map.empty`; removing an area does not move it; a map opened with an area filter and no position starts on that area; applying an area from the list drops the old `c`, `z` and `pin` — `SearchMap.test.tsx::ac18_map_follows_area_filter`, `SearchPage.test.tsx::ac18_list_apply_drops_old_position`
- [ ] AC19 `Dialog size="sheet"` fills the viewport, has a named close button that takes first focus, and ignores backdrop presses; other sizes render as before — `web/src/components/__tests__/Dialog.test.tsx::ac19_sheet_size`
- [ ] AC20 The phone flow works end to end: open sheet, pick an area, see the count, apply, remove the tag, with no horizontal overflow at 390 px — `web/e2e/search.spec.ts::ac20_phone_filter_flow` (CI only)
- [ ] NF1 `search_listings` still runs exactly two statements with `area_ids` set — `api/tests/test_search.py::test_nf1_area_filter_two_statements`
- [ ] NF2 At 0003a NF2's 10,000 live apartments, with 20 ids, as a visitor and as a signed-in seeker, p95 with `area_ids` is no worse than the same search without it; the perf reviewer records the numbers and the query plan in the digest, and measures one form remount and one sheet open on a throttled CPU
- [ ] NF3 Area ids never appear in analytics: `search_run` carries counts only, and URLs stay scrubbed to route patterns — `SearchPage.test.tsx::ac15_remove_tags`, `web/src/app/__tests__/analytics.test.ts::nf3_search_url_scrubbed`

## Tests to write
Unit: `filters.test.ts` (AC6, AC17), `Dialog.test.tsx` (AC19). Integration: `test_search.py`, `test_room_search.py`
(AC1-5, NF1); `SearchPage.test.tsx`, `SearchMap.test.tsx` (AC7-18). E2E, in CI only, never locally: AC20 and the
updates under "Blast radius".

## Risks / open questions
**Decided (Gilad 2026-11-18):** a neighbourhood filter hides a listing whose neighbourhood the server could not work
out, as the strict rule for seeker preferences. The listing still appears under its city's filter. Recorded in
PRODUCT.md "Search".

Accepted at verification, nothing left for the coder to decide:
- **Rate limit:** `READ` is 300 a minute and 3,000 an hour, and the 400 ms wait caps one tab at 150 a minute. A shared
  address shares the budget, so counts stop after a 429 (see "Live count").
- **Native `<datalist>` inside a modal `<dialog>`** on iOS Safari and Chrome for Android, under the on-screen keyboard:
  not a merge gate, since no agent or CI can see it and typing a full name plus Enter works without the list. Gilad
  checks it on a phone after merge; a failure becomes a follow-up.
- About 1,200 options per mount: accepted, as `PlaceSearch` already does it (measured under NF2).
- Back or Forward that re-adds an area moves the camera, and the move rewrites that entry's `c`/`z`.
- `/areas`: every desktop `/search` now requests it, and phones when the sheet opens or an area tag shows. It is
  public, outside `read_limit`, and cached for a day.
- A `moveend` landing between a filter push and its commit can write the old params back. This race already exists
  for Apply and lasts milliseconds. The coder logs it in `specs/FOLLOWUPS.md`.

## Digest (merged 2026-11-18, PR #140, merge 0573024)
`/search` and `/market` filter by cities and neighbourhoods. The apply button shows the result count, active filters
are removed from their tags, a phone edits filters in a full-screen sheet, and rooms use quick choices. Review: code,
qa, ux and perf: 1 blocker waived, 5 majors fixed, 10 minors fixed, 17 follow-ups logged. The first CI run failed three
phone e2e tests on a too-broad double-tap guard; fixed. CI passed on `702944c`.
Decided by Gilad 2026-11-18: a neighbourhood filter hides listings with an unknown neighbourhood; phone Back with the
sheet open only closes the sheet. Waived by Gilad: NF2 misses for a signed-out visitor filtering on 20 broad cities
(about 79% of 10,000 apartments): search p95 77 to 124 ms, live count 75 to 141 ms, busy Mac in Docker. The index is in
`specs/FOLLOWUPS.md`. Owed: Gilad checks the area list inside the sheet on a real phone.

## Verifier findings
One round (2026-11-18): 6 must-fix and 10 should-fix findings, all applied to the sections above by the orchestrator.
