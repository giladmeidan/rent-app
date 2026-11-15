---
id: 0013d
title: Before launch, `make screens` is green again, the five e2e tests that time out on a loaded Mac do less work, and the sign-up and map flakes wait on real signals
status: in-review
depends_on: []   # touches test code only (web/e2e, web/e2e/screens); the product-code minors of the same sweep are 0013g
reviewers: [code, qa, ux]   # code: shared e2e helpers (19 signUp call sites); qa: the flake fixes and the e2e evidence; ux: the three new screens states (FOLLOWUPS 0010b, 0014b) are what ux never saw. No security: no product code
estimate: 1 coder run   # coder Opus/medium: the flake fixes are verified only in CI (no local e2e), so the diagnosis has to be right first time (Speed rule 6, "when in doubt, the stronger one"); the screens mocks are mechanical
---

## Goal
Before launch, the two test suites people rely on tell the truth again: `make screens` (the mocked visual check,
one screenshot per UI state at 390×844 and 1440×900) passes every state, and the e2e failures logged in
FOLLOWUPS stop recurring. Each flake gets the fix that removes its cause: a wait on the real signal, or less
work in the test. No timeout gets longer. PRODUCT.md "Launch (Slice 13)": "a pre-launch cleanup sweep
(`make screens` green, flaky e2e, Slice 11/12 review minors)". The review minors are spec `0013g`.

## Scope
**In** (test code only: `web/e2e/` and `web/e2e/screens/`; no file under `web/src/`, `api/` or `infra/`):

1. **`make screens` green.** The command runs `playwright test -c playwright.screens.config.ts` against the vite
   server alone (`make dev` for the web; every API request is answered by the script, and an unmatched request
   fails the state). It is not part of CI, so it runs locally (the coder runs it; it is not e2e: spec 0011b
   "`make screens` locally is fine (mocked API)"). The known red states (FOLLOWUPS 0010f, "26 screens states
   fail", down to about 20 by the handoff; 0014b's run counted 24) and their causes:
   - **`people.screens.ts`, all 9 states × 2 projects** (`loading`, `error`, `not-found`, `not-live`, `empty`,
     `list`, `disclosures-open`, `page-alert`, `inline-error`): the page also asks `GET /me/likes` (FOLLOWUPS
     0010f; today's caller is `useMyLikes`, e.g. the nav's `MarketMineNavLink.tsx`), which `mockApi` does not
     answer. Answer it with
     `{ liked_me: [] }` as `market-people.screens.ts:205` does, plus any other request the run lists as unmatched.
   - **`seeker-lists.screens.ts` `04-applications-five` × 2**: `FIVE_APPLICATIONS` (`fixtures-seeker.ts`) mixes
     listing types, and `/me/applications` shows apartment applications only since 0010a
     (`MyApplicationsPage.tsx:232`, `type = 'apartment'`), so the page has fewer than 5 articles. Make the five
     fixtures apartments (`ROOM_APPLICATIONS`, `seeker-lists.screens.ts:89`, already maps them to rooms for the
     market's list).
   - **Anything else the first run shows red.** The coder's first step is a baseline `make screens` on the
     branch point; every red state is listed in the PR body with its cause and its fix. A state is fixed by
     updating its mock or fixture to today's API (`web/src/api/schema.d.ts` after `make client`); the `act`
     assertions change only when the UI they assert changed on purpose (name the spec that changed it). A state
     is deleted only when its UI no longer exists, and the PR body names it.
2. **Three new screens states**, for the screens no reviewer has seen at 390 px (FOLLOWUPS 0010b line 200,
   0014b line 251), in the existing files and mocks, with `spec: '0013d'` (output `web/screens/0013d/`):
   - `market-mine` in `my-listings.screens.ts`: `/market/mine` with one live room and one room application, so the
     listings and the applications (`market.mine.tabs`) both have content (the file's `State` gains an optional
     `path`, default `/me/listings`; both parts' API requests are answered there);
   - `closure-dialog` in `my-listings.screens.ts`: the closure question open after "השהיה" on a live apartment, with
     "rented through homie" chosen so the optional final-rent field shows (`ClosureDialog.tsx`, spec 0014b);
   - `apartment-facts` in `listing.screens.ts`: a listing page whose apartment has all four 0014b facts and a
     `shelter` (spec 0015a) set.
3. **Sign-up waits for the code request, not 5 seconds** (FOLLOWUPS 0011d line 275, `market ac18`, twice on
   shard 4). `signUp` (`web/e2e/helpers.ts:74–76`) clicks "שליחת קוד" and then asserts the code field is
   focused with the default 5 s `expect` timeout. The field appears only after `POST /auth/otp/request` answers
   with 204. Two causes fit; **the coder settles which one first**, before writing the fix:
   - **(a) shard 4 runs out of codes (likelier).** Playwright splits whole files: shard 4/4 of main's 36 tests is
     `market` (3 sign-ups), `people-market` (2), `people` (2), `photos` (2), `reports` (2), `search` (1) = 12
     OTP requests, against `OTP_RATE_LIMIT_IP = 10` per 15 min (`api/app/services/auth.py:39`). `make e2e`
     clears `rl:*` (`RL_FLUSH`) only before a shard and before its retry, which matches "failed on shard 4,
     passed on the shard's retry". A refused request (429) leaves no code field, giving the logged 5 s failure.
     All three 30 s timeouts in FOLLOWUPS 0014d line 274 were on shard 4 as well.
   - **(b) the answer is slow on a loaded Mac**: the 204, which writes the outbox file, takes more than 5 s.

   Evidence: the failed job's log and trace (`gh run view 43706809406 --log-failed`, and run 43710380085), which
   show whether the code request answered 429 or a slow 204; and `pnpm exec playwright test --list --shard=N/4`
   for N = 1–4, which counts each shard's sign-ups. The PR body records both.
   - **Either way:** a helper `requestCode(page)` in `helpers.ts` clicks the button while `page.waitForResponse`
     waits for that POST (method and path matched exactly), asserts the response is 204, then asserts focus. A
     budget overflow then fails with a clear 429 instead of a 5 s focus timeout. Every copy of the pattern uses
     it: `helpers.ts` `signUp`, `auth.spec.ts:21`, `auth.spec.ts:94` (the focus assertions), `flatmates.spec.ts:88`
     and `listings.spec.ts:31`. (`search.spec.ts:36` goes away with Scope 4's `signUpApi`.) `auth.spec.ts:53`
     asserts only visibility after a refused request; it stays as it is unless it follows a send-code click whose
     answer it should await (coder's call, named in the PR).
   - **If (a):** in the root `Makefile`, `E2E_SHARDS ?= 4` becomes `E2E_SHARDS ?= 6` (orchestrator's choice,
     2026-11-15: shards run one after another in one job, so each extra shard costs only Playwright's start-up).
     Its `shortcut:` comment is updated with the largest per-shard sign-up count from `--list --shard=N/6`, which
     must be at most 8, leaving 2 codes spare for the suite to grow. Scope 4's `signUpApi` still requests a code
     per sign-up, so it saves no budget.
4. **The five tests that hit Playwright's 30 s test timeout on a loaded Mac** (FOLLOWUPS 0014a line 247 and
   0014d line 274: `inbox ac12`, `likes ac9`, `people-market ac19`, `search ac9`, `people ac10`; both runs
   passed on a quieter Mac). The cause is load: two or three build stacks beside CI (CLAUDE.md rule 8; memory
   "e2e times out when 3 stacks load the Mac"). It is not a product bug. These tests sign up two or three
   people through the UI, and each signup is a page load, two form submits and an outbox poll under software
   WebGL. Fix: less work, same assertions:
   - a helper `signUpApi(page, role, { name, market })` in `helpers.ts`: `POST /auth/otp/request` and
     `POST /auth/otp/verify` (with `profile: { display_name, role }`) through `page.request`, whose cookie jar is
     the page's context, so the page is signed in. It reuses `latestCode`, asserts the verify answer is 201 with the
     `display_name` and `role` it sent (a new account's `UserOut`), and returns the address, as `signUp` does. It does not navigate: the caller `goto`s where the test continues (`signUp` ended on the role's home).
   - In those five tests, every person whose signup is not what the test is about signs up with `signUpApi`;
     `search ac9`'s inline owner signup (`search.spec.ts:31–44`) becomes `signUpApi(page, 'owner')`. The UI
     signup stays covered by `auth.spec.ts`, `market.spec.ts` (`market: true`), `applications.spec.ts`,
     `flatmates.spec.ts`, `listings.spec.ts` and `reports.spec.ts`, which keep `signUp`.
   - No `test.slow()`, no `test.setTimeout`, no larger `expect` timeouts: those hide a real hang as well.
5. **The map's zoom-out loop** (FOLLOWUPS 0014c line 263, `map.spec.ts` `ac8_visitor_finds_a_listing_on_the_map`
   › `ac10_bubble_zooms_in`; it failed in a run and again in its shard retry, then passed on a hand re-run).
   Cause: each "הקטנה" click starts MapLibre's eased zoom from the *current, still animating* zoom. Under slow
   software-WebGL frames a click lands mid-animation, so 20 clicks can end above the minimum zoom, and the
   button is still enabled. Fix: that test runs with reduced motion (`page.emulateMedia({ reducedMotion:
   'reduce' })` before the step, or `test.use` scoped to it). MapLibre then skips the animation
   (`MapCanvas.tsx:361` and `:437`: "MapLibre skips the animation under `prefers-reduced-motion`"), so each click is a
   whole level and the bubble's zoom-in is a jump. The 20-click bound and the assertions stay. Other map tests
   keep normal motion.

**Out:**
- Product-code minors of the sweep (photos past expiry, 429 "try again in…" texts, worker log level, the
  `not_suspended` module): spec `0013g`.
- Running `make screens` in CI: it writes screenshots for a person to look at, and adds minutes to the one Mac
  job (noted for the orchestrator, not a decision this spec needs).
- FOLLOWUPS 0010k line 220 (more photo e2e coverage), 0009l line 127 (an applicant card label wrapping at 390
  px), 0009d line 111 (a lint guard for arbitrary sizes), 0009z line 228 (the landing badge slot): Slice 9/10
  items, not this sweep's.
- Speeding up `latestCode` (it reads every outbox file on each poll) or `/areas` on CI (HANDOFF Known Issues):
  no evidence that either is the cause.
- Any change to the 30 s test timeout or the retry in `make e2e`. The shard count changes only as Scope 3 (a)
  says (to 6, on the trace's evidence) and nowhere else.

**New dependencies:** none.

## Data
None.

## API
None. The e2e helper calls the existing `POST /auth/otp/request` and `POST /auth/otp/verify`.

## UI
No screen changes. New screenshots only: `web/screens/0013d/{market-mine,closure-dialog,apartment-facts}-{mobile,
desktop}.png` (git-ignored). Artboards for the ux reviewer: `/market/mine` is the 0010b layout (no artboard; the
spec text is in `specs/archive/0010b-role-free-market.md`); the closure dialog and the facts follow
`specs/archive/0014b-listing-price-signals.md`, the protected space `specs/archive/0015a-listing-shelter.md`.

## Acceptance criteria
- [ ] AC1 Given the branch, When the coder runs `make screens` with the worktree's vite server, Then every state in
  every `*.screens.ts` passes in both projects (`mobile`, `desktop`), with `unmatched API requests` empty in
  each. The PR body lists the baseline's red states with cause and fix, and any deleted state with the reason —
  `make screens` (local; output in `web/screens/`)
- [ ] AC2 Given `people.screens.ts`, Then its mock answers `GET /me/likes`, and all 9 states pass at both sizes —
  `web/e2e/screens/people.screens.ts` (all states)
- [ ] AC3 Given `seeker-lists.screens.ts` `04-applications-five`, Then the page shows 5 articles at both sizes,
  and the market applications state built from `ROOM_APPLICATIONS` still passes —
  `web/e2e/screens/seeker-lists.screens.ts`
- [ ] AC4 Given the three new states, Then `web/screens/0013d/` holds `market-mine`, `closure-dialog` and
  `apartment-facts` at both sizes. `market-mine` shows the room card and the application, as a panel or as its
  tab's content at 390 px. `closure-dialog` shows the dialog's title, its three answers and the final-rent field. `apartment-facts` shows the four
  facts and the protected space type — `my-listings.screens.ts` (`market-mine`, `closure-dialog`),
  `listing.screens.ts` (`apartment-facts`)
- [ ] AC5 Given `requestCode`, Then it awaits the `POST /auth/otp/request` response (asserted 204) before
  asserting the code field's focus, and no e2e file still clicks `he.auth.sendCode` followed directly by a
  focus assertion on `he.auth.code.label` (grep in the PR body) — `web/e2e/helpers.ts`, the five call sites of
  Scope 3
- [ ] AC6 Given `signUpApi(page, role, { name })`, When it returns, Then it has asserted the verify answer: 201
  with that `display_name` and `role` (`{ market: true }` sends and checks `seeker`, as the UI market signup
  stores), and the page's context holds the session cookie, because the test's next signed-in step passes. It is
  exercised by its callers, the five tests of Scope 4, which keep every assertion they had —
  `inbox.spec.ts` ac12, `likes.spec.ts` ac9, `people-market.spec.ts` ac19, `search.spec.ts` ac9,
  `people.spec.ts` ac10
- [ ] AC7 Given `map.spec.ts` ac8, Then the `ac10_bubble_zooms_in` step runs with reduced motion and keeps its
  20-click bound, its `toBeDisabled` and every later assertion. No other map test changes its motion setting —
  `web/e2e/map.spec.ts`
- [ ] AC8 Given the PR's `ci` run, Then e2e passes, and no "Flaky e2e" warning names a test this spec touches. A
  flaky warning on any other test is logged in `specs/FOLLOWUPS.md` (rule 8). The PR body gives the durations of
  these seven tests from that run's log (the list reporter's `(12.3s)`) next to their durations in a recent
  passing run of `main` (`gh run view --log`), each with the FOLLOWUPS line it ticks: `market.spec.ts` ac18
  (0011d line 275), `inbox.spec.ts` ac12 (0014a line 247), `likes.spec.ts` ac9 (247), `people-market.spec.ts`
  ac19 (247, 0014d line 274), `search.spec.ts` ac9 (247, 274), `people.spec.ts` ac10 (274) and `map.spec.ts`
  ac8 › ac10 (0014c line 263). The screens lines (0010f line 215, 0010b line 200, 0014b line 251) are ticked
  by AC1–AC4 — CI `ci` workflow
- [ ] AC9 Given the failed runs 43706809406 and 43710380085, Then the PR body states the cause of the 0011d
  flake, (a) a 429 on the code request or (b) a slow 204, with the log or trace line that shows it, plus the
  per-shard sign-up counts from `playwright test --list --shard=N/4`. If (a): `E2E_SHARDS ?= 6`, and the
  Makefile's `shortcut:` comment states the largest per-shard sign-up count (at most 8) from `--shard=N/6` —
  `Makefile`, PR body
- [ ] NF1 No `test.slow()`, `test.setTimeout`, raised `expect` / `toPass` timeout or retry count is added
  anywhere, and the shard count changes only as AC9 allows (grep in the PR body) — review
- [ ] NF2 `make lint` and `make test` pass; nothing under `web/src/`, `api/` or `infra/` changes
  (`git diff --stat origin/main`). e2e runs in CI only: never `make e2e` locally (Speed rule 8)

## Tests to write
No new test files. The screens states (Scope 1–2) and the e2e helpers and tests (Scope 3–5) are themselves the
change. `make screens` runs locally (AC1–AC4). e2e is proven by the PR's CI run only (AC5–AC8). The coder never
runs `make e2e`. `tsc` (in `make lint`) type-checks `web/e2e/`.

## Risks / open questions
No open product question.
- **Decided (orchestrator, 2026-11-15): eight shards.** `--list --shard=N/6` put 4, 7, 2, 8, 3 and 9 codes on
  shards 1–6 (1 spare, not AC9's 2); seven shards put 10 on 4/7. `E2E_SHARDS ?= 8`: at most 7 codes (2/8 and
  7/8), 3 spare; 6/8 is empty (map.spec fills 5/8), which Playwright allows (it counts tests before sharding).
  AC9's cap of 8 stays.
- **Blind e2e changes.** The house rule (no local e2e) means the coder cannot run the changed tests before the
  push. Two things lower the risk: the helpers are small, and each test keeps its assertions. If CI fails on a
  changed test, the one allowed fix push (rule 7) fixes it; the traces are uploaded on failure
  (`playwright-traces`, kept 7 days). The flake runs named in FOLLOWUPS (43616796376, 43631807758,
  43706809406, 43710380085) may still hold traces for their *failed* jobs (`gh run download <id> -n
  playwright-traces`). Look at them first.
- **One green run proves little about a flake.** AC8 is the evidence available. The orchestrator ticks the
  FOLLOWUPS lines at merge, and any recurrence goes back in as a new line.
- **Load stays the root cause of Scope 4.** The fix makes those tests fit 30 s on a loaded Mac. It does not make a
  loaded Mac fine: build stacks still stay down while `ci` runs (FOLLOWUPS 0014a, the orchestrator's rule).
- **Overlap with 0013c / 0013f (account deletion; terms and privacy).** If either adds a consent line or checkbox to signup,
  `signUp` / `requestCode` (UI) and `auth.screens.ts` need it. `signUpApi` may need a consent field if the API
  starts requiring one. Whichever spec merges second merges `origin/main` and updates the helper (CLAUDE.md rule 3).
- **Overlap with 0013b (real client IPs, OTP lockout per email + network, per-IP read limits).** Every e2e request
  comes from one address, so a per-network OTP or read limit can start refusing the suite. `make e2e` flushes
  only `rl:*` between shards. 0013b owns that interaction; `signUpApi` adds no requests the UI signup did not
  already make.
- **Overlap with 0013a (deploy) on the root `Makefile`:** 0013a adds `deploy-*` targets; this spec may change only
  `E2E_SHARDS`. Whichever merges second merges `origin/main`. 0013c / 0013f add e2e sign-ups too; six shards
  leave room for them, and `requestCode`'s 204 assertion makes any future overflow a clear 429 failure.
- **Overlap with 0013g:** none in files (0013g changes `web/src/` and `api/`). If 0013g's new 429 texts change a
  rendered state, the screens state that asserts it moves with 0013g.
- **Reduced motion in one map test** could hide a bug that shows only with animation. None of that step's
  assertions is about animation, and every other map test keeps normal motion.

## Blast radius
`graphify affected` on main's graph (the main checkout, 2026-11-15; hits confirmed with grep).
- `signUp` (`web/e2e/helpers.ts`): imported by `applications.spec.ts`, `flatmates.spec.ts`, `inbox.spec.ts`,
  `likes.spec.ts`, `market.spec.ts`, `people-market.spec.ts`, `people.spec.ts`, `reports.spec.ts` (19 calls). It
  is also called through `signUpOwner` by `listings.spec.ts`, `map.spec.ts` (`postAtOnePrice`) and
  `photos.spec.ts`. The change inside `signUp` (Scope 3) reaches all of them. The switch to `signUpApi` (Scope 4)
  reaches only the five named tests. `api/tests/conftest.py`'s `_signup` is a different, pytest symbol and is
  untouched.
- The inline send-code-then-focus copies: `auth.spec.ts:21`, `:94` (and `:53`, see Scope 3),
  `flatmates.spec.ts:88`, `listings.spec.ts:31`, `search.spec.ts:36` (grep of `he.auth.code.label`).
- `map.spec.ts` ac8 › `ac10_bubble_zooms_in`: the one test whose motion changes. `ac10_no_marker_exemption` and
  the later steps of ac8 run in the same page, so the emulation's scope (whole test or the step) is the coder's
  call, named in the PR. Other map tests are untouched.
- Screens: `people.screens.ts`, `seeker-lists.screens.ts`, `fixtures-seeker.ts` (`FIVE_APPLICATIONS`: read only by
  `seeker-lists.screens.ts`, by its states 04 and 05 and by `ROOM_APPLICATIONS`, grep), `my-listings.screens.ts`
  (`State` gains `path`; its 8 states keep `/me/listings`), `listing.screens.ts`, plus whatever the baseline run
  lists.
- No product code, so no `web/src` or `api` caller is affected.

## Verifier findings: one round, 2 findings, both applied (2026-11-15)
I ran the `spec-verifier` checklist myself; a fork cannot start a subagent. All 11 lines were checked against this
file and `graphify affected`.
1. (line 1) AC6 was not checkable as written: "`GET /me` is 200" named no place that asserts it. The helper now
   asserts the verify answer (201 `UserOut` with the sent name and role), so every caller proves it.
2. (line 11) The `FIVE_APPLICATIONS` blast-radius line said "grep before changing it". It now names the readers
   found by grep (`seeker-lists.screens.ts` states 04, 05 and `ROOM_APPLICATIONS`).
Passed unchanged: 2 (one run: ~20 mock fixes, 3 states, 2 helpers, 6 call sites, 5 tests, 1 map line), 3–6 (no
data, endpoint, string or screen change), 7, 8 (code + qa + ux; no product code, so no security), 9, 10.

## Digest (filled by orchestrator after verification)
Spec 0013d: `make screens` green, e2e flakes fixed at the cause   (verified 2026-11-15; with 0013g)
What a user can do after this: nothing new. The visual check passes every state again, and the e2e flakes in
FOLLOWUPS stop recurring without any longer timeout.
Decisions I need from you: none.
KPIs this slice moves: launch readiness (trustworthy CI: fewer red or flaky ci runs, fewer re-runs on the Mac).
Acceptance targets: `make screens` 0 red at 390 and 1440; the PR's ci passes with no "Flaky e2e" warning on a
touched test; no `test.slow` / raised timeout / retry added (NF1); test code only (NF2).
Risks: e2e is fixed blind (no local e2e). The PR's single CI run is the proof, and the failure traces are
uploaded. Mitigation: small helpers, every assertion kept. Overlaps: a signup consent line (0013c / 0013f) and 0013b's
per-network OTP limit can change the sign-up helpers; the second to merge updates them.
Reviewers: code, qa, ux   Estimated: 1 coder run (Opus/medium), 1 review round
Links: specs/0013d-prelaunch-cleanup.md · PRODUCT.md "Launch (Slice 13)" · FOLLOWUPS 0010f (215), 0010b (200),
0014b (251), 0011d (275), 0014a (247), 0014c (263), 0014d (274)

## Verifier findings (independent, 2026-11-15)
1. (line 9 and the flake focus: diagnosis) Scope 3's cause ("the answer takes longer than 5 s on a loaded Mac") is
   not shown, and a more concrete one fits the evidence better: shard 4 runs out of OTP codes. With Playwright's
   shard split (files whole, 36 tests, `from = 27` for 4/4) shard 4 on main is `market` (3 sign-ups),
   `people-market` (2), `people` (2), `photos` (2), `reports` (2), `search` (1) = **12 OTP requests**, against
   `OTP_RATE_LIMIT_IP = 10` per 15 min (`api/app/services/auth.py:39`). `make e2e` flushes `rl:*` only before a
   shard and before its retry (`Makefile:174–177`), which is exactly "twice on shard 4, passed on the shard's
   retry". A 429 leaves step 1 showing an alert and no code field: the logged "no field within 5 s". Under that
   cause `requestCode` turns the flake into a hard 429 failure, and `signUpApi` saves no OTP request (Risks says
   so). Fix: the spec states how the cause is settled before the coder edits (the failed job's trace for run
   43706809406 or 43710380085 shows the `/auth/otp/request` status; `playwright test --list --shard=4/4` needs
   no stack) and what the coder does if it is the budget. That fix collides with Out/NF1 ("no shard change"),
   so the orchestrator picks it in the spec, e.g. `E2E_SHARDS ?= 5` (the Makefile `shortcut:` comment's own
   upgrade), or flushing `rl:otp:ip:*` per spec file. Also say whether the shard-4 30 s timeouts of 0014d
   (`people-market ac19`, `people ac10`, `search ac9`, all shard 4) are still load only.
2. (line 1 / line 10) `search.spec.ts:36` is both a `requestCode` site (Scope 3; AC5 "the five call sites") and
   the inline signup that Scope 4 replaces with `signUpApi`. Fix: drop it from Scope 3 and AC5 (four inline
   sites plus `signUp`), or say it disappears with Scope 4.
3. (line 1) AC8's "the six named tests" names none, and the Scope 3 flake (`market.spec.ts` `ac18_role_free_market`,
   FOLLOWUPS 0011d line 275) is not among the tests whose CI result AC8 checks. Fix: list them (`inbox ac12`,
   `likes ac9`, `people-market ac19`, `search ac9`, `people ac10`, `map ac8`, `market ac18`) and map each to the
   FOLLOWUPS line it ticks (0014a 247, 0014d 274, 0014c 263, 0011d 275, plus 0010f 215, 0010b 200, 0014b 251 for
   the screens). Small: `ROOM_APPLICATIONS` lives in `seeker-lists.screens.ts:89`, not in `fixtures-seeker.ts`.
Passed: 2 (one run), 3–6 (no data, endpoint, string or screen change), 7, 8 (code, qa, ux), 10, 11 (`graphify
affected` on `web_e2e_helpers_signup`, `signUpOwner`, `FIVE_APPLICATIONS` matches the Blast radius section). The
map fix (Scope 5) is concrete: "הקטנה" is MapLibre's `NavigationControl` (`map/config.ts:106`), whose zoom-out
eases from the current zoom, and reduced motion sets the ease's duration to 0.

Applied by the orchestrator (2026-11-15): 1 → Scope 3 now names both causes, the evidence the coder reads first and
the fix for (a), `E2E_SHARDS ?= 6` (AC9, NF1 and Out amended). 2 → `search.spec.ts:36` removed from Scope 3. 3 → AC8
names the seven tests with their FOLLOWUPS lines; `ROOM_APPLICATIONS` location corrected. Status set to `verified`.
