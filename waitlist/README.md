# homie waitlist (`join.<domain>`)

The pre-launch waitlist page (spec 0017): one static Hebrew RTL page, two Cloudflare Pages Functions and a
Cloudflare D1 database, in its own Pages project `homie-waitlist`, apart from the app. Nothing here runs on Fly,
and nothing changes when the app launches.

```
public/                  the page (index.html, styles.css, app.js), the shared rules (validate.js, cities.js),
                         _headers (CSP and security headers), fonts/, img/, media/
functions/api/signup.js  POST /api/signup  (any other method: 405)
functions/api/count.js   GET  /api/count   (edge-cached 60 s; any other method: 405)
lib/signup.js            guards, validation (public/validate.js), insert and count
migrations/              the D1 schema
stats.sql                the one SELECT `make waitlist-stats` runs
build.mjs                public/ → .dist/ with the contact address and the origin written in
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
4. `make deploy-waitlist CONTACT_EMAIL=<public contact address>` (or put `CONTACT_EMAIL=…` in the checkout's
   `.env`). In the Pages project, add the custom domain `join.<domain>` (Cloudflare adds the DNS record).
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
- copies `public/` to `.dist/` and writes the address and the origin (canonical, `og:url`, `og:image`) into
  `.dist/index.html` only. The committed `public/index.html` keeps both placeholders.

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
  stored), then the field rules in `public/validate.js` (400 with the bad keys). A D1 failure is a 500, logged
  without the address or the phone.
- `GET /api/count` answers `{"total": n}` from 50 signups (`COUNTER_MIN` in `lib/signup.js`), else
  `{"total": null}`, and the page shows the counter only for a number. The response sits in the edge cache
  (`caches.default`) for 60 s, so D1 counts at most once a minute per Cloudflare location. The Cache API works
  on the custom domain only, so on any other host (`*.pages.dev`) the count answers `{"total": null}` without
  touching D1.
- The page needs JavaScript to sign up: without it the forms render, but submitting does nothing useful.
- The page makes no third-party request (no analytics, fonts or CDN); `_headers` sets a strict CSP.

## Local checks

- `make test-waitlist` (Node 22): the unit tests (`node --test`, a fake D1 over `node:sqlite` running the real
  migration) and the Playwright page test (`web/playwright.waitlist.config.ts`: `public/` on a python static
  server on port 4179, every API call stubbed). It is part of `make test`.
- To try the Functions locally: `node build.mjs` with a dummy `CONTACT_EMAIL` and a temporary `https://`
  `ALLOWED_ORIGIN`, then `pnpm dlx wrangler@<v> pages dev .dist` and `pnpm dlx wrangler@<v> d1 migrations apply
  homie-waitlist --local` (posts from `http://localhost:8788` pass the origin guard).

## Rollback

D1 has no down-migration. Before launch, `DROP TABLE signups` (through `d1 execute … --remote --command`) undoes
`0001_signups.sql`.

## Media

`media/homie-promo.mp4` is the promo video (the main checkout's `promo-video/out/homie-promo.mp4`, not in git),
re-encoded once: `ffmpeg -i homie-promo.mp4 -vf scale=1280:-2 -c:v libx264 -crf 26 -preset slow -movflags
+faststart -c:a aac -b:a 128k`. The poster is frame `promo-video/out/final/f0300.png` as WebP (1280×720) and
`img/og.png` (1200×630) is the Hebrew lockup and the default turtle on `accent-soft`, both rendered once in
Chromium and committed. Fonts are the Hebrew and Latin subsets of Fredoka and Rubik (SIL OFL, `fonts/LICENSE-*`).
