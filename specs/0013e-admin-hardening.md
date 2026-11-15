---
id: 0013e
title: "Gilad's admin login lives in Postgres: logging out ends the session even for a copied cookie, the wrong-password lock survives restarts, and every admin write needs a browser's same-origin proof"
status: in-review
depends_on: []   # builds beside 0013b (public API limits) and 0013c (account deletion); see Risks for the migration number
reviewers: [code, security, qa]   # security: admin authentication, a new table with grants; qa: login, lock and write refusals change behaviour, AC6–AC8 are 0012b's qa edges; no ux: SQLAdmin's own login page, unchanged
estimate: 1 coder run   # coder Opus/high (auth + migration, Speed rule 6)
---

## Goal
After this ships, the admin dashboard's sessions and wrong-password lock are stored in Postgres instead of the
signed cookie and the process. Logging out kills that session everywhere, including a copy of the cookie. The
5-tries lock holds across restarts and across more than one admin machine. A browser that does not prove a
request is same-origin can no longer write. FOLLOWUPS 0012b (three security items) and PRODUCT.md "Launch (Slice
13)": "the admin's session hardening (FOLLOWUPS 0012b)".

## Decisions this spec builds on
- PRODUCT.md "Admin (Slice 12)" (Gilad 2026-11-15): the admin is for Gilad only and has no public address
  (production: a Fly app reached with `fly proxy`, spec 0013a). On top of that: one password, a `SameSite=Strict`
  cookie and a Host allowlist.
- Spec 0012b's login rules stay: password only, an absolute 8-hour session, and a lock after 5 wrong tries within
  15 minutes that holds 15 minutes from the 5th and is never lifted early, even for the right password.

## Scope
**In:**
1. **Table `admin_logins`** (migration `0025_admin_logins`; model `api/app/models/admin_login.py`, exported from
   `app/models/__init__.py` like `AdminAction`, whose docstring it shares: "the running public app never reads or
   writes it"). One row per login attempt (see Data).
2. **`api/admin/auth.py` `PasswordAuth(settings, engine)`**: each method does its database work in one
   transaction through `starlette.concurrency.run_in_threadpool`. Times come from `_now()` (kept, so the tests'
   clock still works), stored as `dt.datetime.fromtimestamp(_now(), dt.UTC)`.
   - **`login`**: read the form first, as today. Then, in one transaction that starts with `SELECT
     pg_advisory_xact_lock(hashtext('homie_admin_login'))`, so concurrent logins on any machine run one at a time:
     1. If `max(locks_until) > now`, return False and write nothing (the lock is never lifted early).
     2. On the right password (`hmac.compare_digest` on bytes, as today), insert `ok = true` with `token_hash =
        sha256(token)` for a new `token = secrets.token_urlsafe(32)`, then `request.session.clear()` and
        `request.session["sid"] = token`. Return True.
     3. On a wrong password, count the failures `n` with `at > now - 15 min` and `at` after the latest row that is
        `ok` or has `locks_until`. Insert `ok = false`, with `locks_until = now + 15 min` when `n + 1 >= 5`.
        Return False.

     This keeps 0012b's semantics exactly: a success or a lock starts the count again.
   - **`authenticate`**: True iff `session["sid"]` is a str and a row has that `token_hash`, `ok`, `ended_at IS
     NULL` and `now - 8 h < at <= now`. Otherwise `request.session.clear()` and False. `login_at` leaves the
     cookie.
   - **`logout`**: only when `session["sid"]` is a str, `UPDATE admin_logins SET ended_at = now WHERE token_hash =
     sha256(sid) AND ended_at IS NULL`; then always `request.session.clear()`; True. (SQLAdmin's `logout` route has
     no `login_required`, so it is reached with no cookie too and must not answer 500.)
   - Constants `SESSION_MAX_AGE_S`, `LOCK_AFTER`, `LOCK_WINDOW_S` stay. The `shortcut:` comment and the in-process
     `_failures` / `_locked_until` go. The module docstring states the new storage.
   - `admin/main.py::create_admin_app` passes its `engine`.
3. **Writes need `Sec-Fetch-Site: same-origin`** `api/admin/main.py::_refused` (FOLLOWUPS 0012b `FetchSiteGuard`):
   when the header is absent, a **write** is refused (`return writes`, instead of `return False`), where a write is
   any non-GET or an `/action/` path, as today. Reads without the header still pass. Browsers that send Fetch
   Metadata (Chrome and Edge 76+, Firefox 90+, Safari 16.4+) cover Gilad's. A page cannot forge the header, and a
   client that sends none (curl, an old browser) cannot write. This closes the gap the per-session CSRF token was
   proposed for, with no token in SQLAdmin's templates (see Risks). The module docstring and the `REFUSED_FETCH_SITES`
   comment say so.
4. **Grants** `api/scripts/admin_role.py`: `GRANT INSERT ON admin_logins` beside the `admin_actions` line, and
   `("admin_logins", ("ended_at",))` in `_COLUMN_GRANTS` (SELECT comes from the existing grant on all tables).
   The comment lists "logging in and out". `make admin` already runs `migrate` then `admin_role.py`.
5. **Tests infrastructure** `api/tests/test_admin.py`: the `admin_client` fixture's `TestClient` sends `headers=
   {"sec-fetch-site": "same-origin"}` by default, as Gilad's browser does. `test_nf3_host_and_fetch_site_guards`
   overrides per request and adds the no-header cases with a second client built without default headers.
   `test_ac2_lock_holds_for_logins_whose_bodies_arrive_late` builds `PasswordAuth(_settings(admin_role),
   make_engine(admin_role))` (the role's real database) instead of an unused URL, and takes `db_engine` and
   `admin_role` so its rows are truncated. `api/tests/conftest.py::db_engine`'s TRUNCATE list and docstring gain
   `admin_logins`.
6. **Test edges** from 0012b's review (FOLLOWUPS 0012b `test_admin.py`), as tests of the existing behaviour.
   A failing one is a bug to fix in `api/admin/` in this spec. See AC6–AC9.
7. **`specs/FOLLOWUPS.md`**: delete the three 0012b lines this closes: `auth.py` nonce, `FetchSiteGuard` CSRF, and
   `test_admin.py` more edges. Reword 0012b `infra (Slice 13)`: drop "revisit the in-process login lock", and add
   "`scripts/admin_role.py` after every migration that adds an admin table (0025)". The deploy itself stays
   0013a's.

**Out:**
- **A per-session CSRF token**: Scope 3 refuses every write that lacks the browser's same-origin proof. A token
  would need SQLAdmin's edit form and its action modal's JavaScript overridden, for no added protection in a
  browser that sends Fetch Metadata.
- **"Log out everywhere"** and a list of sessions: one admin, at most a few sessions.
- **Pruning `admin_logins`**: Gilad's logins plus at most 5 failures per 15 minutes (≈480 a day under attack); a
  later spec can delete rows older than a year.
- **The deploy** (`fly proxy`, `ADMIN_HTTPS_ONLY`, `ADMIN_ALLOWED_HOSTS`, production `admin_role.py`): 0013a.
- **An admin view of `admin_logins`**: not asked; the rows can be read with SQL.

**New dependencies:** none.

## Data
Migration `api/alembic/versions/0025_admin_logins.py` (`down_revision = "0024"`), table `admin_logins`:

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | uuid | no | PK, `server_default gen_random_uuid()` |
| `at` | timestamptz | no | the attempt's time (from the admin process, see Scope 2) |
| `ok` | boolean | no | the right password |
| `token_hash` | text | yes | `UNIQUE`; sha256 hex of the session token; only on `ok` rows |
| `ended_at` | timestamptz | yes | logout; only on `ok` rows |
| `locks_until` | timestamptz | yes | the failure that started a lock; only on failed rows |

Checks: `ck_admin_logins_token` `ok = (token_hash IS NOT NULL)`; `ck_admin_logins_ended` `ok OR ended_at IS NULL`;
`ck_admin_logins_lock` `NOT ok OR locks_until IS NULL`. No other index (a few hundred rows). Only the token's hash
is stored, as `sessions.token_hash` does for the public app. `downgrade` drops the table.

**Backwards compatible:** a new table that the public app never touches. A cookie from 0012b (`login_at`, no
`sid`) fails `authenticate` and goes back to the login page once. The migration must run before the new admin
image starts, and `admin_role.py` after it (Scope 4): `make admin` does both, in that order.

## API
No public API change. The admin's routes are unchanged; only their auth backend and the write guard change:

| Method | Path | Auth rule | Change |
| --- | --- | --- | --- |
| POST | /admin/login | public (the password), same-origin | attempts recorded in `admin_logins`; the lock is read from it |
| GET | /admin/logout | public (SQLAdmin calls the backend's `logout` with no session check) | ends the session's row if there is one; no cookie → 302 to `/admin/login`, no row changed |
| any | /admin/* (lists, details, edit, actions, chat) | admin session | session checked against `admin_logins`; writes need `Sec-Fetch-Site: same-origin` |

## UI
None. SQLAdmin's login page and its "Invalid credentials." error are unchanged (English, admin only; hard rule 4
covers `web/`). No i18n keys.

## Acceptance criteria
- [ ] AC1 Given a login, When `/admin/logout` runs, Then the session's row has `ended_at`. A client holding a
  **copy of the cookie** taken before the logout is sent to `/admin/login` on its next request, and a fresh login
  works. `GET /admin/logout` with no cookie answers 302 to `/admin/login` and changes no row. —
  `api/tests/test_admin.py::test_ac1_logout_ends_a_copied_cookie`, `::test_ac1_logout_without_a_session`
- [ ] AC2 Given 5 wrong passwords within 15 minutes, When the admin app is **rebuilt** (a new
  `create_admin_app`, as after a restart), Then the right password is still refused until 15 minutes after the
  5th failure, and accepted from then on. — `api/tests/test_admin.py::test_ac2_lock_survives_a_restart`
- [ ] AC3 0012b's login rules hold unchanged on the new storage: `test_ac2_password_login_session_age_and_lockout`
  (8-hour absolute age, cookie flags, wrong password, the lock never lifted early),
  `test_ac2_lock_counts_five_wrong_within_15_minutes` and `test_ac2_lock_holds_for_logins_whose_bodies_arrive_late`
  (rebuilt on a real engine; six concurrent logins, five wrong, the right one last, all refused) pass. A wrong
  password writes one `ok = false` row and a right one an `ok = true` row with a 64-hex `token_hash`; the cookie
  holds no `login_at`, and no row or cookie holds the password. — `api/tests/test_admin.py` (those three)
- [ ] AC4 Given a signed-in client, When an action (`/admin/user/action/suspend?pks=…`) or the edit form POST is
  sent **without** a `Sec-Fetch-Site` header, Then it answers 400 and nothing is written. The same read (`GET
  /admin/user/list`) without the header is 200, and with `same-origin` the action runs (one log row). The 0012b
  cases (`cross-site`, `same-site` refused everywhere, `none` refused for writes) still hold. —
  `api/tests/test_admin.py::test_nf3_host_and_fetch_site_guards`
- [ ] AC5 Given a connection as `homie_admin`, Then it can `INSERT` into `admin_logins` and `UPDATE` its
  `ended_at`. It cannot `UPDATE admin_logins SET ok = …` / `token_hash` / `locks_until` / `at`, nor `DELETE FROM
  admin_logins` (`InsufficientPrivilege`). Every 0012b refusal still holds, and a second `admin_role.py` run
  converges. — `api/tests/test_admin.py::test_nf2_role_has_only_its_grants`
- [ ] AC6 (edges of 0012b AC6) Given a user, When `listing_cap` is edited to 0 and then to 100, Then each is
  stored with its `set_listing_cap` log row. An edit to the current value writes no log row. A POST with extra
  fields (`email`, `suspended_at`, `display_name`) changes only `listing_cap`. —
  `api/tests/test_admin.py::test_ac6_edit_listing_cap_edges`
- [ ] AC7 (edges of 0012b AC9) Given real rows in every view (a report, a user, a listing, an admin action), When
  create, delete, export, import, and edit on anything but UserView are requested by URL, Then each is refused
  (404/405/403, whatever SQLAdmin answers, asserted per route) and the rows are unchanged. —
  `api/tests/test_admin.py::test_ac7_read_only_views_with_rows`
- [ ] AC8 (edges of 0012b AC7) Given a reported group chat (owner, seeker and two flatmates) with 55 messages, When
  its chat page opens, Then all 55 show oldest first, the 4 members are listed, and a message stored at
  `2026-07-01T21:30:00Z` shows `2026-07-02 00:30` (Asia/Jerusalem). —
  `api/tests/test_admin.py::test_ac8_reported_chat_many_messages_members_and_time`
- [ ] AC9 The migration upgrades and downgrades cleanly, and its checks refuse an `ok` row without `token_hash`, a
  failed row with `token_hash` or `ended_at`, and an `ok` row with `locks_until`. —
  `api/tests/test_migrations.py::test_ac9_admin_logins_up_and_down`
- [ ] NF1 `make lint`, `make test` pass. `test_migrations.py::test_ac4_autogenerate_sees_no_diff_with_postgis_extensions`
  passes with the new model, and `test_admin_isolation.py::test_nf1_public_app_has_no_admin` still passes: the
  model lives in `app/models` and the public app imports no `admin`. — CI

## Tests to write
Integration: `test_admin.py` AC1, AC2, AC4–AC8 (new or extended) and the three rebuilt AC3 tests;
`test_migrations.py` AC9. Unit: none. E2E: none (the admin is not in the e2e suite).

## Blast radius
From `graphify affected` on `main` (2026-11-15).
- `admin.auth.PasswordAuth`: built by `admin/main.py::create_admin_app` (L86), which `main()` (L94),
  `test_admin.py::admin_client` (L142) and `test_admin.py::test_nf4_settings_refuse_weak_secrets` (L679) call; built directly by
  `test_admin.py::test_ac2_lock_holds_for_logins_whose_bodies_arrive_late` (L276). It gains `engine` (Scope 2,
  5). `admin.auth._now` is monkeypatched by `test_ac2_password_login_session_age_and_lockout` and
  `test_ac2_lock_counts_five_wrong_within_15_minutes`; it stays.
- `admin.main._refused`: called only by `FetchSiteGuard.__call__` (L49). Every `test_admin.py` request goes through
  it. They pass through the fixture's default header (Scope 5), and nf3 owns the header cases.
- `scripts/admin_role.py::apply_admin_role`: `main()` (L80), `conftest.py::admin_role` (L136) and
  `test_admin.py::test_nf2_role_has_only_its_grants` (L609). Every test module imports `conftest`, but only the
  admin tests use the role. Its `_check_role` helper gains the AC5 checks.
- `tests/conftest.py::db_engine`: every integration test uses it. Only its TRUNCATE list (and docstring) changes,
  gaining `admin_logins` (Scope 5), so a lock row left by one test (fake clock in 2027) cannot lock out later ones.
- `app/models/__init__.py`: one new export. `test_migrations.py`'s autogenerate check covers it (NF1).
- `Makefile` `admin` (no node): already `migrate` → `admin_role.py` → start; unchanged.

## Risks / open questions
- **Migration number**: `0025` is free on `main` today, but 0013c (account deletion) also adds a migration in
  parallel. The second of the two to merge renames its file and `revision` to `0026` and sets `down_revision` to
  the other's id, after merging `origin/main` (memory: migration-chain order).
- **Sec-Fetch instead of a token**: a browser without Fetch Metadata can no longer use the admin for writes (any
  Chrome, Edge or Firefox since 2021, or Safari since 2023, sends it). If Gilad ever needs one, the token is the
  fallback. `reviewer-security` should challenge this.
- **Clock**: `at` comes from the admin process, not Postgres `now()`, so the tests' clock works. With two admin
  machines whose clocks differ by seconds, the 15-minute and 8-hour edges move by those seconds, which is harmless.
- **Shared files**: `api/app/models/__init__.py` and `api/alembic/versions/` with 0013c; `api/scripts/admin_role.py`
  with 0013a (`--existing-role`, its AC5 post-check reads the same grant lists, so `admin_logins` joins them);
  `api/tests/test_admin.py` with 0013a and 0013c (each adds tests); `api/tests/conftest.py` with 0013b and 0013c
  (0013c also extends `db_engine`'s TRUNCATE); `specs/FOLLOWUPS.md` with all of Slice 13. The second to merge merges `origin/main`.

## Verifier notes
2026-11-15, one round against `.claude/agents/spec-verifier.md`'s checklist, run inline by the orchestrator's
spec fork (a fork may not start a subagent). Changes made: the migration test renamed after its AC; the untestable
"no query on the event loop" NF dropped (Scope 2 states it, `reviewer-code` reads it); Blast radius gained
`test_nf4_settings_refuse_weak_secrets`. Kept `[code, security]` without qa: no public API or screen changes, and
the review minors this spec turns into tests came from qa. Checklist 1–11 pass; no product question for the coder.

## Digest (filled by orchestrator after verification)
Spec 0013e — Admin sessions and lock in Postgres, same-origin writes only   (verified, 1 part; split from 0013b)
What a user can do after this: Gilad's logout kills a copied admin cookie, the 5-wrong-tries lock survives a
restart or a second machine, and no admin write runs without the browser's same-origin proof.
Decisions I need from you: none (one call to see: writes now need a browser that sends Sec-Fetch-Site — any
Chrome / Edge / Firefox since 2021 or Safari since 2023 — instead of a CSRF token; say if you use an older one).
KPIs this slice moves: none (security posture before the production deploy).
Acceptance targets: 8-hour absolute session; lock after 5 wrong in 15 min, 15 min from the 5th; one
`admin_logins` row per attempt, only the token's sha256 stored.
Risks: migration 0025 races 0013c's migration (the second to merge renumbers to 0026); production must run
`admin_role.py` after the migration (0013a's runbook).
Reviewers: code, security   Estimated: 1 coder run (Opus), 1 review round
Links: specs/0013e-admin-hardening.md · PRODUCT.md "Admin (Slice 12)", "Launch (Slice 13)" · no artboard

## Verifier findings (independent, 2026-11-15)
1. **Line 10 / 11 (hidden dependency, blast radius): `admin_logins` rows leak between tests.**
   `tests/conftest.py::db_engine` TRUNCATEs a fixed list that will not include `admin_logins`. The AC3 tests
   use a fake clock at `1_800_000_000` (2027-01-15), so a lock they leave has `locks_until` in the future
   of the real clock and refuses every later `signed_in` login. `test_ac2_lock_holds_for_logins_whose_bodies_arrive_late`
   takes no `db_engine` and would leave a real-time 15-minute lock. Fix: Scope 5 adds `api/tests/conftest.py`
   (`db_engine`'s TRUNCATE and docstring gain `admin_logins`). The late-bodies test takes `db_engine` and
   `admin_role`. Blast radius gains a `db_engine` line: every integration test uses it, and only its table
   list changes.
2. **Line 4 (auth rule): `GET /admin/logout` has no session check.** SQLAdmin's `Admin.logout` calls
   `authentication_backend.logout` directly (no `login_required`), so it can be reached with no cookie. Scope
   2's `sha256(sid)` would raise on a missing or non-str `sid`, and the request would answer 500. Fix:
   `logout` runs the UPDATE only when `session["sid"]` is a str, then always clears and returns True. The API
   table's rule for `/admin/logout` becomes "public; ends the session's row if there is one". AC1 adds:
   `GET /admin/logout` with no cookie → 302 to `/admin/login`, no row changed.
3. **Line 8 (reviewers): qa is missing.** The admin's routes change behaviour: login and the lock move to
   the database, and writes without `Sec-Fetch-Site` are refused. AC6–AC8 are also 0012b's qa edges, and
   0012b had `[code, security, qa]`. Fix: `reviewers: [code, security, qa]`.
4. **Risks (siblings): the "Shared files" list is incomplete.** It names 0013c for `app/models/__init__.py`
   and `alembic/versions/`. It does not name:
   - `api/scripts/admin_role.py` (0013a adds `--existing-role` there and an AC5 test);
   - `api/tests/test_admin.py` (0013a and 0013c each add a test);
   - `api/tests/conftest.py` (0013b and 0013c edit it, 0013c `db_engine`'s TRUNCATE; after finding 1, this
     spec does too).

   Fix: add these to that bullet. The second spec to merge merges `origin/main` and keeps both edits.

Applied by the orchestrator (2026-11-15): 1 → `conftest.py::db_engine` TRUNCATE gains `admin_logins` (Scope 5 note below,
Blast radius line); the late-bodies test takes `db_engine` and `admin_role`. 2 → `logout` guards a missing `sid`, the API
row says public, AC1 adds the no-cookie case. 3 → reviewers `[code, security, qa]`. 4 → Shared files bullet completed.
Status set to `verified`.
