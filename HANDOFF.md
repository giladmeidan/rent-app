# Project Handoff

## Project Overview
homie / הומי: a Hebrew-first, RTL rental marketplace for Gush Dan — apartments (owners ↔ seekers) and the
roommate market "שוק השותפים". FastAPI + SQLAlchemy 2.0 + PostgreSQL/PostGIS + Redis + arq worker; React 18 +
TypeScript + Vite + Tailwind + TanStack Query + i18next + react-router 7. Repo: https://github.com/giladmeidan/rent-app
(private).

Process: read `CLAUDE.md` first (Speed rules 1–11, hard rules). The main session is the orchestrator; each spec is
built by its own session in its own worktree via `/build NNNN`. Product decisions: `specs/PRODUCT.md`. Open minors
and pending decisions: `specs/FOLLOWUPS.md`. Done specs (with digests): `specs/archive/`. History: `git log`.
A session started in `/Users/giladmeidan/rent_app` (one folder up) does not register the project agents; run them
as `general-purpose` agents told to read their definition file first.

## Current Status
Overall: MVP feature work done through Slice 10; Slice 14 (rent estimate) done through `0014d`; **Slice 11 (Trust
basics) four of five specs merged, paused by Gilad on 2026-11-15** ("the next specs will be finished later").

- Slice 11 merged (all archived with digests): `0011a` listing renewal (PR #93), `0011b` report a listing or a person
  (PR #94, `reports` table, migration `0022_reports`), `0011c` rate limits + request hardening (PR #95), `0011e`
  listing views off the request path (PR #96, Redis + worker flush).
- **Left in Slice 11: `0011d`** (report buttons in chat, the owner's inbox and a room's people page; web only,
  `depends_on: [0011b]` which is merged, so it branches from `main`). Status `verified`, never started; no worktree.
- Slice 14: `0014d` small-flat estimate merged (PR #92, migration `0021_cbs_rent_ratios`), built by a separate chat.
- Alembic head `0022`. No open PRs, no spec worktrees, no spec stacks. Merging is delegated to the orchestrator for
  Slices 11 and 14 (ask again for Slice 12+).
- Main checkout `../rent-app` is on `main`, **88 commits behind `origin/main`**, with uncommitted `Makefile` and
  `.gitignore` edits and untracked seed/promo work (`api/scripts/seed_demo.py`, `seed_promo.py`, `promo/`,
  `promo-video/`, `web/e2e/promo/`); its own compose stack (`rent-app`, 5 containers) is running. A `git pull` there
  also rebuilds the graph, which is stale (pre-Slice 14).
- `../rent-app-orch` is the docs worktree (detached on `origin/main` between uses).

Last updated: 2026-11-15 (Slice 11 paused after 0011a/b/c/e merged).

## Next Steps
1. **Finish Slice 11 when Gilad says so: build `0011d`.** Make worktree `../rent-app-0011d` from `origin/main` with
   its own `.env` (next free ports below), pre-start its build session in a turn Gilad wrote (it waits for "go").
2. Then choose the next slice with Gilad: 12 Admin minimal (first admin surface: lists the `reports` rows, raises the
   listing cap, shows rent-import failures — see FOLLOWUPS 0014a/0002b), 13 Launch readiness (deploy, one registrable
   domain, SMS, real client IPs → OTP lockout per email + network, Gilad 2026-11-14 Q1 (a); read nadlan.gov.il's terms
   before `RENT_REFERENCE=nadlan` in production).
3. Rest of the rent estimate waits for homie's own listings after launch (adjustments, comparables, learned model;
   each kept only if the backtest says it is better). The open estimate tab and the seekers' "fair price" badge wait
   for Gilad.
4. Pull the main checkout; commit or drop its uncommitted seed/promo work (ask Gilad).
5. Digests still owed to Gilad: Slice 9, 9c, 10. Slice 11's digests are in each archived spec.
6. FOLLOWUPS worth a sweep before launch: `make screens` failures (~20 states red), the Slice 11 review minors (view
   keys growing with real IPs, worker INFO logs hidden, Redis-down wait on the listing GET), flaky e2e (people /
   people-market tests failed under Mac load on PR #94, green on the next run), Slice 13 deploy items.
7. Housekeeping: Gilad to mark GitGuardian incident 40007526 a false positive; Gilad's open decisions in FOLLOWUPS
   (person-card score inference, re-apply after decline, 0010l invite expiry).

## Architecture
- `api/app/`: `main.py` (app factory, exact-origin CORS with credentials, DB/Redis errors → 503, 422 never echoes
  input and lists at most 50 entries, 64 KB body cap → 413 except the two photo uploads), `auth.py` (`current_user` /
  `optional_user`, cookie `rent_session`), `limits.py` (per-account rate-limit buckets over
  `services/rate_limit.py::count_or_raise`; `api/tests/test_hardening.py` AC1 fails for any write route in neither
  `LIMITED` nor `OWN`, so a new write route must join one), `models/` vs `schemas/` (never shared;
  `schemas/_text.py::visible_characters_only` is the one user-text rule), `matching/`, thin `routers/`, logic in
  `services/` (`search.py::_public_listings()` is the only definition of "public"; `rent_reference.py` the official
  import; `rent_estimate.py` the engine + backtest; reports in `reports.py`), `worker.py` (geocoding, the monthly
  rent import (off by default), the per-minute listing-view flush).
- Migrations `api/alembic/versions/0001`–`0022`. Photos on Cloudflare R2 behind unguessable keys (0010d/j).
- `web/src/`: `app/` (routes, layout, side switch), `features/<domain>/`, `components/` (UI kit, 0009d; shared
  `ReportDialog` / `ReportButton` from 0011b), `locales/he.json`, generated `api/schema.d.ts` (`make client`,
  git-ignored). `web/e2e/` Playwright (CI only), `web/e2e/screens/` the mocked screenshot check (`make screens`).
- `infra/docker-compose.yml`: db, redis, api, worker, web on `127.0.0.1`; ports via `DB_PORT`/`REDIS_PORT`/
  `API_PORT`/`WEB_PORT`; `COMPOSE_PROJECT_NAME` isolates a worktree's stack.
- CI: one `ci` job on the self-hosted Mac runner, only on PRs labelled `ready-to-merge`; docs-only PRs run nothing.
  The runner takes one PR at a time.

## Important Decisions
- Trust (PRODUCT.md "Trust (MVP)", Gilad 2026-11-14): reports are stored only until Slice 12's admin lists them
  (nothing auto-hidden, no email, the reported user never learns); renewal from 7 days before expiry and any time
  after, 90 days from the renewal, live again within the cap of 3, closure answer cleared; the deposit warning is the
  existing 0005b line at the top of every chat, left as it is; OTP lockout unchanged until Slice 13; at most 5
  listings created an hour and 10 a day.
- Rent estimate (PRODUCT.md "Rent price estimate"): a range with confidence and source, never one number, nothing at
  low confidence; official data + homie's own listings only; the engine takes facts, not a listing id.

## Constraints
- Orchestrator never writes application code; agents never push to `main` (orchestrator docs commits excepted).
- Never `git stash` in a shared checkout; never start/stop another checkout's compose stack.
- e2e only in CI; merge only with `make merge PR=N`; at most 3 builds at once; no docs push to `main` while a PR
  waits on CI (it falls behind; hand a spec to a build on a `docs/…` branch instead).
- When writing specs through the shell, `\uXXXX` escapes get decoded into real characters; check files for
  invisible characters afterwards.

## Known Issues
- Build sessions: a reviewer run as a background agent can die without reporting (seen on 0014c, and on 0011e when
  the app restarted) and leave the build session waiting; check `ps` and tell the session to re-run that review.
  Two agents running `make test` at once share the test DB and fail each other's tests.
- A build session's `git push` / `gh pr create` can be blocked by its permission check until Gilad allows it there
  (seen on 0011b); never push for it from the orchestrator.
- New worktree folders are not trusted workspaces: start build sessions in `/Users/giladmeidan/rent_app` and brief
  them to work in the worktree by absolute path.
- Adding the `ready-to-merge` label at PR creation starts two `ci` runs; one is cancelled at once. Watchers must skip
  cancelled runs and match the PR's head sha.
- `/areas` blocks on a *hung* Postgres via pooled connections; why `GET /areas` is slow on CI runners is unconfirmed.
- Join, leave and remove publish no chat event; open threads refresh members on window focus only.
- GitGuardian incident 40007526 (fake fixture token) flags every PR that merges `main`; merge on green `ci` anyway.
- No GitHub branch protection on this plan. Docker Desktop does not auto-start after a reboot (`open -a Docker`).
- Design artboards in `design/screens-v1/` reference a missing `support.js`.

## Environment & Commands
Prereqs: Docker Desktop, `uv`, Python 3.12, Node 22 (`nvm use 22`; the shell default v20 crashes vitest, so prefix
`PATH=/Users/giladmeidan/.nvm/versions/node/v22.23.2/bin:$PATH`) + `pnpm`, `gh` logged in.
Commands: see `CLAUDE.md` → Commands and the `##` comments in the `Makefile` (incl. `make rent-import`,
`make rent-backtest`).

A worktree gets its own `.env` with `COMPOSE_PROJECT_NAME=rent-app-NNNN` and unique ports (used so far: DB 5480–5535,
Redis 6430–6485, API 8050–8105, web 5191–5245: start above those). The main checkout's stack runs on 5434/6380/8000
with no `.env`, so pass `DB_PORT=5434 REDIS_PORT=6380` to `make migrate` there. Web at http://localhost:$WEB_PORT
(must be `localhost` for CORS). Local login code: newest `.outbox/*.json`.
