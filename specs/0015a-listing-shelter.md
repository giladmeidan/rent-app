---
id: 0015a
title: "A lister says what protected space the flat has (ממ״ד, ממ״ק, מקלט בבניין or none), seekers see it on the card and the listing page, and can filter for it"
status: draft
depends_on: []
reviewers: [code, qa, ux]   # qa: API + every place a listing is shown; ux: wizard field, card tag, filter
estimate: 1 coder run       # coder Opus/high (migration; Speed rule 6)
---

## Goal
After this ships, every apartment and room listing can say what protected space (מרחב מוגן) the flat has, and a
seeker can see it at a glance and search only for flats that have one. In Israel this is a first-question fact for
renters. Decided 2026-11-15 (Gilad): a **type list**, not yes/no.

## Scope
**In:**
- One new nullable column `listings.shelter` with four values (below); NULL = the lister did not say.
- Create, edit and read it through the existing listing endpoints; return it in search results and the listing page.
- One new search filter `shelter=true`: the flat has a protected space (`mamad`, `mamak` or `building`).
- Web: a field in the listing wizard's details step (also the edit page, which reuses it), a fact on the apartment
  page and the room page, a short tag on the listing card, the filter in the search filters and its active-filter tag.
- Apartments and rooms alike (it is a fact of the flat).

**Out:**
- Distance to the nearest public shelter (needs municipal GIS data; a later spec if wanted).
- A seeker-profile "needs a protected space" preference and any effect on the match score (follow-up candidate).
- Map pins: no change.
- Making the field required (existing listings have no answer; see Risks).

**New dependencies:** none.

## Data
- `listings.shelter TEXT NULL` with `CHECK (shelter IN ('mamad','mamak','building','none'))`
  (`ck_listings_shelter`).
  - `mamad`: ממ״ד inside the flat · `mamak`: ממ״ק on the floor · `building`: מקלט in the building · `none`: no
    protected space · NULL: not said.
- Migration `NNNN_listing_shelter.py`: the next number after the Alembic head on `main` when the build starts (today
  `0022`; Slice 12's draft `0012a` plans `0023_admin_moderation`). If another migration lands on `main` first, the
  second to merge re-points its `down_revision` after merging `origin/main`, so there is one head. Working
  `downgrade` drops the constraint and the column.
- Backwards-compatible: existing rows get NULL; no backfill.
- ORM: `Listing.shelter: Mapped[str | None]` next to `elevator` in `api/app/models/listing.py`.

## API
No new endpoints; auth rules unchanged.

| Method | Path | Auth rule | Change |
| --- | --- | --- | --- |
| POST | /listings | unchanged (signed in) | `ListingIn.shelter: Literal['mamad','mamak','building','none'] \| None = None` |
| PATCH | /listings/{id} | unchanged (owner) | `ListingPatch.shelter`: same type; sending `null` clears it (follow how `ListingPatch` already tells "not sent" from `null` for nullable fields) |
| GET | /listings/mine, /listings/{id} (owner) | unchanged | `ListingOut.shelter` |
| GET | /search (and the listing detail) | unchanged | `SearchParams.shelter: bool \| None = None`; `ListingPublic.shelter` (so `ListingDetail` has it) |

Filter in `api/app/services/search.py` next to `elevator`: `shelter=true` →
`Listing.shelter.in_(('mamad','mamak','building'))`. `shelter=false` or absent = no filter.
An unknown value on create/patch → 422 like every other enum field.

## UI
Design: no artboard; follow the existing fact rows, chips and filter checkboxes (`design/brand/` for tokens).
- **Wizard / edit** (`web/src/features/listings/DetailsStep.tsx`, `validate.ts`): a radio group "מרחב מוגן" with the
  four options; none selected by default (sent as `null`). Optional. Lives with the building facts (near elevator).
  `validate.ts`: form default, to-payload and from-listing mapping.
- **Apartment page** (`ListingFacts.tsx`) and **room page** (`rooms/RoomFacts.tsx`): a fact row "מרחב מוגן" with the
  option's label; no row when NULL.
- **Card** (`ListingCard.tsx`): add `shelter` to the card's `Pick`; one short fact `ממ״ד` / `ממ״ק` / `מקלט` when
  the value is `mamad` / `mamak` / `building`; nothing for `none` or NULL. Place it right after the elevator fact.
- **Search**: add `shelter` to `FEATURES` in `search/filters.ts` (and its type), `FiltersForm.tsx`,
  `ActiveFilterTags.tsx`; label "מרחב מוגן".
- **i18n keys** (`web/src/locales/he.json`, beside the matching elevator keys):
  - `listings.fields.shelter` "מרחב מוגן"
  - `listings.shelter.mamad` "ממ״ד בדירה", `.mamak` "ממ״ק בקומה", `.building` "מקלט בבניין", `.none` "אין מרחב מוגן"
  - `listings.card.shelter.mamad` "ממ״ד", `.mamak` "ממ״ק", `.building` "מקלט"
  - `search.feature.shelter` "מרחב מוגן"
  - Use the Hebrew gershayim `״` (U+05F4), never an ASCII `"`.
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
- [ ] AC6 The wizard's details step shows the four options with none selected, sends the chosen one, and the edit
  page pre-selects the saved value — `web/src/features/listings/__tests__/DetailsStep.test.tsx`,
  `validate.test.ts`, `EditListingPage.test.tsx`
- [ ] AC7 The apartment page and the room page show "מרחב מוגן" with the option's label, and no row when NULL —
  `ListingPage.test.tsx`, a `RoomFacts` test
- [ ] AC8 The card shows `ממ״ד` / `ממ״ק` / `מקלט` for the three shelter types and nothing for `none` or NULL —
  `ListingCard.test.tsx`
- [ ] AC9 The search filter "מרחב מוגן" sets `shelter=true` in the URL and query, survives a reload, and shows an
  active-filter tag that clears it — `web/src/features/search/__tests__/filters.test.ts` (+ FiltersForm test)
- [ ] AC10 `make i18n-check` passes; no hardcoded Hebrew.

## Tests to write
Unit/integration as named in the ACs. Update the typed fixtures that build listings so `tsc` stays green
(`web/src/features/listings/__tests__/fixtures.ts`, `web/src/features/search/__tests__/fixtures.ts`,
`web/e2e/screens/fixtures-*.ts`, `web/src/features/landing/example.ts`, `KitPreview` if it builds a listing).
E2E: extend the existing listing-create flow in `web/e2e/listings.spec.ts` to pick a shelter type and see it on the
page (CI only; never run e2e locally).

## Blast radius
To be filled by the spec-verifier with `graphify affected` on `Listing`, `ListingIn`, `ListingPatch`, `ListingOut`,
`ListingPublic`, `SearchParams`, `search_listings`, `FEATURES`. Known from a grep of `elevator` on `main`
(2026-11-15): the files named above plus `api/tests/conftest.py`, `api/scripts/seed_demo.py` (in the main checkout,
uncommitted; leave it alone).

## Risks / open questions
- **Optional vs required (Gilad):** the spec keeps it optional, so old listings and the API's existing callers keep
  working. A later spec can require an answer in the wizard for new listings if few listers fill it in.
- Migration numbering clashes with Slice 12's `0023` if both are open at once (handled in Data).
- `none` vs NULL must stay distinct everywhere ("no shelter" is information; "not said" is not).

## Digest (filled by orchestrator after verification)
