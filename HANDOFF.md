# Project Handoff

## Project Overview
Rent App: a Hebrew-first, RTL, two-sided rental marketplace for Gush Dan (owners ↔ seekers, plus
roommate flows). Stack per `specs/PRODUCT.md`: FastAPI + SQLAlchemy 2.0 + PostgreSQL/PostGIS +
Redis + arq worker on the API side; React 18 + TypeScript + Vite + Tailwind on the web side;
docker compose for local dev; GitHub Actions CI. Repo: https://github.com/giladmeidan/rent-app (private).

Development runs through an agent process defined in `CLAUDE.md`: the main Claude Code session is
the **orchestrator** (writes specs, delegates, never writes app code), with subagents
`spec-verifier`, `coder`, and reviewers `code / qa / security / perf / ux` in `.claude/agents/`.
Work is sliced into specs in `specs/NNNN-slug.md`; the frontmatter `status` is the source of truth.
Note: when a session starts one folder above the repo, the project agents are not registered; run
them as `general-purpose` agents told to read their definition file first.

## Current Status
Overall: IN_PROGRESS

Current focus:
Spec 0001a (Auth API) is built, reviewed and awaiting Gilad's merge as PR #2. Spec 0001b (Auth web)
is verified and is the next build, but it also depends on 0000b (web shell), which is verified and
not built yet.

Last updated:
2026-11-09

## Current Work
**Spec 0001a — Auth API: email OTP, sessions, roles.** PR https://github.com/giladmeidan/rent-app/pull/2,
branch `spec/0001a-auth-api`, head 49eb453 (code head 689d888), CI green (api job 55 s, 88 tests),
status `in-review`. Built in the git worktree `/Users/giladmeidan/rent_app/rent-app-0001a` (the main
checkout `/Users/giladmeidan/rent_app/rent-app` stays on `main`). One reviewer round (code, qa,
security): 0 blockers, 1 major and 6 minors fixed, 2 follow-ups logged, 1 accepted risk. The digest
in "ready to merge" shape is in the spec's `## Digest`. **Only Gilad merges.** After the merge:
`git worktree remove ../rent-app-0001a` and delete the branch.

## Completed
- [x] Agent kit on `main` (CLAUDE.md, specs template, agents, commands).
- [x] Spec 0000 split into 0000a (api) and 0000b (web); both `verified` with digests.
- [x] 0000a merged as b00db8a via PR #1 (2026-11-09), CI api job 51 s.
- [x] Design artboards `design/screens-v1/` on main (f5d2912).
- [x] Slice 1 decided and specced: 0001a (API) and 0001b (web), both `verified` after one verifier
      round each; Gilad's three product decisions recorded in `specs/PRODUCT.md`.
- [x] 0001a built, reviewed once, fixed; PR #2 open and green.

## Next Steps
1. Gilad merges PR #2 (0001a). Then remove the `rent-app-0001a` worktree and branch; the shared test
   DB `rent_test` is at revision 0001 — the next `make test` on main migrates it to 0002, which is fine.
2. Build 0000b (web shell) first — 0001b depends on it. Before `/build 0000b`, update its UI section to
   reference `design/screens-v1/Main.dc.html` for shell structure and tokens (it still says "no Design
   artboard exists") and note: CORS allows exactly `WEB_ORIGIN` (`http://localhost:5173`); api publishes
   on `127.0.0.1` so a Vite proxy must target IPv4; `make client` must pass env vars (incl. `SECRET_KEY`)
   to `export_openapi.py`; `API_PORT` exists.
3. Build 0001b (`specs/0001b-auth-web.md`, verified) in a **new session**: coder → reviewers (code, qa,
   ux, security) once → coder fixes → orchestrator brief check → digest → PR. Its Playwright AC7 reads
   codes from `.outbox/*.json`.
4. Flip GitHub branch protection to require the `api` (later `web`, `e2e`) checks.
5. Then `/spec` Slice 2 (Owner posts listing) — artboard `design/screens-v1/CreateListing.dc.html`.

## Architecture
- `api/app/`: `main.py` (app factory, exact-origin CORS with credentials, OperationalError → JSON 503;
  on the 0001a branch also Redis errors → JSON 503), `config.py` (pydantic-settings; `DatabaseSettings`
  subset so alembic/seed need only `DATABASE_URL`; SecretStr DSNs; WEB_ORIGIN validator), `db.py`
  (`make_engine`, `connect_timeout=2`, `hide_parameters`), `models/` vs `schemas/` (never shared),
  `services/`, `routers/` (thin), `worker.py` (arq `ping`).
- 0001a adds (branch): `auth.py` (`current_user`/`optional_user`, cookie `rent_session`),
  `redis_client.py`, `services/auth.py` (OTP in Redis: HMAC-SHA256 of code keyed by `SECRET_KEY`, Lua
  scripts for atomic rate-limit check-then-count, attempt reservation and code claim/refund; sessions
  table with sha256 token hash, 30-day fixed expiry), `services/email.py` (`FileEmailSender` →
  `.outbox/*.json` in dev, `SmtpEmailSender`), `services/sms.py` (stub, no caller), `i18n/he.py`
  (OTP email copy), migration `0002_users_sessions` (`users`, `sessions`, text + CHECK, no enums).
- `api/alembic/`: `search_path=public`; migrations `0001_areas`, `0002_users_sessions` (branch).
- `infra/docker-compose.yml`: ports bound to `127.0.0.1`, overridable via `DB_PORT`/`REDIS_PORT`/
  `API_PORT`; 0001a adds `SECRET_KEY` on api+worker and the `../.outbox:/outbox` volume (`make dev`
  chmods it 0777 first because the image runs as uid 10001).
- `Makefile`: loads optional repo-root `.env` via `infra/dotenv.awk`; `make dev` waits on `/health`.
- Web (0000b/0001b, not built): Vite + React + TS strict + Tailwind 3.4 (logical props only), TanStack
  Query, i18next `he.json`, `openapi-fetch` client with `credentials: 'include'`, react-router (0001b),
  `i18n-check.mjs`, Playwright.

## Important Files
- `CLAUDE.md` — process and hard rules. Read first.
- `specs/PRODUCT.md` — standing decisions; rows "Account roles" and "Signup data" added 2026-11-09.
- `specs/0001a-auth-api.md` (digest at the bottom), `specs/0001b-auth-web.md`, `specs/0000b-foundations-web.md`.
- `specs/FOLLOWUPS.md` — 4 items from 0000a; 3 from 0001a on the PR branch (one-domain deployment for
  SameSite cookies, per-IP verify limit / IPv6 / global send cap, accepted 24 h lockout risk).
- `PR-0001a.md`, `REVIEW-0001a-round1.md` (on the PR branch) — PR body and merged review digest.
- `design/README.md` + `design/screens-v1/*.dc.html` — artboards (reference a missing `support.js`).

## Important Decisions
- Spec 0000 split into 0000a/0000b (2026-11-08); Slice 1 pre-split into 0001a/0001b by the orchestrator.
- Roles: every account picks **owner** or **seeker** at signup, switchable later; broker is an
  `account_type`, not a role. Signup collects email + display name only; no phone until SMS switch-on
  (Gilad, 2026-11-09, in PRODUCT.md).
- OTP abuse caps: 3 codes/15 min and 10/day per email, 10/15 min per IP, 5 guesses per code; refused
  requests count nothing. Email: file outbox in dev, plain SMTP in prod, provider deferred to Slice 12.
- Signing up with an email that already has an account logs into it (200), profile ignored.
- Cookie `SameSite=Lax` + exact-origin CORS is the CSRF posture; this requires web and API on one
  registrable domain in production (FOLLOWUP for Slice 12).
- AC15 narrowed: Starlette emits `Allow-Credentials` for any Origin; `Allow-Origin` is the protective header.
- Tooling `uv` / `pnpm`; `redis` 5.x pinned for `arq`; `.env` loaded by make; Gush Dan bounding box
  until Slice 3; product name "דירה" placeholder until Slice 9.

## Constraints
- Every subagent runs `model: opus`, `effort: high` (Gilad, 2026-11-09).
- One verifier round per spec and one reviewer round per spec; after fixes the orchestrator checks
  briefly itself (Gilad, 2026-11-09).
- Refresh this handoff only at the end of a spec or after a big slice rewrite, not after every digest
  (Gilad, 2026-11-09).
- Orchestrator never writes application code; Gilad merges; agents never merge or push to `main`.
- Two sessions may share the main checkout: build each spec in its own `git worktree`, never `git stash`
  there, never start/stop the shared compose stack from a worktree.

## Known Issues
- 0001b cannot be built until 0000b is (it depends on the web shell and `make client`/`make e2e`).
- `/areas` blocks on a *hung* Postgres via pooled connections (FOLLOWUPS, needs query timeout design).
- Design artboards reference a missing `design/screens-v1/support.js`.
- Starlette/httpx deprecation warning in TestClient (1 per test session).
- `make dev` on Linux with the 0777 `.outbox` bind mount is untested (checked by reading the rendered
  config only).

## Environment & Commands
Prereqs: Docker Desktop, `uv`, Python 3.12, (web) Node 22 + `pnpm`, `gh` logged in.
On this machine the stack runs with `DB_PORT=5434 REDIS_PORT=6380` (repo-root `.env`, gitignored).
A worktree needs its own `.env`; the 0001a one also sets `TEST_DATABASE_URL` to `rent_test_0001a`.

    make dev        # compose up db+redis → migrate → seed → api+worker → wait on /health
    make down       # compose down -v (also empties .outbox/)
    make test       # pytest (needs compose db+redis up)
    make lint       # ruff check + ruff format --check + mypy --strict
    make migrate    # alembic upgrade head
    make seed       # idempotent Gush Dan seed

Required environment variables (names only; see `.env.example`): `DATABASE_URL`, `TEST_DATABASE_URL`,
`REDIS_URL`, `WEB_ORIGIN`, `DB_PORT`, `REDIS_PORT`, `API_PORT`; 0001a adds `SECRET_KEY`,
`EMAIL_BACKEND`, `EMAIL_OUTBOX_DIR`, `EMAIL_FROM`, `COOKIE_SECURE`, `SMTP_URL`.
API at http://127.0.0.1:8000 (`/health`, `/areas`, `/docs`; 0001a: `/auth/otp/request`,
`/auth/otp/verify`, `/me`, `/auth/logout`). Login locally: the code is in the newest `.outbox/*.json`.

## Session History
- 2026-11-09 (evening) — Slice 1 specced (0001a/0001b, one verifier round each), 0001a built in a
  worktree, reviewed once (code/qa/security), fixed; PR #2 open, CI green, 88 tests. Gilad: one
  verifier round, handoff only at spec end, 0001b in a new session.
- 2026-11-09 — 0000a merged (PR #1, CI 51 s). GitHub repo created.
- 2026-11-09 — 0000a built and reviewed three rounds; Gilad set Opus/high, single reviewer round;
  design artboards added.
- 2026-11-08 — Repo initialised from the agent kit; spec 0000 written, split and verified.
