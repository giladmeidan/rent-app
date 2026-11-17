# Project Handoff

## Project Overview
homie / הומי: a Hebrew-first, RTL rental marketplace for all of Israel (Gush Dan until Slice 21) — apartments (owners ↔ seekers) and the
roommate market "שוק השותפים". FastAPI + SQLAlchemy 2.0 + PostgreSQL/PostGIS + Redis + arq worker; React 18 +
TypeScript + Vite + Tailwind + TanStack Query + i18next + react-router 7. Repo: https://github.com/giladmeidan/rent-app
(**public** since 2026-11-16).

Process: read `CLAUDE.md` first (Speed rules 1–11, hard rules). The main session is the orchestrator; each spec is
built by its own session in its own worktree via `/build NNNN`. Product decisions: `specs/PRODUCT.md`. Open minors
and pending decisions: `specs/FOLLOWUPS.md`. Done specs (with digests): `specs/archive/`. History: `git log`.
A session started in `/Users/giladmeidan/rent_app` (one folder up) does not register the project agents; run them
as `general-purpose` agents told to read their definition file first.

## Current Status
**Slice 21 (national) done 2026-11-17:** all of Israel at once (decisions in PRODUCT.md "Launch area"). `0021a1` area catalogue (PR #132: 1,188 CBS settlements without Judea and Samaria + 701 big-city neighbourhoods, migration `0031`), `0021a2` listing neighbourhoods + two-level area match (PR #135, migration `0032`), `0021b` city picker + profile chips + copy (PR #133), `0021c` national rent data (PR #134), `0021d` Israel-wide map, default view Tel Aviv (PR #136); all archived with digests. Owed before launch (FOLLOWUPS): `make import-areas` after `make migrate` on the first production deploy (`api/data/settlements.csv` ships in the image), the first national rent import (4–6 h) then `make rent-backtest`, and a check that nadlan.gov.il answers from the production region (reportedly Israeli IPs only). The a11y `ac5_public_pages_pass_axe` e2e flaked on #132, #135 and #134: worth a real fix.
**Waitlist (2026-11-16):** `0017` (PR #116) and `0017b` Turnstile (PR #120) merged and archived; live on `https://homie-waitlist.pages.dev` (own Pages project + D1 `homie-waitlist`, deployed by hand with `make deploy-waitlist CONTACT_EMAIL=… TURNSTILE_SITE_KEY=…`, the secret via `make waitlist-secret`; README in `waitlist/`). `specs/0017c-waitlist-hardening.md` is `draft` and **not queued** (Gilad: no build yet; Q0 decides whether email confirmation is built).
Overall: MVP feature work done through Slice 12; Slice 14 (rent estimate) done through `0014d`; `0015a`/`0015b`/`0013h` done.
**Slice 19 (observability) done 2026-11-17:** `0019a` Sentry (PR #128) and `0019b` PostHog (PR #130) merged and archived (plan in `specs/archive/OBSERVABILITY-PLAN.md`, decisions in PRODUCT.md "Observability"). Both are inert until production sets the keys; owed at `0013a` deploy: Sentry DSNs + source-map token, PostHog keys, and in the PostHog project turn on "Cookieless server hash mode" and "Discard client IP data"; check the first `posthog_forget_job` run gets a 202 (bulk-delete body untried). After merging, the main checkout needs `make dev` (new packages).
**Slice 18 (tour calendar for listers) done 2026-11-17: all 5 specs merged and archived (plan in `specs/archive/TOURS-PLAN.md`).**
*Planned* (`specs/archive/TOURS-PLAN.md`, decisions in PRODUCT.md "Tours" + "Retention" R11, all defaults accepted by Gilad): a
lister opens time windows per listing; a shortlisted seeker books a slot instantly (no confirm step); either side
cancels, the seeker reschedules; each change is a chat line + an email (`.ics`, day-before reminder); a `/tours` page;
a private iCal feed for Google Calendar. Five verified specs, built in order `0018a` → `0018c` ∥ `0018e` → `0018b` → `0018d`.
*Happened:*
- `0018a` API + migration `0030_tours` (`tour_windows`, `tours`, `tour_feeds`, tour lines on `messages`): **merged**
  PR #119. Its first CI run failed e2e only, on 30 s timeouts with the Mac at load ~20 (5 builds' stacks + CI); main
  went red after #118 (waitlist test), fixed in #119 and by main itself; after #120 merged it needed a main merge,
  then went green on GitHub.
- `0018e` slot editor, slot picker, chat tour card: **merged** PR #122.
- `0018c` emails + `.ics` + reminder job: **merged** PR #121 (green on `537a00e`). 5 review minors in FOLLOWUPS,
  incl. an SMTP stall to fix before 0013a.
- `0018b` `/tours` agenda page (`GET /tours`, one `UNION ALL`, cap 200): **merged** PR #123 (`a4f16a8`). 0 blockers,
  3 qa majors fixed; minors in FOLLOWUPS.
- `0018d` private iCal feed (`/me/tour-feed` create/rotate/revoke, public `GET /tour-feed/{token}.ics`, sha256 of the
  token in `tour_feeds`, dead token = empty calendar, token redacted from logs): **merged** PR #124 (`f5ae3ce`). 0 blockers,
  0 majors; 3 qa minors in FOLLOWUPS. Owed after `0013a` deploys: press "הוספה ליומן Google" and check a tour shows
  up (spec R7; Google cannot reach a local stack). #124 was built on #123's branch and merged right after it with
  `gh pr merge --match-head-commit` on its own green run (`main` then differed only by #123's merge commit; the merged
  tree equals the tested head).
- Changes to the plan during the build: Gilad dropped the lister-confirm step (shortlist = approval); the tour bucket
  was lowered to 10/h 20/day; a dead feed link returns an empty calendar; expiry cancels nothing; the feed token lives
  in `tour_feeds` (not on `users`); `ics.py` is 0018c's.
**CI (2026-11-16):** runs on GitHub `ubuntu-latest` (`CI_ON_GITHUB=on`); the repo is public, so Actions minutes are
free; the self-hosted Mac runner was removed (other session, Gilad's call). `0017`/`0017b` waitlist (other chat) merged (#116, #120).
**Slice 16 (login upgrade) done 2026-11-16:** `0016a` password login (PR #114, migration `0029_login_methods`,
hashes in `user_passwords`, unreadable by the admin role) and `0016b` Google sign-in (PR #115, no migration). Emailed
code unchanged. Decisions in PRODUCT.md "Login". Gilad's Google OAuth client id is in the main checkout's `.env`
(`GOOGLE_VERIFIER=google`); production keeps Google `off` until 0013a.
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
- Alembic head `0030`. No open PRs of ours. Only `../rent-app-0013a` (untouched, behind main) is left of our worktrees.
- `specs/0015b-shelter-preference.md` (`status: verified`) appeared on `main` from another chat (commit `d840e0e`);
  not built, not this orchestrator's queue unless Gilad says so.
- Main checkout `../rent-app` is on `main` at `83d76f6`, ~70 commits behind `origin/main`, still with Gilad's
  uncommitted `Makefile` / `.gitignore` edits and untracked seed/promo work. Its stack (`rent-app`, 6 containers incl.
  `admin`) runs the old code and has not run migrations `0025`/`0026` (Next Steps 3).

Last updated: 2026-11-17 (after Slice 18's last merges #123/#124; Slice 18 lines, Current Work, Next Steps 0, ports and Session History updated).

## Current Work
Nothing in flight. No open PRs of ours; Slice 18 worktrees removed. `0013a-production-deploy` (`status: verified`, worktree `../rent-app-0013a`, ports
5550/6500/8120/8121/5260) waits for Gilad's go on paid hosting (~$55/month). Building it costs nothing (configs,
`make deploy-*`, `infra/DEPLOY.md`); deploying does.

## Completed
- [x] Slices 1–12 (MVP features, trust, admin), Slice 14 through `0014d` (rent estimate), `0015a` (protected space).
- [x] Slice 13 launch readiness except `0013a`: real client networks for limits, account deletion (API + web),
  admin sessions in Postgres, terms/privacy pages (draft text), review minors, `make screens` green, stable e2e,
  `0013h` data retention (PR #112: nightly purge R1–R10, periods in PRODUCT.md "Retention" and the privacy text).

## Decisions (Gilad, 2026-11-15, during the build)
- Re-signup after self-deletion: rule **A**, only an admin action blocks (as PRODUCT.md). The gap (a reported account
  deletes itself before any action and signs up again) is FOLLOWUPS 0013c "option D", post-launch.
- Server access logs kept and disclosed in the privacy policy (retention placeholder `[משך שמירת היומנים]`).
- 0013b/0013e/0013c pending decisions took the specs' defaults (20 codes/day per email; Redis option A;
  `Sec-Fetch-Site: same-origin`; deletion defaults). Sentry stays open (parked with paid items).

## Next Steps
0. **After Slice 18:** main checkout: `git pull`, `make migrate` (`0030`), re-apply `api/scripts/admin_role.py` grants,
   `make client`. Production tour emails wait for the parked email provider (`0013a`).
1. Parked until Gilad approves paid services: build/deploy `0013a`; buy the domain; Fly, Cloudflare and an
   email-provider account (free tier ≥ 300/day); Sentry or no alerts; a second API machine (+~$7/month).
   **homie must not go public before `0013b` is deployed with `TRUST_PROXY=fly`** (runbook §9).
2. **Before going public (Gilad 2026-11-16):** a security-email spec ("your password was changed" / "your account was
   deleted"), FOLLOWUPS 0016a. Gilad to approve the 0016b privacy draft (`legal.privacy.s1.i1`, `s3.i6`).
3. Legal text (`web/src/locales/he.json`, Gilad fills, lawyer's read advised): `legal.date`;
   `legal.terms.intro` + `legal.privacy.intro` (operator name and ID); `legal.terms.s2.i1` (18+) and
   `legal.terms.s11.p1` (Tel Aviv-Yafo courts) to confirm; approve 0013h's retention text (privacy s5, s6, s1/s7/s8
   fixes, terms s9.p1);
   `legal.privacy.s3.i2` (hosting/DB, server location, photo/site storage, email providers); `legal.privacy.s3.i5`
   (countries). Production web build needs `VITE_CONTACT_EMAIL`.
3. Main checkout (Gilad's uncommitted edits stay; never `git stash` there): `git pull`, `make migrate` (`0025`
   admin_logins, `0026` account deletion), re-apply the admin role grants (`api/scripts/admin_role.py`, as after
   every migration that adds a table the admin reads), restart the stack, `make client`; then
   `GRAPHIFY_CLAUDE_CLI_MODEL=haiku graphify label . --backend=claude-cli` (owed for Slices 12, 13 and 18).
4. FOLLOWUPS from Slice 13 (all minors): 0013f's `account.spec.ts:41-43` brings back the inline send-code pattern
   0013d removed; applications ac9 "טוען…" timeout; 0013b's duplicate `Fly-Client-IP`, silent view budget, Redis-hang
   threadpool burst; 0013e re-login leaves the old admin row live ≤ 8 h; option D above.
5. Still open from before: Gilad to commit or drop his `Makefile` / `.gitignore` / seed / promo work; read
   nadlan.gov.il's and CBS's terms before `RENT_REFERENCE` / `CBS_RENT` in production; digests owed for Slices 9, 9c,
   10; Gilad's open FOLLOWUPS decisions; GitGuardian incident 40007526 → false positive.

## Admin dashboard (local)
`make admin` in the main checkout (needs `ADMIN_PASSWORD` 16+ and `ADMIN_SECRET_KEY` 32+ in `.env`; names only,
never write values here) → http://127.0.0.1:8001/admin, password only (username ignored). Wrong passwords lock the
login in Postgres (`admin_logins`, 0013e): it survives restarts. To lift it, as the DB owner role (the admin role
cannot DELETE): `DELETE FROM admin_logins WHERE locks_until > now()`. Logout ends every copy of the session cookie.
Admin writes need the browser's `Sec-Fetch-Site: same-origin`, so reach it on `127.0.0.1` (Host allowlist) or, in
production, via `fly proxy` / https.

## Architecture
- `api/app/`: `main.py` (app factory, exact-origin CORS with credentials, DB/Redis errors → 503, 422 never echoes
  input and lists at most 50 entries, 64 KB body cap → 413 except the two photo uploads), `auth.py` (`current_user` /
  `optional_user`, cookie `rent_session`), `limits.py` (per-account rate-limit buckets over
  `services/rate_limit.py::count_or_raise`; `api/tests/test_hardening.py` AC1 fails for any write route in neither
  `LIMITED` nor `OWN`, so a new write route must join one), `models/` vs `schemas/` (never shared;
  `schemas/_text.py::visible_characters_only` is the one user-text rule), `matching/`, thin `routers/`, logic in
  `services/` (`search.py::_public_listings()` is the only definition of "public"; `rent_reference.py` the official
  import; `rent_estimate.py` the engine + backtest; reports in `reports.py`), `worker.py` (geocoding, the monthly
  rent import (off by default), the per-minute listing-view flush). Since Slice 13: `services/visibility.py` holds the
  suspended/deleted-owner filters (`not_suspended` and friends); per-network limits key on the client network
  (`TRUST_PROXY=fly` reads `Fly-Client-IP`; IPv4 address or IPv6 /64, plus a /48 counter); `DELETE /me` turns an
  account into a scrubbed tombstone and, after an admin action, writes an `EMAIL_BLOCK_KEY` HMAC to `blocked_emails`
  (`signup_blocked` 403 at OTP verify).
- `api/admin/`: the SQLAdmin dashboard (0012b), its own image, compose profile `admin` and Postgres role
  `homie_admin` (column-level grants, `scripts/admin_role.py`); `app/` never imports `admin`.
- Migrations `api/alembic/versions/0001`–`0030` (`0029_login_methods`, `0030_tours`). Tours: `services/tours.py` (change hook `record` in the transaction, `announce` after commit), `services/ics.py` + `services/tour_mail.py` (0018c), `web/src/features/tours/`. Photos on Cloudflare R2 behind unguessable keys (0010d/j).
- `web/src/`: `app/` (routes, layout, side switch), `features/<domain>/`, `components/` (UI kit), `locales/he.json`,
  generated `api/schema.d.ts` (`make client`, git-ignored). `web/e2e/` Playwright (CI only), `web/e2e/screens/` the
  mocked screenshot check (`make screens`, local). `/terms`, `/privacy` (legal text in `he.json` under `legal.*`,
  with `[…]` placeholders), `/account-deleted`; footer on every page except `/` and `/chat`.
- `infra/docker-compose.yml`: db, redis, api, worker, web on `127.0.0.1`; ports via `DB_PORT`/`REDIS_PORT`/
  `API_PORT`/`WEB_PORT`; `COMPOSE_PROJECT_NAME` isolates a worktree's stack. No production deploy yet (`0013a`).
- CI: one `ci` job on GitHub's `ubuntu-latest` since 2026-11-16 (`CI_ON_GITHUB=on`; the Mac runner is deregistered), only on PRs labelled `ready-to-merge`; docs-only PRs run nothing;
  a PR also labelled `skip-e2e` skips the smoke suite (label on before the run starts). e2e: `E2E_SHARDS ?= 8`.

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
- e2e only in CI; merge only with `make merge PR=N` (Slice 13 exception: a run where only e2e failed, or a head
  that differs from the green one only by `main` and docs, merged with `gh pr merge --match-head-commit`); at most 3 builds at once; **no docs push to `main` while any
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
- e2e OTP budget: `make e2e` clears `rl:*` only per shard and each network gets at most 10 codes per 15 min; with
  8 shards the busiest needs 7 (the `Makefile` comment by `E2E_SHARDS` lists them). A spec adding sign-ups to e2e
  must re-check the per-shard count. `0013f`'s `account.spec.ts:41-43` brings back the inline send-code pattern
  `0013d` removed (FOLLOWUPS).
- No e2e has run with `0013f`'s sign-up/consent changes and `0013d`'s shard changes together on `main`.
- A PR GitHub marks conflicting runs no `ci` at all (only GitGuardian shows): merge `origin/main` and push.
- When several spec PRs stack (a web half contains its API half), each later merge leaves the others behind `main`:
  merge them one by one, each merging `origin/main` and rerunning `ci` (free now).
- Planner-shape asserts are brittle on the CI Mac (`test_nf1_owner_check_is_one_pass` failed 3 PRs until #106):
  assert loops/indexes, not parent node types.
- `/areas` blocks on a *hung* Postgres via pooled connections; why `GET /areas` is slow on CI runners is unconfirmed.
- Join, leave and remove publish no chat event; open threads refresh members on window focus only.
- GitGuardian incident 40007526 (fake fixture token) flags every PR that merges `main`; merge on green `ci` anyway.
- No GitHub branch protection on this plan. Docker Desktop does not auto-start after a reboot (`open -a Docker`).
- Design artboards in `design/screens-v1/` reference a missing `support.js`.

## Environment & Commands
Prereqs: Docker Desktop, `uv`, Python 3.12, Node 22 (`nvm use 22`; the shell default v20 crashes vitest, so prefix
`PATH=/Users/giladmeidan/.nvm/versions/node/v22.23.2/bin:$PATH`) + `pnpm`, `gh` logged in. `0013a` adds flyctl
(and possibly wrangler) as deploy tools. Production also needs (names only): `EMAIL_BLOCK_KEY` (32+, never
rotated, not the dev value), `TRUST_PROXY=fly`, `VITE_CONTACT_EMAIL` (web build), besides `.env.example`'s list.
Commands: see `CLAUDE.md` → Commands and the `##` comments in the `Makefile`.

A worktree gets its own `.env` with `COMPOSE_PROJECT_NAME=rent-app-NNNN` and unique ports (used so far: DB 5480–5585,
Redis 6430–6535, API/admin 8050–8166, web 5191–5295: start above those). The main checkout's stack runs on
5434/6380/8000 (set in its `.env`), web 5180, admin 8001. Web at http://localhost:$WEB_PORT (must be `localhost` for
CORS). Local login code: newest `.outbox/*.json`.

## Session History
- 2026-11-16/17: Slice 18 (tour calendar) planned with Gilad; 4 specs written by forks, one verifier round each (0018a
  split into 0018a + 0018e), all verified. Merged #119 (`0018a`), #122 (`0018e`), #121 (`0018c`); specs archived.
  CI moved to GitHub runners and the repo went public mid-slice.
- 2026-11-17: Slice 18 finished by an orchestrator Gilad left running overnight: `0018b` (#123) and `0018d` (#124)
  built in their own sessions (0018d on 0018b's open branch) and merged; specs + plan archived. Merges waited
  hours after CI went green because the orchestrator ignored its own watcher's notification.
- 2026-11-16: Slice 16 login upgrade specced, verified, built and merged: #114 (`0016a` password), #115 (`0016b`
  Google).
- 2026-11-15: Slice 13 built and merged except `0013a` (parked: costs money): #104 (g), #105 (e), #107 (c), #106 (b),
  #109 (f), #108 (d). `skip-e2e` CI label added; migrations renumbered (e `0025`, c `0026`); a brittle plan-shape test
  (`test_nf1_owner_check_is_one_pass`) fixed in #106.
- 2026-11-15: Slice 13 decided with Gilad and specced: 7 specs (`0013a`–`0013g`) written by forks, one independent
  spec-verifier round each (all failed first, findings applied), all `verified`. Build sessions pre-started, then
  archived (Gilad builds in another chat).
- 2026-11-15: Slice 12 built and merged (`0012a` PR #100, `0012b` PR #101). `0015a` merged (PR #98).
- 2026-11-15: Slice 11 finished (`0011d` PR #97); Slice 12 and `0015a` specced and verified.
