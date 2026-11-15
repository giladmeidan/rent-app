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
**Slice 13 (Launch readiness) is specced and verified: 7 specs, none built yet.** Gilad builds them in another chat.

- Slice 13 decisions (Gilad, 2026-11-15) are in `specs/PRODUCT.md` → "Launch (Slice 13)" (commit `84b6fef` on
  `main`): Fly (Frankfurt) + Fly Managed Postgres + Cloudflare Pages (~$55/month); email OTP only at launch (no SMS);
  self-serve account deletion; reports kept; re-signup blocked after an admin action; orchestrator-drafted Hebrew
  terms/privacy that Gilad approves; cleanup sweep. Not before launch: daily digest email, Protomaps. **Merging
  Slice 13 is delegated to the orchestrator.**
- The specs and this handoff are on `main` (pushed after PR #102, another chat's English wordmark, merged).
  #102 changed `web/src/app/Layout.tsx`, `LoginPage.tsx`, `SignupPage.tsx` and `he.json` after `0013f` was
  written; `0013f`'s coder re-reads them (line numbers may have moved).
- Alembic head `0024`. No open PRs. `0016a` landing polish (`status: draft`) is still another chat's
  in `../rent-app-0016a`; do not touch it.
- Main checkout `../rent-app` is on `main` at `6a6cabb` (behind `origin/main`; `git pull` there, then graphify rebuilds), still with Gilad's
  uncommitted `Makefile` / `.gitignore` edits and seed/promo work. Its stack (`rent-app`, 6 containers incl. `admin`)
  runs.

Last updated: 2026-11-15 (Slice 13 specced and verified).

## Current Work — Slice 13 specs (all `status: verified`, in `specs/`)
| Spec | What | depends_on | Reviewers | Coder | Worktree (branch `spec/<file>`) |
| --- | --- | --- | --- | --- | --- |
| `0013a-production-deploy` | Fly configs (api+worker, private Redis, private admin), Pages `_headers`, `make deploy-*`, settings guard, `infra/DEPLOY.md` runbook | – | code, security | Opus/high | `../rent-app-0013a` |
| `0013b-security-hardening` | `client_network` + `TRUST_PROXY=fly` (`Fly-Client-IP`), OTP per (email, network) + IPv6 /48, per-network read/browse limits, view dedup | – | code, security, qa, perf | Opus/high | `../rent-app-0013b` |
| `0013c-account-deletion-api` | `DELETE /me` tombstone, `EMAIL_BLOCK_KEY` HMAC block, `resolve_session` checks `deleted_at`, migration `0025_account_deletion` | – | code, security, qa | Opus/high (long) | `../rent-app-0013c` |
| `0013d-prelaunch-cleanup` | `make screens` green, flaky e2e (settle the shard-4 OTP-budget cause first; `E2E_SHARDS ?= 6` if 429) | – | code, qa, ux | Opus/medium | `../rent-app-0013d` |
| `0013e-admin-hardening` | `admin_logins` table (server-side session, lock survives restarts), writes need `Sec-Fetch-Site`, 0012b test edges | – | code, security, qa | Opus/high | none yet |
| `0013f-account-deletion-terms-web` | profile delete flow, deleted-name display, `/terms` + `/privacy` with the Hebrew legal text, footer (not on `/`), consent line | 0013c | code, security, ux, qa | per spec | none yet |
| `0013g-review-minors` | 409 on photo routes past expiry, "try again in …" on 429s, worker INFO logs, `services/visibility.py` | – | code, qa | Sonnet/medium | none yet |

- The four worktrees exist (cut at `84b6fef`, so `git merge origin/main` brings the specs) with `.env` set:
  a 5550/6500/8120/admin 8121/web 5260; b 5551/6501/8122/8123/5261; c 5552/6502/8124/8125/5262;
  d 5553/6503/8126/8127/5263 (DB/Redis/API/admin/web). New worktrees start above those.
- **Migration clash:** `0013c` and `0013e` both claim `0025`; the second to merge renumbers to `0026`.
- Shared files between the specs are named in each spec's Risks; the second to merge merges `origin/main`.
- The pre-started build sessions were archived (Gilad builds in another chat).

## Decisions pending for Gilad (defaults are written into the specs; none blocks a build)
1. `0013a`: error alerts at launch — none, or Sentry free tier as a small follow-up spec (recommended; the privacy
   policy must then name it).
2. `0013b`: per-email daily OTP ceiling across networks — 20 accepted at launch (default; one attacker with many
   /64s can still block an email's new codes for a day, sessions unaffected) / 30 / a known-device exemption.
3. `0013b`: Redis memory — A: read/browse windows ≤ 1 h + IPv6 /48 counters + Grafana alert at 70 % (default) /
   B: keep day windows + /48 + alert / C: alert only.
4. `0013e`: admin writes require `Sec-Fetch-Site: same-origin` (default) vs a per-session CSRF token.
5. `0013c`: a lifted suspension or un-hidden listing still blocks re-signup (default; Gilad's "an action against
   him" read that way); deletion needs a sign-in within 15 min (default); reports made by the account kept
   (default); its listings kept as hidden paused rows without photos/description (default).
6. `0013f`: approve the Hebrew terms + privacy text and fill its placeholders (operator, email provider, contact
   address, date); 18+ and Tel Aviv-Yafo courts; a consent line, not a checkbox; no footer on `/` (default, small
   legal links under the closing band; PRODUCT.md Landing v2 "still no footer") vs a footer everywhere. A lawyer's read
   is advised (not legal advice).
FYI: one API machine drops connections ~30 s per deploy (+~$7/month for a second); pick an email provider whose free
tier sends ≥ 300/day; **homie must not go public before `0013b` is deployed** (runbook §9 "Fly-Client-IP check").

## Next Steps
1. Gilad answers the decisions above; write the answers into the specs / `PRODUCT.md` the same day.
2. Build (another chat): `/build` per spec, at most 3 at once; `0013f` after `0013c` is open as a PR. Worktrees for
   `0013e`, `0013f`, `0013g` still need creating (`.env` with `COMPOSE_PROJECT_NAME` + unique ports).
3. After each merge: archive the spec, tick the FOLLOWUPS lines it names, remove its worktree and branch.
4. Go-live (Gilad, after `0013a`+`0013b` merge): buy the domain; create Fly, Cloudflare and email-provider accounts;
   follow `infra/DEPLOY.md`.
5. Still open from before: `GRAPHIFY_CLAUDE_CLI_MODEL=haiku graphify label . --backend=claude-cli` in the main checkout
   (Slice 12's post-slice step); Gilad to commit or drop his `Makefile` / `.gitignore` / seed / promo work; read
   nadlan.gov.il's and CBS's terms before turning `RENT_REFERENCE` / `CBS_RENT` on in production; digests owed for
   Slices 9, 9c, 10; Gilad's open FOLLOWUPS decisions; GitGuardian incident 40007526 → false positive.

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
- 2026-11-15: Slice 13 decided with Gilad and specced: 7 specs (`0013a`–`0013g`) written by forks, one independent
  spec-verifier round each (all failed first, findings applied), all `verified`. Build sessions pre-started, then
  archived (Gilad builds in another chat).
- 2026-11-15: Slice 12 built and merged (`0012a` PR #100, `0012b` PR #101). `0015a` merged (PR #98).
- 2026-11-15: Slice 11 finished (`0011d` PR #97); Slice 12 and `0015a` specced and verified.
