---
id: 0006b
title: A seeker with a profile sees a 0–100 match score with its top-3 agreeing / top-1 differing criteria on every search result and on the listing page, and search sorts by match by default
status: in-review
depends_on: [0006a]      # the profile table and the three owner-preference columns
reviewers: [code, qa, perf, security]   # perf: a computed ORDER BY on the public search hot path, paging over it; qa: the scoring table; security: public endpoints start reading the session, responses now differ per caller
estimate: 1 coder run
---

## Goal
After this ships, `GET /listings` and `GET /listings/{id}` called by a seeker who has a profile (`0006a`) return,
on every listing, `match: {score, agrees, differs}` — a 0–100 score from PRODUCT.md "Matching" (hard filters,
then a weighted distance score; a hard-filter failure is capped at 59 and shown, never hidden) with the top-3
agreeing and top-1 differing criteria — and search defaults to `sort=match`. Everyone else gets `match: null`
and today's behaviour. All matching math lives in `api/app/matching/` (CLAUDE.md "Matching math only in
`matching/`"), written once as SQL so the same formula ranks, pages and explains. Serves Dev Plan slice 6, part
b of seven (overview in `0006a`). Artboards: `Search.dc.html` / `SearchDesktop.dc.html` ("ממוינות לפי התאמה",
"התאמה 87%", the agree/differ chips), `Listing.dc.html` ("ההתאמה שלך 87%").

## Scope
**In:**
- `api/app/matching/score.py` (new; `matching/__init__.py` exists, empty):
  - `CRITERIA = ("budget", "move_in", "area", "household", "contract", "parking", "smoking", "pets")` (also the
    tie-break order), `WEIGHTS = {budget: 25, move_in: 20, area: 20, household: 10, contract: 10, parking: 5,
    smoking: 5, pets: 5}` (sum 100), `HARD = ("budget", "move_in", "area", "smoking", "pets")`,
    `HARD_FAIL_CAP = 59`, `MOVE_IN_WINDOW_DAYS = 28`, `FLEXIBLE_DAYS = 14`.
  - `match_columns(listing, profile) -> list[Label]`: given the `Listing` and `SeekerProfile` entities (or
    aliases) of a statement, the labelled SQL columns `m_<criterion>` (each **`numeric`** 0–1, labels typed
    `Numeric`, Python `Decimal` — never `float`), `f_<criterion>` for each `HARD` criterion (`bool`, "fails"),
    and `m_score` (`int`), per the Data table. A boolean enters arithmetic only through `CASE WHEN … THEN 14 ELSE
    0 END`; both divisions are numeric (`d::numeric / 28`, `L.parking_spots::numeric / P.parking_needed`; in
    SQLAlchemy `/` on integers, never `//` or `text()`); `raw = round(Σ WEIGHTS[c] · m_c)` on that numeric sum
    (`round(numeric)`: half away from zero); `m_score = (CASE WHEN f_budget OR f_move_in OR f_area OR f_smoking OR
    f_pets THEN least(raw, 59) ELSE raw END)::int`. No Python re-implementation of the formula.
  - `explain(values: Mapping[str, Any]) -> MatchOut`: from one result row's `m_*` / `f_*` / `m_score` values
    (`row._mapping`), the score plus the explanation rule in Data. Pure Python, no I/O.
- `api/app/schemas/match.py` (new): `Criterion = Literal[<CRITERIA>]`, `MatchOut {score: int, agrees:
  list[Criterion], differs: Criterion | None}`.
- `api/app/schemas/search.py`: `SearchSort` gains `"match"`; `SearchParams.sort: SearchSort | None = None`;
  `ListingPublic` gains `match: MatchOut | None = None` (the default keeps `ListingPublic.model_validate(<ORM
  row>)` working; the router then sets it; OpenAPI: optional nullable) — so `ListingDetail` has it;
  `ListingSearchOut` gains `sort: SearchSort` — the order actually applied.
- `api/app/services/search.py`:
  - `search_listings(db, params, profile_user_id: uuid.UUID | None = None) -> tuple[list[tuple[Listing,
    MatchOut | None]], int, SearchSort]` — the page rows with their match, the total, the applied sort. With a
    `profile_user_id`, the **page** statement joins `SeekerProfile` on `SeekerProfile.user_id ==
    profile_user_id`, adds `match_columns`, and calls `explain(row._mapping)` once per row; the count statement is
    unchanged (the score never filters: PRODUCT.md "Matching"). Effective sort: `params.sort` if given, else
    `"match"` with a profile, else `"newest"`; `"match"` without a profile becomes `"newest"` (a shared
    `/search?sort=match` link must not break for a visitor). `"match"` orders by `m_score DESC, created_at DESC,
    id`.
  - `get_public_listing_with_match(db, listing_id, profile_user_id: uuid.UUID | None) -> tuple[Listing,
    MatchOut | None]`, built on `_public_listings()` + `match_columns`. `get_public_listing(db, listing_id) ->
    Listing` keeps its signature (`return get_public_listing_with_match(db, listing_id, None)[0]`), so
    `services/applications.py` (`apply`) is untouched. `_public_listings()` stays the only visibility rule.
- `api/app/routers/search.py`: both endpoints take `optional_user` and the `Request`; the profile user id is
  `user.id` when the user is a seeker **and** `profiles_service.has_profile` (one PK lookup), else `None`. Owners
  and visitors are unchanged apart from the response's new `match: null` and `sort`. The 200 response carries
  `Cache-Control: private` when `COOKIE_NAME in request.cookies` (the raw cookie: `optional_user` returns `None`
  for an expired one; responses that may differ per caller must not be shared-cached; nothing sets a cache header
  today). Update the module docstrings ("Nothing here reads the caller's session" is no longer true; a cookie now
  adds the score and nothing else).
- Tests and fixtures (existing, amended): `test_search.py` `PUBLIC_KEYS` gains `"match"` (on top of `0006a`'s
  three; `test_applications.py` imports it); the exact-body asserts `test_search.py:256` (`{"items": [], "total":
  25}`) and `test_geocoding.py:326` (`{"items": [], "total": 0}`) also expect `"sort": "newest"`; `"sort=match"`
  leaves `test_search.py`'s `_BAD_QUERIES` tuple; `web/src/features/search/__tests__/fixtures.ts` `page()` returns
  `sort: 'newest'` and `publicListing()` gains `match: null` (after `make client` both are required in the
  generated types: FastAPI's separate output schemas mark a response field with a default as required).

**Out:**
- The owner inbox (`match` per applicant, sort by match, applicant profile summary): `0006c`.
- Web (badges, sort label, pins, match card, nudges): `0006f`.
- Tuning the weights from data, per-seeker weights, "saved search" alerts by score: later. Rooms are still
  hidden from search (Slice 7 adds room criteria).
- A minimum-score filter; a cached / materialised score table: not needed at Gush Dan volume (NF2), revisit if
  NF2 fails.

**New dependencies:** none.

## Data
No schema change. Formula (all SQL, in `match_columns`; `L` = listing, `P` = profile, dates in days, every
`m_c` numeric):

| Criterion | `m_<c>` (0–1) | `f_<c>` (hard only) |
| --- | --- | --- |
| budget | `1` if `L.price_ils <= P.budget_max_ils` else `0` | `L.price_ils > P.budget_max_ils` |
| move_in | `greatest(0, 1 - d::numeric / 28)` where `d = greatest(0, abs(greatest(L.available_from, current_date) - greatest(P.move_in_date, current_date)) - (CASE WHEN L.entry_flexible THEN 14 ELSE 0 END) - (CASE WHEN P.move_in_flexible THEN 14 ELSE 0 END))` | `d > 28` |
| area | `1` if `L.area_id = ANY(P.area_ids)` else `0` | `m_area = 0` |
| household | `1` if `P.household = ANY(L.accepted_households)` else `0` | — (soft) |
| contract | `1` if `L.min_contract_months IS NULL OR P.contract_months >= L.min_contract_months` else `0` | — (soft) |
| parking | `1` if `P.parking_needed = 0`, else `least(1, L.parking_spots::numeric / P.parking_needed)` | — (soft) |
| smoking | `0` if `P.smoker AND NOT L.smoking_allowed` else `1` | `m_smoking = 0` |
| pets | `0` if `P.has_pets AND NOT L.pets_allowed` else `1` | `m_pets = 0` |

`raw = round(Σ WEIGHTS[c] · m_c)` (numeric, half away from zero); `m_score = least(raw, 59)` if any `f_c`, else
`raw`, cast to `int`. A past `available_from` means "immediately" (`0002a`), a past stored `move_in_date` means
"now" — hence both `greatest(…, current_date)`. The formula assumes a profile row (with NULL profile columns
`GREATEST` / `LEAST` skip NULLs, so the values are not NULL but meaningless; `0006c` never reads them then).

**Explanation** (`explain`, `W` = `WEIGHTS`): `differs` = the first criterion with `m_c < 1` when sorted by
(not failing, −W·(1−m_c), `CRITERIA` index) — failing ones first — or `None` when every `m_c = 1`; `agrees` =
the first 3 criteria with `m_c >= 0.5`, not failing and not `differs`, sorted by (−W·m_c, `CRITERIA` index).
The web turns codes into copy (it knows the listing and the seeker's own profile); the API returns no profile
values.

## API
| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | /listings | public; `optional_user` | `SearchParams` (`sort` now optional, `match` allowed) | 200 `ListingSearchOut` (`items[].match`, `sort`) | 422 as `0003a` (`sort=foo` still 422; `sort=match` no longer is — amends `0003a` AC7) |
| GET | /listings/{id} | public; `optional_user` | — | 200 `ListingDetail` (+ `match`) | 404 `not_found` as `0003a` |

`match` is non-null exactly when the caller is a seeker with a profile. An expired or unknown cookie is a
visitor (as `optional_user` already behaves), never a 401.

## UI
None (`0006f`). `make client` regenerates `schema.d.ts`; the only web change is the test fixture in Scope (so
`tsc` stays green). The web omits `sort` for its default "newest" (`web/src/features/search/filters.ts`
`toSearchParams`), so a seeker with a profile would get match order under a "newest" label until `0006f` merges —
moot in practice: no one can create a profile in the UI before `0006d`, and production has no users yet.

## Acceptance criteria
Fixtures: `0003a`'s (`gush_dan`, `make_owner`, `make_listing`, `set_location`, `statements`), `0006a`'s
`make_profile(db_engine, seeker_id, gush_dan, **overrides)`, a second active area `north` and an inactive one
(inserted in the test), `signup`. Every date comes from one `TODAY = dt.datetime.now(dt.UTC).date()` (the
database's `current_date` is UTC; `make_listing`'s default is the host's local date); past dates are set by SQL
relative to `current_date`. `P0` = `make_profile` defaults (budget 7500, move-in `TODAY` + 30, not flexible,
`[gush_dan]`, couple, no pets, non-smoker, 24 months, parking 1). `L0` = a listing at 7000, `available_from`
`TODAY` + 30, `entry_flexible=False` (explicit: `make_listing` defaults it to `True`), area `gush_dan`, all
households, smoking allowed, no minimum, parking 1, pets allowed.
- [ ] AC1 For each row — (1) `L0`: 100, agrees `[budget, move_in, area]`, differs null; (2) price 7600: 59, differs `budget`, agrees `[move_in, area, household]`; (3) `available_from` `TODAY` + 70: 59, differs `move_in`, agrees `[budget, area, household]`; (4) as 3 with `entry_flexible` and `P.move_in_flexible`: d = 12 → 91, differs `move_in`, agrees `[budget, area, household]`; (5) area `north`: 59, differs `area`, agrees `[budget, move_in, household]`; (6) `P.smoker` + `smoking_allowed` false: 59, differs `smoking`; (7) `P.has_pets` + `pets_allowed` false: 59, differs `pets`; (8) `accepted_households ["family"]`: 90, differs `household` (not capped); (9) `P.contract_months` 6, minimum 12: 90, differs `contract`; (10) `P.parking_needed` 2, spots 1: 98 (97.5 rounds up), differs `parking`; rows 6–10 agrees `[budget, move_in, area]`; (11) price 7600 and area `north`: 55 (raw below the cap), differs `budget`, agrees `[move_in, household, contract]`; (12) `available_from = current_date - 40` and `P.move_in_date = current_date - 10` (by SQL): 100, agrees `[budget, move_in, area]` (59 without both `greatest`s, 93 with only the listing's); (13) `available_from` `TODAY` + 37 and `P.parking_needed` 2 (spots 1): raw 92.5 → **93** (`round(double)` would give 92), differs `move_in`, agrees `[budget, area, household]`; (14) `P.has_pets` + `pets_allowed` false + `accepted_households ["family"]`: raw 85 → 59, differs `pets` (a failing criterion beats household's larger soft gap), agrees `[budget, move_in, area]` — When the seeker `GET /listings/{id}`, Then `match` equals the row exactly, and that listing's item in `GET /listings` carries the same `match` — `api/tests/test_matching.py::test_ac1_score_and_explanation` (parametrized)
- [ ] AC2 Given a seeker with `P0` and public listings, created in this order: `L0` at price 7600 (59), `L0` (100), `L0` with `available_from` `TODAY` + 42 (d = 12 → 91), plus one more `L0` (100) created earliest, When `GET /listings` with no `sort`, Then `sort` is `"match"` and the order is the two 100s (newer first), 91, 59; every item's `match` is non-null; `total` is 4 — `test_matching.py::test_ac2_search_defaults_to_match_order`
- [ ] AC3 Given the same listings, When `GET /listings` with no cookie, with an owner's cookie, with a seeker's cookie but no profile, and with an expired cookie — each with no `sort` and with `sort=match` — Then 200, `sort` is `"newest"`, the order is newest first and every `match` is null — `test_matching.py::test_ac3_no_profile_means_no_score`
- [ ] AC4 Given the seeker with `P0`, When `GET /listings?sort=price_asc`, Then `sort` `"price_asc"`, price order, and `match` still on every item — `test_matching.py::test_ac4_explicit_sort_keeps_score`
- [ ] AC5 Given the seeker with `P0` and 25 public listings with varied prices / dates / areas (several equal scores), When paging `limit=10` at offsets 0, 10, 20 with `sort=match`, Then the 25 ids concatenated equal one `limit=50` request's order with no duplicate — `test_matching.py::test_ac5_match_order_pages_stably`
- [ ] AC6 Given four `L0`-like listings priced ≤ 7000 with `pets_allowed`, located inside a map box (`set_location`), one of them in area `north` (scores 59), plus one located outside the box and one at 7600, When the seeker with `P0` and a visitor each `GET /listings?price_max=7000&available_by=<TODAY + 30>&pets=true&<the box>`, Then the two responses have the same id **set** and the same `total`, and the `north` listing is among the seeker's items with score 59 (the score never filters) — `test_matching.py::test_ac6_score_never_filters`
- [ ] AC7 Given a public listing, When `GET /listings/{id}` by the seeker with `P0`, Then `match` is set and `view_count` grows by 1; by a visitor, Then `match` null; a non-public listing is still 404 `not_found` for the seeker — `test_matching.py::test_ac7_listing_page_match`
- [ ] AC8 Given 25 public listings, When `GET /listings` (after a warm-up, `statements.clear()`), Then: no cookie → exactly 2 statements (as `0003a` AC8, which keeps passing unchanged); a seeker with a profile → exactly 4 (session, profile check, count, page); and the 4 do not grow with `limit=3` vs `limit=20` (no per-row query) — `test_matching.py::test_ac8_match_adds_two_statements_not_per_row`
- [ ] AC9 When `GET /listings?sort=match` with no cookie, Then 200 (not 422); `sort=foo` → 422 — `test_search.py::test_ac7_validation_rejects_bad_params` (amended: `"sort=match"` leaves `_BAD_QUERIES`) and `test_matching.py::test_ac9_sort_match_is_not_422`
- [ ] AC10 When either endpoint is called with a cookie (valid or expired), Then the 200 response has `Cache-Control: private`; without one, no `Cache-Control` header — `test_matching.py::test_ac10_cookie_responses_are_private`
- [ ] AC11 `explain` unit test (no database), four cases from a dict of `m_*` / `f_*` / `m_score`: all ones → agrees `[budget, move_in, area]`, differs `None`; `f_pets` with `m_household = 0` → differs `pets`; `f_smoking` and `f_pets` → differs `smoking`; `f_budget`, `m_move_in = 0.43`, `m_household = m_contract = 0` → differs `budget`, agrees `[area, parking, smoking]` (without the 0.5 rule it would be `[area, move_in, parking]`) — `test_matching.py::test_ac11_explain_rules`
- [ ] NF1 `make lint` clean; `make client` regenerates `schema.d.ts` with `MatchOut`, `ListingPublic.match`, `ListingSearchOut.sort`, `SearchSort` incl. `match`; the CI `web` job passes with the updated fixture — CI `api`, `web`
- [ ] NF2 Performance: with 5,000 public listings (a seed loop in the perf reviewer's run, not CI) and a seeker profile, `GET /listings?limit=20` (match order, no filters) p95 ≤ 150 ms over 50 local requests, and `EXPLAIN` of the page statement shows one sort over the filtered rows and no `SubPlan` — measured by the perf reviewer, numbers in the digest
- [ ] NF3 Privacy: no response field carries a profile value (only `score` and criterion codes); a visitor's or owner's response is byte-identical to today's apart from `match: null` and `sort` — AC3 + security reviewer

## Tests to write
`api/tests/test_matching.py` (new): AC1–AC8, AC9 (the 200 half), AC10 (integration), AC11 (unit, no DB), all
dates from `TODAY` (UTC). Amended existing tests (Scope "Tests and fixtures"): `test_search.py` (`PUBLIC_KEYS`,
`:256`, `_BAD_QUERIES`), `test_geocoding.py:326`, `test_applications.py` (via `PUBLIC_KEYS`), and the web search
fixture. E2E: none (`0006f`).

## Risks / open questions
- **Weights are the orchestrator's pick**, not Gilad's: budget 25, move-in 20, area 20, household 10, contract 10,
  parking 5, smoking 5, pets 5. They live in one dict; changing them is a one-line PR. Gilad can re-weight in the
  digest batch without blocking this spec.
- `d / 28` is a straight line inside the ±4-week window (an exact date 1.0, four weeks apart 0.0 but still
  passing); outside it the listing fails and is capped. Flexibility on either side forgives 14 days each
  (artboard "גמיש ±2 שבועות").
- A passing listing can score 55–58 and rank below a capped 59 (only when household, contract and parking all
  miss and move-in is 3–4 weeks off). Accepted: the order follows the shown score.
- The count stays one statement without the profile join, so `total` can never differ by caller (AC6).
- A seeker with a profile whose `area_ids` are all deactivated gets every listing capped at 59: acceptable (the
  profile page shows only active areas, `0006d`).
- `0003a` AC7 is amended (`sort=match` was a 422 placeholder); `0003a` is done, so the amendment lives here.
- `current_date` is the database's (UTC): a listing becomes "today" up to 3 hours off Israel time. Negligible
  for a ±4-week window.
- No open product questions.

## Verifier findings — one round, 10 findings, all applied
Verdict: **would reject as written**. Findings 1–3 turn `make test` / `make lint` red or make AC1's numbers
unreachable on the coder's first run; 4–5 make AC1 not exactly assertable or flaky. Each finding carries its exact
fix, so the spec can be marked verified once they are applied. Checklist: line 1 fails (findings 2, 4, 8); lines
2–10 pass. PRODUCT.md "Matching" (2026-11-11): no contradiction (cap 59, the failure shown as `differs`, smoking
and pets deal-breakers, household and contract soft, housing preferences only).
Checked and correct: AC1 rows 1–11 recomputed under the stated weights (all right once finding 1 is applied); AC8's
4 statements (`optional_user` → `resolve_session` is one `SELECT … JOIN sessions`, then `has_profile`, count, page;
no cookie → no session query, so `0003a` AC8 and `test_applications.py::test_ac8`'s 3-statement anonymous listing
page stay green); `m_score DESC, created_at DESC, id` is a total order; the compose Postgres runs `TimeZone =
Etc/UTC`.

1. (blocker) The formula table is not valid, exact SQL as written (checked on the compose Postgres):
   - `14·L.entry_flexible`: `ERROR: operator does not exist: integer * boolean`.
   - `d / 28` and `L.parking_spots / P.parking_needed` are integer division in Postgres (`12/28 = 0`,
     `1::smallint / 2::smallint = 0`): written as SQL text, row 4 scores 100 and row 10 scores 95. SQLAlchemy 2.0's
     `/` happens to emit `x / CAST(y AS NUMERIC)`; the spec must not depend on how the coder writes it.
   - "each a `float` 0–1" contradicts "Postgres `round(numeric)`, half away from zero": a float sum goes through
     `round(double precision)`, which rounds half to even (`round(92.5::float8) = 92`, `round(92.5::numeric) = 93`).
     No AC row catches it: row 10's 97.5 gives 98 both ways.
   - `m_score` is declared `int`, but `round(numeric)` and `least` return `numeric`.
   **Fix:** in Scope (`match_columns`) and Data: "`m_<c>` is `numeric` 0–1 (labels typed `Numeric`, Python
   `Decimal`), never `float`. A boolean enters arithmetic as `CASE WHEN … THEN 14 ELSE 0 END`. Both divisions are
   numeric: `d::numeric / 28` and `L.parking_spots::numeric / P.parking_needed` (in SQLAlchemy, `/` on integers;
   never `//` or `text()`). `raw = round(Σ WEIGHTS[c] · m_c)` on that numeric sum. `m_score = (CASE WHEN f_budget OR
   f_move_in OR f_area OR f_smoking OR f_pets THEN least(raw, 59) ELSE raw END)::int`." AC1 gains row 13 (finding 4)
   to pin the rounding.
2. (blocker) Existing tests and the web type check go red. Two sentences are wrong: Tests to write says "Every
   existing search / listing-page test keeps passing (they are anonymous)", and UI says "the current web ignores
   the new fields".
   - `test_search.py` `PUBLIC_KEYS` (`:19`) lacks `match`. It is checked by set equality at `:133` and `:161`, and
     `test_applications.py` imports it for `:492` and `:505`.
   - Two exact-body asserts on `GET /listings` lack `sort`: `test_search.py:256` (`{"items": [], "total": 25}`) and
     `test_geocoding.py:326` (`{"items": [], "total": 0}`).
   - AC9 names `test_search.py::test_ac7_invalid_params_are_422`. The real test is
     `test_ac7_validation_rejects_bad_params`, and its cases are the module tuple `_BAD_QUERIES` (`:276`, `"sort=match"`
     at `:288`), not a parametrization.
   - After `make client`, `ListingSearchOut.sort` is required. `web/src/features/search/__tests__/fixtures.ts`
     `page()` returns `{items, total}` typed `ListingSearchOut`, so the CI `web` job's `tsc` fails. `0003c` had the
     same fix for `lat` / `lng`.
   **Fix:** Scope gains a "Tests and fixtures" bullet:
   - `PUBLIC_KEYS` gains `"match"` (on top of `0006a`'s three keys).
   - `test_search.py:256` and `test_geocoding.py:326` also expect `"sort": "newest"`.
   - `"sort=match"` leaves `_BAD_QUERIES`.
   - `fixtures.ts` `page()` returns `sort: 'newest'` (test fixture only). With finding 3's default, `publicListing()`
     needs no `match`.
   AC9 names `test_search.py::test_ac7_validation_rejects_bad_params` (amended). Replace both sentences. NF1 adds
   "and the CI `web` job passes with the updated fixture".
3. (blocker) The service and router contract is missing, and one caller is overlooked:
   - `services/applications.py:104` (`apply`) calls `search_service.get_public_listing(db, listing_id)`. A new
     required `profile_user_id` breaks it, and `0005a` and `0006a` both edit `apply` already.
   - The spec gives the new parameters but no return types. The page now carries a match per row, and
     `ListingSearchOut.sort` needs the applied sort. Nor does it say where `explain` runs.
   - With no default, `ListingPublic.match: MatchOut | None` makes `ListingPublic.model_validate(listing)`
     (`routers/search.py:32`, `:57`) fail with "Field required", because the ORM row has no `match`.
   - `explain(row)` does not match AC11's "from a dict".
   - "Cache-Control … when a cookie was sent": `optional_user` returns `None` for an expired cookie, so the router
     cannot tell a cookie was sent from it alone.
   **Fix:** Scope states:
   - `search_listings(db, params, profile_user_id: uuid.UUID | None = None) -> tuple[list[tuple[Listing, MatchOut |
     None]], int, SearchSort]`: the page rows with their match, the total, the applied sort. It calls
     `explain(row._mapping)` once per row.
   - A new `get_public_listing_with_match(db, listing_id, profile_user_id: uuid.UUID | None) -> tuple[Listing,
     MatchOut | None]`, built on `_public_listings()` + `match_columns`. `get_public_listing(db, listing_id) ->
     Listing` keeps its signature (`return get_public_listing_with_match(db, listing_id, None)[0]`), so
     `services/applications.py` is untouched.
   - `explain(values: Mapping[str, Any]) -> MatchOut`.
   - `ListingPublic.match: MatchOut | None = None`: the default keeps building from the ORM row working; the router
     then sets `item.match`. In OpenAPI it is an optional nullable field.
   - The router sets `Cache-Control: private` on the 200 response when `COOKIE_NAME in request.cookies`.
4. (major) AC1 is not exactly assertable, and two rules go untested:
   - It says "`match` equals the row exactly", but only rows 1 and 4 give `agrees`. Add `agrees` per row (computed
     under the stated rule): (2) `[move_in, area, household]`; (3) `[budget, area, household]`; (5) `[budget,
     move_in, household]`; (6)–(10) and (12) `[budget, move_in, area]`; (11) `[move_in, household, contract]`.
   - Row 12 does not test the two `greatest(…, current_date)`: with both dates 10 days ago the raw difference is
     already 0. Replace it with `available_from = current_date - 40` and `P.move_in_date = current_date - 10` (by
     SQL) → 100, agrees `[budget, move_in, area]`. Without both `greatest`s it scores 59 (d = 30); with only the
     listing's, 93.
   - Add (13): `available_from` today + 37 and `P.parking_needed` 2 (spots 1). Raw 92.5 → **93** (`round(double)`
     would give 92). Differs `move_in` (gap 5 > parking's 2.5), agrees `[budget, area, household]`.
   - Add (14): `P.has_pets` + `pets_allowed` false + `accepted_households ["family"]`. Raw 85 → 59, differs `pets`
     (a failing criterion beats `household`'s larger soft gap), agrees `[budget, move_in, area]`.
   - Then add: "and that listing's item in `GET /listings` carries the same `match`". This proves search and the
     listing page share the formula.
5. (major) AC1–AC5 dates flake on the dev Mac. `make_listing` defaults `available_from` to
   `dt.date.today() + 30`, which is local time (Asia/Jerusalem). `make_profile` takes UTC today (`0006a` finding
   9), and the database's `current_date` is UTC. Between local midnight and 02:00/03:00, L0 lands on UTC today + 31
   against P0's + 30: d = 1, and row 1 scores 99. **Fix:** in Tests to write, `test_matching.py` takes
   `TODAY = dt.datetime.now(dt.UTC).date()` and sets every listing's `available_from` and every profile's
   `move_in_date` from it. L0 also sets `entry_flexible=False` explicitly (`make_listing` defaults it to `True`).
   Past dates are set by SQL relative to `current_date`.
6. (minor) AC2's "91" cannot be AC1 row 4, which needs a flexible profile; with P0 that listing scores 81.
   **Fix:** AC2 names its rows: 59 = L0 at price 7600; 100 = L0 (both of them); 91 = L0 with `available_from`
   today + 42 (d = 12).
7. (minor) AC6: with a cookie the order is `match`, without one it is `newest`, so "the same ids" must mean the
   same id **set**. "A capped listing is counted and returned" also needs one in the Given. **Fix:**
   - Given four L0-like listings priced ≤ 7000 with `pets_allowed`, located inside the box (`set_location`), one of
     them in area `north` (59). Add one located outside the box and one at 7600; `available_by` = today + 30.
   - Then the id sets and `total` are equal, and the `north` listing is in the seeker's items with score 59.
8. (minor) AC11 states properties, not cases, and the `differs` sentence reads two ways ("the failing ones first,
   then the largest"). **Fix:** In Data: "`differs` = the first criterion with `m_c < 1`, sorted by (not failing,
   −W·(1−m_c), `CRITERIA` index); `agrees` = the first 3 criteria with `m_c ≥ 0.5`, not failing and not `differs`,
   sorted by (−W·m_c, `CRITERIA` index)". AC11 pins four cases:
   - all ones → `[budget, move_in, area]`, `None`;
   - `f_pets` with `m_household = 0` → differs `pets`;
   - `f_smoking` and `f_pets` → differs `smoking`;
   - `f_budget`, `m_move_in = 0.43`, `m_household = m_contract = 0` → differs `budget`, agrees `[area, parking,
     smoking]`. Without the 0.5 rule it would be `[area, move_in, parking]`.
9. (minor) The 59 cap does not put every failing listing below every passing one. A passing listing scores at
   least 55, because budget, area, smoking and pets are all 1. So a listing that misses household, contract and
   parking with a move-in 3–4 weeks off (55–58) ranks under a capped 59. Pure score order keeps the shown % and the
   order consistent; sorting failing listings last would not. **Fix:** add to Risks: "A passing listing can score
   55–58 and rank below a capped 59 (only when household, contract and parking all miss and move-in is 3–4 weeks
   off). Accepted: the order follows the shown score."
10. (minor) This spec relies on `0006a`'s verifier fixes. That round proposes:
    - `make_profile(engine, user_id, area_id, **overrides) -> None` with a UTC move-in date (its findings 6 and 9);
    - `seeker_profiles` in the `db_engine` TRUNCATE (its finding 2). Without it every integration test here errors
      in the fixture.
    **Fix:** the Fixtures line reads "`make_profile(db_engine, seeker_id, gush_dan, **overrides)` (`0006a`)". If
    `0006a`'s final text differs, follow it.

## Digest (filled by orchestrator after verification)

    Spec 0006b - Match score API: score + explanation on search and the listing page   (verified, part 2 of 7, depends on 0006a)
    What a user can do after this: a seeker with a profile gets match {score 0-100, top-3 agrees, top-1 differs} on
             every GET /listings item and GET /listings/{id}, and search defaults to sort=match; a hard-filter
             failure is capped at 59 and shown, never hidden.
    Decisions I need from you (reply with numbers, non-blocking): 1. Weights budget 25, move-in 20, area 20,
             household 10, contract 10, parking 5, smoking 5, pets 5 (recommend: accept; one-line change later).
    KPIs this slice moves: apply rate per search session; share of applications to listings scoring >= 80.
    Acceptance targets: NF2 p95 <= 150 ms for a 20-item match-sorted page over 5,000 listings (perf reviewer) -
             AC8 anonymous search stays 2 statements, a seeker 4, never per row - NF3 no profile value in any response.
    Risks: SQL integer division / float rounding - mitigation: numeric everywhere, AC1 rows pin 92.5 -> 93.
             Local-vs-UTC date flake - mitigation: one UTC TODAY in tests.
    Reviewers: code, qa, perf, security   Estimated: 1 coder run, 1 review round
    Links: specs/0006b-match-score-api.md - PRODUCT.md "Matching" - design/screens-v1/Search.dc.html, Listing.dc.html
