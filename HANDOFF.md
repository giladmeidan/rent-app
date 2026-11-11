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
Slices 1–6 merged. **Slice 6 (Match score) complete**: `0006a`–`0006g` (PRs #20, #21, #23, #24, #25, #26, #27;
last merge 1c8fcb8). Slice 7 (Rooms + questionnaire) is specced and verified (`0007a`–`0007g`, 1cd0253) and
is run by Gilad's own session "Slice 7 next steps": `0007a` is `in-progress` there (worktree
`../rent-app-0007a`, stack 5452/…). Alembic head on `main` is `0008`; 0007a chains `0009`. Spec status on `main`
is the source of truth; `git log` beats this file.

Last updated:
2026-11-11 (Slice 6 orchestrator session, after Slice 6 merged)

## Current Work
- Slice 6: nothing in flight. All 0006 worktrees, local and remote branches and stacks are removed.
- Slice 7: owned by Gilad's session "Slice 7 next steps" (not the Slice 6 orchestrator). Check with it before
  starting any 0007 spec elsewhere.
- **CI e2e is switched off** (Gilad, 2026-11-11): GitHub runners could not install Playwright's browser deps
  (apt/DNS), so `.github/workflows/ci.yml`'s `e2e` job is gated on repo variable `E2E_IN_CI` (set to `off`,
  2a4590f). Every web spec runs `make e2e` locally and reports it in its digest; a merge needs `api` + `web`
  green in CI plus local e2e green (Speed rules 7–8, d917d05). PRs #22–#27 merged without a CI e2e run; the last
  green CI e2e on `main` is 0cc352c (0005b). When Gilad says CI is fixed: `gh variable delete E2E_IN_CI`, drop
  the temporary sentences from rules 7–8, and run e2e on `main` before any deploy.
- Uncommitted in the main checkout, not from the orchestrator: `Makefile`, `infra/docker-compose.yml`,
  `api/scripts/seed_demo.py` (someone's demo-seed work). The shared `rent-app` stack publishes web on
  **127.0.0.1:5180** (not 5173), apparently from those edits. Leave them to their owner.

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
- [x] 0005c Chat events API — PR #19 (3700b27): one SSE stream per logged-in tab over Redis pub/sub
  (`routers/events.py`, `services/chat_events.py`). Review: 1 major fixed (an open stream blocked uvicorn
  shutdown/reload), 6 minors → FOLLOWUPS.
- [x] 0005b Chat web — PR #22 (0cc352c): chats from the header, owner inbox and "my applications", live thread,
  deposit warning. Review: 0 blockers, 1 major fixed (offline send), 6 minors fixed. **Merged with CI e2e skipped**
  (runner outage, Gilad's word); local e2e green. Slice 5 complete.
- [x] Slice 6 specced and verified: 0006a–0006g (1539061); Gilad's Slice 6 batch in PRODUCT.md "Matching".
- [x] 0006a Matching inputs API — PR #20 (a225239): `GET`/`PUT /me/profile`, apply needs a profile (409
  `seeker_profile_required`), listing fields `accepted_households` / `smoking_allowed` / `min_contract_months`,
  migration `0007`. Review: 0 blockers, 0 majors.
- [x] 0006b Match score API — PR #21 (ceda6fc): 0–100 score + top-3/top-1 reasons on `GET /listings(/{id})`
  (`api/app/matching/`), `sort=match` default for seekers with a profile, `Vary: Cookie`. Review: 0/0.
- [x] 0006c Inbox match API — PR #23 (70e937f): applicant match, reasons and a 7-field housing summary, inbox
  sorted by match; security blocker (owner bisecting a seeker's budget by editing price) fixed by Gilad's option
  (a): apply-time snapshot, migration `0008_application_listing_snapshot`. e2e skipped (outage).
- [x] 0006d Profile web — PR #24 (3139ba9): `/me/profile` form, listing page sends a seeker without a profile there
  and back before applying. e2e skipped on CI (outage), green locally. The deploy gate after 0006a is cleared.
- [x] 0006f Match web — PR #25 (1308156): "התאמה N%" on search cards and map pins, sort by match, "ההתאמה שלך"
  card on the listing page; shared `features/match` (badge, chips, reasons). CI e2e cancelled (outage), green
  locally.
- [x] 0006e Owner preferences web — PR #26 (172968c): wizard step "העדפות" (create + edit), "מה בעל הדירה מחפש"
  on the listing page (before the match card, per the artboard). e2e local 10/10.
- [x] 0006g Inbox match web — PR #27 (1c8fcb8): applicant inbox sorted by match, score, household / move-in
  line, chips and "למה ההתאמה?" disclosure. e2e local 10/10. **Slice 6 complete.**
- [x] Slice 7 specced and verified: 0007a–0007g (1cd0253), by Gilad's Slice 7 planning session.
- [x] Specs verified (one round each, findings applied): 0003c (8), 0003d (10), 0002e (7), 0002f (6),
  0004a (5), 0004b (8), 0004c (5), 0004d (7).
- [x] Gilad's decisions written: 0002a batch (c8dd4f8), 0003a 1–7 accepted ("Search" row, 194ba27), 0002d
  Unicode 16/17 gap accepted (dfc332b); "Listing edit" row — expired listings not editable, the rest of
  0002e as recommended (9202a5d); "Applications" row —
  Slice 4 Q1–Q6 accepted (231148b); 0004c Q-A (re-apply counts as new) and Q-B (owners see applicant counts
  only, never views) (e9d77dc).
- [x] Shared `rent-app` stack migrated to alembic head `0003` (search on :8000 returns 200).

## Next Steps
1. **Slice 7** is built from Gilad's session "Slice 7 next steps". Dependency order: `0007a` (in progress) →
   `0007b` and `0007d` → `0007g` (on 0007b) and `0007e` (0007a + 0007d) → `0007c` (0007g + 0007d) and `0007f`
   (0007g + 0007d). Lock a spec `in-progress` on `main` before its worktree; one web spec on 5173 at a time.
2. **When CI e2e is fixed** (Gilad says so): see Current Work — delete `E2E_IN_CI`, revert the temporary rule
   text, run `main`'s e2e and fix anything it finds before a deploy.
3. Merge each PR on Gilad's word with `gh pr merge N --merge --match-head-commit <sha>` after the rule-8 checks;
   mark `done`; remove worktree + local and remote branch (rule 10).
4. Ports: worktree stacks so far go up to 5452 (0007a); check every other worktree's `.env` before choosing.
5. If another session commits in the main checkout, `git fetch` + `git merge --ff-only origin/main` before
   branching a worktree.
6. **Pre-launch follow-ups** (FOLLOWUPS): the public `GET /listings/{id}` view counter is unthrottled; owner
   `PATCH /listings` rate limit; 0004d re-fetch on 404/409; Slice 6 minors logged by each build.
7. **Shared stack**: `DB_PORT=5434 REDIS_PORT=6380 make migrate` in the main checkout (main is at `0008`).
8. **Gilad's open decisions** (builds use the recommendation meanwhile): `0003c` Q1–Q3; `0003d` Q1–Q2; `0003b`
   1–3; `0002c` photos (R2 bucket, limits); branch protection (GitHub Pro or public repo).
9. **Shared main checkout**: several sessions work in `/Users/giladmeidan/rent_app/rent-app`. Commit only your
   own files by path (`git commit -m … -- <path>`), never `git add -A`, never stash. Chain shell steps with
   `set -e`. Starting a session from an automated turn (another session's note) with a `cwd` is refused by the
   app: ask Gilad with a button, then start it on his reply with `cwd` set to the prepared worktree.
10. Housekeeping: archive finished build sessions (0001b … 0006g) if Gilad wants; decide on
   `/Users/giladmeidan/rent_app/qa-live-2026-11-10/`; "דירתי" vs "דירה" naming (Slice 9).

## Architecture
- `api/app/`: `main.py` (app factory, exact-origin CORS with credentials, DB/Redis errors → JSON 503, a 422 handler
  that never echoes `input`), `config.py`, `db.py`, `auth.py` (`current_user` / `optional_user` / `current_owner`,
  cookie `rent_session`), `models/` vs `schemas/` (never shared; `schemas/_text.py::visible_characters_only` is the
  one text rule for city, street, description, display_name), `services/` (`auth.py`, `email.py`, `sms.py` stub,
  `listings.py` with the cap under `SELECT … FOR UPDATE`, `LISTING_TTL_DAYS = 90`; `search.py::_public_listings()`
  is the only definition of "public"), thin `routers/` (`areas`, `auth`, `health`, `listings`, `search`),
  `i18n/he.py`, `worker.py`.
- `api/alembic/versions/`: `0001`–`0008` (`0006_chat`, `0007_matching_inputs`, `0008_application_listing_snapshot`).
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
- `specs/FOLLOWUPS.md` — open deferred minors (append-only; conflicts keep both sides).
- `specs/0007a-room-inputs-api.md` … `specs/0007g-lifestyle-match-api.md` — the Slice 7 queue.
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
  deal-breakers); a seeker needs a profile to apply. 0006c (Gilad chose (a)): the owner's inbox match scores
  budget and area against the listing's price and area **at apply time** (snapshot on `applications`), so an owner
  cannot recover a seeker's budget by editing the listing; the seeker's own view stays live.
- CI e2e is off while GitHub runners are broken (repo variable `E2E_IN_CI=off`); e2e runs locally (Speed rule 7).
  Revert only on Gilad's word.
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
- 2026-11-11 — Slice 6 orchestrator session: built all of Slice 6, one session per spec (0006e and 0006g in
  parallel); merged #20, #21, #24, #25, #26, #27 on Gilad's word (#23 Gilad merged); Gilad chose the apply-time
  snapshot for the 0006c budget leak (PRODUCT.md dab5e5f); CI e2e switched off and e2e moved to local (2a4590f,
  d917d05); all 0006 worktrees and branches removed. Slice 7 handed to Gilad's own session.
- 2026-11-11 — Slice 5 build session: 0005a (PR #18), 0005c (PR #19) and 0005b (PR #22, e2e skipped on Gilad's
  word during a runner apt/DNS outage) built and merged — Slice 5 done; all 0005 worktrees and branches removed.
  In parallel the Slice 6 orchestrator session merged 0006a–0006d.
- 2026-11-11 — Slice 6 planning session (parallel to the Slice 5 build session): Gilad decided the four Slice 6
  questions (failing listings stay visible, capped at 59; profile = housing prefs only; owner wizard step with
  smoking + pets deal-breakers; profile required to apply) — written to PRODUCT.md "Matching"; specced
  0006a–0006g, one verifier round each (87 findings applied), all verified with digests (1539061).
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
