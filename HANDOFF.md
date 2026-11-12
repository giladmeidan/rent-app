# Project Handoff

## Project Overview
Rent App: a Hebrew-first, RTL, two-sided rental marketplace for Gush Dan (owners ↔ seekers, plus roommate flows).
Stack per `specs/PRODUCT.md`: FastAPI + SQLAlchemy 2.0 + PostgreSQL/PostGIS + Redis + arq worker on the API side;
React 18 + TypeScript + Vite + Tailwind + TanStack Query + i18next + openapi-fetch + react-router 7 (library mode)
on the web side; docker compose for local dev; GitHub Actions CI. Repo: https://github.com/giladmeidan/rent-app
(private).

Development runs through an agent process defined in `CLAUDE.md` (read its **Speed rules 1–10** first): the main
session is the **orchestrator** (keeps the queue, writes specs, never writes app code); each spec is built by its
own session in its own worktree via `/build NNNN`, with subagents `coder` and reviewers
`code / qa / security / perf / ux` from `.claude/agents/`. Specs live in `specs/NNNN-slug.md`; the frontmatter
`status` is the source of truth.
When a session starts one folder above the repo (`/Users/giladmeidan/rent_app`), the project agents are not
registered; run them as `general-purpose` agents told to read their definition file first.
The Claude desktop app refuses to start a session from an automated-event turn (a subagent hand-back, another
session's note); the orchestrator pre-starts a slice's build sessions (`start_session` with `cwd` = the prepared
worktree) in a turn Gilad wrote, and sends each its "go" later with `SendMessage`.

## Current Status
Overall: IN_PROGRESS

Current focus:
**Slice 9 + 9b** — 21 specs `0009a`–`0009u` (no `0009n`). Merged 11/21: 0009a, b, c, d, f, h, i, l, qa, qb, t.
In flight: 0009e (PR #53, CI running), 0009g (fix round, PR next), 0009m and 0009k (just started).
**Gilad (2026-11-12): start no new builds after 0009k** — finish the four in flight, then stop.
Not started (worktrees prepared, `in-progress` locks): 0009j, 0009o, 0009p, 0009r, 0009s, 0009u.
Alembic head on `main` still `0012`. Spec status on `main` is the source of truth; `git log` beats this file.

Last updated:
2026-11-12 ~20:30 (orchestrator session `local_2b79d58f-319e-4151-9049-06dfc8b883e9`, after #52 merged)

## Current Work
- Orchestrator = session `local_2b79d58f-319e-4151-9049-06dfc8b883e9` ("Specs and handoff continuation"). All
  in-flight build sessions report to it. The older orchestrator `local_f7f3bc91-…` is retired.
- **0009e** PWA install — PR #53, head 7ce7176 (orchestrator's docs-only FOLLOWUPS union merge with 0009qb on top of
  the green 9dde1ba). Merge on green `api`/`web`/`e2e`. Session `local_c0b47c3e-e380-47cb-967b-6a58410de2dd`.
- **0009g** state polish (app-wide 401 + drafts + skeleton) — 4 reviews in, 0 blockers/majors; fix round then one
  push. Session `local_757c81c0-8201-4a41-833d-0f0259b0d31b`, worktree `../rent-app-0009g`.
- **0009m** login/signup UI (full route + security) — session `local_314d34cd-ebdd-4e40-aae9-28eb6020abd6`.
- **0009k** listing wizard UI (quick route) — session `local_e396dd9a-7102-43db-8c85-c3a4d87fb39d`.
- Not started, deps all merged: 0009j (← 0009i), 0009o, 0009p and 0009u (← 0009l), 0009r, 0009s. **0009s should
  start only after 0009g merges** (it builds on 0009g's chat drafts; same `ChatThreadPage` / `Composer`).
- Remaining worktrees `../rent-app-<id>` are on branches cut from 1601481 with their own `.env` ports; the session
  must `git fetch && git merge origin/main` first and **rebuild the web container** (0009a added
  `@fontsource-variable/*`).
- **GitGuardian incident 40007526**: a fake invite token in `web/e2e/screens/fixtures-flatmates.ts` (0009qb, now on
  main) re-flags in any merge commit that brings main in. Gilad: PRs whose *only* finding is that incident may merge
  on green api/web/e2e. Clean fix: mark it false positive in the GitGuardian dashboard (asked Gilad). Force-push is
  denied, so history rewrites are out.
- Starting a build: `start_session` with `cwd` = worktree, `use_worktree: false`, `user_asked`, only in a turn Gilad
  wrote. Brief template = the 0009m / 0009k briefs in the orchestrator transcript.
- Merge routine: `gh pr checks N` green (api, web, e2e) → `gh pr merge N --merge --match-head-commit <sha>` → in
  `../rent-app-orch` (detached on origin/main) set `status: done`, push `HEAD:main` → after the session's
  `make down`, `git worktree remove --force ../rent-app-<id>`, delete local + remote branch. A FOLLOWUPS-only conflict
  the orchestrator union-merges on the spec branch itself (done for 0009t and 0009e).
- Main checkout `../rent-app` (at 4f00e1f, stale) still holds someone's uncommitted demo-seed work and its `rent-app`
  stack restarted with Docker after the reboot (web 5180). Leave it to its owner.

## Completed
- [x] Agent kit, spec 0000 split into 0000a/0000b, design artboards `design/screens-v1/`.
- [x] Slice 0–1: 0000a Foundations API (#1), 0001a Auth API (#2), 0000b Foundations web (#3), 0001b Auth web (#4).
- [x] Slice 2: 0002a Listings API (#5, cap 3 live listings, 90-day expiry), 0002b Listings web (#6), 0002d Listing
  text safety (#9, `visible_characters_only`), 0002e Edit listing web (#10), 0002f Expired listing read-only (#11).
- [x] Slice 3: 0003a Search API (#7), 0003b Search web (#8), 0003c Map API (#12, Nominatim in the worker),
  0003d Map web (#15).
- [x] Slice 4: 0004a Apply API (#13), 0004c Inbox API (#14), 0004b Apply web (#16), 0004d Inbox web (#17).
- [x] Slice 5: 0005a Chat API (#18), 0005c Chat events API (#19, SSE over Redis pub/sub), 0005b Chat web (#22).
- [x] Slice 6 (matching): 0006a inputs API (#20), 0006b score API (#21), 0006c inbox match API (#23, apply-time
  snapshot), 0006d profile web (#24), 0006f match web (#25), 0006e owner preferences web (#26), 0006g inbox match
  web (#27).
- [x] Slice 7 (rooms + questionnaire, orchestrator-merged): 0007a–0007g, PRs #28–#34 (migrations `0009`, `0010`).
- [x] Slice 8 (orchestrator-merged on Gilad's delegation), 0 blockers left open:
  0008a People + likes API — PR #35 (1a2a296, migration `0011_people_likes`, `room_pairs`, mutual like →
  shortlisted application with `source: 'like'`); 0008b People browse web — PR #36 (13c1d0f, `/me/listings/:id/people`,
  "התאמה הדדית" tag in the inbox, 3-shard `make e2e`); 0008c Likes web — PR #37 (5ab7a12, profile opt-in
  `people_visible` + `about_me`, like a room, `/me/likes`); 0008d Flatmates API — PR #38 (b74283b, migration
  `0012_flatmates`, invite links, group chats, 409 `declined`); 0008e Flatmates web — PR #39 (d62fb0e,
  `/me/listings/:id/flatmates`, `/flatmates/join#<token>`); 0008f Group chat web — PR #40 (e72dbe5, member line,
  sender names, `/me/flats` with leave). Local e2e on the final heads: 10, 11, 12, 11, 13, 14 tests green.
- [x] Slice 9 so far (orchestrator-merged): 0009b Hebrew copy — #42; 0009d UI kit — #43; 0009c a11y baseline — #44;
  0009f state copy — #45; 0009h full-width shell — #46; 0009l inbox — #47 (e7f422a, adds `make screens`);
  0009i search — #48 (f2a2882); 0009t a11y focus + map, Gilad's (c) pins-only target-size exemption — #49 (f92b9ac);
  0009qa seeker lists — #50 (25c639a, adds an age chip on liked rooms, FOLLOWUPS 183); 0009a landing + header/nav +
  self-hosted fonts — #51 (5869fdc); 0009qb flatmates — #52 (f0ebfd3, merged with GitGuardian red on Gilad's OK). Infra: per-worktree `WEB_PORT` — PR #41 (948c6d5).
- [x] CI e2e re-enabled (2026-11-12): `main`'s full suite green in CI (run 43227959268); #45 and #46 merged with CI e2e green.
- [x] Gilad's decisions are in `specs/PRODUCT.md` (rows "Listings", "Search", "Applications", "Chat", "Matching",
  "Rooms", "People & likes", "Flatmates", …).

## Next Steps
1. Merge PR #53 (0009e) on green CI; mark done; clean up after its `make down`.
2. Merge 0009g, 0009m, 0009k as their PRs go green (expect `he.json` / FOLLOWUPS conflicts; a second-to-merge PR
   goes back to its session to merge main and push once).
3. **Do not start further builds** (Gilad, 2026-11-12) until Gilad says so. When he does: 0009s after 0009g merges;
   then 0009j, 0009o, 0009p, 0009r, 0009u, max 3 at a time.
4. Ask Gilad to mark GitGuardian incident 40007526 as a false positive.
5. **Supervise CI e2e** on every merge; on a runner failure `gh variable set E2E_IN_CI --body off` and tell Gilad.
6. FOLLOWUPS from Slice 9: map pin clustering (0009t), map desktop list pairing (0009i), range tags "3–4" render
   4–3 under RTL bidi — a native reader's call (0009i), brand-voice sweep of slash forms (0009b), tabs row has no
   scroll cue at 390 (0009l).
7. Gilad's open Slice 8 decisions (FOLLOWUPS "pending decision"): person-card score inference, people-browse rate
   limit; re-apply after decline (own later spec).
8. Housekeeping: archive finished build sessions (0009b/c/d/f/h/i/l/t/a/qa/qb, infra-webport); remove the planning
   worktrees `../rent-app-0008-spec`, `../rent-app-0009-spec`; decide on `qa-live-2026-11-10/`.

## Architecture
- `api/app/`: `main.py` (app factory, exact-origin CORS with credentials, DB/Redis errors → JSON 503, a 422 handler
  that never echoes `input`), `config.py`, `db.py`, `auth.py` (`current_user` / `optional_user` / `current_owner`,
  cookie `rent_session`), `models/` vs `schemas/` (never shared; `schemas/_text.py::visible_characters_only` is the
  one text rule for user text), `matching/` (score, `room_fit`, `match_columns`, reasons), thin `routers/`
  (`applications`, `areas`, `auth`, `chat`, `events`, `flatmates`, `health`, `listings`, `people`, `profiles`,
  `search`), logic in `services/` (same names plus `chat_events`, `email`, `geocoding`, `rate_limit`, `sms` stub;
  `search.py::_public_listings()` is the only definition of "public"), `i18n/he.py`, `worker.py`.
- Slice 8 model: `room_pairs` (one row per listing × seeker shown or liked: `lister_liked_at`, `seeker_liked_at`,
  frozen `price_ils_seen`); a mutual like creates a `shortlisted` application with `source = 'like'` and opens its
  chat; applying clears the pair's likes under the pair lock. `listing_flatmates` + `listings.flatmate_invite_hash` (sha256 of the room's one live invite token; the token
  itself is never stored);
  chat membership = owner, seeker, and flatmates (flatmates see messages from `joined_at`); `my_role` resolves
  owner → seeker → flatmate.
- `api/alembic/versions/`: `0001`–`0012` (… `0009_room_inputs`, `0010_application_listing_type`,
  `0011_people_likes`, `0012_flatmates`).
- `web/src/`: `app/` (`routes.tsx`, `Layout.tsx`), `features/` (`applicants`, `applications`, `areas`, `auth`,
  `chat`, `flatmates`, `lifestyle`, `likes`, `listings`, `match`, `people`, `profile`, `rooms`, `search`),
  `components/`, `locales/he.json`, generated `api/schema.d.ts` (git-ignored, `make client`). `web/e2e/`: `smoke`,
  `auth`, `listings`, `search`, `map`, `applications`, `inbox`, `people`, `likes`, `flatmates` + `helpers.ts`.
- `infra/docker-compose.yml`: db, redis, api, worker, web; ports on `127.0.0.1`, overridable via
  `DB_PORT`/`REDIS_PORT`/`API_PORT`; web on `WEB_PORT` (default 5173); `COMPOSE_PROJECT_NAME` isolates a worktree's stack.
- CI: `api` and `web` on every PR push; `e2e` only with the `ready-to-merge` label and on `main`;
  docs-only changes run nothing. A PR in conflict with `main` gets no `pull_request` run at all.

## Important Files
- `CLAUDE.md` — process, Speed rules 1–10, hard rules. Read first.
- `specs/PRODUCT.md` — standing decisions; Slice 8 rows "People & likes" and "Flatmates".
- `specs/FOLLOWUPS.md` — open deferred minors and pending decisions (append-only; conflicts keep both sides).
- `specs/0008a-people-likes-api.md` … `specs/0008f-group-chat-web.md` — Slice 8 (done), each with its build digest
  and the orchestrator's amendments.
- `Makefile` `e2e` target — the 3-shard run with the rate-limit flush.
- `design/README.md` + `design/screens-v1/*.dc.html` — artboards (reference a missing `support.js`).

## Important Decisions
- Roles: every account picks **owner** or **seeker** at signup; broker is an `account_type`. Signup collects email
  + display name only.
- OTP caps: 3 codes/15 min and 10/day per email, 10/15 min per IP, 5 guesses per code. Email: file outbox in dev,
  SMTP in prod. Cookie `SameSite=Lax` + exact-origin CORS is the CSRF posture. e2e works around the IP cap with
  shards, never by changing auth code.
- Listings: no photos until `0002c`; no drafts; expiry 90 days, no renewal until Slice 10; the cap counts live
  listings only; 404 (not 403) for another owner's listing.
- Search (Gilad, 2026-11-10): public, OSM tiles now / Protomaps on R2 later, newest-first default, no owner name,
  street without house number.
- Text safety (0002d): no `unicodedata2`; Unicode 16/17 marks cannot be capped on Python 3.12 — accepted gap.
- Web: (before Slice 9: product name "דירה", system font); react-router 7.18.5 library mode. Tooling `uv` / `pnpm`
  (Node 22), TypeScript 5.9.
- Spec branches are updated by merging `origin/main` (force push is denied); append-only `FOLLOWUPS.md` conflicts
  keep both sides. The orchestrator may make that docs-only union merge on a spec branch itself.
- Chat (Slice 5): push via one SSE stream per tab over Redis pub/sub; a chat is keyed by its application id;
  sending only while `shortlisted`; no chat notifications yet.
- Matching (Slice 6): a hard-filter miss stays in results capped at 59; the owner's inbox match uses the apply-time
  snapshot of price and area (0006c option (a)).
- Rooms (Slice 7): room privacy option (b) — flatmate ages and answers only to signed-in seekers; questionnaire
  is soft, weight 20, never filters.
- People & likes (Slice 8, Gilad): browse is for room listers only, seekers opt in (`people_visible`, default off);
  a card never shows the budget amount, and its chips use neutral `people.short.*` copy ("עישון מתאים"), never a
  smoking/pets/household/contract/parking fact (0008b, orchestrator); a mutual like becomes a shortlisted
  application tagged "התאמה הדדית".
- Flatmates (Slice 8, Gilad + orchestrator): the invite link is `/flatmates/join#<token>` — the token is only ever
  in the URL fragment, stashed in `sessionStorage` and stripped with `history.replaceState` before any login
  redirect, so it never reaches a server, log, `Referer` or history; a declined applicant cannot join (409
  `declined`, Gilad); an applicant with an open application withdraws first (409 `already_applied`); flatmates
  chat only (shortlist/decline stay with the lister).
- Merging: Gilad merges PRs or delegates a slice (Slices 7 and 8 were delegated). The orchestrator merges with
  `gh pr merge N --merge --match-head-commit <full sha>` only after `api` + `web` are green on that head and local
  e2e is green (any spec touching web runtime code, API specs included), and holds merges while GitHub Actions is
  down (Gilad, 2026-11-11).
- CI e2e is back on (Gilad 2026-11-12, "keep it under supervision"): merges need `api` + `web` + `e2e` green in CI;
  local `make e2e` optional. Fallback: `gh variable set E2E_IN_CI --body off`.
- Brand (Slice 9, Gilad): product name homie / `הומי`; `design/brand/` beats `design/screens-v1/` for colour, type,
  shape, voice; Fredoka + Rubik self-hosted; no slash forms in copy (plural/infinitive/noun). See
  `specs/0009-brand-amendment.md` and PRODUCT.md "Slice 9 copy + UX".
- Offline (0009f, Gilad): requests fail fast (`networkMode: 'always'`) and show "אין חיבור לאינטרנט"; an action
  started offline is not replayed on reconnect.
- 0009b slash forms (Gilad): neutral replacements for 0009b's own strings; the rest is a FOLLOWUPS sweep.

## Constraints
- Speed rules 1–10 in `CLAUDE.md`: one session per spec, one review round, **one push per spec** (re-push only for a
  CI failure or a `main` merge), high-value calls to Gilad with options (rule 9), `make down` + worktree removal
  when a spec is done (rule 10).
- One verifier round per spec; the orchestrator applies findings and sets `verified`.
- Refresh this handoff only at the end of a spec, on Gilad's request, or after a big slice rewrite.
- Orchestrator never writes application code; agents never push to `main` (orchestrator docs commits excepted).
  Never `git stash` in a shared checkout; never start/stop another checkout's compose stack.
- Each worktree has its own `WEB_PORT` (PR #41); no 5173 handout any more.
- **At most 3 build sessions at a time** (Gilad 2026-11-12); start the next ready spec as one finishes.
- **Quick route** (Gilad 2026-11-12, Speed rule 4): a cosmetic, behaviour-unchanged UI spec gets one `ux` reviewer
  and a Sonnet coder (0009h kept Opus/medium). The 10 quick-route specs have `reviewers: [ux]` in their frontmatter.
- When writing specs through the shell, `\uXXXX` escapes in tool input get decoded into real characters; build
  escapes in code and check the file for invisible characters afterwards.

## Known Issues
- People browse has no rate limit, and the person-card score lets an owner infer hidden seeker fields by editing
  the room (pending Gilad, Next Steps 1).
- Join, leave and remove publish no chat event; open threads refresh their members on window focus only.
- A resumed listing whose `expires_at` has passed returns `status: "active"` (the web shows it as expired).
- An owner can accumulate unlimited paused listings; no total-rows cap yet.
- `/areas` blocks on a *hung* Postgres via pooled connections; `/` has no `<h1>`.
- Design artboards reference a missing `design/screens-v1/support.js`.
- GitHub branch protection unavailable on this plan.
- Local parallel `make e2e` flakes under heavy load (0009h saw 5 failures at load ~30 with four stacks up); CI e2e is
  the gate now, local e2e is optional.
- GitGuardian incident 40007526 (fake fixture token) flags every PR that merges main until marked false positive.
- The Mac rebooted under load on 2026-11-12 (~17:26); Docker Desktop does not auto-start — `open -a Docker`.

## Environment & Commands
Prereqs: Docker Desktop, `uv`, Python 3.12, Node 22 (`nvm use 22`; some shells default to 20) + `pnpm`, `gh`
logged in.

    make dev        # db+redis → migrate → seed → api+worker+web → waits on /health and :$WEB_PORT
    make dev-api    # same without web
    make down       # compose down -v, empties .outbox/
    make test       # pytest + vitest      make lint   # ruff, mypy --strict, eslint, prettier, tsc
    make migrate    # alembic upgrade head
    make client     # regenerate web/src/api/schema.d.ts
    make i18n-check # hardcoded copy / missing keys
    make build-web  # vite build
    make e2e        # playwright against the stack, E2E_SHARDS (default 3) shards, rl:* flushed before each

Env var names: see `.env.example`. A worktree gets its own `.env` with `COMPOSE_PROJECT_NAME=rent-app-NNNN` and
unique `DB_PORT`/`REDIS_PORT`/`API_PORT`; Slice 9 uses 5480–5500 / 6430–6450 / 8050–8070 and `WEB_PORT` 5191–5211 (start above those). The
shared `rent-app` stack in the main checkout runs on 5434/6380/8000 with no `.env` file, so pass
`DB_PORT=5434 REDIS_PORT=6380` to `make migrate` there. Web at http://localhost:$WEB_PORT (must be `localhost` — CORS; `WEB_ORIGIN` follows `WEB_PORT`).
Login locally: the code is in the newest `.outbox/*.json`.

## Session History
- 2026-11-12 (evening) — Orchestrator session `local_2b79d58f…`: took over from `local_f7f3bc91…`; merged 0009l,
  0009t, 0009i, 0009qa, 0009a, 0009qb (PRs #47–#52); started 0009e/g/m/k. Gilad: 0009qb merged with a GitGuardian
  false positive, same OK for that incident on later PRs; no new builds after 0009k. Mac rebooted mid-session.
- 2026-11-12 — Slice 9 orchestrator session: locked all 21 Slice 9 specs, prepared 21 worktrees, built and merged
  0009b/d/c/f/h (PRs #42–#46) plus the `WEB_PORT` infra PR #41. Gilad: quick route for cosmetic specs, max 3 builds at
  a time, separate web ports, CI e2e back on under supervision, 0009b slash forms (a), 0009f offline fail-fast (a).
  Open: 0009t map-pin question.
- 2026-11-11/12 — Slice 8 orchestrator session (Gilad delegated merging): locked 0008a–0008f, pre-started six build
  sessions in their own worktrees; 0008b ∥ 0008c ∥ 0008d after 0008a's PR, then 0008e, then 0008f; merged PRs
  #35–#40. Gilad chose: declined applicants cannot join (409 `declined`), re-apply after decline later, hold merges
  during the GitHub Actions outage. The orchestrator decided neutral person-card chips, the 3-shard e2e, and spec
  amendments moving the invite token into the URL fragment (0008e) and handling stale members / 404 in a chat
  (0008f). All 0008 worktrees and branches removed.
- 2026-11-11 — Slice 7 orchestrator session (Gilad delegated the slice): built and merged 0007a–0007g (PRs
  #28–#34) through seven pre-started build sessions; Gilad chose room privacy (b).
- 2026-11-11 — Slice 8 planning session: specced and verified 0008a–0008f (b0ecec5); Gilad's Slice 8 batch in
  PRODUCT.md "People & likes" and "Flatmates".
- 2026-11-11 — Slice 6 orchestrator session: built all of Slice 6; Gilad chose the apply-time snapshot for the
  0006c budget leak; CI e2e switched off and e2e moved to local.
- 2026-11-11 — Slice 5 build session and planning sessions for Slices 5–7 (SSE chosen for chat push).
- 2026-11-10 — Slices 1–4 specced, built and merged (PRs #1–#17); Speed rules 1–10 adopted; CI tiered.
- 2026-11-08/09 — Repo initialised from the agent kit; spec 0000 written, split and verified; 0000a merged.
