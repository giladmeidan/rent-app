---
id: 0001a
title: A person signs up or logs in with an email one-time code, choosing owner or seeker at signup, and the API knows who they are on every request via a session cookie
status: draft
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

## Scope
**In:**
- Tables `users` and `sessions` (migration `0002_users_sessions`, see Data). OTP codes and rate-limit
  counters live in Redis with TTLs, not in Postgres.
- `api/app/models/user.py` (`User`), `api/app/models/session.py` (`Session`), both exported from
  `models/__init__.py` so Alembic autogenerate sees them.
- `api/app/schemas/auth.py`: `OtpRequestIn`, `ProfileIn`, `OtpVerifyIn`, `UserOut`.
- `api/app/services/auth.py`: `request_otp`, `verify_otp`, `create_session`, `revoke_session`,
  `resolve_session`; constants `OTP_TTL_S = 600`, `OTP_MAX_ATTEMPTS = 5`, `OTP_RATE_LIMIT_EMAIL = 3`,
  `OTP_RATE_LIMIT_IP = 10`, `OTP_RATE_WINDOW_S = 900`, `SESSION_TTL_S = 30 * 24 * 3600`.
- `api/app/services/email.py`: `EmailSender` Protocol (`send(to, subject, body) -> None`),
  `FileEmailSender` (writes one JSON file `{to, subject, body, sent_at}` per message into
  `EMAIL_OUTBOX_DIR`; dev and e2e default) and `SmtpEmailSender` (stdlib `smtplib` over `SMTP_URL`,
  `smtp://` STARTTLS or `smtps://` implicit TLS). Dependency `get_email_sender()` picks by `EMAIL_BACKEND`.
- `api/app/services/sms.py`: `SmsSender` Protocol (`send(to_e164, body) -> None`) and `NoopSmsSender`
  (logs the length of the body only, never the body). **No caller in this slice**: the stub exists so the
  switch-on at launch readiness is a config change, as PRODUCT.md requires. No phone numbers are stored.
- `api/app/i18n/he.py`: `EMAIL_OTP_SUBJECT`, `EMAIL_OTP_BODY` (Hebrew, `{code}` placeholder, plain text).
  API-origin user-facing text lives here; `CLAUDE.md` rule 4's `he.json` covers web components.
- `api/app/redis.py`: `get_redis()` — one cached sync `redis.Redis` client from `REDIS_URL`
  (`socket_connect_timeout=1`, `socket_timeout=1`). `/health` keeps its own per-call ping (FOLLOWUPS).
- `api/app/auth.py`: FastAPI dependencies `current_user` (401 `unauthenticated` when no valid session) and
  `optional_user` (None instead of 401). Cookie name `rent_session`.
- `api/app/routers/auth.py`: the four endpoints in API. Thin; all logic in `services/auth.py`.
- `api/app/config.py`: `secret_key: SecretStr` (required, validator: ≥ 32 characters),
  `email_backend: Literal["file", "smtp"] = "file"`, `email_outbox_dir: Path = Path("./.outbox")`,
  `smtp_url: SecretStr | None = None` (required when backend is `smtp`, validator), `email_from: str =
  "noreply@localhost"`, `cookie_secure: bool = False`.
- `.env.example`: every variable above with a dummy value; `SECRET_KEY` gets a visibly-dev value.
  `infra/docker-compose.yml`: `api` gets `SECRET_KEY: ${SECRET_KEY:-dev-only-secret-change-me-0123456789abcdef}`,
  `EMAIL_BACKEND: file`, `EMAIL_OUTBOX_DIR: /outbox`, volume `../.outbox:/outbox`; `.outbox/` added to
  `.gitignore` and `.dockerignore`. `make down` also empties `.outbox/`.
- Tests in `api/tests/test_auth.py`, `api/tests/test_config.py` (extended), `api/tests/test_migrations.py`
  (extended). `conftest.py`: `db_engine` truncates `sessions, users, areas`; new fixtures `redis_clean`
  (deletes `otp:*` and `rl:*` keys via SCAN before each test) and `outbox` (in-memory `EmailSender`
  collecting `(to, subject, body)`, installed with `app.dependency_overrides[get_email_sender]`).
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
Migration `0002_users_sessions` (downgrade drops `sessions` then `users`; no enum types, so downgrade is
two `DROP TABLE`s). Roles and account types are `text` with `CHECK` constraints, not Postgres enums, so
adding a value later is one migration without type juggling.

`users`
| column | type | notes |
| --- | --- | --- |
| id | uuid PK default gen_random_uuid() | |
| email | text NOT NULL UNIQUE | stored lowercased and stripped by the service; the UNIQUE constraint is on the stored value |
| display_name | text NOT NULL | CHECK `char_length(display_name) BETWEEN 2 AND 40` |
| role | text NOT NULL | CHECK `role IN ('owner','seeker')` — chosen at signup (PRODUCT.md "Account roles") |
| account_type | text NOT NULL default 'individual' | CHECK `account_type IN ('individual','broker')`; `broker` reserved, never set in this slice |
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
- `rl:otp:email:{email}` and `rl:otp:ip:{ip}` — INCR counters, `EXPIRE OTP_RATE_WINDOW_S` set on first INCR.
  Limits 3 per email, 10 per IP per 15 min. `ip` is `request.client.host` (no proxy headers; the reverse
  proxy at deploy time, Slice 12, sets the real client IP).

Backwards compatibility: additive tables; nothing running depends on them.

## API
Cookie: `rent_session=<token_urlsafe(32)>; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`; `Secure` when
`COOKIE_SECURE=true`. CSRF defence is `SameSite=Lax` (browsers omit the cookie on cross-site POSTs) plus the
exact-origin CORS from `0000a`; there are no cookie-authenticated GETs with side effects.

| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| POST | /auth/otp/request | public | `{"email": EmailStr}` | 204 empty — identical for known and unknown addresses (no enumeration). Side effect: code generated with `secrets.randbelow(10**6)` zero-padded to 6 digits, HMAC stored in Redis, email sent via `EmailSender` | 422 invalid email · 429 `{"detail":"rate_limited"}` with `Retry-After: <seconds left in window>` when either counter is over its limit (counted before sending, so a limited request sends nothing) |
| POST | /auth/otp/verify | public | `{"email": EmailStr, "code": str (exactly 6 digits), "profile": {"display_name": str 2–40, "role": "owner"\|"seeker"} \| null}` | existing user: 200 `UserOut` + `Set-Cookie` (`profile` ignored, nothing overwritten); new user with `profile`: 201 `UserOut` + `Set-Cookie`, row created with `account_type='individual'`; both set `last_login_at` and delete the OTP key | 401 `{"detail":"invalid_code"}` for wrong, expired, exhausted or never-requested codes (one message, no distinction; a wrong code increments `attempts`) · 422 `{"detail":"profile_required"}` when the code is right but no account exists and `profile` is missing — the code stays valid so the client can resubmit with a profile · 422 on body validation |
| GET | /me | session cookie required (`current_user`) | – | 200 `UserOut` | 401 `{"detail":"unauthenticated"}` (missing, unknown, expired or revoked cookie) |
| POST | /auth/logout | public, idempotent: revokes the session if the cookie is valid | – | 204, always with `Set-Cookie: rent_session=; Max-Age=0; …` | – |

`UserOut = {"id": uuid, "email": str, "display_name": str, "role": "owner"|"seeker", "account_type": str, "created_at": datetime}`.
Four endpoints, two trivial (`/me`, `/logout`): kept in one part because `0001b` cannot be tested without all
four and splitting them would leave an unusable half.

`current_user` reads the cookie, sha256-hashes it, loads the session joined to the user, and rejects when
`revoked_at IS NOT NULL` or `expires_at <= now()`. One query per request.

## UI
None in this part. The login/signup screens that consume these endpoints are `0001b`.

## Acceptance criteria
- [ ] AC1 Given a fresh email, When `POST /auth/otp/request`, Then 204 with empty body, exactly one message in the outbox addressed to it whose body contains a 6-digit code, and `otp:{email}` exists with TTL ≤ 600 — `api/tests/test_auth.py::test_ac1_request_sends_code_and_stores_hmac`
- [ ] AC2 Given a code for an unknown email, When verified without `profile`, Then 422 `profile_required` and the code still verifies afterwards; When verified with `{display_name:"נועה", role:"owner"}`, Then 201, `Set-Cookie` has `rent_session`, `HttpOnly`, `SameSite=Lax`, `Max-Age=2592000`, a `users` row exists with that role and `account_type='individual'`, and `GET /me` with the cookie returns the same `id` — `api/tests/test_auth.py::test_ac2_signup_requires_profile_then_creates_user`
- [ ] AC3 Given an existing user, When verified with a correct code and a different `profile`, Then 200, `display_name` and `role` are unchanged and `last_login_at` is set — `api/tests/test_auth.py::test_ac3_login_ignores_profile_and_sets_last_login`
- [ ] AC4 Given a valid code, When 5 wrong codes are submitted, Then each returns 401 `invalid_code`, and the correct code afterwards also returns 401 (key deleted) — `api/tests/test_auth.py::test_ac4_five_wrong_attempts_invalidate_code`
- [ ] AC5 Given `OTP_TTL_S` monkeypatched to 1, When the code is verified after 1.2 s, Then 401 `invalid_code` — `api/tests/test_auth.py::test_ac5_expired_code_rejected`
- [ ] AC6 Given 3 requests for one email within the window, When a 4th arrives, Then 429 with a `Retry-After` header between 1 and 900 and no 4th message in the outbox; a request for a different email still returns 204 — `api/tests/test_auth.py::test_ac6_email_rate_limit`
- [ ] AC7 Given 10 requests from one client IP for 10 distinct emails, When an 11th arrives, Then 429 — `api/tests/test_auth.py::test_ac7_ip_rate_limit`
- [ ] AC8 Given a logged-in client, When `POST /auth/logout`, Then 204 with `rent_session=; Max-Age=0`, the `sessions` row has `revoked_at` set, `GET /me` with the old cookie returns 401, and a second logout without a cookie returns 204 — `api/tests/test_auth.py::test_ac8_logout_revokes_and_is_idempotent`
- [ ] AC9 Given a session row whose `expires_at` is in the past (set via SQL), When `GET /me`, Then 401 — `api/tests/test_auth.py::test_ac9_expired_session_rejected`
- [ ] AC10 Given a known and an unknown email, When each requests a code, Then both responses are 204 with identical headers except `Date` — `api/tests/test_auth.py::test_ac10_no_account_enumeration`
- [ ] AC11 Given bodies with a 1-char name, a 41-char name, `role: "admin"`, a 5-digit code or `email: "x"`, When sent, Then 422 and no row or Redis key is written — `api/tests/test_auth.py::test_ac11_validation_rejects_bad_input`
- [ ] AC12 Given `SECRET_KEY` missing or shorter than 32 chars, When `Settings()` is built, Then a validation error whose message does not echo the value; Given `EMAIL_BACKEND=smtp` without `SMTP_URL`, Then a validation error — `api/tests/test_config.py::test_ac12_secret_key_and_smtp_url_required`
- [ ] AC13 Given an empty DB, When `upgrade head` → `downgrade base` → `upgrade head`, Then `users` and `sessions` exist at the end with their CHECK constraints — `api/tests/test_migrations.py::test_ac13_users_sessions_roundtrip` (extends the existing roundtrip test's assertions; runs on the `_mig` database)
- [ ] AC14 Given `EMAIL_BACKEND=file`, When a code is requested, Then exactly one new `.json` file appears in `EMAIL_OUTBOX_DIR` (a `tmp_path`) with `to`, `subject`, `body` — `api/tests/test_auth.py::test_ac14_file_backend_writes_outbox`
- [ ] NF1 The OTP code appears nowhere in API log output at any level (`caplog` over AC1 at DEBUG) and nowhere in any response body — asserted in `api/tests/test_auth.py::test_nf1_code_never_logged`
- [ ] NF2 Brute force bound: 5 attempts per code × 10 min TTL × 3 codes per email per 15 min ⇒ ≤ 15 guesses per 15 min against a 10⁶ space; enforced by AC4 + AC6, stated in `services/auth.py` docstring
- [ ] NF3 `make lint` clean (ruff, mypy --strict) — CI `api` job

## Tests to write
Unit: AC11, AC12, `SmtpEmailSender` URL parsing (`smtp://` vs `smtps://`, default ports 587/465) with a
mocked `smtplib.SMTP` — `api/tests/test_email.py::test_smtp_sender_parses_url`.
Integration (Postgres via `TEST_DATABASE_URL`, Redis via `REDIS_URL`, `redis_clean` + `outbox` fixtures):
AC1–AC10, AC14, NF1. AC13 on the `_mig` database like `0000a` AC4.
E2E: none in this part (`0001b` AC7 covers the browser flow through the file outbox).

## Risks / open questions
- Tests share the dev Redis (`REDIS_URL`); the `redis_clean` fixture deletes only `otp:*` / `rl:*` keys, never
  FLUSHDB. If a later slice adds other key families, give tests their own DB index then.
- `request.client.host` is `testclient` under TestClient and the container's bridge IP behind compose; the IP
  limit is therefore per-proxy until Slice 12 configures `X-Forwarded-For` handling. Acceptable for dev.
- Inline SMTP on the request path: a slow provider makes `/auth/otp/request` slow. File backend in dev, so
  nothing to measure now; the worker path is a one-function change if needed.
- `email-validator` rejects some valid-but-odd addresses (quoted local parts). Acceptable.
- No open product questions: roles at signup, no phone in this slice, and display-name-only signup were
  decided by Gilad on 2026-11-09 and recorded in `specs/PRODUCT.md`.

## Digest (filled by orchestrator after verification)
See `/digest`.
