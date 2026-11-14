---
id: 0014a
title: homie keeps the official rent figures for Gush Dan (per city and neighbourhood, by room count, per quarter) in its own database, refreshed every month by the worker
status: done
depends_on: []
reviewers: [code, security]   # security: outbound HTTP to a third party and parsing its untrusted JSON, new config (as 0003c). No qa / ux: no endpoint and no screen
estimate: 1 coder run   # coder Opus/high (migration + data import; Speed rule 6)
---

## Goal
After this ships the database holds the government's rent figures for the 19 Gush Dan settlements and their
neighbourhoods, and the worker refreshes them once a month. Nothing a user sees changes. The rent price estimate
(PRODUCT.md "Rent price estimate"; its engine is a later spec, after Slice 11) reads these rows as its day-one
baseline, because homie has no listings of its own before launch.

## The source (measured by the orchestrator, 2026-11-14)
`https://data.nadlan.gov.il/api/pages/settlement/rent/{code}.json` and
`https://data.nadlan.gov.il/api/pages/neighborhood/rent/{id}.json`: static JSON, no login, UTF-8 **with a BOM**,
17–120 KB a file. File `version` on the day: `20-08-2026`.

Settlement file (keys as the source spells them):

    settlementID: int            settlementName: str         x, y: float   # Israeli TM Grid, EPSG:2039, metres
    otherNeighborhoods:   [{id: int, title: str}]
    neighborhoodsPrices:  [{id: str, title: str, price?: float}]          # ids as strings here
    otherSettlmentStreets: [{id: int, title: str}]                        # not stored
    trends.rooms: [{numRooms: 3 | 4 | 5 | "all", hasDeals: int, summary: {...},
                    graphData: [{settlementPrice: int | null, countryPrice: int, year: int, month: int}]}]
    version: str

Neighbourhood file:

    neighborhoodId: int   neighborhoodName: str   settlementID: int   settlementName: str   x, y: float
    otherNeighborhoodStreets: [{id: int, title: str}]                     # this neighbourhood's streets
    trends.rooms: [{numRooms: 3 | 4 | 5 | "all", ...,
                    graphData: [{neighborhoodPrice: int | null, settlementPrice, countryPrice, year, month}]}]
    version: str

`graphData` is newest first; `month` is 3, 6, 9 or 12 (the quarter's last month); 22 quarters, 2021-Q1 to 2026-Q2.
Prices are monthly rent in ILS. Some numeric fields elsewhere in the file arrive as strings; `null` is common.

What the check found, for the 19 settlements inside the launch box (349 files, no failures):
- Every settlement has city-level figures for 2026-Q2 (Savyon only for "all"; Beit Dagan has no 4-room series).
- 330 neighbourhoods in 16 settlements (Azor, Savyon and Beit Dagan list none). A figure in the last four
  quarters exists for 65% of them at 3 rooms, 67% at 4 rooms, 44% at 5 rooms and 84% for "all".
- The neighbourhood matters: neighbourhood / city rent runs 0.79–1.20 (10th–90th percentile, 3 rooms).
- A neighbourhood figure moves 3.6% between quarters at the median and 12% at the 90th percentile (city level:
  2.4% / 7.1%), so the engine will average several quarters. That is the engine's job, not this spec's.
- 94% of a city's streets appear in a neighbourhood's street list; 10% of those in more than one neighbourhood.
  Neighbourhood centres are 559 m apart at the median. The source gives centres only, no borders.

## Scope
**In:**
- Two tables, `rent_areas` and `rent_prices` (migration `0019`, file
  `api/alembic/versions/0019_rent_reference.py`), and their models `api/app/models/rent_area.py` (`RentArea`) and
  `api/app/models/rent_price.py` (`RentPrice`), both imported in `api/app/models/__init__.py` and listed in its
  `__all__` (otherwise `command.check` in `test_migrations.py` sees two unknown tables and fails).
- `api/app/services/rent_reference.py`: the settlement list, the parser, the fetcher and
  `import_rent_reference(db, fetcher) -> dict[str, int]`.
- The worker runs the import once a month (`api/app/worker.py`), and `make rent-import` runs it once by hand
  (`api/scripts/import_rent_reference.py`, like `scripts/seed.py`; Hard rule 2).
- Config: `Settings.rent_reference: Literal["off", "nadlan"] = "off"` and
  `nadlan_rent_url: str = "https://data.nadlan.gov.il/api/pages"` in `api/app/config.py`. The URL is validated
  like `photo_public_base_url` but **https only** (trimmed, has a host, no query or fragment, no trailing `/`;
  the error message names the rule only). Both variables go into `.env.example` and into the worker's
  `environment` in `infra/docker-compose.yml` (`RENT_REFERENCE: ${RENT_REFERENCE:-off}`,
  `NADLAN_RENT_URL: ${NADLAN_RENT_URL:-https://data.nadlan.gov.il/api/pages}`): compose lists the worker's
  variables one by one, so `.env` alone never reaches it.
- Makefile: `rent-import: $(UV) run python scripts/import_rent_reference.py`, in `.PHONY`, with a
  `## rent-import:` line.
- The existing `api/tests/test_worker.py::test_ac13_worker_sweeps_every_10_seconds` unpacks
  `(job,) = worker.WorkerSettings.cron_jobs` and breaks with two cron jobs: it picks the job whose
  `coroutine is worker.geocode_listings` instead.
- `api/tests/fixtures/rent_reference/raw/` is added to `.gitignore`, so the untracked originals cannot be
  committed.
- Two lines in `specs/FOLLOWUPS.md` (see Risks): an alert when an import fails, and reading the source's terms
  of use before production.
- Tests and small fixtures.

**Out:**
- Any endpoint or screen. Nothing reads these tables yet.
- The estimate itself, and deciding which neighbourhood a listing belongs to (the engine spec, after Slice 11).
- CBS city tables for 1–2 room flats (the source here has 3, 4, 5 and "all" only): the engine spec.
- Neighbourhood borders, settlements outside the 19, alerts when an import fails (Slice 12 has the first admin
  surface; until then a failure is a log line).

**New dependencies:** none (`httpx==0.28.1` is already in `api/pyproject.toml`).

## Data
Migration file `api/alembic/versions/0019_rent_reference.py` with `revision = "0019"` and
`down_revision = "0018"` (this repo's revision ids are the bare number). Two new tables, nothing else touched, so
it is backwards-compatible; `downgrade` drops both. **Migration chain:** this spec's PR merges before 0014b's,
whose migration is `revision = "0020"` and is re-pointed to `down_revision = "0019"` when it merges
`origin/main`.

`rent_areas`: one row per settlement and per neighbourhood.

| Column | Type | Rule |
| --- | --- | --- |
| `id` | uuid PK | `gen_random_uuid()` |
| `kind` | text NOT NULL | `ck_rent_areas_kind`: `settlement` or `neighbourhood` |
| `source_id` | integer NOT NULL | the source's settlement code or neighbourhood id |
| `settlement_code` | integer NOT NULL | a settlement's own code; a neighbourhood's parent |
| `name_he` | text NOT NULL | `ck_rent_areas_name_length`: 1–80 characters |
| `centre` | `geometry(Point, 4326)` NOT NULL | the source's `x` / `y`, transformed from EPSG:2039 by PostGIS |
| `streets` | text[] NOT NULL DEFAULT `'{}'` | a neighbourhood's street names as the source spells them; empty on a settlement |
| `source_version` | text NOT NULL | the file's `version` |
| `created_at`, `updated_at` | timestamptz NOT NULL DEFAULT `now()` | |

`uq_rent_areas_kind_source` UNIQUE (`kind`, `source_id`); `ix_rent_areas_settlement_code` on `settlement_code`.
No spatial index: 349 rows.

`rent_prices`: one row per area, room count and quarter that has a figure.

| Column | Type | Rule |
| --- | --- | --- |
| `area_id` | uuid NOT NULL | FK `rent_areas.id` ON DELETE CASCADE |
| `rooms` | smallint NOT NULL | `ck_rent_prices_rooms`: 0, 3, 4 or 5; **0 = all sizes** |
| `period` | date NOT NULL | first day of the quarter's last month (`2026-06-01` = 2026-Q2); `ck_rent_prices_period`: day 1, month 3, 6, 9 or 12 |
| `price_ils` | integer NOT NULL | `ck_rent_prices_price_ils`: 500–100000 (the bounds of `listings.price_ils`) |
| `updated_at` | timestamptz NOT NULL DEFAULT `now()` | |

Primary key (`area_id`, `rooms`, `period`).

Model and migration details (the same in both, so autogenerate sees no diff):
- `centre` is `Geometry(geometry_type="POINT", srid=4326, spatial_index=False)`; without `spatial_index=False`
  geoalchemy2 expects an `idx_rent_areas_centre` the migration does not create. The stored value is
  `ST_Transform(ST_SetSRID(ST_MakePoint(:x, :y), 2039), 4326)`.
- `streets` is `ARRAY(Text)` with `server_default=text("'{}'")`.
- CHECK texts: `kind IN ('settlement', 'neighbourhood')`; `char_length(name_he) BETWEEN 1 AND 80`;
  `rooms IN (0, 3, 4, 5)`; `EXTRACT(DAY FROM period) = 1 AND EXTRACT(MONTH FROM period) IN (3, 6, 9, 12)`;
  `price_ils BETWEEN 500 AND 100000`.

## Import rules
`RENT_SETTLEMENT_CODES` (a constant in the service; each file names its settlement, checked on 2026-11-14):
5000 תל אביב-יפו, 8600 רמת גן, 6300 גבעתיים, 6100 בני ברק, 6600 חולון, 6200 בת ים, 7900 פתח תקווה, 6400 הרצלייה,
2650 רמת השרון, 8300 ראשון לציון, 2620 קריית אונו, 2400 אור יהודה, 681 גבעת שמואל, 565 אזור, 9400 יהוד-מונוסון,
229 גני תקווה, 587 סביון, 9700 הוד השרון, 466 בית דגן.

1. **Order.** For each code: fetch and store the settlement file, then every neighbourhood whose id is in its
   `otherNeighborhoods` or `neighborhoodsPrices` (union, ids compared as integers).
2. **The file is untrusted input.** A file is skipped whole (counted as failed, nothing of it written) when: it is
   not a JSON object; its id is not the one asked for; a neighbourhood's `settlementID` is not the settlement it
   was listed under; the name is empty, longer than 80 characters or fails `visible_characters_only`
   (`api/app/schemas/_text.py`); `x` / `y` are not finite numbers inside 100000–300000 / 350000–800000;
   `trends.rooms` is missing or not a list; `version` is not a string of 1–20 characters.
3. **A price point** is stored only when `numRooms` is 3, 4, 5 or `"all"` (stored as 0), `year` is an integer
   2000–2100, `month` is 3, 6, 9 or 12, and the price (`settlementPrice` in a settlement file,
   `neighborhoodPrice` in a neighbourhood file) is an integer, not a boolean, inside 500–100000. Any other point
   is skipped alone; the rest of the file is kept. `countryPrice`, `summary`, `indexes`, `hasDeals` and
   `neighborhoodsPrices[].price` are not stored.
4. **Streets.** A neighbourhood's `otherNeighborhoodStreets[].title`, stripped, 1–80 characters, passing
   `visible_characters_only`, de-duplicated, at most 2000; a title that fails is dropped alone.
5. **Upsert, never delete.** An area is matched on (`kind`, `source_id`) and its name, centre, streets, version
   and `updated_at` are replaced. A price is matched on its primary key and updated when the figure changed.
   A figure or an area that is no longer in the source stays as it was.
6. **Failures are soft.** A network error, a non-200 status or a skipped file is counted and the run continues.
   When a settlement file fails, its neighbourhoods are not fetched in that run. Each file is its own
   transaction, so a crash keeps what was already stored. The import never raises to the worker.
7. **Polite fetching.** One request at a time, at least 0.25 s between requests, 30 s timeout, redirects not
   followed, no cookies, a fixed generic `User-Agent` (`homie-rent-reference`), a response over 2 MB refused.
   The base address is `NADLAN_RENT_URL` (default `https://data.nadlan.gov.il/api/pages`).
8. **Off by default.** With `RENT_REFERENCE=off` (dev, tests, CI) the cron job and the script make no request and
   return `{"skipped": 1}`. `nadlan` turns the import on (production, Slice 13).
9. **Schedule.** `cron(import_rent_reference_job, day=5, hour=3, minute=10, unique=True, timeout=1800)`: a full
   run is about 350 requests and takes 3–4 minutes, close to arq's 300 s default. The job runs the import off the
   event loop (`asyncio.to_thread`, as `geocode_listings` does).
10. **Logging.** One INFO line with the counts (`files_ok`, `files_failed`, `areas`, `prices_new`,
    `prices_changed`) and the source version. Never a URL per request at INFO (`httpx` already logs at WARNING in
    the worker).

**Input types** (they complete rules 1–6; JSON `true` / `false` is never accepted where an integer is asked):
- A file's own id (`settlementID` / `neighborhoodId`) and a neighbourhood's `settlementID` must be a JSON
  integer equal to the expected value.
- An id in `otherNeighborhoods` / `neighborhoodsPrices` is an integer or a string matching `^[0-9]{1,9}$`; any
  other entry is ignored alone (not a file failure). The union is de-duplicated and fetched in ascending id.
- The name is `settlementName` / `neighborhoodName`: a string, stripped, 1–80 characters, for which
  `visible_characters_only(name, require_visible=True)` does not raise `ValueError`; the stripped value is stored.
- `x` / `y`: an integer or a float, not a string, finite, inside the bounds. `trends` must be an object.
- An entry of `trends.rooms` that is not an object, or whose `graphData` is not a list, is skipped alone.
- `numRooms`: the integer 3, 4 or 5, or exactly `"all"`. `year`, `month` and the price: integers; a float
  (`8000.0`) or a string is skipped. A repeated (rooms, period) inside one file: the first in file order wins.
- Streets: a title that is not a string is dropped alone; de-duplication keeps the first; the first 2000 are kept.
- Any exception while writing a file rolls back that file and counts it failed; its WARNING line names the path
  and the exception class only.

**Interfaces**, all in `api/app/services/rent_reference.py`:
- `RentSourceError(Exception)`: a network error or timeout, a non-200 status (a redirect included), a body over
  `MAX_BODY_BYTES = 2 * 1024 * 1024`, a body that is not UTF-8 JSON. Its message never holds the body.
- `RentFetcher(Protocol)` with `fetch(self, path: str) -> object` (the parsed JSON). Paths are
  `settlement/rent/{code}.json` and `neighborhood/rent/{id}.json`, relative to `NADLAN_RENT_URL`.
- `NadlanFetcher(client: httpx.Client, *, sleep: Callable[[float], None] = time.sleep)`: calls `sleep(0.25)`
  before every request but the first; `client.cookies.clear()` before each request; reads with
  `client.stream("GET", path)` and `iter_bytes()` and raises once past `MAX_BODY_BYTES` (a `Content-Length` is
  not trusted alone); decodes as `utf-8-sig`.
- `get_rent_fetcher()` builds `httpx.Client(base_url=settings.nadlan_rent_url, headers={"User-Agent":
  "homie-rent-reference"}, timeout=30.0, follow_redirects=False)`.
- `import_rent_reference(db: Session, fetcher: RentFetcher) -> dict[str, int]` returns exactly `files_ok`,
  `files_failed`, `areas` (area rows written this run), `prices_new` and `prices_changed`, and logs rule 10's
  line (the version is the first settlement file's). `files_failed` counts the failed file only, not the
  neighbourhoods left unfetched under a failed settlement.
- `run_rent_import() -> dict[str, int]`: returns `{"skipped": 1}` when `rent_reference == "off"`, **before**
  building a fetcher; otherwise `get_sessionmaker()()` and `import_rent_reference(db, get_rent_fetcher())`. The
  worker's `import_rent_reference_job(ctx)` is `await asyncio.to_thread(run_rent_import)`; the script's `main()`
  calls `run_rent_import()` and prints the counts.
- No fake in app code: the test file holds `FakeRentFetcher(files: dict[str, object | RentSourceError])` with
  `requests: list[str]`.

## API
None. No endpoint is added or changed.

## UI
None.

## Acceptance criteria
- [ ] AC1 Given a database at `0018`, When it is upgraded and downgraded, Then `rent_areas` and `rent_prices`
  appear with every constraint above and disappear again, and autogenerate sees no diff at head —
  `api/tests/test_migrations.py::test_ac1_rent_reference_upgrade_downgrade`
- [ ] AC2 Given a settlement fixture, When it is imported, Then one `settlement` area and one price row per
  non-null (rooms, quarter) exist, `"all"` stored as rooms 0 and `period` as the first of the quarter's last
  month — `api/tests/test_rent_reference.py::test_ac2_settlement_file_stored`
- [ ] AC3 Given a neighbourhood fixture with `null` quarters, When it is imported, Then only the non-null
  quarters have rows, its `settlement_code` is the parent's and its streets are stored de-duplicated —
  `test_rent_reference.py::test_ac3_neighbourhood_file_stored`
- [ ] AC4 Given the Tel Aviv file's `x` 179706.07 / `y` 666156.93, When it is stored, Then `centre` lies inside
  longitude 34.76–34.80 and latitude 32.06–32.10 — `test_rent_reference.py::test_ac4_centre_is_wgs84`
- [ ] AC5 Given an import that already ran, When the same files are imported again, Then no row is added,
  `prices_new == prices_changed == 0`, every `rent_prices.updated_at` is unchanged and the `rent_areas` row count
  is the same (rule 5 does rewrite an area's `updated_at`) —
  `test_rent_reference.py::test_ac5_import_is_idempotent`
- [ ] AC6 Given stored figures, When a later file revises one figure and no longer carries another, Then the
  revised row holds the new price and the missing one keeps its old price —
  `test_rent_reference.py::test_ac6_revised_updates_missing_stays`
- [ ] AC7 Given each bad file of rule 2 (not JSON, wrong id, a neighbourhood under the wrong settlement, a name
  with a control character, `x` out of bounds, `y` out of bounds, no `trends.rooms`, a `version` of 21
  characters), When it is imported, Then nothing of that file
  is written, it is counted as failed and the next file is imported —
  `test_rent_reference.py::test_ac7_bad_file_skipped` (parametrised)
- [ ] AC8 Given each bad point of rule 3 (price 99, 1000000, `"8000"`, `true`, `null`; month 5; `numRooms` 2),
  When the file is imported, Then that point has no row and the file's other points do —
  `test_rent_reference.py::test_ac8_bad_point_skipped` (parametrised)
- [ ] AC9 Given a settlement whose file answers 500 or times out, When the import runs, Then none of its
  neighbourhoods is requested, the next settlement is imported and nothing raises —
  `test_rent_reference.py::test_ac9_failed_settlement_is_soft`
- [ ] AC10 Given `RENT_REFERENCE=off`, When the job or the script runs, Then no request is made and the result is
  `{"skipped": 1}` — `test_rent_reference.py::test_ac10_off_makes_no_request`
- [ ] AC11 Given `NadlanFetcher` on an `httpx.MockTransport`, Then: it sends the fixed `User-Agent`; a
  `Set-Cookie` on the first response puts no `Cookie` on the second request; a 302 raises `RentSourceError` and
  its `Location` is never requested; a body of `MAX_BODY_BYTES + 1` raises; a body with a BOM parses; a 500 and
  an `httpx.ConnectTimeout` raise; two requests record the injected `sleep` calls `[0.25]` —
  `test_rent_reference.py::test_ac11_fetcher_is_polite`
- [ ] AC12 Given the worker settings, Then one cron job has `coroutine is worker.import_rent_reference_job`,
  `day == 5`, `hour == 3`, `minute == 10`, `unique is True` and `timeout_s == 1800` (arq 0.28's `cron()` takes
  `timeout` and stores it as `CronJob.timeout_s`) —
  `api/tests/test_worker.py::test_ac12_rent_import_cron_registered`
- [ ] AC13 Given no environment, Then `rent_reference` is `off` and `nadlan_rent_url` is the default; an
  `http://` address, a query or a fragment in `NADLAN_RENT_URL` is refused —
  `api/tests/test_config.py::test_ac13_rent_reference_settings`
- [ ] NF1 A full run makes at most one request per settlement and per listed neighbourhood, and logs counts
  only — asserted in `test_ac9_…` (request log of the fake fetcher) and `test_ac5_…` (caplog)

## Tests to write
Unit: the parser on trimmed fixtures in `api/tests/fixtures/rent_reference/`, each a few KB:
`settlement_5000.json` (Tel Aviv, trimmed to two neighbourhoods; AC2, AC4), `settlement_565.json` (Azor, which
lists no neighbourhood) and `neighborhood_65210029.json` (one of the two, with `null` quarters and a repeated
street added; AC3). Integration: the import against the test database with `FakeRentFetcher` serving the
fixtures; the migration round trip; `NadlanFetcher` on `httpx.MockTransport`. E2E: none.

`tests/conftest.py::db_engine` does not truncate the new tables and stays as it is: `test_rent_reference.py` has
its own fixture `rent_clean` (`TRUNCATE rent_prices, rent_areas`).

Three real files are left **untracked** in this spec's worktree under
`api/tests/fixtures/rent_reference/raw/` (`settlement_5000.json`, `settlement_565.json`,
`hood_5000_65210029.json`) for the coder to trim from. They are 10–120 KB each and must not be committed.

## Risks / open questions
- **The source is an undocumented layer of a government site.** Its shape or address can change without notice;
  the import then fails soft and the tables keep their last figures. A failed month is only a log line until
  Slice 12 gives an admin surface: log a follow-up.
- **Terms of use for automated reading are not confirmed** (Gilad was told in the plan of 2026-11-14 and approved
  official data as a source). The import stays `off` until production; reading the site's terms is a
  launch-readiness item (Slice 13): log a follow-up. Not a blocker for building.
- **How the source computes its figure is not documented.** The engine spec's backtest judges whether it is a
  good baseline; this spec only stores it.
- **EPSG:2039** must be in `spatial_ref_sys` of `postgis/postgis:16-3.4`; AC4 proves it.
- Decided: `streets` as an array on the neighbourhood row is enough for the later street-to-neighbourhood lookup
  (330 rows, a scan; a GIN index only if the engine needs one), and the 2 MB cap stays (16 times the largest
  file). Neighbourhood ids are unique across the 19 settlements (checked on the 330 files, 2026-11-14).
- Verification: round 1 rejected with 9 findings, all applied above by the orchestrator; second round waived
  (one verifier round).
- Review round 1 (security) added two rule-2 skips, both in code and tests: a settlement file listing more than
  500 neighbourhood ids, and a `version` that fails `visible_characters_only`; and the fetcher asks for and
  accepts only an uncompressed body (`Accept-Encoding: identity`), so the 2 MB cap cannot be bypassed by
  compression.

## Blast radius
Run on 2026-11-14 against `main`'s graph (`graphify affected`).
- `WorkerSettings` (`cron_jobs` gains a second job): the graph lists only `specs/archive/0000a-foundations-api.md`,
  but `api/tests/test_worker.py::test_ac13_worker_sweeps_every_10_seconds` unpacks `(job,) =
  worker.WorkerSettings.cron_jobs` and **breaks** with two jobs: in Scope. `test_nf3_worker_logs_no_address`
  calls `geocode_listings` directly: untouched.
- `Settings` / `get_settings` (two new fields with defaults): every caller (`create_app`, `get_redis`, `get_geocoder`,
  `get_photo_store`, `get_email_sender`, `get_hub`, `_code_hmac`, `photos.small_url/large_url`, `worker._sweep`,
  `scripts/export_openapi.py`, `tests/conftest.py::client`) and `tests/test_config.py`'s tests read other fields only;
  new fields have defaults and no cross-field rule, so all stay untouched. New test in `test_config.py` (AC13).
- `Base` / `app/models/__init__.py` (two new models registered): `alembic/env.py` (`target_metadata`) and
  `tests/test_migrations.py` (every `command.check`, incl. `test_ac4_autogenerate_sees_no_diff_with_postgis_extensions`)
  now expect the two tables: covered by registering the models and by migration `0019`. Other models, services and
  `scripts/seed_demo.py` untouched.
- `tests/conftest.py::db_engine` TRUNCATE list: not widened; the new tests clean their own tables (`rent_clean`).

## Digest (filled by orchestrator after verification)
    Spec 0014a — homie keeps the official rent figures for Gush Dan in its own database   (verified, one part)
    What a user can do after this: nothing new on screen; the rent estimate that comes later gets a baseline
      for 19 cities and 330 neighbourhoods on its first day.
    Decisions I need from you: none.
    KPIs this slice moves: none yet; it is groundwork for the estimate (Slice 14).
    Acceptance targets: at most one request per file (about 350 a month), at least 0.25 s apart;
      logs carry counts only; off by default, so dev, tests and CI never call the government site.
    Risks: the source is an undocumented layer of nadlan.gov.il and its terms of use are not confirmed
      — the import fails soft, keeps the last figures, and stays off until production; reading the terms is
      logged as a launch-readiness follow-up.
    Reviewers: code, security   Estimated: 1 coder run (Opus/high), 1 review round
    Links: specs/0014a-rent-reference-data.md · PRODUCT.md "Rent price estimate" · no artboard (no screen)

Built 2026-11-14 (merged shape; PR open, not merged — the orchestrator merges with `make merge PR=N`):

    Spec 0014a — homie keeps the official rent figures for Gush Dan in its own database   IN REVIEW (PR open, ready-to-merge)
    Shipped: two tables for the government's rent figures (19 cities and their neighbourhoods, by room count,
      per quarter) and a monthly worker import that is off by default. Nothing changes on screen.
    Demo: 1. `make dev`, then `make rent-import` prints `{'skipped': 1}` (the import is off)  2. production
      sets `RENT_REFERENCE=nadlan` (Slice 13) and the same command fills `rent_areas` and `rent_prices`
      3. there is no screen yet: the estimate engine reads these rows in a later spec.
    Tests: +3 unit, +30 integration, +0 e2e (pytest 615 green, vitest 685 green)   CI: on the PR
    Findings: 0 blockers; 2 majors fixed (a compressed response could get past the 2 MB limit; a source file
      could list unlimited neighbourhoods and keep the worker requesting for hours, now capped at 500);
      3 one-line minors fixed; 0 waived; 7 follow-ups logged (5 review minors, 2 from this spec's Risks).
    Changed in PRODUCT.md: nothing.
    Next spec I propose: 0014b — listing price signals (verified, building in parallel; its migration 0020
      follows this one).
