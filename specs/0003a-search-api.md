---
id: 0003a
title: Anyone, logged in or not, searches live apartment listings through the API with price, rooms, entry-date and feature filters, sorted and paged, and opens one listing by id
status: done
depends_on: [0002a]
reviewers: [code, qa, perf]   # perf: the first public query path; qa: filter edge cases; no security: read-only, no new auth, exposure is pinned by AC2
estimate: 1 coder run
---

## Goal
After this ships, anyone (no session needed) can call `GET /listings?price_max=8000&rooms_min=3&pets=true&sort=price_asc`
and get the **live apartment** listings in active launch areas that match, with a total count for "38 דירות", and
`GET /listings/{id}` for one of them. Serves Dev Plan slice 3 (Seeker search), part a of two; part b (`0003b`) is the
web search page and the public listing page. PRODUCT.md rows: "Launch area — listings outside are hidden",
"Gender preference — hard filter on ROOM listings" (so rooms stay hidden until Slice 7, see Risks),
"Trust (MVP) — listing auto-expiry 3 months (90 days)" (expired = hidden).

## Scope
**In:**
- `api/app/schemas/search.py`: `SearchParams` (query model), `ListingPublic`, `ListingSearchOut` (see API).
- `api/app/services/search.py`: `search_listings(db, params) -> tuple[Sequence[Listing], int]` (page, total) and
  `get_public_listing(db, listing_id) -> Listing` (raises `ListingNotFoundError` from `services/listings.py`,
  reused, not redefined); one private `_public_listings()` returning the `select(Listing)` with the visibility
  predicate below, used by both, so the rule lives in one place.
- `api/app/routers/search.py`: `GET /listings` and `GET /listings/{listing_id}`, thin, tag `search`, included in
  `main.py`. A new file, not `routers/listings.py`, so this branch does not conflict with `0002a`'s review fixes.
- **Visibility predicate** (the only definition of "public"): `listings.status = 'active' AND listings.expires_at >
  now() AND listings.listing_type = 'apartment' AND areas.is_active` (inner join `areas` on `area_id`). Both
  endpoints use it; nothing else in this slice reads listings publicly.
- Tests: `api/tests/test_search.py` (new). `conftest.py` gains `make_owner(engine, email) -> uuid.UUID` (inserts a
  `users` row directly, `role='owner'`, `display_name='בעלים'`, `RETURNING id`) and `make_listing(engine, owner_id,
  area_id, **overrides) -> uuid.UUID` (`INSERT … RETURNING id` directly). Defaults: `listing_type='apartment'`,
  `city='גבעתיים'`, `street='כצנלסון'`, `rooms=Decimal('3.5')`, `floor=3`, `total_floors=5`, `size_sqm=95`,
  `price_ils=7200`, `available_from=today+30`, `entry_flexible=True`, `elevator=True`, `parking_spots=1`,
  `furnished='partial'`, `pets_allowed=True`, `arnona_ils=480`, `vaad_ils=150`, `description='דירה מוארת'`,
  `status='active'`, `expires_at=now()+90 days`; overrides may set any column including `created_at`. They bypass
  the service and its cap on purpose (tests need > 3 rows per owner); `0002a` tests keep using the HTTP `signup`
  helper. `test_search.py` defines its own copy of `0002a`'s `statements` fixture (`event.listen(db_engine,
  "before_cursor_execute", …)`); `test_listings.py` is not touched.
- `README.md`: one line under "Posting a listing locally": the curl for `GET /listings?price_max=8000`.
- `Makefile`: new target `dev-api` = `dev` without the `web` service (db + redis → migrate → seed → api + worker,
  waits on `/health` only), added to `.PHONY` and documented with a `##` comment like `dev`. Speed rule 2 lets an
  API spec build while a web spec holds port 5173, and `make dev` always starts `web`; this spec's session uses
  `make dev-api` for its own stack. `dev` is unchanged.
- No migration, no compose / CI / `.env.example` change.

**Out:**
- Map, geocoding and the "inside the area polygon" check: `0003c`, specced after Gilad picks a tile source (see
  Risks). This slice stores and returns no coordinates.
- Match score and "sorted by match" (`Search.dc.html` "ממוינות לפי התאמה", "התאמה 87%"): Slice 6.
- Room listings and the "looking to join" flow in search (the type filter on `SearchDesktop.dc.html`): Slice 7 and 8.
- Owner identity on the public listing (name, "מאומתת בטלפון", "מה בעל הדירה מחפש"): Slice 4/6/10.
- Saved searches ("שמור חיפוש") and alerts: a later slice (needs a table and the worker).
- Balcony filter ("מרפסת"): `listings` has no balcony column; added with the next listings-fields spec.
- Area filter: one active area today; `area_id` as a parameter arrives with the second area.
- Rate limiting public search: needs real client IPs behind the Slice 12 proxy (as `0001a`'s per-IP limits).
- Free-text search over description.

**New dependencies:** none.

## Data
None. No migration. Reads `listings` (`0002a`) joined to `areas` (`0000a`). No new index in this slice: the
perf reviewer measures (NF2) and an index migration is added in the fix round only if a target is missed.

## API
Both endpoints are **public**: no cookie required, a cookie is ignored (no `current_user` / `optional_user`
dependency, so no session query). Unmatched rows and unknown ids are never distinguishable from non-public ones.

`SearchParams` (FastAPI query model: `params: Annotated[SearchParams, Query()]`), every field optional:
| param | type / bounds | meaning |
| --- | --- | --- |
| `price_min`, `price_max` | `int`, 0..100000 | `price_ils BETWEEN` (inclusive). Model validator: `price_min <= price_max` when both set |
| `rooms_min`, `rooms_max` | `Rooms \| None = None` (the `Rooms` alias from `schemas/listing.py`: 1..20, multiple of 0.5) | `rooms BETWEEN` (inclusive). Validator: `min <= max` when both set |
| `available_by` | `date` | the seeker's move-in date: `Listing.available_from <= by OR (Listing.entry_flexible AND Listing.available_from - 14 <= by)` (artboard "גמיש ±2 שבועות"). The arithmetic is in SQL (`date - integer`), never on the Python date, so any valid `date` is safe (no `OverflowError`). An immediate listing (`available_from` ≤ today) matches every `available_by` from today on; a past `available_by` is accepted and simply matches less |
| `pets` | `bool` | `true` → `pets_allowed`. `false` or absent → no filter |
| `furnished` | `bool` | `true` → `furnished IN ('partial','full')`. `false` / absent → no filter |
| `elevator` | `bool` | `true` → `elevator`. `false` / absent → no filter |
| `parking` | `bool` | `true` → `parking_spots >= 1`. `false` / absent → no filter |
| `sort` | `Literal['newest','price_asc','price_desc']`, default `newest` | `newest`: `created_at DESC, id`; `price_asc`: `price_ils ASC, created_at DESC, id`; `price_desc`: `price_ils DESC, created_at DESC, id` (deterministic for paging) |
| `limit` | `int`, 1..50, default 20 | page size |
| `offset` | `int`, 0..10000, default 0 | rows to skip (bounded so a deep offset cannot be a slow scan) |
Unknown query params are ignored (FastAPI default). A cross-field failure is a 422 with a list `detail`.

`ListingPublic` (from attributes): `id`, `listing_type`, `city`, `street`, `rooms` (JSON number, the same
`PlainSerializer(float)` as `0002a`'s `ListingOut`), `floor`, `total_floors`, `size_sqm`, `price_ils`,
`available_from`, `entry_flexible`, `elevator`, `parking_spots`, `furnished`, `pets_allowed`, `arnona_ils`,
`vaad_ils`, `description`, `created_at`. **Not** `owner_id`, `area_id`, `status`, `updated_at`, `expires_at`:
the public never learns who owns what or when it lapses (AC2 pins the key set).
`ListingSearchOut`: `items: list[ListingPublic]`, `total: int` (rows matching the filters, ignoring
`limit`/`offset`).

| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | /listings | public | `SearchParams` (query) | 200 `ListingSearchOut`. Two statements over `filtered` = `_public_listings()` plus the filters: count = `select(func.count()).select_from(filtered.order_by(None).subquery())` (not `.with_only_columns`, which loses the join's left side), then page = `filtered.order_by(...per sort).limit().offset()`. `{"items": [], "total": 0}` when nothing matches; `items: []` with the real `total` when `offset >= total` | 422 validation (list `detail`) · 503 DB |
| GET | /listings/{listing_id} | public | path `uuid` | 200 `ListingPublic` when the row passes the visibility predicate | 404 `{"detail":"not_found"}` for an unknown id **and** for a paused, expired, room, or inactive-area listing (identical body; the owner of a paused listing gets 404 too — they have `/me/listings`) · 422 non-uuid id · 503 |

`GET /listings` and `0002a`'s `POST /listings` share a path; `GET /listings/{listing_id}` and `PATCH
/listings/{listing_id}` share a path; different methods, so FastAPI routes them independently.

## UI
None in this part. The search page and the listing page are `0003b`.

## Acceptance criteria
Fixtures: `gush_dan`, `make_owner`, `make_listing` (Scope). "Search" = `GET /listings` with no cookie unless stated.
- [ ] AC1 Given in `gush_dan` a live apartment A, a paused apartment B, an apartment C with `expires_at` 1 hour in the past, a live room D, and a live apartment E in a second area (`INSERT INTO areas (slug, name_he, geom, is_active) VALUES ('closed-area', 'סגור', ST_GeomFromText(:wkt, 4326), false) RETURNING id` with `wkt = scripts.seed.GUSH_DAN_WKT`) — B's owner is created with `signup(client, outbox, "owner-b@example.com", "owner")` and its id read from `GET /me` (as `0002a` AC1), A/C/D/E use `make_owner` — When search with no params, Then 200 `{"items": [A], "total": 1}`; When the same request carries a seeker's `rent_session` cookie, and again an owner's (the owner of B), Then the identical body — `api/tests/test_search.py::test_ac1_only_live_apartments_in_active_areas`
- [ ] AC2 Given A from AC1, When search, Then `items[0]` has exactly the `ListingPublic` keys (set equality: no `owner_id`, `area_id`, `status`, `updated_at`, `expires_at`) and `rooms` is the JSON number `3.5`; When `GET /listings/{A.id}`, Then 200 with the same key set and values — `api/tests/test_search.py::test_ac2_public_shape_hides_owner_and_lifecycle`
- [ ] AC3 Given live apartments priced 5000 / 6500 / 8000 / 9000 with rooms 2 / 3 / 3.5 / 5, When `price_min=6500&price_max=8000`, Then exactly the 6500 and 8000 ones (bounds inclusive); When `rooms_min=3&rooms_max=3.5`, Then the same two; When `rooms_min=5`, Then only the 9000 one; and `total` equals `len(items)` each time — `api/tests/test_search.py::test_ac3_price_and_rooms_ranges`
- [ ] AC4 Given live apartments that differ only in `pets_allowed`, `furnished` (`none` / `partial` / `full`), `elevator` and `parking_spots` (0 / 2), When `pets=true`, `furnished=true`, `elevator=true`, `parking=true` (one at a time, then all four together), Then exactly the rows that have the feature (`furnished=true` returns `partial` and `full`); When `pets=false`, Then the same rows as no param — `api/tests/test_search.py::test_ac4_feature_filters_true_only`
- [ ] AC5 Given live apartments with `available_from` = yesterday (immediate), today+20 (`entry_flexible=false`), today+20 (`entry_flexible=true`), today+40 (`entry_flexible=true`), When `available_by=today+10`, Then the immediate one and the flexible +20 one (20 − 14 ≤ 10); When `available_by=today+20`, Then the first three; When `available_by=today+26`, Then all four (40 − 14 ≤ 26) — `api/tests/test_search.py::test_ac5_available_by_honours_flexible_entry`
- [ ] AC6 Given 25 live apartments with distinct `created_at` (1 s apart) and prices where at least two tie, When search, Then 20 items newest first and `total: 25`; When `offset=20`, Then the remaining 5 and no id repeats across the two pages; When `offset=25`, Then `items: []` and `total: 25`; When `sort=price_asc`, Then prices non-decreasing and tied prices ordered newest first; When `sort=price_desc`, Then non-increasing; When `limit=5&offset=5&sort=price_asc`, Then items 6–10 of the `price_asc` order — `api/tests/test_search.py::test_ac6_sort_and_paging_are_deterministic`
- [ ] AC7 Given `price_min=9000&price_max=8000`, `rooms_min=4&rooms_max=3`, `rooms_min=2.3`, `rooms_max=0.5`, `price_max=100001`, `price_min=-1`, `price_max=8000.5`, `limit=0`, `limit=51`, `offset=-1`, `offset=10001`, `sort=match`, `available_by=2027-02-30`, `pets=maybe`, When search, Then 422 with a list `detail` each; Given `price_max=8000&colour=red`, Then 200 (unknown params ignored); Given `available_by=9999-12-31` and `available_by=0001-01-01`, Then 200 each (no 500) — `api/tests/test_search.py::test_ac7_validation_rejects_bad_params`
- [ ] AC8 Given 25 live apartments, When search with `price_min=1&rooms_min=1&pets=true&sort=price_asc` and with no params, Then each request executes exactly 2 SQL statements, both containing `FROM listings` (counted with a `before_cursor_execute` listener on the test engine, as `0002a` AC6), however many items are returned — `api/tests/test_search.py::test_ac8_search_is_two_statements`
- [ ] AC9 Given A, B, C, D, E from AC1, When `GET /listings/{id}` for each with no cookie, Then 200 for A and 404 `{"detail":"not_found"}` with identical bodies for B, C, D, E and a random uuid; When B's owner (the `signup` client from AC1) requests B with their cookie, Then 404; When `GET /listings/not-a-uuid`, Then 422 — `api/tests/test_search.py::test_ac9_public_listing_by_id`
- [ ] NF1 `make lint` clean (ruff, mypy --strict); `make client` regenerates `web/src/api/schema.d.ts` with `get` on `/listings` and `/listings/{listing_id}` (the CI `web` job runs it) — CI `api` and `web` jobs
- [ ] NF2 Performance, measured by the perf reviewer and written into the digest: with 10,000 live apartments seeded on a scratch database (`make_listing` in a loop, prices 2000–15000, rooms 1–6), `EXPLAIN (ANALYZE, BUFFERS)` of the count and page statements for (a) no params, (b) `price_max=8000&rooms_min=3&sort=price_asc`, (c) `offset=10000` each executes in **< 50 ms** on the dev Mac; if any misses, the fix round adds a migration `0004_listings_search_index` with the index the plan calls for (with `downgrade`) and re-measures — perf review
- [ ] NF3 One visibility predicate: `_public_listings()` is the only place in `services/search.py` that states `status`, `expires_at`, `listing_type` or `areas.is_active`; both endpoints go through it — checked by the code reviewer (and AC1 + AC9 prove they agree)

## Tests to write
Integration (Postgres via `TEST_DATABASE_URL`; `db_engine` truncation already covers `listings, sessions, users,
areas`): AC1–AC9, rows made with `make_owner` / `make_listing`; AC1 and AC9's cookies come from `0002a`'s
`signup` helper (`redis_clean` + `outbox`). Unit: none beyond AC7 (validation through the endpoint). E2E: none
(API only; `0003b` covers the browser flow). NF2 is a reviewer measurement, not a CI test.

## Risks / open questions
- **Product assumptions taken by the orchestrator (2026-11-10), for Gilad's batch approval via the digest;
  the coder follows them as written:** (1) search and the listing page are **public**, no login to browse
  (applying needs login, Slice 4); (2) **no map** in `0003a`/`0003b` — the list ships first, the map is `0003c`
  (decision below); (3) default sort is **newest**, plus price up/down, until Slice 6's match score; (4) the
  entry-date filter means "available by my move-in date", and a flexible listing counts 14 days earlier; (5)
  room listings stay out of search and the public page until Slice 7 adds the gender field (`0002a` assumption
  4); (6) the public listing shows **no owner identity** and the street name without a house number (as the
  artboard); (7) "מרוהטת" = partially or fully furnished.
- **Decision for `0003c` (map), not blocking this spec:** PRODUCT.md names MapLibre + OSM tiles + Nominatim. The
  public OSM tile server's usage policy does not allow it as an app's tile CDN beyond light use, and Nominatim's
  public instance allows ≤ 1 request/s with no bulk geocoding. Options: (a) MapTiler or Stadia free tier (needs
  an API key, a free-tier cap), (b) Protomaps PMTiles for Israel self-hosted on R2 (no key, needs R2 — same
  question as `0002c` photos), (c) public OSM tiles while traffic is tiny, switching before launch. Recommend
  (b) once R2 is approved, (c) until then. Geocoding on create via public Nominatim from the arq worker (1/s,
  cached on the row) fits the free tier in every option.
- Rooms are hidden although owners can post them (`0002b` offers "חדר בדירת שותפים"). If Gilad prefers, Slice 7
  can be pulled forward or the type option hidden in the wizard; both are spec edits outside this slice.
- `offset` paging re-reads skipped rows; bounded at 10,000 and measured in NF2. Keyset paging only if a real
  dataset makes NF2 fail at the bound.
- No rate limit on a public endpoint: scraping is possible but the data is public by design; per-IP limits need
  real client IPs behind the Slice 12 proxy (FOLLOWUPS `0001a` per-IP entry covers the mechanism).
- `expires_at > now()` is evaluated per statement; a listing expiring between the count and the page statement
  can make `total` one higher than the rows across all pages. Accepted (sub-second window, display only).
- This branch starts from `spec/0002a-listings-api` (PR #5, open) per Speed rule 3 and rebases after it merges;
  new files only, plus `main.py` (one `include_router` line), `conftest.py` (two helpers) and `README.md`.

Changes after verifier round 1 (2026-11-10): B's owner comes from `signup` so AC1/AC9 have a real cookie; the
inactive area's full `INSERT`; `make_listing` defaults listed (stripped city, relative date); `available_by` is one
SQL predicate with the arithmetic in SQL, and AC7 gains the extreme dates; the count is built over a subquery of
`filtered`; the `statements` fixture is copied into `test_search.py`; rooms reuse the `Rooms` alias.

Verifier notes (2026-11-10): round 1 rejected with 6 findings, all applied above; one verifier round per spec,
so the orchestrator set `verified`.

## Digest (filled by orchestrator after verification)

    Spec 0003a — Search API: public search + listing by id   (verified, part 1 of 2, branches from PR #5)
    What a user can do after this: anyone, without logging in, gets live apartment listings filtered by price, rooms, entry date and pets / furnished / elevator / parking, sorted newest or by price, 20 per page with a total count, and opens one by id.
    Decisions I need from you (reply with numbers; the build runs on the recommendations meanwhile):
      1. Search and the listing page are public, no login to browse (recommend: accept; applying needs login in Slice 4).
      2. List first, map later: no map or geocoding in 0003a/b; the map is 0003c (recommend: accept).
      3. Map tiles for 0003c: (a) MapTiler/Stadia free tier with a key, (b) Protomaps tiles self-hosted on R2, (c) public OSM tiles while traffic is tiny (recommend: c now, b once R2 is approved).
      4. Default sort newest, plus price up/down, until Slice 6's match score (recommend: accept).
      5. Entry-date filter = "available by my move-in date"; a flexible (±2 weeks) listing counts 14 days earlier (recommend: accept).
      6. The public listing shows no owner name; the street is shown without a house number (recommend: accept).
      7. Room listings stay hidden from search until Slice 7, while the wizard keeps offering "room" (recommend: keep it, pre-launch; or hide the option until Slice 7).
    KPIs this slice moves: searches per visitor, listing views (first demand-side numbers).
    Acceptance targets: NF1 ruff + mypy --strict clean, client regenerated · NF2 each search statement < 50 ms at 10,000 listings, else an index in the fix round · NF3 one visibility rule for both endpoints.
    Risks: a paused / expired / room listing leaking into public results — mitigation: one predicate, AC1 + AC9 prove both endpoints agree, AC2 pins the public key set (no owner id).
    Reviewers: code, qa, perf   Estimated: 1 coder run, 1 review round
    Links: specs/0003a-search-api.md · PRODUCT.md "Launch area", "Gender preference", "Trust (MVP)" · design/screens-v1/Search.dc.html, SearchDesktop.dc.html (filters)

    Spec 0003a — Search API: public search + listing by id   MERGED 475f686 (PR #7, 2026-11-10)
    Shipped: anyone, with or without a cookie, calls GET /listings (price / rooms ranges, available_by with ±14 days for
             flexible entry, pets / furnished / elevator / parking, sort newest | price_asc | price_desc, limit ≤ 50, offset ≤
             10,000) and gets {items, total} of live apartments in active areas only; GET /listings/{id} is 200 for those and
             the same 404 for unknown, paused, expired, room or inactive-area ids; no owner_id / area_id / status / expires_at
             in the response. Plus `make dev-api` (dev without the web, for API specs while a web spec holds 5173).
    Demo: 1) make dev-api; sign up as an owner (code in .outbox/) and POST a listing with the README "Posting a listing" curl
          2) curl 'http://127.0.0.1:8005/listings?price_max=8000' → {"items":[…], "total": 1}, no cookie needed
          3) PATCH that listing {"status":"paused"} → GET /listings total 0 and GET /listings/{id} 404 {"detail":"not_found"}
    Tests: +0 unit, +10 integration (AC1–AC9 by name, AC8 twice; 133 vs 123 on main), +0 e2e   CI on the final head bdf0b64: api 54s · web 55s · e2e 2m26s
    NF2 (10,000 live apartments, warm, EXPLAIN ANALYZE): (a) no params count 6.7 ms / page 9.9 ms · (b) price_max=8000&rooms_min=3
         &sort=price_asc 5.5 / 5.9 ms · (c) offset=10000 6.8 / 10.9 ms — all < 50 ms, seq scans, all shared-buffer hits; no index
    Findings: 0 blockers, 0 majors, 0 waived, 5 minors logged in FOLLOWUPS (shared rooms serialiser, repeated params last-wins,
              two notes for 0003b: omit empty params, map 422 by type/loc; search index at ~50k listings), 6 nits dropped
    Changed in PRODUCT.md: nothing (the 7 product assumptions in Risks stand, pending Gilad's batch approval of the digest above)
    Heads-up: FOLLOWUPS' 0002a entry "visible_characters_only lets invisible fillers through … do before 0003a" is still open,
              and listings are public from this PR on (city / street / description); worth a small spec before launch, not a blocker.
    Next spec I propose: 0003b — Search web (verified; depends on 0003a + 0002b, so it starts once 0002b's PR is open and 5173 is free)
