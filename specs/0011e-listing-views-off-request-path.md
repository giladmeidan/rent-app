---
id: 0011e
title: The public listing page no longer writes to the database on every visit; views are counted in Redis once per viewer per listing per hour and added to listings.view_count by the worker every minute
status: in-review
depends_on: []   # split from 0011c (verifier finding 1); uses none of 0011c's code (no `limits.py`); both edit `services/applications.py` in different functions, the second to merge merges `origin/main`
reviewers: [code, security, perf, qa]   # security: HMAC'd viewer keys (which IP or user viewed which listing); perf: the listing page read path and the flush; qa: API behaviour change on GET /listings/{id}. No ux: no screen
estimate: 1 coder run (small)   # coder Opus/high (data write path, Speed rule 6)
---

## Goal
After this ships, `GET /listings/{id}` (the public listing page) is read-only: a visit costs a Redis call or two
instead of a row UPDATE, so a loop of page loads no longer slows owners' edits or leaves a dead tuple per hit
(FOLLOWUPS 0004a: 600 views in 1.6 s pushed owner PATCH from 15–40 ms to 40–100 ms). Views are still recorded for
the applications-per-view log (PRODUCT.md "Applications": "views stay recorded for the applications-per-view
log"), approximately: one per viewer per listing per hour. Part of Slice 11 "Trust basics" with `0011c`.

## Scope
**In** (moved verbatim from `0011c` Scope 4, with verifier finding 4 applied):
1. **Listing views off the request path** (FOLLOWUPS 0004a `record_view`):
   - `services/applications.py::record_view` is renamed `applicant_count(db, listing_id) -> int`: the count query
     only, no UPDATE, no commit, no try/rollback. Its module docstring line on `view_count` is updated.
   - New `api/app/services/listing_views.py`: `KEY_PREFIX = "views:"`, `SEEN_TTL_S = 3600`;
     `count_view(r, listing_id, viewer: str) -> None`: `SET {KEY_PREFIX}seen:{h} 1 NX EX 3600` where `h =
     hmac_sha256(SECRET_KEY, f"{listing_id}|{viewer}").hexdigest()[:32]` (so Redis never holds which IP or user
     viewed which listing), and only when the SET succeeded `HINCRBY {KEY_PREFIX}pending {listing_id} 1`. A
     `RedisError` is caught and logged at WARNING with its type name only (never the viewer), and the function
     returns: the page never fails for a view.
     `flush_views(db, r) -> int`: a `MULTI` pipeline `HGETALL {KEY_PREFIX}pending` + `DEL` (read and clear
     atomically); nothing pending → 0 with no SQL. Else each hash field is parsed with `uuid.UUID(...)` and its
     value with `int(...)` (Redis returns strings; `Listing.id` binds a UUID), then one Core executemany on
     `Listing.__table__`: `update().where(c.id == bindparam("b_id")).values(view_count=c.view_count +
     bindparam("b_n"))` with the rows sorted by id, then one commit; returns the views added. If the UPDATE or
     commit raises: rollback, put every count back (`HINCRBY` per row, one pipeline), re-raise. `updated_at` is
     not touched.
   - `routers/search.py::get_listing`: `applicant_count` replaces `record_view`; after it,
     `listing_views.count_view(r, listing.id, f"u:{user.id}" if user else f"ip:{host}")` with `host =
     request.client.host if request.client else "unknown"` (as `routers/auth.py::request_otp`). A 404 counts
     nothing. Comments about `record_view`'s commit (`expire_on_commit` note, "after `record_view`") go; the
     docstring says views are counted in Redis, once per viewer per listing per hour, and flushed every minute.
   - `api/app/worker.py`: `flush_listing_views(ctx) -> int` runs `flush_views` off the loop
     (`asyncio.to_thread`, a `get_sessionmaker()()` session and `get_redis()`, as `_sweep`), logs `"view flush:
     %d"` (the number only); `cron(flush_listing_views, second={30}, unique=True)` (every minute).
   - `models/listing.py` `view_count` comment: counted by `services/listing_views.py`, once per viewer per hour.
2. **Docstring**: `routers/search.py` module docstring (the view counter is no longer in
   `services/applications.py`; the listing page is read-only).
3. **Existing tests this changes** (see Blast radius): `tests/conftest.py` (autouse fixture setting
   `listing_views.KEY_PREFIX = "test-views:"`, because the spec stack's own worker drains `views:pending` on the
   same Redis, as `geo_clean`'s `test-geo:`; `redis_clean` also deletes `test-views:*`);
   `test_applications.py::test_ac8_applicant_count_and_view_counter` (flush, then 1 view for two anonymous GETs;
   3 statements, not 4, the third `FROM listing_photos`); `test_market_people.py::
   test_ac12b_listing_page_people_share_browse_limit` (drop `before = views()`, `views() == before + 1` and the
   `views` helper: views no longer depend on the people path, AC1 covers them); `test_matching.py::
   test_ac7_listing_page_match` (the same drop); `test_photos.py::test_ac10_listing_read_surfaces` (the anonymous
   listing GET: `len(sent) == 4` → 3, `"FROM listing_photos" in sent[3]` → `sent[2]`).
4. **`specs/FOLLOWUPS.md`**: delete the 0004a `services/applications.py (record_view)` line. Add: anonymous views
   are de-duplicated per `request.client.host`, which is the proxy until Slice 13's real client IPs, so anonymous
   views undercount until then.

**Out:** per-IP limits on the listing page (at the edge, Slice 13; `0011c`'s inventory); leaving the owner's own
views out of `view_count`; showing views anywhere (owners do not see `view_count`, Gilad 2026-11-10); the
applications-per-view log itself; FOLLOWUPS 0004b's `useApply.ts` 409 count (now unblocked, not done here).
**New dependencies:** none.

## Data
No Postgres change, no migration (`listings.view_count` exists since 0004a). Redis keys added:
- `views:seen:{32 hex}` (TTL 3600): one per (listing, viewer) per hour, an HMAC, so no IP or user id is readable.
- `views:pending` (hash `listing_id → views`, no TTL): drained every minute by the worker; at most one field per
  listing.

Backwards compatibility: `listings.view_count` keeps its values and grows by the flushed counts. Until the worker
runs, views wait in the hash. Tests use the `test-views:` prefix.

## API
| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | /listings/{id} | public (`optional_user`, unchanged) | — | 200 `ListingDetail` (unchanged) | unchanged; no database write; a Redis failure never fails the page |

No new endpoint. The worker gains one cron job (not an endpoint).

## UI
None. `view_count` is in no response and on no screen (Gilad 2026-11-10); the listing page's body is unchanged.

## Acceptance criteria
API tests are in a new `api/tests/test_listing_views.py` unless named otherwise; they use `redis_clean` (with
`test-views:*`) and the autouse `test-views:` prefix.
- [ ] AC1 Given an anonymous client, When it GETs a public listing twice, Then `HGET test-views:pending {id}` is
  1; a signed-in user's GET adds 1, their second adds 0; a GET of a paused listing (404) adds nothing; and the
  anonymous GET sends exactly 3 SQL statements (listing, applicant count, photos), none an UPDATE or INSERT —
  `test_listing_views.py::test_ac1_listing_view_counted_once_per_viewer_hour`
- [ ] AC2 Given one anonymous and one signed-in view of a listing, Then every `test-views:seen:*` key is the
  prefix plus exactly 32 hex characters (no listing id, IP or user id in it) with a TTL in (0, 3600] —
  `test_listing_views.py::test_ac2_view_keys_reveal_nothing`
- [ ] AC3 Given pending views 2 on listing A and 1 on B, When `flush_views` runs, Then A's `view_count` grew by
  2, B's by 1, `updated_at` unchanged, the hash is gone and it returned 3; a second run returns 0 and sends no
  SQL; Given the UPDATE raises (monkeypatched), Then the error propagates and A and B are pending again with the
  same counts — `test_listing_views.py::test_ac3_flush_views`
- [ ] AC4 Given `count_view`'s Redis call raises `redis.ConnectionError`, When a listing is fetched, Then 200
  with the usual body, a WARNING with the error type and no IP — `test_listing_views.py::test_ac4_view_count_never_fails_the_page`
- [ ] AC5 Given `app.worker` reloaded, Then a cron job runs `flush_listing_views` with `second == {30}` (every
  minute) and `unique`; calling it flushes the pending test views into `view_count` —
  `api/tests/test_worker.py::test_ac5_worker_flushes_views_every_minute` (with the file's `httpx_log_level`)
- [ ] NF1 `make lint` and `make test` pass; e2e runs in CI only (never `make e2e` locally)

## Tests to write
Unit and integration (pytest, the compose Redis with the `test-views:` prefix): AC1–AC4 in
`test_listing_views.py`, AC5 in `test_worker.py`; the existing tests of Scope item 3. Count statements with the
existing `statements` fixture; seed pending views with `HINCRBY` on the test prefix for AC3. E2E: none new
(`web/e2e/map.spec.ts` polls the listing page until geocoded; it reads only `lat` / `lng`).

## Risks / open questions
No open product question. Split from `0011c` by verifier finding 1 (2026-11-14); verified with it in the same
round.
- **Anonymous view de-duplication** uses `request.client.host`, the proxy's address until Slice 13: anonymous
  views undercount until then (approximate views accepted, FOLLOWUPS 0004a). Signed-in views use the user id.
- **Overlap with 0011c**: both edit `services/applications.py` (0011c `set_applicant_status` and the
  `ALLOWED_FROM` comment; this spec `record_view` and the module docstring's `view_count` line): different
  functions, the second to merge merges `origin/main`. No other shared file.
- **A failed flush** puts its counts back; a crash between the read-and-clear and the put-back loses at most one
  minute of views (approximate by design).
- **Rotating `SECRET_KEY`** resets the one-hour de-duplication once; harmless.
- **Shared Redis in tests**: without the `test-views:` prefix the stack's worker would drain the tests' pending
  hash mid-test.

## Blast radius
`graphify affected` on main's graph (built before Slice 14; hits confirmed with grep, 2026-11-14).
- `record_view` (`services/applications.py`) → `applicant_count`: caller `routers/search.py::get_listing` (Scope).
  Tests asserting `view_count` after a GET: `test_applications.py::test_ac8_applicant_count_and_view_counter`,
  `test_market_people.py::test_ac12b_…`, `test_matching.py::test_ac7_listing_page_match` (all Scope 3).
  Untouched: `test_inbox.py:525` (sets `view_count` to prove it is not exposed), `test_migrations.py` (column round
  trip).
- `get_listing` (`routers/search.py`): every test that GETs `/listings/{id}`; behaviour unchanged but the UPDATE.
  `test_photos.py::test_ac10_listing_read_surfaces` counts an anonymous listing GET absolutely (Scope 3). No other
  test counts a listing GET's statements absolutely (grep of `statements.clear()`).
  `test_flat_profile.py::test_ac4_people_edge_cases_and_statement_count` compares counts measured in the same
  test, so both lose the UPDATE: untouched. `web/e2e/map.spec.ts` polls the page until geocoded: now read-only.
- `WorkerSettings.cron_jobs`: `test_worker.py` picks jobs by coroutine, so one more job changes nothing there.
- `redis_clean` (`tests/conftest.py`): fixture used by many tests; adding `test-views:*` deletes only test keys.

## Digest (filled by orchestrator after verification)
Spec 0011e — Listing views off the request path   (verified 2026-11-14; split from 0011c)
What a user can do after this: nothing visible; the public listing page stops writing to the database on every
visit: a view is counted in Redis once per viewer per listing per hour and the worker adds the counts to
`listings.view_count` every minute (approximate views accepted at launch, FOLLOWUPS 0004a).
Decisions I need from you: none.
KPIs this slice moves: listing page latency under load; no dead-tuple growth from views.
Acceptance targets: NF1 lint/test pass; the anonymous listing GET drops from 4 statements to 3.
Risks: viewer keys tie an IP or user to listings viewed (HMAC'd, expiring; security reviews it); 0011c also edits
`services/applications.py` (different functions; second to merge merges `origin/main`).
Reviewers: code, security, perf, qa   Estimated: 1 small coder run (Opus/high), 1 review round
Links: `specs/0011e-listing-views-off-request-path.md` · `specs/0011c-rate-limits-hardening.md`
