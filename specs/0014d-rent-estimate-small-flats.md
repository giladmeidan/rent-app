---
id: 0014d
title: An owner pricing a 1, 1.5 or 2 room apartment in the listing wizard sees the average rent for 1–2 rooms in its neighbourhood (or city), from nadlan's 3-room figure scaled by the CBS small-flat ratio, always at medium confidence
status: in-review
depends_on: [0014c]   # done (PR #91 merged): the engine this extends
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
  - Row 4: years (`2024`, `2025`, `2026`), **not reliably at the first column of the year**: in 7/2026 `2025`
    sits at `H4` (IV-VI) while `F` is I-III 2025 and `B4:E4` (2024) is the only merged year; in 1/2026 and
    4/2026 each year sits on its I-III column. Carrying row 4 forward would label I-III 2025 as 2024 in
    7/2026 (checked by the verifier on bulletins 1, 4, 6, 7 and 8/2026), so years come from the quarter
    sequence (rule 3).
  - Row 5: per column pair `X-XII`, `Annual\naverage`, `I-III`, `IV-VI`, `VII-IX`, … (19 columns in 7/2026, 21 in
    1/2026; quarters always consecutive left to right, annual averages between years).
  - Row 6: `Average\nprice ` / `Sampling\nerror(s)` alternating; price in the first column of each pair.
  - Row 8 `Total` (no code) with its own `1-2` … rows; row 13 `Residential Districts`, then six district blocks
    (`Jerusalem District - 1` … `South District - 6`); row 44 `Big cities`, then 18 city blocks (`Ashdod - 70`
    … `Tel Aviv - 5000`); then footnotes `(1)` … `(6)` in column A.
  - A block is a header row whose column A is `"<name> - <code>"` (`"Tel Aviv - 5000"`, `"Tel Aviv District -
    5"`, `"center District - 4"`, `"Herzlliya - 6400"`: names are misspelt, **match on the code only**; three
    headers have no space after the dash: `"Ashkelon -7100"`, `"Holon -6600"`, `"Kfar Saba -6900"`), followed
    by rows `1-2`, `2.5-3`, `3.5-4`, `4.5 +` with price and error per quarter. A cell not published is `-`.
    The room rows `1-2` and `2.5-3` also look like `<name> - <code>`, so they are tested first (rule 4).
  - All 8 launch-box cities are city blocks with their 0014a settlement codes (5000, 8600, 6100, 6600, 6200,
    7900, 8300, 6400). File: 25 zip entries, about 190 KB uncompressed.
- Sample (7/2026): Tel Aviv 1-2 = 5,486.7 (±71.7), 2.5-3 = 7,092.6 (Q2 2026). Ratios 1-2 / 2.5-3 in Q2 2026:
  0.76–0.90 across the 8 cities (Tel Aviv 0.77, Bat Yam 0.90).
- **Licence:** CBS Open License 2.1 (https://www.cbs.gov.il/en/Pages/Enduser-license.aspx): commercial use and
  derived works allowed, **attribution required**, no implied endorsement. The full text is read before launch
  (FOLLOWUPS, Slice 13), as nadlan's terms are.

## Scope
**In:**
- Migration `api/alembic/versions/0021_cbs_rent_ratios.py` (revision `0021`, revises `0020`; table below),
  model `api/app/models/cbs_rent_price.py` (`CbsRentPrice`, one model per file as `rent_price.py`), imported
  and listed in `__all__` in `api/app/models/__init__.py`.
- `api/app/services/cbs_rent.py`: `bulletin_url(year, month)`, `parse_table(content: bytes, *, today: date)
  -> CbsTable` (pure), `fetch_latest(client, *, today: date) -> CbsTable | None`, `store(db, table) ->
  dict[str, int]` (`{"written": n}`), `run_cbs_import(*, history: bool = False) -> dict[str, int]` (the
  worker's and the script's entry point, gated like 0014a's `run_rent_import`). Types (NamedTuples):
  `CbsTable(bulletin: date, rows: list[CbsRow])`, `CbsRow(geo_kind, geo_code, room_group, period,
  price_ils: Decimal, sampling_error: Decimal | None)`; `bulletin` is the first day of the bulletin's month
  (`7/2026` → 2026-07-01).
- Config: `cbs_rent: Literal["off", "cbs"] = "off"` in `api/app/config.py` (`CBS_RENT`), with a comment like
  `rent_reference`'s; `.env.example` gains `CBS_RENT=off` with a comment like `RENT_REFERENCE`'s.
- Worker (`api/app/worker.py`): `import_cbs_rent_job` (`asyncio.to_thread(run_cbs_import)`, as
  `import_rent_reference_job`), `cron(import_cbs_rent_job, day=16, hour=3, minute=40, unique=True)` (at most
  six requests: arq's default timeout is enough).
- `api/scripts/import_cbs_rent.py` (`--history` flag) + `make cbs-rent-import` (latest bulletin) and
  `make cbs-rent-history` (the five xlsx bulletins 7/2025, 10/2025, 1/2026, 4/2026, 7/2026, oldest first, so
  revisions overwrite); both in `.PHONY` with `##` lines; both print `{'skipped': 1}` with `CBS_RENT=off`.
- Engine (`api/app/services/rent_estimate.py`): the small-flat path, `CbsFigure`, `backtest_ratio`;
  `api/scripts/rent_backtest.py` prints both backtests (`make rent-backtest`, its `##` line updated). Schema
  `RentEstimateRange` gains `small_flat_ratio`.
- Tests: `rent_clean` and `rent_figures` move from `test_rent_estimate.py` to `api/tests/conftest.py`
  (`test_rent_reference.py` drops its own copy of `rent_clean` and uses the conftest one: closes the 0014c
  FOLLOWUPS line on the duplicated fixture), plus a new `cbs_clean` (truncates `cbs_rent_prices`) and
  `cbs_figures` there, so the API test can use them.
- Web: the hint in `DetailsStep.tsx` picks the small-flat copy; `he.json` keys; `make client`; vitest; one
  `make screens` state; the 0014c screens state's typed `estimate` gains `small_flat_ratio: null`.
- `specs/FOLLOWUPS.md`: close the 0014c lines "CBS small-flat data spec" and "`rent_clean` … a copy", add the
  lines in Risks.

**Out:**
- `.xls` history before 7/2025 (would need `xlrd`); CBS 3.5-4 and 4.5+ groups (not used).
- Showing CBS levels themselves; a per-neighbourhood small-flat ratio (CBS has none).
- Rooms below 1 (the `Rooms` type already rejects them; `rooms_not_covered` stays in the API for safety).
- Adjustments, comparables, the open estimate tab: unchanged from 0014c.

**New dependencies:** `openpyxl==3.1.5` (api runtime, pinned like the others; the standard pure-Python xlsx
reader; parse with `read_only=True, data_only=True`) and `types-openpyxl` (dev group, pinned, for mypy strict,
as `types-redis`).

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
| `bulletin` | date NOT NULL | first day of the bulletin's month (`7/2026` → 2026-07-01), the file it last came from; `ck_cbs_rent_bulletin`: day 1 |
| `imported_at` | timestamptz NOT NULL default now() | |

Primary key (`geo_kind`, `geo_code`, `room_group`, `period`). **Upsert per row** (one `INSERT … ON CONFLICT
(pk) DO UPDATE … WHERE cbs_rent_prices.bulletin <= excluded.bulletin`): a row absent is inserted; a newer or
equal bulletin overwrites it (revisions; `imported_at` = now()); an older bulletin never overwrites a newer
one. There is no file-level "already stored" skip: an older bulletin still adds the periods the newer ones no
longer hold (that is how `cbs-rent-history` fills 2024). The CHECKs as 0014a's: `ck_cbs_rent_period`,
`ck_cbs_rent_price_ils`, `ck_cbs_rent_geo_kind`, `ck_cbs_rent_room_group`, `ck_cbs_rent_bulletin`.
Empty in dev, tests and CI unless the import runs; the engine then answers `no_figures` for 1–2 rooms.
Backwards-compatible: a new table only; the running app never reads it before this code ships.

## Import rules (`parse_table`, `fetch_latest`, `store`)
A rejected file raises `CbsFileError(ValueError)` with a fixed rule text (never the file's content or the
URL, as 0014a's `RentFileError`); the job logs the rule, stores nothing and returns `{"rejected": 1}`.
1. **Fetch.** `httpx.Client` built as 0014a's `get_rent_fetcher`: `User-Agent` `homie-rent-reference`,
   `Accept-Encoding: identity`, `timeout=30.0`, **`follow_redirects=False`** (a redirect is a bad answer),
   cookies cleared, the body streamed and capped at **5 MB** (a compressed `content-encoding` is a bad answer,
   as 0014a), requests `REQUEST_INTERVAL_S` (0014a's) apart; `from None` on httpx errors (their text may hold
   the URL). Latest: for `today`'s month and up to 5 months back, newest first, GET `bulletin_url`; the first
   answer that is status 200, within the cap, and starts with the zip magic `PK\x03\x04` is the file. None:
   log and return `None` (the job returns `{"skipped": 1}`). At most 6 requests per run, 5 for history; no
   request at all with `CBS_RENT=off`. Nothing logs a URL or a body.
2. **Zip, before openpyxl.** `zipfile`: at most 100 entries and at most 20 MB uncompressed in total (the real
   file: 25 and ~190 KB), else rejected (a zip bomb never reaches openpyxl). A `BadZipFile` or any openpyxl
   error is a rejection, never a crash of the job.
3. **Bulletin.** The one sheet's `A1` must match `No\. (\d{1,2})/(\d{4})` with 1 ≤ month ≤ 12 and the bulletin
   not after `today`'s month; else rejected. The bulletin is A1's, not the URL's (the June 2026 URL serves
   `4/2026`).
4. **Columns.** Row 5 labels, whitespace removed: `I-III`/`IV-VI`/`VII-IX`/`X-XII` → month 3/6/9/12;
   `Annualaverage` skipped; any other non-empty label rejects the file. Years: the first quarter column takes
   the year in `B4`; each next quarter column must be the quarter right after the previous one (`I-III` after
   `X-XII` adds one year), else rejected. Check: every year in row 4 must equal the derived year of the quarter
   column it stands on (7/2026: `B4` 2024 = X-XII 2024, `H4` 2025 = IV-VI 2025, `P4` 2026 = I-III 2026), else
   rejected. The first year must be ≥ 2015 and the newest quarter must end before the bulletin's month. No
   quarter column: rejected. The price is the quarter's column, the error the next.
5. **Rows.** Column A, whitespace removed, is tested **in this order**: (a) `1-2` or `2.5-3` → read inside the
   current block, skipped outside one (the `Total` rows); `3.5-4`, `4.5+` → skipped; (b) case-insensitive
   `Residential Districts` → the section is `district`; `Big cities` → `city`; (c) the stripped original
   matching `^(.*[A-Za-z].*?)\s*-\s*(\d{1,5})\s*$` (a letter in the name, so a room row never matches) opens a
   block with kind = the current section; a header before any section row, or the same (kind, code) twice,
   rejects the file; (d) anything else (`Total`, footnotes, empty) closes the current block.
6. **Cells.** A price is stored only if it is an `int` or `float` (not `bool`), finite, within 500–100000,
   rounded to 1 decimal; `-`, empty, text or out of range skips that cell alone. Error: a finite `int`/`float`
   (not `bool`) in 0–999999.99, rounded to 2 decimals, else `NULL`.
7. **Limits.** At most 1,000 rows and 60 columns are read (`iter_rows(max_row=1000, max_col=60)`); at most
   2,000 rows stored per file, more rejects it. A file without both sections, or without a `1-2` row for city
   5000 and for districts 4 and 5 (what the engine needs), is rejected (layout changed).
8. **Settlements** stored: every block (not only Gush Dan), they are few and harmless.

## The engine change (`api/app/services/rent_estimate.py`)
New constants (backtest-set ones commented with the run, policy ones "policy, spec 0014d"):

    SMALL_ROOMS = {Decimal("1"), Decimal("1.5"), Decimal("2")}   # policy (Gilad 2026-11-14)
    RATIO_WINDOW_QUARTERS = 4                 # backtest: newest CBS quarters averaged per geography
    RATIO_MIN_QUARTERS = min(2, RATIO_WINDOW_QUARTERS)   # policy
    RATIO_HALF_WIDTH = {"city": 0.03, "district": 0.03}  # backtest: ratio p80 error, rounded up
    # policy, spec 0014d: CBS district of each launch-box settlement (RENT_SETTLEMENT_CODES, 0014a), from
    # CBS's settlement list on data.gov.il (district = subdistrict code // 10), checked 2026-11-14
    SETTLEMENT_DISTRICT: dict[int, int] = {
        # Tel Aviv District (5): Tel Aviv-Yafo, Ramat Gan, Givatayim, Bnei Brak, Holon, Bat Yam, Herzliya,
        # Ramat HaSharon, Kiryat Ono, Or Yehuda, Azor
        5000: 5, 8600: 5, 6300: 5, 6100: 5, 6600: 5, 6200: 5, 6400: 5, 2650: 5, 2620: 5, 2400: 5, 565: 5,
        # Center District (4): Petah Tikva, Rishon LeZion, Givat Shmuel, Yehud-Monosson, Ganei Tikva, Savyon,
        # Hod HaSharon, Beit Dagan
        7900: 4, 8300: 4, 681: 4, 9400: 4, 229: 4, 587: 4, 9700: 4, 466: 4,
    }
    # A test asserts set(SETTLEMENT_DISTRICT) == set(RENT_SETTLEMENT_CODES).

**Rooms (step 4 of 0014c) changes:** `figure_keys` is unchanged (None below 2.5). `estimate_rent` checks
`rooms in SMALL_ROOMS` first → keys `[3]`, small flat; else `figure_keys`, None → `rooms_not_covered` (still
reachable only below 1, which the `Rooms` type rejects at the API). The order of evaluation is unchanged; the
ratio is one more step after step 5 (figures, the 3-room baseline at neighbourhood then city level exactly as
v1), before step 6 (width):

**5b. Ratio** (small flats only). **One query** reads `cbs_rent_prices` rows of `("city", code)` and
`("district", SETTLEMENT_DISTRICT.get(code))`, both groups, whose `period` is inside the CBS window: the newest
period in the whole table (a scalar subquery, like 0014c's `P`) and the `RATIO_WINDOW_QUARTERS − 1` quarters
before it (0014c's `window`). Per geography, per period holding both groups: `r = price(1-2) / price(2.5-3)`
(exact, `Fraction`). The city is used when it has at least `RATIO_MIN_QUARTERS` such periods, else the district
(when the code is in the map and has enough), else `no_figures`. The ratio = mean of those `r`
(`mean_if_enough`, widened to accept `Fraction`s). Baseline = v1 baseline × ratio. `small_flat_ratio` = the
geography used.

**6. Range** for small flats: `half = sqrt(HALF_WIDTH[level]² + RATIO_HALF_WIDTH[geo_kind]²)`; `too_uncertain`
above `MAX_HALF_WIDTH`; rounding as v1; `confidence = "medium"` always.

**Answer:** `figure_rooms == [1, 2]` (the group the number describes; the copy renders it "1–2"),
`small_flat_ratio: Literal["city", "district"] | None` (None on every 2.5+ answer), `level`, `area_name`,
`quarters` (nadlan's, as v1) and `latest_period` (nadlan's) unchanged in meaning.

**Ratio backtest** `backtest_ratio(figures: Sequence[CbsFigure], *, windows=range(1, 7), targets=4)
-> list[BacktestRow]`, pure, next to `backtest`. `CbsFigure` = NamedTuple (`geo_kind`, `geo_code`,
`room_group`, `period`, `price_ils: Decimal`). As 0014c's backtest predicts a neighbourhood from itself and
from its city, this predicts **each launch-box city's** ratio (`geo_kind == "city"` and code in
`SETTLEMENT_DISTRICT`) at each of the newest `targets` periods `T` where it has both groups:
- `city` level: the mean of the city's own `r` over the `W` quarters strictly before `T` (0014c's
  `window(quarters_back(T, 1), W)`), at least `min(2, W)` periods with both groups;
- `district` level: the mean of `SETTLEMENT_DISTRICT[code]`'s district `r` over the same quarters, same minimum
  (the error a settlement makes when it borrows its district's ratio, measurable only on the 8 cities).

Relative error `|prediction − r(T)| / r(T)`; rows (`window`, `level`, `n`, `median`, `p80`) as `BacktestRow`
(its `level` type widens to `Literal["neighbourhood", "city", "district"]`), nearest-rank p80, the same
`window` and mean code. `api/scripts/rent_backtest.py` prints the nadlan part as today (`no figures` when
empty, without returning early), then the ratio part: one line per row and `suggestion: RATIO_WINDOW_QUARTERS
= W; RATIO_HALF_WIDTH = {...}` (W = smallest city p80, tie → smaller; each level's p80 at W rounded **up** to
a whole percent, as 0014c's); `no cbs figures` when the CBS table is empty. Exit 0 either way.

**One real run, by the coder:** in the spec's own stack `CBS_RENT=cbs make cbs-rent-history` (5 requests),
then `make rent-backtest`; set the constants from the suggestion with a comment naming the run, paste the
output into the PR body, report the values. If `sqrt(HALF_WIDTH["neighbourhood"]² + city ratio p80²)` is above
`MAX_HALF_WIDTH`, stop and report (Speed rule 9: the feature would show nothing). If only a combination with
`HALF_WIDTH["city"]` (0.18 today) or with the district p80 is above it, keep building and say so in the final
report: those answers are then `too_uncertain` (the verifier's rough reading of 7/2026: own-city ratios move
~1–3 % between quarters, but a city's ratio sits 2–9 % from its district's, e.g. Bat Yam 0.90 vs 0.82, so a
district p80 near 8–9 % puts `sqrt(0.18² + d²)` at or just over 0.20). The nadlan import is not needed for
this run.

## API
`GET /rent-estimate` unchanged in path, auth (signed in), params and errors. `RentEstimateRange` gains
`small_flat_ratio: Literal["city", "district"] | None`. `make client`.

## UI
Same screen and states as 0014c (the hint under the price in `DetailsStep.tsx`; no new component, no artboard).
When `estimate.small_flat_ratio` is set, the hint uses new plural keys (`count: quarters`):
- `listings.estimate.hintSmall_one`: `"שכר דירה ממוצע ל־{{rooms}} חדרים ב{{area}}: {{range}} · {{confidence}} · לפי nadlan.gov.il והלמ״ס, רבעון אחד: {{period}}"`
- `listings.estimate.hintSmall_two`: `"שכר דירה ממוצע ל־{{rooms}} חדרים ב{{area}}: {{range}} · {{confidence}} · לפי nadlan.gov.il והלמ״ס, 2 רבעונים עד {{period}}"`
  (Hebrew's `two` plural form: `make i18n-check` requires it, as 0014c's `hint_two`)
- `listings.estimate.hintSmall_other`: `"שכר דירה ממוצע ל־{{rooms}} חדרים ב{{area}}: {{range}} · {{confidence}} · לפי nadlan.gov.il והלמ״ס, {{count}} רבעונים עד {{period}}"`

`{{rooms}}` is `figure_rooms` through the existing `roomsPair` ("1–2"). `count`, `area`, `range`,
`confidence`, `period` exactly as 0014c's hint (nadlan's quarters and period). Everything else as 0014c: no
new state (empty, loading, error as 0014c; success is this copy). RTL and logical properties unchanged.

## Acceptance criteria
- [ ] AC1 Given the real 7/2026 file (`api/tests/fixtures/cbs_rent/a4_9_e_2026_07.xlsx`, the 49 KB original,
  untrimmed), When `parse_table` runs with `today=2026-11-14`, Then bulletin 2026-07-01; Tel Aviv 5000 city
  `1-2` IV-VI 2026 (2026-06-01) = 5486.7 (error 71.67) and `2.5-3` = 7092.6; I-III 2025 (column F) is period
  2025-03-01 with Tel Aviv `1-2` = 5362.6 (not 2024: the row-4 trap); X-XII 2024 = 5333.3; Tel Aviv District 5
  and Center District 4 are `district`; Herzliya 6400, Holon 6600 (`"Holon -6600"`) and Ashkelon 7100 are
  `city`; no code 2 or 3 block (the room rows); no `Total`, `3.5-4` or `4.5 +` rows; no annual averages; no row for
  Bet Shemesh 2610 or Kfar Saba 6900 `1-2` (every cell `-`); 322 rows in all (7 periods × 24 blocks × 2 groups
  − 14 `-` cells) — `api/tests/test_cbs_rent.py::test_ac1_parse_real_file`
- [ ] AC2 Given each bad input, Then `CbsFileError` and nothing stored: a 2,056-byte HTML page, a non-zip, a zip
  over the entry or size cap, A1 without `No. N/YYYY`, a bulletin after `today`, an unknown row-5 label, two
  quarters out of sequence, a row-4 year that disagrees with its column, a newest quarter not before the
  bulletin, a block header before any section row, a duplicate block, a file with no city 5000 or district
  4/5 `1-2` row; given `-`, text, `True`, 99 or 1,000,000 in one price cell, Then only that cell is skipped —
  `test_cbs_rent.py::test_ac2_bad_files_and_cells` (parametrised; xlsx built in the test with openpyxl)
- [ ] AC3 Given stored rows from bulletin 7/2026, When a 4/2026 table is stored holding one period 7/2026 also
  has (other value) and one it lacks, Then the shared row keeps 7/2026's value and bulletin and the other is
  inserted; When a 10/2026 table with a revised value is stored, Then it overwrites and `bulletin` is
  2026-10-01; storing the same table twice writes the same rows — `test_cbs_rent.py::test_ac3_upsert_by_bulletin`
- [ ] AC4 Given `CBS_RENT=off`, Then `run_cbs_import` makes no request and returns `{"skipped": 1}`; given `cbs`,
  `today=2026-08-20` and an `httpx.MockTransport` where August answers the 2,056-byte page and July the real
  file, Then that file is stored (`{"written": 322}`), two requests made, no redirect followed (a 302 is a bad
  answer); given all six months bad, Then `{"skipped": 1}`, no error; given a file that fails a rule, Then
  `{"rejected": 1}` — `test_cbs_rent.py::test_ac4_job_fetch`
- [ ] AC5 Given `rent_figures` plus `cbs_figures` (city 5000 and district 5, ratio 0.8 for the city and 0.85 for
  the district in each of 4 periods), When an owner asks for "תל אביב", "תירוש", rooms 1, 1.5 and 2, Then each
  answer is neighbourhood level, baseline = the 3-room neighbourhood baseline × 0.8, `figure_rooms == [1, 2]`,
  `small_flat_ratio == "city"`, `medium`, and the range uses `half = sqrt(0.08² + 0.03²)` (constants patched)
  rounded to 50 as v1 — `api/tests/test_rent_estimate.py::test_ac5_small_flat_city_ratio` (parametrised)
- [ ] AC6 Given only district-5 CBS rows (no city 5000 rows), Then `small_flat_ratio == "district"` and the
  baseline × 0.85; given city 5000 rows in one period only (thin) and district rows, Then the district; given
  no CBS rows, Then `no_figures`; given rooms 2 and "חיפה", Then `unknown_city` (order unchanged); and
  `set(SETTLEMENT_DISTRICT) == set(RENT_SETTLEMENT_CODES)` —
  `test_rent_estimate.py::test_ac6_small_flat_fallbacks` (parametrised)
- [ ] AC7 0014c's tests updated, not weakened: `test_ac5_rooms_to_keys` replaces its rooms `1` and `2` cases
  with `Decimal("0.5")` → `rooms_not_covered` (called on `estimate_rent` directly; the API rejects it) and
  asserts `small_flat_ratio is None` on every 2.5+ case; `test_ac4_city_resolution_unknown_and_order` expects
  rooms 2 in "חיפה" → `unknown_city`; `test_ac10_backtest_script_empty` expects `no figures` then
  `no cbs figures` — in `test_rent_estimate.py`
- [ ] AC8 Given `RATIO_HALF_WIDTH["district"]` patched so `sqrt(HALF_WIDTH[level]² + it²)` passes
  `MAX_HALF_WIDTH`, Then `too_uncertain` for a district answer, while the city answer still has a number —
  `test_rent_estimate.py::test_ac8_small_flat_too_wide`
- [ ] AC9 Given synthetic CBS figures: a city whose ratio is constant 0.8 and its district constant 0.84, and a
  second city whose ratio steps from 0.80 to 0.88 at the last target, When `backtest_ratio` runs, Then the
  constant city's `city` error is 0 and its `district` error exactly 0.04/0.8 = 0.05; the step city's `city` error at
  the step is exactly 0.08/0.88 (relative to the actual); too few prior periods → no sample, no row; p80 nearest rank; and the script with CBS
  figures prints the suggestion line — `test_rent_estimate.py::test_ac9_ratio_backtest`
- [ ] AC10 Given `GET /rent-estimate` signed in, rooms `2`, `rent_figures` + `cbs_figures`, Then 200 with
  `estimate.small_flat_ratio == "city"` and `figure_rooms == [1, 2]`; rooms `4` → `small_flat_ratio` null;
  signed out 401 — `api/tests/test_rent_estimate_api.py::test_ac10_small_flat_api`
- [ ] AC11 Given an answer with `small_flat_ratio` set, Then the hint renders the `hintSmall` copy (one, two and
  several quarters), "1–2" rooms and both sources (`nadlan.gov.il`, `הלמ״ס`), wired by `aria-describedby`; a 2.5+
  answer (`small_flat_ratio: null`) still renders 0014c's copy without `הלמ״ס` —
  `web/src/features/listings/__tests__/DetailsStep.test.tsx::ac11 small flat hint`
- [ ] AC12 `make screens`: a new state `{ spec: '0014d', name: '01-details-estimate-small' }` (in
  `web/screens/0014d/`, the mock answering a small-flat estimate) shows the hint with `הלמ״ס`; every existing
  state still passes — `web/e2e/screens/listings.screens.ts`
- [ ] AC13 Migration 0021: from 0020 it creates `cbs_rent_prices` with the columns, PK and five CHECKs above
  and touches nothing else; a row breaking each CHECK is refused; downgrade to 0020 drops it; `head` then
  `alembic check` shows no diff — `api/tests/test_migrations.py::test_ac13_cbs_rent_upgrade_downgrade` (as
  `test_ac1_rent_reference_upgrade_downgrade`)
- [ ] NF1 A small-flat estimate is at most five queries (0014c's four + the ratio) — the 0014c `statements`
  counter in AC5 and AC6's district case

## Tests to write
pytest on the test DB: `test_cbs_rent.py` (parser on the real fixture and on xlsx built in tests, upsert, the
job with `httpx.MockTransport` and an injected `today`, never the network); `test_rent_estimate.py` (`cbs_clean`
/ `cbs_figures` from `conftest.py` next to `rent_figures`; the autouse `default_constants` also patches
`RATIO_WINDOW_QUARTERS = 4`, `RATIO_MIN_QUARTERS = 2`, `RATIO_HALF_WIDTH = {"city": 0.03, "district": 0.03}`);
the migration test; the API test. Every test that reads small-flat answers uses `cbs_clean`, so rows left by
`test_cbs_rent.py` never leak in. Vitest: `DetailsStep.test.tsx` routes for the small-flat answer. E2E (CI):
none new (tables empty in CI, so the wizard shows no hint as today).

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
- **District-ratio settlements may show nothing at city level.** The 11 settlements CBS does not publish borrow
  their district's ratio; its honest error (a city's ratio vs its district's, measured on the 8 cities) looks
  like 2–9 % on 7/2026, so with nadlan's city half width 0.18 a district answer may land at or just over
  `MAX_HALF_WIDTH` and say `too_uncertain`; neighbourhood-level answers are unaffected. Policy (0014c's cap and
  Gilad's decision 2) decides it; the coder reports which way the real run falls.
- Verification: one round (2026-11-14). 0014c had merged meanwhile (PR #91), so its code was read on `main`.
  Applied in the text above: (1) blocker, rule 4's header regex also matched the room rows `1-2` / `2.5-3`
  (as code 2 and 3): room rows are tested first and a header needs a letter; (2) blocker, 7/2026 puts `2025`
  at `H4` (IV-VI), so carrying row 4 forward labels I-III 2025 as 2024: years now come from the quarter
  sequence, cross-checked against row 4 (checked on bulletins 1, 4, 6, 7, 8/2026); (3) major, rule 2's
  "stored bulletin same or newer → write nothing" contradicted the per-row upsert and would stop
  `cbs-rent-history` from filling older quarters: removed, per-row `ON CONFLICT … WHERE bulletin <=`, and
  `bulletin` became a `date` so SQL compares it; (4) major, the district width was backtested on the district's
  own stability (~1 %): it now measures a city against its district, as 0014c measures a neighbourhood against
  its city; (5) major, no zip-size cap before openpyxl (zip bomb): added; (6) `SETTLEMENT_DISTRICT` filled
  from CBS's settlement list (data.gov.il, subdistrict // 10) with a test that it covers
  `RENT_SETTLEMENT_CODES`; (7) section rows (`Residential Districts`, `Big cities`) set the kind; `Total` rows
  skipped; three headers have no space after the dash; (8) the fetch client spelled as 0014a's
  (`follow_redirects=False`, streamed cap, identity encoding, `today` injected); `CbsFileError`, job results
  `written` / `skipped` / `rejected`; (9) `hintSmall_two` (i18n-check needs it, as 0014c's `hint_two`);
  (10) AC13 named as a dedicated migration test (the repo's pattern); AC1 numbers checked on the real file
  (322 rows); AC7 names the three 0014c tests that change (`test_ac5_rooms_to_keys`,
  `test_ac4_city_resolution_unknown_and_order`, `test_ac10_backtest_script_empty`); fixtures move to
  `conftest.py` for the API test; `types-openpyxl` for mypy strict; the model file follows one-model-per-file;
  the 0014c screens state needs `small_flat_ratio: null` (required in the generated type).
- **Build notes (coder, 2026-11-14).** (1) The real run (`CBS_RENT=cbs make cbs-rent-history`, then
  `make rent-backtest`): 4 of 5 bulletins stored (506 rows, 2023-Q4 … 2026-Q2); **10/2025 rejected** by rule 4
  (CBS labels 2024 `VII-IX` twice; and its `B4` year 2023 stands over an annual-average column, so "the first
  quarter column takes `B4`" would reject October layouts anyway: FOLLOWUPS). Its quarters are all in 1/2026 and
  7/2026. Suggestion `RATIO_WINDOW_QUARTERS = 1; RATIO_HALF_WIDTH = {'city': 0.02, 'district': 0.07}` (city p80
  1.25 %, district 6.27 %), set as the constants; so `RATIO_MIN_QUARTERS = 1`. Widths: neighbourhood + city
  ratio 0.0825, city + city ratio 0.181, neighbourhood + district 0.106, city + district 0.193, all within
  `MAX_HALF_WIDTH` 0.20. (2) Rule 4: a row-4 year over a column that is not a quarter column rejects the file
  (the text checks years against "the quarter column it stands on"). (3) A file with more than one sheet is
  rejected ("the one sheet"). (4) `import_cbs_rent(db, client, *, today, history)` holds the job's work (as
  0014a's `import_rent_reference`), so tests inject `today`; `run_cbs_import` only gates and builds it.

## Blast radius
`graphify affected` on main's graph (2026-11-14). The graph was last built at 0010m (before 0014a–c), so it
has no node for `estimate_rent`, `RentEstimateRange`, `figure_keys`, `backtest` or `useRentEstimate`
("No unique node match"); those were grepped on `main` (0014c merged) instead.
- `estimate_rent` (`api/app/services/rent_estimate.py`, grep): `api/app/routers/rent_estimate.py` (unchanged:
  same signature) and `api/tests/test_rent_estimate.py` (AC1–AC7 of 0014c; changed per AC7, the rest
  untouched: 2.5+ answers are the same).
- `figure_keys` (grep): only `estimate_rent`; unchanged (the small-flat check sits before it).
- `mean_if_enough`, `window`, `quarters_back` (grep): `estimate_rent`, `backtest`; widened to `Fraction`
  input only, same results for `int`s.
- `BacktestRow.level` / `backtest` (grep): `scripts/rent_backtest.py` (In Scope) and `test_ac9_…`,
  `test_ac10_…` (AC7 updates `test_ac10`; `test_ac9` untouched: its rows keep their levels).
- `RentEstimateRange` (`api/app/schemas/rent_estimate.py`, grep): `RentEstimateOut`, `estimate_rent`; through
  `make client` the generated `components['schemas']['RentEstimateRange']` → `web/src/features/listings/api.ts`
  type → `useRentEstimate.ts` (unchanged), `DetailsStep.tsx` (In Scope), `DetailsStep.test.tsx` (its
  `estimate` object is untyped: no change needed beyond AC11) and `web/e2e/screens/listings.screens.ts`
  (`Setup.estimate: RentEstimateOut`: the 0014c state must add `small_flat_ratio: null` or `tsc` fails; In
  Scope).
- `WorkerSettings` (graphify: only a spec reference; grep: `infra` compose runs `arq app.worker.WorkerSettings`):
  one more cron entry, nothing else changes.
- `DetailsStep` (graphify): `ListingWizard` → `NewListingPage`, `EditListingPage`; tests
  `ListingWizard.test.tsx` and the listings tests 0014c listed. Untouched: they never mock `GET
  /rent-estimate` (no hint, as today) and only the hint's key choice changes.
- `mockApi` in `listings.screens.ts` (graphify: no callers outside the file): one new state (AC12) and the 0014c
  state's `small_flat_ratio: null`.
- `rent_clean` / `rent_figures` fixtures (grep): `test_rent_estimate.py`, `test_rent_reference.py` (its own
  `rent_clean` copy); both move to `conftest.py` (In Scope), names unchanged so the tests need only their
  local definitions deleted.
- `Settings` (`api/app/config.py`): one new field with a default; every `Settings()` caller unaffected.
- `app.models.__init__` (`Base.metadata`): one more model; `test_ac4_autogenerate_sees_no_diff…` and every
  migration test's `command.check` need the model and migration to agree (AC13).

## Digest (filled by orchestrator after verification)
