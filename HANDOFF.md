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
Slices 1–4 merged. Slice 5 (Chat): `0005a` merged (PR #18, 04fdf29); `0005c` building; `0005b` waits for it.
Slice 6 (Match score): `0006a`–`0006g` specced and verified (1539061, digests in each spec); no build started.
Spec status on `main` is the source of truth; `git log` beats this file.

Last updated:
2026-11-11 (Slice 5 build session)

## Current Work
- **`0005c` SSE events API — building** in session "Build 0005c" (local_a2fe6706…), worktree
  `../rent-app-0005c`, branch `spec/0005c-chat-events-api` (cut from 0005a's PR head), stack `rent-app-0005c` on
  5442/6388/8009. Coder running locally, no PR yet; it merges `origin/main` before its one push and opens a
  normal PR against `main`.
- `../rent-app-0005a` worktree + local branch `spec/0005a-chat-api` are kept only until 0005c has merged `main`;
  then remove both (rule 10). Its stack is already down.

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
- [x] 0003c Map API — PR #12 (2117474): worker geocoding via Nominatim (paced, cached, paused on outages),
  approximate public point, bbox filter and `lat`/`lng` on `GET /listings`, migration `0004`.
- [x] 0002f Expired listing read-only — PR #11 (782c59f): no edit link on an expired card; the edit URL explains
  renewal comes later.
- [x] 0004a Apply API — PR #13 (0a56433): seeker applies / lists / withdraws, public applicant count, view
  counter, migration `0005`. Review: 0 blockers, 0 majors.
- [x] 0004c Inbox API — PR #14 (dabac4c): owner lists applicants, shortlists / declines; `MyListingOut` carries
  `applicant_count` and `new_applicant_count` (no `view_count`). Review: 0 blockers, 0 majors.
- [x] 0003d Map web — PR #15 (ec7d6ec): `/search` list/map toggle with price pins searching the visible area;
  approximate-area map on the listing page. Review: 1 blocker + 2 majors fixed.
- [x] 0004b Apply web — PR #16 (dc4d8b4): apply from the listing page with the applicant count, "my
  applications" with withdraw, safe `?next=` login return path. Review: 2 majors fixed.
- [x] 0004d Inbox web — PR #17 (c553950): `/me/listings/:id/applicants` with totals, filters, shortlist /
  un-shortlist / decline; applicants link on "my listings". Review: 0 blockers, 0 majors. Slice 4 complete.
- [x] 0005a Chat API — PR #18 (04fdf29): conversation per application opened on shortlist, list chats with unread
  counts, read a thread, send while shortlisted; migration `0006_chat`; chat bodies use
  `visible_characters_only`. Review: 0 blockers, 1 major fixed (invisible-only bodies), 6 minors → FOLLOWUPS.
- [x] Slice 6 specced and verified: 0006a–0006g (1539061); Gilad's Slice 6 batch in PRODUCT.md "Matching".
- [x] Specs verified (one round each, findings applied): 0003c (8), 0003d (10), 0002e (7), 0002f (6),
  0004a (5), 0004b (8), 0004c (5), 0004d (7).
- [x] Gilad's decisions written: 0002a batch (c8dd4f8), 0003a 1–7 accepted ("Search" row, 194ba27), 0002d
  Unicode 16/17 gap accepted (dfc332b); "Listing edit" row — expired listings not editable, the rest of
  0002e as recommended (9202a5d); "Applications" row —
  Slice 4 Q1–Q6 accepted (231148b); 0004c Q-A (re-apply counts as new) and Q-B (owners see applicant counts
  only, never views) (e9d77dc).
- [x] Shared `rent-app` stack migrated to alembic head `0003` (search on :8000 returns 200).

## Next Steps
1. **Slice 5**: wait for `0005c`'s PR → merge on Gilad's word → then `0005b` chat web (web spec, holds 5173;
   branch from `origin/main` once 0005c merged, or from 0005c's branch once its PR is open).
2. **Slice 6**: see item 10 (ready now: `0006a`). Before preparing a Slice 6 worktree, set the spec `in-progress`
   on `main` (commit that file by path, push) — that is the lock that stops two sessions building the same spec.
   Next free stack ports: 5443/6389/8010 (5441–5442 / 6387–6388 / 8008–8009 used by 0005a/0005c).
3. Merge each PR on Gilad's word after `api`/`web`/`e2e` are green on its head (`--match-head-commit`); mark
   `done`; remove worktree + branch (rule 10).
4. If another session commits in the main checkout, push it (`git pull --rebase` first) before branching a
   worktree from `origin/main`.
5. **Pre-launch follow-ups from Slice 4** (FOLLOWUPS): the public `GET /listings/{id}` view counter is
   unthrottled and writes a row per hit; owner PATCH rate limit (Slice 5); 0004d re-fetch on 404/409.
6. **Shared stack**: `DB_PORT=5434 REDIS_PORT=6380 make migrate` in the main checkout (main is at `0006`), then
   `make dev` with the same ports when 5173 is free.
7. **Gilad's open decisions** (builds use the recommendation meanwhile): `0003c` Q1–Q3 (pin ~200 m offset;
   not-found stays in list, off map; house numbers in `street` — recommend a small spec rejecting a trailing
   number); `0003d` Q1–Q2 (same toggle on desktop now; Protomaps on R2 before launch); `0003b` 1–3; `0002c`
   photos (R2 bucket, limits); branch protection (GitHub Pro or public repo).
8. **Shared main checkout**: several sessions work in `/Users/giladmeidan/rent_app/rent-app`. Commit only your
   own files by path (`git commit -m … -- <path>`), never `git add -A`, never stash; `git pull --rebase` fails
   while someone has unstaged edits — use `git fetch` + `git merge --ff-only origin/main` when the incoming
   files don't overlap. Chain shell steps with `set -e` so a failed step can't run the rest in the wrong folder.
   Starting a build session from an automated turn (a session's note) is refused by the app: ask Gilad with a
   button, then start it with `cwd` set to the prepared worktree.
9. Housekeeping: archive finished build sessions (0001b … 0004d) if Gilad wants; decide on
   `/Users/giladmeidan/rent_app/qa-live-2026-11-10/`; "דירתי" vs "דירה" naming (Slice 9).
10. **Slice 6 (Match score)** — specs verified, not built; committed as 1539061 with the PRODUCT.md "Matching" row.
   Build order (Speed rule 2; web specs never alongside each other or `0005b`, port 5173):
   - `0006a` matching inputs API — ready once pushed (0005a merged); migration `0007` (down `0006`); coder Opus/high.
   - `0006b` match score API — after 0006a's PR is open. `0006c` inbox match API — after 0006b's PR is open.
   - `0006d` profile web and `0006e` owner-preferences web — after 0006a's PR is open; **0006d must merge before
     any deploy after 0006a** (until then a seeker without a profile cannot apply from the web).
   - `0006f` match web (Opus/high) — after 0006b + 0006d. `0006g` inbox match web — after 0006c, 0006f, 0005b.
   - e2e OTP budget is 9 of 10 per 15 min: every Slice 6 e2e extends existing tests, no new signups.
   - Gilad's non-blocking digest calls: (1) weights budget 25 / move-in 20 / area 20 / household 10 / contract
     10 / parking 5 / smoking 5 / pets 5; (2) owners never see a seeker's budget or areas; (3) owners mostly see
     budget / move-in / area as top reasons; (4) all Hebrew copy is the orchestrator's. Builds use these meanwhile.

## Architecture
- `api/app/`: `main.py` (app factory, exact-origin CORS with credentials, DB/Redis errors → JSON 503, a 422 handler
  that never echoes `input`), `config.py`, `db.py`, `auth.py` (`current_user` / `optional_user` / `current_owner`,
  cookie `rent_session`), `models/` vs `schemas/` (never shared; `schemas/_text.py::visible_characters_only` is the
  one text rule for city, street, description, display_name), `services/` (`auth.py`, `email.py`, `sms.py` stub,
  `listings.py` with the cap under `SELECT … FOR UPDATE`, `LISTING_TTL_DAYS = 90`; `search.py::_public_listings()`
  is the only definition of "public"), thin `routers/` (`areas`, `auth`, `health`, `listings`, `search`),
  `i18n/he.py`, `worker.py`.
- `api/alembic/versions/`: `0001`–`0006` (`0006_chat`); Slice 6 adds `0007`.
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
- Chat (Slice 5, Gilad 2026-11-11): realtime is **push** — one SSE stream per tab over Redis pub/sub
  (`0005c`), chosen for very large user counts over polling and WebSockets; polling only as a fallback while a
  stream is down. A chat is keyed by its application id; sending only while `shortlisted`, thread stays readable;
  no chat notifications in Slice 5.
- Matching (Slice 6, Gilad 2026-11-11): see PRODUCT.md "Matching" — a hard-filter miss stays in results with
  score capped at 59; seeker profile = housing preferences only; owner "העדפות" wizard step (smoking and pets are
  deal-breakers); a seeker needs a profile to apply.
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
- 2026-11-11 — Slice 5 build session: 0005a built (one major fixed) and merged on Gilad's word (PR #18);
  0005c build started from 0005a's branch. In parallel another session specced Slice 6 (0006a–g, 1539061).
- 2026-11-11 — Slice 6 planning session (parallel to the Slice 5 build session): Gilad decided the four Slice 6
  questions (failing listings stay visible, capped at 59; profile = housing prefs only; owner wizard step with
  smoking + pets deal-breakers; profile required to apply) — written to PRODUCT.md "Matching"; specced
  0006a–0006g, one verifier round each (87 findings applied), all verified with digests. Not committed.
- 2026-11-11 (late) — 0004b (PR #16) and 0004d (PR #17, merged on Gilad's standing OK) merged: Slice 4 done;
  Slice 5 specs pushed; all worktrees/branches removed; main in sync.
- 2026-11-11 — Slice 5 planning session: specced 0005a (chat API), 0005c (SSE events API), 0005b (chat web), one
  verifier round each, all findings applied, verified; Gilad answered Q2–Q5 (a) and delegated Q1 (chose SSE);
  committed bd0d207 (not pushed). No builds.
- 2026-11-11 (early) — Gilad's session: 0002f built and merged (PR #11); 0004a (PR #13) and 0004c (PR #14) built
  and merged; Gilad answered 0004c Q-A/Q-B; 0003d merged (PR #15); 0004b open as PR #16; 0004d prepared.
- 2026-11-10 (after midnight) — Slice 4 specced as four specs (0004a–d), verified, Gilad accepted Q1–Q6;
  Gilad will start 0002f and Slice 4 builds in his own sessions.
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
