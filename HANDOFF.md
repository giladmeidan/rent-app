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
Overall: MVP feature work done through Slice 10 (שוק השותפים, incl. 0010m two streams). Slice 14 "Rent price
estimate" is started: its two data specs are merged, its engine is not specced yet.

- `main` = a5ec89b (0014b done, PR #90). Alembic head `0020` (`0020_price_signals.py`; `0019_rent_reference.py`
  before it). 83 spec files `done`, in `specs/archive/`. No open PRs, no spec worktrees, no build stacks.
- **Slice 14 so far** (PRODUCT.md "Rent price estimate" holds Gilad's decisions of 2026-11-14):
  - `0014a` (PR #89): tables `rent_areas` / `rent_prices`, `services/rent_reference.py`, a monthly arq cron and
    `make rent-import`. Off by default (`RENT_REFERENCE=off`); the tables are empty until someone runs it with
    `RENT_REFERENCE=nadlan`. The source facts and the Gush Dan coverage numbers are in the archived spec.
  - `0014b` (PR #90): `listing_price_changes` (every price a listing had), the private closure answer
    (`close_reason`, `final_rent_ils`, `closed_at`; `PUT /listings/{id}/closure`, asked after pausing an
    apartment), and four apartment facts (`balcony`, `safe_room`, `air_conditioning`, `condition`).
  - Nothing computes or shows a price yet.
- Main checkout `../rent-app` is on `main` at 978791c, **behind `origin/main`**, with uncommitted work
  (`Makefile`, `.gitignore`, `api/scripts/seed_demo.py`, `api/scripts/seed_promo.py`) and the knowledge graph. It
  needs a `git pull` (which also rebuilds the graph).
- `../rent-app-orch` is the docs worktree (detached on `origin/main` between uses).
- Merging is delegated to the orchestrator for Slice 14 (Gilad, 2026-11-14); Slices 11–13 are not delegated yet.

Last updated: 2026-11-14 (Slice 14 data specs 0014a and 0014b merged).

## Next Steps
1. **Continue the rent price estimate plan with Gilad.** Agreed order: the engine comes after Slice 11. The engine
   as planned: (1) baseline from `rent_prices` per neighbourhood and room count, falling back to the city;
   (2) adjustments for size, floor, parking, furnishing and the new facts; (3) comparable listings from homie's
   own data once there are enough; (4) a learned model only if a backtest says it is better. Output is a range
   with a confidence level, no number at low confidence. First surface: the owner's price step in the wizard;
   later a tab where anyone enters apartment facts (possibly paid, not decided), so the engine takes facts, not
   a listing id. Open inputs for the engine spec: CBS city tables for 1–2 room flats (the imported source has
   3, 4, 5 and "all" only); assigning a listing to a neighbourhood (street lists are in `rent_areas.streets`,
   94% of streets map, 10% of those to more than one neighbourhood); averaging several quarters (neighbourhood
   figures are jumpy); a backtest harness.
2. Choose the next slice with Gilad. Order in PRODUCT.md: 11 Trust basics (report button, renewal, rate limits;
   renewal must clear the closure answer, see FOLLOWUPS 0014b), 12 Admin minimal, 13 Launch readiness (deploy,
   one registrable domain, SMS; read nadlan.gov.il's terms of use before `RENT_REFERENCE=nadlan`).
3. Pull the main checkout; commit or drop its uncommitted seed work.
4. Digests still owed to Gilad: Slice 9, 9c, 10 (Slice 14's are in the archived specs and were reported in chat).
5. FOLLOWUPS worth a sweep before launch: the `make screens` failures (24 states red, same as the 0010f line; not
   re-run on `main`), the 0014a and 0014b review minors (two e2e flows for the new screens are not written), the
   flaky e2e line from PR #89, the flaky `test_ac5_apply_racing_lister_like`, the Slice 12 deploy items.
6. Housekeeping: Gilad to mark GitGuardian incident 40007526 a false positive; Gilad's open decisions in
   FOLLOWUPS (person-card score inference, re-apply after decline, 0010l invite expiry).

## Architecture
- `api/app/`: `main.py` (app factory, exact-origin CORS with credentials, DB/Redis errors → 503, 422 never echoes
  input), `auth.py` (`current_user` / `optional_user`, cookie `rent_session`), `models/` vs `schemas/` (never
  shared; `schemas/_text.py::visible_characters_only` is the one user-text rule), `matching/`, thin `routers/`,
  logic in `services/` (`search.py::_public_listings()` is the only definition of "public"), `worker.py` (geocoding; the monthly rent reference import,
  off by default).
- Migrations `api/alembic/versions/0001`–`0020`. Photos on Cloudflare R2 behind unguessable keys (0010d/j).
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
