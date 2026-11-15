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
Overall: MVP feature work done through Slice 12 (Admin minimal); Slice 14 (rent estimate) done through `0014d`;
`0015a` (protected space) done. Next: Slice 13 (Launch readiness), not specced yet.

- **Slice 12 done** (archived with digests): `0012a` moderation data (PR #100: suspension, removed-by-homie
  listings, per-account cap from `GET /me`, `reports.resolved_at`, `admin_actions`, migration
  `0024_admin_moderation` with Gilad's partial index `ix_users_suspended`), `0012b` admin dashboard (PR #101:
  SQLAdmin app in `api/admin/`, `make admin` on `127.0.0.1:8001`). Gilad merged-by-delegation per PR ("You merge
  it") for both; Slice 13 merging not delegated yet.
- `0015a` listing protected space (PR #98, migration `0023_listing_shelter`, replaced `safe_room`) done.
- Alembic head `0024`. No open PRs. No spec stacks of ours.
- Main checkout `../rent-app` is on `main` = `origin/main` (pulled 2026-11-15), still with Gilad's uncommitted
  `Makefile` (`seed-demo`, `promo`, the `DESTROY_MAIN` guard on `make down`, merged by hand with 0012b's admin
  targets) and `.gitignore` edits and untracked seed/promo work. Its `.env` now holds `ADMIN_PASSWORD` and
  `ADMIN_SECRET_KEY`; its stack (`rent-app`) runs 6 containers including `admin`.
- `../rent-app-orch` is the docs worktree (detached on `origin/main` between uses).

Last updated: 2026-11-15 (Slice 12 merged; admin set up in the main checkout).

## Current Work
- **`0016a` landing polish** (`status: draft`) is being written by another chat in `../rent-app-0016a`
  (branch `spec/0016a-landing-polish`, uncommitted `specs/0016a-landing-polish.md`, `design/screens-v3/`,
  `design/README.md`, `specs/PRODUCT.md`). Not this orchestrator's; do not touch that worktree.
- Nothing else in flight.

## Next Steps
1. Spec Slice 13 Launch readiness with Gilad: deploy (Fly; the admin as a separate Fly app with no public
   services via `fly proxy`, FOLLOWUPS 0012b), one registrable domain, SMS, real client IPs → OTP lockout per
   email + network (Gilad 2026-11-14 Q1 (a)) and edge per-IP limits (FOLLOWUPS 0011c/0011e), terms of use (reported
   chats are readable and logged, FOLLOWUPS 0012b), read nadlan.gov.il's and CBS's terms before `RENT_REFERENCE=nadlan`
   / `CBS_RENT=cbs` in production. Ask Gilad whether merging is delegated for Slice 13.
2. Slice 13 security items from 0012b's review: server-side admin session nonce (copied cookie survives logout),
   per-session CSRF token for browsers without `Sec-Fetch-*`, a login lock that survives restarts.
3. In the main checkout: `GRAPHIFY_CLAUDE_CLI_MODEL=haiku graphify label . --backend=claude-cli` (post-slice step
   not yet run for Slice 12); ask Gilad to commit or drop his `Makefile` / `.gitignore` / seed / promo work.
4. Rest of the rent estimate waits for homie's own listings after launch. The open estimate tab and the seekers'
   "fair price" badge wait for Gilad.
5. Digests still owed to Gilad: Slice 9, 9c, 10.
6. FOLLOWUPS sweep before launch: `make screens` failures (~20 states red), Slice 11 review minors, 0012a/0012b
   minors (match-sort page 69–71 ms at 10k listings, `not_suspended` belongs in a neutral module, more admin test
   edges), flaky e2e (people / people-market under Mac load; `market ac18`).
7. Housekeeping: Gilad to mark GitGuardian incident 40007526 a false positive; Gilad's open decisions in FOLLOWUPS
   (person-card score inference, re-apply after decline, 0010l invite expiry).

## Admin dashboard (local)
`make admin` in the main checkout (needs `ADMIN_PASSWORD` 16+ and `ADMIN_SECRET_KEY` 32+ in `.env`; names only,
never write values here) → http://127.0.0.1:8001/admin, password only (username ignored). Wrong passwords lock the
login until the admin container restarts (`docker restart rent-app-admin-1`). Must be `127.0.0.1` (Host allowlist).

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
- `api/admin/`: the SQLAdmin dashboard (0012b), its own image, compose profile `admin` and Postgres role
  `homie_admin` (column-level grants, `scripts/admin_role.py`); `app/` never imports `admin`. Each action is one
  UPDATE plus one `admin_actions` row. The public app's reaction to suspension / removal lives in 0012a's
  `services/search.py::not_suspended` and friends.
- Migrations `api/alembic/versions/0001`–`0024`. Photos on Cloudflare R2 behind unguessable keys (0010d/j).
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
- Admin (PRODUCT.md "Admin (Slice 12)", Gilad 2026-11-15): a separate dashboard for Gilad only, built with SQLAdmin
  in `api/admin/` (own image and deploy; the public API cannot import it), English, no public address (local:
  compose on loopback; production: a Fly app with no public IP via `fly proxy`, Slice 13). Reported chats only are
  readable, each open logged; a suspended account is told "suspended", its listings/card/flatmate spots hidden, its
  sessions revoked (orchestrator's safer default), chats and applications stay; a removed listing reads "הוסרה על
  ידי הומי" to its owner and frees its cap slot.
- Protected space (PRODUCT.md, Gilad 2026-11-15, spec `0015a`): a listing states its protected space as a type, not
  yes/no.

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
- `../rent-app-orch` can be shared with another chat writing specs (seen 2026-11-15: its uncommitted Slice 12 /
  `0015a` drafts went to `main` inside an orchestrator `git add -A specs`). Stage only the paths you changed.
- A build session can leave its digest commit local only (seen on 0011d); before deleting a spec branch, check
  `git log origin/main..spec/NNNN-…` and bring any digest into the archived spec.
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

A worktree gets its own `.env` with `COMPOSE_PROJECT_NAME=rent-app-NNNN` and unique ports (used so far: DB 5480–5543,
Redis 6430–6493, API 8050–8113, web 5191–5253: start above those). The main checkout's stack runs on 5434/6380/8000
(set in its `.env`), web 5180, admin 8001. Web at http://localhost:$WEB_PORT
(must be `localhost` for CORS). Local login code: newest `.outbox/*.json`.

## Session History
- 2026-11-15: Slice 12 built and merged (`0012a` PR #100, `0012b` PR #101; one review round each; Gilad chose the
  partial index on suspended users). `0015a` merged (PR #98) by another chat. Main checkout pulled, admin set up.
- 2026-11-15: Slice 11 finished (`0011d` PR #97); Slice 12 and `0015a` specced and verified.
- 2026-11-14: Slice 11 `0011a`/`b`/`c`/`e` and Slice 14 `0014d` merged.
