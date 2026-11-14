---
id: 0014c
title: An owner pricing an apartment in the listing wizard sees the average rent for its room count in its neighbourhood (or city) as a range with a confidence level and its source, from the official figures; no number when the figures are too thin
status: done
depends_on: [0014a]   # done (PR #89): reads rent_areas / rent_prices
reviewers: [code, qa, ux]   # qa: new endpoint + wizard hint; ux: changed wizard screen. No security: signed-in read of public figures, no PII, no write. No perf: a few small queries over ≤349 areas, not search
estimate: 1 coder run   # coder Opus/high (data + the price the owner sees; Speed rule 6)
---

## Goal
After this ships an owner filling in an **apartment** in the listing wizard (new or edit) sees, under the price
field, the official average rent for that room count in the apartment's neighbourhood (or its city when the
street does not place it in one neighbourhood), as a range with a confidence level and what it is based on. When
the figures are too thin or too old, nothing is shown. This is step 1 of the engine in PRODUCT.md "Rent price
estimate" (baseline only; adjustments, comparable listings and a learned model are later specs, each kept only
if the backtest says it is better). The engine takes apartment facts, never a listing id.

## Decisions this spec builds on (Gilad, 2026-11-14, in chat)
1. **Built now**, before Slice 11 (PRODUCT.md already records it; the coder does not touch PRODUCT.md).
2. **Baseline only.** Size, floor, parking, furnishing and the 0014b facts are not used yet: nothing can set or
   backtest an adjustment before homie has listings of its own.
3. **3+ rooms only for now.** 1–2 rooms get no number; 2.5 rooms uses the 3-room figure at medium confidence
   at most. CBS small-flat tables are a later data spec.
4. **Backtest on the official history now**: it chooses how many quarters to average and how wide the range is;
   the same harness takes homie's listings later.

## Scope
**In:**
- `api/app/services/rent_estimate.py`: name normalisation, city and street resolution, the baseline, the
  confidence rule, `estimate_rent(...)`, and the pure `backtest(...)`.
- `api/app/schemas/rent_estimate.py`: `RentEstimateParams`, `RentEstimateRange`, `RentEstimateOut`.
- `api/app/routers/rent_estimate.py`: `GET /rent-estimate`, registered in `api/app/main.py::create_app`.
- `api/scripts/rent_backtest.py` and `make rent-backtest` (in `.PHONY`, with a `## rent-backtest:` line).
- Web: `web/src/features/listings/useRentEstimate.ts` (the query and a local `useDebouncedValue`; none exists in
  the repo), the price field's `hint` in `DetailsStep.tsx`, `he.json` keys, `make client`.
- `make screens`: `web/e2e/screens/listings.screens.ts` answers `GET /rent-estimate` (an unmatched request fails
  that run; default `{"estimate": null, "reason": "no_figures"}`, `Setup` gains an `estimate?` answer), and one
  new state `{ spec: '0014c', name: '01-details-estimate' }` with an estimate shown.
- `specs/FOLLOWUPS.md`: three lines (see Risks).

**Out:**
- Adjustments for size, floor, parking, furnishing, ממ״ד, balcony, condition, air conditioning (later spec, with
  homie data).
- 1–2 room flats (a CBS data spec, next in this slice), rooms in the market (PRODUCT.md: apartments only).
- A street listed in several neighbourhoods is estimated at city level; averaging those neighbourhoods waits for
  data that can test it.
- Comparable homie listings, the learned model, the "fair / above the market" badge, the open estimate tab,
  any payment.
- Pre-filling or validating the price from the estimate. The hint never changes the form.
- A rate limit (signed-in reads have none today; Slice 11 adds rate limits).

**New dependencies:** none.

## Data
No migration, no new table. Reads `rent_areas` and `rent_prices` (spec 0014a). Rooms `0` ("all sizes") is not
used. The tables are empty until the import runs with `RENT_REFERENCE=nadlan`: in dev, tests and CI every
request then answers `no_figures` and the wizard looks as it does today.

## The engine (all in `api/app/services/rent_estimate.py`)
**Constants** (module level). `WINDOW_QUARTERS` and `HALF_WIDTH` come from the backtest: their comment names
the run that set them (date and source `version`); the values below are the defaults until that run. The other
three are policy, commented "policy, spec 0014c":

    WINDOW_QUARTERS = 4                          # backtest: quarters averaged, ending at the newest period
    MIN_QUARTERS = min(2, WINDOW_QUARTERS)       # policy: figures needed inside the window
    HALF_WIDTH = {"neighbourhood": 0.08, "city": 0.15}   # backtest: range = baseline × (1 ± half width)
    MAX_HALF_WIDTH = 0.20                        # policy: a level wider than this gives no number
    HIGH_MAX_HALF_WIDTH = 0.10                   # policy: at most this, and not capped, is "high"

**Order of evaluation** (the first that fails gives the answer's `reason`):
rooms (step 4, no query; → `rooms_not_covered`) → `P`, the newest `period` in `rent_prices` (empty table →
`no_figures`) → city (step 2; → `unknown_city`) → street (step 3) → figures (step 5; → `no_figures`) → width
(step 6; → `too_uncertain`). So rooms 2 in "חיפה" is `rooms_not_covered`, and empty tables are always
`no_figures`.

**1. Normalisation** `normalise_place(text: str) -> str`: Unicode NFC; remove `"`, `'`, `` ` ``, `׳`, `״`;
replace `-`, `–`, `־` (maqaf) with a space; collapse whitespace; strip. Used on both sides of every comparison
(the stored `name_he` / `streets` and the owner's text).

**2. City → settlement.** Compare `normalise_place(city)` with `normalise_place(name_he)` of every
`kind = 'settlement'` row, then with `CITY_ALIASES` (normalised alias → settlement code; written already
normalised):

    "תל אביב", "תא", "יפו" → 5000      "הרצליה" → 6400          "פתח תקוה", "פת" → 7900
    "ראשלצ", "ראשון" → 8300           "קרית אונו" → 2620       "יהוד", "מונוסון" → 9400
    "גני תקוה" → 229                   "רג" → 8600

No match, or the code has no settlement row: reason `unknown_city`.

**3. Street → neighbourhood.** `normalise_place(street)`, then also with a leading `רחוב ` or `רח ` removed.
Candidates are the `kind = 'neighbourhood'` rows of that settlement whose normalised `streets` contain either
form. Exactly one candidate: try the neighbourhood level, then the city. Zero or several: city level only.

**4. Rooms → figure keys.** `rooms < 2.5`: reason `rooms_not_covered`. `2.5` → `[3]`; `3`, `4`, `5` → itself;
`3.5` → `[3, 4]`; `4.5` → `[4, 5]`; `≥ 5.5` → `[5]`. The answer is **capped** (never "high") unless rooms is
exactly 3, 4 or 5. The keys are returned as `figure_rooms`.

**5. Baseline at a level.** The window is `P` and the `WINDOW_QUARTERS − 1` quarters before it. **One query**
reads the window's figures for the keys of both the candidate neighbourhood (if any) and the settlement. For
each key: the area's figures for that room count inside the window; at least `MIN_QUARTERS` of them, else this
level fails. The key's baseline is their mean; the level's baseline is the mean over its keys; `quarters` is
the smallest count over its keys. A failed neighbourhood level falls back to the city; a failed city level:
reason `no_figures`.

**6. Range and confidence.** `half = HALF_WIDTH[level]`. If `half > MAX_HALF_WIDTH`: reason `too_uncertain`.
`low_ils = floor(baseline × (1 − half) / 50) × 50`, `high_ils = ceil(baseline × (1 + half) / 50) × 50`.
`confidence = "high"` when `half ≤ HIGH_MAX_HALF_WIDTH` and not capped, else `"medium"`.

**Interface:** `estimate_rent(db: Session, *, city: str, street: str, rooms: Decimal) -> RentEstimateOut`
(the schema object, built here, as other services do). Facts in, never a listing id.

## The backtest
`backtest(figures: Sequence[Figure], *, windows: Iterable[int] = range(1, 9), targets: int = 4)
-> list[BacktestRow]` in the same module, pure (no DB). `Figure` = (`kind`, `area_id`, `settlement_code`,
`rooms`, `period`, `price_ils`), rooms 3, 4, 5 only. For each window `W` and each of the newest `targets`
quarters `T`, for each neighbourhood figure at `T`:
- **neighbourhood** prediction: the mean of the same neighbourhood's figures in the `W` quarters strictly before
  `T`, if at least `min(2, W)` exist;
- **city** prediction: the mean of its settlement's figures (same rooms) in the same quarters, same minimum.

Relative error = `|prediction − actual| / actual`. `BacktestRow` = (`window`, `level`, `n`, `median`, `p80`):
`median` is `statistics.median`, `p80` the 80th percentile by nearest rank (`sorted(errors)[ceil(0.8 n) − 1]`).
A (window, level) with no sample (`n = 0`) has no row. The same mean and window code as `estimate_rent` is
used, not a copy.

`api/scripts/rent_backtest.py` (like `scripts/import_rent_reference.py`): loads every rooms 3/4/5 figure,
runs `backtest`, prints one line per row, then a suggestion: `WINDOW_QUARTERS` = the window with the smallest
neighbourhood `p80` (a tie: the smaller window), and `HALF_WIDTH` per level = that window's `p80` rounded **up**
to whole percent. Prints `no figures` and exits 0 on an empty table.

**One real run, by the coder:** in the spec's own stack, `RENT_REFERENCE=nadlan make rent-import` once (about
350 requests, the volume of the 2026-11-14 data check; never in tests or CI), then `make rent-backtest`. Set the
constants from its suggestion, paste its output into the PR body, and report the chosen values in the final
report (they go into this spec's digest). If the neighbourhood `p80` at the chosen window is above
`MAX_HALF_WIDTH`, stop and report to the orchestrator: the feature would show nothing (Speed rule 9). If only
the city `p80` is above it, keep building and say so in the final report: every city-level answer is then
`too_uncertain` (no number for unplaced streets, streets in several neighbourhoods and thin neighbourhoods).

## API
| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | `/rent-estimate` | signed in (`current_user`), any role | query `city` (`City`), `street` (`Street`), `rooms` (`Rooms`) — the types in `api/app/schemas/listing.py`, reused as they are | 200 `RentEstimateOut` | 401 signed out; 422 invalid or missing parameter (not echoed, as everywhere); 503 database down (existing handler) |

`RentEstimateParams` is a query model like `SearchParams`, strings stripped, but `extra="forbid"` (an unknown
parameter is 422), a deliberate difference from `SearchParams`, which ignores unknown parameters.

    RentEstimateOut:   estimate: RentEstimateRange | None
                       reason: Literal["unknown_city", "rooms_not_covered", "no_figures", "too_uncertain"] | None
                       # exactly one of the two is set
    RentEstimateRange: low_ils: int, high_ils: int
                       confidence: Literal["high", "medium"]
                       level: Literal["neighbourhood", "city"]
                       area_name: str        # the rent_areas name_he of the level used
                       figure_rooms: list[int]   # the room counts behind it (step 4): [3], [3, 4], [5]
                       quarters: int         # figures behind it (step 5)
                       latest_period: date   # P

## UI
Screen: the listing wizard's details step (`DetailsStep.tsx`, group `listings.section.priceEntry`), new and edit
(the edit page is the same wizard). Anatomy: the price `Field` gets its existing `hint` slot; no new component,
no artboard (PRODUCT.md "Brand": no new artboards).

`useRentEstimate(form)`: `useQuery` keyed `['rent-estimate', city, street, rooms]` on values trimmed and
debounced 400 ms; `enabled` only when `form.listing_type === 'apartment'`, city and street are non-empty and
rooms parses to a number; `staleTime` one hour; `retry: false`.

States:
- **Empty** (a room listing, address or rooms not filled, or the answer has a `reason`): no hint; the field is as
  today.
- **Loading / debouncing:** no hint (a hint that flickers in under the price would distract more than help).
- **Error** (network, 5xx): no hint; the wizard never blocks on it. A 401 follows the app's rule (0009g,
  `web/src/app/queryClient.ts` runs `clearSession` and the route guard leaves the wizard), as the wizard's own
  publish 401 does: the session is gone either way.
- **Success:** the hint, one line under the price, `text-caption text-ink-muted` (the `Field` default), wired by
  `aria-describedby` as every hint.

Copy (`web/src/locales/he.json`, no single gender, no slash forms):
- `listings.estimate.hint_one` / `listings.estimate.hint_other` (i18next plural on `count: quarters`, PRODUCT.md
  "Counts use i18next plural forms"):
  `_one`: `"שכר דירה ממוצע ל־{{rooms}} חדרים ב{{area}}: {{range}} · {{confidence}} · לפי nadlan.gov.il, רבעון אחד: {{period}}"`;
  `_other`: `"שכר דירה ממוצע ל־{{rooms}} חדרים ב{{area}}: {{range}} · {{confidence}} · לפי nadlan.gov.il, {{count}} רבעונים עד {{period}}"`
- `{{range}}` is the existing `search.filters.priceRange`-style pattern: new key `listings.estimate.range`:
  `"{{low}}–{{high}} ₪"`, amounts through `formatIls`.
- `listings.estimate.confidence.high`: `"ודאות גבוהה"`; `listings.estimate.confidence.medium`: `"ודאות בינונית"`.
- `listings.estimate.period`: `"רבעון {{quarter}} {{year}}"` (`quarter` = month / 3).
- `{{rooms}}` is `figure_rooms`, not the form's rooms (so 2.5 says "3" and 6 says "5", what the figure is
  based on): one count as is, two as `listings.estimate.roomsPair` `"{{low}}–{{high}}"` ("3–4"). `{{area}}` is
  `area_name`.

The copy says "average rent for N rooms in <area>", not PRODUCT.md's example "דירות דומות" ("similar
apartments"): v1 is an area average, not a comparison with similar flats; the comparable-listings step can earn
that wording.

RTL: the hint is a `<p>` inside the RTL `Field`; the range keeps the existing `{{min}}–{{max}} ₪` pattern, so it
renders as every price range in search does. No layout change, logical properties only.

## Acceptance criteria
- [ ] AC1 Given figures for a neighbourhood whose street list holds "תירוש", When an owner asks for city "תל-אביב",
  street "רחוב תירוש", 4 rooms (constants patched to the defaults), Then the answer is at `neighbourhood` level,
  `area_name` is that neighbourhood, `figure_rooms == [4]`, the baseline is the mean of its last 4 of six
  figures, the range follows step 6 rounded to 50 — `api/tests/test_rent_estimate.py::test_ac1_neighbourhood_baseline`
- [ ] AC2 Given a street in no neighbourhood list, and (separately) a street in two, Then the answer is at
  `city` level with the city's name — `test_rent_estimate.py::test_ac2_street_unplaced_uses_city` (parametrised)
- [ ] AC3 Given a neighbourhood with fewer than `MIN_QUARTERS` figures in the window (B) but a city with enough,
  Then the answer falls back to `city` in at most four queries; given a city with a settlement row and no
  figures ("הרצליה"), Then `reason == "no_figures"` and `estimate is None` —
  `test_rent_estimate.py::test_ac3_thin_figures_fall_back`
- [ ] AC4 Given each city alias of step 2 and the source spelling with a hyphen, Then the city resolver returns
  its code (tested on the resolver function, since only 5000 has figures); given "חיפה", Then `estimate_rent`
  answers `reason == "unknown_city"`; given rooms 2 in "חיפה", Then `rooms_not_covered` (the order) —
  `test_rent_estimate.py::test_ac4_city_resolution` (parametrised)
- [ ] AC5 With the constants patched to the defaults: rooms 1, 2 → `rooms_not_covered`; 2.5 → the 3-room
  figure, `figure_rooms == [3]`, `medium`; 3.5 → the mean of 3 and 4, `[3, 4]`, `medium`; 6 → the 5-room figure,
  `[5]`, `medium`; 4 at neighbourhood level → `high` — `test_rent_estimate.py::test_ac5_rooms_to_keys` (parametrised)
- [ ] AC6 Given `HALF_WIDTH["city"]` patched above `MAX_HALF_WIDTH`, When the answer would be at city level,
  Then `reason == "too_uncertain"` — `test_rent_estimate.py::test_ac6_too_wide_gives_no_number`
- [ ] AC7 Given empty `rent_areas` and `rent_prices`, When asked for a valid city, Then `reason == "no_figures"`
  (not `unknown_city`) and no error —
  `test_rent_estimate.py::test_ac7_empty_tables`
- [ ] AC8 Given `GET /rent-estimate` signed out, Then 401; signed in with rooms `0.3` or no `city`, Then 422;
  signed in with valid facts, Then 200 and exactly one of `estimate` / `reason` is set —
  `api/tests/test_rent_estimate_api.py::test_ac8_auth_and_validation`
- [ ] AC9 Given synthetic figures where one neighbourhood is constant and its city differs by a known amount,
  When `backtest` runs, Then the neighbourhood rows have error 0 and the city rows have exactly that relative
  error; `p80` is nearest-rank; a window with too few prior quarters contributes no sample —
  `test_rent_estimate.py::test_ac9_backtest_known_errors`
- [ ] AC10 Given an empty table, When `make rent-backtest`'s `main()` runs, Then it prints `no figures` and
  returns normally — `test_rent_estimate.py::test_ac10_backtest_script_empty`
- [ ] AC11 Given an apartment with city, street and rooms filled and the endpoint answering an estimate, Then the
  price field shows the hint with the range, confidence, `figure_rooms` and source (one quarter and several
  quarters both rendered through the plural keys), and the price input is `aria-describedby` it; given a
  `reason` answer, a 500, or a room listing, Then no hint and (for a room) no request —
  `web/src/features/listings/__tests__/DetailsStep.test.tsx::ac11 rent estimate hint`
- [ ] AC12 Given typing in the street field, Then requests start only after 400 ms without a change —
  `DetailsStep.test.tsx::ac12 estimate request is debounced` (fake timers)
- [ ] AC13 `make screens`: every existing wizard state still passes with `GET /rent-estimate` answered
  `{"estimate": null, "reason": "no_figures"}` by default, and a new state `{ spec: '0014c', name:
  '01-details-estimate' }` (in `web/screens/0014c/`) shows the hint — `web/e2e/screens/listings.screens.ts`
- [ ] NF1 One estimate is at most four queries (newest period, settlements, the settlement's neighbourhoods,
  the figures of both levels at once) — asserted with a SQLAlchemy `before_cursor_execute` counter in
  `test_ac1_…` (neighbourhood) and `test_ac3_…` (city fallback)

## Tests to write
Unit and integration (pytest, the test database). The engine tests **monkeypatch all five constants** to the
defaults listed in "The engine", so the real backtest run can change the module values without breaking them.
A fixture `rent_figures` truncates `rent_areas, rent_prices` (like 0014a's `rent_clean`) and inserts:
- settlement rows for all eight alias codes (5000, 6400, 7900, 8300, 2620, 9400, 229, 8600); figures on 5000
  only;
- 5000: rooms 3, 4 and 5 in each of six quarters;
- neighbourhood A of 5000 (streets include "תירוש" and "דיזנגוף"): rooms 3, 4 and 5 in each of six quarters;
- neighbourhood B of 5000 (streets include "דיזנגוף"): one 4-room figure inside the window (thin);
- so "תירוש" places in A, "דיזנגוף" is in two (city level), an unknown street places nowhere (city level),
  a street of B alone falls back from B to the city (AC3), and "הרצליה" has a settlement row but no figures.

The backtest on synthetic `Figure` lists, no DB.
The script's `main()` with an empty table. API through the existing `client` and sign-in helpers. Vitest:
`DetailsStep.test.tsx` with `mockApi` routes for `GET /rent-estimate`. E2E (CI): none new; the compose stack's
tables are empty, so the wizard e2e flows see no hint and need no change.

## Risks / open questions
- **What the range means.** It is the uncertainty of the area's *average* rent, from how much the official figure
  moves between quarters and between a neighbourhood and its city. Single apartments vary more (size,
  condition); the copy says "average", not "your apartment". Adjustments come with homie's data.
- **The backtest predicts official figures from official figures.** It sets the window and the widths; it
  cannot say how close the average is to a real asking rent. That needs homie's listings: the same harness then
  compares against them.
- **Street spellings.** Owners type freely; the source's street names are plain names (checked on the fixture).
  An unmatched street falls back to the city at medium confidence, never to a wrong neighbourhood.
- **Running the import once for the backtest** repeats the 2026-11-14 data check (about 350 polite requests);
  the terms-of-use reading stays a Slice 13 item before the monthly import is switched on.
- **No number in production until the import runs there** (Slice 13); dev and CI show no hint unless someone
  imports.
- FOLLOWUPS lines to add: (1) CBS small-flat data spec (1–2 rooms); (2) a street in several neighbourhoods:
  average them once homie data can test it; (3) adjustments (size, floor, parking, facts) once homie has enough
  listings for the backtest.
- Verification: round 1 rejected with 11 findings (0 blocker, 3 major, 8 minor), all applied above by the
  orchestrator (evaluation order, constants patched in tests, the fixture spelled out, `figure_rooms` in the
  copy, plural keys, the 401 state, the screens state, NF1 on both paths); second round waived (one verifier
  round).

## Blast radius
`graphify affected` on main's graph (2026-11-14). Nothing existing changes signature; the spec adds a router, a
hook and a hint.
- `create_app` (`api/app/main.py`): every API test via `tests/conftest.py::client`, `test_openapi_export.py`
  and `scripts/export_openapi.py`. In Scope only as one more `include_router`; no test changes, the new path
  reaches `web/src/api/schema.d.ts` through `make client` (Scope).
- `DetailsStep` (`web/src/features/listings/DetailsStep.tsx`): called by `ListingWizard` →
  `NewListingPage`, `EditListingPage` → `AppRoutes`; tests `ListingWizard.test.tsx`, `EditListingPage.test.tsx`,
  `DetailsStep.test.tsx`, `PhotosStep.test.tsx`, `RoomFields.test.tsx`, `RequireOwner.test.tsx`,
  `listings/__tests__/logout.test.tsx` and helper `__tests__/wizard.tsx`. In Scope: `DetailsStep.test.tsx`
  (AC11, AC12). Untouched, with reason: the others do not mock `GET /rent-estimate`, so the harness answers
  it 599 `unmocked` → query error → no hint (the spec's error state), and none counts GET calls:
  `ListingWizard.test.tsx:1002 writes()` keeps only non-GET routes, `EditListingPage.test.tsx:191` filters
  `PATCH ` and `GET /listings/` (`/rent-estimate` matches neither). No listings test uses fake timers, so
  the 400 ms debounce only adds one late GET per filled apartment form.
- price `Field` usage (`components/Field.tsx`, `hint?: string`): `Field` itself is untouched (callers in
  KitPreview, ApplySection, OtpForm, FlatmatesPage, PreferencesStep, RoomFields, ProfilePage, FiltersForm,
  PlaceSearch, Login/Signup and `Field.test.tsx` unaffected); only DetailsStep's price `Field` passes `hint`.
- `mockApi` in `web/src/features/auth/__tests__/harness.tsx`: imported by ~70 test files; unchanged (routes
  are per test). Only `DetailsStep.test.tsx` adds `GET /rent-estimate` routes.
- `mockApi` in `web/e2e/screens/listings.screens.ts`: no callers outside the file (graphify: none). In Scope:
  it answers `GET /rent-estimate` by default (else every wizard state from `05-details-filled` and the
  `11`–`15` edit states fails on `unmatched`), plus a `Setup` option for the new state.
- `City`, `Street`, `Rooms` (`api/app/schemas/listing.py:77–85`): reused unchanged (graphify cannot resolve
  these type aliases to one node; grep: used by `ListingCreate`/`ListingUpdate` and `SearchParams`); untouched.

## Digest (filled by orchestrator after verification)
    Spec 0014c — the owner sees the area's average rent while pricing an apartment   (verified, one part)
    What a user can do after this: an owner filling in an apartment in the listing wizard (new or edit) sees
      under the price "average rent for 4 rooms in <neighbourhood>: ₪X–Y · high/medium certainty · nadlan.gov.il,
      N quarters"; nothing when the figures are thin, the city is outside Gush Dan, or the flat has under 2.5 rooms.
    Decisions I need from you: none (yours of today are in PRODUCT.md: built now, baseline only, 3+ rooms,
      backtest on the official history).
    KPIs this slice moves: none measurable yet (no production data until the import runs in Slice 13); later,
      share of apartment listings priced inside the range.
    Acceptance targets: at most 4 queries per estimate; range width and window set by the backtest (defaults
      ±8% neighbourhood / ±15% city, 4 quarters); no number above ±20%.
    Risks: the range is the uncertainty of an area's average, not of one flat; the backtest checks official
      figures against themselves. The coder runs the official import once (~350 requests, like the 2026-11-14
      check) to feed it; the monthly import stays off until the Slice 13 terms check.
    Reviewers: code, qa, ux   Estimated: 1 coder run (Opus/high), 1 review round
    Links: specs/0014c-rent-estimate-baseline.md · PRODUCT.md "Rent price estimate" · no artboard (hint on an existing field)

Merged 2026-11-14 (PR #91, merge commit 259c031):

    Spec 0014c — the owner sees the area's average rent while pricing an apartment   DONE (PR #91 merged)
    Shipped: under the price in the listing wizard (new and edit), an apartment shows the official average rent
      for its room count in its neighbourhood (or city): range, high/medium certainty, nadlan.gov.il and the
      quarters behind it. Nothing for under 2.5 rooms, unknown cities, thin figures. `GET /rent-estimate`
      (signed in, facts only) and `make rent-backtest`.
    Backtest (one real import, 349 files, source version 20-08-2026): window 3 quarters; p80 error 7.65%
      neighbourhood, 17.78% city → half widths ±8% / ±18%, so city-level answers are always "medium".
      Spot check: Tel Aviv "נורדאו" 4 rooms → 9,950–11,700 ₪, high.
    Tests: pytest 657, vitest 697 green locally; CI green on the head (one hand re-run after a map e2e
      failure unrelated to this spec, logged in FOLLOWUPS).
    Findings: 0 blockers, 0 majors; minors to FOLLOWUPS (copy "ב"+"ה" prefix, truncated source names, a debounce
      nit, two test gaps, a duplicated fixture). Deviation: an extra `hint_two` plural key (i18n-check needs it).
    Changed in PRODUCT.md: the engine order and v1 decisions (2026-11-14).
    Next spec I propose: 0014d — CBS small-flat figures (1–2 rooms), Gilad's pick; source not researched yet.
