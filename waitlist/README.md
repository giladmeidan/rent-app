# homie waitlist (`join.<domain>`)

The pre-launch waitlist page (spec 0017): one static Hebrew RTL page, two Cloudflare Pages Functions and a
Cloudflare D1 database, in its own Pages project `homie-waitlist`, apart from the app. Every signup carries a
Cloudflare Turnstile token that the Function checks with Cloudflare before it writes (spec 0017b). Nothing here runs on Fly,
and nothing changes when the app launches.

```
public/                  the page (index.html, styles.css, app.js), the shared rules (validate.js, cities.js),
                         _headers (CSP and security headers), fonts/, img/, media/
functions/api/signup.js  POST /api/signup  (any other method: 405)
functions/api/count.js   GET  /api/count   (edge-cached 60 s; any other method: 405)
lib/signup.js            guards, validation (public/validate.js), the Turnstile check, insert and count
migrations/              the D1 schema
stats.sql                the one SELECT `make waitlist-stats` runs
build.mjs                public/ → .dist/ with the contact address, the origin and the Turnstile site key written in
.dev.vars.example        the local `wrangler pages dev` secret (Cloudflare's always-pass test secret)
delete.mjs               `make waitlist-delete`: one address off the list, matched by its hex (no SQL or shell text)
test/                    node --test (`make test-waitlist`); the page test is web/e2e/waitlist/
```

`<v>` below is the Makefile's `WRANGLER_VERSION`.

## Setup (once)

1. The domain is on Cloudflare DNS (0013a runbook step "DNS"; do it first if 0013a has not been deployed yet).
2. From `waitlist/`:
   1. `pnpm dlx wrangler@<v> login`
   2. `pnpm dlx wrangler@<v> d1 create homie-waitlist`
   3. `pnpm dlx wrangler@<v> pages project create homie-waitlist --production-branch main`
   4. In `waitlist/wrangler.toml`, replace `database_id` with the id step 2 printed and `ALLOWED_ORIGIN` with
      `https://join.<domain>`, then commit (neither is a secret). From then on `wrangler.toml` is the source of
      truth for the project's binding and vars; do not edit them in the dashboard.
3. `make waitlist-migrate`
4. Turnstile, then the first deploy:
   1. Cloudflare → Turnstile → Add widget: mode **Managed**, hostname `join.<domain>` (or
      `homie-waitlist.pages.dev` instead, only if `ALLOWED_ORIGIN` is that origin: the Function checks that
      siteverify's hostname is `ALLOWED_ORIGIN`'s). Cloudflare shows a site key (public) and a secret key.
   2. `make waitlist-secret`, and paste the **secret key** at wrangler's prompt (it is never on a command line
      and never in `wrangler.toml`). It sets the Pages secret `TURNSTILE_SECRET` for production. Pages applies
      a changed secret to new deployments only, so set it before deploying, or deploy again after changing it.
      Without it every signup is refused with a 503 (`waitlist: turnstile secret missing` in the log).
   3. `make deploy-waitlist CONTACT_EMAIL=<public contact address> TURNSTILE_SITE_KEY=<site key>` (or put both
      in the checkout's `.env`). In the Pages project, add the custom domain `join.<domain>` (Cloudflare adds
      the DNS record).
   4. Open the live page, check the browser console shows no Content Security Policy violation (the page
      test runs a fake Turnstile script, so it cannot prove the real widget is CSP-clean), send one test
      signup, then remove it with `make waitlist-delete`.
5. Cloudflare → Security → WAF → Rate limiting rules (the free plan includes one rule): **URI path equals
   `/api/signup`**, 5 requests per 10 s per IP → block for 10 s. The free plan's rule may only match on the URI
   path (not the hostname or the method), and that is enough: across the zone only this page serves
   `/api/signup` (the app's API has no `/api/` paths, and the apex web is static), and a GET there is a 405
   anyway. `homie-waitlist.pages.dev` is outside the zone, so the Functions refuse it themselves (403 for a
   signup, `{"total": null}` without D1 for the count). If 0013a needs the zone's one free rule later, widen
   this one to an OR of both paths.
6. `make waitlist-stats` any time.
7. To remove an entry on request (the privacy line promises it): `make waitlist-delete`, then type or paste
   the address and press Enter. It reads the address from stdin (never the command line, so no shell sees
   it), normalises it as the signup did, prints how many rows match (one per side), deletes them by the hex of
   the address (so a quote in an address cannot change the SQL) and counts again. Never paste an address into
   a `wrangler d1 execute --command` by hand: the email rule allows quotes, `$(…)` and backticks.

## Deploying

`make deploy-waitlist` runs `build.mjs`, then `wrangler pages deploy` of `.dist/` (git-ignored). `build.mjs`:

- refuses a `CONTACT_EMAIL` that is missing, the placeholder `contact@example.com`, or not a plain address
  (`<`, `"` and `&` never reach the HTML);
- refuses an `ALLOWED_ORIGIN` in `wrangler.toml` that is not `https://` or is still `https://join.example.com`;
- refuses a `TURNSTILE_SITE_KEY` that is missing, not 10–64 characters of `[0-9A-Za-z_-]`, the placeholder
  `TURNSTILE_SITE_KEY_PLACEHOLDER`, or one of Cloudflare's test site keys (`1x00000000000000000000AA` and the
  like) unless `ALLOWED_ORIGIN`'s host ends in `.test` (a local try only);
- copies `public/` to `.dist/` and writes the address, the origin (canonical, `og:url`, `og:image`) and the
  site key (both forms' widgets) into `.dist/index.html` only. The committed `public/index.html` keeps all
  three placeholders.

A deploy is a new Pages deployment; roll back from the project's Deployments list in the dashboard.

## Reading the numbers

`make waitlist-stats` prints one table with the columns `summary, side, kind, city, available, signups, units`:

| summary | what it counts |
| --- | --- |
| `by_side` | signups per side |
| `lister_available` | listers by when the place is free |
| `lister_kind_city` | listers by type × city; `units` sums the properties (`3+` counts as 3) |
| `lister_phone` | listers who left a phone number |
| `seeker_kind_city` | seekers by type × city |

It never selects an address or a phone number.

## How it behaves

- `POST /api/signup` takes JSON `{side, email, kind, city, consent: true, website: ""}`, plus for listers
  `units, available, neighbourhood?, phone?`. It answers `200 {"ok": true}` whether the address is new or
  already on that side's list, so it never tells whether an address is on the list. The same address may join
  both sides. Guards, in order: method (405), the request's own origin must be `ALLOWED_ORIGIN` or localhost and
  `Origin` must equal it (403; this also refuses `homie-waitlist.pages.dev`, which the rate-limit rule does not
  cover), JSON only (415), 4 KB at most (413), bad JSON (400), a filled honeypot `website` (200, nothing
  stored), then the field rules in `public/validate.js` (400 with the bad keys), then Turnstile (below). A D1
  failure is a 500, logged without the address or the phone.
- Turnstile (spec 0017b): the body's `turnstile` token (1–2048 characters, else 403 `{"error": "challenge"}`)
  goes to Cloudflare's siteverify with the secret and the visitor's `CF-Connecting-IP`, with a 5 s timeout.
  A token Cloudflare refuses, already spent, or issued for another action or hostname is a 403 `challenge`,
  and the page says it could not tell the visitor is not a bot. It **fails closed**: siteverify unreachable,
  slow or failing, `TURNSTILE_SECRET` missing, rejected by Cloudflare, or one of Cloudflare's test secrets is a
  503 and no row, logged as `waitlist: turnstile …` without the token, the IP, the address or the phone. A
  localhost request (`wrangler pages dev` only) accepts a test secret and checks only `success`.
- The widget is managed with `appearance: 'interaction-only'`: most visitors see nothing, and a visitor
  Turnstile is unsure about gets a checkbox in the form. A submit without a token yet waits up to 10 s for one.
- `GET /api/count` answers `{"total": n}` from 50 signups (`COUNTER_MIN` in `lib/signup.js`), else
  `{"total": null}`, and the page shows the counter only for a number. The response sits in the edge cache
  (`caches.default`) for 60 s, so D1 counts at most once a minute per Cloudflare location. The Cache API works
  on the custom domain only, so on any other host (`*.pages.dev`) the count answers `{"total": null}` without
  touching D1.
- The page needs JavaScript to sign up: without it the forms render, but submitting does nothing useful.
- The page's only third-party request is Cloudflare Turnstile's script and frame (`challenges.cloudflare.com`);
  no analytics, fonts or CDN. `_headers` sets a strict CSP that allows exactly that origin in `script-src` and
  `frame-src`.

## Local checks

- `make test-waitlist` (Node 22): the unit tests (`node --test`, a fake D1 over `node:sqlite` running the real
  migration) and the Playwright page test (`web/playwright.waitlist.config.ts`: `public/` on a python static
  server on port 4179, every API call stubbed). It is part of `make test`.
- To try the Functions locally: copy `.dev.vars.example` to `.dev.vars` (git-ignored; Cloudflare's always-pass
  test secret), set a temporary `https://….test` `ALLOWED_ORIGIN` (for example `https://join.homie.test`),
  run `node build.mjs` with a dummy `CONTACT_EMAIL` and `TURNSTILE_SITE_KEY=1x00000000000000000000AA` (the
  always-pass test site key), then `pnpm dlx wrangler@<v> pages dev .dist` and `pnpm dlx wrangler@<v> d1
  migrations apply homie-waitlist --local` (posts from `http://localhost:8788` pass the origin guard). The test
  keys are for local use only: build.mjs refuses a test site key for any other origin, and the Function refuses
  a test secret on any request that is not localhost.

## Rollback

D1 has no down-migration. Before launch, `DROP TABLE signups` (through `d1 execute … --remote --command`) undoes
`0001_signups.sql`.

## Media

`media/homie-promo.mp4` is the promo video (the main checkout's `promo-video/out/homie-promo.mp4`, not in git),
re-encoded once: `ffmpeg -i homie-promo.mp4 -vf scale=1280:-2 -c:v libx264 -crf 26 -preset slow -movflags
+faststart -c:a aac -b:a 128k`. The poster is frame `promo-video/out/final/f0300.png` as WebP (1280×720) and
`img/og.png` (1200×630) is the Hebrew lockup and the default turtle on `accent-soft`, both rendered once in
Chromium and committed. Fonts are the Hebrew and Latin subsets of Fredoka and Rubik (SIL OFL, `fonts/LICENSE-*`).
