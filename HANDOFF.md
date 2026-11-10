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
The Claude desktop app refuses to start a session from an automated-event turn (a subagent hand-back, another
session's note); the orchestrator then asks Gilad with a button and starts it on his reply, with `cwd` set to
the prepared worktree.

## Current Status
Overall: IN_PROGRESS

Current focus:
Slices 1 (auth) and 2 (owner posts listing) are merged, and so is Slice 3's API half (`0003a`). `0003b`
(search web) is `verified` and **not started**: Gilad said "merge, don't start" on 2026-11-10. Nothing is in
flight: no open PRs, no spec worktrees, no spec stacks.

Last updated:
2026-11-10

## Current Work
None in flight. Ready to build: **0003b Search web** (`specs/0003b-search-web.md`, `verified`, both
`depends_on` merged). Start it only when Gilad says so (Next Steps 1).

## Completed
- [x] Agent kit, spec 0000 split into 0000a/0000b, design artboards `design/screens-v1/`.
- [x] 0000a Foundations API — merged b00db8a (PR #1).
- [x] 0001a Auth API — merged 87a8e64 (PR #2).
- [x] 0000b Foundations web — merged f5af4f3 (PR #3).
- [x] 0001b Auth web — merged 2352515 (PR #4): /login, /signup, header AuthMenu, useMe, Layout, routes.
- [x] 0002a Listings API — merged 2bbd6a5 (PR #5): `POST /listings`, `GET /me/listings`, `PATCH /listings/{id}`,
  cap 3 live listings, migration `0003_listings`; review fix: the 422 handler no longer echoes `input` (NaN /
  lone surrogate gave a 500 and logged the body).
- [x] 0002b Listings web — merged b5686be (PR #6): `/listings/new` 3-step wizard, `/me/listings` with
  live / paused / expired badges and pause/resume, `RequireOwner`, header "המודעות שלי", `ChoiceGroup`, `Switch`.
- [x] 0003a Search API — merged 475f686 (PR #7): public `GET /listings` (filters, sort, offset paging, total)
  and `GET /listings/{id}`, one visibility predicate (live + apartment + active area), `make dev-api`; NF2 at
  10,000 rows: every statement 5–11 ms, no index needed. Also carries the 90-day expiry change (bdf0b64).
- [x] Specs 0003a + 0003b written and verified (one verifier round each, 6 and 15 findings applied, 473b616).
- [x] Gilad's 0002a product batch written into `PRODUCT.md` (c8dd4f8): 1, 2, 4, 5, 6 accepted; expiry 3 months.
- [x] All merged spec branches deleted locally and on GitHub; all spec worktrees removed. Only `main` remains.

## Next Steps
1. **Build 0003b** when Gilad says so: from the main checkout, `git worktree add -b spec/0003b-search-web
   ../rent-app-0003b main`, write its `.env` (copy an earlier one's shape: `COMPOSE_PROJECT_NAME=rent-app-0003b`
   and unused `DB_PORT`/`REDIS_PORT`/`API_PORT`, e.g. 5439/6385/8006), start a session there running
   `/build 0003b`. Brief: open the PR against `main`; `make dev` (it is a web spec, 5173 is free); `make client`
   against its own stack; reviewers `code, qa, ux` (coder Opus/high, code Opus/medium, qa+ux Sonnet/medium);
   read the two `0003a` FOLLOWUPS entries addressed to 0003b (omit empty params; the 422 `msg` is English, map by
   type/loc); Speed rules 9 and 10.
2. **Gilad's open decisions** (each is in the spec's `## Digest`): `0003a` 1–7 (public search, list before map,
   map tiles for `0003c`, newest-first sort, entry-date meaning, no owner identity, rooms hidden while the
   wizard offers them); `0003b` 1–3 (placeholder copy, 640 px column on desktop, no apply buttons yet); `0002b`
   1–3 (already built as recommended). Write answers into `specs/PRODUCT.md` the same day.
3. **Shared stack migration**: the main checkout's `rent-app` stack DB is at alembic `0002`, so
   `GET /listings` on :8000 returns 500. Run `make migrate` (or `make dev`) in the main checkout once nobody is
   using that stack (its web container was restarted by another session at ~20:00 on 2026-11-10).
4. **Text-safety spec before launch**: listings are public since `0003a`, and FOLLOWUPS `0002a` says
   `visible_characters_only` still lets Hangul filler U+3164, braille blank U+2800 and non-characters through
   (city / street / description). Small API spec; 0002b already strips bidi marks client-side.
5. Queue after Slice 3: `0002c` photos (needs Gilad: R2 bucket on the free tier, photo count/size limits);
   `0003c` map + geocoding (needs Gilad's tile choice, see `0003a` Risks); edit listing fields in the web (API
   supports PATCH); `GET /me` exposing `listing_cap`; a total-rows cap per owner (FOLLOWUPS `0002a`). Then
   `/spec` Slice 4 (apply + inbox).
6. **Branch protection is not available**: GitHub returns 403 "Upgrade to GitHub Pro or make this repository
   public" for `main`'s protection. "Nothing merges unless api, web, e2e are green" is enforced by the
   orchestrator checking `gh pr checks` and merging with `--match-head-commit`. Enforcing it in GitHub needs
   Gilad's call (paid plan or public repo).
7. Housekeeping: archive the finished build sessions (0001b, 0002a, 0002b, 0003a) if Gilad wants a clean
   sidebar; decide whether to keep `/Users/giladmeidan/rent_app/qa-live-2026-11-10/` (7.4 MB live-QA output from
   the 0002b review, outside the repo, not created by the orchestrator); product-name mismatch — artboards say
   "דירתי", the app says "דירה" (PRODUCT.md, until Slice 9).

## Architecture
- `api/app/`: `main.py` (app factory, exact-origin CORS with credentials, DB/Redis errors → JSON 503, a 422
  handler that never echoes `input`), `config.py` (pydantic-settings, SecretStr DSNs), `db.py`, `auth.py`
  (`current_user` / `optional_user` / `current_owner`, cookie `rent_session`), `redis_client.py`, `models/`
  vs `schemas/` (never shared; `schemas/_text.py::visible_characters_only`), `services/` (`auth.py` OTP in
  Redis + sessions table; `email.py` file outbox / SMTP; `sms.py` stub; `listings.py` create / list own / patch
  with the cap under `SELECT … FOR UPDATE`, `LISTING_TTL_DAYS = 90`; `search.py` with `_public_listings()`, the
  only definition of "public"), `routers/` (thin: `areas`, `auth`, `health`, `listings`, `search`), `i18n/he.py`,
  `worker.py`.
- `api/alembic/versions/`: `0001_areas`, `0002_users_sessions`, `0003_listings`.
- `web/`: Vite + React 18 + TS strict + Tailwind 3.4 (logical props only), TanStack Query (`retry: 1`
  default), i18next (`src/locales/he.json`), `openapi-fetch` client with `credentials: 'include'` over
  generated `src/api/schema.d.ts` (git-ignored, `make client`), react-router 7 library mode
  (`src/app/routes.tsx`, `Layout.tsx`), `features/areas`, `features/auth` (`useMe`, `AuthMenu`, `OtpForm`,
  `RoleChoice`, `RequireOwner`, pages), `features/listings` (wizard, `ListingCard`, `StatusBadge`,
  `validate.ts`, `format.ts`, `constants.ts` `LISTING_CAP = 3`), `components/` (`Skeleton`, `EmptyState`,
  `ErrorState`, `ChoiceGroup`, `Switch`), `scripts/i18n-check.mjs`, `e2e/` Playwright (`smoke`, `auth`,
  `listings`, shared `helpers.ts` with the outbox code reader), unit-test harness
  `src/features/auth/__tests__/harness.tsx`.
- `infra/docker-compose.yml`: db, redis, api, worker, web; ports on `127.0.0.1`, overridable via
  `DB_PORT`/`REDIS_PORT`/`API_PORT`; **web is always 5173** (exact-origin CORS), so only one web spec
  stack runs at a time; `COMPOSE_PROJECT_NAME` in a worktree's `.env` isolates the rest.
- `Makefile`: loads optional repo-root `.env`; `dev`, `dev-api` (no web: for an API spec while a web spec holds
  5173), `down`, `migrate`, `seed`, `test` (`test-api`, `test-web`), `lint` (`lint-api`, `lint-web`), `client`,
  `i18n-check`, `build-web`, `e2e`.
- CI: `api` and `web` on every PR push; `e2e` only with the `ready-to-merge` label and on `main`;
  docs-only PRs/pushes run nothing.

## Important Files
- `CLAUDE.md` — process, Speed rules 1–10, hard rules. Read first.
- `specs/PRODUCT.md` — standing decisions, incl. the 2026-11-10 "Listings" row and 90-day expiry.
- `specs/FOLLOWUPS.md` — 38 open deferred minors (two addressed to 0003b, one text-safety item before launch).
- `specs/0003b-search-web.md` — the next build. `specs/0003a-search-api.md` — the API it consumes.
- `design/README.md` + `design/screens-v1/*.dc.html` — artboards (reference a missing `support.js`).
- `PR-0000a.md`, `PR-0001a.md`, `REVIEW-*.md` — old-process records; no new ones are written.

## Important Decisions
- Roles: every account picks **owner** or **seeker** at signup, switchable later; broker is an
  `account_type`. Signup collects email + display name only (PRODUCT.md, 2026-11-09).
- OTP caps: 3 codes/15 min and 10/day per email, 10/15 min per IP, 5 guesses per code. Email: file
  outbox in dev, plain SMTP in prod. Existing-email signup logs in (200).
- Cookie `SameSite=Lax` + exact-origin CORS is the CSRF posture; needs one registrable domain in prod.
- Listings (Gilad, 2026-11-10): artboard field list, no photos until `0002c`; no drafts (live on publish);
  **expiry 90 days from creation**, no renewal until Slice 10; rooms use apartment fields and stay hidden
  from search until Slice 7; arnona bi-monthly, vaad monthly; the cap counts live listings only; money and
  sizes are integers; 404 (not 403) for another owner's listing.
- Search (`0003a`, orchestrator assumptions pending Gilad): public, no map yet, newest-first, `available_by`
  with 14 days' slack for flexible entry, the public shape has no `owner_id` / `area_id` / `status` /
  `expires_at`, offset ≤ 10,000, no index until ~50k listings.
- Web: product name "דירה" placeholder and system font until Slice 9; design tokens from the artboards;
  react-router 7.18.5 library mode (two 6.x advisories).
- Tooling `uv` / `pnpm` (Node 22, `web/.nvmrc`); TypeScript 5.9.
- Spec branches are brought up to date by **merging `origin/main`**, not rebasing: force push is denied in the
  spec sessions. Append-only `FOLLOWUPS.md` conflicts are resolved by keeping both sides.
- Gilad merges PRs, or tells the orchestrator to; the orchestrator merges with `gh pr merge N --merge
  --match-head-commit <full sha>` only after `api`, `web`, `e2e` are green on that head.

## Constraints
- Speed rules 1–10 in `CLAUDE.md`: session per spec, every ready spec builds in parallel (only
  `depends_on` serialises; two web specs not at once locally), one review round, minors to follow-ups, no
  PR/REVIEW files, model per task, push once per round, light CI on push, **high-value calls go to Gilad
  with options (rule 9)**, **`make down` + worktree removal when a spec is done (rule 10)**.
- One verifier round per spec; the orchestrator applies findings and sets `verified`.
- Refresh this handoff only at the end of a spec, on Gilad's request, or after a big slice rewrite.
- Orchestrator never writes application code; agents never push to `main` (orchestrator docs commits
  excepted). Never `git stash` in a shared checkout; never start/stop another checkout's compose stack
  (except the rule-10 teardown after merge). An API spec uses `make dev-api`, never `make dev`, while a web
  spec holds 5173.

## Known Issues
- Shared `rent-app` stack (5434/6380/8000/5173) DB is at alembic `0002`: `GET /listings` → 500 until
  `make migrate` (Next Steps 3).
- `visible_characters_only` lets some invisible code points through in now-public listing text (FOLLOWUPS).
- A resumed listing whose `expires_at` has passed returns `status: "active"` (the web shows it as expired).
- An owner can accumulate unlimited paused listings (create → pause → repeat); no total-rows cap yet.
- `/areas` blocks on a *hung* Postgres via pooled connections (FOLLOWUPS).
- `/` has no `<h1>` since the brand became a link (Slice 9 landing adds one).
- One-off colours (raw hex) in auth and listings components instead of Tailwind tokens (FOLLOWUPS).
- Design artboards reference a missing `design/screens-v1/support.js`.
- GitHub branch protection unavailable on this plan (Next Steps 6).

## Environment & Commands
Prereqs: Docker Desktop, `uv`, Python 3.12, Node 22 (`nvm use 22`) + `pnpm`, `gh` logged in.

    make dev        # db+redis → migrate → seed → api+worker+web → waits on /health and :5173
    make dev-api    # same without web (API specs while a web spec holds 5173)
    make down       # compose down -v, empties .outbox/
    make test       # pytest + vitest      make lint   # ruff, mypy --strict, eslint, prettier, tsc
    make client     # regenerate web/src/api/schema.d.ts
    make i18n-check # hardcoded copy / missing keys
    make build-web  # vite build           make e2e    # playwright against the stack

Env var names: see `.env.example`. A worktree gets its own `.env` with `COMPOSE_PROJECT_NAME=rent-app-NNNN`
and unique `DB_PORT`/`REDIS_PORT`/`API_PORT` (none in use now; earlier specs used 5436–5438 / 6382–6384 /
8003–8005). Web at http://localhost:5173 (must be `localhost` — CORS), shared API at http://127.0.0.1:8000.
Login locally: the code is in the newest `.outbox/*.json`.

## Session History
- 2026-11-10 (late) — 0002b built in its own session; 0003a/0003b specced and verified; 0003a built;
  PR #5, #7, #6 merged by the orchestrator on Gilad's instruction (2bbd6a5, 475f686, b5686be); Gilad's 0002a
  batch answered (expiry → 90 days, applied in bdf0b64); `make dev-api` added; all spec branches and worktrees
  deleted; branch protection found unavailable on the plan.
- 2026-11-10 (evening) — 0001b built, merged (PR #4); 0002a/0002b specced and verified; 0002a build started;
  Speed rules 2 (parallel), 9 (consult Gilad), 10 (teardown) added.
- 2026-11-10 — 0000b built, reviewed once, fixed, rebased; PR #2 and PR #3 merged by the orchestrator
  on Gilad's instruction; Speed rules 1–8 adopted; CI tiered.
- 2026-11-09 — 0000a merged; Slice 1 specced; 0001a built and reviewed.
- 2026-11-08 — Repo initialised from the agent kit; spec 0000 written, split and verified.
