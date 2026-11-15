---
id: 0012b
title: "Gilad works the report queue, suspends accounts, hides listings and raises a listing cap from a separate admin dashboard that only he can reach"
status: verified
depends_on: [0012a]   # the columns and admin_actions table it writes; the public app's reaction to them
reviewers: [code, security, qa]   # security: a new app with write access to production data; no ux (SQLAdmin's own UI, Gilad-only, English)
estimate: 1 coder run   # coder Opus/high (security; Speed rule 6)
---

## Goal
After this ships, Gilad opens the admin dashboard on his own machine and works the reports 0011b stores.
He reads them newest first, opens a reported chat, resolves a target's reports, suspends or un-suspends
the reported account, hides or un-hides a listing, and raises an account's listing cap. Every action goes
into a log. The dashboard is a **separate app** built with SQLAdmin. It has no public address, and the
public API can't import any admin code. PRODUCT.md "Admin (Slice 12)".

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
- a site can re-point its own hostname at `127.0.0.1` and read the answers (DNS rebinding);
- every `http://localhost:<port>` is the **same site**, and cookies ignore ports. So any page a local dev
  server serves (the web app on 5173, any other project) counts as same-site. SQLAdmin 0.32 runs its
  actions as GETs, so such a page could fire one with Gilad's cookie, for example with
  `<img src=…/action/suspend?pks=…>`.

So the app also has four guards, each a small Starlette or SQLAdmin switch:
1. a password login;
2. a session cookie named `homie_admin`, with `path=/admin` and `SameSite=Strict`;
3. a Host allowlist, which rejects a rebound hostname;
4. a `Sec-Fetch-Site` check that answers 400 to any request whose value is `cross-site` or `same-site`.
   Browsers set this header themselves and a page cannot forge it. A request without the header (curl,
   tests) passes.

## Scope
**In:**
- **Package `api/admin/`** (`admin`): a separate ASGI app in the same uv project, so it imports
  `app.models` and shares one set of migrations. `app/` never imports `admin` (NF1).
  - **`admin/config.py`:** `AdminSettings` (pydantic-settings), with the app refusing to start if any
    required value is missing or too short:
    - `ADMIN_DATABASE_URL` (required);
    - `ADMIN_PASSWORD` (required, at least 16 characters);
    - `ADMIN_SECRET_KEY` (required, at least 32 characters);
    - `ADMIN_ALLOWED_HOSTS` (default `localhost,127.0.0.1`);
    - `ADMIN_HTTPS_ONLY` (default false).
  - **`admin/main.py`:** **no module-level app**, so importing it without `ADMIN_*` env (CI's
    `make test`) works.
    - `create_admin_app(settings) -> Starlette` adds the middleware in this order: `TrustedHostMiddleware`,
      then the `Sec-Fetch-Site` check, then `sqladmin.Admin(..., authentication_backend=...)` mounted at
      `/admin`. It has its own engine on `ADMIN_DATABASE_URL`.
    - `main() -> Starlette` returns `create_admin_app(AdminSettings())`, for `uvicorn admin.main:main
      --factory`.
    - `/` and `/admin/` (SQLAdmin's index, overridden) redirect to `/admin/report/list`.
  - **`admin/auth.py`:** the `AuthenticationBackend`.
    - Session kwargs: `session_cookie="homie_admin"`, `path="/admin"`, `same_site="strict"`,
      `https_only` from settings. Starlette always sets `HttpOnly`.
    - The password check compares UTF-8 bytes: `hmac.compare_digest(a.encode(), b.encode())`. `str`
      arguments raise on non-ASCII.
    - The session stores `login_at`, and `authenticate` refuses a session older than 8 hours. Starlette's
      `max_age` slides on every response, so it is not an absolute limit.
    - The lock: 5 wrong passwords within 15 minutes lock every login until 15 minutes after the 5th. A
      right password does not lift an active lock. The count is in-process, marked with a `shortcut:`
      comment: it resets on restart, which is fine for one localhost admin; revisit with the Slice 13
      deploy.
  - **`admin/views.py`:** the views below. Every `ModelView` sets `can_create = can_delete = can_export =
    can_import = False`, and `can_edit = False` except `UserView`.
  - **`admin/actions.py`:** one function per action. Each does one UPDATE and one `admin_actions` insert in
    one transaction, then commits. The views call only these.
  - **`admin/templates/chat.html`:** the reported-chat page, extending SQLAdmin's layout.
- **ORM relationships** (model-only, no migration, so autogenerate sees no diff). SQLAdmin needs them to
  show a related row and to search `a.b`. `Report` has two FKs to `users`, so a plain join would be
  ambiguous.
  - `app/models/report.py`: `reporter` and `reported_user`.
  - `app/models/listing.py`: `owner`.
  - Each is `relationship(User, foreign_keys=[…], viewonly=True, lazy="raise")`.
- **`scripts/admin_role.py`** (in `api/scripts/`): creates or updates the Postgres role `homie_admin` and
  applies the rights below. It is the one statement of the admin's rights, and it is idempotent.
- **Infra:**
  - `infra/Dockerfile.admin`: the same base as `Dockerfile.api`, `uv sync --frozen --no-default-groups
    --group admin`, the `app` user, and `CMD uvicorn admin.main:main --factory --host 0.0.0.0 --port
    8001`.
  - `infra/Dockerfile.api` changes `uv sync --frozen --no-dev` to `--no-default-groups`, so the public
    image installs neither `dev` nor `admin`. It adds `RUN rm -rf admin` after `COPY api/ ./`, so the
    public image **cannot import** the admin. The earlier COPY layer still holds the files, which is
    harmless since the code holds no secrets.
  - `infra/docker-compose.yml`: an `admin` service with `profiles: ["admin"]`, so `make dev` does not
    start it.
    - Port `127.0.0.1:${ADMIN_PORT:-8001}:8001`.
    - Env:
      - `ADMIN_DATABASE_URL=postgresql+psycopg://homie_admin:${ADMIN_DB_PASSWORD:-dev-only-admin-db-password}@db:5432/rent`;
      - `ADMIN_PASSWORD: ${ADMIN_PASSWORD:-}` and `ADMIN_SECRET_KEY: ${ADMIN_SECRET_KEY:-}`. Empty
        defaults keep compose quiet in CI, and NF4 still refuses empty values.
    - `../api:/app` mounted, and `uvicorn admin.main:main --factory --reload`.
    - `depends_on: db: condition: service_healthy`. No Redis.
- **`Makefile`:**
  - It exports `ADMIN_PORT ?= 8001` and `ADMIN_DB_PASSWORD ?= dev-only-admin-db-password`.
  - New `admin` target: `$(COMPOSE) up -d --wait db`, `$(MAKE) migrate`, `$(UV) run python
    scripts/admin_role.py`, `$(COMPOSE) --profile admin up -d --build admin`, then a wait for
    `http://127.0.0.1:$(ADMIN_PORT)/admin/login`.
  - `down` becomes `$(COMPOSE) --profile admin down -v --remove-orphans`. A service in a profile that is
    off is not an orphan, so `--remove-orphans` alone never removes it.
  - `lint-api`'s mypy paths gain `admin`.
  - `admin` goes into `.PHONY`.
- **`.env.example`:** `ADMIN_PORT=8001`, `ADMIN_PASSWORD`, `ADMIN_SECRET_KEY` and
  `ADMIN_DB_PASSWORD=dev-only-admin-db-password`, each with a dummy value.
- **`api/pyproject.toml` + `api/uv.lock`** (regenerated with `uv lock`):
  - a new dependency group `admin = ["sqladmin[auth]==0.32.0"]`;
  - `[tool.uv] default-groups = ["dev", "admin"]`, so `make test`, `make lint` and CI's `uv sync --frozen`
    have it.
- **Tests:** `api/tests/test_admin.py` and `api/tests/test_admin_isolation.py`, plus the `conftest.py`
  changes under "Tests to write".

**Out:**
- **Production deploy:** a separate Fly app with no public services, reached with `fly proxy`, plus
  secrets and `ADMIN_HTTPS_ONLY=true`. This is Slice 13, and the build adds a FOLLOWUPS line.
- Hebrew or RTL in the admin. PRODUCT.md "Admin (Slice 12)": the admin is English and Gilad-only. Hard
  rule 4 covers `web/`. User-written Hebrew is shown with `dir="auto"` (see the chat page).
- More than one admin, admin accounts, and a "who" on the log.
- Exports, imports, bulk edits, deletes, and editing any listing or profile content.
- A conversations or messages browser beyond a reported chat.
- Geocode retries (FOLLOWUPS 0003c) and rent-import alerts (FOLLOWUPS 0014a). They stay in FOLLOWUPS.
- Grouping reports in SQL. At MVP volume (hundreds of rows), the search box and "resolve the target"
  cover it (Risks).

**New dependencies:** `sqladmin[auth]==0.32.0` (2026-09-20). It pulls in `jinja2`, `wtforms`,
`python-multipart` and `itsdangerous`. They are installed only with the `admin` group and are never in the
public image. Starlette 1.10.0 (already locked) satisfies its `starlette<2,>=0.50`.

## Data
No migration. `0012a`'s `0023_admin_moderation` adds every column and table, and the relationships above
are model-only.

**The `homie_admin` role** (`scripts/admin_role.py`):
- **Attributes:** `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`. It is a member of
  no role.
- **Password:** `ADMIN_DB_PASSWORD`, passed as `psycopg.sql.Literal`, never interpolated.
- **Transaction:** revoke all, then grant, in one transaction, so a re-run converges.
- **Who runs it:** the role that runs `alembic upgrade` (`DATABASE_URL`, today `rent`). Default privileges
  apply only to tables that role creates.
- **Cluster-wide:** the role is shared by the dev `rent` database and `rent_test`, so the test fixture uses
  the same `ADMIN_DB_PASSWORD` as the Makefile default. Otherwise `make test` would change the password
  under a running dev admin.

| Grant | Why |
| --- | --- |
| `CONNECT` on the database, `USAGE` on schema `public` | log in |
| `SELECT` on all tables in `public`, plus `ALTER DEFAULT PRIVILEGES FOR ROLE current_user IN SCHEMA public GRANT SELECT ON TABLES` | the views and the reported chat; later tables too |
| `UPDATE (suspended_at, listing_cap) ON users` | suspend, un-suspend, cap |
| `UPDATE (revoked_at) ON sessions` | suspend ends the user's live sessions, so lifting does not revive them |
| `UPDATE (status, removed_at) ON listings` | hide, un-hide |
| `UPDATE (resolved_at) ON reports` | resolve |
| `INSERT ON admin_actions` | the log |

Nothing else is granted: no DELETE, TRUNCATE, other columns or DDL.

## API
Not a public API. The admin app's routes are SQLAdmin's, under `/admin`.

**Auth rule:** every route needs a valid admin session (a `homie_admin` cookie whose `login_at` is under
8 hours old). The only exceptions are `/admin/login`, `/admin/logout`, `/admin/statics/*` (SQLAdmin's CSS
and JS) and `/` (a redirect).
- Without a session, a page redirects to login, and an action writes nothing.
- Before any of that, the Host allowlist and the `Sec-Fetch-Site` check answer 400.

| Route | What it does |
| --- | --- |
| `GET/POST /admin/login`, `GET /admin/logout` | the password form and logout |
| `/`, `/admin/` | redirect to `/admin/report/list` |
| `/admin/report/list` (default page), `/admin/report/details/{id}` | the report queue (ReportView) |
| `GET /admin/report/chat/{report_id}` | a reported chat (`@expose` on ReportView, no menu entry) |
| `/admin/user/list`, `/details/{id}`, `/edit/{id}` | users (UserView); edit holds `listing_cap` only |
| `/admin/listing/list`, `/details/{id}` | listings (ListingView) |
| `/admin/admin-action/list` | the log (AdminActionView) |
| `GET /admin/{report,user,listing}/action/{name}?pks=…` | the actions below, after SQLAdmin's confirmation modal |

## UI
SQLAdmin's own templates, in English and server-rendered, so no page has a loading state. Every
user-written value (report note, message body, display name, street) is rendered through Jinja autoescape
(SQLAdmin's default), never `|safe` (AC8).

### Reports (`ReportView`, the landing page)
- **List columns:**
  - `created_at`;
  - open/resolved (from `resolved_at`);
  - `target_type` and `reason`;
  - note (first 80 characters);
  - `reporter` and `reported_user` (the relationships, formatted "display name <email>"; the reported
    user links to their user page);
  - `target_id`.
- **Sorting, filters and search:** newest first by default; filters for open/resolved, `target_type` and
  `reason`; search on `"reported_user.email"` and `"target_id"`. Pasting a target id lists every report on
  it.
- **Empty:** SQLAdmin's own empty table.
- **Detail page:** every field. A link to the reported user. For a `listing` target, a link to that
  listing's page in the admin. For a `chat` target, an "Open reported chat" link to
  `/admin/report/chat/{id}`.
- **Actions** (on the list with selected rows, and on the detail page; each with a confirmation):
  - **Resolve:** sets `resolved_at = now()` on the selected reports **and every other open report on the
    same (`target_type`, `target_id`)**.
    - Per target, one `resolve_reports` row: `target_type = 'report'`, `target_id` = the selected report's
      id (the first, if several on that target are selected), and `detail` = the number of reports it
      closed.
    - A target with no open report is skipped: no UPDATE and no row.
  - **Suspend reported user:** as UserView's Suspend, on each selected report's `reported_user_id`.
  - **Hide listing:** only for `listing` targets; others are skipped with a flash message. Same effect as
    ListingView's Hide.

### Reported chat (`GET /admin/report/chat/{report_id}`)
- **Success:** a note at the top, "Opened because of report {id}. This open is logged." Then:
  - the conversation's members by display name: the owner, the seeker and, for a room application, its
    flatmates;
  - then **all** its messages oldest first, each with the sender's display name, the time
    (Asia/Jerusalem) and the body.
- **Rendering:** each body and display name sits in an element with `dir="auto"`, since the text is
  Hebrew inside an English page. Line breaks are kept with CSS `white-space: pre-wrap`, never `|safe` or
  an nl2br filter.
- **Empty:** a conversation with no messages shows "No messages in this conversation."
- **Logging:** every successful open, empty included, writes one `read_chat` row (`target_type =
  'chat'`, `target_id` = the conversation id, `detail` = the report id). It writes one on every open, not
  once per conversation.
- **Not found:** a non-chat report, an unknown report id, or a chat report whose conversation is gone
  (`target_id` has no FK) answers 404 and writes no row.

### Users (`UserView`)
- **List columns:** email, display name, role, `created_at`, `last_login_at`, `listing_cap`,
  `suspended_at`.
- **Search and filter:** search by email or display name; filter suspended / not suspended.
- **Edit:** `form_columns = [listing_cap]` with `form_args` `NumberRange(0, 100)` (the DB CHECK agrees).
  `on_model_change` adds the `set_listing_cap` row (`detail` "3→10") in SQLAdmin's own update session,
  before its commit.
- **Actions:**
  - **Suspend:** `suspended_at = now()` where it is NULL; already-suspended rows are left as they are. In
    the same transaction, it sets `revoked_at = now()` on the user's sessions where `revoked_at` is NULL.
    0012a already stops them from resolving; revoking them means lifting the suspension does not revive
    them (orchestrator, 2026-11-15, the safer default). Logs `suspend`.
  - **Lift suspension:** sets `suspended_at` to NULL. Old sessions stay revoked, so the user signs in
    afresh. Logs `unsuspend`.

### Listings (`ListingView`)
- **List columns:** `created_at`, type, city, street, `price_ils`, status, `expires_at`, `removed_at`,
  and `owner` ("display name <email>").
- **Search and filter:** search on city, street and `"owner.email"`; filter removed / not removed.
- **Actions:**
  - **Hide:** `status = 'paused', removed_at = now()`. Logs `hide_listing`.
  - **Un-hide:** sets `removed_at` to NULL, and the listing **stays paused**, so the owner resumes it
    under their cap. Logs `unhide_listing`.

### Log (`AdminActionView`)
- Read-only, newest first. Columns `created_at`, action, target type, target id, detail.

## Acceptance criteria
- [ ] AC1 Given the admin app, When a request has no session cookie, Then every list, detail, edit,
  action and chat route (`/admin/report/chat/{id}` included) redirects to `/admin/login`, nothing is
  written, and `/admin/statics/*` and `/admin/login` answer without one —
  `api/tests/test_admin.py::test_ac1_everything_needs_login`
- [ ] AC2 Given the login form:
  - When the right password is posted, Then the `homie_admin` cookie is set with `Path=/admin`,
    `SameSite=Strict` and `HttpOnly`, and the report list loads.
  - A session older than 8 hours (by `login_at`) is sent back to login.
  - A wrong password shows an error.
  - After 5 wrong tries within 15 minutes, the 6th try within the lock is refused, right password or
    wrong.

  — `test_admin.py::test_ac2_password_login_session_age_and_lockout`
- [ ] AC3 Given reports A1 and A2 on one listing, B on a person, and C on another listing that is already
  resolved:
  - When Resolve runs on A1, Then A1 and A2 have `resolved_at`, B is still open, and one
    `resolve_reports` row has `target_type 'report'`, `target_id` A1 and detail "2".
  - When Resolve runs on C, nothing is written.

  — `test_admin.py::test_ac3_resolve_closes_the_whole_target`
- [ ] AC4 Given a user, When Suspend and then Lift suspension run from UserView, and Suspend reported user
  runs from ReportView, Then:
  - `suspended_at` is set, cleared and set again, with a log row each time;
  - each Suspend sets `revoked_at` on every live session of that user;
  - the API session the user held before the first Suspend still answers 401 after the Lift, and a
    fresh sign-in works.

  — `test_admin.py::test_ac4_suspend_and_lift`
- [ ] AC5 Given a live listing, When Hide runs, Then `status = 'paused'`, `removed_at` is set, and it is
  absent from `GET /listings`. When Un-hide runs, `removed_at` is NULL and the status stays `paused`. Each
  writes a log row — `test_admin.py::test_ac5_hide_and_unhide_listing`
- [ ] AC6 Given a user, When `listing_cap` is edited to 10, Then the row holds 10 and a `set_listing_cap`
  row says "3→10". When it is edited to 101 or -1, the form shows an error and nothing is written —
  `test_admin.py::test_ac6_edit_listing_cap`
- [ ] AC7 Given a `chat` report:
  - When `/admin/report/chat/{report_id}` opens, Then all the conversation's messages show oldest first,
    and one `read_chat` row is written.
  - An empty conversation shows the empty line and writes one row.
  - A `listing` report, an unknown id, or a chat report whose conversation was deleted answers 404 and
    writes no row.

  — `test_admin.py::test_ac7_reported_chat_only`
- [ ] AC8 Given a report note, a display name and a message body of `<script>alert(1)</script>`, When the
  report list, its detail page and the chat page render, Then the text appears escaped and no `<script>`
  element is emitted. Each body sits in an element with `dir="auto"` — `test_admin.py::test_ac8_user_text_is_escaped`
- [ ] AC9 Given any ModelView, When create, delete, export or import is requested, or edit on anything
  but UserView, Then it is not offered and its route refuses it — `test_admin.py::test_ac9_read_only_views`
- [ ] NF1 Given a **fresh interpreter** (`subprocess.run([sys.executable, "-c", …], cwd=<api dir>)`), When
  it imports `app.main` and builds `create_app()`, Then no `admin`, `admin.*` or `sqladmin` module is
  loaded, and no route path starts with `/admin`. pytest has already imported the admin while collecting
  tests, so an in-process check would always fail —
  `api/tests/test_admin_isolation.py::test_nf1_public_app_has_no_admin`
- [ ] NF2 Given a connection as `homie_admin`:
  - When it tries `DELETE FROM reports`, `UPDATE users SET email = …`, `UPDATE listings SET price_ils =
    …`, `UPDATE sessions SET expires_at = now()`, `DELETE FROM sessions`, `CREATE TABLE x()` and
    `INSERT INTO users …`, Then each
    fails with `InsufficientPrivilege`.
  - Running `admin_role.py` twice in a row succeeds.
  - The role has `rolsuper`, `rolcreaterole`, `rolcreatedb` and `rolbypassrls` false.

  — `test_admin.py::test_nf2_role_has_only_its_grants`
- [ ] NF3 Given the admin app, When a request comes with `Host: evil.example` (DNS rebinding), or with
  `Sec-Fetch-Site: cross-site` or `same-site` (another site, or another localhost port), Then it answers
  400 before any view or login runs. `same-origin`, `none` and no header pass —
  `test_admin.py::test_nf3_host_and_fetch_site_guards`
- [ ] NF4 Given `AdminSettings`, When `ADMIN_PASSWORD` is shorter than 16 characters or
  `ADMIN_SECRET_KEY` shorter than 32, or either is missing or empty, Then `main()` refuses to build the
  app. Importing `admin.main` with no `ADMIN_*` env still works —
  `test_admin.py::test_nf4_settings_refuse_weak_secrets`
- [ ] NF5 Given an action, When its UPDATE succeeds but its log insert fails (or the reverse), Then
  neither is committed — `test_admin.py::test_nf5_action_and_log_are_one_transaction`

## Tests to write
- **Integration:** `api/tests/test_admin.py` (AC1–AC9, NF2–NF5), through Starlette's `TestClient` on
  `create_admin_app`, connected as `homie_admin` to `rent_test`.
  - The client uses `base_url="http://localhost"` (the default `testserver` host fails the allowlist) and
    `follow_redirects=False` for AC1.
  - Fixtures come from conftest (`make_owner`, `make_seeker`, `make_card`, `make_application`).
    Reports, conversations and messages are direct inserts (`make_application` creates no
    conversation).
- **`conftest.py`:**
  - `db_engine`'s TRUNCATE gains `admin_actions`, since AC3–AC7 count log rows. If `0012a` already added
    it, nothing changes.
  - A session-scoped fixture runs `scripts/admin_role.py` against the test database with the Makefile's
    default `ADMIN_DB_PASSWORD`.
- **`api/tests/test_admin_isolation.py`:** NF1 in a subprocess.
- **By hand**, once, in the build session: `make admin`, log in, run every action once, check that
  `docker run <api image> python -c "import sqladmin"` fails and works in the admin image, then
  `make down`. This is named in the PR body. No e2e is added, since the admin is outside the web app and
  CI's e2e.

## Blast radius
From `graphify affected` on `main` (2026-11-15). The graph maps code only, so the infra and config lines
are traced by hand from the Makefile, compose and `ci.yml`.
- `infra/Dockerfile.api` (no graph node): built for compose `api` and `worker`, so it is used by
  `make dev`, `make dev-api` and CI's `make dev` → `make test` / `make e2e`.
  - In compose, `../api:/app` is bind-mounted over `/app`, so those containers still see `api/admin/`,
    which is never imported.
  - The venv is `/opt/venv`, outside the mount, so they get exactly the main dependencies, as today.
  - `RUN rm -rf admin` succeeds whether or not the folder is there. Untouched otherwise.
- `Makefile` `lint-api` (no node): run by `make lint` and CI's Lint step. It gains `admin` in the mypy
  paths; `ruff check .` already covers it.
- `Makefile` `down` (no node): used by CI's "Remove a leftover CI stack" and "Stop the stack" steps, and by
  Speed rule 10. It gains `--profile admin`.
- `api/pyproject.toml` groups + `api/uv.lock` (no node): used by CI's `uv --directory api sync --frozen`
  (which now installs `dev` + `admin`), `Dockerfile.api`, the new `Dockerfile.admin`, and every
  `$(UV) run` target.
- `api/tests/conftest.py` (`affected`: imported by 34 test modules): `db_engine()`'s TRUNCATE gains
  `admin_actions`, reached by every integration test through `db_engine` / `client`. That is one more
  empty table and no behaviour change. The new admin-role fixture is used only by `test_admin.py`.
- `Report` (`affected`: `models/__init__.py`, spec 0011b; writer `services/reports.py`, test
  `test_reports.py`): gains the view-only `reporter` / `reported_user` relationships. No schema has a
  field by those names, and `lazy="raise"` loads nothing, so no statement changes.
- `Listing` (`affected`, depth 1): gains a view-only `owner` relationship. Its dependents are:
  - `services/search.py` (`_public_listings`, `_filtered`, `search_listings`,
    `get_public_listing_with_match`, `liked_rooms`);
  - `services/listings.py`, `services/applications.py`, `services/flatmates.py`, `services/people.py`;
  - `matching/fit.py`, `matching/score.py`;
  - `routers/applications.py`, `routers/search.py`.

  None of them reads `owner`, and `ListingOut` / `ApplicationListingOut` have no `owner` field, so
  `model_validate` never touches it. Untouched.
- `0012a`'s columns (`users.suspended_at`, `users.listing_cap`, `listings.status` / `removed_at`,
  `reports.resolved_at`, `admin_actions`): this app only writes them (`admin/actions.py`, UserView's
  edit). Their readers are 0012a's, with its tests: `resolve_session`, `verify_otp`, `_public_listings`,
  `_candidate`, `_shown`, `ListingOut.removed`, `UserOut.listing_cap`. AC4 and AC5 here call the public
  app to check the effect end to end.
- New code with no callers: `api/admin/`, `scripts/admin_role.py`, `infra/Dockerfile.admin`, the compose
  `admin` service, `make admin`.

## Risks / open questions
- **The public image** must change carefully. `--no-default-groups` still installs the main dependencies,
  which are not a group (the verifier confirmed this). The build session checks the imports in both
  images by hand (Tests to write).
- **SQLAdmin and mypy strict:** if SQLAdmin's types do not pass `--strict`, a per-module
  `ignore_missing_imports` or `disallow_subclassing_any = false` override for `admin.*` is acceptable and
  named in the PR. Silencing `app` is not.
- **Actions are GETs.** SQLAdmin 0.32 routes actions as GET only, after a confirmation modal; the
  verifier confirmed this in its source. The `Sec-Fetch-Site` check and the cookie rules cover it (NF3,
  AC2).
- **No grouping view:** search by `target_id` plus "Resolve closes the whole target" covers hundreds of
  rows. If the queue grows, a "reports per target" view is a follow-up.
- **Reading reported chats** must be stated in the terms of use (Slice 13). The build adds a FOLLOWUPS
  line under Slice 13.
- **Open product questions:** none. Gilad decided on 2026-11-15.

## Verifier notes
One round (2026-11-15) against SQLAdmin 0.32.0's source, Starlette 1.10.0, `main` and the Postgres 16
image. The verifier found 10 issues, and the orchestrator applied all of them to the text above:
- the ORM relationships;
- the Resolve log target;
- the chat route, its states and `dir="auto"`;
- NF1 in a subprocess;
- no module-level app;
- the `Sec-Fetch-Site` guard and the cookie path and name;
- the auth details;
- the role rules;
- the infra details;
- the test fixtures.

## Digest (filled by orchestrator after verification)
Spec 0012b — The admin dashboard   (verified 2026-11-15; part 2 of 2, depends on 0012a)
What a user can do after this: Gilad runs `make admin`, opens localhost:8001 and logs in with his password. He works
the report queue newest first, resolves every report on a target at once, reads a reported chat (logged), suspends
or lifts an account, hides or un-hides a listing, and edits an account's listing cap. Every action is in a log.
Decisions I need from you: none. FYI (orchestrator, the safer default): Suspend also ends the account's open
sessions, so lifting a suspension makes them sign in again rather than reviving old sessions.
KPIs this slice moves: trust (reports resolved, time from report to action).
Acceptance targets: NF1 the public API can't import the admin (checked in a fresh process); NF2 the admin's database
user cannot delete anything or touch other columns; NF3 a foreign Host, or a request from another site or another
localhost port, gets 400; NF4 no start with a weak password or secret.
Risks: your browser is the way in to a localhost app, mitigated by four guards (password, a cookie no other site
gets, a Host allowlist, a Sec-Fetch-Site check). Production deploy (a Fly app with no public address) is Slice 13.
Reviewers: code, security, qa   Estimated: 1 coder run (Opus/high), 1 review round
Links: `specs/0012b-admin-dashboard.md` · PRODUCT.md "Admin (Slice 12)" · `specs/0012a-moderation-data.md`
