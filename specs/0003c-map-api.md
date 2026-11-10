---
id: 0003c
title: Live listings get an approximate map location from their city and street (Nominatim, in the worker), and public search can filter by a map bounding box and returns that approximate point
status: verified
depends_on: [0003a]
reviewers: [code, qa, perf, security]   # perf: new spatial predicate on the public search path; security: a home's location (PII-adjacent), outbound HTTP to a third party, new config; qa: bbox and failure edge cases
estimate: 1 coder run
---

## Goal
After this ships, every live listing gets an **approximate** point on the map within seconds of being posted or
having its address changed: the arq worker geocodes `city` + `street` (street name only, house number dropped) with
Nominatim, at most one request per second, cached, and stores a point offset by up to ~200 m from Nominatim's
street point. Anyone can call `GET /listings?west=34.75&south=32.00&east=34.85&north=32.10` and get only the
listings whose approximate point is inside that box, and every public listing carries `lat` / `lng` (or `null`
when it has no point yet). A listing whose address cannot be found stays live and searchable; it is just absent
from map results. Serves Dev Plan slice 3 (Seeker search), part c of four; part d (`0003d`) is the web map.
PRODUCT.md rows: "Stack — MapLibre+OSM tiles, Nominatim", "Search — the street without a house number",
"Launch area — Gush Dan only", "Pricing — free; free-tier infrastructure".

## Scope
**In:**
- Migration `api/alembic/versions/0004_listing_location.py` (revision `"0004"`, down `"0003"`) and the matching
  model changes in `api/app/models/listing.py` (see Data). Autogenerate must see no diff
  (`test_migrations.py::test_ac4_autogenerate_sees_no_diff_with_postgis_extensions` stays green).
- `api/app/services/geocoding.py` (new; the only module that talks to a geocoder):
  - `Point = tuple[float, float]` (lng, lat); `Envelope = tuple[float, float, float, float]` (west, south, east,
    north).
  - `class GeocoderUnavailable(Exception)` with `stop_sweep: bool` (transient failure; `True` for HTTP 429/403,
    "we are being throttled or blocked, stop asking this run").
  - `class Geocoder(Protocol)`: `min_interval_s: float`; `geocode(city: str, street: str, envelope: Envelope) ->
    Point | None` (`None` = definitively not found; raises `GeocoderUnavailable` for anything transient).
  - `street_query(street: str) -> str`: the street with every whitespace-separated token that is a house number
    removed (`^\d+[\u05d0-\u05ea]?$`, e.g. `12`, `12\u05d0`), whitespace collapsed. Called by every geocoder.
    An empty result means not found, without a request.
  - `NominatimGeocoder(client: httpx.Client)`, `min_interval_s = 1.1`. One `GET /search` with query params
    `street=<street_query>`, `city=<city>`, `countrycodes=il`, `format=jsonv2`, `limit=1`, `accept-language=he`,
    `viewbox=<west>,<north>,<east>,<south>`, `bounded=1`. The client is built once by `get_geocoder()` with
    `base_url=settings.nominatim_url`, `headers={"User-Agent": settings.nominatim_user_agent}` (no `From`, no
    `Referer`, no email anywhere), `timeout=3.0`. Response handling: 200 + `[]` → `None`; 200 + `[{"lat": "...",
    "lon": "..."}, ...]` → the first item as floats, `None` if non-finite or outside the envelope; 429 or 403 →
    `GeocoderUnavailable(stop_sweep=True)`; any other non-200, `httpx.HTTPError` (timeouts, connect errors),
    invalid JSON or a malformed payload → `GeocoderUnavailable(stop_sweep=False)`.
  - `FakeGeocoder`, `min_interval_s = 0`: no network; a deterministic point inside the middle half of the envelope
    derived from `sha256(city + "|" + street_query)`. The default backend (dev, CI, e2e), like `EMAIL_BACKEND=file`.
  - `get_geocoder() -> Geocoder` (`lru_cache`), chosen by `settings.geocoder`.
  - `approximate_point(listing_id: uuid.UUID, point: Point, secret: str) -> Point`: Nominatim's point plus a
    deterministic offset that is **never zero** and at most `JITTER_DEG = 0.002` (~220 m north-south, ~190 m
    east-west at 32 N) on each axis. With `h = hmac.new(secret, b"geo:" + listing_id.bytes, sha256).digest()`, per
    axis: `u` = two bytes of `h` as an unsigned int, sign = the low bit of a third byte, `k = ±(1 + u % 20)`,
    offset = `k * 0.0001`; the result is `round(coordinate + offset, 4)`. So each axis moves by 0.0001 to 0.0020.
    Same listing, same point; two listings on the same street get different points (no stacked pins), and the
    stored point is never the street point.
  - `geocode_pending(db: Session, redis: RedisClient, geocoder: Geocoder, *, secret: str, key_prefix: str = "geo:",
    clock=time.monotonic, sleep=time.sleep) -> dict[str, int]` (counts: `located`, `not_found`, `retry`,
    `failed`, `cached`; or `{"skipped": 1}`): one sweep, described under "Sweep" below. Every Redis key it uses
    starts with `key_prefix`. The worker uses the default; tests pass `key_prefix="test-geo:"`, so a test sweep
    never touches or waits on the keys of the spec stack's running worker, which shares the dev Redis.
- `api/app/worker.py`: `async def geocode_listings(ctx) -> dict[str, int]` runs one sweep in
  `asyncio.to_thread` with a fresh `get_sessionmaker()` session, `get_redis()`, `get_geocoder()` and
  `get_settings().secret_key`; registered as `cron_jobs = [cron(geocode_listings, second={0, 10, 20, 30, 40, 50},
  unique=True)]`. `ping` stays. One `log.info` per sweep with the counts only (never a city, street or point).
  At import, `logging.getLogger("httpx").setLevel(logging.WARNING)`: at INFO, httpx logs every request URL, and
  that URL holds the street and city.
- `api/app/services/listings.py` `update_listing`: when the patch changes `city`, `street` or `area_id` (the merged
  value differs from the current row), the same `UPDATE` also sets `location = NULL`, `geocode_status = 'pending'`,
  `geocode_attempts = 0`. A patch that re-sends the current value, or changes any other field, leaves them alone.
  `create_listing` needs no change (the server defaults make a new row `pending`).
- `api/app/schemas/search.py`: `SearchParams` gains `west`, `east` (`float`, `-180..180`), `south`, `north`
  (`float`, `-90..90`), all `Field(allow_inf_nan=False)`, all optional; model validator: all four or none,
  `west < east`, `south < north` (no antimeridian boxes). `ListingPublic` gains `lat: float | None`, `lng: float |
  None` (the approximate point; `null` until located). Module docstring updated (the public shape now includes
  the approximate point).
- `api/app/services/search.py`: `_filtered` adds, when the bbox is set, `ST_Intersects(listings.location,
  ST_MakeEnvelope(west, south, east, north, 4326)::geography)` (a `NULL` location never matches). `_public_listings`
  adds `.options(undefer(Listing.lat), undefer(Listing.lng))` so both endpoints load the point in the same
  statement (still exactly two statements per search, one per listing page). The visibility predicate is unchanged.
- `api/app/config.py` `Settings`: `geocoder: Literal["fake", "nominatim"] = "fake"`, `nominatim_url: str =
  "https://nominatim.openstreetmap.org"`, `nominatim_user_agent: str = "rent-app-dev/0.0.1"`. Validators:
  `nominatim_user_agent` stripped, 3..200 chars, must not contain `@` (Nominatim policy wants an identifying UA;
  Gilad's rule: no email in it); the message names the rule, never the value. In the existing https block, placed
  **after** the `EMAIL_BACKEND` check (the `match=` raises of `test_https_web_origin_refuses_dev_defaults` depend
  on that order): `geocoder` must be set explicitly (like `email_backend`; message `GEOCODER must be set
  explicitly when WEB_ORIGIN is https`), and with `geocoder == "nominatim"` the user agent must not start with
  `rent-app-dev`.
- `.env.example`: a new block (comment: `fake` = deterministic points, no network, the default for dev, CI and
  e2e; `nominatim` = the public OSM instance, ≤ 1 request/s, a real identifying user agent required in
  production): `GEOCODER=fake`, `# NOMINATIM_URL=https://nominatim.openstreetmap.org`,
  `NOMINATIM_USER_AGENT=rent-app-dev/0.0.1` (no spaces: `infra/dotenv.awk` forbids them; production sets a value
  such as `rent-app/1.0 (+https://<domain>)` in the host's secret env, not through `.env`).
- `infra/docker-compose.yml` `worker.environment`: `GEOCODER: ${GEOCODER:-fake}`, `NOMINATIM_URL:
  ${NOMINATIM_URL:-https://nominatim.openstreetmap.org}`, `NOMINATIM_USER_AGENT:
  ${NOMINATIM_USER_AGENT:-rent-app-dev/0.0.1}`. The `api` service needs none (it never geocodes). CI's e2e job
  runs `make dev` with no `.env`, so it gets `fake` and never calls Nominatim.
- `api/pyproject.toml`: move `httpx==0.28.1` from the `dev` group to `dependencies` (same version, already in
  `uv.lock`; re-lock with `uv lock`).
- Tests (see AC list): new `api/tests/test_geocoding.py`, `api/tests/test_map_search.py`, `api/tests/test_worker.py`;
  additions to `test_migrations.py` (AC1; and `_LISTINGS_CHECKS`, which `test_ac10_listings_roundtrip` compares
  exactly at `head`, gains `ck_listings_geocode_status`, `ck_listings_geocode_attempts`,
  `ck_listings_location_status`), `test_config.py` (`_HTTPS_READY` gains `"geocoder": "fake"` so the existing
  https tests keep passing; `test_https_web_origin_refuses_dev_defaults` also `delenv`s `GEOCODER`,
  `NOMINATIM_URL`, `NOMINATIM_USER_AGENT` with the others and does `monkeypatch.setenv("GEOCODER", "fake")` next
  to its `EMAIL_BACKEND` setenv, before its final positive assertion); `test_search.py`'s `PUBLIC_KEYS` gains
  `lat`, `lng` (its AC2 then pins the new shape). `conftest.py` gains: `set_location(engine, listing_id, lng, lat)`
  (sets `location` and `geocode_status='ok'` with one `UPDATE … ST_SetSRID(ST_MakePoint(:lng, :lat),
  4326)::geography`); fixture `geo_clean` (deletes Redis keys `test-geo:*` before the test, as `redis_clean` does
  for `otp:*`; it never touches the worker's `geo:*` keys); an **autouse**
  fixture `no_network` that monkeypatches `httpx.HTTPTransport.handle_request` to raise
  `RuntimeError("network disabled in tests")` (Starlette's `TestClient` uses its own transport and is unaffected).
- `web/src/features/search/__tests__/fixtures.ts`: `publicListing` defaults gain `lat: null, lng: null`, so the CI
  `web` job's `tsc` passes once `make client` regenerates `ListingPublic` (test fixture only; no web app code).
- `README.md`: one line under the search curl: the bbox example, and one line in "Configuration" naming
  `GEOCODER`.

**Sweep** (`geocode_pending`, one call = one sweep; the worker runs one every 10 s). Keys are written with the
default prefix `geo:`; tests use `test-geo:` (see `key_prefix`):
0. Backoff: if `geo:pause` exists, return `{"skipped": 1}` at once, with no lock and no query.
1. Take the lock: `SET geo:sweep-lock 1 NX EX 60`; if not acquired, return `{"skipped": 1}` with no query. The lock
   is deleted in a `finally` at the end. One sweep at a time across workers and overlapping cron runs.
2. Select up to `SWEEP_BATCH = 20` rows: `listings.id, area_id, city, street` plus the area's envelope
   (`ST_XMin/ST_YMin/ST_XMax/ST_YMax(areas.geom)`), joined to `areas` with `areas.is_active`, where
   `geocode_status = 'pending' AND status = 'active' AND expires_at > now()` (live, any `listing_type`; paused or
   expired rows wait until they are live again), `ORDER BY updated_at, id`.
3. For each row: cache key `geo:v1:` + `sha256(f"{area_id}|{city}|{street_query(street)}")` hex. A hit
   (`[lng, lat]` JSON, or `"none"`) is used without calling the geocoder (`cached += 1`). On a miss: if
   `street_query(street) == ""`, the result is `None` with no call (and `"none"` is cached); else stop the sweep
   if `clock() - start >= SWEEP_BUDGET_S (6.0)`, otherwise call `geocoder.geocode(city, street_query(street),
   envelope)` (the sweep passes the cleaned street; `NominatimGeocoder` applies `street_query` again, which is
   idempotent, for AC7), then `sleep(geocoder.min_interval_s)` when it is > 0 (after **every** geocoder call,
   lock still held, so no two requests are ever < 1.1 s apart, within or across sweeps). Cache a point for 30
   days and `None` as `"none"` for 7 days; a `GeocoderUnavailable` is never cached.
4. Write, guarded against a concurrent address change: `UPDATE listings SET … WHERE id = :id AND geocode_status =
   'pending' AND area_id = :area_id AND city = :city AND street = :street` (the values the sweep read). Point →
   `location = approximate_point(id, point, secret)`, `geocode_status = 'ok'` (`located += 1`, cache hits
   included). `None` → `geocode_status = 'not_found'`. `GeocoderUnavailable` → `geocode_attempts += 1`, and
   `geocode_status = 'failed'` when it reaches `MAX_ATTEMPTS = 5`; then **every** `GeocoderUnavailable` ends the
   sweep after this write and sets `SET geo:pause 1 EX 300` (`EX 3600` when `stop_sweep`, i.e. 429/403), so an
   outage pauses geocoding instead of spending attempts: five attempts span at least 20 minutes, and a block is
   retried hourly, not every 10 s. Commit per row. `updated_at` is not touched (it is the owner's edit time).
5. Redis or Postgres errors propagate (arq logs the failed run; the next run retries; no row is changed).

**Out:**
- The web map, pins, list/map toggle and the listing-page map: `0003d`.
- Checking the point against the area **polygon** (only the area's bounding box bounds the geocoder), hiding
  listings that geocode outside the area, and telling the owner their address was not found: Risks question 2.
- Rejecting or stripping a house number in the `street` field itself (public text): Risks question 3.
- Re-geocoding `not_found` / `failed` rows without an address change (an admin retry is Slice 11).
- Distance sorting, "near the light rail" lines, nearby places: later slices.
- Rooms on the map: they are geocoded (live rows of any type) but stay hidden from search until Slice 7.
- Self-hosting Nominatim or a paid geocoder: only if the public instance's policy or limits are hit (PRODUCT
  "Pricing" needs Gilad for a paid one).
- The search index from FOLLOWUPS (`0003a` perf minor) becomes `0005_…` when it is needed.

**New dependencies:** `httpx==0.28.1` moves from dev to runtime (the Nominatim client; already locked, no new
package). No `respx` (tests use `httpx.MockTransport`), no `shapely`.

## Data
Migration `0004_listing_location` on `listings`:
| column | type | notes |
| --- | --- | --- |
| `location` | `geography(Point, 4326)` NULL | the **approximate** point (`approximate_point`), never Nominatim's raw point; geoalchemy2 `Geography(geometry_type="POINT", srid=4326, spatial_index=False)` in both the migration and the model |
| `geocode_status` | `text NOT NULL DEFAULT 'pending'` | `CHECK ck_listings_geocode_status: geocode_status IN ('pending', 'ok', 'not_found', 'failed')` |
| `geocode_attempts` | `smallint NOT NULL DEFAULT 0` | `CHECK ck_listings_geocode_attempts: geocode_attempts BETWEEN 0 AND 5` |
Plus `CHECK ck_listings_location_status: (geocode_status = 'ok') = (location IS NOT NULL)` and index
`ix_listings_location` `USING gist (location)`. The model declares the three columns, the three CHECKs and the
index exactly as the migration does, plus two **deferred** read-only `column_property`s, `lat =
ST_Y(location::geometry)` and `lng = ST_X(location::geometry)`, which only `_public_listings()` undefers (owner
endpoints and `INSERT … RETURNING` never load them; `ListingOut` is unchanged).

Backwards compatibility: additive; existing rows get `pending` / `0` / `NULL` from the defaults and the worker
locates the live ones on its first sweeps. The running app (0003a/b) ignores the new columns. `downgrade` drops
the index, the three CHECKs and the three columns (the points are lost and recomputed after a re-upgrade, since
every row is `pending` again). The raw Nominatim point is kept only in the Redis cache (TTL 30 days), never in
Postgres and never in a response.

## API
| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | /listings | public (unchanged: no session dependency, a cookie is ignored) | `0003a`'s `SearchParams` plus optional `west`, `south`, `east`, `north` (all four or none) | 200 `ListingSearchOut`; every item has `lat` / `lng` (4 decimals, or `null`). With the bbox, only listings whose approximate point is inside it (so every item has non-null `lat` / `lng`), `total` counted the same way; still exactly two SQL statements | 422 (list `detail`): a partial bbox, `west >= east`, `south >= north`, out-of-range, `nan`, `inf`, non-numeric · 503 DB |
| GET | /listings/{listing_id} | public (unchanged) | path `uuid` | 200 `ListingPublic` with `lat` / `lng` | unchanged (404 `not_found`, 422, 503) |
No new endpoints. The worker job is not an endpoint (no auth surface). Owner endpoints are unchanged in shape.

## UI
None in this part. `0003d` consumes `lat` / `lng` and the bbox params. The only web file touched is the search
test fixture (Scope).

## Acceptance criteria
"Stub geocoder" = a test class with `min_interval_s` and a `geocode` that records `(city, street, envelope)` and
returns or raises what the test sets. Sweeps in tests call `geocode_pending(db, get_redis(), stub, secret=...,
key_prefix="test-geo:")` directly with a fake `clock` / `sleep` pair (the clock advances by each `sleep` and by
whatever the stub adds), with `geo_clean`; the keys below (`sweep-lock`, `pause`, `v1:…`) carry that prefix.
Hebrew test inputs are written as `\u` escapes; `KATZ = "\u05db\u05e6\u05e0\u05dc\u05e1\u05d5\u05df"` (the
`make_listing` default street), `GIV = "\u05d2\u05d1\u05e2\u05ea\u05d9\u05d9\u05dd"` (its default city).
- [ ] AC1 Given a fresh `_mig` database upgraded to `0003` with one area, one owner and one listing inserted by SQL, When upgraded to `0004`, Then that row has `geocode_status = 'pending'`, `geocode_attempts = 0`, `location IS NULL`; `ix_listings_location` exists and uses `gist`; an `UPDATE` setting `geocode_status = 'ok'` with a `NULL` location fails with `ck_listings_location_status`, and `geocode_attempts = 6` fails with `ck_listings_geocode_attempts`; When downgraded to `0003`, Then the three columns and the index are gone and the listing row is still there; When upgraded to head again, Then it succeeds — `api/tests/test_migrations.py::test_ac1_listing_location_migration_roundtrip`
- [ ] AC2 Given an owner (`signup`) who creates a listing through `POST /listings`, Then its row is `pending` with a `NULL` location; Given it is then located (`set_location`), When `PATCH {"price_ils": 7500}`, Then it stays `ok` with the same point; When `PATCH {"street": <KATZ>}` (the current value), Then it stays `ok`; When `PATCH {"street": "\u05d5\u05d9\u05e6\u05de\u05df"}`, Then `pending`, `NULL`, attempts `0`; Given it is located again, When `PATCH {"city": ...}` with a new city, and (after locating again) `PATCH {"area_id": <a second active area>}`, Then each resets it the same way; the `PATCH` responses' key set is unchanged (`ListingOut`) — `api/tests/test_geocoding.py::test_ac2_create_and_address_change_mark_pending`
- [ ] AC3 Given in `gush_dan` two live listings on (`GIV`, `KATZ`), one live on (`GIV`, `"\u05d5\u05d9\u05e6\u05de\u05df 12"`), one paused and one expired listing, all `pending`, and a stub returning `(34.8123, 32.0712)`, When one sweep runs, Then the stub was called exactly twice, with streets `KATZ` and `"\u05d5\u05d9\u05e6\u05de\u05df"` (house number dropped) and the `gush_dan` envelope `(34.74, 31.95, 34.95, 32.17)`; the three live rows are `ok` and each stored point equals `approximate_point(id, (34.8123, 32.0712), SECRET)` (read back with `ST_X/ST_Y(location::geometry)`, to 1e-9); the two `KATZ` listings have different points; the paused and expired rows are still `pending`; the result counts `located: 3, cached: 1`; When a new live `KATZ` listing is added and another sweep runs, Then the stub is not called and the row is `ok` (cache hit); with `caplog.set_level(logging.INFO)` for the whole test, the captured log contains neither `KATZ`, `GIV` nor `34.81` — `api/tests/test_geocoding.py::test_ac3_sweep_locates_live_pending_listings_with_cache`
- [ ] AC4 Given three live pending listings on three different streets and a stub with `min_interval_s = 1.1` that adds 0.5 s to the clock per call, When one sweep runs, Then `sleep` was called `[1.1, 1.1, 1.1]` (once after each call, none for cache hits); Given instead a stub that adds 3.0 s per call, Then exactly two calls are made (the budget of 6 s is spent before the third), the third row is still `pending` with attempts `0`; Given `test-geo:sweep-lock` is already set in Redis, When a sweep runs, Then it returns `{"skipped": 1}` and the stub is never called; after any normal sweep the lock key is gone — `api/tests/test_geocoding.py::test_ac4_sweep_paces_requests_holds_lock_and_stops_on_budget`
- [ ] AC5 Given a stub returning `None` for street A, Then A is `not_found`, `location` NULL, and the next sweep does not call the stub for a new listing on A (negative cache); `GET /listings` without a bbox still returns A with `lat: null, lng: null`, and with the bbox `west=34.74&south=31.95&east=34.95&north=32.17` it does not; Given a pending listing whose street is only `"12"`, Then it is `not_found` with no stub call; Given a stub raising `GeocoderUnavailable(stop_sweep=False)` for street B, Then after one sweep B is `pending` with attempts `1`, `test-geo:pause` exists with a TTL of at most 300 s, and a second sweep while it exists returns `{"skipped": 1}` with no stub call and no change; with the test deleting `test-geo:pause` between sweeps, after five failing sweeps B is `failed` with attempts `5`, and nothing was cached for B; Given two pending listings and a stub raising `GeocoderUnavailable(stop_sweep=False)` on the first call, Then the stub is called once (any outage ends the sweep) and the second row is untouched; Given the same with `stop_sweep=True` (429/403), Then the stub is called once, the first row has attempts `1`, the second is untouched, and `test-geo:pause` has a TTL above 300 s and at most 3600 s — `api/tests/test_geocoding.py::test_ac5_failures_keep_listing_live_and_off_the_map`
- [ ] AC6 Given a pending live listing and a stub that, while being called, updates that row's `street` to `"\u05d5\u05d9\u05e6\u05de\u05df"` through the engine (as a concurrent owner `PATCH` would), When the sweep writes its result, Then the guarded `UPDATE` matches no row: the listing is still `pending` with a `NULL` location; When the next sweep runs, Then the stub is called with the new street and the row becomes `ok` — `api/tests/test_geocoding.py::test_ac6_result_for_a_changed_address_is_dropped`
- [ ] AC7 Given settings with `geocoder="nominatim"`, `nominatim_url="https://nominatim.test"`, `nominatim_user_agent="rent-app-test/1.0"` (`get_settings` / `get_geocoder` caches cleared), Then `get_geocoder()` is a `NominatimGeocoder` whose client has that base URL, that `User-Agent` and a 3 s timeout; Given `NominatimGeocoder(httpx.Client(transport=httpx.MockTransport(handler), base_url="https://nominatim.test", headers={"User-Agent": "rent-app-test/1.0"}))`, When `geocode(GIV, KATZ + " 12\u05d0", (34.74, 31.95, 34.95, 32.17))`, Then exactly one `GET /search` whose decoded params are exactly `{street: KATZ, city: GIV, countrycodes: "il", format: "jsonv2", limit: "1", "accept-language": "he", viewbox: "34.74,32.17,34.95,31.95", bounded: "1"}`, header `User-Agent: rent-app-test/1.0`, no `From` header, no `@` in any header; a `[{"lat": "32.0712345", "lon": "34.8123456"}]` answer gives `(34.8123456, 32.0712345)`; `[]` gives `None`; a result outside the envelope gives `None`; a street that is only `"12"` gives `None` with no request; 429 and 403 raise `GeocoderUnavailable` with `stop_sweep=True`; 500, a handler raising `httpx.ReadTimeout`, a non-JSON body, `{}`, `[{"lat": "x"}]` and `[{"lat": "nan", "lon": "34.8"}]` raise it with `stop_sweep=False` — `api/tests/test_geocoding.py::test_ac7_nominatim_request_and_response_handling`
- [ ] AC8 Given a listing id and `(34.8123, 32.0712)`, Then `approximate_point` returns the same value twice, rounded to 4 decimals (`round(v, 4) == v`), and on each axis `0.0001 - 5e-5 <= abs(result - input) <= 0.002 + 5e-5` (so never the input point, for 20 random ids and deterministically); a different value for a different id and for a different secret; `street_query` maps `KATZ + " 12"`, `KATZ + "  12\u05d0 "`, `"12 " + KATZ` to `KATZ` and `"12"` to `""`, and keeps a token such as `"\u05d4-12"` that is not a bare number; `FakeGeocoder` returns the same point twice for the same address, a point inside the middle half of the envelope, and makes no HTTP request (the autouse `no_network` would raise) — `api/tests/test_geocoding.py::test_ac8_approximate_point_street_query_and_fake_geocoder`
- [ ] AC9 Given live apartments A at (34.80, 32.08) and B at (34.90, 32.15) (`set_location`), C `pending`, D `not_found`, and E paused at A's point, When `GET /listings?west=34.75&south=32.00&east=34.85&north=32.10`, Then `{"items": [A], "total": 1}` with A's `lng: 34.8, lat: 32.08`; When the bbox is the whole `gush_dan` envelope, Then A and B; When that bbox plus `price_max=7000` (A is priced 6000, B 9000), Then only A; When no bbox, Then A, B, C, D, with `lat` / `lng` `null` on C and D; When `GET /listings/{A}`, Then `lat: 32.08, lng: 34.8`; `GET /listings/{C}` gives `lat: null, lng: null` — `api/tests/test_map_search.py::test_ac9_bbox_filters_on_the_approximate_point`
- [ ] AC10 Given `west=34.7&south=32.0&east=34.9` (no `north`), `west=34.9&south=32.0&east=34.8&north=32.1` (west > east), `west=34.8&south=32.0&east=34.8&north=32.1` (equal), `south=32.1&north=32.0` with valid west/east, `north=90.5`, `east=180.5`, `west=nan`, `west=inf`, `west=abc`, When search, Then 422 with a list `detail` each; Given a valid bbox together with `0003a`'s filters, Then 200 — `api/tests/test_map_search.py::test_ac10_bbox_validation`
- [ ] AC11 Given 25 located live apartments, When search with a bbox plus `price_min=1&sort=price_asc` and with a bbox only, Then each request executes exactly 2 SQL statements (the `before_cursor_execute` counter of `test_search.py`, copied); and `test_search.py` (with `PUBLIC_KEYS` now including `lat`, `lng`), `test_listings.py`, `test_migrations.py` (with `_LISTINGS_CHECKS` now including the three new CHECKs) and `test_config.py` (with the `GEOCODER` env added to `test_https_web_origin_refuses_dev_defaults`) pass otherwise unchanged — `api/tests/test_map_search.py::test_ac11_bbox_search_is_two_statements`
- [ ] AC12 With `GEOCODER`, `NOMINATIM_URL`, `NOMINATIM_USER_AGENT` `delenv`ed first (a developer `.env` exports them into `make test`), `Settings` with only the required values has `geocoder == "fake"` and `nominatim_user_agent == "rent-app-dev/0.0.1"`; `nominatim_user_agent="rent-app (ops@example.com)"` and `""` raise a `ValidationError` whose text does not contain the value; with an https `WEB_ORIGIN` and `_HTTPS_READY` minus `geocoder`, a `ValidationError` naming `GEOCODER`; with https, `geocoder="nominatim"` and the dev user agent, a `ValidationError`; with https, `geocoder="nominatim"` and `"rent-app/1.0 (+https://rent.example)"`, valid — `api/tests/test_config.py::test_ac12_geocoder_settings`
- [ ] AC13 `app.worker.WorkerSettings.cron_jobs` holds exactly one job for `geocode_listings`, scheduled at seconds `{0, 10, 20, 30, 40, 50}` with `unique=True`; Given a live pending listing on the test database and `get_geocoder` monkeypatched to return a `FakeGeocoder`, When `await geocode_listings({})` runs (`pytest.mark.asyncio`), Then the listing is `ok` — `api/tests/test_worker.py::test_ac13_worker_sweeps_every_10_seconds`
- [ ] NF1 No network in tests or CI: the autouse `no_network` fixture is in `conftest.py`, and `httpx.get("https://nominatim.openstreetmap.org/status")` inside a test raises its `RuntimeError` (`api/tests/test_geocoding.py::test_nf1_tests_cannot_reach_the_network`); compose defaults the worker to `GEOCODER=fake`, so CI's e2e stack never calls Nominatim — test + code review
- [ ] NF2 Performance, measured by the perf reviewer and written into the digest: 10,000 live apartments located at random points inside the `gush_dan` envelope (`make_listing` + `set_location` in a loop, scratch database), `EXPLAIN (ANALYZE, BUFFERS)` of the count and page statements for (a) a 0.05 x 0.05 degree bbox, (b) the whole envelope with `price_max=8000&sort=price_asc` each executes in **< 50 ms** on the dev Mac, and (a) uses `ix_listings_location`; the sweep's select (`pending` rows) is < 10 ms at 10,000 rows with 20 pending. A miss is fixed in the fix round (index or query shape), not deferred — perf review
- [ ] NF3 Privacy: Postgres and responses only ever hold the approximate point (AC3 + AC9 check equality with `approximate_point`); the sweep logs counts only and the `httpx` logger is at WARNING in the worker (AC3's `caplog` check at INFO); `nominatim_user_agent` never contains `@` (AC12); the Nominatim request carries only street name, city and the area box (AC7) — security review
- [ ] NF4 `make lint` clean (ruff, mypy --strict, including the geoalchemy2 types); `make client` regenerates `web/src/api/schema.d.ts` with `lat`, `lng` on `ListingPublic` and the four bbox params on `GET /listings`, and the CI `web` job passes with the updated fixture — CI `api` and `web` jobs

## Tests to write
Integration (Postgres via `TEST_DATABASE_URL`, Redis via `REDIS_URL`; `db_engine` truncation already covers
`listings`): AC1 (on the `_mig` database), AC2 (HTTP, `signup`), AC3–AC6 and AC13 (sweep against the test database
and the dev Redis, with `geo_clean`), AC9–AC11 (HTTP, `make_listing` + `set_location`). Unit: AC7 (`MockTransport`),
AC8, AC12, NF1. E2E: none (the API alone has no browser flow; `0003d`'s e2e runs the worker with the fake geocoder
end to end). NF2 is a reviewer measurement.

## Risks / open questions
- **Engineering choices (not for Gilad):** geocoding runs only in the worker, never inline in the request, so posting
  never waits on or fails because of Nominatim, and a listing reaches the map up to ~10 s (one sweep) after posting;
  `fake` is the default geocoder everywhere except a real deployment, which must set `GEOCODER` explicitly.
- **Product questions for Gilad (the coder follows each recommendation as written meanwhile):** questions 1-3 below.
- **Question 1 for Gilad — how approximate is the public pin?** (a) street point plus a fixed per-listing offset of
  up to ~200 m, 4-decimal coordinates (as specced; neighbours on one street get separate pins); (b) a coarser
  ~500 m offset or a ~500 m grid cell, shown as an area rather than a pin; (c) the street point itself, no offset
  (all listings on a street stack on one pin). **Recommend (a):** the street name is already public, so (a) adds
  no exposure, avoids stacked pins and never shows a building even when an owner types a house number; (b) costs
  nothing extra later (one constant) if testers find (a) too precise.
- **Question 2 for Gilad — a listing whose address cannot be found, or that falls outside the area box.** (a) It
  stays live and in the list, absent from the map; the owner is not told (as specced); (b) as (a), plus a "not on
  the map, check the street name" note in "my listings" (adds `geocode_status` to `ListingOut` and a web change; a
  small later spec); (c) hide it from search until located (the strict reading of "listings outside are hidden").
  **Recommend (a) now and (b) with Slice 10 (trust):** (c) would hide real listings whenever the public Nominatim
  is slow or down, and a wrong city is better caught by an owner-facing note than by silent hiding.
- **Question 3 for Gilad — house numbers typed into `street`.** PRODUCT.md says the public street has no house
  number, but the field is free text, so "כצנלסון 12" is shown as typed. This spec drops the number before
  geocoding only. (a) Leave the public text as typed; (b) a small follow-up spec that rejects a street ending in a
  bare number at create/patch, with a wizard field error; (c) strip the number silently on save. **Recommend (b):**
  it keeps PRODUCT's promise with a clear owner-facing message; (c) silently edits what the owner wrote.
- Nominatim usage policy (public instance): ≤ 1 request/s (the sweep sleeps 1.1 s after every request while
  holding a Redis lock, AC4), an identifying User-Agent (config, no email per Gilad), results cached (Redis, 30
  days / 7 days for not found), no bulk geocoding (≤ 20 rows per sweep, only live rows, only after an address
  change), and ODbL attribution: results are OSM data, credited by the map's "© OpenStreetMap contributors" in
  `0003d`. Any outage pauses geocoding for 5 minutes (`geo:pause`), a 429/403 for an hour, so a row's 5 attempts span at least 20 minutes and a block is never hammered.
- `geography` + `ST_MakeEnvelope` treats the box's edges as great-circle arcs, not lines of latitude; at Gush Dan
  scale (≤ 25 km) the difference is a few metres, well inside the ~200 m offset. A `geometry` column would be exact
  for boxes; `geography` was chosen for metre-based distance queries later (Slice 6 / nearby places).
- The bbox filters on the approximate point, the same point the response returns, so the filter cannot be used
  to narrow down anything the response does not already show.
- The HMAC offset is keyed by `SECRET_KEY`; rotating the key moves every pin by up to ~200 m on the next re-geocode
  only (stored points do not move). Acceptable.
- Two sweeps never overlap (Redis lock, 60 s expiry); if a worker dies mid-sweep the lock expires after 60 s and
  the next sweep resumes. Rows are committed one by one, so a crash loses at most one result.
- This branch starts from `main` (0003a and 0003b merged). It touches `services/listings.py` (`update_listing`) and
  the search schema/service, which no open PR touches today.

## Verifier findings — one round, 8 findings, all applied
1. `_LISTINGS_CHECKS` gains the three new CHECKs (Scope "Tests"); AC11 covers `test_migrations.py`.
2. `test_https_web_origin_refuses_dev_defaults` sets `GEOCODER` from env; the new https check sits after `EMAIL_BACKEND`; AC12 and that test `delenv` the geocoder vars (Scope config + Tests, AC12).
3. Any `GeocoderUnavailable` ends the sweep and sets `geo:pause` (300 s, 3600 s on 429/403); a paused sweep skips before the lock (Sweep steps 0 and 4, AC5, Risks).
4. `approximate_point` offset is `k x 0.0001`, `k = +-(1 + u % 20)`, never zero; AC8 asserts the 0.0001..0.002 band (Scope).
5. The sweep calls `geocode(city, street_query(street), envelope)`, an empty query is `not_found` with no call, `located` counts cache hits (Sweep step 3-4, AC5).
6. Worker sets the `httpx` logger to WARNING; AC3 captures at INFO (Scope worker, AC3, NF3).
7. `geocode_pending(..., key_prefix="geo:")`; tests use `test-geo:` and `geo_clean` clears only that (Scope, Sweep, AC preamble, AC4, AC5).
8. Worker-only geocoding and the `fake` default moved to "Engineering choices"; Gilad gets questions 1-3 only (Risks).

## Digest (filled by orchestrator after verification)

    Spec 0003c - Map API: approximate listing locations + bbox search   (verified, part c of 4, API only, depends on 0003a (merged))
    What a user can do after this: every live listing gets an approximate map point (Nominatim, street name only, offset
             up to ~200 m) within ~10 s of posting or an address change; anyone filters GET /listings by a map box
             (west/south/east/north) and every public listing carries lat/lng (null until located). A listing whose
             address is not found stays live and in the list, only off the map.
    Decisions I need from you (built on the recommendation meanwhile):
      Q1. Public pin precision: (a) street point + fixed ~200 m offset per listing [rec] (b) coarser ~500 m area
          (c) the street point itself, listings on one street stack.
      Q2. Address not found / outside the area box: (a) stays in the list, off the map, owner not told [rec now]
          (b) as (a) + a "not on the map" note in my listings [rec with Slice 10] (c) hidden from search until located.
      Q3. House numbers typed into street (shown publicly today): (a) leave as typed (b) small spec rejecting a street
          ending in a bare number, with a wizard field error [rec] (c) strip it silently on save.
    Acceptance targets: NF1 no network in tests/CI (fake geocoder by default) · NF2 bbox search < 50 ms at 10,000
             listings, using the GiST index · NF3 only the approximate point is stored or returned, logs hold counts only.
    Risks: Nominatim outage or throttling - mitigation: worker-only, <= 1 req/s under a Redis lock, cached, and an
             outage pauses geocoding (5 min, 1 h on 429/403) instead of failing rows.
    Reviewers: code, qa, perf, security   Estimated: 1 coder run, 1 review round
