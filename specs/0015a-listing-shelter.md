---
id: 0015a
title: "A lister says what protected space the flat has (ממ״ד, ממ״ק, מקלט בבניין or none), seekers see it on the card and the listing page, and can filter for it"
status: verified
depends_on: []
reviewers: [code, qa, ux]   # qa: API + every place a listing is shown; ux: wizard field, card tag, filter
estimate: 1 coder run       # coder Opus/high (migration; Speed rule 6)
---

## Goal
After this ships, every apartment and room listing can say what protected space (מרחב מוגן) the flat has, and a
seeker can see it at a glance and search only for flats that have one. In Israel this is a first-question fact for
renters. Decided 2026-11-15 (Gilad): a **type list**, not yes/no, and it **replaces** 0014b's ממ״ד yes/no
(`safe_room`; Verifier finding 1, option a: "the options are more detailed and helpful").

## Scope
**In:**
- One new nullable column `listings.shelter` with four values (below); NULL = the lister did not say.
- Create, edit and read it through the existing listing endpoints; return it in search results and the listing page.
- One new search filter `shelter=true`: the flat has a protected space (`mamad`, `mamak` or `building`).
- Web: a field in the listing wizard's details step (also the edit page, which reuses it), a fact on the apartment
  page and the room page, a short tag on the listing card, the filter in the search filters and its active-filter tag.
- Apartments and rooms alike (it is a fact of the flat).
- **Remove `safe_room`** (0014b) end to end: column (backfilled into `shelter` first), schemas, `NULLABLE_FIELDS`, the
  wizard's ממ״ד yes/no control, its `ListingFacts` cell, the `listings.fields.safeRoom` key, and `safe_room` in
  `ApartmentFactKey`. The rent estimate's future engine reads `shelter = 'mamad'` instead (no estimate code reads
  `safe_room` today: grep of `services/`, `matching/`, `routers/` is empty).

**Out:**
- Distance to the nearest public shelter (needs municipal GIS data; a later spec if wanted).
- A seeker-profile "needs a protected space" preference and any effect on the match score (follow-up candidate).
- Map pins: no change.
- Making the field required (existing listings have no answer; see Risks).

**New dependencies:** none.

## Data
- `listings.shelter TEXT NULL` with `ck_listings_shelter`:
  `shelter IS NULL OR shelter IN ('mamad', 'mamak', 'building', 'none')`, written identically in the model's
  `__table_args__` and the migration (as 0014b's `ck_listings_condition`; `test_migrations.py`'s autogenerate check
  compares them).
  - `mamad`: ממ״ד inside the flat · `mamak`: ממ״ק on the floor · `building`: מקלט in the building · `none`: no
    protected space · NULL: not said.
- Migration `NNNN_listing_shelter.py`: the next number after the Alembic head on `main` when the build starts (today
  `0022`; Slice 12's draft `0012a` plans `0023_admin_moderation`). If another migration lands on `main` first, the
  second to merge re-points its `down_revision` after merging `origin/main`, so there is one head.
  - **upgrade:** add `shelter` + `ck_listings_shelter`; `UPDATE listings SET shelter = 'mamad' WHERE safe_room`;
    drop `safe_room`. A `false` stays NULL: "no ממ״ד" says nothing about a ממ״ק or a מקלט.
  - **downgrade:** re-add `safe_room boolean NULL`; `UPDATE listings SET safe_room = true WHERE shelter = 'mamad'`
    (everything else NULL: a `false` lost on upgrade is not recovered, which is accepted); drop the constraint and
    `shelter`.
- Not backwards-compatible with a running app that still sends or reads `safe_room`, accepted: nothing is deployed
  before Slice 13, and the API and web change in this one PR. Listings with `safe_room` NULL or `false` read NULL.
- ORM: `Listing.shelter: Mapped[str | None]` in place of `safe_room` (line ~227) in `api/app/models/listing.py`;
  the module docstring's 0014b line names `shelter` (0015a) for the ממ״ד signal.

## API
No new endpoints; auth rules unchanged.

| Method | Path | Auth rule | Change |
| --- | --- | --- | --- |
| POST | /listings | unchanged (signed in) | `ListingIn.shelter: Shelter \| None = None`, with `Shelter = Literal['mamad','mamak','building','none']` defined once in `api/app/schemas/listing.py` |
| PATCH | /listings/{listing_id} | unchanged (owner; 404 otherwise) | `ListingPatch.shelter: Shelter \| None = None` **and `"shelter"` added to `NULLABLE_FIELDS`**: that set is how `ListingPatch` tells an explicit `null` (clears) from a key not sent (`update_listing` reads only `model_fields_set`); a nullable field missing from it turns `null` into a 422 |
| POST / PATCH / renew | /listings, /listings/{listing_id}, …/renew; GET /me/listings | unchanged | `ListingOut.shelter: Shelter \| None` (so `MyListingOut`, which inherits it, has it) |
| GET | /listings (search, its map box, the market's rooms) and /listings/{listing_id} | unchanged (public) | `SearchParams.shelter: bool \| None = None`; `ListingPublic.shelter: Shelter \| None` (so `ListingDetail` and `LikedRoomOut.listing` have it) |

Filter in `api/app/services/search.py` next to `elevator`: `shelter=true` →
`Listing.shelter.in_(('mamad','mamak','building'))`. `shelter=false` or absent = no filter.
An unknown value on create/patch → 422 like every other enum field.

`safe_room` leaves `ListingIn`, `ListingPatch`, `ListingOut`, `ListingPublic` and `NULLABLE_FIELDS`. After this,
`safe_room` in a PATCH body is a 422 (`ListingPatch` is `extra="forbid"`) and in a POST body is ignored
(`ListingIn` ignores extra keys); no response carries it.

## UI
Design: no artboard; follow the existing fact rows, chips and filter checkboxes (`design/brand/` for tokens).
- **Wizard / edit** (`web/src/features/listings/DetailsStep.tsx`, `validate.ts`; the edit page renders
  `ListingWizard`, which renders `DetailsStep`, so it is the same control): a `ChoiceGroup` "מרחב מוגן", built like
  0014b's `condition` control in `ApartmentFacts`: the four options plus "לא לציין" (`listings.room.unset`, form value
  `''`, sent as `null`), `wrap`, default `''`. "לא לציין" is how the edit page clears a saved value back to NULL.
  It sits in the `listings.section.amenities` group right after the elevator checkbox, **outside**
  `ApartmentFacts`, so apartments and rooms both get it. `validate.ts`: form type + default `''`, to-payload
  (`''` → `null`) and from-listing (`null` → `''`). `ListingInBody` (`api.ts`, `Required<Omit<ListingIn,…>>`) then
  requires the key with no change to `api.ts` beyond dropping `'safe_room'` from `ApartmentFactKey`.
  **Remove** the `safe_room` entry from `yesNoFacts` in `ApartmentFacts` (`DetailsStep.tsx` ~line 464) and its form
  field, default and mappings in `validate.ts`; balcony and air conditioning stay.
- **Listing page, apartment and room** (`ListingFacts.tsx` only): one `FactCell` "מרחב מוגן" with the option's
  long label, right after the elevator row and **outside** the `listing_type === 'apartment'` block; no cell when
  NULL. `ListingPage` renders `ListingFacts` for a room too (above `RoomFacts`), so this one row covers both pages;
  `rooms/RoomFacts.tsx` does **not** change (a row there would show twice on a room). Icon: the existing
  `SafeRoomIcon` (`factIcons.tsx`), moved over from the removed `safe_room` cell (whose code in `ListingFacts`
  goes).
- **Card** (`ListingCard.tsx`): add `'shelter'` to `CardFacts`' required `Pick<ListingOut, …>`; one short fact
  `ממ״ד` / `ממ״ק` / `מקלט` when the value is `mamad` / `mamak` / `building`; nothing for `none` or NULL. Place it
  right after the elevator fact. Callers: search results, map, side map, my listings, invites, latest listings and
  the wizard preview get it from their typed data; `landing/example.ts` builds a `CardFacts` literal and adds
  `shelter: null` (the landing example stays as it looks today).
- **Search** (apartments at `/search` and rooms at `/market` share `FiltersForm`, and the map box sends the same
  params): add `'shelter'` to `FEATURES` in `search/filters.ts` and `shelter?: true` to `Filters`; `search/api.ts`
  sends it with no change (it loops `FEATURES`); `FiltersForm.tsx` and `ActiveFilterTags.tsx` each add
  `shelter: t('search.feature.shelter')` to their `featureLabels`, and `ActiveFilterTags` loops `FEATURES` instead of
  its hardcoded `['pets', 'furnished', 'elevator', 'parking']` (line ~59).
- **i18n keys** (`web/src/locales/he.json`, beside the matching elevator keys):
  - `listings.fields.shelter` "מרחב מוגן"
  - `listings.shelter.mamad` "ממ״ד בדירה", `.mamak` "ממ״ק בקומה", `.building` "מקלט בבניין", `.none` "אין מרחב מוגן"
  - `listings.card.shelter.mamad` "ממ״ד", `.mamak` "ממ״ק", `.building` "מקלט"
  - `search.feature.shelter` "מרחב מוגן"
  - Use the Hebrew gershayim `״` (U+05F4), never an ASCII `"`.
  - Removed: `listings.fields.safeRoom` ("ממ״ד"; its only users are the two removed controls).
  - Reused, not new: `listings.room.unset` ("לא לציין"). The option labels are read through a typed map (as
    `conditionLabel`), not a template-literal key, so `make i18n-check` sees every key.
- States: no new loading/empty/error states; the field rides the existing form and pages. RTL: no layout change.
- Run `make client` after the API half so `web/src/api/schema.d.ts` has the field.

## Acceptance criteria
- [ ] AC1 Given a signed-in lister, When they create a listing with `shelter: "mamad"`, Then the listing returns
  `shelter: "mamad"`; without the field it returns `null` — `api/tests/test_listings.py::test_ac1_create_listing_shelter`
- [ ] AC2 Given an owner's listing, When they PATCH `shelter: "none"` and then `shelter: null`, Then it reads back
  `"none"` then `null`; a PATCH without the field leaves it as it was —
  `api/tests/test_listings.py::test_ac2_patch_listing_shelter`
- [ ] AC3 Given `shelter: "bunker"`, When creating or patching, Then 422 —
  `api/tests/test_listings.py::test_ac3_shelter_rejects_unknown_value`
- [ ] AC4 Given listings with `mamad`, `mamak`, `building`, `none` and NULL, When searching with `shelter=true`,
  Then exactly the first three return, and every result carries its `shelter` value —
  `api/tests/test_search.py::test_ac4_search_shelter_filter`
- [ ] AC5 The migration upgrades and downgrades cleanly, the check constraint rejects an unknown value at the DB
  level, and existing rows read NULL — `api/tests/test_migrations.py::test_ac5_listing_shelter_migration`
- [ ] AC6 The wizard's details step shows "מרחב מוגן" for an apartment and for a room with the four options and
  "לא לציין" selected, sends the chosen one (and `null` for "לא לציין"), and the edit page pre-selects the saved
  value and can clear it back to `null` — `web/src/features/listings/__tests__/DetailsStep.test.tsx`,
  `validate.test.ts`, `EditListingPage.test.tsx`
- [ ] AC7 The apartment page and the room page each show exactly one "מרחב מוגן" cell with the option's label, and
  none when NULL — `web/src/features/listings/__tests__/ListingPage.test.tsx` (an apartment and a room case)
- [ ] AC8 The card shows `ממ״ד` / `ממ״ק` / `מקלט` for the three shelter types and nothing for `none` or NULL —
  `ListingCard.test.tsx`
- [ ] AC9 The search filter "מרחב מוגן" sets `shelter=true` in the URL and query, survives a reload, and shows an
  active-filter tag that clears it — `web/src/features/search/__tests__/filters.test.ts` (parse / serialise) and
  `web/src/features/search/__tests__/SearchPage.test.tsx` (checkbox, query, tag; there is no `FiltersForm` test file)
- [ ] AC10 `make i18n-check` passes; no hardcoded Hebrew.
- [ ] AC11 Given rows with `safe_room` true, false and NULL at the previous head, When the migration upgrades,
  Then they read `shelter` `mamad`, NULL, NULL and `safe_room` is gone; When it downgrades, Then `safe_room` is
  true for the `mamad` row and NULL for the others — `api/tests/test_migrations.py::test_ac11_safe_room_backfill`
- [ ] AC12 `safe_room` is gone from the product: no API response has it, a PATCH with it is a 422, the wizard has no
  ממ״ד yes/no control, and the listing page shows no second ממ״ד cell — `test_listings.py::test_ac12_safe_room_removed`,
  `DetailsStep.test.tsx`, `ListingPage.test.tsx`. The 0014b tests that asserted `safe_room` (`test_listings.py`,
  `test_search.py`, `validate.test.ts`, `DetailsStep.test.tsx`, `EditListingPage.test.tsx`, `ListingPage.test.tsx`,
  `ListingWizard.test.tsx`) are rewritten for `shelter`, not deleted; `validate.test.ts`'s room case (line ~634)
  keeps `shelter` on a room body, since it is not an apartment-only fact.

## Tests to write
Unit/integration as named in the ACs. Update the typed objects that build a full `ListingOut` / `ListingPublic` so
`tsc` stays green — exactly the files that spell out `safe_room` today, where `safe_room` is **replaced** by `shelter`: `web/src/features/listings/__tests__/fixtures.ts`,
`web/src/features/search/__tests__/fixtures.ts`, `web/e2e/screens/fixtures-listings.ts`, `fixtures-seeker.ts`,
`fixtures-flatmates.ts`, `listing.screens.ts`, `applicants.screens.ts`, `people.screens.ts`, plus
`web/src/features/landing/example.ts` (`CardFacts`). `KitPreview.tsx` builds no listing (labels only): untouched.
API fixtures (`api/tests/conftest.py`'s listing body) need nothing: the field is optional.
E2E: extend the existing listing-create flow in `web/e2e/listings.spec.ts` to pick a shelter type and see it on the
page (CI only; never run e2e locally).

## Blast radius
`graphify affected` on the main checkout's graph (2026-11-15), confirmed by grep in `rent-app-orch` (origin/main
`06e77f2`). The graph's hits are mostly module imports; the field reaches only the lines below.
- `Listing` (model): read by `services/listings.py` (create/update/renew/list_own), `services/search.py`
  (`_filtered`, `search_listings`, `get_public_listing_with_match`, `liked_rooms`), `services/applications.py`,
  `services/flatmates.py`, `services/people.py`, `matching/fit.py` + `score.py`. Only the search filter and the
  schemas below read `shelter`; matching, applications, flatmates and people are untouched (out of scope: no score).
  Graph also lists `api/scripts/seed_demo.py` / `seed_promo.py`: not in this tree (main checkout, uncommitted); leave.
- `ListingIn`: `routers/listings.py::create_listing`, `services/listings.py::create_listing` / `_merged`;
  tests `test_listings.py`, `test_price_signals.py`, `test_flat_profile.py`, `test_listing_renewal.py`, others build
  bodies without it (optional field, no change).
- `ListingPatch` / `NULLABLE_FIELDS`: `routers/listings.py::update_listing`, `services/listings.py::_merged` /
  `update_listing` (reads `model_fields_set`). Graph has no node for `NULLABLE_FIELDS` (grep: only
  `schemas/listing.py`).
- `ListingOut`: `MyListingOut` (inherits), `routers/listings.py` create/update/renew/my_listings; web `api.ts`
  types → `ListingCard` (`CardFacts`), `ListingWizard` / `validate.ts` (from-listing), `landing/example.ts`, and the
  test/e2e fixtures listed in "Tests to write". `ApplicationListingOut` (applications) has its own field list: untouched.
- `ListingPublic` / `ListingDetail`: `routers/search.py` (search, get_listing), `routers/people.py::my_likes`
  (`LikedRoomOut`), `schemas/market_people.py`; web: `ListingFacts`, `RoomFacts` (no change), `ListingCard`, map
  `pins.ts` / `SearchMap` / `SideMap` (no change: map pins out of scope), the fixtures above.
- `SearchParams` / `services/search.py::search_listings`: `routers/search.py::search_listings` (list + map box).
  The other importers (`routers/people.py`, `services/applications.py`, `people.py`, `reports.py`) import
  other names from `schemas/search.py`: untouched.
- `FEATURES`: `search/api.ts` (query, automatic), `FiltersForm.tsx`, `filters.ts` (`KEYS`, `parseFilters`); graph
  **missed** `ActiveFilterTags.tsx`, which hardcodes the four features (in Scope). Other importers
  (`ResultsList`, `SearchMap`, `SideMap`, `useSearch`, `useMapSearch`, `LatestListings`, `pins.ts`) import other
  names from `filters.ts`: untouched.
- `ListingFacts`: `ListingPage.tsx` (apartment **and** room), `ListingPage.test.tsx`, `ApplySection.test.tsx`,
  `ProfileNudge.test.tsx` (render the page with fixtures: get `shelter` from the shared fixtures).
- Graph **missed**: `PreviewStep.tsx` → `ListingCard` with `ListingInBody` (gets the key via `Required<…>`),
  `e2e/screens/applicants.screens.ts` and `people.screens.ts` (full listing literals).

## Risks / open questions
- **Optional vs required (Gilad):** the spec keeps it optional, so old listings and the API's existing callers keep
  working. A later spec can require an answer in the wizard for new listings if few listers fill it in.
- Migration numbering clashes with Slice 12's `0023` if both are open at once (handled in Data).
- `none` vs NULL must stay distinct everywhere ("no shelter" is information; "not said" is not).
- Dropping `safe_room` in one migration is safe only because nothing is deployed (Slice 13). A listing that said
  ממ״ד "no" loses that answer (becomes "not said"); accepted, since it told nothing about ממ״ק / מקלט.
- `safe_room` in full, after this PR, must have zero hits outside `api/alembic/versions/` (`git grep safe_room`).

## Verifier findings (2026-11-15, one round; status stays `draft` on finding 1 only)
1. **Blocker, product/schema (checklist 9, 3) — Gilad.** `main` already has `listings.safe_room boolean NULL`
   (spec 0014b, ממ״ד yes / no / not said), asked in the wizard's `ApartmentFacts`, shown in `ListingFacts`, returned
   by `ListingIn/Patch/Out/Public`, and named in PRODUCT.md "Rent price estimate" (one of the four captured facts).
   As written an apartment lister answers ממ״ד twice and can contradict it (`safe_room=false`, `shelter='mamad'`).
   Options: **(a, recommended)** `shelter` replaces `safe_room`: the migration backfills
   `shelter='mamad' WHERE safe_room` (a `false` stays NULL: "no ממ״ד" says nothing about ממ״ק / מקלט) and drops
   `safe_room`; its downgrade re-adds it as `shelter = 'mamad'` (NULL when shelter is NULL). The wizard's ממ״ד
   control, its `ListingFacts` cell, `listings.fields.safeRoom` and `ApartmentFactKey`'s `safe_room` go; the future
   rent engine reads `shelter = 'mamad'`. Dropping in one step is safe because nothing is deployed before Slice 13.
   Adds ~10 files (the `safe_room` hits in Blast radius) and AC11 (backfill) to `test_migrations.py`.
   (b) keep both, hide the ממ״ד yes/no control when `shelter` is set: two sources of truth. (c) keep both as-is.
   PRODUCT.md's "Rent price estimate" line changes under (a).
   **Resolved 2026-11-15: Gilad chose (a).** Written into Scope, Data, API, UI, AC11, AC12 and PRODUCT.md by the
   orchestrator; status set to `verified` (one verifier round).
2. Fixed: API paths were wrong (`/listings/mine` → `GET /me/listings`; `/search` → `GET /listings` and
   `GET /listings/{listing_id}`).
3. Fixed: AC2's mechanism named: `"shelter"` joins `NULLABLE_FIELDS`; without it an explicit `null` is a 422.
4. Fixed: the CHECK is spelled out as one SQL string for the model and the migration (autogenerate check).
5. Fixed: the room page renders `ListingFacts` too, so a `RoomFacts` row would show twice; the row lives once in
   `ListingFacts` outside the apartment-only block, `RoomFacts` unchanged, AC7 tested in `ListingPage.test.tsx`.
6. Fixed: a radio group with "none selected" cannot be cleared on the edit page; it is now a `ChoiceGroup` with
   "לא לציין" like 0014b's `condition`, placed outside `ApartmentFacts` so rooms get it.
7. Fixed: AC9 named a non-existent FiltersForm test → `SearchPage.test.tsx`; `ActiveFilterTags` hardcodes the feature
   list (graph missed it), now loops `FEATURES`; the filter also applies on `/market` and the map (same params).
8. Fixed: fixture list made exact (8 files + `example.ts`); `KitPreview` builds no listing.
9. Checked, true: the edit page reuses `DetailsStep` (via `ListingWizard`); all named test files exist except the
   two fixed above; migration head is `0022`. `ApplicationListingOut`, matching and map pins need no change.

## Digest (filled by orchestrator after verification)
    Spec 0015a — protected space (ממ״ד / ממ״ק / מקלט) on listings   (verified, 1 part)
    What a user can do after this: a lister picks the flat's protected space; seekers see it on the card and the
      listing page (apartments and rooms) and can filter search, the market and the map for "has a protected space".
    Decisions I need from you: none (type list and replacing safe_room decided 2026-11-15).
    KPIs this slice moves: listing completeness; seeker filter use.
    Acceptance targets: no NF lines; 12 ACs, each with a named test.
    Risks: one-step drop of safe_room (safe before Slice 13 deploy; "no ממ״ד" answers become "not said") —
      AC11 tests backfill and downgrade; migration number may clash with 0012a's 0023 — second to merge re-points.
    Reviewers: code, qa, ux   Estimated: 1 coder run (Opus/high, migration), 1 review round
    Links: specs/0015a-listing-shelter.md · PRODUCT.md "Listings" + "Rent price estimate" · no artboard
