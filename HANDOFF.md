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
session's note) and refuses a proposal card with a `cwd`; the orchestrator then asks Gilad with a button and
starts the session on his reply, with `cwd` set to the prepared worktree.

## Current Status
Overall: IN_PROGRESS

Current focus:
Slices 1–2, list search (`0003a`/`0003b`), text safety (`0002d`) and web listing edit (`0002e`) are merged.
In flight: `0003c` map API build; Slice 4 specs being drafted. `0002f` is verified and will be built in a
separate session (not started by the orchestrator).

Last updated:
2026-11-10

## Current Work
- **0003c Map API** — building in session "Build 0003c — Map API" (worktree `../rent-app-0003c`, branch
  `spec/0003c-map-api`, stack `rent-app-0003c` on 5442/6388/8010, `make dev-api`). No PR yet. On merge: remove
  the worktree and branch, mark `done`, then start `0003d`.
- **0002f Expired listing read-only** (`specs/0002f-expired-listing-read-only.md`, `verified`, 9202a5d) —
  worktree prepared at `../rent-app-0002f` (branch `spec/0002f-expired-read-only`, `.env` on 5443/6389/8011);
  Gilad will build it in a different session. It is a web spec: it needs port 5173 (free now).
- **0003d Map web** (`verified`, dd9de8b) — waits for `0003c` to merge and for 5173 (not while 0002f builds).
- **Slice 4** (`0004a` apply API, `0004b` apply web) — a drafter agent is writing them; then one verifier round
  each, findings applied by the orchestrator, Gilad's questions put to him.

## Completed
- [x] Agent kit, spec 0000 split into 0000a/0000b, design artboards `design/screens-v1/`.
- [x] 0000a Foundations API — PR #1 (b00db8a). 0001a Auth API — PR #2 (87a8e64).
- [x] 0000b Foundations web — PR #3 (f5af4f3). 0001b Auth web — PR #4 (2352515): /login, /signup, AuthMenu, useMe.
- [x] 0002a Listings API — PR #5 (2bbd6a5): `POST /listings`, `GET /me/listings`, `PATCH /listings/{id}`, cap 3
  live listings, migration `0003_listings`, 90-day expiry.
- [x] 0002b Listings web — PR #6 (b5686be): `/listings/new` 3-step wizard, `/me/listings` with pause/resume.
- [x] 0003a Search API — PR #7 (475f686): public `GET /listings` (filters, sort, offset paging, total) and
  `GET /listings/{id}`; one visibility predicate; `make dev-api`.
- [x] 0003b Search web — PR #8 (3415dc4): `/search` (filters in the URL, sort, load more) and the public listing
  page `/listings/{id}`, header link "חיפוש דירות". Review: 0 blockers, 0 majors; one push.
- [x] 0002d Listing text safety — PR #9 (e09e1ad): `visible_characters_only` rejects private-use, non-characters,
  surrogates, blank letters (U+3164, U+2800 …), invisible unassigned ranges, >4 stacked combining marks;
  city/street need a letter or digit; the wizard's `cleanText` strips the same set. Security blocker found and
  fixed in the one round.
- [x] 0002e Edit listing web — PR #10 (9023687): `/me/listings/:id/edit` reuses the wizard, sends only changed
  fields. Review: 0 blockers, 0 majors; one push.
- [x] Specs verified (one round each, findings applied): 0003c (8), 0003d (10), 0002e (7), 0002f (6).
- [x] Gilad's decisions written: 0002a batch (c8dd4f8), 0003a 1–7 accepted ("Search" row, 194ba27), 0002d
  Unicode 16/17 gap accepted (dfc332b); "Listing edit" row — expired listings not editable, the rest of
  0002e as recommended (9202a5d).
- [x] Shared `rent-app` stack migrated to alembic head `0003` (search on :8000 returns 200).

## Next Steps
1. **0003c**: when its session reports the PR, ask Gilad to merge (he approves each merge); merge with
   `--match-head-commit` after `api`, `web`, `e2e` are green; clean up (rule 10).
2. **0003d**: after 0003c merges and 5173 is free (0002f not building), prepare `../rent-app-0003d` with its own
   `.env` and start `/build 0003d` (ask Gilad with a button if the turn is automated).
3. **0002f**: Gilad builds it in another session from `../rent-app-0002f`; when its PR is green, merge on
   Gilad's word and clean up.
4. **Slice 4 specs**: verify `0004a`/`0004b` once, apply findings, commit, put the questions to Gilad, then build
   `0004a` (API, parallel-safe) as soon as it is verified.
5. **Gilad's open decisions** (builds use the recommendation meanwhile): `0003c` Q1–Q3 (pin ~200 m offset;
   not-found stays in list, off map; house numbers in `street` — recommend a small spec rejecting a trailing
   number); `0003d` Q1–Q2 (same toggle on desktop now; Protomaps on R2 before launch); `0003b` 1–3; `0002c`
   photos (R2 bucket, limits); branch protection (GitHub Pro or public repo).
6. Housekeeping: archive finished build sessions (0001b … 0002e) if Gilad wants; decide on
   `/Users/giladmeidan/rent_app/qa-live-2026-11-10/`; "דירתי" vs "דירה" naming (Slice 9). The shared stack's web
   container is stopped (5173 was lent to builds); `make dev` with `DB_PORT=5434 REDIS_PORT=6380` brings it back.

## Architecture
- `api/app/`: `main.py` (app factory, exact-origin CORS with credentials, DB/Redis errors → JSON 503, a 422 handler
  that never echoes `input`), `config.py`, `db.py`, `auth.py` (`current_user` / `optional_user` / `current_owner`,
  cookie `rent_session`), `models/` vs `schemas/` (never shared; `schemas/_text.py::visible_characters_only` is the
  one text rule for city, street, description, display_name), `services/` (`auth.py`, `email.py`, `sms.py` stub,
  `listings.py` with the cap under `SELECT … FOR UPDATE`, `LISTING_TTL_DAYS = 90`; `search.py::_public_listings()`
  is the only definition of "public"), thin `routers/` (`areas`, `auth`, `health`, `listings`, `search`),
  `i18n/he.py`, `worker.py`.
- `api/alembic/versions/`: `0001_areas`, `0002_users_sessions`, `0003_listings`.
- `web/src/`: `app/` (`routes.tsx`, `Layout.tsx`), `features/areas`, `features/auth`, `features/listings` (wizard,
  `ListingCard`, `ListingPage`, `validate.ts` with `cleanText`), `features/search` (`SearchPage`, `FiltersForm`,
  `ResultsList`, `SortSelect`), `components/` (`Skeleton`, `EmptyState`, `ErrorState`, `ChoiceGroup`, `Switch`),
  `locales/he.json`, generated `api/schema.d.ts` (git-ignored, `make client`). `web/e2e/`: `smoke`, `auth`,
  `listings`, `search` + `helpers.ts`.
- `infra/docker-compose.yml`: db, redis, api, worker, web; ports on `127.0.0.1`, overridable via
  `DB_PORT`/`REDIS_PORT`/`API_PORT`; **web is always 5173**; `COMPOSE_PROJECT_NAME` isolates a worktree's stack.
- CI: `api` and `web` on every PR push; `e2e` only with the `ready-to-merge` label and on `main`; docs-only changes
  run nothing.

## Important Files
- `CLAUDE.md` — process, Speed rules 1–10, hard rules. Read first.
- `specs/PRODUCT.md` — standing decisions incl. "Listings", "Search" and "Trust (MVP)" rows.
- `specs/FOLLOWUPS.md` — ~49 open deferred minors (7 from 0003b, 3 from 0002d).
- `specs/0003c-map-api.md`, `specs/0003d-map-web.md`, `specs/0002f-expired-listing-read-only.md` — the queue.
- `design/README.md` + `design/screens-v1/*.dc.html` — artboards (reference a missing `support.js`).

## Important Decisions
- Roles: every account picks **owner** or **seeker** at signup; broker is an `account_type`. Signup collects email
  + display name only.
- OTP caps: 3 codes/15 min and 10/day per email, 10/15 min per IP, 5 guesses per code. Email: file outbox in dev,
  SMTP in prod. Cookie `SameSite=Lax` + exact-origin CORS is the CSRF posture.
- Listings: no photos until `0002c`; no drafts; expiry 90 days from creation, no renewal until Slice 10; rooms use
  apartment fields and stay hidden from search until Slice 7; the cap counts live listings only; 404 (not 403)
  for another owner's listing.
- Search (Gilad accepted, 2026-11-10): public, list first and map in `0003c`, OSM tiles now / Protomaps on R2
  later, newest-first default, `available_by` with 14 days' slack for flexible entry, no owner name, street
  without house number.
- Text safety (0002d): no `unicodedata2`; marks added in Unicode 16/17 cannot be capped on Python 3.12 —
  accepted gap, closes with a newer Python (Gilad).
- Web: product name "דירה" and system font until Slice 9; react-router 7.18.5 library mode.
- Tooling `uv` / `pnpm` (Node 22), TypeScript 5.9.
- Spec branches are updated by merging `origin/main` once pushed (force push is denied); append-only
  `FOLLOWUPS.md` conflicts keep both sides.
- Gilad merges PRs or tells the orchestrator to; the orchestrator merges with `gh pr merge N --merge
  --match-head-commit <full sha>` only after `api`, `web`, `e2e` are green on that head.

## Constraints
- Speed rules 1–10 in `CLAUDE.md`. Rule 7 changed today (Gilad): **one push per spec** — build and review fixes run
  on the local branch, then one push that opens the PR with `ready-to-merge`; re-push only for a CI failure.
- One verifier round per spec; the orchestrator applies findings and sets `verified`. High-value calls go to Gilad
  with options (rule 9); `make down` + worktree removal when a spec is done (rule 10).
- Refresh this handoff only at the end of a spec, on Gilad's request, or after a big slice rewrite.
- Orchestrator never writes application code; agents never push to `main` (orchestrator docs commits excepted).
  Never `git stash` in a shared checkout; never start/stop another checkout's compose stack. An API spec uses
  `make dev-api` while a web spec holds 5173.
- When writing specs through the shell, `\uXXXX` escapes in tool input get decoded into real characters; build
  escapes in code (`chr(92) + 'u' + …`) and check the file for invisible characters afterwards.

## Known Issues
- A resumed listing whose `expires_at` has passed returns `status: "active"` (the web shows it as expired).
- An owner can accumulate unlimited paused listings; no total-rows cap yet.
- The wizard does not mirror the >4-combining-marks rule (generic publish error); variation selectors are allowed
  up to 4 per base (FOLLOWUPS 0002d).
- `/search` desktop is one 640 px column, not the artboard's side panel + grid; one-off hex colours in auth,
  listings and search components (FOLLOWUPS).
- `/areas` blocks on a *hung* Postgres via pooled connections; `/` has no `<h1>`.
- Design artboards reference a missing `design/screens-v1/support.js`.
- GitHub branch protection unavailable on this plan.

## Environment & Commands
Prereqs: Docker Desktop, `uv`, Python 3.12, Node 22 (`nvm use 22`) + `pnpm`, `gh` logged in.

    make dev        # db+redis → migrate → seed → api+worker+web → waits on /health and :5173
    make dev-api    # same without web
    make down       # compose down -v, empties .outbox/
    make test       # pytest + vitest      make lint   # ruff, mypy --strict, eslint, prettier, tsc
    make migrate    # alembic upgrade head
    make client     # regenerate web/src/api/schema.d.ts
    make i18n-check # hardcoded copy / missing keys
    make build-web  # vite build           make e2e    # playwright against the stack

Env var names: see `.env.example`. A worktree gets its own `.env` with `COMPOSE_PROJECT_NAME=rent-app-NNNN` and
unique `DB_PORT`/`REDIS_PORT`/`API_PORT` (earlier specs used 5436–5440 / 6382–6386 / 8003–8007). The shared
`rent-app` stack in the main checkout runs on 5434/6380/8000 + web 5173 with no `.env` file, so pass
`DB_PORT=5434 REDIS_PORT=6380` to `make migrate` there. Web at http://localhost:5173 (must be `localhost` —
CORS). Login locally: the code is in the newest `.outbox/*.json`.

## Session History
- 2026-11-10 (late night) — 0002e built and merged (PR #10); 0003c/0003d/0002f specced and verified; 0003c build
  started; Gilad: expired listings read-only (0002f), rest of 0002e accepted; Slice 4 drafting started.
- 2026-11-10 (night) — Gilad accepted 0003a 1–7; shared stack migrated; 0003b and 0002d (new text-safety spec,
  one verifier round, 6 findings applied) built in parallel; Speed rule 7 changed to one push per spec;
  PR #8 and #9 merged on Gilad's instruction; worktrees and branches removed.
- 2026-11-10 (late) — 0002b built; 0003a/0003b specced and verified; 0003a built; PR #5, #7, #6 merged; expiry →
  90 days; `make dev-api` added; branch protection found unavailable.
- 2026-11-10 (evening) — 0001b built, merged (PR #4); 0002a/0002b specced and verified; Speed rules 2, 9, 10 added.
- 2026-11-10 — 0000b built; PR #2 and PR #3 merged; Speed rules 1–8 adopted; CI tiered.
- 2026-11-09 — 0000a merged; Slice 1 specced; 0001a built and reviewed.
- 2026-11-08 — Repo initialised from the agent kit; spec 0000 written, split and verified.
