# Project Handoff

## Project Overview
Rent App: a Hebrew-first, RTL, two-sided rental marketplace for Gush Dan (owners ↔ seekers, plus
roommate flows). Stack per `specs/PRODUCT.md`: FastAPI + SQLAlchemy 2.0 + PostgreSQL/PostGIS +
Redis + arq worker on the API side; React 18 + TypeScript + Vite + Tailwind on the web side;
docker compose for local dev; GitHub Actions CI. Repo: https://github.com/giladmeidan/rent-app (private).

Development runs through an agent process defined in `CLAUDE.md` (read its **Speed rules** first):
the main session is the **orchestrator** (keeps the queue, writes specs, never writes app code);
each spec is built by its own session in its own worktree via `/build NNNN`, with subagents
`coder` and reviewers `code / qa / security / perf / ux` from `.claude/agents/`.
Specs live in `specs/NNNN-slug.md`; the frontmatter `status` is the source of truth.
Note: when a session starts one folder above the repo (`/Users/giladmeidan/rent_app`), the project
agents are not registered; run them as `general-purpose` agents told to read their definition file first.

## Current Status
Overall: IN_PROGRESS

Current focus:
Slice 0 (0000a, 0000b) and the API half of Slice 1 (0001a) are merged. Next build: 0001b (Auth web),
already `verified`. Nothing is in flight; no open PRs, no worktrees.

Last updated:
2026-11-10

## Current Work
None in progress. `main` = f5af4f3 plus docs commits.

## Completed
- [x] Agent kit, spec 0000 split into 0000a/0000b, design artboards `design/screens-v1/`.
- [x] 0000a Foundations API — merged b00db8a (PR #1, 2026-11-09).
- [x] 0001a Auth API — merged 87a8e64 (PR #2, 2026-11-10), 88 api tests.
- [x] 0000b Foundations web — merged f5af4f3 (PR #3, 2026-11-10); CI api 52 s · web 38 s · e2e 2 min 06 s.
- [x] Speed rules 1–8 in `CLAUDE.md` (2026-11-10), CI tiering live in `.github/workflows/ci.yml`.

## Next Steps
1. Build 0001b (`specs/0001b-auth-web.md`, verified) per Speed rules: own session, worktree
   `../rent-app-0001b`, branch `spec/0001b-auth-web`, own `.env` (`COMPOSE_PROJECT_NAME=rent-app-0001b`,
   e.g. `DB_PORT=5435 REDIS_PORT=6381 API_PORT=8002`). Reviewers code, qa, ux, security — one round.
   Its Playwright AC7 reads codes from `.outbox/*.json`. Check the spec against the web shell as merged
   (QueryClient `retry: 1`, tokens in `web/tailwind.config.ts`, i18n-check fails Hebrew in any attribute).
2. In parallel: `/spec` Slice 2 (Owner posts listing) — artboard `design/screens-v1/CreateListing.dc.html`.
3. The shared local stack (`rent-app`, ports 5434/6380/8000) still runs pre-merge containers: run
   `make dev` in the main checkout (with `DB_PORT=5434 REDIS_PORT=6380` — there is no `.env` there) to
   migrate to 0002 and start the web service.
4. Flip GitHub branch protection to require `api`, `web`, `e2e`.
5. Product-name mismatch for Gilad: artboards say "דירתי", app says "דירה" (PRODUCT.md, until Slice 9).

## Architecture
- `api/app/`: `main.py` (app factory, exact-origin CORS with credentials, DB/Redis errors → JSON 503),
  `config.py` (pydantic-settings, SecretStr DSNs, WEB_ORIGIN validator), `db.py`, `auth.py`
  (`current_user`/`optional_user`, cookie `rent_session`), `redis_client.py`, `models/` vs `schemas/`
  (never shared), `services/` (`auth.py` OTP in Redis with HMAC + Lua scripts, sessions table;
  `email.py` file outbox in dev / SMTP; `sms.py` stub), `routers/` (thin), `i18n/he.py`, `worker.py`.
- `api/alembic/`: migrations `0001_areas`, `0002_users_sessions`.
- `web/`: Vite + React 18 + TS strict + Tailwind 3.4 (logical props only), TanStack Query, i18next
  (`src/locales/he.json`), `openapi-fetch` client over generated `src/api/schema.d.ts` (git-ignored,
  `make client`), `scripts/i18n-check.mjs` (AST-based), `e2e/` Playwright, `vite-plugin-pwa`.
  One screen: `src/app/App.tsx` → `src/features/areas/AreasList.tsx`; no router yet.
- `infra/docker-compose.yml`: db, redis, api, worker, web; ports on `127.0.0.1`, overridable via
  `DB_PORT`/`REDIS_PORT`/`API_PORT`; `COMPOSE_PROJECT_NAME` in a worktree's `.env` gives an isolated stack.
- `Makefile`: loads optional repo-root `.env`; `dev`, `down`, `migrate`, `seed`, `test` (`test-api`,
  `test-web`), `lint` (`lint-api`, `lint-web`), `client`, `i18n-check`, `build-web`, `e2e`.
- CI: `api` and `web` on every PR push; `e2e` only with the `ready-to-merge` label and on `main`;
  docs-only PRs/pushes run nothing.

## Important Files
- `CLAUDE.md` — process, Speed rules, hard rules. Read first.
- `specs/PRODUCT.md` — standing decisions.
- `specs/0001b-auth-web.md` — next build. `specs/FOLLOWUPS.md` — 0000a, 0001a and 0000b items.
- `design/README.md` + `design/screens-v1/*.dc.html` — artboards (reference a missing `support.js`).
- `PR-0000a.md`, `PR-0001a.md`, `REVIEW-*.md` — old-process records; no new ones are written.

## Important Decisions
- Roles: every account picks **owner** or **seeker** at signup, switchable later; broker is an
  `account_type`. Signup collects email + display name only (PRODUCT.md, 2026-11-09).
- OTP caps: 3 codes/15 min and 10/day per email, 10/15 min per IP, 5 guesses per code. Email: file
  outbox in dev, plain SMTP in prod. Existing-email signup logs in (200).
- Cookie `SameSite=Lax` + exact-origin CORS is the CSRF posture; needs one registrable domain in prod.
- Web: product name "דירה" placeholder and system font until Slice 9; design tokens from the artboards.
- Tooling `uv` / `pnpm` (Node 22, `web/.nvmrc`); TypeScript 5.9 (typescript-eslint / openapi-typescript limit).
- 2026-11-10: Gilad had the orchestrator merge PR #2 and PR #3 after green CI, as a one-off.

## Constraints
- Speed rules in `CLAUDE.md` (session per spec, parallel worktrees, one review round, minors to
  follow-ups, no PR/REVIEW files, model per task, push once per round, light CI on push).
- One verifier round per spec. Refresh this handoff only at the end of a spec or after a big slice rewrite.
- Orchestrator never writes application code; Gilad merges unless he says otherwise; agents never push to `main`
  (orchestrator docs commits excepted).
- Never `git stash` in a shared checkout; never start/stop another checkout's compose stack.

## Known Issues
- Shared local stack is stale (see Next Steps 3).
- `/areas` blocks on a *hung* Postgres via pooled connections (FOLLOWUPS).
- Design artboards reference a missing `design/screens-v1/support.js`.
- Starlette/httpx deprecation warning in TestClient.
- `make dev` on Linux with the 0777 `.outbox` bind mount is verified only in CI's e2e job.
- GitGuardian's check was still pending when PR #3 was merged (it passed on every earlier commit).

## Environment & Commands
Prereqs: Docker Desktop, `uv`, Python 3.12, Node 22 (`nvm use 22`) + `pnpm`, `gh` logged in.

    make dev        # db+redis → migrate → seed → api+worker+web → waits on /health and :5173
    make down       # compose down -v, empties .outbox/
    make test       # pytest + vitest      make lint   # ruff, mypy --strict, eslint, prettier, tsc
    make client     # regenerate web/src/api/schema.d.ts
    make i18n-check # hardcoded copy / missing keys
    make build-web  # vite build           make e2e    # playwright smoke against the stack

Env var names: see `.env.example`. Web at http://localhost:5173 (must be `localhost` — CORS), API at
http://127.0.0.1:8000. Login locally: the code is in the newest `.outbox/*.json`.

## Session History
- 2026-11-10 — 0000b built, reviewed once, fixed, rebased; PR #2 and PR #3 merged by the orchestrator
  on Gilad's instruction; Speed rules 1–8 adopted; CI tiered.
- 2026-11-09 — 0000a merged; Slice 1 specced; 0001a built and reviewed.
- 2026-11-08 — Repo initialised from the agent kit; spec 0000 written, split and verified.
