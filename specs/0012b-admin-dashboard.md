---
id: 0012b
title: "Gilad works the report queue, suspends accounts, hides listings and raises a listing cap from a separate admin dashboard that only he can reach"
status: draft
depends_on: [0012a]   # the columns and admin_actions table it writes; the public app's reaction to them
reviewers: [code, security, qa]   # security: a new app with write access to production data; no ux (SQLAdmin's own UI, Gilad-only, English)
estimate: 1 coder run   # coder Opus/high (security; Speed rule 6)
---

## Goal
After this ships, Gilad opens the admin dashboard on his own machine and works the reports 0011b stores.
He reads them newest first, opens a reported chat, resolves a target's reports, suspends or un-suspends
the reported account, hides or un-hides a listing, and raises an account's listing cap. Every action goes
into a log. The dashboard is a **separate app** built with SQLAdmin. It has no public address, and the
public API has no admin code. PRODUCT.md "Admin (Slice 12)".

## Decisions this spec builds on
- PRODUCT.md "Admin (Slice 12)" (Gilad, 2026-11-15):
  - the dashboard is separate from the app, for Gilad only, unreachable from outside, and built with
    SQLAdmin;
  - a reported chat is readable only if it was reported, and every open is logged;
  - suspension and hiding behave as in `0012a`.
- `0012a` owns every column this app writes and how the public app reacts. This app only flips them, so
  each action is one UPDATE plus one `admin_actions` row in one transaction.

## Why "no public address" is not enough on its own
A page bound to `127.0.0.1` is still reachable **through Gilad's browser**:
- a malicious site he visits can send requests to `http://localhost:8001` (CSRF);
- a site can re-point its own hostname at `127.0.0.1` and read the answers (DNS rebinding).

So the app also has:
- a password login;
- a session cookie with `SameSite=Strict`, which a cross-site request never carries;
- a Host allowlist, which rejects a rebound hostname.

These are three small switches in SQLAdmin and Starlette, not new code paths.

## Scope
**In:**
- **Package `api/admin/`** (`admin`): a separate ASGI app in the same uv project, so it imports
  `app.models` and shares one set of migrations. `app/` never imports `admin` (NF1).
  - `admin/config.py`: `AdminSettings` (pydantic-settings), with the app refusing to start if any
    required value is missing or too short:
    - `ADMIN_DATABASE_URL` (required);
    - `ADMIN_PASSWORD` (required, at least 16 characters);
    - `ADMIN_SECRET_KEY` (required, at least 32 characters);
    - `ADMIN_ALLOWED_HOSTS` (default `localhost,127.0.0.1`).
  - `admin/main.py`: `create_admin_app(settings) -> Starlette`, with `TrustedHostMiddleware`,
    `sqladmin.Admin(..., authentication_backend=...)` mounted at `/admin`, and `/` redirecting to
    `/admin`. Its own engine on `ADMIN_DATABASE_URL`.
  - `admin/auth.py`: the `AuthenticationBackend`:
    - checks the one password with `hmac.compare_digest`;
    - stores the session in Starlette's session cookie with `same_site="strict"`, `max_age` 8 hours and
      `https_only` taken from settings (false locally);
    - after 5 wrong passwords, locks every login for 15 minutes, counted in-process. This is a
      `shortcut:` comment: it is in-process and resets on restart, which is fine for one localhost
      admin; revisit with the Slice 13 deploy.
  - `admin/views.py`: the views below. Every `ModelView` sets `can_create = can_delete = can_export =
    False`, and `can_edit = False` except `UserView`.
  - `admin/actions.py`: one function per action. Each does one UPDATE and one `admin_actions` insert,
    then commits. The views call only these.
  - `admin/templates/chat.html`: the reported-chat page, extending SQLAdmin's layout.
- **`scripts/admin_role.py`** (in `api/scripts/`): creates or updates the Postgres role `homie_admin`
  (LOGIN, password `ADMIN_DB_PASSWORD`) and applies the grants below. It runs as the owner connection
  (`DATABASE_URL`), is idempotent, and is the one statement of the admin's rights.
- **Infra:**
  - `infra/Dockerfile.admin`: the same base as `Dockerfile.api`, `uv sync --frozen --no-default-groups
    --group admin`, the `app` user, and `CMD uvicorn admin.main:app --host 0.0.0.0 --port 8001`.
  - `infra/Dockerfile.api` changes `uv sync --frozen --no-dev` to `--no-default-groups`, so the public
    image installs neither `dev` nor `admin`, and adds `RUN rm -rf admin` after `COPY api/ ./`, so the
    public image does not contain the admin code.
  - `infra/docker-compose.yml`: an `admin` service with `profiles: ["admin"]`, so `make dev` does not
    start it:
    - port `127.0.0.1:${ADMIN_PORT:-8001}:8001`;
    - env `ADMIN_DATABASE_URL=postgresql+psycopg://homie_admin:${ADMIN_DB_PASSWORD:-…}@db:5432/rent`,
      `ADMIN_PASSWORD`, `ADMIN_SECRET_KEY`;
    - `../api:/app` mounted, `uvicorn --reload`;
    - no Redis.
- **`Makefile`:** `admin` runs `$(UV) run python scripts/admin_role.py`, then `$(COMPOSE) --profile
  admin up -d --build admin`, then waits for `http://127.0.0.1:$(ADMIN_PORT)/admin/login`.
  `make down` already stops it through `--remove-orphans`; the verifier should check whether
  `--profile admin` is needed there.
- **`.env.example`:** `ADMIN_PORT`, `ADMIN_PASSWORD`, `ADMIN_SECRET_KEY`, `ADMIN_DB_PASSWORD`, each with
  a dummy value.
- **`api/pyproject.toml`:**
  - a new dependency group `admin = ["sqladmin[auth]==0.32.0"]`;
  - `[tool.uv] default-groups = ["dev", "admin"]`, so `make test` and `make lint` have it;
  - `mypy --strict` in `make lint-api` gains `admin`.
- **Tests:** `api/tests/test_admin.py`, with a conftest fixture that runs `admin_role.py` against the test
  database and builds `create_admin_app` on a `homie_admin` URL to `rent_test`.

**Out:**
- **Production deploy:** a separate Fly app with no public services, reached with `fly proxy`, plus
  secrets and `https_only=True`. This is Slice 13, and the build adds a FOLLOWUPS line.
- Hebrew or RTL in the admin. PRODUCT.md: the admin is English and Gilad-only. Hard rule 4 covers `web/`.
- More than one admin, admin accounts, and a "who" on the log.
- Exports, bulk edits, deletes, and editing any listing or profile content.
- A conversations or messages browser beyond a reported chat.
- Geocode retries (FOLLOWUPS 0003c) and rent-import alerts (FOLLOWUPS 0014a). They stay in FOLLOWUPS.
- Grouping reports in SQL. At MVP volume (hundreds of rows), the search box and "resolve the target"
  cover it (Risks).

**New dependencies:** `sqladmin[auth]==0.32.0` (2026-09-20). It pulls in `jinja2`, `wtforms`,
`python-multipart` and `itsdangerous`. They are installed only with the `admin` group and are never in the
public image. Starlette 1.10.0 (already locked) satisfies its `starlette<2,>=0.50`.

## Data
No migration. `0012a`'s `0023_admin_moderation` adds everything.

**Rights of `homie_admin`** (`scripts/admin_role.py`):

| Grant | Why |
| --- | --- |
| `CONNECT` on the database, `USAGE` on schema `public` | log in |
| `SELECT` on all tables in `public`, plus `ALTER DEFAULT PRIVILEGES … GRANT SELECT ON TABLES` for later tables | the views and the reported chat |
| `UPDATE (suspended_at, listing_cap) ON users` | suspend, un-suspend, cap |
| `UPDATE (status, removed_at) ON listings` | hide, un-hide |
| `UPDATE (resolved_at) ON reports` | resolve |
| `INSERT ON admin_actions` | the log |

Nothing else: no DELETE, TRUNCATE, other columns or DDL. The script revokes any other right it finds on the
role, so a re-run converges.

## API
Not a public API. The admin app's routes are SQLAdmin's under `/admin`, all behind the login. Auth rule
for every route except `/admin/login`: a valid admin session cookie. Without one, a page redirects to
login, and an action writes nothing.

| Route | What it does |
| --- | --- |
| `GET/POST /admin/login`, `GET /admin/logout` | the password form and logout |
| `/admin/report/list` (default page), `/admin/report/details/{id}` | the report queue (ReportView) |
| `/admin/user/list`, `/details/{id}`, `/edit/{id}` | users (UserView); edit holds `listing_cap` only |
| `/admin/listing/list`, `/details/{id}` | listings (ListingView) |
| `/admin/admin-action/list` | the log (AdminActionView) |
| `/admin/report/action/{name}?pks=…` | the SQLAdmin actions below |
| `GET /admin/chat/{report_id}` | a reported chat (custom `BaseView`) |

## UI
SQLAdmin's own templates, in English. Every user-written value (report note, message body, display name,
street) is rendered through Jinja autoescape, which SQLAdmin's default and `chat.html` must not turn off
(NF5).

### Reports (`ReportView`, the landing page)
- **List columns:** `created_at`, open/resolved (from `resolved_at`), `target_type`, `reason`, note (first
  80 characters), reporter (display name and email), reported user (display name and email, linking to
  their user page), `target_id`.
- **Sorting, filters and search:** newest first by default; filters for open/resolved, `target_type` and
  `reason`; search by reported user email or `target_id`. Pasting a target id lists every report on it.
- **Detail page:** every field. A link to the reported user. For a `listing` target, a link to that
  listing's page in the admin. For a `chat` target, an "Open reported chat" link to `/admin/chat/{id}`.
- **Actions** (on the list with selected rows, and on the detail page; each with a confirmation):
  - **Resolve**: sets `resolved_at = now()` on the selected reports **and every other open report on the
    same (`target_type`, `target_id`)**. One `resolve_reports` log row per target, with the count in
    `detail`.
  - **Suspend reported user**: as UserView's Suspend, on each selected report's `reported_user_id`.
  - **Hide listing**: only for `listing` targets. Others are skipped with a flash message. Same effect
    as ListingView's Hide.

### Reported chat (`/admin/chat/{report_id}`)
- Only when the report's `target_type` is `chat`. For anything else, or an unknown id, it answers 404.
- Shows the conversation's members (display names), then **all** its messages oldest first: sender
  display name, time (Asia/Jerusalem), and the body as plain text with line breaks kept.
- Every successful open writes one `read_chat` log row (`target_type = 'chat'`, `target_id` = the
  conversation id, `detail` = the report id). It writes one on every open, not once per conversation.
- A note at the top: "Opened because of report {id}. This open is logged."

### Users (`UserView`)
- **List columns:** email, display name, role, `created_at`, `last_login_at`, `listing_cap`,
  `suspended_at`.
- **Search and filter:** search by email or display name; filter suspended / not suspended.
- **Edit:** `form_columns = [listing_cap]` with WTForms `NumberRange(0, 100)` (the DB CHECK agrees).
  `on_model_change` writes `set_listing_cap` with `detail` "3→10".
- **Actions:**
  - **Suspend**: `suspended_at = now()` where it is NULL; already-suspended rows are left as they are.
    Logs `suspend`.
  - **Lift suspension**: sets `suspended_at` to NULL. Logs `unsuspend`.

### Listings (`ListingView`)
- **List columns:** `created_at`, type, city, street, `price_ils`, status, `expires_at`, `removed_at`,
  owner email.
- **Search and filter:** search by city, street or owner email; filter removed / not removed.
- **Actions:**
  - **Hide**: `status = 'paused', removed_at = now()`. Logs `hide_listing`.
  - **Un-hide**: sets `removed_at` to NULL, and the listing **stays paused**, so the owner resumes it
    under their cap. Logs `unhide_listing`.

### Log (`AdminActionView`)
- Read-only, newest first. Columns `created_at`, action, target type, target id, detail.

## Acceptance criteria
- [ ] AC1 Given the admin app, When a request has no session cookie, Then every list, detail, edit,
  action and chat route redirects to `/admin/login` and nothing is written — `api/tests/test_admin.py::test_ac1_everything_needs_login`
- [ ] AC2 Given the login form, When the right password is posted, Then the session cookie is set with
  `SameSite=Strict` and `HttpOnly`, and the report list loads. A wrong password shows an error, and the
  6th wrong try within 15 minutes is refused even with the right password —
  `test_admin.py::test_ac2_password_login_and_lockout`
- [ ] AC3 Given reports A1 and A2 on one listing and B on a person, When Resolve runs on A1, Then A1 and A2
  have `resolved_at`, B is still open, and one `resolve_reports` row has detail "2" —
  `test_admin.py::test_ac3_resolve_closes_the_whole_target`
- [ ] AC4 Given a user, When Suspend and then Lift suspension run from UserView, and Suspend reported user
  runs from ReportView, Then `suspended_at` is set, cleared and set again, with a log row each time. The
  user's API session (0012a) stops resolving after the first and third — `test_admin.py::test_ac4_suspend_and_lift`
- [ ] AC5 Given a live listing, When Hide runs, Then `status = 'paused'`, `removed_at` is set, and it is
  absent from `GET /search`. When Un-hide runs, `removed_at` is NULL and the status stays `paused`. Each
  writes a log row — `test_admin.py::test_ac5_hide_and_unhide_listing`
- [ ] AC6 Given a user, When `listing_cap` is edited to 10, Then the row holds 10 and a `set_listing_cap`
  row says "3→10". When it is edited to 101 or -1, the form shows an error and nothing is written —
  `test_admin.py::test_ac6_edit_listing_cap`
- [ ] AC7 Given a `chat` report, When `/admin/chat/{report_id}` opens, Then all the conversation's
  messages show oldest first, and one `read_chat` row is written. For a `listing` report or an unknown
  id, it answers 404 and writes no row — `test_admin.py::test_ac7_reported_chat_only`
- [ ] AC8 Given a report note and a message body of `<script>alert(1)</script>`, When the report list, its
  detail page and the chat page render, Then the text appears escaped and no `<script>` element is
  emitted — `test_admin.py::test_ac8_user_text_is_escaped`
- [ ] AC9 Given any ModelView, When create, delete or export is requested, or edit on anything but
  UserView, Then it is not offered and its route refuses it — `test_admin.py::test_ac9_read_only_views`
- [ ] NF1 Given the public API, When `app.main` is imported and `create_app()` built, Then no module under
  `admin` (or `sqladmin`) is in `sys.modules` and no route path starts with `/admin` —
  `api/tests/test_admin_isolation.py::test_nf1_public_app_has_no_admin`
- [ ] NF2 Given a connection as `homie_admin`, When it tries `DELETE FROM reports`, `UPDATE users SET
  email = …`, `UPDATE listings SET price_ils = …`, `UPDATE sessions SET revoked_at = now()`, `CREATE
  TABLE x()` and `INSERT INTO users …`, Then each fails with `InsufficientPrivilege`. Running
  `admin_role.py` twice in a row succeeds — `test_admin.py::test_nf2_role_has_only_its_grants`
- [ ] NF3 Given the admin app, When a request comes with `Host: evil.example` (DNS rebinding), Then it
  answers 400 before any view or login runs — `test_admin.py::test_nf3_host_allowlist`
- [ ] NF4 Given `AdminSettings`, When `ADMIN_PASSWORD` is shorter than 16 characters or
  `ADMIN_SECRET_KEY` shorter than 32, or either is missing, Then the app refuses to start —
  `test_admin.py::test_nf4_settings_refuse_weak_secrets`
- [ ] NF5 Given an action, When its UPDATE succeeds but its log insert fails (or the reverse), Then
  neither is committed — `test_admin.py::test_nf5_action_and_log_are_one_transaction`

## Tests to write
- Integration: `api/tests/test_admin.py` (AC1–AC9, NF2–NF5) through Starlette's `TestClient` on
  `create_admin_app`, connected as `homie_admin`. Fixtures come from conftest (`make_owner`,
  `make_seeker`, `make_card`, `make_application`) plus direct inserts for reports. NF1 is in
  `test_admin_isolation.py`.
- By hand, once, in the build session: `make admin`, log in, run every action once, `make down`. This is
  named in the PR body, and no e2e is added (the admin is outside the web app and CI's e2e).

## Blast radius
The verifier fills this from `graphify affected` for: `infra/Dockerfile.api` (the public image), the
`Makefile` `lint-api` target, `api/pyproject.toml` groups, and `0012a`'s columns. The admin itself is new
code with no callers.

## Risks / open questions
- **The public image** must change carefully: `--no-default-groups` must still install the main
  dependencies, which are not a group. The build session checks with `docker run … python -c "import
  sqladmin"` that the import fails in the API image and succeeds in the admin image.
- **SQLAdmin and mypy strict:** if SQLAdmin's types do not pass `--strict`, a per-module `ignore_missing_imports`
  or `disallow_subclassing_any = false` override for `admin.*` is acceptable and named in the PR. Silencing `app`
  is not.
- **Actions over GET:** SQLAdmin may route actions as GET with a confirmation. With `SameSite=Strict`, a
  cross-site link or form carries no session (AC1, AC2), so that is safe. The build confirms the
  method, and if actions are POST, nothing changes.
- **No grouping view:** search by `target_id` plus "Resolve closes the whole target" covers hundreds of
  rows. If the queue grows, a "reports per target" view is a follow-up.
- **Reading reported chats** must be stated in the terms of use (Slice 13). The build adds a FOLLOWUPS
  line under Slice 13.
- **Open product questions:** none. Gilad decided on 2026-11-15.

## Digest (filled by orchestrator after verification)
See `/digest`.
