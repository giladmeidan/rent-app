# Project Handoff

## Project Overview
Rent App: a Hebrew-first, RTL, two-sided rental marketplace for Gush Dan (owners ↔ seekers, plus
roommate flows). Stack per `specs/PRODUCT.md`: FastAPI + SQLAlchemy 2.0 + PostgreSQL/PostGIS +
Redis + arq worker on the API side; React 18 + TypeScript + Vite + Tailwind on the web side;
docker compose for local dev; GitHub Actions CI.

Development runs through an agent process defined in `CLAUDE.md`: the main Claude Code session is
the **orchestrator** (writes specs, delegates, never writes app code), with subagents
`spec-verifier`, `coder`, and reviewers `code / qa / security / perf / ux` in `.claude/agents/`.
Work is sliced into specs in `specs/NNNN-slug.md`; the frontmatter `status` is the source of truth.

## Current Status
Overall: IN_PROGRESS

Current focus:
Spec 0000a merged to main (b00db8a). Spec 0000b (Foundations: web shell) verified and next to build.

Last updated:
2026-11-09

## Current Work
Nothing in flight. 0000b (web shell) is the next build; see Next Steps.

## Completed
- [x] Agent kit committed on `main` (CLAUDE.md, specs template, agents, commands).
- [x] Spec 0000 written, split by the verifier into 0000a (api) and 0000b (web); both `verified`,
      digests appended, committed on `main`.
- [x] 0000a implemented, three review rounds, merged to main as b00db8a via PR giladmeidan/rent-app#1 (2026-11-09). CI api job 51 s.
- [x] Design artboards under `design/screens-v1/` committed on main (f5d2912) with the matching
      `CLAUDE.md` → "## Design", UX reviewer and template edits.
- [x] GitHub remote: https://github.com/giladmeidan/rent-app (private). CI runs on PRs and main.

## Next Steps
1. Update 0000b's UI section to reference `design/screens-v1/Main.dc.html` for shell structure and
   tokens (it says "no Design artboard exists"), and note: CORS allows exactly `WEB_ORIGIN`
   (`http://localhost:5173`, not `127.0.0.1`); api binds `127.0.0.1` so a Vite proxy must target IPv4;
   `make client` must supply env vars to `export_openapi.py`; `API_PORT` exists.
2. `/build 0000b`: coder → reviewers (code, qa, ux) once → coder fixes → orchestrator brief check →
   digest → PR → Gilad merges (the orchestrator cannot run `gh pr merge` or `gh repo create` without
   Gilad's explicit yes in chat; the permission classifier blocks them otherwise).
3. Then `/spec` for Slice 1 (Auth + roles). Note: another session may have already written 0001a/0001b
   specs — check `ls specs/` first.
4. Flip GitHub branch protection to require the `api` (and later `web`, `e2e`) checks.

## Architecture
- `api/app/`: `main.py` (app factory, CORS exact-origin, global OperationalError → JSON 503),
  `config.py` (pydantic-settings; `DatabaseSettings` subset so alembic/seed need only
  `DATABASE_URL`; SecretStr DSNs; WEB_ORIGIN validator), `db.py` (`make_engine` with
  `connect_timeout=2`, `tcp_user_timeout`, `hide_parameters`), `models/` (ORM) vs `schemas/`
  (Pydantic, never shared), `services/` (logic), `routers/` (thin), `worker.py` (arq, `ping`).
- `api/alembic/`: env uses `Base.metadata`, sets `search_path=public` so autogenerate ignores
  PostGIS topology/tiger tables. Migration `0001_areas`.
- `infra/docker-compose.yml`: all published ports bound to `127.0.0.1`, overridable via
  `DB_PORT`/`REDIS_PORT`/`API_PORT`; `restart: unless-stopped` on api/worker; TCP healthchecks.
  `infra/Dockerfile.api`: uv base image, venv at `/opt/venv`, runs as uid 10001.
- `Makefile`: loads optional repo-root `.env` (precedence: `make VAR=` > shell > `.env` > defaults),
  passes `--env-file .env` to compose.
- Web (0000b, not built yet): Vite + React + TS strict + Tailwind 3.4 (logical properties only),
  TanStack Query, i18next with `web/src/locales/he.json`, `openapi-typescript` + `openapi-fetch`
  client generated from `export_openapi.py`, `web/scripts/i18n-check.mjs`, Playwright smoke.

## Important Files
- `CLAUDE.md` — process, hard rules, commands, conventions. Read first.
- `specs/PRODUCT.md` — standing product decisions and slice order.
- `specs/0000a-foundations-api.md`, `specs/0000b-foundations-web.md` — current specs.
- `specs/FOLLOWUPS.md` — deferred minors (4 from 0000a).
- `PR-0000a.md` — stand-in PR body (no GitHub remote yet) with per-round finding resolutions.
- `REVIEW-0000a-round1.md` — merged round-1 review digest (untracked; keep or delete after merge).
- `design/README.md` + `design/screens-v1/*.dc.html` — artboards for core screens; note they
  reference `./support.js` which is not present, so they do not render standalone.
- `.claude/agents/*.md`, `.claude/commands/*.md` — agent and slash-command definitions.

## Important Decisions
- Spec 0000 split into 0000a/0000b (verifier, 2026-11-08): infra+api+web exceeded one coder run.
- Tooling: `uv` for Python, `pnpm` for web (Gilad accepted as engineering choices).
- `/areas` response excludes geometry; Slice 3 adds a GeoJSON endpoint. Gush Dan stored as a
  coarse bounding box until Slice 3.
- Product name placeholder "דירה" and tagline in `he.json`; Slice 9 owns final branding.
- `redis` pinned 5.x because `arq==0.28` requires `redis<6`.
- `.env` is loaded (not ignored) — chosen in round 2 because local port collisions are real on
  Gilad's machine (5432, 5433, 6379 are taken; use `DB_PORT=5434 REDIS_PORT=6380`).

## Constraints
- Every subagent runs with `model: opus`, `effort: high` (Gilad, 2026-11-09).
- One full reviewer round per spec. After the coder's fix round the orchestrator checks briefly
  itself; reviewers are re-run only for a specific blocker/major (Gilad, 2026-11-09).
- After each spec's digest, run `create-handoff` to refresh this file (Gilad, 2026-11-09).
- Orchestrator never writes application code (`CLAUDE.md`). Gilad merges; agents never merge.
- All `CLAUDE.md` hard rules (i18n keys only, logical CSS only, Alembic downgrade, auth rule per
  endpoint, secrets via env, no undeclared dependencies, stop on product questions).

## Known Issues
- `/areas` still blocks indefinitely on a *hung* (paused, not unreachable) Postgres via pooled
  connections; `/health` is bounded. Needs an app-wide query timeout design (FOLLOWUPS).
- Design artboards reference a missing `design/screens-v1/support.js`.
- Starlette deprecation warning about httpx in TestClient (1 warning per test session).

## Environment & Commands
Prereqs: Docker Desktop, `uv`, Python 3.12, (for 0000b) Node 22 + `pnpm`.
On this machine always prefix: `DB_PORT=5434 REDIS_PORT=6380` (or put them in a repo-root `.env`).

    make dev        # compose up db+redis (wait) → migrate → seed → api+worker (+ wait on /health)
    make down       # compose down -v
    make test       # pytest (needs compose db up; uses TEST_DATABASE_URL, plus a _mig DB for AC4)
    make lint       # ruff check + ruff format --check + mypy --strict
    make migrate    # alembic upgrade head
    make seed       # idempotent Gush Dan seed
    # 0000b adds: make client, make e2e, make i18n-check

Required environment variables (names only; see `.env.example`): `DATABASE_URL`,
`TEST_DATABASE_URL`, `REDIS_URL`, `WEB_ORIGIN`, `DB_PORT`, `REDIS_PORT`, `API_PORT`.
API at http://127.0.0.1:8000 (`/health`, `/areas`, `/docs`).

## Session History
- 2026-11-09 — 0000a merged (PR #1, CI 51 s). GitHub repo created. Handoff refreshed.
- 2026-11-09 — 0000a built (coder), reviewed twice (code/qa/security), round-3 fixes launched.
  Gilad set: Opus/high for all agents; single reviewer round; handoff after each spec. Gilad added
  `design/screens-v1` artboards. This handoff created.
- 2026-11-08 — Repo initialised from the agent kit zip; spec 0000 written, split and verified.
