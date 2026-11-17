---
id: 0021b
title: Anyone in Israel picks their city when posting and chooses cities or neighbourhoods as preferred areas
status: in-progress
depends_on: [0021a1]
reviewers: [code, qa, ux]
estimate: 1 coder run
---

## Goal
The web side of going national, part 1 (PRODUCT.md "Launch area", Gilad 2026-11-17): the national area catalogue
from `0021a` replaces the Gush Dan area select, the free-text city and the profile's area checkboxes. The map is
`0021d`.

## Scope
**In**
- **Shared areas query** in `features/areas/api.ts`: `areasQuery = queryOptions({ queryKey: ['areas'], queryFn:
  fetchAreas, staleTime: Infinity, gcTime: Infinity })`, used by every call site: `ListingWizard.tsx` (L190),
  `ProfilePage.tsx` (L707), `PeoplePage.tsx`, `MarketPeoplePage.tsx`, `MyLikesPage.tsx` (and the map in `0021d`).
  The explicit refetches stay (wizard on `unknown_area` L660, profile retry).
- **`areaLabel(area, areasById)`** in `features/areas/`: a settlement's `name_he`; a neighbourhood's
  `t('areas.neighbourhoodOf', { neighbourhood, city })` ("{{neighbourhood}}, {{city}}"), since names like
  "מרכז העיר" repeat across cities. Used by the picker and the people pages.
- **One picker** `features/areas/AreaSearch.tsx`, generalised from `features/search/PlaceSearch.tsx`: the same
  native `<datalist>` with **every** option (no cap in code: Chrome for Android and iOS Safari filter natively;
  Firefox for Android shows no list, so typing the full name + Enter must work), the same "pick when unambiguous,
  else wait for Enter" rule. A `kinds` prop says which kinds it offers. `normalise` keeps the geresh/gershayim swap
  and also drops spaces around `-` and collapses runs of spaces. Enter on a name that matches nothing shows
  `areas.notFound` under the field (the wizard and profile have no status line). States: loading (disabled input,
  existing loading label), error (`ErrorState` with retry, as today), not found, chosen. `PlaceSearch` moves onto
  it in `0021d`.
- **Listing wizard** (`DetailsStep.tsx`, `ListingWizard.tsx`, `features/listings/validate.ts`): the area `<Select>`
  and the free-text city input become one `AreaSearch` over settlements, labelled `listings.fields.city` with the
  text "עיר או יישוב", writing `area_id`. `withArea` loses the "one area is preselected" branch. `city` leaves
  `ListingForm`, `EMPTY`, `LIMITS`, `FIELD_ORDER`, `validate`, `toListingIn` and `fromListing`;
  `listings/__tests__/validate.test.ts` and `fixtures.ts` follow. Edit mode shows the listing's settlement; a
  settlement no longer in `GET /areas` leaves the input empty and required (the API answers `unknown_area` as
  today). **Rent hint:** `useRentEstimate` (DetailsStep L30–42) sends `city=` the chosen settlement's `name_he`.
- **Profile** (`ProfilePage.tsx`, `features/profile/validate.ts`): the areas checkbox fieldset becomes, under the
  existing legend `profile.fields.areas`, an `AreaSearch` over settlements and neighbourhoods (input label
  `profile.fields.areasSearch` "הוספת עיר או שכונה") plus removable chips. Chips and `area_ids` keep the **order
  picked** (`visibleAreaIds` no longer re-orders by `GET /areas`), so the first chip is the "first preferred area"
  `0021d` opens the map on. Picking an area already chosen does nothing; a pick clears the input; the 21st pick is
  refused with `profile.errors.areasMax` "אפשר לבחור עד 20 אזורים" (rule in `validate`, error union L149).
  Backspace in the empty input removes the last chip; each chip's remove button has aria-label
  `profile.areas.remove` "הסרת {{name}}". `profile/__tests__/validate.test.ts` follows.
- **People pages** (`PeoplePage`, `MarketPeoplePage`, `MyLikesPage`): area names through `areaLabel`.
- **Copy** in `he.json` (decided, Gilad 2026-11-17): `tagline` "מוצאים דירה ושותפים בכל הארץ"; `landing.badge`
  "בכל הארץ · השקה בעברית"; the FAQ answer "כרגע בכל הארץ."; terms `p1` "…לבין מי שמחפשים, בכל הארץ. …" (rest
  unchanged). These are the only four "גוש דן" strings today (lines 4, 1498, 1618, 1788). The terms change also
  goes to the lawyer with the rest of the terms review (not a build blocker).
- **i18n keys:** added `areas.neighbourhoodOf`, `areas.notFound` "לא מצאנו את השם הזה. אפשר לבחור מהרשימה",
  `profile.fields.areasSearch`, `profile.errors.areasMax`, `profile.areas.remove`; changed `listings.fields.city`
  → "עיר או יישוב"; deleted `listings.fields.area`.
- **e2e (CI only, never run locally):** `listings.spec.ts` L48/L257, `market.spec.ts` L118/L185, `photos.spec.ts`
  L32 (city text box → picker); `applications.spec.ts` L73, `likes.spec.ts` L104 (profile checkbox group →
  picker). Typed `AreaOut` fixtures (`screens/fixtures-*.ts`, `listings/__tests__/fixtures.ts`,
  `app/__tests__/Layout.test.tsx`) are `0021a`'s (its generated type change), not edited twice here.

**Out**
- The map, place box, bounds, locate button: `0021d`. Waitlist site. Area search filter.

**New dependencies:** none.

## Data
None.

## API
None new (uses `0021a`'s `GET /areas`, `POST/PATCH /listings`, `PUT /profile`; `GET /rent-estimate` unchanged).

## UI
Screens: listing wizard details step, profile "what I'm looking for", people pages (labels only), landing, FAQ and
terms (copy). `AreaSearch` states: loading, error, not found, chosen (see Scope). Chips: empty (none chosen, the
picker alone), chosen, max reached. RTL: chips flow from the start edge, the remove button at each chip's end;
logical properties only. Layout and anatomy follow the current fields; no new artboard. The ux reviewer checks one
375 px screen of the wizard picker with "באר" typed (`make screens`).

## Acceptance criteria
- [ ] AC1 In the wizard, typing "באר" offers באר שבע and other settlements but no neighbourhood; choosing באר שבע
  sends its id as `area_id` and no `city`; with 3 rooms the rent hint requests `city=באר שבע` —
  `features/listings/__tests__/DetailsStep.test.tsx::ac1_city_picker`
- [ ] AC2 Editing a listing shows its current city in the picker; a listing whose settlement is not in `GET /areas`
  shows an empty, required picker — `features/listings/__tests__/EditListingPage.test.tsx::ac2_shows_city`
- [ ] AC3 In the profile, a neighbourhood shows as "<neighbourhood>, <city>"; chips keep the order picked and are
  sent in that order; a 21st pick shows `profile.errors.areasMax`; Backspace in the empty input removes the last
  chip — `features/profile/__tests__/ProfilePage.test.tsx::ac3_area_chips`
- [ ] AC4 "תל אביב -יפו" typed with odd spacing + Enter picks Tel Aviv-Yafo; an unknown name + Enter shows
  `areas.notFound`; no two fixture labels are equal after `normalise` —
  `features/areas/__tests__/AreaSearch.test.tsx::ac4_normalise_and_not_found`
- [ ] AC5 `he.json` contains no "גוש דן" — `make i18n-check` plus `locales/__tests__/national.test.ts::ac5`
- [ ] NF1 `GET /areas` is requested once across the wizard, profile and people pages, also after 10 minutes with no
  area screen mounted (the explicit refetches excepted) — `features/areas/__tests__/api.test.ts::nf1_cached`

## Tests to write
Unit: `areaLabel`, `normalise`, profile `validate` max 20, listings `validate` without `city`. Component: wizard
picker + rent hint, edit mode, profile chips. E2E (CI only): the five specs above follow the picker.

## Risks / open questions
None open. Decided 2026-11-17 (Gilad): copy as in Scope; the map's default view is in `0021d`.
- A clash of two real catalogue labels after `normalise` (found by the import) goes to FOLLOWUPS.

## Blast radius
`graphify affected` on `main`, 2026-11-17 (depth 2). Map symbols moved to `0021d`.
- `fetchAreas`: `ListingWizard.tsx` L190 (+ L660 invalidate on `unknown_area`), `ProfilePage.tsx` L707 (+ refetch),
  `PeoplePage.tsx` L41, `MarketPeoplePage.tsx` L39, `MyLikesPage.tsx` L93; tests `ListingWizard`, `EditListingPage`,
  `RequireOwner`, `ProfilePage`, `PersonPhoto`, `PeoplePage`, `MarketPeoplePage`, `MyLikesPage`; `app/__tests__/
  Layout.test.tsx` L98 seeds `['areas']`. All call sites move to `areasQuery`.
- `DetailsStep`: `ListingWizard.tsx` L631 → `NewListingPage`, `EditListingPage`; tests `DetailsStep.test.tsx`,
  `ListingWizard.test.tsx`, `EditListingPage.test.tsx`, `wizard.tsx` helper; inside it `useRentEstimate` (reads
  `form.city`, now the settlement name) and the `city` text field L235 (removed).
- `ListingWizard` / `withArea` (L200, L294): `NewListingPage`, `EditListingPage`, `routes.tsx`, tests above.
  `toListingIn` / `fromListing` / `validate` / `LIMITS` / `FIELD_ORDER` / `EMPTY` in `features/listings/validate.ts`
  (L33–34, 78–79, 116–117, 156, 257–258, 414–416, 436–437); `validate.test.ts`, `fixtures.ts`.
- `ProfilePage` / `ProfileFormView` areas fieldset (L252–304): `routes.tsx`, `ProfilePage.test.tsx`,
  `PersonPhoto.test.tsx`; `visibleAreaIds` (L163), `validate` (L227, error union L149–150), `toProfileIn` (L253) in
  `features/profile/validate.ts`; `profile/__tests__/validate.test.ts`.
- `PlaceSearch` (source of `AreaSearch`): untouched here; `0021d` moves it onto `AreaSearch`.
- e2e: `listings.spec.ts`, `market.spec.ts`, `photos.spec.ts`, `applications.spec.ts`, `likes.spec.ts` (Scope).

## Verifier findings (2026-11-17, one round) — applied by the orchestrator 2026-11-17
Twelve findings; all applied: split into `0021b` (this file) and `0021d` (map, findings 4–6, map parts of 7 and 11);
rent hint and `validate.ts` (2); shared `areasQuery` with `gcTime: Infinity` (3); i18n keys with Hebrew (7); chip
order and max-20 in `profile/validate.ts` (8); `normalise` hyphen/space rule + uniqueness test (9); full datalist,
no cap (10); e2e files (11); AC2 path and the inactive-settlement case (12).

## Digest (filled by orchestrator after verification)
