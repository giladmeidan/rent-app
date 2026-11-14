# Project Handoff

## Project Overview
homie / הומי: a Hebrew-first, RTL rental marketplace for Gush Dan — apartments (owners ↔ seekers) and the
roommate market "שוק השותפים". FastAPI + SQLAlchemy 2.0 + PostgreSQL/PostGIS + Redis + arq worker; React 18 +
TypeScript + Vite + Tailwind + TanStack Query + i18next + react-router 7. Repo: https://github.com/giladmeidan/rent-app
(private).

Process: read `CLAUDE.md` first (Speed rules 1–10, hard rules). The main session is the orchestrator; each spec is
built by its own session in its own worktree via `/build NNNN`. Product decisions: `specs/PRODUCT.md`. Open minors
and pending decisions: `specs/FOLLOWUPS.md`. Done specs (with digests): `specs/archive/`. History: `git log`.
A session started in `/Users/giladmeidan/rent_app` (one folder up) does not register the project agents; run them
as `general-purpose` agents told to read their definition file first.

## Current Status
Overall: MVP feature work done through Slice 10 (שוק השותפים) plus 0009z landing v2 and 0010l; next slice not chosen.

- `main` = 8d30d12 (#85, market nav label). Alembic head `0018_one_room_interest`. all 80 spec files `done`, in
  `specs/archive/`. No open PRs, no spec worktrees.
- Main checkout `../rent-app` is on `main` with uncommitted demo-seed work (`Makefile` `seed-demo` target +
  `DESTROY_MAIN=1` guard on `make down`, `api/scripts/seed_demo.py`) and the knowledge graph.
- `../rent-app-orch` is the docs worktree (detached on `origin/main` between uses).
- Remote branch `origin/market-mine-rename` (#85's, merged) can be deleted.

Last updated: 2026-11-14 (knowledge cleanup: specs archived, FOLLOWUPS swept, docs trimmed).

## Next Steps
1. Choose the next slice with Gilad. Order in PRODUCT.md: 11 Trust basics (report button, renewal, rate limits),
   12 Admin minimal, 13 Launch readiness (deploy, one registrable domain, SMS).
2. Commit or drop the demo-seed work in the main checkout.
3. Digests still owed to Gilad: Slice 9, 9c, 10.
4. FOLLOWUPS worth a sweep before launch: the `make screens` failures (0010f line), the flaky
   `test_ac5_apply_racing_lister_like`, the Slice 12 deploy items (cookie domain, real client IPs, image pins).
5. Housekeeping: cancel the 4 queued Slice 8 CI runs (`gh run list --status queued`); Gilad to mark GitGuardian
   incident 40007526 a false positive; Gilad's open decisions in FOLLOWUPS (person-card score inference,
   re-apply after decline, 0010l invite expiry).

## Architecture
- `api/app/`: `main.py` (app factory, exact-origin CORS with credentials, DB/Redis errors → 503, 422 never echoes
  input), `auth.py` (`current_user` / `optional_user`, cookie `rent_session`), `models/` vs `schemas/` (never
  shared; `schemas/_text.py::visible_characters_only` is the one user-text rule), `matching/`, thin `routers/`,
  logic in `services/` (`search.py::_public_listings()` is the only definition of "public"), `worker.py` (geocoding).
- Migrations `api/alembic/versions/0001`–`0018`. Photos on Cloudflare R2 behind unguessable keys (0010d/j).
- `web/src/`: `app/` (routes, layout, side switch), `features/<domain>/`, `components/` (UI kit, 0009d),
  `locales/he.json`, generated `api/schema.d.ts` (`make client`, git-ignored). `web/e2e/` Playwright (CI only),
  `web/e2e/screens/` the mocked screenshot check (`make screens`).
- `infra/docker-compose.yml`: db, redis, api, worker, web on `127.0.0.1`; ports via `DB_PORT`/`REDIS_PORT`/
  `API_PORT`/`WEB_PORT`; `COMPOSE_PROJECT_NAME` isolates a worktree's stack.
- CI: one `ci` job on the self-hosted Mac runner, only on PRs labelled `ready-to-merge`; docs-only PRs run nothing.

## Constraints
- Orchestrator never writes application code; agents never push to `main` (orchestrator docs commits excepted).
- Never `git stash` in a shared checkout; never start/stop another checkout's compose stack.
- e2e only in CI; merge only with `make merge PR=N`; at most 3 builds at once.
- When writing specs through the shell, `\uXXXX` escapes get decoded into real characters; check files for
  invisible characters afterwards.

## Known Issues
- `/areas` blocks on a *hung* Postgres via pooled connections; why `GET /areas` is slow on CI runners is unconfirmed
  (ac9 in `applications.spec.ts` carries `test.slow()`).
- A resumed listing past `expires_at` returns `status: "active"` (the web shows it expired); unlimited paused listings.
- Join, leave and remove publish no chat event; open threads refresh members on window focus only.
- GitGuardian incident 40007526 (fake fixture token) flags every PR that merges `main`; merge on green `ci` anyway.
- No GitHub branch protection on this plan. Docker Desktop does not auto-start after a reboot (`open -a Docker`).
- Design artboards in `design/screens-v1/` reference a missing `support.js`.

## Environment & Commands
Prereqs: Docker Desktop, `uv`, Python 3.12, Node 22 (`nvm use 22`) + `pnpm`, `gh` logged in.
Commands: see `CLAUDE.md` → Commands and the `##` comments in the `Makefile`.

A worktree gets its own `.env` with `COMPOSE_PROJECT_NAME=rent-app-NNNN` and unique ports (earlier slices used
DB 5480–5521, Redis 6430–6471, API 8050–8091, web 5191–5231: start above those). The main checkout's stack runs on
5434/6380/8000 with no `.env`, so pass `DB_PORT=5434 REDIS_PORT=6380` to `make migrate` there. Web at
http://localhost:$WEB_PORT (must be `localhost` for CORS). Local login code: newest `.outbox/*.json`.
