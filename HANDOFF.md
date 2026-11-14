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
Overall: MVP feature work done through Slice 10. Slice 14 "Rent price estimate": data specs and engine v1 built.

- **Engine v1 = spec `0014c`, PR #91** (head `978bd04`, `ready-to-merge`; one review round, 0 blockers / 0 majors;
  local pytest 657 + vitest 697 green). Its `ci` run was still going when this was written; the orchestrator merges
  it with `make merge PR=91` on green, then archives the spec (Speed rule 10). Check `gh pr view 91` first.
- What v1 does: an owner filling in an apartment in the listing wizard (new or edit) sees under the price the
  official average rent for its room count in its neighbourhood (or city), as a range + confidence + source; nothing
  for under 2.5 rooms, unknown cities, thin figures or a range wider than ±20%. `GET /rent-estimate` (signed in;
  city, street, rooms; never a listing id). Backtest on the official history (`make rent-backtest`, run once on
  2026-11-14 against 349 files) set `WINDOW_QUARTERS = 3`, half width ±8% neighbourhood / ±18% city (so city-level
  answers are always "medium").
- Data specs merged: `0014a` (PR #89, `rent_areas` / `rent_prices`, monthly import, off by default with
  `RENT_REFERENCE=off`) and `0014b` (PR #90, price history, private closure answer, four apartment facts).
  **In dev, CI and production the tables are empty until the import runs with `RENT_REFERENCE=nadlan`, so the hint
  shows nothing there.**
- Alembic head `0020` (0014c adds no migration). Orchestrator merging is delegated for Slice 14 only.
- Main checkout `../rent-app` is on `main`, **26 commits behind `origin/main`**, with uncommitted `Makefile` and
  `.gitignore` edits and untracked seed/promo work (`api/scripts/seed_demo.py`, `seed_promo.py`, `promo/`,
  `promo-video/`, `web/e2e/promo/`). Needs a `git pull` (which also rebuilds the graph).
- `../rent-app-orch` is the docs worktree (detached on `origin/main` between uses). `../rent-app-0014c` exists until
  PR #91 merges.

Last updated: 2026-11-14 (0014c specced, verified, built; PR #91 waiting on CI).

## Next Steps
1. **PR #91**: merge on green `ci` with `make merge PR=91` (GitGuardian incident 40007526 is the known fake fixture
   token; merge anyway). Then in `../rent-app-orch`: `status: done`, move the spec to `specs/archive/`, add the merged
   digest (backtest numbers above), push `HEAD:main`; `git worktree remove ../rent-app-0014c`; delete the local and
   remote branch `spec/0014c-rent-estimate-baseline`.
2. **Small flats (Gilad wants this next, 2026-11-14; not specced, source not researched yet).** v1 gives 1–2 room
   flats no number (a large share of Tel Aviv). Plan: spec `0014d` = import CBS (הלמ״ס) average-rent tables for small
   flats and let the engine use them for rooms < 2.5. Open: find the CBS table and its format (believed city-level
   for big cities only, district-level elsewhere), how often it updates, and how it lines up with the nadlan
   neighbourhood figures (likely city level only, medium confidence). Research the source first, as 0014a did.
3. Rest of the estimate, waiting for homie's own listings after launch: adjustments (size, floor, parking,
   furnishing, ממ״ד, balcony, condition, AC), averaging a street's several neighbourhoods, comparable listings (earns
   the "דירות דומות" wording), a learned model; each kept only if the backtest says it is better. The open estimate
   tab (possibly paid) and the seekers' "fair price" badge wait for Gilad.
4. Choose the next slice with Gilad after Slice 14: 11 Trust basics (report button, renewal, rate limits; renewal must
   clear the closure answer, see FOLLOWUPS 0014b), 12 Admin minimal, 13 Launch readiness (deploy, domain, SMS; read
   nadlan.gov.il's terms of use before `RENT_REFERENCE=nadlan` in production — until then the estimate shows nothing
   in production).
5. Pull the main checkout; commit or drop its uncommitted seed/promo work (ask Gilad).
6. Digests still owed to Gilad: Slice 9, 9c, 10.
7. FOLLOWUPS worth a sweep before launch: `make screens` failures (24 states red, not re-run on `main`), 0014a/b/c
   review minors (incl. 0014c's Hebrew "ב"+"ה" prefix and truncated source neighbourhood names), flaky e2e from PR #89,
   flaky `test_ac5_apply_racing_lister_like`, Slice 12 deploy items.
8. Housekeeping: Gilad to mark GitGuardian incident 40007526 a false positive; Gilad's open decisions in FOLLOWUPS
   (person-card score inference, re-apply after decline, 0010l invite expiry).

## Architecture
- `api/app/`: `main.py` (app factory, exact-origin CORS with credentials, DB/Redis errors → 503, 422 never echoes
  input), `auth.py` (`current_user` / `optional_user`, cookie `rent_session`), `models/` vs `schemas/` (never
  shared; `schemas/_text.py::visible_characters_only` is the one user-text rule), `matching/`, thin `routers/`,
  logic in `services/` (`search.py::_public_listings()` is the only definition of "public";
  `rent_reference.py` the official-figures import; `rent_estimate.py` the estimate engine + backtest), `worker.py`
  (geocoding; the monthly rent reference import, off by default).
- Migrations `api/alembic/versions/0001`–`0020`. Photos on Cloudflare R2 behind unguessable keys (0010d/j).
- `web/src/`: `app/` (routes, layout, side switch), `features/<domain>/`, `components/` (UI kit, 0009d),
  `locales/he.json`, generated `api/schema.d.ts` (`make client`, git-ignored). `web/e2e/` Playwright (CI only),
  `web/e2e/screens/` the mocked screenshot check (`make screens`; an unmocked request fails a state).
- `infra/docker-compose.yml`: db, redis, api, worker, web on `127.0.0.1`; ports via `DB_PORT`/`REDIS_PORT`/
  `API_PORT`/`WEB_PORT`; `COMPOSE_PROJECT_NAME` isolates a worktree's stack.
- CI: one `ci` job on the self-hosted Mac runner, only on PRs labelled `ready-to-merge`; docs-only PRs run nothing.

## Important Decisions
- Rent estimate (PRODUCT.md "Rent price estimate", Gilad 2026-11-14): a range with confidence and source, never one
  number, nothing at low confidence; official data + homie's own listings only, no scraping or paid data; the engine
  takes facts, not a listing id; built before Slice 11; v1 baseline only, 3+ rooms, backtest on official history.
  v1 copy says "average rent for N rooms in <area>", not "דירות דומות".

## Constraints
- Orchestrator never writes application code; agents never push to `main` (orchestrator docs commits excepted).
- Never `git stash` in a shared checkout; never start/stop another checkout's compose stack.
- e2e only in CI; merge only with `make merge PR=N`; at most 3 builds at once.
- When writing specs through the shell, `\uXXXX` escapes get decoded into real characters; check files for
  invisible characters afterwards.

## Known Issues
- Build sessions: a reviewer run as a background agent can die without reporting and leave the build session waiting
  (seen on 0014c); check `ps` for pytest/reviewer processes and tell the session to re-run the review in the
  foreground. Two agents running `make test` at once share the test DB and fail each other's tests.
- New worktree folders are not trusted workspaces: `start_session` with `cwd` there is refused; start the session in
  `/Users/giladmeidan/rent_app` and brief it to work in the worktree by absolute path.
- `/areas` blocks on a *hung* Postgres via pooled connections; why `GET /areas` is slow on CI runners is unconfirmed
  (ac9 in `applications.spec.ts` carries `test.slow()`).
- A resumed listing past `expires_at` returns `status: "active"` (the web shows it expired); unlimited paused listings.
- Join, leave and remove publish no chat event; open threads refresh members on window focus only.
- GitGuardian incident 40007526 (fake fixture token) flags every PR that merges `main`; merge on green `ci` anyway.
- No GitHub branch protection on this plan. Docker Desktop does not auto-start after a reboot (`open -a Docker`).
- Design artboards in `design/screens-v1/` reference a missing `support.js`.

## Environment & Commands
Prereqs: Docker Desktop, `uv`, Python 3.12, Node 22 (`nvm use 22`; the shell default v20 crashes vitest, so prefix
`PATH=/Users/giladmeidan/.nvm/versions/node/v22.23.2/bin:$PATH`) + `pnpm`, `gh` logged in.
Commands: see `CLAUDE.md` → Commands and the `##` comments in the `Makefile` (incl. `make rent-import`,
`make rent-backtest`).

A worktree gets its own `.env` with `COMPOSE_PROJECT_NAME=rent-app-NNNN` and unique ports (used so far: DB 5480–5530,
Redis 6430–6480, API 8050–8100, web 5191–5240: start above those). The main checkout's stack runs on 5434/6380/8000
with no `.env`, so pass `DB_PORT=5434 REDIS_PORT=6380` to `make migrate` there. Web at http://localhost:$WEB_PORT
(must be `localhost` for CORS). Local login code: newest `.outbox/*.json`.
