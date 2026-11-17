---
id: 0021a2
title: A listing in a big city is placed in its neighbourhood, and a seeker who prefers a neighbourhood or its city is matched at the right level
status: in-progress
depends_on: [0021a1]   # areas.kind / parent_id / centre / streets, the neighbourhood rows, migration 0031
reviewers: [code, qa, perf, security]   # perf: the area criterion in search / people / inbox; security: the inbox snapshot (0006c, B1) must cover the neighbourhood
estimate: 1 coder run   # coder Opus/high (migration + the B1 snapshot)
---

Split from `0021a-national-areas` by the spec-verifier (2026-11-17); `0021a1` is the catalogue half.

## Goal
PRODUCT.md "Launch area" (Gilad, 2026-11-17): "A listing sits in a city, and in a neighbourhood when the server
can tell; a seeker's preferred areas are cities or neighbourhoods." The server places listings in neighbourhoods
and the match's area criterion understands both levels.

## Scope
**In**
- **Street → neighbourhood.** New `services/areas.py::neighbourhood_for_street(db, settlement_id, street) ->
  uuid | None`: the street name without its house number (`geocoding.street_query`), then the same rule as
  `rent_estimate._neighbourhood` (`normalise_place` on both sides, the `רחוב ` / `רח ` prefix also tried) over
  the **active** neighbourhoods whose `parent_id` is the settlement, reading `areas.streets`; exactly one match →
  its id, else None. `normalise_place` is imported from `rent_estimate` (not moved). The listing service sets
  `listings.neighbourhood_id` with it on create and on every PATCH that changes the address.
  (Without `street_query`, "הרצל 12" would never match "הרצל": listings keep the house number.)
- **Point → neighbourhood.** In `geocoding.geocode_pending`, the guarded UPDATE that stores a located point also
  sets `neighbourhood_id = COALESCE(neighbourhood_id, <nearest active neighbourhood of the listing's area whose
  centre is within 1,500 m of the stored approximate point>)` (one scalar subquery, `ST_DWithin` on geography,
  ordered by distance, `LIMIT 1`). A listing in a settlement with no neighbourhoods stays NULL. A street change
  re-derives from the street and resets geocoding (`_ADDRESS_FIELDS`), so the sweep fills it again if needed.
- **Matching** (`matching/score.py::match_columns`): new keyword `neighbourhood_id` next to `area_id`.
  `in_area = listing_area = ANY(profile.area_ids) OR COALESCE(listing_hood = ANY(profile.area_ids), false)`.
  The two overrides are a pair: passing `area_id` without `neighbourhood_id` (or the reverse) raises
  `TypeError`, so no caller can score a live neighbourhood next to a snapshot area. The override is a Python
  `None` check on the parameter, never SQL `COALESCE` with the live column: an application from before this spec
  has `neighbourhood_id_at_apply` NULL and is scored on the city only.
  Rule (follows PRODUCT.md "Matching" hard filter "shared area"): a neighbourhood preference matches only
  listings known to be in that neighbourhood; a listing with no `neighbourhood_id` matches city preferences only.
- **Inbox snapshot** (`0006c`, security B1). `applications.neighbourhood_id_at_apply` is set in
  `services/applications._upsert` next to `area_id_at_apply`, in the insert values and in the reopen
  `on_conflict_do_update` set (the one place applications are written); `_applicants` passes
  `area_id=Application.area_id_at_apply, neighbourhood_id=Application.neighbourhood_id_at_apply`.
- `search.py` and `people.py` call `match_columns` without overrides: unchanged code, live columns.
- ~~`seed_demo.py`: a few demo listings on streets that resolve to a Tel Aviv neighbourhood of the fixture data.~~
  Dropped at build (2026-11-17): `seed_demo.py` is not in the repo (an untracked file of the main checkout).

**Out**
- Showing the neighbourhood on a listing or card. Neighbourhood polygons.
- `market_people.browse_statement`'s "sharing an area" ordering stays an exact-id `area_ids` overlap (a city
  preference and one of its neighbourhoods do not count as shared). It only orders, never filters; FOLLOWUPS
  line if people notice.

**New dependencies:** none.

## Data
Migration `0032_listing_neighbourhoods` (the next free number when this merges; `0021c` also plans a migration,
so whichever merges second renumbers and re-chains `down_revision`):
- `listings`: add `neighbourhood_id uuid null` FK `areas.id` `ON DELETE SET NULL`, index.
- `applications`: add `neighbourhood_id_at_apply uuid null` FK `areas.id` `ON DELETE RESTRICT`.
- No backfill (no production; existing rows stay NULL until their next street edit or geocode).
- Downgrade: drop both columns (and the index).

## API
No new endpoint and no request/response change (`neighbourhood_id` is server-side only). Auth rules unchanged:
`POST/PATCH /listings` owner, `GET /listings/{id}/applicants` and status changes owner, search public.

## UI
None.

## Acceptance criteria
- [ ] AC1 A street (with or without a house number) listed in exactly one neighbourhood of the settlement sets
  `neighbourhood_id`; a street in two or in none leaves it NULL; a PATCH of `street` or `area_id` re-derives
  it; an inactive neighbourhood never matches — `api/tests/test_listings.py::test_ac1_neighbourhood_from_street`
- [ ] AC2 After a sweep, a listing with no neighbourhood gets the nearest active centre within 1,500 m, none
  beyond; one that already has a neighbourhood keeps it —
  `test_geocoding.py::test_ac2_neighbourhood_from_point`
- [ ] AC3 A profile preferring a neighbourhood scores area 1 for a listing in it, 0 for another neighbourhood of
  the same city and 0 for a listing of that city with no neighbourhood; preferring the city scores 1 for all
  three; `match_columns(area_id=…)` without `neighbourhood_id` raises `TypeError` —
  `test_matching.py::test_ac3_area_levels`
- [ ] AC4 Apply and reopen store `neighbourhood_id_at_apply`; moving the listing's street to another
  neighbourhood after apply does not change the owner's inbox score; an application with a NULL snapshot is
  scored on its city only — `test_inbox.py::test_ac4_neighbourhood_snapshot`
- [ ] AC5 The migration round trip (`test_migrations.py::test_ac4_migration_roundtrip`) passes with 0032
- [ ] NF1 EXPLAIN of the search, people-browse and inbox statements before/after in the PR: no new join, no new
  sequential scan on `areas`; the area criterion adds only the `OR` on a column already in the row

## Tests to write
Unit: street → neighbourhood (house number, prefix, ambiguous, inactive). Integration: listing create/edit,
sweep with a fake geocoder, match levels, inbox snapshot, apply/reopen.

## Risks / open questions
- 0014a measured, for Gush Dan, 94% of streets in some neighbourhood and 10% of those in more than one; the
  point fallback covers most of the rest, and unplaced listings still match city preferences.
- A neighbourhood preference is strict (unplaced listings fail the area filter and are capped at 59). This is
  the plain reading of PRODUCT.md; if seekers miss listings in practice, revisit with Gilad.

## Blast radius
`graphify affected` on `main`, 2026-11-17 (spec references omitted):
- `match_columns`: `applications._applicants` (→ `list_applicants`, `set_applicant_status`, `routers/applications.py`)
  passes the pair — in Scope; `people.list_people` (→ `routers/people.py`) and `search._with_match`
  (→ `search_listings`, `get_public_listing_with_match`, `liked_rooms`, `routers/search.py`) use live columns,
  code unchanged; `tests/test_people.py::_expected_match` / `test_ac1_candidates_and_order` re-run unchanged;
  `routers/flatmates.py` and `services/flatmates.py` import the module only — untouched.
- `applications._upsert`: `apply` (service and router), `test_applications.py` (`apply`, `call`),
  `test_flatmates.py` (`test_ac8_join_racing_apply_is_never_both`, `answer`) — re-run, unchanged.
- `geocode_pending`: `worker._sweep` / `geocode_listings`, `test_geocoding.py` (`_sweep` and AC3–AC6 tests) —
  the UPDATE gains one column; existing tests re-run unchanged.
- `services/listings.create_listing` / `update_listing` / `_merged`: `routers/listings.py`,
  `test_listings.py::create`, `test_ac9_concurrent_creates_respect_cap` — in Scope.
- `rent_estimate.normalise_place` / `_neighbourhood`: imported or mirrored read-only; their callers
  (`resolve_city`, `estimate_rent`, `test_rent_estimate.py`) untouched.
- `market_people.browse_statement`: named untouched above (ordering only).

## Digest (filled by orchestrator after verification)
