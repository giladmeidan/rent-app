---
id: 0021c
title: A lister anywhere in Israel sees the rent estimate at the price step, not only in Gush Dan
status: in-review
depends_on: [0021a1]
reviewers: [code, qa]   # qa: GET /rent-estimate answers for new cities (API behaviour). No security: parsing, fetcher hardening and config are unchanged (0014a); the only new input is the committed CSV
estimate: 1 coder run   # coder Opus/high (data import; Speed rule 6)
---

## Goal
The rent estimate (PRODUCT.md "Rent price estimate", specs `0014a`, `0014c`, `0014d`) covers every settlement
nadlan.gov.il publishes, now that homie is national (PRODUCT.md "Launch area", 2026-11-17).

## Scope
**In**

1. **Which settlements are imported** (`api/app/services/rent_reference.py`). `RENT_SETTLEMENT_CODES` is deleted.
   A new `settlement_codes(db: Session) -> list[int]` returns the `source_code` of every `areas` row with
   `kind = 'settlement'` and `is_active` (from `0021a`), ascending. `import_rent_reference(db, fetcher)` keeps its
   signature and calls it (tests monkeypatch `rent_reference.settlement_codes`, as they monkeypatch the constant
   today). nadlan's `settlementID` is the CBS settlement code, so `areas.source_code` is the path id as is.
   If `0021a`'s migration `0031_national_areas` imports `RENT_SETTLEMENT_CODES` (for its 19-settlement profile
   rewrite), inline the same 19-code tuple in the migration: a migration never depends on an app constant.

2. **Missing settlements.** A settlement file answering 404 is counted in a new `missing` count (not
   `files_failed`) and skipped with no WARNING line (most small settlements have no file; a WARNING per settlement
   would flood the log). `NadlanFetcher` raises `RentFileMissing(RentSourceError)` on a 404 so the import can tell
   it apart; every other non-200 stays a plain `RentSourceError`. The test `FakeRentFetcher` raises
   `RentFileMissing` for an unknown path.

3. **Resume** (a run is interrupted by a deploy or a worker restart, and the national run is long; see 5).
   - The run's version is the `version` of the first settlement file parsed in this run; until one parses, nothing
     is skipped.
   - Once the run's version is known, a settlement whose `rent_areas` settlement row already has
     `source_version` = the run's version is skipped with **no request** (its neighbourhoods too), counted in a
     new `skipped` count.
   - The first parsed settlement itself: when its stored row already has this version, its neighbourhoods are not
     fetched (counted `skipped`).
   - So that "stored at the current version" means "finished", a settlement's own row is now **stored after its
     neighbourhoods**: fetch and parse the settlement file (a failure still means none of its neighbourhoods is
     fetched, 0014a rule 6), fetch and store each neighbourhood, then store the settlement row in its own
     transaction. The **request order is unchanged** (settlement, then its neighbourhoods ascending). A
     neighbourhood that fails stays failed until the next source version (its old figures stay, rule 5).
   - The counts dict gains `missing` and `skipped` (still counts only in the INFO line; 0014a rule 10).

4. **Pacing** (nadlan's own crawl request, see "The source's limits" below). `NadlanFetcher` waits
   `NADLAN_INTERVAL_S = 5.0` between requests (was 0.25). `REQUEST_INTERVAL_S = 0.25` stays as it is, because
   `cbs_rent.py` imports it for the CBS fetches (≤ 6 requests to a different host). Everything else in 0014a
   rule 7 is unchanged.

5. **Schedule** (`api/app/worker.py`). Same cron slot (`day=5, hour=3, minute=10, unique=True`), `timeout`
   1800 → 28800 (8 h): a first full national run is ~1,300 settlement requests plus the big and mid-size cities'
   neighbourhoods, roughly 2,500–4,000 requests × ~5.3 s ≈ 4–6 h. Update the comment above the line with these
   numbers. A month in which the version did not change costs 1 request plus the missing settlements' 404s. An
   interrupted run resumes at the next run (the next month's cron, or `make rent-import` by hand).

6. **District of a settlement** (`api/app/services/rent_estimate.py`). **Decided (verifier): read from the CSV, no
   `areas.district` column, no migration.** `SETTLEMENT_DISTRICT` is deleted. `services/areas.py` gains
   `settlement_districts() -> dict[int, int]` (`functools.cache`; stdlib `csv`; the file
   `api/data/settlements.csv` from `0021a`, path relative to the package, e.g.
   `Path(__file__).resolve().parents[2] / "data" / "settlements.csv"`; `api/` is copied whole into the image by
   `infra/Dockerfile.api`). It maps each settlement code to its CBS district (1–7 = subdistrict code // 10, the
   rule 0014d used); a row whose district is empty or outside 1–7 is left out. If `0021a` already put a CSV row
   reader in `services/areas.py`, build on it instead of parsing twice. `_small_flat_ratio` uses
   `settlement_districts().get(code)`; `backtest_ratio` picks "every CBS city with a district in
   `settlement_districts()`" (was: in `SETTLEMENT_DISTRICT`) and reads its district from it.
   CBS Table 4.9 publishes districts 1–6 only: a Judea and Samaria settlement (district 7) that is not one of the
   18 CBS cities has no ratio, so its 1–2 room answer is `no_figures` (as for any settlement without a ratio
   today). Rationale: the district is static CBS data already committed with the app; a column would add a
   migration, a model field and an import step to hold the same file's column.

7. **City resolution** (`resolve_city` in `rent_estimate.py`; `normalise_place` and `CITY_ALIASES` live in
   `services/areas.py` after `0021a` and are imported from there). The query parameter stays the city **text**
   (the engine takes apartment facts, never an id; PRODUCT.md "Rent price estimate"); there is no "by id" path.
   Order, first hit wins:
   1. **Catalogue, exact:** an active `areas` settlement whose `name_he` equals the stripped text (one SQL query;
      the `0021b` wizard sends the picked settlement's `name_he`) → its `source_code`.
   2. **Text:** as today, a `rent_areas` settlement whose normalised name equals the normalised text; then an
      active `areas` settlement by normalised name → its `source_code`; then `CITY_ALIASES` → code.
   3. The code → the `rent_areas` settlement row with that `settlement_code` (indexed); none → `unknown_city`.
   The return value and the response are unchanged (`area_name` stays the `rent_areas` name).

8. **Aliases.** `CITY_ALIASES` (normalised alias → code) gains exactly these; the big cities not listed match by
   their own name: `"בש"` (ב״ש) → 9000 Be'er Sheva, `"י ם"` (י-ם) → 3000 and `"ים"` (י״ם) → 3000 Jerusalem,
   `"כס"` (כ״ס) → 6900 Kfar Saba, `"בב"` (ב״ב) → 6100 Bnei Brak. Existing entries stay.

9. **Tests that move with the code** (see Blast radius): `test_rent_reference.py` (monkeypatch
   `settlement_codes`; `test_ac5_…` second run now makes one request and writes nothing; `test_ac6_…` gives the
   revised file a new `version`, else the resume rule skips it; `test_ac9_…` NF1 part over a monkeypatched code
   list, with `missing` instead of `files_failed` for absent files; `test_ac11_…` sleeps `[5.0]`),
   `test_worker.py::test_ac12_…` (`timeout_s == 28800`), `test_rent_estimate.py::test_ac6_settlement_district_covers_launch_box`
   (replaced by AC3's regression check).

10. One line in `specs/FOLLOWUPS.md`: "0021c · after the first national import (`RENT_REFERENCE=nadlan make
    rent-import` in the main stack, 4–6 h), run `make rent-backtest` and change `HALF_WIDTH` / `WINDOW_QUARTERS` /
    `RATIO_HALF_WIDTH` only if it says so, with the run's numbers in the comment".

**Out**
- The backtest re-run itself (Scope 10): it needs a live national import of 4–6 h, longer than a coder run.
- Rooms in the market (still not estimated). Any new data source. A population threshold (not needed: the source
  asks only for a crawl delay). An `area_id` parameter on `GET /rent-estimate`.

**New dependencies:** none.

## The source's limits (checked by the verifier, 2026-11-17)
- `https://www.nadlan.gov.il/robots.txt`: one group for every crawler, the whole site allowed, `Crawl-delay: 5`.
  Hence Scope 4's 5 s. `https://data.nadlan.gov.il/robots.txt` answered 403 to a fetch from outside Israel.
- No published terms of use or rate limit was found (the site is a JS app run by the Survey of Israel; a search
  found no terms page). FOLLOWUPS 0014a (read the terms before `RENT_REFERENCE=nadlan` in production) still
  stands and now covers the national volume.
- Third-party scraper docs (unverified) say nadlan.gov.il answers only Israeli IPs; the 403 above fits. The
  production worker is planned in Fly Frankfurt (PRODUCT.md "Launch (Slice 13)"). The coder adds this to the
  existing FOLLOWUPS 0014a terms line: "check the import works from the production region before switching it on".

## Data
No schema change, no migration. The import reads `areas` (`0021a`) and the committed `settlements.csv`.

## API
| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | /rent-estimate | signed in, any role (unchanged, `current_user`) | unchanged (`city`, `street`, `rooms`) | unchanged | unchanged |

It now answers for any settlement with figures.

## UI
None. The `0021b` wizard must keep passing the picked settlement's `name_he` as the hint's `city` (that is
`0021b`'s scope; this spec relies on it only for Scope 7.1's fast path, and the text path still resolves it).

## Acceptance criteria
- [ ] AC1 Given active `areas` settlements Haifa 4000, Be'er Sheva 9000 and one with no file, plus an inactive one
  and a neighbourhood row, When the import runs with a fixture fetcher (Haifa and Be'er Sheva files and one
  neighbourhood each, copied from the trimmed Tel Aviv fixtures with ids and names changed; no network), Then both
  settlements and their neighbourhoods are stored, the one with no file counts `missing == 1` and
  `files_failed == 0`, and the inactive settlement and the neighbourhood row are never requested —
  `api/tests/test_rent_reference.py::test_ac1_national_import`
- [ ] AC2 Given a run interrupted after the first settlement's neighbourhoods (the fixture fetcher raises a test-only
  `BaseException` subclass after N requests, which the soft `except Exception` does not swallow, as a worker kill
  would), When the import runs again with the same version, Then finished
  settlements are not requested again, the unfinished one is fetched with its neighbourhoods, and its settlement
  row is written after its neighbourhoods; a third run makes exactly one request —
  `test_rent_reference.py::test_ac2_resume`
- [ ] AC3 Given a settlement outside Gush Dan that is not a CBS city (e.g. Nahariya 9100, North District 2 in the
  CSV) with 3-room figures and CBS district-2 rows, When 2 rooms are estimated, Then `small_flat_ratio ==
  "district"` and the district-2 ratio is used; and `settlement_districts()` holds every row of the CSV with a
  district and gives the 19 old launch codes the districts the deleted `SETTLEMENT_DISTRICT` gave (the old dict
  inlined in the test) — `test_rent_estimate.py::test_ac3_district_outside_gush_dan`
- [ ] AC4 "ב״ש" resolves to 9000, "י-ם" and "י״ם" to 3000, "כ״ס" to 6900, "ב״ב" to 6100; a name spelt as in the
  `areas` catalogue but differently in `rent_areas` resolves through `source_code` —
  `test_rent_estimate.py::test_ac4_aliases` (parametrised)
- [ ] AC5 `backtest_ratio` scores every CBS city whose code has a district in `settlement_districts()`, not only
  the 8 launch-box cities — `test_rent_estimate.py::test_ac5_ratio_backtest_national`
- [ ] AC6 `NadlanFetcher` sleeps `NADLAN_INTERVAL_S` (5.0) between requests and raises `RentFileMissing` on a 404;
  the worker's rent cron has `timeout_s == 28800` — `test_rent_reference.py::test_ac11_fetcher_is_polite`
  (updated) and `api/tests/test_worker.py::test_ac12_rent_import_cron_registered` (updated)
- [ ] NF1 `GET /rent-estimate` p95 under 150 ms locally with ~1,300 `areas` settlements and a matching
  `rent_areas`, for a catalogue name (7.1) and for an alias (7.2): measured, numbers in the PR

## Tests to write
Unit: aliases, `settlement_districts()`, fetcher 404 and interval. Integration: import with the fixture fetcher
(national, missing, resume), district estimate outside Gush Dan, ratio backtest over all CBS cities. No E2E.

## Risks / open questions
- Decided (verifier): district read from the CSV (Scope 6); pacing 5 s from robots.txt (Scope 4); backtest after
  the first national import, as a follow-up (Scope 10). No product question is left for the coder.
- National figures may be noisier; the existing "no number when confidence is low" rule already covers it.
- A 4–6 h run holds one worker thread (arq cannot cancel `to_thread`; FOLLOWUPS 0014a fetch-deadline line still
  applies). The geocode sweep and other crons run on the event loop and are unaffected.
- `0021a`'s `import_areas.py` reuses `get_rent_fetcher()`, so its neighbourhood fetch also slows to 5 s a
  request (~1,000 files for the 18 big cities ≈ 1.5 h by hand, once). Correct, just slower; say so in the PR.

## Blast radius
Run on 2026-11-17 against `main`'s graph (`graphify affected`); the graph has no nodes for module constants, so
`RENT_SETTLEMENT_CODES`, `SETTLEMENT_DISTRICT` and `CITY_ALIASES` were also grepped.
- `RENT_SETTLEMENT_CODES` (deleted): `rent_reference.import_rent_reference`; `tests/test_rent_reference.py`
  (import, `two_settlements` fixture, `test_ac8_…` monkeypatch, `test_ac9_…` NF1 part and `len == 19`);
  `tests/test_rent_estimate.py::test_ac6_settlement_district_covers_launch_box`; possibly `0021a`'s migration
  (inline it, Scope 1). All in Scope.
- `SETTLEMENT_DISTRICT` (deleted): `_small_flat_ratio`, `backtest_ratio` (→ `scripts/rent_backtest.py::_ratio`,
  output only), `test_ac6_settlement_district_covers_launch_box`. In Scope. `test_ac9_ratio_backtest` passes
  launch-box codes, all in the CSV: expected to pass unchanged.
- `CITY_ALIASES` / `normalise_place` (moved by `0021a`, extended here): `resolve_city`, `_neighbourhood`,
  `test_ac4_city_resolution` (existing aliases stay, so it passes). `0021a`'s migration resolves listing cities
  with the alias table at upgrade time; the new aliases only widen it.
- `resolve_city` → `estimate_rent` → `routers/rent_estimate.get_rent_estimate`; tests `test_ac1`–`test_ac8` of
  `test_rent_estimate.py` call it through `estimate_rent` with Tel Aviv data and no `areas` rows for the text
  path: step 7.1 finds nothing and 7.2 behaves as today, so they pass unchanged (`test_ac4_city_resolution_unknown_and_order`
  still gets `unknown_city` for Haifa, which has no `rent_areas` row there). `RentEstimateParams.city` keeps the
  `City` type from `schemas/listing.py`: if `0021a` removed it with `ListingIn.city`, keep or move the alias.
- `import_rent_reference` (codes, resume, store order, counts): `run_rent_import` → `worker.import_rent_reference_job`,
  `scripts/import_rent_reference.py::main` (prints counts, unchanged); tests `test_ac2`–`test_ac9` of
  `test_rent_reference.py`: `test_ac5`, `test_ac6`, `test_ac9` change as in Scope 9; `test_ac2`/`ac3`/`ac4`/`ac7`/`ac8`
  only swap the monkeypatch. `test_analytics.py`, `test_cbs_rent.py`, `test_observability.py` import
  `run_rent_import` only to stub it: untouched.
- `NadlanFetcher` / `get_rent_fetcher` (interval, 404 class): `run_rent_import`, `test_ac10_off_makes_no_request`
  (no fetcher built, untouched), `test_ac11_fetcher_is_polite` (in Scope), `0021a`'s `import_areas.py` (slower,
  Risks). `cbs_rent.py` / `test_cbs_rent.py` use `REQUEST_INTERVAL_S`, which stays 0.25: untouched.
- `WorkerSettings.cron_jobs` (timeout): `test_worker.py::test_ac12_rent_import_cron_registered` in Scope;
  `test_ac13_worker_sweeps_every_10_seconds` picks its job by coroutine: untouched.
- `_neighbourhood`, `figure_keys`, `window`, the response schema: not changed.

## Digest (filled by orchestrator after verification)
