---
id: 0001a
title: A person signs up or logs in with an email one-time code, choosing owner or seeker at signup, and the API knows who they are on every request via a session cookie
status: in-progress
depends_on: [0000a]
reviewers: [code, qa, security]   # security: OTP, sessions, cookies, rate limits, email PII
estimate: 1 coder run
---

## Goal
After this ships, `POST /auth/otp/request` emails a 6-digit code, `POST /auth/otp/verify` turns it into a
session cookie (creating the account on first use, with display name and role), `GET /me` returns the
current user and `POST /auth/logout` ends the session. Every later endpoint can require a user with one
dependency. Serves Dev Plan slice 1 (Auth + roles), part a of two; part b (`0001b`) is the web login/signup
flow. PRODUCT.md: "OTP — Email OTP in Slice 1; SMS adapter stubbed behind an interface", "Trust (MVP) —
rate limits", "Brokers — Broker account type reserved in the data model", "Account roles" and "Signup data"
(decided 2026-11-09).

Built on branch `spec/0001a-auth-api` from `spec/0000a-foundations-api` (the `api/` code is not on `main`
until Gilad merges 0000a); rebased onto `main` after that merge.

## Scope
**In:**
- Tables `users` and `sessions` (migration `0002_users_sessions`, see Data). OTP codes and rate-limit
  counters live in Redis with TTLs, not in Postgres.
- `api/app/models/user.py` (`User`), `api/app/models/session.py` (`Session`), both exported from
  `models/__init__.py` so Alembic autogenerate sees them. Models declare the FK, the unique constraints, the
  named CHECK constraints and `Index("ix_sessions_user_id", …)` exactly as the migration does, so the existing
  `test_ac4_autogenerate_sees_no_diff_with_postgis_extensions` stays green.
- `api/app/schemas/auth.py`: `OtpRequestIn`, `ProfileIn` (`str_strip_whitespace=True`; `display_name` 2–40
  code points after stripping), `OtpVerifyIn` (`code` pattern `^[0-9]{6}$` — not `\d`, which admits
  Arabic-Indic digits), `UserOut`.
- `api/app/services/auth.py`: `request_otp`, `verify_otp`, `create_session`, `revoke_session`,
  `resolve_session`; constants `OTP_TTL_S = 600`, `OTP_MAX_ATTEMPTS = 5`, `OTP_RATE_LIMIT_EMAIL = 3` per
  `OTP_RATE_WINDOW_S = 900`, `OTP_RATE_LIMIT_EMAIL_DAY = 10` per `OTP_RATE_DAY_S = 86_400`,
  `OTP_RATE_LIMIT_IP = 10` per `OTP_RATE_WINDOW_S`, `SESSION_TTL_S = 30 * 24 * 3600`. Module docstring states
  the brute-force bound (NF2). Code comparison uses `hmac.compare_digest`.
- `api/app/services/email.py`: `EmailSender` Protocol (`send(to, subject, body) -> None`),
  `FileEmailSender` (creates `EMAIL_OUTBOX_DIR` if missing; writes one JSON file `{to, subject, body,
  sent_at}` per message named `{UTC %Y%m%dT%H%M%S%f}-{uuid4 hex}.json` so two messages in one second cannot
  collide; dev and e2e default) and `SmtpEmailSender` (stdlib `smtplib` over `SMTP_URL`, `smtp://` STARTTLS
  default port 587 or `smtps://` implicit TLS default port 465, socket `timeout=10`; never logs the body;
  raises `EmailUnavailable`). Dependency `get_email_sender()` picks by `EMAIL_BACKEND`.
- `api/app/services/sms.py`: `SmsSender` Protocol (`send(to_e164, body) -> None`) and `NoopSmsSender`
  (logs the length of the body only, never the body). **No caller in this slice**: the stub exists so the
  switch-on at launch readiness is a config change, as PRODUCT.md requires. No phone numbers are stored.
- `api/app/i18n/he.py`: `EMAIL_OTP_SUBJECT = "קוד הכניסה שלך"`, `EMAIL_OTP_BODY` = three plain-text
  lines: `הקוד שלך לכניסה:`, the code **alone on its own line** (so bidi reordering cannot scramble it),
  `הקוד תקף ל-10 דקות. אם לא ביקשת אותו, אפשר להתעלם מההודעה.` Placeholders; Slice 9 owns final wording.
  API-origin user-facing text lives here; `CLAUDE.md` rule 4's `he.json` covers web components.
- `api/app/redis_client.py`: `get_redis()` — one cached sync `redis.Redis` client from `REDIS_URL`
  (`socket_connect_timeout=1`, `socket_timeout=1`). Named `redis_client` so `app.redis` is never confused
  with the `redis` package. `/health` keeps its own per-call ping (FOLLOWUPS).
- `api/app/auth.py`: FastAPI dependencies `current_user` (401 `unauthenticated` when no valid session) and
  `optional_user` (None instead of 401). Cookie name `rent_session`.
- `api/app/routers/auth.py`: the four endpoints in API. Thin; all logic in `services/auth.py`.
- `api/app/config.py`, on `Settings` only (never `DatabaseSettings`: Alembic and `seed.py` keep working with
  just `DATABASE_URL`): `secret_key: SecretStr` (required, validator: ≥ 32 characters),
  `email_backend: Literal["file", "smtp"] = "file"`, `email_outbox_dir: Path = Path("./.outbox")`,
  `smtp_url: SecretStr | None = None` (model validator: required when backend is `smtp`),
  `email_from: str = "noreply@localhost"`, `cookie_secure: bool = False`.
- `api/app/main.py`: no change to CORS — `allow_credentials=True` with the exact `WEB_ORIGIN` is already
  there from 0000a; this slice adds the test that pins it (AC15) because `0001b` depends on it.
- Configuration plumbing for the new required secret, so nothing that runs today breaks:
  `Makefile` `export SECRET_KEY ?= dev-only-secret-change-me-0123456789abcdef`; the same `SECRET_KEY:
  ${SECRET_KEY:-dev-only-secret-change-me-0123456789abcdef}` on **both** compose services `api` and `worker`
  (`worker.py` loads settings at import); `SECRET_KEY` in the `.github/workflows/ci.yml` `env:` block.
  `.env.example`: `SECRET_KEY` with that same dev value (its values equal the Makefile defaults),
  `EMAIL_BACKEND=file`, `EMAIL_OUTBOX_DIR=./.outbox`, `EMAIL_FROM=noreply@localhost`, `COOKIE_SECURE=false`,
  and `# SMTP_URL=smtp://user:pass@smtp.example.com:587` commented out like the DSNs.
- `infra/docker-compose.yml`: `api` gets `EMAIL_BACKEND: file`, `EMAIL_OUTBOX_DIR: /outbox` and the volume
  `../.outbox:/outbox`. The api image runs as uid 10001 and the Docker daemon creates a missing bind-mount
  source as `root:root 755`, so `make dev` runs `mkdir -p .outbox && chmod 0777 .outbox` before `compose up`.
  `.outbox/` added to `.gitignore` and `.dockerignore`. `make down` also empties `.outbox/`.
- Tests: `api/tests/test_auth.py` (new), `api/tests/test_email.py` (new), `api/tests/test_config.py`
  (extended), `api/tests/test_migrations.py` (extended). `conftest.py`: `db_engine` truncates
  `sessions, users, areas`; new fixtures `redis_clean` (deletes `otp:*` and `rl:*` keys via SCAN before each
  test) and `outbox` (in-memory `EmailSender` collecting `(to, subject, body)`, installed with
  `app.dependency_overrides[get_email_sender]`). Test addresses use `@example.com` (see Risks).
- `README.md`: "Logging in locally" — the code is in the newest file under `.outbox/`.

**Out:**
- Web screens (`0001b`). Switching role after signup (`PATCH /me`; the slice that first needs it, likely
  Slice 7 Rooms, adds it). Phone numbers, SMS sending, SMS verification (switch-on at Slice 12 per
  PRODUCT.md). Admin accounts and endpoints (Slice 11). Broker tier behaviour (reserved column only).
  Account deletion / GDPR export (Slice 10). "Log out everywhere". Sending email through the arq worker
  (inline send is fine at this scale; revisit if `/auth/otp/request` p95 exceeds NF1). Password login:
  never (OTP only, PRODUCT.md).

**New dependencies:**
- `email-validator` (via `pydantic[email]`, pinned in `api/pyproject.toml`) for `EmailStr`. Nothing else:
  `hmac`, `hashlib`, `secrets`, `smtplib` are stdlib; `redis` is already a dependency.

## Data
Migration `api/alembic/versions/0002_users_sessions.py`, `revision = "0002"`, `down_revision = "0001"`
(downgrade drops `sessions` then `users`; no enum types, so downgrade is two `DROP TABLE`s). Roles and
account types are `text` with named `CHECK` constraints, not Postgres enums, so adding a value later is one
migration without type juggling.

`users`
| column | type | notes |
| --- | --- | --- |
| id | uuid PK default gen_random_uuid() | |
| email | text NOT NULL UNIQUE | stored lowercased and stripped by the service; the UNIQUE constraint is on the stored value |
| display_name | text NOT NULL | `ck_users_display_name_length`: `char_length(display_name) BETWEEN 2 AND 40` (stripped before the check) |
| role | text NOT NULL | `ck_users_role`: `role IN ('owner','seeker')` — chosen at signup (PRODUCT.md "Account roles") |
| account_type | text NOT NULL default 'individual' | `ck_users_account_type`: `account_type IN ('individual','broker')`; `broker` reserved, never set in this slice |
| created_at | timestamptz NOT NULL default now() | |
| last_login_at | timestamptz NULL | set on every successful verify |

`sessions`
| column | type | notes |
| --- | --- | --- |
| id | uuid PK default gen_random_uuid() | |
| user_id | uuid NOT NULL FK users(id) ON DELETE CASCADE | index `ix_sessions_user_id` |
| token_hash | text NOT NULL UNIQUE | sha256 hex of the cookie value; the raw token is never stored |
| created_at | timestamptz NOT NULL default now() | |
| expires_at | timestamptz NOT NULL | `created_at + 30 days`, fixed (no sliding renewal in this slice) |
| revoked_at | timestamptz NULL | set by logout; a revoked or expired row never authenticates |

Redis (all keys TTL-bound; `email` below is the normalised address):
- `otp:{email}` — hash `{code_hmac, attempts}`, TTL `OTP_TTL_S`. `code_hmac = HMAC-SHA256(SECRET_KEY, code)`.
  A new request overwrites the previous code. Deleted on success or when `attempts` reaches `OTP_MAX_ATTEMPTS`.
  A 422 `profile_required` does **not** increment `attempts`.
- `rl:otp:email:{email}` (limit 3, window 900 s), `rl:otp:email:day:{email}` (limit 10, window 86 400 s),
  `rl:otp:ip:{ip}` (limit 10, window 900 s). Each is created with `SET key 0 EX window NX` and then `INCR`
  inside one `MULTI`, so a crash between the two can never leave a counter without a TTL (a permanent
  lockout). `ip` is `request.client.host` (no proxy headers; the reverse proxy at deploy time, Slice 12,
  sets the real client IP).

Backwards compatibility: additive tables; nothing running depends on them.

## API
Cookie: `rent_session=<token_urlsafe(32)>; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`; `Secure` when
`COOKIE_SECURE=true`. Starlette renders attribute names/values in its own case (`SameSite=lax`); tests parse
`Set-Cookie` with `http.cookies.SimpleCookie` and compare case-insensitively. The logout cookie is Starlette's
`delete_cookie` (`rent_session=""; Max-Age=0; expires=<past>`) with the same `Path`, `HttpOnly`, `SameSite`
and `Secure` as the set cookie. CSRF defence is `SameSite=Lax` (browsers omit the cookie on cross-site POSTs)
plus the exact-origin credentialed CORS from `0000a`; there are no cookie-authenticated GETs with side effects.

| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| POST | /auth/otp/request | public | `{"email": EmailStr}` | 204 empty — identical for known and unknown addresses (no enumeration). Side effect: code generated with `secrets.randbelow(10**6)` zero-padded to 6 digits, HMAC stored in Redis, email sent via `EmailSender` | 422 invalid email · 429 `{"detail":"rate_limited"}` with `Retry-After: <seconds left in the window that tripped>` when any of the three counters is over its limit (counted before sending, so a limited request sends nothing) · 503 `{"detail":"email_unavailable"}` when the sender raises `EmailUnavailable` (the attempt still counts against the limits; the Redis OTP key is deleted so a stale code cannot linger) |
| POST | /auth/otp/verify | public | `{"email": EmailStr, "code": "^[0-9]{6}$", "profile": {"display_name": str 2–40 stripped, "role": "owner"\|"seeker"} \| null}` | existing user: 200 `UserOut` + `Set-Cookie` (`profile` ignored, nothing overwritten); new user with `profile`: 201 `UserOut` + `Set-Cookie`, row created with `account_type='individual'`; both set `last_login_at` and delete the OTP key. Two concurrent first verifies for one email: the losing `INSERT` hits `IntegrityError`, is treated as a login of the row that won (200), never a 500 | 401 `{"detail":"invalid_code"}` for wrong, expired, exhausted or never-requested codes (one message, no distinction; a wrong code increments `attempts`) · 422 `{"detail":"profile_required"}` when the code is right but no account exists and `profile` is missing — `attempts` unchanged, the code stays valid so the client can resubmit with a profile · 422 FastAPI validation error (`detail` is a list) on a malformed body. No 429 on this endpoint: brute force is bounded by `attempts`, not by a counter |
| GET | /me | session cookie required (`current_user`) | – | 200 `UserOut` | 401 `{"detail":"unauthenticated"}` (missing, unknown, expired or revoked cookie) |
| POST | /auth/logout | public, idempotent: revokes the session if the cookie is valid | – | 204, always with the delete cookie | – |

`UserOut = {"id": uuid, "email": str, "display_name": str, "role": "owner"|"seeker", "account_type": str, "created_at": datetime}`.
Four endpoints, two trivial (`/me`, `/logout`): kept in one part because `0001b` cannot be tested without all
four and splitting them would leave an unusable half (accepted by the verifier, round 1).

`current_user` reads the cookie, sha256-hashes it, loads the session joined to the user, and rejects when
`revoked_at IS NOT NULL` or `expires_at <= now()`. One query per request.

## UI
None in this part. The login/signup screens that consume these endpoints are `0001b`.

## Acceptance criteria
- [ ] AC1 Given a fresh email, When `POST /auth/otp/request`, Then 204 with empty body, exactly one message in the outbox addressed to it whose body contains a 6-digit code on a line of its own, and `otp:{email}` exists with TTL ≤ 600 — `api/tests/test_auth.py::test_ac1_request_sends_code_and_stores_hmac`
- [ ] AC2 Given a code for an unknown email, When verified without `profile`, Then 422 `{"detail":"profile_required"}`, `attempts` is still 0 and the code still verifies afterwards; When verified with `{display_name:"  נועה ", role:"owner"}`, Then 201, the parsed `Set-Cookie` has `rent_session` with `httponly`, `samesite` = `lax` (case-insensitive), `max-age` = 2592000, `path` = `/`, a `users` row exists with `display_name = "נועה"`, that role and `account_type='individual'`, and `GET /me` with the cookie returns the same `id` — `api/tests/test_auth.py::test_ac2_signup_requires_profile_then_creates_user`
- [ ] AC3 Given an existing user, When verified with a correct code and a different `profile`, Then 200, `display_name` and `role` are unchanged and `last_login_at` is set — `api/tests/test_auth.py::test_ac3_login_ignores_profile_and_sets_last_login`
- [ ] AC4 Given a valid code, When 5 wrong codes are submitted, Then each returns 401 `invalid_code`, and the correct code afterwards also returns 401 (key deleted) — `api/tests/test_auth.py::test_ac4_five_wrong_attempts_invalidate_code`
- [ ] AC5 Given `OTP_TTL_S` monkeypatched to 1, When the code is verified after 1.2 s, Then 401 `invalid_code` — `api/tests/test_auth.py::test_ac5_expired_code_rejected`
- [ ] AC6 Given 3 requests for one email within the window, When a 4th arrives, Then 429 `rate_limited` with a `Retry-After` header between 1 and 900 and no 4th message in the outbox; a request for a different email still returns 204; every `rl:*` key has a positive TTL — `api/tests/test_auth.py::test_ac6_email_rate_limit`
- [ ] AC7 Given 10 requests from one client IP for 10 distinct emails, When an 11th arrives, Then 429 — `api/tests/test_auth.py::test_ac7_ip_rate_limit`
- [ ] AC8 Given a logged-in client, When `POST /auth/logout`, Then 204, the parsed `Set-Cookie` has `rent_session` with an empty value, `max-age` = 0, `path` = `/`, `httponly` and `samesite` = `lax`, the `sessions` row has `revoked_at` set, `GET /me` with the old cookie returns 401, and a second logout without a cookie returns 204 — `api/tests/test_auth.py::test_ac8_logout_revokes_and_is_idempotent`
- [ ] AC9 Given a session row whose `expires_at` is in the past (set via SQL), When `GET /me`, Then 401 — `api/tests/test_auth.py::test_ac9_expired_session_rejected`
- [ ] AC10 Given a known and an unknown email, When each requests a code, Then both responses are 204 with identical headers except `Date` — `api/tests/test_auth.py::test_ac10_no_account_enumeration`
- [ ] AC11 Given bodies with a 1-char name, a name of 41 code points, a name that is 2 chars only before stripping (`" א "`), `role: "admin"`, a 5-digit code, a code of Arabic-Indic digits (`"٠١٢٣٤٥"`) or `email: "x"`, When sent, Then 422 and no row or Redis key is written — `api/tests/test_auth.py::test_ac11_validation_rejects_bad_input`
- [ ] AC12 Given `SECRET_KEY` missing or shorter than 32 chars, When `Settings()` is built, Then a validation error whose message does not echo the value; Given `EMAIL_BACKEND=smtp` without `SMTP_URL`, Then a validation error; Given only `DATABASE_URL`, Then `DatabaseSettings()` still builds — `api/tests/test_config.py::test_ac12_secret_key_and_smtp_url_required`
- [ ] AC13 Given an empty DB, When `upgrade head` → `downgrade base` → `upgrade head`, Then `users` and `sessions` exist at the end with `ck_users_display_name_length`, `ck_users_role`, `ck_users_account_type` and `ix_sessions_user_id` present (queried from `pg_constraint` / `pg_indexes`) — new function `api/tests/test_migrations.py::test_ac13_users_sessions_roundtrip` reusing the `_mig` database fixture; `test_ac4_autogenerate_sees_no_diff_with_postgis_extensions` stays green
- [ ] AC14 Given `EMAIL_BACKEND=file` and a non-existent `EMAIL_OUTBOX_DIR` under `tmp_path`, When two codes are requested in the same second, Then the directory is created and exactly two `.json` files appear with `to`, `subject`, `body`, `sent_at` — `api/tests/test_auth.py::test_ac14_file_backend_writes_outbox`
- [ ] AC15 Given a request with `Origin: http://localhost:5173` (the test `WEB_ORIGIN`), When `GET /me`, Then the response carries `Access-Control-Allow-Origin: http://localhost:5173` and `Access-Control-Allow-Credentials: true`; Given `Origin: http://evil.example`, Then neither header — `api/tests/test_auth.py::test_ac15_cors_allows_credentials_for_web_origin_only`
- [ ] AC16 Given 10 requests for one email spread over the day counter only (the 15-min counter reset by deleting its key between batches), When an 11th arrives, Then 429 — `api/tests/test_auth.py::test_ac16_daily_email_rate_limit`
- [ ] AC17 Given the email sender raises `EmailUnavailable`, When a code is requested, Then 503 `email_unavailable`, no `otp:{email}` key remains, and the rate-limit counter was incremented — `api/tests/test_auth.py::test_ac17_email_failure_is_503_and_counted`
- [ ] NF1 The OTP code appears nowhere in API log output at any level (`caplog` over AC1 at DEBUG) and nowhere in any response body — `api/tests/test_auth.py::test_nf1_code_never_logged`
- [ ] NF2 Brute-force bound per targeted email: 5 attempts per code, ≤ 3 codes per 15 min and ≤ 10 codes per 24 h ⇒ ≤ 50 guesses/day against a 10⁶ space (≈ 0.005 %/day, ≈ 0.15 %/month of continuous attack); enforced by AC4, AC6, AC16; stated in the `services/auth.py` docstring
- [ ] NF3 `make lint` clean (ruff, mypy --strict) — CI `api` job

## Tests to write
Unit: AC11, AC12; `api/tests/test_email.py::test_smtp_sender_parses_url` (`smtp://` → STARTTLS port 587,
`smtps://` → SMTP_SSL port 465, explicit port wins, `timeout=10` passed) and
`::test_smtp_sender_raises_email_unavailable` with `smtplib.SMTP` mocked to raise.
Integration (Postgres via `TEST_DATABASE_URL`, Redis via `REDIS_URL`, `redis_clean` + `outbox` fixtures):
AC1–AC10, AC14–AC17, NF1. AC13 on the `_mig` database like `0000a` AC4.
E2E: none in this part (`0001b` AC7 covers the browser flow through the file outbox).

## Risks / open questions
- Tests share the dev Redis (`REDIS_URL`); the `redis_clean` fixture deletes only `otp:*` / `rl:*` keys, never
  FLUSHDB. If a later slice adds other key families, give tests their own DB index then.
- `request.client.host` is `testclient` under TestClient and the container's bridge IP behind compose; the IP
  limit is therefore per-proxy until Slice 12 configures `X-Forwarded-For` handling. Acceptable for dev.
- Inline SMTP on the request path: a slow provider makes `/auth/otp/request` slow (bounded by the 10 s socket
  timeout). File backend in dev, so nothing to measure now; the worker path is a one-function change if needed.
- `email-validator` rejects special-use domains (`.test`, `.local`, `localhost`) and some valid-but-odd
  addresses (quoted local parts). Tests and the `0001b` e2e use `…@example.com`. Acceptable.
- The daily cap (10 codes/email/day) can lock out a legitimate person who mistypes a lot; 10 is generous for
  a login flow and the 429 message in `0001b` says to try later. Revisit with Slice 10 trust metrics.
- No open product questions: roles at signup, no phone in this slice, and display-name-only signup were
  decided by Gilad on 2026-11-09 and recorded in `specs/PRODUCT.md`.

Changes after verifier round 1 (2026-11-09): `SECRET_KEY` plumbed through Makefile, both compose services,
CI and `.env.example`; `.outbox` created `0777` before compose up and file names made collision-free;
cookie assertions rewritten around `SimpleCookie`; AC13 split into its own function with named CHECK
constraints and migration ids; daily email cap added (NF2 recomputed, AC16); `^[0-9]{6}$`, `compare_digest`,
atomic counter creation, stripped names, SMTP timeout + 503 path (AC17), `profile_required` leaves `attempts`
alone, concurrent-insert rule; Hebrew email copy given; `test_email.py` in Scope; module renamed
`redis_client.py`; CORS credentials pinned by AC15 for `0001b`.

Verifier notes (2026-11-09): round 1 rejected with 8 findings, all applied above; Gilad waived the second verifier round (one verifier round per spec, like reviewers), so the orchestrator set `verified`.

## Digest (filled by orchestrator after verification)

    Spec 0001a — Auth API: email OTP, sessions, roles   (verified, part 1 of 2, builds on the 0000a branch)
    What a user can do after this: request a 6-digit code by email, verify it to sign up (name + owner/seeker) or log in, and stay logged in for 30 days via an HttpOnly cookie; GET /me and logout work.
    Decisions I need from you (reply with numbers):
      1. Approve build of 0001a now, on top of spec/0000a-foundations-api (recommend: yes; it rebases onto main once 0000a merges).
      2. OTP abuse caps: 3 codes / 15 min and 10 codes / day per email, 10 / 15 min per IP, 5 guesses per code (recommend: accept; ≤ 50 guesses per day per account).
      3. Email delivery: file outbox in dev, plain SMTP (any provider) in prod via SMTP_URL; no provider chosen yet (recommend: accept; provider is a Slice 12 decision, free SMTP tiers exist).
    KPIs this slice moves: verified-account count (every later slice gates on it); nothing user-visible yet.
    Acceptance targets: NF1 code never in logs or responses · NF2 ≤ 50 OTP guesses/day per email · NF3 ruff + mypy --strict clean.
    Risks: required SECRET_KEY must reach api, worker, CI and Makefile or the stack stops booting — mitigation: all four named in Scope, AC12.
           .outbox bind mount on Linux CI is root-owned while the api runs as uid 10001 — mitigation: make dev chmods it first.
    Reviewers: code, qa, security   Estimated: 1 coder run, 1 review round
    Links: specs/0001a-auth-api.md · PRODUCT.md "OTP", "Account roles", "Signup data" · no Design artboard (API only)
