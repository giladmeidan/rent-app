---
id: 0017b
title: "The waitlist forms are protected by Cloudflare Turnstile, so bots cannot fill D1's free daily writes"
status: in-progress
depends_on: [0017]   # merged, PR #116
reviewers: [code, security, qa]   # security: a bot check on a public write endpoint + a new secret + a CSP change; qa: endpoint + page
estimate: 1 coder run   # small; coder Opus/high (security, Speed rule 6)
---

## Goal
After this ships, every waitlist signup carries a Cloudflare Turnstile token that the Pages Function checks with
Cloudflare before it writes to D1. A bot without a valid token never reaches the database. PRODUCT "Waitlist
(0017)"; this resolves 0017's digest decision (Gilad, 2026-11-16: "Add Turnstile now").

## Decisions this spec builds on
- Gilad, 2026-11-16: add **Cloudflare Turnstile** (free) now, rather than an insert cap or only watching
  `waitlist-stats`.
- The orchestrator chose these, inside that decision:
  - **Widget mode: managed, with `appearance: 'interaction-only'`.** Most visitors see nothing. A visitor
    Turnstile is unsure about gets a checkbox inside the form.
  - **Fail closed.** If Cloudflare's siteverify cannot be reached or answers with an error, the signup is
    refused with 503 and the page shows its existing error banner. No row is written without a verified token.
    Turnstile outages are rare, and the alternative is an open door.
  - **Token check comes after validation.** Field errors still show without spending a siteverify call on a
    token. The order is: origin/size/type guards → honeypot → validation → Turnstile → insert.

## Scope
**In:**
1. **`waitlist/lib/signup.js`**:
   - Add `verifyTurnstile(token, ip, request, env)`. It POSTs a `URLSearchParams` body with
     `secret=env.TURNSTILE_SECRET`, `response=token` and `remoteip=ip` (from `CF-Connecting-IP`, omitted when
     absent) to `https://challenges.cloudflare.com/turnstile/v0/siteverify` through the global `fetch`, with
     `signal: AbortSignal.timeout(5000)`. It returns `'ok' | 'invalid' | 'unavailable'`:
     - `'ok'` only when `success === true`, `action === 'signup'`, and `hostname === new
       URL(env.ALLOWED_ORIGIN).hostname`. When the request's own URL is a localhost origin (the existing
       `LOCAL_ORIGIN`, so only `wrangler pages dev`; Cloudflare never hands a Function a localhost URL), only
       `success === true` is required, because the test secret's dummy answer does not carry the site's action
       and hostname;
     - `'unavailable'` for a network error, a timeout, a non-2xx status, a body that is not JSON, or
       `success: false` whose `error-codes` include `missing-input-secret`, `invalid-input-secret` or
       `internal-error` (our misconfiguration or Cloudflare's fault, not the visitor's);
     - `'invalid'` for any other `success: false` (`invalid-input-response`, `timeout-or-duplicate`, …), or a
       wrong action or hostname.
   - In `handleSignup`, right after validation passes:
     - `env.TURNSTILE_SECRET` missing or empty, or one of Cloudflare's test secrets
       (`/^[123]x0{31}AA$/`) on a request whose URL is not a localhost origin → `503 {error: "server"}`, logged
       as the fixed line `waitlist: turnstile secret missing` (or `… turnstile test secret refused`). There is
       no siteverify call and the check is never skipped. (A test secret would accept any dummy token.);
     - `body.turnstile` that is not a string of 1–2048 characters → `403 {error: "challenge"}`, with no
       siteverify call;
     - `'invalid'` → `403 {error: "challenge"}`, not logged;
     - `'unavailable'` → `503 {error: "server"}`, logged as `waitlist: turnstile unavailable (<reason>)`.
       `<reason>` is one of `network`, `timeout`, `status <n>`, `body`, or the joined `error-codes`. The line
       never holds the token, the IP, the email or the phone.
   - `validate.js` needs **no change**. `validateSignup` ignores keys it does not know (it rejects only the
     lister-only keys on a seeker), so `turnstile` passes through. It is never in `result.value` and is never
     stored. The 0017 `ac9_single_validation_source` stays as is.
   - Body size: a lister body plus a 2048-character token stays well under `MAX_BODY_BYTES` (4096), so that
     limit is unchanged.
2. **`waitlist/public/app.js` + `index.html`:**
   - `app.js` adds the one third-party script itself: a `<script>` element with `src =
     'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'` and `async`, plus `onload` and
     `onerror` handlers. `index.html` gets no new `<script>` tag. `app.js` is a module, so it runs after parse,
     and the load/error events give the blocked-script case (AC9) directly. Do not use `turnstile.ready()`:
     Cloudflare documents that it does not work with an `async`/`defer` script.
   - Each form gets an empty `<div class="turnstile" data-sitekey="TURNSTILE_SITE_KEY_PLACEHOLDER"></div>`
     right after the honeypot `.hp` and before `.banner`, so the banner stays next to the submit button. `selectSide`
     renders a side's widget the first time that side's panel is shown, once the script has loaded (or right on
     load if the panel is already shown). That covers the default tab, clicks, arrow keys, the hero/door links,
     `?side=` and "the other side" after a success. The call is `turnstile.render(el, {sitekey: el.dataset.sitekey,
     action: 'signup', appearance: 'interaction-only', language: 'he', 'response-field': false, callback,
     'expired-callback', 'error-callback'})`. Keep the returned widget id for each form.
   - `callback(token)` stores the form's token. `expired-callback` drops it (Turnstile's default
     `refresh-expired: 'auto'` fetches a new one). `error-callback` drops it, marks the widget failed and returns
     `true` (handled), and a later `callback` clears the mark.
   - `submit`: after the client-side validation passes, `setBusy(form, true)` as now. If there is no token yet,
     it waits up to 10 s for `callback` with "בשליחה…" still showing; a second click stays ignored (`data-busy`).
     It then sends the body plus `turnstile: <token>`. If the script failed to load, or the widget is marked
     failed, or 10 s pass with no token, it shows the challenge banner at once and sends nothing.
   - After any answer other than 200, and after a thrown fetch, it calls `turnstile.reset(widgetId)` and drops
     the token. Tokens are single-use, and the server may have spent this one.
   - A 403 whose body is `{error: "challenge"}` shows `TEXT.challenge` = "לא הצלחנו לוודא שזה לא בוט. אפשר לנסות
     שוב." in the form's **existing** `.banner` (it already has `role="alert"`; use `setMessage` + `is-shown`, as
     `showBanner` does). The field values are kept. Any other 403, a 503 and a 500 keep the generic banner.
   - The success state, the field errors and the other banners are unchanged.
3. **Privacy line:** in both forms' `<p class="privacy">` in `index.html`, add " הטופס מוגן על ידי Cloudflare
   Turnstile." after the `mailto:` link (a space before it; "Cloudflare Turnstile" may sit in `<span dir="ltr">`
   if the bidi order looks wrong). Besides the banner, this is the page's one new string.
4. **`waitlist/public/_headers`:** the CSP becomes the 0017 policy with `script-src 'self'
   https://challenges.cloudflare.com` and a new `frame-src https://challenges.cloudflare.com`. Nothing else
   changes. Cloudflare's Turnstile docs list exactly these two directives as far as the verifier knows. The
   coder checks Cloudflare's current "Content Security Policy" page for Turnstile and quotes it in the PR body.
   If it asks for more, add exactly that. The page test runs a fake `api.js` and no iframe, so it cannot prove
   the real widget is CSP-clean: see the README step on checking the live page.
5. **`waitlist/build.mjs`:**
   - Read `TURNSTILE_SITE_KEY` from the environment. Refuse (exit 1, `TURNSTILE_SITE_KEY` in the message, no
     `.dist/`) when it does not match `^[0-9A-Za-z_-]{10,64}$`, when it equals `TURNSTILE_SITE_KEY_PLACEHOLDER`
     (it matches that pattern), or when it is one of Cloudflare's test site keys (`/^[123]x0{20}[A-F]{2}$/`) and
     `ALLOWED_ORIGIN`'s host does not end in `.test`. build.mjs already refuses any non-`https://` origin, so
     "localhost" can never be the exception. A `.test` origin (RFC 6761, never a real deploy) is what README's
     local try and `build.test.js` already use.
   - Replace `TURNSTILE_SITE_KEY_PLACEHOLDER` in `.dist/index.html` and add it to the existing fail-if-left
     check.
   - **Makefile:** `export TURNSTILE_SITE_KEY` next to `export CONTACT_EMAIL`, with the same comment style.
     `deploy-waitlist` also checks `TURNSTILE_SITE_KEY` is set, and its usage line becomes `usage: make
     deploy-waitlist CONTACT_EMAIL=<public contact address> TURNSTILE_SITE_KEY=<Turnstile site key>`.
6. **Secret:** `TURNSTILE_SECRET` is a Pages secret. A new make target `waitlist-secret` (added to `.PHONY`, with a
   `##` help line like its neighbours) runs `cd waitlist && pnpm dlx wrangler@$(WRANGLER_VERSION) pages secret put
   TURNSTILE_SECRET --project-name homie-waitlist`. Wrangler prompts for the value, so it never appears in a
   shell line. Secrets stay out of `wrangler.toml` even when it is the project's config source; `pages secret
   put` sets the production environment's secret. Pages applies a changed secret to **new** deployments only,
   so the README runs it before `make deploy-waitlist`, or redeploys after. Local `wrangler pages dev` reads it
   from `waitlist/.dev.vars`. Add `waitlist/.dev.vars` to the root `.gitignore`, next to `waitlist/.dist/`; it is
   not ignored today. `waitlist/.dev.vars.example` holds `TURNSTILE_SECRET=1x0000000000000000000000000000000AA`,
   Cloudflare's always-pass test secret.
7. **`waitlist/README.md`:**
   - Setup: a new step before the deploy step. In Cloudflare → Turnstile, add a widget with mode Managed and
     the hostname `join.<domain>`, or `homie-waitlist.pages.dev` instead, only if `ALLOWED_ORIGIN` is that.
     Then run `make waitlist-secret` with its secret key. Step 4 becomes `make deploy-waitlist CONTACT_EMAIL=…
     TURNSTILE_SITE_KEY=…` (or both in `.env`).
   - Deploying: build.mjs's new refusals.
   - After the first deploy: open the live page, check the console shows no CSP violation, and send one
     test signup (then `make waitlist-delete` it).
   - The line "The page makes no third-party request…" becomes "The page's only third-party request is
     Cloudflare Turnstile's script and frame (`challenges.cloudflare.com`)".
   - Local try: copy `.dev.vars.example` to `.dev.vars`, and build with the test site key
     `1x00000000000000000000AA` and a `https://….test` origin. The test keys are for local use only.
8. **Tests:**
   - `waitlist/test/signup.test.js`: a `beforeEach` replaces `globalThis.fetch` with a stub that records each
     call and answers `{success: true, action: 'signup', hostname: 'join.example.com'}` by default; the
     existing `afterEach` restores it. `env()` adds `TURNSTILE_SECRET: 'test-secret-not-cloudflare'`, and
     `SEEKER`/`LISTER` gain `turnstile: 'tok'`. Then 0017's ac1–ac8 keep passing unchanged. A test overrides
     the stub's answer for its own cases. The stub never reaches the network.
   - `waitlist/test/build.test.js`: `build(dir, contact, siteKey = 'real-site-key-0123')` deletes the inherited
     `TURNSTILE_SITE_KEY` and sets the given one. Then 0017's `ac19_build_writes_contact_and_origin` keeps
     passing. Its first subtest also asserts the key is written.
   - `web/e2e/waitlist/waitlist.waitlist.ts`:
     - `beforeEach` routes the script by predicate (`url.hostname === 'challenges.cloudflare.com' &&
       url.pathname === '/turnstile/v0/api.js'`; a glob is unsafe with the `?render=` query). It fulfils a fake
       `api.js` (JavaScript content type) that defines `window.turnstile` with `render` (records its options,
       calls `callback('fake-token')` at once by default) and `reset` (counted). A test changes the behaviour
       through `page.addInitScript` flags (a token delay, no token, a failing `error-callback`) or by
       `route.abort()`.
     - The foreign-request guard allows exactly that host and path, and nothing else.
     - 0017's `ac12_success_and_other_side` compares exact bodies, so those bodies gain `turnstile:
       'fake-token'`.
     - `ac17_no_third_party_requests` allows exactly that one routed URL.
     - The 10 s wait may use `page.clock` so the test does not sleep.

**Out:**
- Turnstile on `GET /api/count`. It writes nothing, and its reads are already edge-cached for 60 s (0017's major
  fix).
- A daily insert cap: Gilad chose Turnstile instead.
- Pre-clearance, Turnstile on other pages, siteverify `idempotency_key`, and the `cdata` field.

**New dependencies:** none. Turnstile is a Cloudflare-hosted script and a free service, the same account as Pages
and D1. Gilad approved it 2026-11-16.

## Data
No change to `signups`. The token is never stored or logged.

## API
| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/signup` | Public, anonymous, as 0017, **plus a valid Turnstile token** verified server-side for action `signup` and `ALLOWED_ORIGIN`'s hostname | 0017's body + `turnstile: string` (1–2048 chars) | `200 {"ok": true}` | 0017's errors, plus `403 {"error": "challenge"}` (missing, invalid, spent, wrong action or hostname) and `503 {"error": "server"}` (siteverify unreachable, our secret missing, rejected or a test secret) |

## UI
Only the join section of `waitlist/public/index.html` changes. There is no artboard; the brand kit applies as in
0017. The widget is invisible for most visitors. When it shows, it sits inside the form card above the banner
and the submit button, centred, with 16 px above and below (`margin-block`). No extra frame is drawn around it.
Empty, the `.turnstile` div takes no space. RTL: Turnstile is rendered with `language: 'he'`. Wrapper margins use
logical properties only (hard rule 5).

**States:**
- **Empty:** unchanged, and the widget stays invisible.
- **Loading:** "בשליחה…" now also covers the wait for a token, up to 10 s.
- **Error:** the existing banners, plus the challenge banner in the same `.banner` element.
- **Success:** unchanged.

The new strings are `TEXT.challenge` in `app.js` and the privacy sentence in `index.html`, the same places as
0017's strings. Hard rule 4 does not apply here (0017).

## Acceptance criteria
- [ ] AC1 Given a valid body with a token that the stub siteverify accepts (`success: true`, `action: 'signup'`,
  hostname = `ALLOWED_ORIGIN`'s host), then 200 and one row. The stub received one POST to the siteverify URL
  with `secret`, `response` and `remoteip` (from `CF-Connecting-IP`); `turnstile` is not a column. A
  `http://localhost:8788` request whose stub answers `{success: true, hostname: 'example.com'}` also gets 200 —
  `waitlist/test/signup.test.js::ac1b_turnstile_ok_stores`
- [ ] AC2 Given a missing token, a number, an empty string, a token of 2049 characters (2048 passes),
  `success: false` with `invalid-input-response` or `timeout-or-duplicate`, `action: 'other'`, or hostname
  `evil.example`, then 403 `{error: "challenge"}` and no row — `…::ac2b_turnstile_rejections` (table-driven)
- [ ] AC3 Given siteverify throws, aborts on timeout (a stub that rejects with a `TimeoutError`), answers 500,
  answers non-JSON, or answers `success: false` with `invalid-input-secret` or `internal-error`, then 503
  `{error: "server"}`, no row, and the logged line holds neither the token, the IP, the email nor the phone —
  `…::ac3b_turnstile_unavailable_fails_closed`
- [ ] AC4 Given no `TURNSTILE_SECRET`, an empty one, or the test secret `1x0000000000000000000000000000000AA` on
  the real host, then 503 and no siteverify call — `…::ac4b_missing_secret_refuses`
- [ ] AC5 Given invalid fields and no token, then 400 with the field list and no siteverify call. Given a filled
  honeypot, then 200 with no siteverify call and no row. Given a bad Origin, then 403 `origin` with no
  siteverify call — `…::ac5b_order_validation_before_turnstile`
- [ ] AC6 Page: the fake widget is rendered once per form, the lister one only after its tab is first shown,
  with `action: 'signup'`, `appearance: 'interaction-only'` and the site key `TURNSTILE_SITE_KEY_PLACEHOLDER`
  (the committed page). A submit sends `turnstile: 'fake-token'` —
  `web/e2e/waitlist/waitlist.waitlist.ts::ac6b_token_sent`
- [ ] AC7 Page: when the token arrives 2 s after the click, the button shows "בשליחה…" meanwhile, and one
  request is sent with that token. When no token arrives within 10 s, the challenge banner shows and no request
  is sent — `…::ac7b_waits_for_token`
- [ ] AC8 Page: a stubbed 403 `challenge` shows the challenge banner, keeps the values and calls `reset`. A
  stubbed 500 shows the generic banner and also calls `reset` — `…::ac8b_challenge_banner_and_reset`
- [ ] AC9 Page: the widget script failing to load (the route aborts), or the fake firing `error-callback`, shows
  the challenge banner on submit and sends nothing — `…::ac9b_script_blocked`
- [ ] AC10 `_headers` CSP equals the 0017 policy plus exactly the Turnstile sources, and the only non-localhost
  request the page makes is the routed Turnstile script — `signup.test.js::ac17_headers_file` (updated) and
  `waitlist.waitlist.ts::ac17_no_third_party_requests` (updated)
- [ ] AC11 `build.mjs` refuses a missing or malformed `TURNSTILE_SITE_KEY`, the placeholder, and the test key
  `1x00000000000000000000AA` with a non-`.test` origin. It accepts the test key with `https://join.homie.test`,
  writes a real key into `.dist/index.html` (no placeholder left), and the committed `index.html` keeps the
  placeholder — `waitlist/test/build.test.js::ac11b_site_key`
- [ ] NF1 axe stays clean in the empty, error (challenge banner) and success states at 375 and 1280 —
  `waitlist.waitlist.ts::ac16_axe_and_reduced_motion` (extended with the challenge state)
- [ ] NF2 0017's tests still pass with the shared helpers updated (Scope 8): `ac1`–`ac9`, `ac17_headers_file`,
  `ac19_build_writes_contact_and_origin`, and `ac10`–`ac17` page tests — `make test-waitlist`

## Tests to write
Unit tests extend `waitlist/test/signup.test.js` and `waitlist/test/build.test.js`, with `globalThis.fetch` stubbed
and no network. Page tests extend `web/e2e/waitlist/waitlist.waitlist.ts` with a fake `api.js` served through
`page.route`. All of them run in `make test-waitlist` as before (Node 22; this is the page test, not `make e2e`).

## Risks / open questions
- **Hostname check against `ALLOWED_ORIGIN`.** If Gilad first deploys on `homie-waitlist.pages.dev`, then
  `ALLOWED_ORIGIN` is that origin, and the widget must list that hostname (README step). That is consistent,
  and nothing else changes. When `ALLOWED_ORIGIN` is the custom domain, 0017's origin guard already refuses
  posts to `*.pages.dev` before Turnstile runs.
- **CSP:** Turnstile's iframe may need more than `script-src` + `frame-src`, and the fake script cannot show it.
  Scope 4 (docs quote) and the README's live-page check cover it.
- **Fail closed** loses signups during a Turnstile outage. The page tells the visitor to try again. This was the
  orchestrator's choice; Gilad can flip it in the digest.
- **Not confirmed by the verifier (no web access); the coder checks each against Cloudflare's docs and notes
  it in the PR:**
  - `language: 'he'` is an accepted code, else `he-il`, else drop it (default `auto`);
  - the `response-field` option name;
  - `error-callback` returning `true` marks the error as handled;
  - the test-key values and the dummy siteverify answer;
  - the `turnstile.ready()` async warning;
  - the exact CSP list;
  - `pages secret put` reaching a wrangler.toml-configured project.

## Blast radius
graphify's graph (`rent-app/graphify-out/graph.json`) predates 0017's merge and has no `waitlist/` nodes
(`graphify affected "handleSignup"` → no match), so callers come from grep:
- `handleSignup` (lib/signup.js): called only by `functions/api/signup.js::onRequest` (untouched, same
  signature) and through it by `signup.test.js` ac1–ac8 and ac6's guards. The shared `env()`, `SEEKER` and
  `LISTER` gain the secret and token, with fetch stubbed (Scope 8).
- `verifyTurnstile`: new, with no caller but `handleSignup`.
- `validateSignup` / `validate.js`: unchanged, so `app.js` `submit` and `ac9_single_validation_source` are
  untouched.
- `selectSide` (app.js): called by the tab click and keydown handlers, the hero/door links, the initial
  `?side=` selection and `joinOtherSide`. All of them gain the lazy render; none changes its call.
- `submit` (app.js): its only caller is the form submit listener. It is exercised by e2e ac11–ac13, ac16 and
  ac17; ac12's exact body match is updated (Scope 8).
- `showBanner` / `.banner`: reused for the challenge text; the generic paths (`TEXT.error`, `TEXT.offline`) are
  unchanged.
- `_headers` CSP: read by `signup.test.js::ac17_headers_file` (updated) and by the e2e `CSP` constant, which
  every page test applies (it picks up the change by itself).
- `build.mjs`: run by `make deploy-waitlist` (updated) and `build.test.js::build()` (helper updated). README
  "Deploying" and "Local checks" are updated.
- e2e `beforeEach` foreign-request guard: every page test (ac10–ac17) depends on it. It allows exactly the
  Turnstile script URL, routed by default.
- Makefile: `export TURNSTILE_SITE_KEY`, `deploy-waitlist`, the new `waitlist-secret` and `.PHONY`. CI runs
  only `test-waitlist`, which needs neither variable.
- `.gitignore`: `waitlist/.dev.vars` added.

## Verifier notes (2026-11-16, one round, applied)
1. validate.js has no accepted-keys list: `validateSignup` ignores unknown keys. The scope line asking to add
   `turnstile` to it is replaced by "no change"; ac9 is untouched.
2. `verifyTurnstile(…, fetchImpl)` could not be reached through `handleSignup(request, env)` without changing
   the Function's call. It now uses the global `fetch`, and the tests stub `globalThis.fetch` in
   `beforeEach`/`afterEach`, as they already do for `globalThis.caches`.
3. Without updating the shared helpers, the change would break every 0017 test: `env()` has no secret,
   `SEEKER`/`LISTER` have no token, the e2e guard fails on any foreign request, ac12 compares exact bodies, and
   `build.test.js::build()` passes no site key. Scope 8 and NF2 now name each one.
4. The build's "test key allowed when `ALLOWED_ORIGIN` is localhost" could never run: build.mjs refuses any
   non-`https://` origin. The exception is now a `.test` host, the one README's local try and `build.test.js`
   already use. The placeholder value matched the key regex, so it is refused explicitly. All three test site
   keys are refused, not only `1x…AA`.
5. siteverify's `success: false` with `invalid-input-secret` / `missing-input-secret` / `internal-error` is our
   fault or Cloudflare's. It is now `'unavailable'` (503, logged) instead of telling every visitor they look
   like a bot.
6. Security: a Cloudflare test secret pasted into `make waitlist-secret` would accept any dummy token. It is now
   refused on a non-localhost request (AC4). The log line is fixed, with a reason word or Cloudflare's error
   codes and never the token or IP (AC3).
7. Local dev: the test secret's dummy answer does not carry our action or hostname. On a localhost request URL
   (unreachable on Cloudflare) only `success` is checked (AC1).
8. Script loading: `app.js` injects `api.js` with `onload`/`onerror`, not a static `async defer` tag. A module
   cannot rely on load order, `turnstile.ready()` is documented as unusable with async, and `onerror` gives
   AC9 directly. Rendering hooks into `selectSide`, which every tab change goes through.
9. The challenge banner reuses the form's existing `.banner` (already `role="alert"`) instead of a new element.
   The widget div sits before `.banner`, so the banner stays next to the button. A thrown fetch also resets
   the widget. `expired-callback` only drops the token, because `refresh-expired: 'auto'` renews it.
10. `.dev.vars` was not git-ignored; it is added to `.gitignore`. Pages secrets apply to new deployments only,
    so the README orders `waitlist-secret` before the deploy. `waitlist-secret` runs from `waitlist/` like the
    other wrangler targets and is in `.PHONY`.
11. The privacy line exists twice (both forms) and ends in the `mailto:` link: the sentence goes after the link
    in both. The README line saying "no third-party request" is updated, and a live-page CSP check is added
    because the fake script cannot test it.
12. The Turnstile facts the verifier could not confirm without web access are listed under Risks for the coder
    to check against Cloudflare's docs.

## Digest (filled by orchestrator after verification)
Verified 2026-11-16 (one verifier round, 12 fixes applied in place). Build: one Opus/high coder run, reviewers code, security, qa. Merged by the orchestrator under Gilad's 0017 delegation. For Gilad: fail closed is the orchestrator's choice and can be flipped.
