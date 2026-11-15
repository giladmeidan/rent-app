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
Overall: MVP feature work done through Slice 12; Slice 14 (rent estimate) done through `0014d`; `0015a` done.
**Slice 13 (Launch readiness) is built except `0013a` (production deploy), which Gilad parked on 2026-11-15:
"everything that costs money put on the side".**

- Merged 2026-11-15 (merging delegated; specs archived with merged digests): `0013g` review minors (PR #104),
  `0013e` admin hardening (PR #105, migration `0025_admin_logins`), `0013c` account deletion API (PR #107, migration
  `0026_account_deletion`), `0013b` real client networks for every per-IP limit (PR #106), `0013f` account deletion
  + terms/privacy web (PR #109), `0013d` pre-launch cleanup (PR #108: `make screens` green, `E2E_SHARDS ?= 8`).
- **e2e (Gilad, 2026-11-15):** Slice 13 specs merged without e2e: `ci.yml` skips the smoke suite on PRs labelled
  `skip-e2e` (commit `8e8af0a`); a run where only e2e failed counts as green (merged with `gh pr merge
  --match-head-commit`, since `make merge` refuses a red check); never re-run CI that passed. #107 merged on a run
  whose only failures were the 5 load-flaky e2e tests; #105 and #108 ran e2e green; #106 and #109 skipped it. No e2e
  has run on `main` with `0013f`'s sign-up/consent changes and `0013d`'s shard changes together: the next PR with
  e2e on is the first. Ask Gilad before using `skip-e2e` in a later slice.
- Alembic head `0026`. No open PRs of ours. Only `../rent-app-0013a` (untouched, behind main) is left of our worktrees.
- `specs/0015b-shelter-preference.md` (`status: verified`) appeared on `main` from another chat (commit `d840e0e`);
  not built, not this orchestrator's queue unless Gilad says so.
- Main checkout `../rent-app` is behind `origin/main` (`git pull` there, then graphify rebuilds), still with Gilad's
  uncommitted `Makefile` / `.gitignore` edits and seed/promo work.

Last updated: 2026-11-15 (Slice 13 built and merged, `0013a` parked).

## Current Work
Nothing in flight. `0013a-production-deploy` (`status: verified`, worktree `../rent-app-0013a`, ports
5550/6500/8120/8121/5260) waits for Gilad's go on paid hosting (~$55/month). Building it costs nothing (configs,
`make deploy-*`, `infra/DEPLOY.md`); deploying does.

## Decisions (Gilad, 2026-11-15, during the build)
- Re-signup after self-deletion: rule **A**, only an admin action blocks (as PRODUCT.md). The gap (a reported account
  deletes itself before any action and signs up again) is FOLLOWUPS 0013c "option D", post-launch.
- Server access logs kept and disclosed in the privacy policy (retention placeholder `[משך שמירת היומנים]`).
- 0013b/0013e/0013c pending decisions took the specs' defaults (20 codes/day per email; Redis option A;
  `Sec-Fetch-Site: same-origin`; deletion defaults). Sentry stays open (parked with paid items).

## Next Steps
1. Parked until Gilad approves paid services: build/deploy `0013a`; buy the domain; Fly, Cloudflare and an
   email-provider account (free tier ≥ 300/day); Sentry or no alerts; a second API machine (+~$7/month).
   **homie must not go public before `0013b` is deployed with `TRUST_PROXY=fly`** (runbook §9).
2. Legal text (`web/src/locales/he.json`, Gilad fills, lawyer's read advised): `legal.date`;
   `legal.terms.intro` + `legal.privacy.intro` (operator name and ID); `legal.terms.s2.i1` (18+) and
   `legal.terms.s11.p1` (Tel Aviv-Yafo courts) to confirm; `legal.privacy.s1.i13` + `s5.i9` (log retention);
   `legal.privacy.s3.i2` (hosting/DB, server location, photo/site storage, email providers); `legal.privacy.s3.i5`
   (countries). Production web build needs `VITE_CONTACT_EMAIL`.
3. Post-slice, in the main checkout: `git pull`, then `GRAPHIFY_CLAUDE_CLI_MODEL=haiku graphify label .
   --backend=claude-cli` (owed for Slices 12 and 13).
4. FOLLOWUPS from Slice 13 (all minors): 0013f's `account.spec.ts:41-43` brings back the inline send-code pattern
   0013d removed; applications ac9 "טוען…" timeout; 0013b's duplicate `Fly-Client-IP`, silent view budget, Redis-hang
   threadpool burst; 0013e re-login leaves the old admin row live ≤ 8 h; option D above.
5. Still open from before: Gilad to commit or drop his `Makefile` / `.gitignore` / seed / promo work; read
   nadlan.gov.il's and CBS's terms before `RENT_REFERENCE` / `CBS_RENT` in production; digests owed for Slices 9, 9c,
   10; Gilad's open FOLLOWUPS decisions; GitGuardian incident 40007526 → false positive.

## Admin dashboard (local)
`make admin` in the main checkout (needs `ADMIN_PASSWORD` 16+ and `ADMIN_SECRET_KEY` 32+ in `.env`; names only,
never write values here) → http://127.0.0.1:8001/admin, password only (username ignored). Wrong passwords lock the
login until the admin container restarts (`docker restart rent-app-admin-1`; `0013e` makes the lock persistent).
Must be `127.0.0.1` (Host allowlist).

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
  `homie_admin` (column-level grants, `scripts/admin_role.py`); `app/` never imports `admin`.
- Migrations `api/alembic/versions/0001`–`0024`. Photos on Cloudflare R2 behind unguessable keys (0010d/j).
- `web/src/`: `app/` (routes, layout, side switch), `features/<domain>/`, `components/` (UI kit), `locales/he.json`,
  generated `api/schema.d.ts` (`make client`, git-ignored). `web/e2e/` Playwright (CI only), `web/e2e/screens/` the
  mocked screenshot check (`make screens`, local).
- `infra/docker-compose.yml`: db, redis, api, worker, web on `127.0.0.1`; ports via `DB_PORT`/`REDIS_PORT`/
  `API_PORT`/`WEB_PORT`; `COMPOSE_PROJECT_NAME` isolates a worktree's stack. No production deploy yet (`0013a`).
- CI: one `ci` job on the self-hosted Mac runner, only on PRs labelled `ready-to-merge`; docs-only PRs run nothing.

## Important Decisions
- Launch (PRODUCT.md "Launch (Slice 13)", Gilad 2026-11-15): see Current Status; paid hosting approved (~$50–55/month).
- Trust (PRODUCT.md "Trust (MVP)"): reports stored only until the admin lists them; renewal from 7 days before
  expiry; deposit warning = the 0005b line; at most 5 listings created an hour and 10 a day.
- Rent estimate (PRODUCT.md): a range with confidence and source, never one number; official data + homie's own
  listings only; the engine takes facts, not a listing id.
- Admin (PRODUCT.md "Admin (Slice 12)"): separate SQLAdmin dashboard for Gilad only, no public address (production: a
  Fly app with no public IP via `fly proxy`); reported chats only are readable, each open logged.
- Protected space (`0015a`): a listing states its protected space as a type, not yes/no.

## Constraints
- Orchestrator never writes application code; agents never push to `main` (orchestrator docs commits excepted).
- Never `git stash` in a shared checkout; never start/stop another checkout's compose stack.
- e2e only in CI; merge only with `make merge PR=N`; at most 3 builds at once; **no docs push to `main` while any
  PR waits on CI or is green and about to merge** (it falls behind and CI reruns).
- When writing specs through the shell, `\uXXXX` escapes get decoded into real characters; check files for
  invisible characters afterwards.

## Known Issues
- **Spec-writing forks cannot start subagents**, so a fork's "spec-verifier pass" is only a self-check. Run the
  real spec-verifier from the main session (all 7 self-checked Slice 13 specs failed the independent verifier).
- Build sessions: a reviewer run as a background agent can die without reporting and leave the build session
  waiting; check `ps` and re-run that review. Two agents running `make test` at once share the test DB.
- A build session's `git push` / `gh pr create` can be blocked by its permission check until Gilad allows it there.
- New worktree folders are not trusted workspaces: start build sessions in `/Users/giladmeidan/rent_app` and brief
  them to work in the worktree by absolute path.
- `../rent-app-orch` can be shared with another chat writing specs. Stage only the paths you changed.
- A build session can leave its digest commit local only; before deleting a spec branch, check
  `git log origin/main..spec/NNNN-…`.
- Adding the `ready-to-merge` label at PR creation starts two `ci` runs; one is cancelled at once. Watchers must skip
  cancelled runs and match the PR's head sha.
- e2e OTP budget: `make e2e` clears `rl:*` only per shard, and the OTP limit is 10 per IP per 15 min; shard 4 needs
  about 12 codes (likely cause of the "flaky" sign-ups; `0013d` settles it).
- `/areas` blocks on a *hung* Postgres via pooled connections; why `GET /areas` is slow on CI runners is unconfirmed.
- Join, leave and remove publish no chat event; open threads refresh members on window focus only.
- GitGuardian incident 40007526 (fake fixture token) flags every PR that merges `main`; merge on green `ci` anyway.
- No GitHub branch protection on this plan. Docker Desktop does not auto-start after a reboot (`open -a Docker`).
- Design artboards in `design/screens-v1/` reference a missing `support.js`.

## Environment & Commands
Prereqs: Docker Desktop, `uv`, Python 3.12, Node 22 (`nvm use 22`; the shell default v20 crashes vitest, so prefix
`PATH=/Users/giladmeidan/.nvm/versions/node/v22.23.2/bin:$PATH`) + `pnpm`, `gh` logged in. `0013a` adds flyctl
(and possibly wrangler) as deploy tools.
Commands: see `CLAUDE.md` → Commands and the `##` comments in the `Makefile`.

A worktree gets its own `.env` with `COMPOSE_PROJECT_NAME=rent-app-NNNN` and unique ports (used so far: DB 5480–5553,
Redis 6430–6503, API/admin 8050–8127, web 5191–5263: start above those). The main checkout's stack runs on
5434/6380/8000 (set in its `.env`), web 5180, admin 8001. Web at http://localhost:$WEB_PORT (must be `localhost` for
CORS). Local login code: newest `.outbox/*.json`.

## Session History
- 2026-11-15: Slice 13 built and merged except `0013a` (parked: costs money): #104 (g), #105 (e), #107 (c), #106 (b),
  #109 (f), #108 (d). `skip-e2e` CI label added; migrations renumbered (e `0025`, c `0026`); a brittle plan-shape test
  (`test_nf1_owner_check_is_one_pass`) fixed in #106.
- 2026-11-15: Slice 13 decided with Gilad and specced: 7 specs (`0013a`–`0013g`) written by forks, one independent
  spec-verifier round each (all failed first, findings applied), all `verified`. Build sessions pre-started, then
  archived (Gilad builds in another chat).
- 2026-11-15: Slice 12 built and merged (`0012a` PR #100, `0012b` PR #101). `0015a` merged (PR #98).
- 2026-11-15: Slice 11 finished (`0011d` PR #97); Slice 12 and `0015a` specced and verified.
