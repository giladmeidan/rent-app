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
**Slice 9 + 9b is complete**: all 21 specs `0009a`–`0009u` (no `0009n`) are merged and `status: done` on `main`
(last: 0009s, #62, merge 36ce546). No PRs open, no build sessions running, no spec worktrees left.
**Slice 9c (map) is complete**: `0009v`–`0009y` merged and `status: done` on `main` (PRs #63, #65, #66, #67;
last merge 9db5cc8, status 1d2f9b1). Main's ac9 timeout is fixed with `test.slow()` (#64) and `make e2e` now runs
4 shards (OTP cap). No map PRs open, no map build sessions running, no map worktrees left.
**Slice 10 "שוק השותפים" (the roommates market): all 11 specs `0010a`–`0010k` are written and `verified` on
`main` (d856e38); nothing is built.** Spec split, migration chain (`0013`–`0017`) and build waves are in
`specs/MARKET-PLAN.md` section 7. Gilad starts the Slice 10 builds himself in a new chat. Alembic head on `main`
is still `0012`. Spec status on `main` is the source of truth; `git log` beats this file.

Last updated:
2026-11-13 (map orchestrator `local_671e0f86…`: Slice 9c built and merged)

## Current Work
- **Slice 10 specs done, builds not started.** Waves, at most 3 builds at a time:
  `0010a` ∥ `0010d` → `0010b` ∥ `0010g` ∥ `0010j` → `0010c` ∥ `0010e` → `0010k` ∥ `0010f` → `0010h` → `0010i`
  (each spec's `depends_on` is authoritative). The map chain is done, so all 3 slots are free.
  Specs, briefly: a = the move (two-way switch, `/market`, `/market/mine`, apartments-only search, no type switch
  on edit); b = role-free market (`is_mine`, signup from the market, seeker rule); c = profile split (personal +
  "looking for", migration `0015`); d = listing photos API (R2 / file store, deps `python-multipart`, `Pillow`,
  `boto3`, migration `0013`); e = wizard photo step; f = flat profile (room facts, flatmates shown as people,
  `0016`); g = direct chat (conversations get their own id, `0014`); h = people browse API (`person_pairs`,
  `card_id`, `0017`); i = people browse web; j = person photo API; k = photo display web (gallery, `Avatar`).
- Slice 10 planning worktree: `../rent-app-0010-spec` (branch `docs/0010-planning`, at d856e38, clean). The four
  spec sessions (`local_3afd2925…`, `local_0fefa23d…`, `local_d3f25b94…`, `local_c433ada8…`) are finished; archive
  them. `../rent-app-map-spec` is removed (map job done).
- No build sessions running. The last orchestrator, `local_386fe896-61ea-40ed-a5cd-591bbe83cfaf` ("Specs without
  collisions"), ran 0009j/o/p/r/s/u (PRs #57–#62) and merged them; their worktrees and branches are removed.
  The older orchestrator `local_2b79d58f…` merged 0009e/g/k/m (#53–#56) and is retired.
- **ac9 e2e timeout: decided and fixed** (Gilad 2026-11-13): `test.slow()` on ac9, PR #64 (merge 41ca6b9); the
  split into smaller tests is a FOLLOWUPS line. Since then ac9 has passed on every run.
- **e2e shards = 4** (0009y, PR #67): at 28 tests the 3-way split put 11 sign-ups in one shard, past the OTP cap of
  10 per IP per 15 min. A spec that adds sign-ups should count them per shard (`playwright test --list --shard`).
- Starting a build (for the next slice): prepare the worktree + `.env`, then `start_session` with `cwd` = worktree,
  `use_worktree: false`, `user_asked`, only in a turn Gilad wrote. Brief template = the 0009j–0009u briefs in the
  orchestrator transcript `local_386fe896…` (each says: merge `origin/main` first, rebuild the web container, the
  route and models, **no local e2e**, siblings and shared files, one push with `ready-to-merge`, report to the
  session that started it, `make down` last).
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
- Main checkout `../rent-app` (at 287c8d5, behind `main`) still holds someone's uncommitted demo-seed work
  (`Makefile`, `api/scripts/seed_demo.py`) and runs the shared `rent-app` stack. Leave it to its owner.

### Map improvements, Slice 9c (2026-11-13: done)
- Four web-only specs from `specs/map-research/` and Gilad's seven map decisions (PRODUCT.md row "Map"), built as a
  chain by orchestrator `local_671e0f86…` (Gilad: two at a time, orchestrator merges): `0009v` pins (tiers,
  liked/applied/seen marks, clusters, axe pin exemption gone; MapLibre controls drawn above pins) — #63 →
  `0009w` card inside the map, `c`/`z`/`pin` in the URL, fit to results — #65 → `0009x` side map from 1280 px —
  #66 ∥ `0009y` locate me (snapped ~200 m), places list, empty-area action, honest 300 m circle + map link — #67.
- One review round each, 0 blockers left; minors in `specs/FOLLOWUPS.md` (0009v/w/x/y lines, incl. the root cause
  of the `map_max_zoom_never_422_on_390px` flake after 0009w's first-open fit). Each PR's digest is on GitHub.
- For Slice 10: `SearchPage.tsx`, `ListingPage.tsx`, `ListingCard.tsx`, `ResultsList.tsx`, `MapCanvas.tsx`,
  `useLogout.ts` and `he.json` changed a lot; market specs that cite their old line numbers must re-check them.
  `/market` reusing `SearchPage` gets pins, card, URL position and side map for free. `map.spec.ts` uses an auto
  tile fixture (`newTileContext` for extra browser contexts) and `domcontentloaded` gotos.
- OSM tiles now load on every wide-desktop list view (0009x); the Protomaps switch must happen before launch
  (Slice 13 queue).

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
- [x] Slice 9 rest (orchestrator-merged, all CI api/web/e2e green on the PR head): 0009e PWA — #53; 0009g state
  polish — #54; 0009k listing wizard — #55; 0009m login/signup — #56; 0009p people — #57; 0009j listing page — #58
  (its layout e2e step lives in `search.spec.ts::ac9`); 0009u desktop inbox — #59; 0009r profile — #60; 0009o my
  listings — #61; 0009s chat — #62 (full route, 0 blockers / 0 majors, 11 minors → 8 FOLLOWUPS lines).
- [x] CI e2e re-enabled (2026-11-12): `main`'s full suite green in CI (run 43227959268); #45 and #46 merged with CI e2e green.
- [x] Slice 9c map (orchestrator-merged, all CI api/web/e2e green on the PR head): 0009v pins — #63 (d7b977f);
  0009w card + URL — #65 (f986008); 0009x side map — #66 (bc4813f); 0009y map extras — #67 (9db5cc8). Infra:
  ac9 `test.slow()` — #64 (41ca6b9); `E2E_SHARDS` 3 → 4 inside #67.
- [x] Gilad's decisions are in `specs/PRODUCT.md` (rows "Listings", "Search", "Applications", "Chat", "Matching",
  "Rooms", "People & likes", "Flatmates", …).

## Next Steps
1. **Build Slice 10** (Gilad, in a new chat): prepare a worktree + `.env` per spec (`../rent-app-0010a`, own
   `COMPOSE_PROJECT_NAME`, ports above the Slice 9 ranges, own `WEB_PORT`), then pre-start the wave's build
   sessions in a turn Gilad wrote and send each its "go". First wave: `0010a` and `0010d`. Model per spec: Opus/high
   coder for `0010b/c/d/f/g/h/j` (auth, migrations, uploads, chat); reviewers per each spec's frontmatter. Briefs:
   no local e2e, merge `origin/main` first, one push with `ready-to-merge`, `make down` last. A migration spec
   merges only when its `down_revision` is `main`'s head (the chain in section 7).
2. **Rewrite PRODUCT.md rows** the market contradicts before 0010a merges: "Rooms", "People & likes", "Listing edit",
   "Search", "Account roles", and record Gilad's 2026-11-13 answers: seeker = seeker account or filled "looking
   for" part; after a removed match the two may match again; a lister with no visible card browses but cannot
   like people (403 `card_required`); a lister who says "I live here" shows as a full card (name, photo, age,
   gender, about me, answers) to seekers only — an exception to "Search" (no owner name) and "Applications"
   (owner hidden until chat). Then send Gilad the Slice 10 spec digest.
3. Send Gilad a Slice 9 digest (21/21 merged; the FOLLOWUPS each spec added). Listing renewal moves with trust to
   Slice 11.
4. Ask Gilad to mark GitGuardian incident 40007526 as a false positive.
5. **Supervise CI e2e** on every merge; on a runner failure `gh variable set E2E_IN_CI --body off` and tell Gilad.
6. FOLLOWUPS from Slice 9 (pin clustering and desktop map pairing are closed by 0009v / 0009x): range tags "3–4" render
   4–3 under RTL bidi — a native reader's call (0009i), brand-voice sweep of slash forms (0009b), tabs row has no
   scroll cue at 390 (0009l), plus the minors 0009j/k/m/o/p/r/s/u logged (0009s: 8 lines).
7. Gilad's open Slice 8 decisions (FOLLOWUPS "pending decision"): person-card score inference, people-browse rate
   limit; re-apply after decline (own later spec).
8. Housekeeping: archive the finished Slice 9 and 9c build sessions (9c: `build-0009v/w/x/y`, `fix-ac9-slow`,
   started from `local_671e0f86…`); remove the planning worktrees
   `../rent-app-0008-spec`, `../rent-app-0009-spec`; decide on `qa-live-2026-11-10/`; update `CLAUDE.md` Speed rule 7
   to "no local e2e" (it still says local `make e2e` is optional).
9. Send Gilad a Slice 9c digest (4/4 merged, the FOLLOWUPS lines, the OSM tile load from the side map).

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
- `specs/MARKET-PLAN.md` — the Slice 10 market plan: decisions, build order, code findings, 23 answers. Not a spec.
- `specs/PRODUCT.md` — standing decisions; Slice 8 rows "People & likes" and "Flatmates"; row "שוק השותפים".
- `specs/FOLLOWUPS.md` — open deferred minors and pending decisions (append-only; conflicts keep both sides).
- `specs/0008a-people-likes-api.md` … `specs/0008f-group-chat-web.md` — Slice 8 (done), each with its build digest
  and the orchestrator's amendments.
- `specs/0009*.md` + `specs/0009-brand-amendment.md` — Slice 9 (done), each with its digest.
- `web/e2e/applications.spec.ts` — `ac9_fill_profile_apply_withdraw`, marked `test.slow()` (split pending).
- `Makefile` `e2e` target — the 4-shard run with the rate-limit flush (CI runs it; not locally).
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
- Market (Slice 10, Gilad 2026-11-13): two top-level tabs, דירות and שוק השותפים; rooms leave the main search; no
  owner/seeker roles inside the market; people browse people, a mutual like opens a direct chat; photos (rooms,
  people, apartments) on Cloudflare R2 with unguessable addresses; no apartment/room switch on edit; flatmate
  ages and answers stay seekers-only; the profile splits into a personal part and a "looking for" part; a
  flatmate is shown on a room's page only by their own choice; report button waits for Slice 11. The `listings`
  table stays shared (orchestrator's stance, not challenged). Full list: `specs/MARKET-PLAN.md` sections 1 and 6.
- Merging: Gilad merges PRs or delegates a slice (Slices 7 and 8 were delegated). The orchestrator merges with
  `gh pr merge N --merge --match-head-commit <full sha>` only after `api` + `web` + `e2e` are green in CI on that
  head and the PR merges cleanly, and holds merges while GitHub Actions is down (Gilad, 2026-11-11). Slice 9 + 9b
  merging was delegated too.
- e2e runs **only in GitHub CI** (Gilad 2026-11-12 evening: "lets not make e2e locally only on git hub ci"):
  merges need `api` + `web` + `e2e` green in CI on the PR head; no local `make e2e` / Playwright e2e (Gilad allowed
  one-off local trace runs only by explicit OK). Lint, unit tests, i18n-check, build-web and `make screens` stay
  local. Fallback if runners break: `gh variable set E2E_IN_CI --body off` and ask Gilad.
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
  the room (pending Gilad, Next Steps 7).
- Join, leave and remove publish no chat event; open threads refresh their members on window focus only.
- A resumed listing whose `expires_at` has passed returns `status: "active"` (the web shows it as expired).
- An owner can accumulate unlimited paused listings; no total-rows cap yet.
- `/areas` blocks on a *hung* Postgres via pooled connections; `/` has no `<h1>`.
- Design artboards reference a missing `design/screens-v1/support.js`.
- GitHub branch protection unavailable on this plan.
- ac9 (`applications.spec.ts`) needed `test.slow()` because `GET /areas` stalls on slow runners; why `/areas` is
  slow in CI is unconfirmed (CI keeps no trace artifact).
- `map.spec.ts::map_max_zoom_never_422_on_390px` flaked once on `main` after 0009w (f986008); 0009y made the test
  open at a fixed position. Root cause (first-open fit racing the zoom clicks) is a FOLLOWUPS line.
- The Mac's load reaches 25–50 with three build stacks plus coders up; local e2e under that load flakes (another
  reason it is CI-only).
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
    make e2e        # playwright against the stack, E2E_SHARDS (default 4) shards, rl:* flushed before each

Env var names: see `.env.example`. A worktree gets its own `.env` with `COMPOSE_PROJECT_NAME=rent-app-NNNN` and
unique `DB_PORT`/`REDIS_PORT`/`API_PORT`; Slices 9 + 9c used 5480–5504 / 6430–6454 / 8050–8074 and `WEB_PORT` 5191–5215 (start above those). The
shared `rent-app` stack in the main checkout runs on 5434/6380/8000 with no `.env` file, so pass
`DB_PORT=5434 REDIS_PORT=6380` to `make migrate` there. Web at http://localhost:$WEB_PORT (must be `localhost` — CORS; `WEB_ORIGIN` follows `WEB_PORT`).
Login locally: the code is in the newest `.outbox/*.json`.

## Session History
- 2026-11-13 — Map orchestrator `local_671e0f86…` ("Map job specs implementation"): pushed the 9c specs (397ad44),
  pre-started four builds chained v → w → x ∥ y (two at a time, Gilad); Gilad delegated 9c merging and picked
  `test.slow()` for ac9 (#64). Merged #63, #65, #66, #67; 0009w's long map test was split after a CI timeout,
  0009y raised `E2E_SHARDS` to 4. All map worktrees and branches removed, `docs/map-planning` too.
- 2026-11-13 — Slice 10 spec session: verified the plan's code facts (three explorers), Gilad answered the seeker
  rule, unmatch and lister-card questions; wrote the split + shared contract (MARKET-PLAN §7, 2cf09bc); four spec
  sessions wrote and verified the specs; the verifier forced three splits (d→d+j, e→e+k, h→h+i), so 11 specs;
  pushed d856e38. Moved Slice 10 planning to `../rent-app-0010-spec` so the map job has `../rent-app-map-spec`.
- 2026-11-13 — Market planning session: Gilad pushed trust back and made "שוק השותפים" Slice 10. Brainstormed the
  scope, ran five read-only explorers over the code, checked R2's free tier and upload limits, wrote
  `specs/MARKET-PLAN.md` and the PRODUCT.md row; Gilad answered all 23 questions. No specs, no code; docs pushed to `main`.
- 2026-11-12/13 — Orchestrator session `local_386fe896…` ("Specs without collisions"): checked the remaining six
  specs for file collisions, ran them 3 at a time (0009j, then 0009p, 0009u, then 0009o, 0009r, 0009s), merged
  PRs #57–#62 and cleaned up. Gilad: e2e only in GitHub CI from now on. 0009j's ac9 CI failure turned out to be
  runner speed (0009u failed the same test); 0009j moved its step to `search.spec.ts`. Left main's ac9 timeout open.
- 2026-11-12 (evening) — Orchestrator session `local_2b79d58f…`: took over from `local_f7f3bc91…`; merged 0009l,
  0009t, 0009i, 0009qa, 0009a, 0009qb, 0009e, 0009g, 0009k, 0009m (PRs #47–#56; #56 after one e2e flake rerun,
  an `/areas` GET timeout in `applications.spec`). Gilad: 0009qb merged with a GitGuardian
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
