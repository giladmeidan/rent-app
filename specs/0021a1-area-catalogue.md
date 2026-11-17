---
id: 0021a1
title: Every settlement in Israel and the neighbourhoods of the 18 big cities are areas; a listing is posted in a settlement and the server names its city
status: verified
depends_on: []
reviewers: [code, qa]   # qa: GET /areas, POST/PATCH /listings, PUT /profile change; no matching change here (0021a2)
estimate: 1 coder run   # coder Opus/high (migration with data steps and a lossy downgrade, Speed rule 6)
---

Split from `0021a-national-areas` by the spec-verifier (2026-11-17): this half is the catalogue, the
migration off `gush-dan` and the listing's settlement; `0021a2` places listings in neighbourhoods and teaches
matching about them. `0021b` and `0021c` need only this half.

## Goal
homie opens to the whole country at once (Gilad, 2026-11-17, PRODUCT.md "Launch area"): every settlement in
Israel is an area, and the 18 big cities are also split into neighbourhoods. A listing sits in a settlement and
the server sets its city name; a seeker's preferred areas may be settlements or neighbourhoods.

## Scope
**In**
- **Settlement source (checked by the verifier, 2026-11-17).** data.gov.il dataset `localities-in-israel`
  ("יישובים בישראל - קובצי יישובים", publisher הלשכה המרכזית לסטטיסטיקה), resource
  `d47a54ff-87f0-44b3-b33a-f284c0c38e5a` ("קובץ היישובים 2023", bycode2023, 1,484 rows), read through the CKAN
  datastore API `https://data.gov.il/api/3/action/datastore_search?resource_id=<id>&limit=2000` (the XLSX
  download link on `e.data.gov.il` redirects to a Google sign-in; do not use it). Fields used: `סמל יישוב`
  (code), `שם יישוב` (name), `סמל מחוז` (district 1–7), `קואורדינטות`. The coordinate is a 12-digit integer:
  ITM (EPSG:2039) X = first 6 digits, Y = last 6, metres (Tel Aviv-Yafo `180263664864` → 180263, 664864).
  33 rows have no coordinate; all are non-residential entries (של"ש areas, Judea and Samaria sub-district
  rows `נפת …`, `גמ"ל מחוז דרום`, `תעשיון נוף אדום` …). Licence: data.gov.il marks it "Other (Open)"; CBS's
  own terms are the CBS Open License (commercial use and derived works allowed, attribution required; see
  `0014d`). Committing a derived CSV is allowed.
- `api/scripts/build_settlements.py` (run by hand, once, by the coder; never by the app, CI or a deploy):
  reads the datastore API with `httpx` (already a dependency) and writes `api/data/settlements.csv` with
  columns `code,name_he,district,itm_x,itm_y`, sorted by code, first line a `#` comment naming the dataset,
  resource id and licence. Row rule, a pure function `settlement_row(record) -> tuple | None`: keep a row only
  when its coordinate is 12 digits with X in 100000–300000 and Y in 350000–800000 (the bounds `0014a` uses);
  name stripped and the CBS spacing around a hyphen collapsed (`תל אביב -יפו` → `תל אביב-יפו`); everything
  else unchanged. Every CBS row that passes is a settlement, Judea and Samaria (district 7) and the Golan
  included, as PRODUCT.md "Launch area" says ("every settlement (CBS settlement list)"). Expect about 1,450.
  The conversion to WGS84 is done by PostGIS at import (`ST_Transform(ST_SetSRID(ST_MakePoint(x, y), 2039),
  4326)`, exactly as `rent_reference._store`), so there is **no `pyproj`** and no new dependency.
- **Big cities.** `BIG_CITY_CODES` in `app/services/areas.py`: the 18 "Big cities" blocks of CBS Table 4.9
  (`0014d`, read from `tests/fixtures/cbs_rent/a4_9_e_2026_07.xlsx`): 70 Ashdod, 7100 Ashkelon, 9000 Be'er
  Sheva, 2610 Beit Shemesh, 6100 Bnei Brak, 6200 Bat Yam, 6400 Herzliya, 6500 Hadera, 6600 Holon, 4000 Haifa,
  3000 Jerusalem, 6900 Kfar Saba, 7400 Netanya, 7900 Petah Tikva, 8300 Rishon LeZion, 8400 Rehovot, 8600
  Ramat Gan, 5000 Tel Aviv-Yafo. nadlan.gov.il codes are CBS codes. The verifier checked nadlan on 2026-11-17:
  every one of the 18 settlement files lists neighbourhoods (Jerusalem 110, Haifa 59, Kfar Saba 43, Netanya
  38, Ashkelon 36, Rehovot 33, Hadera 31, Ashdod 26, Be'er Sheva 23, Beit Shemesh 17; the 8 Gush Dan cities
  were checked by `0014a`), and a neighbourhood file carries its centre (`x`, `y`, ITM) and its streets
  (`otherNeighborhoodStreets`, e.g. Pisgat Ze'ev: 113). About 650–700 neighbourhoods in all.
- `api/scripts/import_areas.py` + `make import-areas` (by hand: once per environment after `make migrate`, and
  when the CBS file or nadlan's neighbourhoods change; **not** scheduled in the worker):
  1. Upsert every CSV row as a settlement by `(kind, source_code)`.
  2. For each of `BIG_CITY_CODES`: fetch `settlement/rent/<code>.json` and each listed neighbourhood file
     with `rent_reference.get_rent_fetcher()` and check each file with `rent_reference.parse_rent_file` (the
     same trust-boundary rules; no new parser); upsert each neighbourhood with `parent_id` = its settlement,
     its name, centre and streets.
  3. Soft removal: a settlement missing from the CSV, or a neighbourhood no longer listed by a settlement file
     that **was fetched and passed**, gets `is_active = false`. A failed fetch deactivates nothing. Rows are
     never deleted (listings, applications and profiles point at them).
  4. An upsert updates name, centre, `geom` and streets but **never touches `is_active`** of an existing row
     (`is_active` stays the admin's config switch, PRODUCT.md); new rows are inserted active. A row that
     reappears in the source therefore stays inactive; the run logs that count.
  5. Logs counts only (`settlements`, `neighbourhoods`, `deactivated`, `files_failed`), never a URL.
  `import_areas(db, fetcher, csv_path)` is the testable function; the script wires the real fetcher.
- `scripts/seed.py` (`make seed`) calls `import_areas` with a fixture fetcher serving
  `api/tests/fixtures/rent_reference/` (no network in dev seed, tests or CI); the settlements come from the
  committed CSV. `seed_areas` stays idempotent.
- No polygons: `geom` (still `MULTIPOLYGON`) becomes `ST_Multi(ST_Expand(centre, 0.1))` for a settlement and
  `ST_Multi(ST_Expand(centre, 0.01))` for a neighbourhood (`ST_Expand` alone returns a `POLYGON`, which the
  column refuses). `geocoding.py`'s envelope query (`ST_XMin(Area.geom)` …) is unchanged and only ever reads a
  settlement's box (a listing's `area_id` is always a settlement). shortcut: a box, not the real boundary;
  upgrade if geocoded points land outside their city in practice.
- **Listing create/edit.** `_check_area` also requires `kind = 'settlement'` and returns the area's `name_he`
  (422 `unknown_area` for a neighbourhood, an inactive or an unknown id). `city` leaves `ListingIn` and
  `ListingPatch`; the service sets `listings.city` = the settlement's `name_he` on create and on every PATCH that
  sends `area_id`. `ListingIn` already ignores unknown fields, so a client still sending `city` on create is not
  refused; `ListingPatch` is `extra="forbid"`, so a PATCH with `city` is 422 (that is why the web edit below is
  in this spec). `city` stays in `_ADDRESS_FIELDS` (an area change still resets geocoding) and in `ListingOut`.
- **Profiles.** `area_ids` may hold settlements and neighbourhoods (still 1–20, distinct); the existing
  `_check_areas` (active ids only) already allows both: no code change, one test.
- `GET /areas`: every active area with `kind`, `parent_id` and `centre` (`[lng, lat]`, 5 decimals), ordered by
  `name_he`; `Cache-Control: public, max-age=86400`. About 2,100 rows. The app has no gzip; measure the body
  and state it in the PR (an app-wide `GZipMiddleware` is out: it would also wrap the SSE stream `/me/events`).
- **Migration of existing data** (no production yet, `0013a` is not deployed; dev and demo data only). The
  migration must not import app code that later specs change: it carries **frozen inline copies** of the 19
  old launch-box settlements (code, `name_he` and centre as in `settlements.csv`: 5000, 8600, 6300, 6100, 6600,
  6200, 7900, 6400, 2650, 8300, 2620, 2400, 681, 565, 9400, 229, 587, 9700, 466), of `CITY_ALIASES`, of
  `normalise_place`, and of the old `GUSH_DAN_WKT` for the downgrade. Upgrade, in order:
  1. add the `areas` columns nullable; insert the 19 settlements (upsert by `(kind, source_code)`, so the later
     `make import-areas` only updates them);
  2. each listing's `area_id` := the settlement matched from its `city` text (own name, then alias, both
     through the frozen `normalise_place`), and `city` := that settlement's `name_he`; an unresolved listing
     goes to Tel Aviv-Yafo (5000) with `expires_at = now()` (it leaves search; `listings.status` has no
     `expired` value: the check allows only `active` / `paused`);
  3. each application's `area_id_at_apply` := its listing's new `area_id` (the FK is `RESTRICT`);
  4. each profile's `gush-dan` id is replaced by the 19 settlement ids;
  5. delete the `gush-dan` row; set the new columns `NOT NULL`, add checks, unique and index.
  Downgrade: re-insert `gush-dan` with the frozen WKT; point every listing's `area_id`, every application's
  `area_id_at_apply` and every non-null profile's `area_ids` (as `[gush-dan]`) at it; delete every other
  `areas` row; drop the new columns. Lossy by design (dev data only): rewritten `city` texts and the
  listings expired in step 2 stay as they are.
- **Fixtures.** `scripts/seed_demo.py`, `scripts/seed_promo.py` and `web/e2e` fixtures move off `gush-dan` to
  Tel Aviv-Yafo (and other real settlements where a fixture wants variety). API tests: the `conftest.py`
  fixture keeps its name `gush_dan` (about 1,000 uses in 38 files; renaming is churn) and now returns the Tel
  Aviv-Yafo settlement id, inserting that one row directly, without the CSV (a 1,450-row seed per test would
  slow the suite). Tests that assert the typed city text, or PATCH `city`, are updated.
- **Web (minimal, the rest is `0021b`).** `make client`; `features/listings/validate.ts`'s payload builder
  stops sending `city` (create and edit) and its unit test follows; every typed `AreaOut` fixture gains `kind`,
  `parent_id`, `centre` (`features/listings/__tests__/fixtures.ts`, `DetailsStep.test.tsx`,
  `profile/__tests__/ProfilePage.test.tsx`, `profile/__tests__/validate.test.ts`, `people/__tests__/*`,
  `web/e2e/screens/fixtures-*.ts`, `people.screens.ts`, `market-people.screens.ts`). Until `0021b`, the
  wizard's area `<Select>` and the profile's checkbox list show the whole catalogue: accepted, nothing is
  deployed between the two merges. e2e specs that pick "גוש דן" pick "תל אביב-יפו" (run in CI only).

**Out**
- Placing a listing in a neighbourhood, and matching on neighbourhoods: `0021a2`.
- Web pickers, map bounds, copy: `0021b`. Rent estimates outside Gush Dan, `CITY_ALIASES` growth: `0021c`.
- Real boundary polygons, a paid geocoder, self-hosted tiles (PRODUCT.md "Launch area").
- Area-based search filter (search stays by map box). A neighbourhood on the public listing page.
- Scheduling the area import in the worker.

**New dependencies:** none (`pyproj` dropped: PostGIS already converts ITM).

## Data
Migration `0031_national_areas`:
- `areas`: add `kind text not null` (check `kind IN ('settlement', 'neighbourhood')`), `parent_id uuid null` FK
  `areas.id` `ON DELETE RESTRICT` (check: `parent_id IS NULL` ⇔ `kind = 'settlement'`), `source_code integer not
  null`, `centre geometry(Point,4326) not null`, `streets text[] not null default '{}'` (a neighbourhood's
  street names as nadlan spells them; empty on a settlement; read by `0021a2`), unique `(kind, source_code)`,
  index on `parent_id`. `slug` stays unique: `s-<code>` / `n-<nadlan id>`. The model mirrors every constraint
  (autogenerate sees no diff).
- Data steps and downgrade as in Scope. `api/data/settlements.csv` is committed with the PR.

## API
| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | /areas | public | — | `AreaOut[]`: `id, slug, name_he, kind, parent_id, centre` | 503 |
| POST | /listings | owner (unchanged) | `ListingIn` without `city`; `area_id` = a settlement | unchanged (`city` set by the server) | 422 `unknown_area` |
| PATCH | /listings/{id} | owner (unchanged) | `ListingPatch` without `city` | unchanged | 422 `unknown_area` |
| PUT | /profile | signed in (unchanged) | `area_ids`: settlements or neighbourhoods | unchanged | 422 `unknown_area` |

## UI
None beyond the generated client and the payload line above (`0021b`). No new strings, no layout change.

## Acceptance criteria
- [ ] AC1 After `import_areas` with a fixture fetcher, `GET /areas` returns every settlement of the CSV and the
  fixture's neighbourhoods, each with `kind`, `parent_id` (a neighbourhood's = its city's id) and `centre`
  within 1 m of the expected WGS84 point; inactive rows are absent — `api/tests/test_areas.py::test_ac1_catalogue`
- [ ] AC2 A second run changes nothing; a neighbourhood no longer listed by a passing settlement file becomes
  inactive, not deleted; a failed settlement fetch deactivates none of its neighbourhoods; a row the admin set
  inactive stays inactive — `test_areas.py::test_ac2_import_idempotent_and_soft`
- [ ] AC3 `settlement_row` splits a 12-digit coordinate into ITM X/Y, skips a row with no or a malformed
  coordinate, and turns `תל אביב -יפו` into `תל אביב-יפו` — `test_areas.py::test_ac3_settlement_row`
- [ ] AC4 Create with a neighbourhood id or an inactive id → 422 `unknown_area`; with a settlement →
  `city` = its `name_he`; PATCH `area_id` to another settlement → `city` follows and geocoding resets to
  `pending`; PATCH with `city` → 422 — `test_listings.py::test_ac4_area_must_be_settlement`
- [ ] AC5 Upgrade on a database with `gush-dan` data: listings mapped by city and alias with `city` rewritten,
  an unresolved one in Tel Aviv-Yafo and expired, applications' `area_id_at_apply` repointed, profile ids
  replaced by the 19; downgrade restores `gush-dan` and repoints all three; the existing round trip still
  passes — `test_migrations.py::test_ac5_national_areas`
- [ ] AC6 `GET /areas` sends `Cache-Control: public, max-age=86400` — `test_areas.py::test_ac6_cache_header`
- [ ] AC7 `PUT /profile` accepts a neighbourhood id next to a settlement id; an inactive id → 422
  `unknown_area` — `test_profiles.py::test_ac7_area_kinds`
- [ ] NF1 `GET /areas` with the full catalogue (CSV + ~700 neighbourhoods): body size and p95 (local, 100 calls)
  in the PR; p95 under 150 ms

## Tests to write
Unit: `settlement_row`. Integration: import with a fixture fetcher (idempotent, soft removal, failed fetch,
admin-inactive row), listing create/edit, profile kinds, migration up/down with data. E2E: fixtures only (CI).

## Risks / open questions
- **CBS names vs. OSM names.** The geocoder now sends the CBS name as `city` (formerly the lister's own text).
  Hyphen spacing is normalised; other spellings (קרית/קריית, quotes) may still differ from OSM and raise
  `not_found` in some towns. Watch the `not_found` count after launch; if high, a FOLLOWUPS line for an OSM name
  column.
- `±0.1°` may be too small for a few long settlements; the geocoder then finds nothing (status `not_found`, as
  for any unknown street today). Log it in FOLLOWUPS if seen.
- A big city's neighbourhood list from nadlan may be coarse or oddly named; acceptable for v1.
- nadlan's terms for automated reading are still unconfirmed (`0014a`, approved by Gilad); this adds about 700
  requests per manual run at the existing 0.25 s pacing.
- Attribution: add "settlement list" to the existing FOLLOWUPS line on reading the CBS Open License in full
  before launch.

## Blast radius
`graphify affected` on `main`, 2026-11-17 (spec references omitted):
- `Area` (model): `list_active_areas`, `get_areas`, `seed_demo` (`seed_people`, `seed_demo`), `test_migrations.py`;
  every other hit is a module importing `app.models` (no use of `Area`'s columns) — untouched.
- `AreaOut`: `routers/areas.py::get_areas` only — in Scope.
- `list_active_areas` / `get_areas`: `routers/areas.py`, `app/main.py`, `tests/test_areas.py` (its two
  existing tests check the response keys and order; they gain the three fields) — in Scope.
- `_check_area`: `services/listings.create_listing`, `update_listing`, `routers/listings.py`,
  `tests/test_listings.py::create` — in Scope.
- `ListingIn` / `ListingPatch` (`api/app/schemas/listing.py`): `routers/listings.py`, `services/listings.py`
  (`create_listing`, `_merged`, `update_listing`), `test_listings.py`, `test_listing_renewal.py`; the other
  routers/services/tests import the module for other names — untouched. `_merged` re-validates a stored row as
  `ListingIn`: the stored `city` is ignored as an extra field, fine.
- `_check_areas`: `services/profiles.put_profile`, `routers/profiles.py` — behaviour unchanged, test added.
- `rent_reference.parse_rent_file` / `get_rent_fetcher`: reused read-only; their callers (`run_rent_import`,
  `import_rent_reference.py`, `worker.py`, `test_rent_reference.py`) are untouched.
- `scripts/seed.py::seed_areas`: `conftest.py` (`gush_dan` fixture), `test_seed.py`, `make seed` / `make dev` —
  in Scope.
- `geocode_pending`: unchanged code; it reads the new settlement boxes through `Area.geom` (`worker.py`,
  `test_geocoding.py` fixtures use `gush_dan`, now Tel Aviv-Yafo's ±0.1° box).
- Web `AreaOut` consumers (`features/areas/api.ts`, `DetailsStep.tsx`, `ListingWizard.tsx`, `ProfilePage.tsx`,
  `PeoplePage.tsx`, `MarketPeoplePage.tsx`, `MyLikesPage.tsx`): read `id` / `name_he` only, unchanged here;
  their typed fixtures are in Scope.

## Digest (filled by orchestrator after verification)
