---
id: 0013b
title: "homie's limits see the visitor's real network: the OTP lockout is per email and network with a per-email ceiling, the public listing reads, the people browse and reports have per-network limits, and listing views dedupe per network within a memory budget"
status: done
depends_on: []   # 0013a (deploy) sets TRUST_PROXY=fly in its Fly config; 0013c (account deletion) and 0013e (admin hardening) build in parallel; see Risks for the shared files
reviewers: [code, security, qa, perf]   # security: auth rate limits, client-IP trust, Redis memory; qa: new 429s on the public reads the web calls (verifier rule 8); perf (Sonnet/medium): every search and listing read gains a Redis EVAL and the view write becomes a Lua script; no ux: no screen change
estimate: 1 coder run   # coder Opus/high (auth and abuse limits, Speed rule 6); cross-cutting but mechanical: one helper wired into ~8 call sites
---

## Goal
After this ships and 0013a deploys homie behind Fly with `TRUST_PROXY=fly`, every per-IP rule keys on the
visitor's real network instead of the proxy's address. The OTP limits count per (email, network), so codes
requested from one network no longer lock an email out on every other network. Above them sits a per-email
ceiling of 20 codes a day across all networks, and that ceiling is not scoped per network: one attacker with
many /64s (or a free /48 tunnel) can still stop any email getting new codes for a day. Existing sessions are
unaffected, the ceiling bounds guessing at 100 a day, and 20 is accepted at launch. One network, and one IPv6
/48, can only read listings, browse people and send reports up to a fixed budget; every read and browse
counter lives at most an hour, and listing views count each visitor's network once within a memory budget.
PRODUCT.md "Launch (Slice 13)": "real client IPs, which scope the OTP lockout per (email, network) and allow
per-IP limits on public reads".

## Decisions this spec builds on
- **OTP lockout** (Gilad 2026-11-14, Q1 (a) of `specs/archive/0011c-rate-limits-hardening.md`), PRODUCT.md "Trust
  (MVP)": "the OTP lockout — 10 code requests lock an email out for a day — stays as is until Slice 13 scopes it
  per email and network with real client IPs".
- **Hosting** (Gilad 2026-11-15), PRODUCT.md "Launch (Slice 13)": Fly.io. Fly's proxy puts the address it accepted
  the connection from in a `Fly-Client-IP` request header, replacing any value the client sent. The leftmost
  `X-Forwarded-For` entry is whatever the client sent, so this spec never reads that header.
- **Login stays email OTP** at launch (PRODUCT.md "OTP", changed 2026-11-15), so the OTP limits are the login's only
  brute-force and abuse bound.

## What "network" means (one definition, used everywhere)
`client_network(request)` (new `api/app/client_ip.py`) returns:
1. **The address.** When `get_settings().trust_proxy == "fly"` and the `Fly-Client-IP` header parses as an IP
   address (`ipaddress.ip_address(value.strip())`), that address; otherwise the socket peer `request.client.host`;
   `"unknown"` when `request.client` is None. Any header other than `Fly-Client-IP` is ignored in both modes,
   `X-Forwarded-For` included.
2. **Normalised to a network:** an IPv4 address → itself (`"203.0.113.7"`); an IPv4-mapped IPv6 address → its IPv4;
   any other IPv6 address → its /64 (`str(ipaddress.ip_network(f"{addr}/64", strict=False))`, e.g.
   `"2001:db8:1:2::/64"`). One /64 is one home or one phone; an IPv6 client controls the low 64 bits and would
   otherwise reset every counter by changing them. A peer that is not an IP (Starlette's TestClient sends
   `"testclient"`) is returned unchanged.
3. **Its /48, for IPv6 only:** `network48(network)` returns the /48 holding a /64 network
   (`str(ipaddress.ip_network(network).supernet(new_prefix=48))`, e.g. `"2001:db8:1::/48"`), and None for
   anything else (an IPv4 address, `"testclient"`, `"unknown"`). The read limit (Scope 5) and the OTP request
   (Scope 4) count the /48 beside its /64 at `PREFIX48_FACTOR = 16` times the /64 limits. The /48 counters come
   first in the same `count_or_raise` call, whose script checks every counter before it writes any, so a request
   the /48 refuses creates no /64 key. One free tunnel /48 holds 65,536 /64s; this makes it count as at most 16 networks.

IPv4 stays exact (/32): Israeli mobile carriers put many phones behind one carrier-grade-NAT address, and a /24
would group whole neighbourhoods. The per-network numbers below are sized for a shared address (see Risks).

## Scope
**In:**
1. **Setting** `api/app/config.py` `Settings.trust_proxy: Literal["none", "fly"] = "none"` (env `TRUST_PROXY`);
   `.env.example` gains `TRUST_PROXY=none` under the auth block, commented: "`fly` only behind Fly's proxy (spec
   0013a sets it in production): the client address is read from `Fly-Client-IP`; `none` uses the socket peer
   (dev, CI). Never set `fly` where clients can reach the API without passing Fly's proxy."
2. **`api/app/client_ip.py`** (new, a top-level module like `app/limits.py`): `client_network(request: Request) ->
   str`, `network48(network: str) -> str | None` and `PREFIX48_FACTOR = 16`, exactly as "What network means"
   above. No other function. Callers read `client_ip.PREFIX48_FACTOR` at call time so a test can monkeypatch it.
3. **Best-effort Redis calls** `api/app/redis_client.py`: `SOFT_SKIP_S = 5.0`, a module-level
   `_soft_skip_until = 0.0` and `soft(call: Callable[[], T]) -> T | None`. It returns None without calling while
   `time.monotonic() < _soft_skip_until`; otherwise it runs `call()`, and on `RedisError` logs
   `log.warning("redis call skipped: %s", type(exc).__name__)`, sets `_soft_skip_until = now + SOFT_SKIP_S` and
   returns None. Anything else (an `HTTPException` 429 included) propagates. It is used by the view count (7) and
   the read limit (5) only. While Redis hangs, each process pays one 1 s socket timeout per 5 s instead of one
   per request (FOLLOWUPS 0011e `count_view`).
4. **OTP request limits per (email, network)** `api/app/services/auth.py`. `_count_request(r, email, network)`
   and `request_otp(r, sender, email, network)` (the parameter `ip` becomes `network`) count, in the one
   existing atomic `count_or_raise` call, so a refused request counts nothing:

   | Counter key | Limit | Window | Constant | Was |
   | --- | --- | --- | --- | --- |
   | `rl:otp:email:{email}:net:{network}` | 3 | 900 s | `OTP_RATE_LIMIT_EMAIL` | per email |
   | `rl:otp:email:day:{email}:net:{network}` | 10 | 86 400 s | `OTP_RATE_LIMIT_EMAIL_DAY` | per email |
   | `rl:otp:email:all:day:{email}` | **20** | 86 400 s | `OTP_RATE_LIMIT_EMAIL_ALL_DAY` (new) | — |
   | `rl:otp:ip:{network}` | 10 | 900 s | `OTP_RATE_LIMIT_IP` | per peer address |
   | `rl:otp:ip:day:{network}` | **50** | 86 400 s | `OTP_RATE_LIMIT_IP_DAY` (new) | — (≈960 a day) |
   | `rl:otp:ip48:{p}` | 160 | 900 s | `PREFIX48_FACTOR * OTP_RATE_LIMIT_IP` | — |
   | `rl:otp:ip48:day:{p}` | 800 | 86 400 s | `PREFIX48_FACTOR * OTP_RATE_LIMIT_IP_DAY` | — |

   The two `ip48` rows exist only for IPv6 (`p = network48(network)`) and come first in the call. The per-email
   rows get no /48 twin: the ceiling already caps an email across all networks.
   `routers/auth.py::request_otp` passes `client_network(request)`. The module docstring's NF2 bound becomes: "a
   code allows 5 guesses and at most 20 codes per email are issued per 24 h across all networks (10 from any one
   network), so an attacker gets at most 100 guesses a day against a 10**6 code space: 0.01 % a day, about 0.3 %
   over a month of continuous attack. The ceiling is the one counter not scoped per network: 20 requests from
   two or more networks (one IPv6 connection holds many /64s) stop an email getting new codes for a day; its
   signed-in sessions are unaffected." `verify_otp` is not touched (0013c changes its sign-up branch; see Risks).
5. **Public read limit** `api/app/limits.py`:
   - `IpBucket(name, per_minute, per_hour)` (frozen dataclass); `READ = IpBucket("read", 300, 3_000)`. No day
     window: every read key lives at most an hour (Risks, Redis memory).
   - `check_ip(r, network, bucket)`: one `count_or_raise` over `(f"rl:{name}:ip:{network}", per_minute, 60)` and
     `(f"rl:{name}:ip:hour:{network}", per_hour, 3600)`, preceded for IPv6 by the /48's
     `(f"rl:{name}:ip48:{p}", PREFIX48_FACTOR * per_minute, 60)` and `(f"rl:{name}:ip48:hour:{p}",
     PREFIX48_FACTOR * per_hour, 3600)` (4,800 a minute, 48,000 an hour for `READ`), raising
     `HTTPException(429, "rate_limited", headers={"Retry-After": ...})` like `check`.
   - `read_limit(request: Request, r: Annotated[RedisClient, Depends(get_redis)]) -> None`, a FastAPI dependency:
     `soft(lambda: check_ip(r, client_network(request), READ))`. A Redis failure lets the read through: public
     search worked without Redis before this spec and must not 503 because of it. Read `READ` at call time so a
     test can monkeypatch it.
   - `routers/search.py`: `GET /listings` and `GET /listings/{listing_id}` declare
     `dependencies=[Depends(limits.read_limit)]` and add `**limits.RATE_LIMITED` to `responses`. The two routes
     share one budget. Every request counts, a 404 included (the dependency runs before the handler).
6. **Per-network counters beside the per-account ones** (FOLLOWUPS 0010h):
   - `services/market_people.py`: `count_browse(r, user, network)` adds `(f"rl:browse:ip:{network}",
     BROWSE_RATE_LIMIT_IP_HOUR = 600, 3600)` to its one `count_or_raise` call: two accounts' worth of the
     per-account 300 an hour. No per-network day window, so the key lives at most an hour; each account's own
     1500 a day still holds, so a network browses 14,400 pages a day only with ten or more accounts.
     `browse(db, r, me, offset, network)` and `my_people_likes(db, r, me, network)` pass it through. The callers
     add `request: Request` and pass `client_network(request)`: `routers/market_people.py::browse_people` and
     `::my_people_likes`, `routers/people.py::list_people`, and `routers/search.py::_browse_allowed(r, user,
     network)` from `get_listing`. Errors and the fail-closed `_browse_allowed` are unchanged.
   - `services/reports.py`: `count_report(r, user, network)` adds `(f"rl:report:ip:{network}",
     REPORT_RATE_LIMIT_IP_HOUR = 20, 3600)` and `(f"rl:report:ip:day:{network}", REPORT_RATE_LIMIT_IP_DAY = 60,
     86_400)`, likewise two accounts' worth of the per-account 10 / 30. `report(db, r, me, body, network)`, and
     `routers/reports.py::create_report` adds `request: Request` and passes `client_network(request)`.
7. **Listing views per network, with a memory budget** `api/app/services/listing_views.py` (FOLLOWUPS 0011e):
   - `routers/search.py::get_listing` passes `f"ip:{client_network(request)}"` for an anonymous viewer (signed-in
     stays `u:{user.id}`).
   - `count_view` becomes one Lua `EVAL` run through `soft`. KEYS = `{KEY_PREFIX}seen:{h}`, `{KEY_PREFIX}budget`,
     `{KEY_PREFIX}pending`; ARGV = `SEEN_TTL_S`, `SEEN_BUDGET_PER_HOUR`, the listing id. When the budget counter is
     at `SEEN_BUDGET_PER_HOUR = 200_000`, nothing is written. Otherwise, if `SET seen NX EX` succeeds, it creates
     the budget counter (`SET 0 EX 3600 NX`), `INCR`s it and `HINCRBY`s pending. This bounds the `seen` keys to
     about 200,000 an hour (≈20–30 MB) in a `noeviction` Redis shared with OTP and rate limits, whatever the
     number of IPv6 networks. Over budget the view is simply not counted, and the page is unchanged.
   - `flush_views` parses field by field. A field whose key is not a UUID, or whose value is not an int, is
     skipped, never put back, and counted in one `log.warning("view flush skipped %d malformed field(s)", n)` (no
     field content). The good fields flush as today, sorted.
   - The module docstring: viewers are told apart by `client_network` (an IPv6 /64, an IPv4 address); the budget
     key; the malformed-field rule.
8. **Docstrings** that state the old rule: `routers/search.py::get_listing` ("once per viewer" gains "anonymous
   viewers per network (`client_ip.py`)"); `routers/auth.py` where it mentions the IP; `listing_views.py` (7).
9. **Tests infrastructure** `api/tests/conftest.py`:
   - Move `set_env` from `test_auth.py` to `conftest.py`, unchanged, since the new test files use it.
   - Add an autouse fixture that sets `redis_client._soft_skip_until = 0.0` (monkeypatch), so one test's simulated
     Redis failure never skips another test's calls.
   - Add an autouse fixture that deletes the `"testclient"` network's per-IP read, browse and report counters
     before each test: one `r.delete(...)` of the five keys `rl:read:ip:testclient`, `rl:read:ip:hour:testclient`,
     `rl:browse:ip:testclient`, `rl:report:ip:testclient` and `rl:report:ip:day:testclient`, no SCAN.
     Every TestClient request shares that one network, so without this the suite itself would trip the read
     limit. The OTP counters stay with the existing opt-in `redis_clean`.
10. **Existing tests this changes** (see Blast radius): `test_auth.py` asserts and deletes the old OTP keys by
    name. In `test_ac16_daily_email_rate_limit`, `test_ac17_email_failure_is_503_and_counted`,
    `test_ac16_burst_of_429s_does_not_consume_daily_budget` and
    `test_ac7_ip_limited_requests_do_not_count_against_email`, rename the keys
    (`rl:otp:email:{EMAIL}:net:testclient`, `rl:otp:email:day:{EMAIL}:net:testclient`, `rl:otp:ip:testclient`) and
    assert the new `rl:otp:email:all:day:{EMAIL}` and `rl:otp:ip:day:testclient` alongside. Also
    `test_reports.py::run` (L399: `report(...)` gains `network`), and
    `test_market_people.py` L818 (its `down` stub takes `*_`, so it still fits the new signature; no change).
    And `test_listing_views.py::test_ac4_view_count_never_fails_the_page`: it patches `redis.Redis.set` and reads
    the warning from logger `app.services.listing_views`, but `count_view` now calls `eval` through `soft`, whose
    warning comes from `app.redis_client`. It patches `redis.Redis.eval` instead, sets
    `app.dependency_overrides[limits.read_limit] = lambda: None` (as AC14, so the failing `eval` is
    `count_view`'s), and asserts the one `app.redis_client` warning naming `ConnectionError`; its 200,
    unchanged-body and no-`testclient` asserts stay.
11. **`specs/FOLLOWUPS.md`**: delete the lines this closes: 0001a `_count_request` (per-IP verify / IPv6 / email cap;
    the verify limit is not built, see Out), 0001a `OTP_RATE_LIMIT_EMAIL_DAY`, 0010h `count_browse` (per-IP browse,
    reports), 0011c `infra (Slice 13)` per-IP public reads, and 0011e `get_listing, count_view`, `flush_views` and
    `count_view` (Redis timeout). Add two lines: "0013b · `limits.READ` / the per-network numbers · sized for
    launch traffic; a carrier-grade-NAT address shared by many phones could hit 300 reads a minute or 3,000 an
    hour, and a carrier's IPv6 /48 16× that; raise `READ` or `PREFIX48_FACTOR` if a 429 shows up in logs from a
    real user · spec 0013b Risks" and "0013b · `OTP_RATE_LIMIT_EMAIL_ALL_DAY` · the per-email ceiling is not
    per network, so one attacker with many /64s can stop an email getting new codes for a day; the fix is a
    known-device exemption (a browser that signed in before, marked by a long-lived signed cookie, skips the
    ceiling) · spec 0013b Risks".

**Out:**
- **A per-network limit on `POST /auth/otp/verify`** (FOLLOWUPS 0001a): it adds no bound. A guess needs a pending
  code, each code allows 5 guesses, and codes are capped per email (20 a day) and per network (50 a day), so
  guesses are already bounded by codes, whichever network sends them.
- **A site-wide OTP send cap**: any global cap lets one attacker stop every login. The SMTP provider's own quota
  (0013a) is the backstop.
- **`/media`**: it exists only on the file backend (dev, CI). Production photos come from R2's public URL.
- **SSE per-IP and per-process stream caps**: FOLLOWUPS 0005c stays.
- **A known-device exemption** from the per-email ceiling (a browser that signed in before, marked by a
  long-lived signed cookie, skips it): the fix for the targeted lockout (Risks), a FOLLOWUPS line (Scope 11)
  unless Gilad brings it into Slice 13 (Digest, decision 1).
- **Day windows on the read and browse limits**: they would keep a key per network for a day (Risks, Redis
  memory; Digest, decision 2, option B).
- **A `cloudflare` proxy mode** (`CF-Connecting-IP`): needed only if the API is ever proxied by Cloudflare; 0013a
  serves it from Fly directly.
- **New 429 copy on the search and listing pages**: they show their existing error state;
  `0013g-review-minors.md` owns the web's `Retry-After` copy.
- **Admin hardening**: `0013e`.
- **The worker's log level** (FOLLOWUPS 0011e `worker.py`): `0013g-review-minors.md`.

**New dependencies:** none (`ipaddress` is the standard library).

## Data
No Postgres change, no migration. Redis keys added or renamed, all with a TTL:
- OTP: `rl:otp:email:{email}:net:{network}` (900 s) and `rl:otp:email:day:{email}:net:{network}` (86 400 s) replace
  `rl:otp:email:{email}` and `rl:otp:email:day:{email}`. New: `rl:otp:email:all:day:{email}` and
  `rl:otp:ip:day:{network}` (86 400 s), and for IPv6 `rl:otp:ip48:{p}` (900 s) and `rl:otp:ip48:day:{p}`
  (86 400 s). `rl:otp:ip:{network}` keeps its name; its value is now a network.
- `rl:read:ip:{network}` and `rl:read:ip48:{p}` (60 s), `rl:read:ip:hour:{network}` and `rl:read:ip48:hour:{p}`
  (3600 s), `rl:browse:ip:{network}` (3600 s), `rl:report:ip:{network}` (3600 s), `rl:report:ip:day:{network}`
  (86 400 s).
- `views:budget` (3600 s, fixed window from the first counted view).

**Backwards compatible.** Old OTP keys expire on their own within a day, and the limiter never reads them again,
so a deploy at most gives an email a fresh daily budget once. No other reader exists.

## API
Behaviour changes only; request and response bodies are unchanged.

| Method | Path | Auth rule (unchanged) | Change | Errors added |
| --- | --- | --- | --- | --- |
| POST | /auth/otp/request | public | counters per (email, network), the per-email ceiling, the per-network day cap and the IPv6 /48 caps (Scope 4) | none new (429 `rate_limited` + `Retry-After` exists) |
| GET | /listings | public | `read` bucket per network, 300 / min and 3,000 / hour (an IPv6 /48: 4,800 / min, 48,000 / hour), shared with the next row; fails open without Redis | 429 `rate_limited` + `Retry-After` |
| GET | /listings/{listing_id} | public | the same `read` bucket; anonymous views dedupe per network; budgeted view keys | 429 `rate_limited` + `Retry-After` |
| GET | /people | signed in, own visible card | browse also counted per network (600 / h) | none new (429 exists) |
| GET | /listings/{listing_id}/people | signed in, own live room | browse per network | none new |
| GET | /me/people-likes | signed in, own visible card | browse per network | none new |
| POST | /reports | signed in | reports also counted per network (20 / h, 60 / day) | none new (429 exists) |

The people on `GET /listings/{id}` (0010f) follow the browse counter, still never refusing the page.

## UI
No screen, layout or string changes. A 429 from the read limit shows the search page's and the listing page's
existing error states (0009f). No i18n keys added.

## Acceptance criteria
Tests that need other networks call `set_env(TRUST_PROXY="fly")` and send `Fly-Client-IP` with documentation
addresses (`203.0.113.0/24`, `198.51.100.0/24`, `2001:db8::/32`). AC2–AC14 use the `redis_clean` fixture: counters
for those addresses would otherwise outlive the test by up to a day.
- [ ] AC1 Given `client_network`:
  - IPv4 `203.0.113.7` → itself.
  - `2001:db8:1:2::a` and `2001:db8:1:2:ffff::1` → both `2001:db8:1:2::/64`; `2001:db8:1:3::a` → a different
    value.
  - `::ffff:203.0.113.7` → `203.0.113.7`.
  - With `TRUST_PROXY=none`, a `Fly-Client-IP` header is ignored (the peer is used).
  - With `fly`, it is used; an unparsable header (`"evil"`, `""`) falls back to the peer.
  - `X-Forwarded-For` is ignored in both modes; no client → `"unknown"`; peer `"testclient"` → `"testclient"`.
  - `network48("2001:db8:1:2::/64")` → `"2001:db8:1::/48"`; `network48` of `"203.0.113.7"`, `"testclient"` and
    `"unknown"` → None.
  — `api/tests/test_client_ip.py::test_ac1_client_network`; `Settings` refuses `TRUST_PROXY=evil` and defaults to
  `none` — `api/tests/test_config.py::test_ac1_trust_proxy_setting`
- [ ] AC2 Given email E, When 3 codes are requested from network A, Then a 4th from A is 429 with `Retry-After`,
  and a request for E from network B is 204 (an attacker on A no longer blocks E elsewhere). —
  `api/tests/test_auth.py::test_ac2_email_limit_is_per_network`
- [ ] AC3 Given E with A's 15-min counters reset between requests, When 10 codes are requested from A, Then the
  11th from A is 429 with `Retry-After` > 900, and B still gets 204. —
  `api/tests/test_auth.py::test_ac3_daily_email_limit_is_per_network`
- [ ] AC4 Given E, When 10 codes come from A and 10 from B (15-min counters reset between them), Then a request
  from a third network C is 429 with `Retry-After` > 900 (the per-email ceiling of 20), and nothing was counted
  for C. — `api/tests/test_auth.py::test_ac4_email_ceiling_across_networks`
- [ ] AC5 Given one network, When 50 codes are requested for 50 different emails (its 15-min counter reset every
  10), Then the 51st, for a new email, is 429 with `Retry-After` > 900; another network still gets 204. —
  `api/tests/test_auth.py::test_ac5_network_daily_cap`
- [ ] AC6 Given `Fly-Client-IP` values `2001:db8:1:2::a` then `2001:db8:1:2::b`, When each requests codes for
  different emails, Then they share `rl:otp:ip:2001:db8:1:2::/64`, and `2001:db8:1:3::a` does not; all three
  count in `rl:otp:ip48:2001:db8:1::/48`. Given `client_ip.PREFIX48_FACTOR` monkeypatched to 1 and 5 codes each
  from `2001:db8:1:2::a` and `2001:db8:1:3::a` (10 emails), When `2001:db8:1:4::a` requests a code for a new
  email, Then it is 429 with `Retry-After`, no `rl:otp:*` key names `2001:db8:1:4::/64` or that email, and
  `2001:db8:2:1::a` (another /48) gets 204. — `api/tests/test_auth.py::test_ac6_ipv6_counted_per_64`,
  `::test_ac6_ipv6_counted_per_48`
- [ ] AC7 Given `monkeypatch.setattr(limits, "READ", limits.IpBucket("read", 3, 5))`, When network A sends `GET
  /listings`, `GET /listings/{id}` and `GET /listings/{unknown id}` (a 404), Then a 4th read from A in the minute
  is 429 `rate_limited` with `Retry-After`. Network B still reads (200). With the minute counter deleted, A's 6th
  read of the hour is 429 with `Retry-After` > 60. No `rl:read:ip:day:*` key exists. Given the same bucket and
  `client_ip.PREFIX48_FACTOR` monkeypatched to 2, When `2001:db8:1:2::a` and `2001:db8:1:3::a` read 3 times each,
  Then the first read from `2001:db8:1:4::a` is 429 with `Retry-After`, no `rl:read:*` key names
  `2001:db8:1:4::/64`, and `2001:db8:2:1::a` still reads (200). —
  `api/tests/test_ip_limits.py::test_ac7_public_read_limit`, `::test_ac7_read_limit_per_48`
- [ ] AC8 Given `limits.count_or_raise` monkeypatched to raise `redis.exceptions.ConnectionError` (Python's
  built-in `ConnectionError` is not a `RedisError`), When `GET /listings` and `GET /listings/{id}` are called,
  Then both are 200. A second call within `SOFT_SKIP_S` does not call Redis at all
  (the stub counts calls). Once the window has passed (`redis_client._soft_skip_until` set to 0), the next call
  reaches Redis again. —
  `api/tests/test_ip_limits.py::test_ac8_read_limit_fails_open_and_skips`
- [ ] AC9 Given two accounts with visible cards on one network, and
  `market_people.BROWSE_RATE_LIMIT_IP_HOUR` monkeypatched to 3, When they browse `GET /people` 2 + 1 times, Then
  the next browse by either is 429. An account on another network still browses, and the refused request left
  both accounts' own counters unchanged. Likewise `GET /listings/{id}/people` and `GET /me/people-likes` share the
  counter, and `GET /listings/{room}` then serves `people: []` with 200. —
  `api/tests/test_ip_limits.py::test_ac9_browse_per_network`
- [ ] AC10 Given two accounts on one network and `reports.REPORT_RATE_LIMIT_IP_HOUR` monkeypatched to 2, When they
  report 2 distinct targets, Then a third report (either account) is 429, nothing is stored for it, and another
  network still reports (201). — `api/tests/test_ip_limits.py::test_ac10_reports_per_network`
- [ ] AC11 Given `TRUST_PROXY=fly`, When anonymous visitors open one live listing as `203.0.113.7`,
  `198.51.100.9`, `2001:db8:1:2::a` and `2001:db8:1:2::b`, Then `flush_views` adds 3 (two /64-mates are one
  viewer), and no `test-views:` key or value contains an address. —
  `api/tests/test_listing_views.py::test_ac11_anonymous_views_per_network`
- [ ] AC12 Given `listing_views.SEEN_BUDGET_PER_HOUR` monkeypatched to 2, When 3 different anonymous networks view
  a listing, Then 2 views are pending, only 2 `seen` keys exist, and the third page is 200 and unchanged. —
  `api/tests/test_listing_views.py::test_ac12_seen_key_budget`
- [ ] AC13 Given `test-views:pending` holding two good fields, a `not-a-uuid` field and a good uuid with value
  `x`, When `flush_views` runs, Then the two good counts are added to `listings.view_count`, the hash is empty
  afterwards (the bad fields are not put back), the return value is the good sum, and one warning names the count
  2 and no field content (caplog). — `api/tests/test_listing_views.py::test_ac13_flush_skips_malformed_fields`
- [ ] AC14 Given `app.dependency_overrides[limits.read_limit] = lambda: None` (the read limit runs first on the
  same client, so without it the read limit's `eval` would be the call that fails) and the Redis client's `eval`
  raising `redis.exceptions.TimeoutError` (monkeypatched on the client `get_listing` receives), When three
  listing pages are opened within `SOFT_SKIP_S`, Then all are 200, Redis was called once, and one warning was
  logged. — `api/tests/test_listing_views.py::test_ac14_view_skips_redis_after_error`
- [ ] AC15 The existing OTP, report, browse and view tests pass, with the renamed keys and the rewritten
  `test_listing_views.py::test_ac4_view_count_never_fails_the_page` (Scope 10): `test_auth.py` (all),
  `test_reports.py`, `test_market_people.py`, `test_people.py`, `test_listing_views.py`, `test_hardening.py`. —
  those files
- [ ] NF1 `make lint`, `make test`, `make i18n-check` pass; `make client` regenerated (the 429 entries on the two
  reads). CI's e2e passes unchanged: `make e2e` already clears `rl:*` before every shard, and one shard stays under
  10 sign-ups, 300 reads a minute and 3,000 an hour. — CI
- [ ] NF2 The bound of Scope 4 holds in the constants: `OTP_MAX_ATTEMPTS * OTP_RATE_LIMIT_EMAIL_ALL_DAY <= 100`,
  and `OTP_RATE_LIMIT_EMAIL_DAY < OTP_RATE_LIMIT_EMAIL_ALL_DAY` (one network alone cannot exhaust an email's day);
  the module docstring states both. — `api/tests/test_auth.py::test_nf2_guess_bound`

## Tests to write
Unit: `test_client_ip.py` (AC1). Integration: `test_auth.py` AC2–AC6 plus the renamed keys; `test_ip_limits.py`
(new) AC7–AC10; `test_listing_views.py` AC11–AC14 and the rewritten `test_ac4_view_count_never_fails_the_page`
(Scope 10). E2E: none new (NF1).

## Blast radius
From `graphify affected` on `main` (2026-11-15); `request.client.host` traced by grep (two uses, both replaced).
- `services/auth.py::request_otp` / `_count_request`: called only by `routers/auth.py::request_otp` (L62). Tests by
  HTTP: `test_auth.py` (keys renamed, Scope 10), `conftest.py::signup` (unchanged; ≤10 sign-ups per test as today).
- `request.client.host`: `routers/auth.py:60` and `routers/search.py:157`, both replaced by `client_network`.
- `market_people.count_browse`: `services/market_people.py::browse` (L241), `::my_people_likes` (L461),
  `routers/people.py::list_people` (L120), `routers/search.py::_browse_allowed` (L113, from `get_listing` L171).
  `browse` is called by `routers/market_people.py::browse_people` (L105), `my_people_likes` by
  `routers/market_people.py::my_people_likes` (L189). All gain `network` (Scope 6).
  `test_market_people.py` L818 stubs it with `*_` (fits).
- `reports.count_report`: `services/reports.py::report` (L69), called by `routers/reports.py::create_report` (L52)
  and `test_reports.py::run` (L399, `test_ac7_repeat_is_already_reported`): `run` passes a network.
- `listing_views.count_view`: `routers/search.py::get_listing` (L158) only.
  `test_listing_views.py::test_ac4_view_count_never_fails_the_page` patches `redis.Redis.set` and filters logger
  `app.services.listing_views`, so it changes with the `EVAL` through `soft` (Scope 10).
- `listing_views.flush_views`: `worker.py::_flush_views` (L55) / `flush_listing_views` (L61);
  `test_listing_views.py::test_ac3_flush_views`, `test_applications.py::test_ac8_applicant_count_and_view_counter`
  (L562), `test_worker.py`: return value and behaviour on good fields unchanged.
- `routers/search.py::search_listings` and `get_listing`: every test that calls `GET /listings` or `GET
  /listings/{id}` now counts against `rl:read:ip:testclient`. The autouse cleanup (Scope 9) keeps the suite under
  300 a minute and 3,000 an hour per test.
- `Settings` (`config.py`): one new field with a default. `get_settings` callers and `test_config.py`'s
  construction tests (`test_ac12_settings_defaults_for_auth`, `test_https_web_origin_refuses_dev_defaults`, …) are
  unaffected; 0013a may add `trust_proxy` to its production guard.
- `redis_client.get_redis`: unchanged; `soft` is new.

## Risks / open questions
- **Per-email ceiling: 20 a day, accepted at launch (one constant; Digest, decision 1).** It is the one OTP counter
  not scoped per network, by design: it is what bounds guessing (100 a day, 0.3 % a month against one targeted
  account). The cost is a targeted lockout. A network is an IPv4 address or an IPv6 /64, and a home IPv6 line
  (often a /56) or a free /48 tunnel holds hundreds of them (the /48 cap of 160 per 15 min does not stop 20), so
  one attacker on one connection can stop any email getting new codes for a day with 20 requests. Signed-in
  sessions (30 days, `SESSION_TTL_S`) are unaffected, so it bites only someone who must sign in that day. 30
  would not change who can do it and would allow 150 guesses a day. The fix is the known-device exemption (Out),
  a FOLLOWUPS line unless Gilad brings it into Slice 13.
- **Carrier-grade NAT**: a mobile carrier's shared IPv4 is one network, and a carrier may hand many phones /64s
  from one /48. 300 reads a minute and 3,000 an hour, 600 browse pages an hour, 20 reports an hour and 10 OTP
  requests per 15 min are each far above one person, and a /48 gets 16× the read and OTP limits, but a busy NAT
  could reach the OTP 15-min limit at scale. The FOLLOWUPS line (Scope 11) asks to watch for real-user 429s.
- **IPv6**: an attacker with a routed /48 has 65,536 /64s. The /48 counters make it count as at most 16 networks
  on reads and OTP requests; past that, per-network limits are a brake, not a wall. The per-email ceiling bounds
  OTP guesses whatever the networks; Redis memory is the next bullet.
- **Redis memory** (0013a: `--maxmemory 200mb`, `noeviction`). A full Redis refuses writes, so `POST
  /auth/otp/request` fails for everyone and nobody can sign in; reads and views fail open. A counter key is about
  100 B (an attacker's 254-character email makes an OTP key about three times that), so 200 MB is about 2 M keys.
  Every new network creates its own keys, so the bound is per network, not global:
  - a read creates at most 2 keys for its network and 2 for its /48, all gone within an hour (Scope 5). Filling
    Redis takes about 2 M reads from fresh networks within one hour (≈ 550 a second): some 40 IPv6 /48s at their
    48,000 an hour, or about 2 M distinct IPv4 addresses. Memory frees itself within an hour of the attack
    stopping.
  - an accepted OTP request creates at most 5 counters, about 2 of them for 24 h when every request uses a new
    email, plus the 10-minute code (`otp:{email}`). A network is accepted at most 50 times a day and a /48 800
    times, so filling Redis takes roughly 300,000 to 1 M accepted requests in one day (6,000 to 20,000 IPv4
    addresses, or 400 to 1,250 /48s), each one an email sent, past the point where the SMTP provider's quota
    (0013a) already stops login mail.
  - browse (at most 1 key per page, for an hour) and reports (2 per report, one for 24 h) need an account, and
    each account's own limits (300 pages an hour, 30 reports a day) cap the keys it can create.
  - views: at most 200,000 `seen` keys an hour (Scope 7).
  Before this spec all of it sat under one proxy address. The alert is 0013a's (runbook §11): a free Fly Grafana
  alert on `homie-redis` VM memory at 70 % of the 256 MB VM. Hour-only read and browse windows plus the /48
  counters are the default (Digest, decision 2, option A).
- **Trust**: `TRUST_PROXY=fly` is safe only while every request reaches the API through Fly's proxy; anyone on the
  Fly private network could send a forged `Fly-Client-IP`. 0013a's "runbook §9, Fly-Client-IP check" proves Fly
  overwrites a client-sent value: after the first deploy of this code, 4 `POST /auth/otp/request` calls for an
  address Gilad owns, each with a different forged `Fly-Client-IP`, must end with the 4th answering 429 (the
  per-(email, network) limit of 3 counts the real address); a 204 keeps homie private. 0013a gives the API one
  public path, the `app` process's `[http_service]`, and must keep it that way.
- **Shared files with parallel specs** (mechanical conflicts; the second to merge merges `origin/main`):
  `services/auth.py` with 0013c (0013c changes `verify_otp`'s sign-up branch and nothing else there; this spec
  changes only `_count_request`, `request_otp`, the constants and the module docstring);
  `config.py` and `.env.example` with 0013a (this spec adds only `trust_proxy` / `TRUST_PROXY`);
  `specs/FOLLOWUPS.md` with all of Slice 13.
- **e2e headroom**: if a CI run shows 429s on reads, the shard passed 300 reads a minute or 3,000 an hour. Raise
  `READ`; never exempt an address.

## Verifier notes
2026-11-15, one round against `.claude/agents/spec-verifier.md`'s checklist, run inline by the orchestrator's
spec fork (a fork may not start a subagent). Changes made: `qa` added to reviewers (rule 8: new 429s on two public
API reads); the claim that a 422 counts against the read limit removed (not tested, not needed); `redis_clean`
required for AC2–AC14 (counters for documentation addresses outlive a test); AC8's "after the window" made
testable; NF2 turned from a review item into a constants test; AC1 gained the `Settings` check; Blast radius
gained `test_config.py`. Checklist 1–11 pass; no product question left for the coder (the per-email ceiling is a
stated default, see Risks).

## Digest (filled by orchestrator after verification)
Spec 0013b — Real client networks for every per-IP limit   (verified, 1 part; 0013e is the admin half)
What a user can do after this: codes requested from one network no longer lock an email out everywhere, and one
network can only read, browse and report within a budget, once 0013a's Fly deploy sets TRUST_PROXY=fly. The
per-email ceiling (20 codes a day across networks) is not per network: one attacker with many IPv6 /64s (or a
free /48 tunnel) can still stop any email getting new codes for a day. Existing sessions are unaffected.
Decisions I need from you (reply with numbers): 1. The per-email ceiling's targeted lockout: (a) 20 a day,
accepted at launch (recommend: guesses bounded at 100 a day); (b) 30 (no harder to lock out, guesses up to 150 a
day); (c) a known-device exemption: a browser that signed in before (a long-lived signed cookie) skips the
ceiling, a follow-on spec in Slice 13. The build uses (a), and (c) becomes a FOLLOWUPS line. 2. Redis memory
when an attacker rotates networks (a full Redis stops every login): (A) read and browse windows of at most an
hour, no day window, plus an IPv6 /48 counter at 16× and 0013a's memory alert (recommend: memory bounded by an
hour's traffic); (B) keep the day windows (reads 20,000 / day, browse 3,000 / day per network) and add the /48
counter and the alert (stronger anti-scraping, but day-long keys); (C) accept the risk with the alert only. The
build uses (A).
KPIs this slice moves: login lockouts reported (should stay 0), Redis memory under attack (bounded by an hour's
traffic, alert at 70 %).
Acceptance targets: OTP 3 / 15 min and 10 / day per (email, network), 20 / day per email, 10 / 15 min and 50 / day
per network, 160 / 15 min and 800 / day per IPv6 /48; public reads 300 / min and 3,000 / hour per network, 4,800 /
min and 48,000 / hour per /48; browse 600 / h per network; reports 20 / h, 60 / day per network; view keys ≤
200,000 an hour.
Risks: the per-email ceiling is a cheap targeted lockout (decision 1); a network rotation can still fill Redis,
within an hour's traffic (decision 2; 0013a's runbook §11 alert); a mobile carrier's shared IPv4 is one network
(limits sized far above one person; a FOLLOWUPS line says to watch for real-user 429s); TRUST_PROXY=fly is safe
only behind Fly's proxy (0013a's runbook §9, Fly-Client-IP check).
Reviewers: code, security, qa, perf   Estimated: 1 coder run (Opus), 1 review round
Links: specs/0013b-security-hardening.md · PRODUCT.md "Launch (Slice 13)", "Trust (MVP)" · no artboard

## Verifier findings (independent, 2026-11-15)
1. **Rule 11 (blast radius).** `api/tests/test_listing_views.py::test_ac4_view_count_never_fails_the_page` patches
   `redis.Redis.set` to raise and asserts one warning from logger `app.services.listing_views` naming
   `ConnectionError`. After Scope 7, `count_view` calls `eval` through `soft`, and the warning comes from
   `app.redis_client` ("redis call skipped"). Patching `set` then raises nothing, and the logger filter finds no
   record, so the test fails. AC15 says it passes unchanged, and neither Scope 10 nor Blast radius lists it. Fix: add
   it to Scope 10 (patch `eval`, assert the `app.redis_client` warning, or delete it because AC14 replaces it) and
   to Blast radius under `listing_views.count_view`.
2. **Security / Redis failure (Risks are inaccurate).** Risks says the per-email ceiling and the views budget
   "bound ... Redis memory regardless". They do not. Every new network creates its own TTL'd counters:
   `rl:read:ip:day:{n}` (24 h) on any read, and on OTP requests `rl:otp:ip:day:{n}` plus two
   `rl:otp:email[:day]:{e}:net:{n}` keys per email, up to 50 emails per network a day. 0013a runs Redis at
   `--maxmemory 200mb --maxmemory-policy noeviction`. So an attacker who rotates /64s can fill Redis: one free
   tunnel /48 gives 65,536 networks, and residential IPv4 proxies give thousands. A full Redis refuses writes, so
   `POST /auth/otp/request` fails for everyone and nobody can log in. The read limit and views fail open. Before
   this spec, all of this sat under one proxy address. Fix: state the real bound in Risks (keys ≈ networks × (2 + 3
   × emails per network), about 100 B each). Then pick a default: (a) add an IPv6 /48 aggregate counter beside
   the /64 one for the OTP and read buckets (for example 10× the /64 limit), which bounds keys per /48; or (b)
   accept it and add a FOLLOWUPS line asking 0013a for a Redis memory alert. Name the choice as a security
   trade-off for Gilad (Speed rule 9).
3. **Rule 7 / lockout math framing.** PRODUCT.md "Launch (Slice 13)": "scope the OTP lockout per (email, network)".
   The per-email ceiling is a lockout that is not scoped per network. The Goal ("can no longer lock someone out
   ... from a single network") and the Digest ("a lockout needs 2 networks" vs 3) read as if this takes two
   attackers. A network is a /64, and a single home IPv6 line (often a /56) or a free /48 tunnel already holds
   hundreds. One attacker on one connection still locks any email out for a day with 20 requests, or 30 at the
   other value. The 20-vs-30 choice therefore does not change who can do it. Fix: say this plainly in Goal, Risks
   and the Digest decision line. Give Gilad the real option next to 20/30: "accept a cheap targeted lockout at
   launch (sessions last 30 days, so it only bites someone who must log in that day)" vs "bring known-device
   exemption from the per-email ceiling into Slice 13 (a follow-on spec)". Keep the stated default.
4. **Rule 10 (hidden dependency).** Trust in `Fly-Client-IP` rests on Fly overwriting a client-sent value and on
   the API having no second path. Risks hands that check to "0013a's runbook", but
   `specs/0013a-production-deploy.md` has no such step (its only `Fly-Client-IP` mention is the DNS-only
   rationale). Fix: the orchestrator adds the check to 0013a's post-deploy runbook before 0013a builds. The step
   sends `curl -H 'Fly-Client-IP: 192.0.2.1' https://api.<domain>/listings` and confirms that no
   `rl:read:ip:192.0.2.1` key appears and that the caller's real address does. 0013b's Risks then cites that
   step, not "should".
5. **Rule 1 (testable as written).** AC8: say `redis.exceptions.ConnectionError` (Python's built-in
   `ConnectionError` is not a `RedisError`, so `soft` would let it through), and name the patch target
   `limits.count_or_raise` (`limits.py` imports it by name). AC14: `read_limit` runs first on the same client, so
   its `eval` is the one call that fails, and `count_view`'s own error path is never exercised. Fix: in AC14, set
   `app.dependency_overrides[limits.read_limit] = lambda: None` so that the failing `eval` is `count_view`'s.
6. **Rule 8 (reviewers).** "perf for search": the spec adds one Redis `EVAL` to every `GET /listings` and `GET
   /listings/{id}`, replaces the view write with a Lua script, and closes the 0011e perf FOLLOWUP (`count_view`
   timeout). Fix: `reviewers: [code, security, qa, perf]` (perf on Sonnet/medium).

Checked and fine: `request.client.host` has exactly two code uses (`routers/auth.py:60`, `routers/search.py:157`)
plus the `listing_views.py` docstring (Scope 7). No other `X-Forwarded-For` / proxy-header use; uvicorn runs at
its default `forwarded_allow_ips=127.0.0.1`. `client_network` never reads a spoofable header in `none` mode,
and in `fly` mode it reads only `Fly-Client-IP`. Every refused OTP request counts nothing (one `count_or_raise`).
The guess bound of 100 a day holds (fixed windows, as before). OTP stays fail-closed (503) without Redis, while
reads and views fail open. The other graphify callers (`count_browse`, `count_report`/`report`, `flush_views`,
`request_otp`, `Settings`, `set_env`) are all in Scope or untouched with a reason. Sibling overlaps (0013a, 0013c)
are named. The ceiling default (20) is stated.

Applied by the orchestrator (2026-11-15):
1. Scope 10 rewrites `test_ac4_view_count_never_fails_the_page` (patch `eval`, override `read_limit`, assert the
   `app.redis_client` warning); Blast radius lists it under `count_view`; AC15 and Tests to write name it.
2. Risks states the real per-network key bound. Default (A) in Scope 5–6, Data, API and ACs: reads 300 / min and
   3,000 / hour, browse 600 / hour, no day windows; IPv6 /48 counters at 16× for reads and OTP, first in the same
   call (AC1, AC6, AC7); 0013a's runbook §11 alert cited. Options A/B/C are Digest decision 2.
3. Goal, Scope 4's docstring, Risks and the Digest say the per-email ceiling is not per network and one attacker
   can lock an email out of new codes for a day. Decision 1 offers 20 (default), 30 or a known-device
   exemption; Out and a Scope 11 FOLLOWUPS line name the exemption.
4. Risks cites 0013a's "runbook §9, Fly-Client-IP check" (4 forged-header OTP requests, the 4th must be 429).
5. AC8 names `redis.exceptions.ConnectionError` and `limits.count_or_raise`; AC14 overrides `limits.read_limit`.
6. `reviewers: [code, security, qa, perf]`, with the reason in the frontmatter comment and the Digest.
Also: the worker log level and the web's `Retry-After` copy point to `0013g-review-minors.md`, not 0013d.

## Digest (merged, PR #106, 4743331)
Spec 0013b — Real client networks for every per-IP limit   MERGED 4743331
Shipped: once 0013a deploys with `TRUST_PROXY=fly`, every per-IP limit counts the visitor's real network (`Fly-Client-IP`), not the proxy. A network is an IPv4 address or an IPv6 /64, with a /48 counter at 16× beside it.
- OTP codes: 3 / 15 min and 10 / day per (email, network); 20 / day per email across all networks; 50 / day per network.
- Public reads: 300 / min and 3,000 / h per network, allowed through if Redis is down.
- Browse 600 / h and reports 20 / h per network.
- Anonymous listing views count once per network, capped at 200,000 view keys an hour.
Demo (`make dev`): 1. Request a code for one email 4 times: the 4th is 429. 2. With `TRUST_PROXY=fly`, send another `Fly-Client-IP`: that request succeeds. 3. Stop Redis: `/listings` still loads.
Tests: +2 unit, +16 integration, +0 e2e   CI: 8.6 min (ee0d322, e2e skipped by the `skip-e2e` label)
Findings: 0 blockers, 0 majors. 2 minors fixed: the Redis skip window is timed from the failure, and a full Redis answers the JSON 503. 4 minors logged in FOLLOWUPS: duplicate `Fly-Client-IP` headers, the view budget running out silently, the threadpool burst while Redis hangs, no 429 vitest.
CI fix: `test_nf1_owner_check_is_one_pass` no longer pins the planner's parent node; it keeps the one-pass guard.
Changed in PRODUCT.md: nothing (decisions 1 = 20 a day, 2 = option A, as the spec defaulted).
Next spec I propose: none from this session; 0013a (deploy) is parked because it needs paid accounts.
