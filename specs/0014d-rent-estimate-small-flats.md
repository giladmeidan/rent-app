---
id: 0014d
title: An owner pricing a 1, 1.5 or 2 room apartment in the listing wizard sees the average rent for 1–2 rooms in its neighbourhood (or city), from nadlan's 3-room figure scaled by the CBS small-flat ratio, always at medium confidence
status: draft
depends_on: [0014c]   # PR #91: the engine this extends
reviewers: [code, security, qa]   # security: a new outbound fetch + parsing an untrusted xlsx with a new dependency (as 0014a); qa: engine + hint change. No ux: one more copy line in the existing hint slot. No perf: one more small query
estimate: 1 coder run   # coder Opus/high (migration + data import + the price the owner sees; Speed rule 6)
---

## Goal
After this ships, an owner pricing an **apartment of 1, 1.5 or 2 rooms** in the listing wizard (new or edit)
sees under the price the average rent for 1–2 rooms in the apartment's neighbourhood (or city), as a range at
medium confidence, credited to nadlan.gov.il and the CBS (הלמ״ס). Today v1 (spec 0014c) shows nothing under
2.5 rooms, which leaves out a large share of Tel Aviv. PRODUCT.md "Rent price estimate".

## Decisions this spec builds on (Gilad, 2026-11-14, in chat)
1. **Ratio on nadlan.** The small-flat figure = v1's 3-room baseline (neighbourhood or city, exactly as v1
   finds it) × the CBS ratio *average rent 1–2 rooms / average rent 2.5–3 rooms*. CBS levels are not shown
   directly: CBS runs 2–15% below nadlan (it averages all running tenancies, nadlan new contracts), the ratio
   cancels that.
2. **District ratio for the cities CBS does not publish.** The 8 big cities in the launch box (Tel Aviv 5000,
   Ramat Gan 8600, Holon 6600, Bat Yam 6200, Petah Tikva 7900, Rishon LeZion 8300, Bnei Brak 6100, Herzliya
   6400) use their own CBS ratio; every other settlement uses its CBS district's ratio (Tel Aviv District 5 or
   Center District 4, `SETTLEMENT_DISTRICT` below).
3. **Rooms 1, 1.5 and 2** all get the small-flat estimate (the CBS group is labelled "1-2").
4. Always **medium** confidence.

## The source (measured by the orchestrator, 2026-11-14)
CBS Price Statistics Monthly (ירחון לסטטיסטיקה של מחירים), **Table 4.9** "Average Monthly Prices of Rent (NIS),
by Residential District, Big Cities and Size Group (Rooms)" (לוח 4.9 "מחירים ממוצעים חודשיים של שכר דירה חופשי").
No API; one Excel file per monthly bulletin:

    https://www.cbs.gov.il/he/publications/Madad/DocLib/{YYYY}/price{MM}a/a4_9_e.xlsx

- The table is **refreshed in bulletins 1, 4, 7 and 10** (other months repeat it); each file holds about six
  quarters plus annual averages. Lag about 6–7 weeks (Q2 2026 came in bulletin 7/2026, mid-August). Quarters
  get revised (Tel Aviv Q1 2026: 7,351 in 4/2026, 7,375.2 in 7/2026).
- A missing file answers **HTTP 200 with a 2,056-byte HTML error page**, not 404.
- `.xlsx` exists from **bulletin 7/2025**; earlier bulletins are `.xls` (2021/01–2025/04, probed), out of scope.
  So 7/2025, 10/2025, 1/2026, 4/2026, 7/2026 give about ten quarters of history (from about 2024-Q1).
- Layout of the one sheet (`A.4.9`, ~146 rows, checked on 7/2026):
  - `A1`: `"Last produced for Price Statistics Monthly No. 7/2026, Central Bureau of Statistics"`.
  - Row 4: years (`2024`, `2025`, `2026`) in merged cells (a value only at the first column of its span).
  - Row 5: per column pair `X-XII`, `Annual\naverage`, `I-III`, `IV-VI`, `VII-IX`, …
  - Row 6: `Average\nprice ` / `Sampling\nerror(s)` alternating; price in the first column of each pair.
  - Then blocks: a header row whose column A is `"<name> - <code>"` (`"Tel Aviv - 5000"`, `"Tel Aviv District -
    5"`, `"center District - 4"`, `"Herzlliya - 6400"`: names are misspelt, **match on the code only**), followed
    by rows `1-2`, `2.5-3`, `3.5-4`, `4.5 +` with price and error per quarter. A cell not published is `-`.
  - District headers come under a `Residential Districts` row, before the cities.
- Sample (7/2026): Tel Aviv 1-2 = 5,486.7 (±71.7), 2.5-3 = 7,092.6 (Q2 2026). Ratios 1-2 / 2.5-3 in Q2 2026:
  0.76–0.90 across the 8 cities (Tel Aviv 0.77, Bat Yam 0.90).
- **Licence:** CBS Open License 2.1 (https://www.cbs.gov.il/en/Pages/Enduser-license.aspx): commercial use and
  derived works allowed, **attribution required**, no implied endorsement. The full text is read before launch
  (FOLLOWUPS, Slice 13), as nadlan's terms are.

## Scope
**In:**
- Migration `0021_cbs_rent_ratios` (table below), model `api/app/models/cbs_rent.py` (`CbsRentPrice`).
- `api/app/services/cbs_rent.py`: `bulletin_url(year, month)`, `parse_table(content: bytes) -> CbsTable`
  (pure), `fetch_latest(client) -> CbsTable | None`, `store(db, table) -> dict[str, int]`.
- Worker: `import_cbs_rent_job`, monthly cron on day 16, 03:40, gated by the new setting `CBS_RENT`
  (`off` default | `cbs`); `.env.example` gains it with a comment like `RENT_REFERENCE`'s.
- `api/scripts/import_cbs_rent.py` + `make cbs-rent-import` (latest bulletin) and
  `make cbs-rent-history` (the five xlsx bulletins from 7/2025, oldest first, so revisions overwrite);
  both in `.PHONY` with `##` lines.
- Engine (`api/app/services/rent_estimate.py`): the small-flat path, the ratio backtest, `make rent-backtest`
  prints both backtests. Schema `RentEstimateRange` gains `small_flat_ratio`.
- Web: the hint in `DetailsStep.tsx` picks the small-flat copy; `he.json` keys; `make client`; vitest; one
  `make screens` state.
- `specs/FOLLOWUPS.md`: close the 0014c line "CBS small-flat data spec", add the lines in Risks.

**Out:**
- `.xls` history before 7/2025 (would need `xlrd`); CBS 3.5-4 and 4.5+ groups (not used).
- Showing CBS levels themselves; a per-neighbourhood small-flat ratio (CBS has none).
- Rooms below 1 (the `Rooms` type already rejects them; `rooms_not_covered` stays in the API for safety).
- Adjustments, comparables, the open estimate tab: unchanged from 0014c.

**New dependencies:** `openpyxl` (api runtime; the standard pure-Python xlsx reader; parse with
`read_only=True, data_only=True`).

## Data
`cbs_rent_prices` (migration `0021_cbs_rent_ratios`, downgrade drops it):

| Column | Type | Notes |
| --- | --- | --- |
| `geo_code` | integer NOT NULL | CBS code from the header: settlement code (5000) or district number (5) |
| `geo_kind` | text NOT NULL | `ck_cbs_rent_geo_kind`: `'city'` or `'district'` (a header under `Residential Districts` is a district) |
| `room_group` | text NOT NULL | `ck_cbs_rent_room_group`: `'1-2'` or `'2.5-3'` (only these two are stored) |
| `period` | date NOT NULL | first day of the quarter's last month, as `rent_prices.period` (`IV-VI 2026` → 2026-06-01); CHECK as `rent_prices` |
| `price_ils` | numeric(8,1) NOT NULL | CHECK 500–100000 |
| `sampling_error` | numeric(8,2) NULL | |
| `bulletin` | text NOT NULL | `"7/2026"`, the file it last came from |
| `imported_at` | timestamptz NOT NULL default now() | |

Primary key (`geo_kind`, `geo_code`, `room_group`, `period`). Upsert: a newer or equal bulletin overwrites a
row (revisions); an older bulletin never overwrites a newer one (compare (year, number), not strings).
Empty in dev, tests and CI unless the import runs; the engine then answers `no_figures` for 1–2 rooms.

## Import rules (`parse_table`, `fetch_latest`, `store`)
1. **Fetch.** `httpx` with the 0014a client settings (timeout, User-Agent, no redirects to other hosts). For
   the current month and up to 5 months back, newest first, GET `bulletin_url`; the first answer that is
   status 200, under 5 MB, and starts with the zip magic `PK\x03\x04` is the file. None: log and return `None`
   (the job returns `{"skipped": 1}`). One file per run; no request at all with `CBS_RENT=off`.
2. **Bulletin.** `A1` must match `No\. (\d{1,2})/(\d{4})`; else the whole file is rejected (`ValueError`, the job
   logs and stores nothing). If the stored max bulletin is the same or newer, `store` writes nothing.
3. **Columns.** Year carried forward across row 4's merged cells; row 5 `I-III`/`IV-VI`/`VII-IX`/`X-XII` → month
   3/6/9/12; `Annual average` columns skipped; the price is that column, the error the next. A quarter label
   with no year, or a year outside 2015 ≤ y ≤ current year: the file is rejected.
4. **Blocks.** A column-A value matching `^(.*\S)\s*-\s*(\d{1,5})\s*$` opens a block (kind = `district` after a
   `Residential Districts` row and before the first city, else `city`; the rule the verifier fixes against the
   real file). Inside a block, rows whose A (whitespace removed) is `1-2` or `2.5-3` are read; others skipped.
5. **Cells.** A price is stored only if it is an int or float within 500–100000; `-`, empty, text or out of
   range skips that cell alone. Error: float ≥ 0 or `NULL`.
6. **Limits.** Openpyxl `read_only`; at most 1,000 rows and 60 columns are read; at most 2,000 rows stored per
   file. A file that parses to no `1-2` row for code 5000 is rejected (layout changed).
7. **Settlements** stored: every block (not only Gush Dan), they are few and harmless.

## The engine change (`api/app/services/rent_estimate.py`)
New constants (backtest-set ones commented with the run, policy ones "policy, spec 0014d"):

    SMALL_ROOMS = {Decimal("1"), Decimal("1.5"), Decimal("2")}   # policy (Gilad 2026-11-14)
    RATIO_WINDOW_QUARTERS = 4                 # backtest: newest CBS quarters averaged per geography
    RATIO_MIN_QUARTERS = min(2, RATIO_WINDOW_QUARTERS)   # policy
    RATIO_HALF_WIDTH = {"city": 0.03, "district": 0.03}  # backtest: ratio p80 error, rounded up
    SETTLEMENT_DISTRICT: dict[int, int]       # every settlement code in the launch box → CBS district 5 or 4;
                                              # the verifier fills it from rent_areas codes + CBS's settlement list

**Rooms (step 4 of 0014c) changes:** rooms in `SMALL_ROOMS` → keys `[3]` with the **small-flat flag**; any
other rooms < 2.5 → `rooms_not_covered`. The order of evaluation is unchanged; the ratio is one more step
after step 5 (figures), before step 6 (width):

**5b. Ratio** (small flats only). Geography: `("city", code)` if `cbs_rent_prices` holds that city's figures,
else `("district", SETTLEMENT_DISTRICT[code])`; a code missing from the map: `no_figures`. **One query** reads
the newest `RATIO_WINDOW_QUARTERS` periods of that geography's two groups (city and district fetched together,
city preferred when it has enough). Per period with both groups: `r = price(1-2) / price(2.5-3)`; at least
`RATIO_MIN_QUARTERS` of them, else try the district, else `no_figures`. The ratio = mean of those `r`.
Baseline = v1 baseline × ratio.

**6. Range** for small flats: `half = sqrt(HALF_WIDTH[level]² + RATIO_HALF_WIDTH[geo_kind]²)`; `too_uncertain`
above `MAX_HALF_WIDTH`; rounding as v1; `confidence = "medium"` always.

**Answer:** `figure_rooms == [1, 2]` (the group the number describes; the copy renders it "1–2"),
`small_flat_ratio: Literal["city", "district"] | None` (None on every 2.5+ answer), `level`, `area_name`,
`quarters` (nadlan's, as v1) and `latest_period` (nadlan's) unchanged in meaning.

**Ratio backtest** `backtest_ratio(figures: Sequence[CbsFigure], *, windows=range(1, 7), targets=4)`, pure,
next to `backtest`: for each geography with both groups, each of the newest `targets` periods `T`, predict
`r(T)` as the mean of `r` over the `W` periods strictly before `T` (at least `min(2, W)`); relative error;
rows (`window`, `geo_kind`, `n`, `median`, `p80`) as `BacktestRow`, nearest-rank p80, the same mean helper.
`make rent-backtest` prints both tables, then suggests `RATIO_WINDOW_QUARTERS` (smallest city p80, tie → smaller)
and `RATIO_HALF_WIDTH` per kind (p80 rounded up to a whole percent). Empty table: `no cbs figures`, exit 0.

**One real run, by the coder:** in the spec's own stack `CBS_RENT=cbs make cbs-rent-history` (5 requests),
then `make rent-backtest`; set the constants from the suggestion with a comment naming the run, paste the
output into the PR body, report the values. If `sqrt(0.08² + city ratio p80²)` is above `MAX_HALF_WIDTH`,
stop and report (Speed rule 9: the feature would show nothing). The nadlan import is not needed for this run.

## API
`GET /rent-estimate` unchanged in path, auth (signed in), params and errors. `RentEstimateRange` gains
`small_flat_ratio: Literal["city", "district"] | None`. `make client`.

## UI
Same screen and states as 0014c (the hint under the price in `DetailsStep.tsx`; no new component, no artboard).
When `estimate.small_flat_ratio` is set, the hint uses new plural keys (`count: quarters`):
- `listings.estimate.hintSmall_one`: `"שכר דירה ממוצע ל־{{rooms}} חדרים ב{{area}}: {{range}} · {{confidence}} · לפי nadlan.gov.il והלמ״ס, רבעון אחד: {{period}}"`
- `listings.estimate.hintSmall_other`: `"שכר דירה ממוצע ל־{{rooms}} חדרים ב{{area}}: {{range}} · {{confidence}} · לפי nadlan.gov.il והלמ״ס, {{count}} רבעונים עד {{period}}"`

`{{rooms}}` is `figure_rooms` through the existing `roomsPair` ("1–2"). Everything else as 0014c. RTL and
logical properties unchanged.

## Acceptance criteria
- [ ] AC1 Given the 7/2026 file (fixture, trimmed copy of the real one kept under `api/tests/fixtures/`), When
  `parse_table` runs, Then it returns bulletin (7, 2026), Tel Aviv 5000 city `1-2` IV-VI 2026 = 5486.7 and
  `2.5-3` = 7092.6, Tel Aviv District 5 and Center District 4 as `district`, Herzliya 6400 as `city`, no
  `3.5-4` rows, no annual averages — `api/tests/test_cbs_rent.py::test_ac1_parse_real_file`
- [ ] AC2 Given each bad input: a 2,056-byte HTML page, a non-zip, A1 without `No. N/YYYY`, a quarter with no
  year, a file with no Tel Aviv `1-2` row, Then it is rejected and nothing is stored; given `-`, text, 99 or
  1,000,000 in one cell, Then only that cell is skipped — `test_cbs_rent.py::test_ac2_bad_files_and_cells`
  (parametrised; xlsx built in the test with openpyxl)
- [ ] AC3 Given stored rows from bulletin 7/2026, When 4/2026 is stored, Then nothing changes; When 10/2026 is
  stored with a revised value, Then it overwrites and `bulletin` is `"10/2026"`; 10/2026 is newer than 7/2026
  and 1/2027 newer than 10/2026 — `test_cbs_rent.py::test_ac3_upsert_by_bulletin`
- [ ] AC4 Given `CBS_RENT=off`, Then the job makes no request and returns `{"skipped": 1}`; given `cbs` and a
  mocked transport where the newest month answers the 2,056-byte page and the month before the real file,
  Then that file is stored; given all six months bad, Then `{"skipped": 1}` and no error —
  `test_cbs_rent.py::test_ac4_job_fetch` (httpx `MockTransport`)
- [ ] AC5 Given 0014c's `rent_figures` fixture plus CBS rows for city 5000 (ratio 0.8 in each of 4 periods),
  When an owner asks for "תל אביב", "תירוש", rooms 1, 1.5 and 2, Then each answer is neighbourhood level,
  baseline = 3-room baseline × 0.8, `figure_rooms == [1, 2]`, `small_flat_ratio == "city"`, `medium`, and
  `half = sqrt(h² + r²)` with the patched constants — `api/tests/test_rent_estimate.py::test_ac5_small_flat_city_ratio`
- [ ] AC6 Given a settlement with nadlan figures and no CBS city rows but district rows for its
  `SETTLEMENT_DISTRICT` value, Then `small_flat_ratio == "district"`; given city CBS rows with only one period
  (thin), Then it falls back to the district; given no CBS rows, Then `no_figures`; given rooms 2 and a city
  outside the box, Then `unknown_city` (order unchanged) —
  `test_rent_estimate.py::test_ac6_small_flat_fallbacks` (parametrised)
- [ ] AC7 0014c's tests updated, not weakened: rooms 1 and 2 no longer give `rooms_not_covered` (the AC4/AC5
  cases of 0014c move to AC5/AC6 here); 2.5 and up answer exactly as before with `small_flat_ratio is None` —
  existing `test_ac4_…`, `test_ac5_…` in `test_rent_estimate.py`
- [ ] AC8 Given `RATIO_HALF_WIDTH["district"]` patched so the combined half passes `MAX_HALF_WIDTH`, Then
  `too_uncertain` for a district answer — `test_rent_estimate.py::test_ac8_small_flat_too_wide`
- [ ] AC9 Given synthetic CBS figures with a constant ratio for one city and a known step for another,
  When `backtest_ratio` runs, Then errors are 0 and exactly the step; too few prior periods → no sample; the
  script prints `no cbs figures` on an empty table — `test_rent_estimate.py::test_ac9_ratio_backtest`
- [ ] AC10 Given `GET /rent-estimate` with rooms 2 and CBS + nadlan figures, Then 200 with `small_flat_ratio`
  set; signed out 401 — `api/tests/test_rent_estimate_api.py::test_ac10_small_flat_api`
- [ ] AC11 Given an answer with `small_flat_ratio` set, Then the hint renders the `hintSmall` copy (one and
  several quarters), "1–2" rooms and both sources; a 2.5+ answer still renders 0014c's copy —
  `web/src/features/listings/__tests__/DetailsStep.test.tsx::ac11 small flat hint`
- [ ] AC12 `make screens`: a new state `{ spec: '0014d', name: '01-details-estimate-small' }` (in
  `web/screens/0014d/`) shows the small-flat hint; every existing state still passes —
  `web/e2e/screens/listings.screens.ts`
- [ ] AC13 Migration 0021 upgrades and downgrades cleanly — `api/tests/test_migrations.py` (the existing
  round-trip test covers it; add the table to whatever list it checks)
- [ ] NF1 A small-flat estimate is at most five queries (0014c's four + the ratio) — the 0014c query counter in
  AC5 and AC6's district case

## Tests to write
pytest on the test DB: `test_cbs_rent.py` (parser on the real trimmed fixture and on xlsx built in tests, upsert,
the job with `httpx.MockTransport`); `test_rent_estimate.py` (a `cbs_figures` fixture next to `rent_figures`,
truncating `cbs_rent_prices`; all constants monkeypatched as 0014c does); the API test. Vitest:
`DetailsStep.test.tsx` routes for the small-flat answer. E2E (CI): none new (tables empty in CI).

## Risks / open questions
- **Method bias.** The ratio comes from CBS's stock of running tenancies and is applied to nadlan's new-contract
  3-room level; whether small flats' premium differs between the two cannot be checked until homie has listings.
  The ratio backtest measures only the ratio's stability. FOLLOWUPS: re-check with homie data.
- **"1-2" may not include studios** (older labels said "1.5-2"); Gilad chose to cover rooms 1 too.
- **No API, the file name changes monthly, and CBS renamed this table before (4.8 → 4.9) and its groups (4.5–6 →
  4.5+ in 2026).** The parser rejects a changed layout rather than storing wrong rows; a rejected file is a log
  line, and the estimate keeps the last good figures.
- **Licence:** attribution is required; the hint credits "הלמ״ס". Reading the full licence text (and its clause
  on derived arrangements) joins the Slice 13 nadlan terms item. `CBS_RENT` stays `off` in production until then.
- FOLLOWUPS lines to add: (1) read the CBS Open License in full before `CBS_RENT=cbs` in production; (2) check
  the small-flat ratio against homie's own 1–2 room listings once they exist; (3) `.xls` history before 7/2025
  only if a longer backtest is wanted.

## Blast radius
(filled by the spec-verifier with `graphify affected` on `estimate_rent`, `RentEstimateRange`, the rooms-to-keys
helper, `worker` cron list, `DetailsStep`, `listings.screens.ts`.)

## Digest (filled by orchestrator after verification)
