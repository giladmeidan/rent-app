# Project Handoff

## Project Overview
Rent App: a Hebrew-first, RTL, two-sided rental marketplace for Gush Dan (owners ↔ seekers, plus
roommate flows). Stack per `specs/PRODUCT.md`: FastAPI + SQLAlchemy 2.0 + PostgreSQL/PostGIS +
Redis + arq worker on the API side; React 18 + TypeScript + Vite + Tailwind + TanStack Query + i18next +
openapi-fetch + react-router 7 (library mode) on the web side; docker compose for local dev; GitHub Actions
CI. Repo: https://github.com/giladmeidan/rent-app (private).

Development runs through an agent process defined in `CLAUDE.md` (read its **Speed rules 1–10** first):
the main session is the **orchestrator** (keeps the queue, writes specs, never writes app code);
each spec is built by its own session in its own worktree via `/build NNNN`, with subagents
`coder` and reviewers `code / qa / security / perf / ux` from `.claude/agents/`.
Specs live in `specs/NNNN-slug.md`; the frontmatter `status` is the source of truth.
Note: when a session starts one folder above the repo (`/Users/giladmeidan/rent_app`), the project
agents are not registered; run them as `general-purpose` agents told to read their definition file first.
The Claude desktop app refuses to start a session from an automated-event turn; the orchestrator then asks
Gilad with a button (proposal cards cannot carry a worktree path).

## Current Status
Overall: IN_PROGRESS

Current focus:
Slice 1 (auth) is fully merged. Slice 2 (Owner posts listing) is in flight: 0002a (API) is open as PR #5
in its review round; 0002b (web) is verified with its worktree prepared, not yet started.

Last updated:
2026-11-10

## Current Work
- **0002a Listings API** — PR #5 (`spec/0002a-listings-api`, head a20d61a), built by its own session in
  `../rent-app-0002a` (stack `rent-app-0002a`, ports 5436/6382/8003, still up). Review round in progress:
  qa 0 blockers / 1 major (pre-existing global 500 on non-finite JSON numbers such as `1e999999`, reachable on
  the new endpoints) / 2 minors; code 0/0/2 one-line minors; security digest pending. Then one fix round,
  push, `ready-to-merge` label, digest, `make down`. Not merged.
- **0002b Listings web** — `specs/0002b-listings-web.md` is `verified`. Worktree `../rent-app-0002b` on branch
  `spec/0002b-listings-web` = main 23ade7a merged with `origin/spec/0002a-listings-api` a20d61a (so the
  listings API, migration `0003_listings` and 0001b's web code are all present); its `.env` is written
  (`COMPOSE_PROJECT_NAME=rent-app-0002b`, `DB_PORT=5437`, `REDIS_PORT=6383`, `API_PORT=8004`). Port 5173 is
  free (no other web spec is building). **Gilad builds it in a separate session** (see Next Steps 1).

## Completed
- [x] Agent kit, spec 0000 split into 0000a/0000b, design artboards `design/screens-v1/`.
- [x] 0000a Foundations API — merged b00db8a (PR #1, 2026-11-09).
- [x] 0001a Auth API — merged 87a8e64 (PR #2, 2026-11-10), 88 api tests.
- [x] 0000b Foundations web — merged f5af4f3 (PR #3, 2026-11-10).
- [x] 0001b Auth web — merged 2352515 (PR #4, 2026-11-10): /login, /signup, header AuthMenu, useMe,
  Layout, routes; react-router 7.18.5 (two 6.x advisories); +9 unit, +1 e2e. Worktree and stack removed.
- [x] Specs 0002a + 0002b written, one verifier round each (8 and 12 findings applied), digests filled
  (2e7bfbc, 97bc575).
- [x] Speed rules 9 (consult Gilad on high-value calls) and 10 (tear down stack + worktree when done) added;
  rule 2 now says build every ready spec in parallel (b4583e0, 2b6d165, 23ade7a).

## Next Steps
1. **Build 0002b** in its own session: open `/Users/giladmeidan/rent_app/rent-app-0002b` and run `/build 0002b`.
   Brief for that session: branch already contains 0002a's code; open the PR against `main`; when PR #5
   merges, rebase onto `main` before adding `ready-to-merge`; run `make client` against its own stack so
   `schema.d.ts` has the three listings paths; reviewers `code, qa, ux` (coder Opus/high, code Opus/medium,
   qa+ux Sonnet/medium); Speed rules 9 and 10 apply; e2e AC9 reads codes from `.outbox/*.json` like 0001b.
2. When the 0002a session reports: verify PR #5 is green on its head (`gh pr checks 5`), Gilad merges, then
   mark `specs/0002a-listings-api.md` `done` with the merge sha (orchestrator docs commit), run
   `git worktree remove ../rent-app-0002a && git branch -d spec/0002a-listings-api` (Speed rule 10), and
   tell the 0002b session to rebase. Relay the 0002a digest's five product assumptions to Gilad (field list,
   no drafts, 30-day expiry at create, rooms share apartment fields, cap counts live listings only); write
   his answers into `specs/PRODUCT.md`.
3. `/spec` Slice 3 (Seeker search) while Slice 2 builds: `0003a` search API (must exclude
   `listing_type='room'` until Slice 7 adds the gender field — see 0002a Risks), `0003b` search web
   (artboards `Search.dc.html`, `SearchDesktop.dc.html`, `Listing.dc.html`). Public `GET /listings/{id}`
   belongs here.
4. Later listings specs to queue: `0002c` photos (uploads, R2 — needs Gilad's OK on R2 free tier), edit
   listing fields in the web (API already supports PATCH), `GET /me` exposing `listing_cap`.
5. Flip GitHub branch protection to require `api`, `web`, `e2e`. Delete merged remote branches
   (`spec/0000a-…`, `spec/0001b-…`) if a tidy remote matters.
6. Product-name mismatch for Gilad: artboards say "דירתי", app says "דירה" (PRODUCT.md, until Slice 9).

## Architecture
- `api/app/`: `main.py` (app factory, exact-origin CORS with credentials, DB/Redis errors → JSON 503),
  `config.py` (pydantic-settings, SecretStr DSNs), `db.py`, `auth.py` (`current_user`/`optional_user`,
  cookie `rent_session`; 0002a adds `current_owner`), `redis_client.py`, `models/` vs `schemas/` (never
  shared), `services/` (`auth.py` OTP in Redis + sessions table; `email.py` file outbox / SMTP; `sms.py`
  stub; 0002a adds `listings.py`), `routers/` (thin), `i18n/he.py`, `worker.py`.
- `api/alembic/`: `0001_areas`, `0002_users_sessions` on main; `0003_listings` on PR #5.
- `web/`: Vite + React 18 + TS strict + Tailwind 3.4 (logical props only), TanStack Query (`retry: 1`
  default), i18next (`src/locales/he.json`), `openapi-fetch` client with `credentials: 'include'` over
  generated `src/api/schema.d.ts` (git-ignored, `make client`), react-router 7 library mode
  (`src/app/routes.tsx`, `Layout.tsx`), `features/areas`, `features/auth` (`useMe`, `AuthMenu`, `OtpForm`,
  `RoleChoice`, pages), `components/` (`Skeleton`, `EmptyState`, `ErrorState`), `scripts/i18n-check.mjs`
  (fails Hebrew in any JSX attribute), `e2e/` Playwright (`smoke.spec.ts`, `auth.spec.ts`), `vite-plugin-pwa`.
- `infra/docker-compose.yml`: db, redis, api, worker, web; ports on `127.0.0.1`, overridable via
  `DB_PORT`/`REDIS_PORT`/`API_PORT`; **web is always 5173** (exact-origin CORS), so only one web spec
  stack runs at a time; `COMPOSE_PROJECT_NAME` in a worktree's `.env` isolates the rest.
- `Makefile`: loads optional repo-root `.env`; `dev`, `down`, `migrate`, `seed`, `test` (`test-api`,
  `test-web`), `lint` (`lint-api`, `lint-web`), `client`, `i18n-check`, `build-web`, `e2e`.
- CI: `api` and `web` on every PR push; `e2e` only with the `ready-to-merge` label and on `main`;
  docs-only PRs/pushes run nothing.

## Important Files
- `CLAUDE.md` — process, Speed rules 1–10, hard rules. Read first.
- `specs/PRODUCT.md` — standing decisions. `specs/FOLLOWUPS.md` — 23 open deferred minors.
- `specs/0002a-listings-api.md` (in review on PR #5), `specs/0002b-listings-web.md` (next build).
- `design/README.md` + `design/screens-v1/*.dc.html` — artboards (reference a missing `support.js`).
- `PR-0000a.md`, `PR-0001a.md`, `REVIEW-*.md` — old-process records; no new ones are written.

## Important Decisions
- Roles: every account picks **owner** or **seeker** at signup, switchable later; broker is an
  `account_type`. Signup collects email + display name only (PRODUCT.md, 2026-11-09).
- OTP caps: 3 codes/15 min and 10/day per email, 10/15 min per IP, 5 guesses per code. Email: file
  outbox in dev, plain SMTP in prod. Existing-email signup logs in (200).
- Cookie `SameSite=Lax` + exact-origin CORS is the CSRF posture; needs one registrable domain in prod.
- Web: product name "דירה" placeholder and system font until Slice 9; design tokens from the artboards.
- react-router 7.18.5 in library mode replaced react-router-dom 6.x (two 6.x advisories, 2026-11-10);
  FOLLOWUPS carries the rule for user-controlled navigation targets.
- Listings (0002a, orchestrator assumptions pending Gilad's batch approval): live on create (no drafts),
  `expires_at = create + 30 d`, cap counts live listings only, room listings share apartment fields, money
  and sizes are integers, text enums with named CHECKs, 404 (not 403) for another owner's listing.
- Tooling `uv` / `pnpm` (Node 22, `web/.nvmrc`); TypeScript 5.9.
- Gilad merges PRs; on 2026-11-10 he had the orchestrator merge PR #2, #3 and #4 after green CI.

## Constraints
- Speed rules 1–10 in `CLAUDE.md`: session per spec, every ready spec builds in parallel (only
  `depends_on` serialises; two web specs not at once locally), one review round, minors to follow-ups, no
  PR/REVIEW files, model per task, push once per round, light CI on push, **high-value calls go to Gilad
  with options (rule 9)**, **`make down` + worktree removal when a spec is done (rule 10)**.
- One verifier round per spec; the orchestrator applies findings and sets `verified`.
- Refresh this handoff only at the end of a spec, on Gilad's request, or after a big slice rewrite.
- Orchestrator never writes application code; agents never push to `main` (orchestrator docs commits
  excepted). Never `git stash` in a shared checkout; never start/stop another checkout's compose stack
  (except the rule-10 teardown after merge).

## Known Issues
- Pre-existing global 500 on non-finite JSON numbers (`1e999999`) — found by 0002a qa; being fixed in
  PR #5's fix round.
- `/areas` blocks on a *hung* Postgres via pooled connections (FOLLOWUPS).
- `/` has no `<h1>` since the brand became a link (Slice 9 landing adds one).
- Input border / error colours are arbitrary values, not tokens (0001b follow-up).
- Design artboards reference a missing `design/screens-v1/support.js`.
- Starlette/httpx deprecation warning in TestClient.
- The shared `rent-app` stack (5434/6380/8000) runs the merged code but its **web container is stopped**
  (port 5173 is reserved for the building web spec); `make dev` in the main checkout restarts it when no
  spec needs 5173.

## Environment & Commands
Prereqs: Docker Desktop, `uv`, Python 3.12, Node 22 (`nvm use 22`) + `pnpm`, `gh` logged in.

    make dev        # db+redis → migrate → seed → api+worker+web → waits on /health and :5173
    make down       # compose down -v, empties .outbox/
    make test       # pytest + vitest      make lint   # ruff, mypy --strict, eslint, prettier, tsc
    make client     # regenerate web/src/api/schema.d.ts
    make i18n-check # hardcoded copy / missing keys
    make build-web  # vite build           make e2e    # playwright smoke against the stack

Env var names: see `.env.example`. A worktree gets its own `.env` with `COMPOSE_PROJECT_NAME=rent-app-NNNN`
and unique `DB_PORT`/`REDIS_PORT`/`API_PORT` (in use: 0002a 5436/6382/8003, 0002b 5437/6383/8004). Web at
http://localhost:5173 (must be `localhost` — CORS), shared API at http://127.0.0.1:8000. Login locally: the
code is in the newest `.outbox/*.json`.

## Session History
- 2026-11-10 (evening) — 0001b built in its own session, merged (PR #4); 0002a/0002b specced and verified;
  0002a build started (PR #5, in review); 0002b worktree prepared; Speed rules 2 (parallel), 9 (consult
  Gilad), 10 (teardown) added; 0001b stack and worktree removed; shared stack refreshed to 0002.
- 2026-11-10 — 0000b built, reviewed once, fixed, rebased; PR #2 and PR #3 merged by the orchestrator
  on Gilad's instruction; Speed rules 1–8 adopted; CI tiered.
- 2026-11-09 — 0000a merged; Slice 1 specced; 0001a built and reviewed.
- 2026-11-08 — Repo initialised from the agent kit; spec 0000 written, split and verified.
