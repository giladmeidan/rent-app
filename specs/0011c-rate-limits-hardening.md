---
id: 0011c
title: Every write has a per-account rate limit (listing create, edit and address change, the owner's status decision, and one shared budget for the small writes), oversized request bodies are refused with 413, and the join-flat and like rate-limit messages say when to try again
status: in-review
depends_on: []   # 0011a (renewal), 0011b (reports) and 0011e (listing views) build in parallel; see Scope 12 and Risks for the overlap
reviewers: [code, security, perf, qa]   # security: rate limits, body cap; perf: SSE reconnect jitter; qa: API changes on ~20 routes + two UI copy states. No ux: two existing alerts gain a time, no layout change
estimate: 1 coder run   # coder Opus/high (security, Speed rule 6); cross-cutting: one helper wired into many routes, not many features
---

## Goal
After this ships, one account cannot flood homie with writes: creating listings, editing them (and changing their
address, which costs a geocoder lookup), the owner's applicant decisions and every other small write each have a
per-account hourly and daily budget, and a refused request says when to try again. Request bodies over 64 KB are
refused before parsing. PRODUCT.md "Trust (MVP)": "rate limits" (Slice 11, spec `0011c`).

## Scope
**In:**
1. **Rate-limit helper** `api/app/limits.py` (new, a top-level module next to `app/auth.py`, which also raises
   `HTTPException` from a shared dependency): `Bucket(name, per_hour, per_day)` (frozen dataclass), the five
   buckets of the table below, `check(r, user_id, *buckets)` and `RATE_LIMITED` (the OpenAPI `responses` entry).
   `check` builds two counters per bucket, `(f"rl:{name}:user:{user_id}", per_hour, 3600)` and
   `(f"rl:{name}:user:day:{user_id}", per_day, 86_400)` (the key shape of `rl:apply:*`, `rl:like:*`,
   `rl:browse:*`), counts them all in **one** `services.rate_limit.count_or_raise` call (atomic; a refused request
   counts nothing), and turns `RateLimitedError` into `HTTPException(429, "rate_limited",
   headers={"Retry-After": str(exc.retry_after)})`. Routers read the buckets as `limits.WRITE` etc. at call time
   (so a test can `monkeypatch.setattr(limits, "CREATE", ...)`).
2. **Wire it** (the inventory below is the full list): each newly limited handler gains `r: RedisDep` (where it
   lacks one) and, as its **first statement**, `limits.check(r, user.id, <bucket>)`; its decorator's `responses`
   gains `**limits.RATE_LIMITED`. Counting rule, the same as `apply` and chat today: **every authenticated,
   body-valid attempt counts, whatever its outcome (404, 409 and a service's 422 such as `unknown_area`
   included); a 401 or a FastAPI validation 422 counts nothing** (FastAPI validates before the handler runs).
   Exceptions: `POST /listings` counts after its `owner_only` role check (the router docstring's "checked before
   anything is locked or counted" stays true); `PATCH /listings/{id}` passes `limits.ADDRESS` too when
   `body.model_fields_set` meets `{"city", "street", "area_id"}` (a router literal, commented "the keys that make
   the worker geocode again, `services/listings.py::_ADDRESS_FIELDS`"; the service is not touched, so 0011a's
   edits there do not conflict).
3. **Owner status PATCH** (FOLLOWUPS 0005c owner PATCH): `services/applications.py::set_applicant_status` returns
   `tuple[Row[Any], bool]` (the row, `changed`). Its UPDATE matches only a real transition:
   `Application.status.in_(ALLOWED_FROM[status] - {status})`, and `updated_at=func.now()` (the CASE goes: a
   same-status row is never updated). When the UPDATE returns nothing, the existing follow-up status SELECT
   decides: none or `withdrawn` → `ApplicationNotFoundError`; equal to the target → a **no-op**: run the same
   `_applicants` row query, commit nothing, return `(row, False)`; anything else → `InvalidTransitionError`. When
   `changed` is False the router neither looks up members (`chat_service.event_members`, one SELECT) nor
   publishes; when True it does both, as today. `ALLOWED_FROM` and its comment stay ("setting the current status
   again is a no-op").
4. *(Moved to `0011e`: listing views off the request path.)*
5. **Request body cap** (FOLLOWUPS 0005a, 0007a): in `api/app/main.py` a pure ASGI middleware class (not
   `BaseHTTPMiddleware`: it must not buffer the SSE stream), `MAX_BODY_BYTES = 65_536`, registered with
   `app.add_middleware` **before** `CORSMiddleware` (Starlette's last-added is outermost, so CORS headers are on
   the 413). For an `http` scope that is not an upload route (`POST` on `^/listings/[^/]+/photos$`, `PUT` on
   `/me/photo`; their 8 MB `routers/photos.py::read_capped` applies): a `Content-Length` of only digits above the
   cap → `JSONResponse(413, {"detail": "body_too_large"})` without calling the app; otherwise `receive` is wrapped
   and, once the running total of `http.request` bodies passes the cap, raises
   `fastapi.HTTPException(413, "body_too_large")` (FastAPI 0.162's body reader re-raises an `HTTPException`, so
   the existing handler answers it; a chunked body has no `Content-Length`). Other messages pass untouched.
   `_request_invalid` keeps the first `MAX_VALIDATION_ERRORS = 50` entries of `exc.errors()`.
6. **`GET /me/people-likes` counted** (FOLLOWUPS 0010h): `services/market_people.py::my_people_likes(db, r, me)`
   calls `count_browse(r, me)` first, as `browse` does (every authenticated attempt counts, a 403 included); the
   router passes `r`, maps `RateLimitedError` with its existing `_rate_limited`, adds `**_RATE_LIMITED`, and its
   docstring adds the route to the shared browse limit.
7. **SSE reconnect jitter** (FOLLOWUPS 0005c `retry: 3000`, trivial): `routers/events.py` `RETRY_MS` becomes
   `RETRY_MIN_MS = 2000`, `RETRY_MAX_MS = 10_000`; the first event is `ServerSentEvent(retry=random.randint(...))`
   per stream; docstring and the comment in `web/src/features/chat/ChatStreamProvider.tsx:75` updated.
8. **Web** (FOLLOWUPS 0009f): `flatmates/api.ts` `previewInvite` and `joinFlat`, and `people/api.ts`
   `likePersonCard`, pass `response.headers` to `ApiError` (so `retryAfter` is set). `JoinFlatPage.tsx`: both
   failure lines render `flatmates.join.rateLimitedIn` with `retryAfterText(t, error.retryAfter)` when the failure
   is `rateLimited` and `retryAfter` is known, else `COPY[failure]` (one small helper used at both sites).
   `MarketPersonCard.tsx`: keeps the 429's `retryAfter` in state next to `error` (as `ApplySection.tsx`) and
   renders `people.errors.rateLimitedIn` / `people.errors.rateLimited` the same way. `make client`.
9. **Docstrings that state the old rules**: `routers/photos.py` ("Delete and reorder are not rate-limited", "The
   delete is not rate-limited"), `routers/applications.py` ("Every successful lister status change ...
   publishes" → only a change that changed the status), `routers/listings.py`.
10. **Existing tests this changes** (see Blast radius): `test_listings.py::test_nf2_lifestyle_unknown_keys_one_error_no_echo`
    and `test_profiles.py::test_nf2_lifestyle_unknown_keys_one_error_no_echo` (19,999 → 3,999 unknown keys: the
    20,000-key body is now a 413, asserted in AC12); `test_listings.py::test_ac3_cap_counts_live_listings_only`
    (9 creates as one owner: `monkeypatch.setattr(limits, "CREATE", limits.Bucket("create", 100, 100))`, comment
    "the create limit is not under test here"; any other test the suite shows over a new limit gets the same
    one-line fix); `test_chat_events.py::test_ac1_stream_auth_holds_no_db_connection` (`retry: 3000` → a
    `retry: N` line with 2000 ≤ N ≤ 10000).
11. **`specs/FOLLOWUPS.md`**: delete the lines this closes: 0002a `routers/listings.py` (keep only its
    "GET /me/listings is unpaginated" half as a reworded line), 0003c `update_listing` rate limit, 0005a `main.py`
    body cap, 0005c owner PATCH, 0005c `retry: 3000`, 0006c `routers/listings.py:77`, 0007a `_request_invalid`,
    0009f `rateLimited` strings, 0010h `GET /me/people-likes`. Reword 0001a `OTP_RATE_LIMIT_EMAIL_DAY`: kept by
    Gilad 2026-11-14, Slice 13 scopes it per (email, network). Add: (1) the listing wizard, inbox status, likes
    page and profile show the generic error on a 429 (no "try again in …"); (2) `people.errors.inviteRateLimited`
    (`PersonCard.tsx`) is still fixed text: read `Retry-After` the same way; (3) per-IP limits on the public reads
    (`GET /listings`, `GET /listings/{id}`, `/media`) at the edge, Slice 13 (with 0001a's verify / IPv6 /
    email-cap line and 0010h's per-IP browse line, which stay).
12. **Routes from parallel specs.** At merge time, after merging `origin/main`: (a) if 0011a's `POST
    /listings/{listing_id}/renew` is on `main`, `renew_listing` gains `r: RedisDep`, `limits.check(r, user.id,
    limits.WRITE)` as its first statement and `**limits.RATE_LIMITED` in `responses`; it joins `LIMITED` (no body)
    and the inventory as **NEW `write`**. (b) If 0011b's `POST /reports` is on `main`, it joins `OWN` (its own
    `rl:report:*` 10 / h, 30 / day, proved by 0011b AC9) and the inventory. (c) If either lands after this spec,
    its build session does the same when it merges `origin/main`, or AC1 fails its CI. AC1 is a hand-kept
    registry: a route "has a limit" when `test_hardening.py` lists it in `LIMITED` (proved by AC2) or `OWN` (proved
    by that route's own spec); nothing is detected from code. Expected mechanical conflicts: `routers/listings.py`
    PATCH `responses` (0011a replaces `**_CAP_REACHED` with its own 409 entry, 0011c adds `**limits.RATE_LIMITED`:
    keep both), PATCH's signature and the module docstring; `main.py` (0011b's `include_router` next to 0011c's
    middleware).

**Out:** anything needing real client IPs behind the deploy proxy (per-IP limit on `POST /auth/otp/verify`, IPv6
/64 buckets, a global email send cap, per-IP browse, per-IP and per-process SSE stream caps) → Slice 13; the OTP
daily lockout (kept until Slice 13, Gilad 2026-11-14); defining 0011a's renew and 0011b's `POST /reports` (their
own specs; Scope 12 only places them in the limit registry); listing views off the request path (`0011e`);
moving the five existing per-router `_rate_limited` helpers onto `limits` (no behaviour change, not needed);
pagination of `GET /me/listings` / `GET /me/conversations`; 429 copy on screens other than the two above
(FOLLOWUPS).
**New dependencies:** none.

## Rate-limit inventory (after this spec)
Every route of `api/app/routers/` on `main` today (47; Scope 12 adds 0011a's and 0011b's). "NEW" is this spec.
Hour and day windows are fixed windows from the first counted attempt (`count_or_raise`). Auth rules are
unchanged by this spec.

**Buckets added** (`api/app/limits.py`): `CREATE = Bucket("create", 5, 10)`, `ADDRESS = Bucket("address", 10,
30)`, `STATUS = Bucket("status", 200, 1000)`, `WRITE = Bucket("write", 200, 1000)`, `ESTIMATE =
Bucket("estimate", 300, 1500)`.

| Route | Auth (unchanged) | Limit after 0011c | Why this number |
| --- | --- | --- | --- |
| POST /auth/otp/request | public | 3 / 15 min and 10 / day per email, 10 / 15 min per IP (0001a) | unchanged; the daily lockout stays until Slice 13 (Gilad 2026-11-14) |
| POST /auth/otp/verify | public | none; 5 guesses per code (`OTP_MAX_ATTEMPTS`) | per-IP limit needs real IPs → Slice 13 |
| POST /auth/logout | session cookie | none (exempt) | deletes only the caller's session; signing out must always work |
| POST /listings | signed in; apartment: owner | **NEW `create`**: 5 / h, 10 / day | Gilad 2026-11-14 (PRODUCT.md "Trust (MVP)"); at most 3 live listings, so nobody real posts more in a day even re-posting after pauses |
| PATCH /listings/{id} | own listing | **NEW `write`**; plus **`address`** 10 / h, 30 / day when `city`, `street` or `area_id` is sent | each new address is a Nominatim lookup by the worker (~30 rows a minute); fixing a typo takes 1–3 tries. The web sends changed fields only (`validate.ts::changedFields`) |
| PUT /listings/{id}/closure | own, not live | **NEW `write`** | one answer per pause or expiry |
| POST /listings/{id}/renew | own listing | **NEW `write`** | one renew per expiry |
| POST /listings/{id}/applications | signed in | 10 / h, 30 / day (0004a) | unchanged |
| POST /me/applications/{id}/withdraw | own application | **NEW `write`** | also bounded by apply (re-apply costs apply budget) |
| PATCH /listings/{id}/applications/{aid} | own listing | **NEW `status`**: 200 / h, 1000 / day; a no-op writes and publishes nothing | a busy apartment draws ~100 applicants; reviewing each twice in an hour is 200 |
| POST /conversations/{id}/messages | member | 20 / min, 300 / day (0005a) | unchanged |
| PUT /me/profile | signed in | **NEW `write`** | one PUT per profile save |
| PUT /listings/{id}/people/{pid}/like | own live room | likes 30 / h, 100 / day, shared (0008a, 0010h) | unchanged |
| DELETE /listings/{id}/people/{pid}/like | own room | **NEW `write`** | |
| PUT /people/{card}/like | own visible card | likes (shared) | unchanged |
| DELETE /people/{card}/like | signed in | **NEW `write`** | |
| DELETE /me/matches/{cid} | member of the direct chat | **NEW `write`** | publishes only when it removed a match |
| POST /listings/{id}/flatmate-invite | own room | **NEW `write`** | create or rotate the link |
| DELETE /listings/{id}/flatmate-invite | own listing | **NEW `write`** | |
| POST /flatmate-invites/preview | signed in | 20 / h shared with join (0008d) | unchanged |
| POST /flatmate-invites/join | signed in | same | unchanged |
| DELETE /listings/{id}/flatmates/{fid} | own listing | **NEW `write`** | |
| PATCH /me/flats/{id} | flat member | **NEW `write`** | |
| DELETE /me/flats/{id} | signed in | **NEW `write`** | |
| POST /listings/{id}/photos | own listing | 60 / h, 300 / day + one upload in flight, 8 MB (0010d) | unchanged; exempt from the 64 KB cap |
| DELETE /listings/{id}/photos/{pid} | own listing | **NEW `write`** (0010d had none) | a wizard save is at most 12 writes (PATCH, ≤10 deletes, a reorder) |
| PUT /listings/{id}/photos/order | own listing | **NEW `write`** | same |
| PUT /me/photo | signed in | photos (shared), 8 MB | unchanged; exempt from the 64 KB cap |
| DELETE /me/photo | signed in | **NEW `write`** | |
| GET /listings (search, map) | public | none | expensive for signed-in (match); per-IP at the edge → Slice 13 |
| GET /listings/{id} | public | none; read-only since `0011e` | per-IP at the edge → Slice 13 |
| GET /people | own visible card | browse 300 / h, 1500 / day (0010h) | unchanged |
| GET /listings/{id}/people | own live room | browse (shared) | unchanged; the listing page's people also count here |
| GET /me/people-likes | own visible card | **NEW: browse (shared)** | the likes page loads once per visit and after a like |
| GET /rent-estimate | signed in | **NEW `estimate`**: 300 / h, 1500 / day | the wizard asks once per 400 ms pause in city, street or rooms and caches an hour: ~10–30 asks a form |
| GET /me/events (SSE) | signed in | 30 opens / min + 5 open streams per user per process (0005c) | unchanged; per-IP / per-process caps → Slice 12/13 |
| GET /health, /areas, /me, /me/listings, /me/applications, /listings/{id}/applications, /me/conversations, /conversations/{id}, /me/profile, /listings/{id}/flatmates, /me/flats, /me/likes | public static data, or the caller's own rows | none | bounded by what the caller owns; no fan-out |

`write` (200 / h, 1000 / day): one shared budget for the small writes, so a script cannot hammer any of them;
about 16 heavy wizard saves an hour. Every route: 413 `body_too_large` over 64 KB (except the two uploads).

## Data
No Postgres change, no migration (head stays `0020`; 0014d takes `0021`). Redis keys added, all with a TTL:
`rl:{create|address|status|write|estimate}:user:{user_id}` (TTL 3600) and `rl:…:user:day:{user_id}` (TTL
86 400), created by `count_or_raise`. Backwards compatible: nothing reads them but the limiter.

## API
Only behaviour changes are listed; request and response bodies are unchanged except where said.

| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| POST | /listings | signed in (`current_user`); an apartment needs the owner role (unchanged) | `ListingIn` | 201 `ListingOut` | + 429 `rate_limited` with `Retry-After` (`create`), counted after the 403 check; 413 over 64 KB |
| PATCH | /listings/{id} | signed in, own listing (404 otherwise, unchanged) | `ListingPatch` | 200 `ListingOut` | + 429 (`write`, and `address` when an address key is sent; one atomic count) |
| PUT | /listings/{id}/closure | signed in, own listing (unchanged) | `ClosureIn` | 204 | + 429 (`write`) |
| PATCH | /listings/{id}/applications/{aid} | signed in, own listing (unchanged) | `ApplicantStatusIn` | 200 `ApplicantOut`; a same-status request writes nothing and publishes nothing | + 429 (`status`) |
| GET | /me/people-likes | signed in + own visible card (403 `card_required`, unchanged) | — | 200 `MyPeopleLikesOut` | + 429 (browse, shared) |
| GET | /rent-estimate | signed in (unchanged) | query (unchanged) | 200 `RentEstimateOut` | + 429 (`estimate`) |
| * | the 14 other **NEW `write`** routes of the inventory | each its existing rule (inventory column) | unchanged | unchanged | + 429 (`write`) |
| * | every route | its own rule | body ≤ 65,536 bytes (the two upload routes: 8 MB, unchanged) | — | 413 `{"detail":"body_too_large"}` (with CORS headers); a 422 `detail` list holds at most 50 entries |
| GET | /me/events | signed in (unchanged) | — | first event `retry: N`, 2000 ≤ N ≤ 10000 per stream | unchanged |

Redis unreachable on a newly limited route: 503 `redis unavailable` (the existing handler in `main.py`), as
`apply` and chat send already do.

## UI
Screens: `/flatmates/join` (`JoinFlatPage.tsx`, the preview and the join failure lines) and the market person
card (`MarketPersonCard.tsx`, on `/market/people` and the likes page). Only the 429 error state changes: with a
`Retry-After` it says when; without one it keeps a fixed line. Empty, loading and success states are unchanged.
No layout change, no new component, no artboard (copy inside existing `role="alert"` lines); RTL: text only, the
`{{when}}` phrase comes from `retryAfterText` ("בעוד 2 דקות", "בעוד שעה").

Copy (`web/src/locales/he.json`, 0009f's voice, as `applications.errors.rateLimitedIn`):
- `flatmates.join.rateLimited` (changed): `"יותר מדי ניסיונות בזמן קצר. אפשר לנסות שוב מאוחר יותר."`
- `flatmates.join.rateLimitedIn` (new): `"יותר מדי ניסיונות בזמן קצר. אפשר לנסות שוב {{when}}."`
- `people.errors.rateLimited` (changed): `"יותר מדי לייקים בזמן קצר. אפשר לנסות שוב מאוחר יותר."`
- `people.errors.rateLimitedIn` (new): `"יותר מדי לייקים בזמן קצר. אפשר לנסות שוב {{when}}."`

## Acceptance criteria
API tests are in a new `api/tests/test_hardening.py` unless named otherwise. Its parametrised table of limited
routes (`LIMITED`: method, path, bucket, a minimal schema-valid body, e.g. `{"price_ils": 7000}`, `{"reason":
"not_renting"}`, `{"status": "shortlisted"}`, `{"shown": true}`, `{"photo_ids": [<uuid>]}`, a full apartment
body with a random `area_id`, a full profile body; random UUIDs in paths, since the count comes first) is the 18
NEW write routes plus `GET /rent-estimate` (19 rows, plus a second `PATCH /listings/{id}` row with an address
key for the `address` bucket; a query string for the GET); `GET /me/people-likes` is
covered by AC14 only.
- [ ] AC1 Given `create_app()`, Then its POST / PUT / PATCH / DELETE routes are exactly the union of the writes in
  `LIMITED` (the 18 NEW write routes), `OWN` (the 9 routes with their own limit: otp request, apply, message send, both like PUTs, flatmate
  preview and join, both uploads) and `EXEMPT` (otp verify, logout); a new write route without a bucket fails —
  `test_hardening.py::test_ac1_every_write_route_has_a_limit`
- [ ] AC2 For each `LIMITED` route (parametrised), Given a signed-in user (an owner for `POST /listings`) whose
  bucket hour counter is at its limit, When the request is sent, Then 429 `{"detail": "rate_limited"}` with `1 ≤
  Retry-After ≤ 3600` and the counter unchanged; Given the hour counter free and the day counter at its limit, Then
  429 with `3600 < Retry-After ≤ 86400` — `test_hardening.py::test_ac2_limited_routes_refuse_at_the_limit`
- [ ] AC3 Given `PUT /me/profile` with a valid body, Then `rl:write:user:{id}` and `rl:write:user:day:{id}` are 1
  with TTLs in (0, 3600] and (0, 86400]; given a 422 body, or no session (401), Then nothing is counted; given
  `PATCH /listings/{random id}` (404), Then it counted — `test_hardening.py::test_ac3_what_counts`
- [ ] AC4 Given an own listing, When it is PATCHed with `{"street": …}`, Then `write` and `address` both count;
  with `{"price_ils": …}` only `write`; Given the address hour counter at its limit, Then an address PATCH is 429
  and the row's `street`, `geocode_status` and `updated_at` are unchanged, while a price-only PATCH is 200 —
  `test_hardening.py::test_ac4_address_changes_have_their_own_limit`
- [ ] AC5 Given an owner with `limits.CREATE.per_hour` creates counted, When one more `POST /listings` is sent,
  Then 429 and no new row; a seeker's apartment POST (403 `owner_only`) counts nothing; a 409
  `listing_cap_reached` counts — `test_hardening.py::test_ac5_listing_create_limit`
- [ ] AC6 Given an applicant `shortlisted`, When the owner PATCHes `shortlisted` again, and an applicant
  `declined` PATCHed `declined`, Then each is 200 with the unchanged row (`updated_at` as before) and the
  recorded `chat_events.publish` calls are empty; a real change (`shortlisted` → `submitted`) publishes exactly
  once; at the `status` limit a PATCH is 429, the status unchanged and nothing published —
  `test_hardening.py::test_ac6_status_noop_and_limit_publish_nothing`
- AC7–AC11 moved to `0011e` (its AC1–AC5).
- [ ] AC12 Given `PUT /me/profile` with a 65,537-byte body and `Origin: <web origin>`, Then 413 `{"detail":
  "body_too_large"}` with `access-control-allow-origin`; the same body sent chunked (no `Content-Length`) → 413; a
  65,536-byte body (valid JSON padded with spaces) is not a 413; the old 20,000-key lifestyle body to `POST
  /listings` → 413 and no row; `PUT /me/photo` and `POST /listings/{own id}/photos` with 100 KB of non-image bytes
  → 415 `unsupported_image`, not 413 — `test_hardening.py::test_ac12_body_size_cap`
- [ ] AC13 Given a `RequestValidationError` with 60 entries, When `_request_invalid` answers it, Then `detail` has
  the first 50 — `test_hardening.py::test_ac13_validation_detail_capped`
- [ ] AC14 Given a person without a visible card, When `GET /me/people-likes` is sent, Then 403 and
  `rl:browse:user:{id}` is 1; Given the browse hour counter at `BROWSE_RATE_LIMIT_HOUR`, Then 429 with
  `Retry-After` — `test_hardening.py::test_ac14_people_likes_counts_browse`
- [ ] AC15 Given a stream opened, Then its first event is `retry: N` with 2000 ≤ N ≤ 10000 —
  `api/tests/test_chat_events.py::test_ac1_stream_auth_holds_no_db_connection` (its `retry: 3000` assertion)
- [ ] AC16 Given the preview answers 429 with `Retry-After: 120`, Then the alert reads `flatmates.join.rateLimitedIn`
  with "בעוד 2 דקות"; the join answering 429 with `Retry-After: 7200` reads it with "בעוד שעתיים" and the join
  button stays; a 429 without the header keeps `flatmates.join.rateLimited` (the existing cases) —
  `web/src/features/flatmates/__tests__/JoinFlatPage.test.tsx::ac16 rate limit says when to retry`
- [ ] AC17 Given a like answering 429 with `Retry-After: 3600`, Then the card's alert reads
  `people.errors.rateLimitedIn` with "בעוד שעה"; without the header, `people.errors.rateLimited` —
  `web/src/features/people/__tests__/MarketPeoplePage.test.tsx::ac17 like rate limit says when to retry`
- [ ] NF1 `make lint`, `make test`, `make i18n-check` pass; `web/src/api/schema.d.ts` regenerated (`make client`);
  e2e runs in CI only (never `make e2e` locally); `make e2e`'s `rl:*` clear covers the new keys

## Tests to write
Unit and integration (pytest, the compose Redis): AC1–AC6 and AC12–AC14 in `test_hardening.py`, AC15 an edit in
`test_chat_events.py`; the existing tests of Scope item 10. Use `redis_clean` where a test reads counters. Record
publishes with the existing pattern (`monkeypatch.setattr(chat_events, "publish", recorder)`). Vitest: AC16 and
AC17 (Responses built with a `Retry-After` header, as `ApplySection.test.tsx` does). E2E: none new; the suite's
owners post at most 3 listings and the `rl:*` clear covers the new buckets.

## Risks / open questions
- **Decided (Gilad, 2026-11-14), Q1, OTP lockout:** PRODUCT.md "Trust (MVP)": "the OTP lockout — 10 code requests
  lock an email out for a day — stays as is until Slice 13 scopes it per email and network with real client IPs".
  Nothing in this spec changes it (Scope 11 rewords its FOLLOWUPS line).
- **Decided (Gilad, 2026-11-14), Q2, listing creates:** PRODUCT.md "Trust (MVP)": "an account creates at most **5
  listings an hour and 10 a day**": `limits.CREATE = Bucket("create", 5, 10)`.
- **Split.** Listing views off the request path moved to `0011e` (verifier finding 1). Both edit
  `services/applications.py` (this spec `set_applicant_status` and the `ALLOWED_FROM` comment; 0011e `record_view`
  and the module docstring's `view_count` line): different functions, the second to merge merges `origin/main`.
- **Overlap with 0011a / 0011b**: Scope 12. 0011d is web only.
- **Redis is now on the write path** of ~20 routes: Redis down → 503 there (as apply and chat today).
- **Status no-op** no longer re-runs the conversation INSERT on a same-status shortlist; a shortlisted application
  always has its conversation (0005a opens it at the first shortlist), so nothing is lost.
- **64 KB** is about 5× the largest real body (a listing with a 2,000-character description: ~4 KB as UTF-8,
  ≤ 12 KB if escaped). The web reads only the first entry of a 422 list, so 50 is plenty.
- **Counting 409s and 404s** (as apply does) means a client that retries a refused write spends budget; the
  numbers leave room for that.

## Blast radius
`graphify affected` on main's graph (built before Slice 14; hits confirmed with grep, 2026-11-14). The view
counter's lines (`record_view`, `get_listing`, `WorkerSettings.cron_jobs`, `redis_clean`) moved to `0011e`.
- `set_applicant_status` (service): only caller the router (graphify). Through HTTP: `test_inbox.py::test_ac4_status_transitions`
  (no-op cells assert `updated_at` unchanged and the row: still true; statements measured only on a change (4)
  and a 409 (3): unchanged), `test_inbox.py::test_ac5_patch_returns_scored_applicant` (changes only),
  `test_chat.py` shortlist test (the "same status again" loop asserts no statement count and an unchanged
  conversation row: still true), `test_chat_events.py::test_ac8_publish_points_after_commit` (all real changes:
  unchanged). Untouched.
- `my_people_likes` (service): only caller the router (graphify); gains `r`. `test_market_people.py:877` counts its
  SQL statements (3): Redis is not SQL, unchanged. No test asserts `_browse_count` after calling it.
- `count_browse`: callers `list_people`, `_browse_allowed`, `browse`, `browse_people` unchanged; one caller added.
- `_request_invalid`, `create_app` (`main.py`): every API test via `conftest.py::client`, `scripts/export_openapi.py`,
  `test_areas.py`, `test_auth.py`, `test_chat_events.py::open_stream`, `test_db_errors.py`, `test_photos.py`. Bodies
  over 64 KB: only the two `test_nf2_lifestyle_unknown_keys_one_error_no_echo` (Scope). Uploads are exempt. No test
  has a 422 list over 50. SSE is untouched by a pure ASGI middleware.
- `RETRY_MS` (`routers/events.py`): only `events`; `test_chat_events.py:250` (Scope); web comment only.
- Router handlers gaining `r` + `limits.check` (`create_listing`, `update_listing`, `set_closure`, `withdraw`,
  `set_applicant_status`, `put_profile`, `create_invite`, `disable_invite`, `remove_flatmate`, `set_shown`,
  `leave_flat`, both `unlike_person`, `remove_match`, `delete_listing_photo`, `reorder_listing_photos`,
  `clear_my_photo`, `get_rent_estimate`): no Python callers (graphify: none); tests reach them over HTTP. Within one
  test and one user, only `test_listings.py::test_ac3_cap_counts_live_listings_only` exceeds a new limit (9
  creates; Scope). `test_price_signals.py::test_ac1_create_writes_one_price_row` makes exactly 5 counted creates
  (fits). Loops of 422s (`test_flat_profile.py::test_ac2_room_fact_rules`) count nothing.
- Web `likePersonCard` (`people/api.ts`) → `useLikeCard` → `MarketPersonCard` (`MarketPeoplePage`, `MyLikesPage`);
  tests `MarketPeoplePage.test.tsx` (Scope: AC17; its existing 429 case has no header → fallback, unchanged),
  `MyLikesPage.test.tsx` (no 429 case: untouched). `previewInvite` / `joinFlat` (`flatmates/api.ts`) →
  `useInvitePreview` / `useJoinFlat` → `JoinFlow` in `JoinFlatPage.tsx`; `JoinFlatPage.test.tsx` (Scope: AC16; the
  existing 429 cases have no header → fallback text, which they read from `he`). `e2e/screens/flatmates.screens.ts`
  `15-join-rate-limited` mocks a 429 without the header (fallback; not part of CI's `make e2e`).
- i18n keys `flatmates.join.rateLimited`, `people.errors.rateLimited`: reworded, every reader imports `he`, so no
  literal breaks.
- Parallel specs (verifier): 0011a's `routers/listings.py::renew_listing` (new write route) and 0011b's
  `routers/reports.py` `POST /reports` (new write route, `main.py` gains its `include_router`) are not on `main`
  yet; AC1 fails for whichever lands without an entry (Scope 12). 0014d touches no router.
- `set_applicant_status` no-op path (verifier): now 4 statements (lookup, UPDATE matching nothing, status SELECT,
  row) instead of 3; no test measures a no-op's statements (`test_inbox.py::test_ac4` measures only the first
  real change and the first 409); the router's `event_members` SELECT is skipped on a no-op. `test_chat_events.py::test_ac8_publish_points_after_commit` PATCHes only real changes (shortlisted →
  submitted → shortlisted → declined): unchanged.

## Verifier findings (2026-11-14, the only round; status stays `draft`)
Checked against the code and pass: `count_or_raise` (atomic, refused counts nothing, `rl:` key shape); the 64 KB
cap (FastAPI 0.162.2 `routing.py` L492 re-raises a starlette `HTTPException` from the body read, so the existing
handler answers a chunked overflow; last-added `CORSMiddleware` is outermost; the two upload routes are the only
`request.stream()` readers); the status no-op (`ALLOWED_FROM[s] - {s}` + the fallback SELECT gives exactly 404 /
no-op / 409; shortlisted rows always have a conversation, migration `0006_chat` backfilled); `flush_views`
(MULTI read-and-clear: no double count across workers; `view_count` has no reader outside tests); the SSE jitter
(only `test_chat_events.py:250` and `ChatStreamProvider.tsx:75` hold `3000`); `retryAfterText` (120 → "בעוד 2
דקות", 7200 → "בעוד שעתיים", 3600 → "בעוד שעה"; `ApiError` already takes `headers`); the 9-create count in
`test_ac3_cap_counts_live_listings_only` (every other test ≤ 5 counted creates per user); 28 write routes =
17 NEW + 9 OWN + 2 EXEMPT. Q1 / Q2 are each a one-AC / one-constant switch as claimed. Apply:

1. **Split: views + worker become `0011e`** (size: ~38 files across 11 routers, a new service, the worker, ten
   test files and two screens is over one coder run). Create `specs/0011e-listing-views-off-request-path.md`
   (`depends_on: []`, `reviewers: [code, security, perf, qa]` — security: the HMAC'd viewer keys; perf: the read
   path and the flush; coder Opus, data write path) and **move** into it, verbatim: Scope 4 (all bullets, with
   finding 4's fix); from Scope 9 the `routers/search.py` docstring; from Scope 10 the `conftest.py` autouse
   prefix fixture + `redis_clean`'s `test-views:*`, `test_applications.py::test_ac8_…`,
   `test_market_people.py::test_ac12b_…`, `test_matching.py::test_ac7_listing_page_match` and
   `test_photos.py::test_ac10_listing_read_surfaces` (4 → 3 statements, photos at `sent[2]`); from Scope 11 the
   0004a `record_view` delete and add (3); Data's two `views:*` keys and the backwards-compatibility lines; the API
   row `GET /listings/{id}`; AC7–AC11 (renumbered AC1–AC5, tests in a new `api/tests/test_listing_views.py`, AC11's
   stays in `test_worker.py`); the Risks bullet on anonymous de-duplication; the Blast radius lines `record_view`,
   `get_listing`, `WorkerSettings.cron_jobs`, `redis_clean`. In 0011c leave the inventory row `GET /listings/{id}`
   as "none; read-only since `0011e`", replace AC7–AC11 with one line "moved to `0011e`" (keep the other numbers),
   drop "the public listing page stops writing…" from the title and Goal, and drop `perf`'s "listing page read
   path, the view flush" from the reviewers comment (perf stays for the SSE jitter). Overlap: both edit
   `services/applications.py` (0011c `set_applicant_status` + `ALLOWED_FROM` comment, 0011e `record_view` + the
   module docstring's `view_count` line): different functions, the second to merge merges `origin/main`. If the
   orchestrator rejects the split, keep everything and set `estimate: 1 coder run (large)`; findings 2–7 apply
   either way.
2. **AC1 cross-spec rule goes into Scope** (new Scope item 12; today it is only a Risks line and does not say who
   wires the limit). AC1 is a hand-kept registry: a route "has a limit" when `test_hardening.py` lists it in
   `LIMITED` (proved by AC2) or `OWN` (proved by that route's own spec); nothing is detected from code. Text:
   "**Routes from parallel specs.** At merge time, after merging `origin/main`: (a) if 0011a's `POST
   /listings/{listing_id}/renew` is on `main`, `renew_listing` gains `r: RedisDep`, `limits.check(r, user.id,
   limits.WRITE)` as its first statement and `**limits.RATE_LIMITED` in `responses`; it joins `LIMITED` (no body)
   and the inventory as **NEW `write`**. (b) If 0011b's `POST /reports` is on `main`, it joins `OWN` (its own
   `rl:report:*` 10 / h, 30 / day, proved by 0011b AC9) and the inventory. (c) If either lands after this spec,
   its build session does the same when it merges `origin/main`, or AC1 fails its CI." The orchestrator relays
   (c) to the 0011a and 0011b build sessions (0011a's Out line "Rate limits on renew … this spec defines none"
   is superseded for renew). Expected mechanical conflicts: `routers/listings.py` PATCH `responses` (0011a
   replaces `**_CAP_REACHED` with its own 409 entry, 0011c adds `**limits.RATE_LIMITED`: keep both), PATCH's
   signature and the module docstring; `main.py` (0011b's `include_router` next to 0011c's middleware).
3. **`LIMITED` is ambiguous about `GET /me/people-likes`.** Its counter is `rl:browse:*` with
   `market_people.BROWSE_RATE_*`, not a `limits.Bucket`, and it needs a visible card. Replace "is the inventory's
   NEW rows" with "is the 17 NEW write routes plus `GET /rent-estimate` (18 rows; a query string for the GET)";
   `GET /me/people-likes` is covered by AC14 only.
4. **AC11 vs Scope 4:** Scope says `cron(flush_listing_views, second=30, unique=True)` but arq stores `second`
   as given and AC11 asserts `second == {30}` (as `test_worker.py` asserts `{0, 10, …}`). Write `second={30}`.
   Same bullet: `flush_views` parses each hash field with `uuid.UUID(...)` and its value with `int(...)` before the
   executemany (Redis returns strings; `Listing.id` binds a UUID).
5. **Status no-op in the router:** "publishes only when `changed`" must also skip `chat_service.event_members`
   (one SELECT); write "when `changed` is False the router neither looks up members nor publishes".
6. **Q1 / Q2 are answered.** `specs/PRODUCT.md` "Trust (MVP)" (working tree, 2026-11-14) now reads "the OTP
   lockout … stays as is until Slice 13 scopes it per email and network" and "an account creates at most **5
   listings an hour and 10 a day**": Q1 (a), Q2 (a). Fold: delete AC18 and Out's "unless Gilad picks Q1 (b)";
   replace the Q1 and Q2 blocks with two "Decided (Gilad, 2026-11-14)" lines quoting PRODUCT.md; AC5's comment
   "it passes whatever Q2 sets" goes; Scope 11's add (5) becomes "reword 0001a `OTP_RATE_LIMIT_EMAIL_DAY`: kept by
   Gilad 2026-11-14, Slice 13 scopes it per (email, network)". Inventory rows `POST /auth/otp/request` and `POST
   /listings` drop "Q1" / "Q2".
7. After 1–6, the orchestrator sets `status: verified` (no second verifier round).

Applied by the orchestrator 2026-11-14; one verifier round; split into 0011c + 0011e.

## Digest (filled by orchestrator after verification)
Spec 0011c — Rate limits + request hardening   (verified 2026-11-14; split: views moved to 0011e)
What a user can do after this: nothing visible changes for normal use; one account or script can no longer flood
homie: every write route has a per-account limit (listings 5 an hour / 10 a day, a tighter limit on address
changes, the owner's status decision, one shared budget for the small writes), bodies over 64 KB get 413 (photo
uploads keep their 8 MB cap), 422s list at most 50 entries, a same-status PATCH publishes nothing, SSE reconnects
are jittered, and the join-flat page and person card say when to retry.
Decisions from you (2026-11-14): Q1 (a) OTP lockout as is until Slice 13; Q2 (a) 5 listings an hour, 10 a day.
KPIs this slice moves: abuse resistance before launch (no unthrottled write route; AC1 keeps it that way).
Acceptance targets: NF1 lint/test/i18n-check pass; AC1 fails for any write route without a limit.
Risks: cross-spec rule (Scope 12): whichever of 0011a / 0011b merges after 0011c wires renew into `LIMITED` and
`POST /reports` into `OWN`; conflicts in `routers/listings.py` / `main.py` are mechanical.
Reviewers: code, security, perf, qa   Estimated: 1 coder run (Opus/high), 1 review round
Links: `specs/0011c-rate-limits-hardening.md` · `specs/0011e-listing-views-off-request-path.md` · PRODUCT.md "Trust (MVP)"
