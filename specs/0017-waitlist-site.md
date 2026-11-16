---
id: 0017
title: "Before launch, people looking for a home and people renting one out can join homie's waitlist on join.<domain>, and Gilad can count them by side, city and type"
status: in-review
depends_on: []   # own Cloudflare Pages project + D1; shares only the domain and DNS zone with 0013a (see Blast radius for the Makefile overlap)
reviewers: [code, security, ux, qa]   # security: emails and optional phone numbers (PII), public write endpoint; ux: new page; qa: endpoint + page
estimate: 1 coder run (large)   # coder Opus/high (PII + a design-heavy page; Speed rule 6)
---

## Goal
Before the app launches, a visitor to `join.<domain>` sees a polished homie page (the turtle, the promo video, a
live signup count) and joins the waitlist as a **seeker** (looking for an apartment or a room) or a **lister**
(renting one out). Gilad runs one command to see how many joined, split by side, city and type, so he knows
both sides of the market before launch.

## Decisions this spec builds on (Gilad, 2026-11-16)
- Storage is **Cloudflare D1** (free), written by a **Cloudflare Pages Function**. Nothing runs on Fly.
- The page lives on a **subdomain**, `join.<domain>`, in its own Pages project `homie-waitlist`, apart from the
  app (`<domain>` apex, 0013a). Nothing changes when the app launches.
- The page shows a **signup counter**.
- Listers give an **optional phone number**. Seekers give none. This is the only phone number homie stores
  before SMS exists (PRODUCT "OTP": no phone numbers *in the app* at launch; the waitlist is not the app).
- Built as a **normal spec** (coder → reviewers → `make merge`).
- The page must look **enterprise-grade, modern and beautiful**, with the turtle and the promo video.

**Orchestrator defaults that Gilad can change in the digest (the coder builds them as written):**
- D1. The counter shows only once there are **50 or more signups in total** (`COUNTER_MIN = 50` in `lib/signup.js`).
  Below that it is hidden, not "0".
- D2. The video is the promo video `homie-promo.mp4` (16:9, 43 s, with music), re-encoded for the web. It plays
  **only on click**, with sound and native controls. It does not autoplay.
- D3. The subdomain is `join`.

## Scope
**In:**
1. A new top-level folder `waitlist/` (outside `web/`; `web/`'s build, i18n and CSP do not apply to it):
   ```
   waitlist/
     package.json             # {"private": true, "type": "module"} only: makes the .js files ES modules for
                              # node --test. No dependencies, no scripts, no lockfile
     wrangler.toml            # name = "homie-waitlist", compatibility_date = "<the build date>",
                              # pages_build_output_dir = ".dist",
                              # [vars] ALLOWED_ORIGIN = "https://join.example.com" (Gilad replaces it, Setup step 2),
                              # [[d1_databases]] binding = "DB", database_name = "homie-waitlist",
                              # database_id = "00000000-0000-0000-0000-000000000000" (Gilad replaces it, Setup
                              # step 2; not a secret), migrations_dir = "migrations"
     migrations/0001_signups.sql
     stats.sql                # the one SELECT that waitlist-stats runs (Scope 4)
     build.mjs                # public/ → .dist/ with the contact address and origin written in (Scope 4)
     lib/signup.js            # validation, normalisation, insert and count. Pure: takes the D1 binding and env as arguments
     functions/api/signup.js  # export onRequest: POST → lib/signup.js, any other method → 405
     functions/api/count.js   # export onRequest: GET  → lib/signup.js (edge-cached 60 s), any other method → 405
     public/
       index.html             # the whole page, Hebrew, dir="rtl", lang="he"
       styles.css
       app.js                 # ES module: tab switch, form submit, counter, video
       validate.js            # the field rules, shared by app.js and lib/signup.js (one source). Plain ES module:
                              # no DOM, no Node API
       cities.js              # the city list (below), shared by the page and the server. Same rule
       _headers               # security headers + CSP (Scope 6)
       fonts/                 # Fredoka + Rubik variable woff2 (Hebrew + Latin subsets), copied from
                              # web/node_modules/@fontsource-variable/{fredoka,rubik}/files; their LICENSE alongside
       img/                   # copies of design/brand: logos/homie-lockup-he.svg, logos/homie-wordmark-he.svg,
                              # mascot/homie-turtle-hello.svg, mascot/homie-turtle-celebrate.svg, the favicon
                              # (homie-favicon.svg); og.png (1200×630, Scope 5)
       media/homie-promo.mp4  # re-encoded (Scope 5); media/homie-promo-poster.webp
     test/signup.test.js      # node --test (no new dependency): AC1–AC9, AC17 headers
     test/stats.test.js       # AC18
     test/build.test.js       # AC19
     README.md                # the Setup steps below, as a runbook
   web/playwright.waitlist.config.ts
   web/e2e/waitlist/waitlist.waitlist.ts   # Playwright page test (Scope 8): AC10–AC17
   ```
   `functions/api/*.js` import `../../lib/signup.js`, and `lib/signup.js` imports `../public/validate.js` and
   `../public/cities.js`. Wrangler bundles Pages Functions with esbuild and follows relative imports outside
   `functions/`. The coder confirms it once with `cd waitlist && pnpm dlx wrangler@$(WRANGLER_VERSION) pages
   functions build --outdir /tmp/wl-fn-check` and says so in the PR. Each Function file exports a single `onRequest`
   that switches on `request.method`, because a file with only `onRequestPost` falls through to the static assets
   for other methods.
2. **`POST /api/signup`**: validates, normalises, inserts with `INSERT … ON CONFLICT (side, email) DO NOTHING`,
   and returns `200 {"ok": true}` whether the row is new or already there (it never reveals whether an email is on
   the list). The guards run in this order, each ending the request:
   1. Wrong method → 405 with `Allow: POST`.
   2. **Host and origin.** The request's own origin (`new URL(request.url).origin`) must be `env.ALLOWED_ORIGIN`
      or `http://localhost:<port>` / `http://127.0.0.1:<port>`, and the `Origin` header must equal that same
      origin. Anything else (a missing `Origin` included) → 403. This blocks cross-site form posts. It also
      refuses posts to `homie-waitlist.pages.dev`, which the zone's rate-limit rule (Setup step 5) does not cover.
   3. `Content-Type` not `application/json` (parameters such as `; charset=utf-8` allowed) → 415.
   4. A `Content-Length` over 4096, or a body over 4096 bytes once read → 413.
   5. Invalid JSON → 400 `{"error": "invalid", "fields": []}`.
   6. A filled honeypot field `website` → `200 {"ok": true}` with nothing stored (bots see success).
   7. Validation (`validate.js`) → 400 with the bad keys.
3. **`GET /api/count`**: `200 {"total": n}` when `n ≥ COUNTER_MIN`, else `200 {"total": null}`.
   `Cache-Control: public, max-age=60`. Function responses are not edge-cached by default, so `count.js` also stores
   the response in `caches.default` keyed by the request URL for 60 s and serves it from there. That way D1, which
   bills a `COUNT(*)` as every row read, is queried at most once a minute per Cloudflare location. There is no split by
   side or city: the split is for Gilad only (item 4). Other methods → 405 with `Allow: GET`.
4. **Makefile** (hard rule 2). Each target has a `##` comment and joins `.PHONY`. No parse-time code (no top-level
   `$(shell …)` or `$(error …)`): `api/tests/test_dotenv.py` copies the real `Makefile` and `include`s it.
   - **`WRANGLER_VERSION := <x.y.z>`**: a plain `:=` literal, the newest wrangler 4.x release that is at least two
     weeks old (`npm view wrangler versions`). It is new in this spec, because 0013a, which also uses it, is not
     merged. When 0013a merges after this spec, it reuses this line and does not add a second one (Blast radius).
   - `waitlist-migrate`: `cd waitlist && pnpm dlx wrangler@$(WRANGLER_VERSION) d1 migrations apply homie-waitlist --remote`.
   - `deploy-waitlist`: `@test -n "$$CONTACT_EMAIL" || { echo "usage: make deploy-waitlist CONTACT_EMAIL=<public
     contact address>" >&2; exit 1; }`, then `cd waitlist && node build.mjs && pnpm dlx wrangler@$(WRANGLER_VERSION)
     pages deploy --project-name homie-waitlist --branch main` (it deploys `.dist`, from `pages_build_output_dir`).
     `CONTACT_EMAIL` is a make variable like 0013a's `deploy-web`, set on the command line or in the checkout's
     `.env`. Make exports it to the recipe, and `build.mjs` reads it from `process.env`. The recipe never puts its
     value into a shell line.
   - **`build.mjs`** (Node built-ins only, about 30 lines):
     1. It reads `CONTACT_EMAIL` and refuses (exit 1, one line on stderr) unless it matches
        `^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$` and is not `contact@example.com`. The pattern also keeps
        `<`, `"` and `&` out of the HTML.
     2. It reads the `ALLOWED_ORIGIN = "…"` line from `wrangler.toml` and refuses unless it is `https://` and not
        `https://join.example.com`.
     3. It deletes `.dist/`, copies `public/` to `.dist/`, and in `.dist/index.html` replaces every
        `contact@example.com` with the address and every `https://join.example.com` with the origin.
     4. It fails if either placeholder is still there.

     The committed `public/index.html` keeps both placeholders, so no real address is ever committed.
   - `waitlist-stats`: `cd waitlist && pnpm dlx wrangler@$(WRANGLER_VERSION) d1 execute homie-waitlist --remote
     --command "$$(cat stats.sql)"`. It uses `--command`, not `--file`: a remote `--file` runs as an import and prints
     no rows. `stats.sql` is **one** `SELECT … UNION ALL …` statement (no `$`, backtick or `"`) with the columns
     `summary, side, kind, city, available, signups, units` (unused columns NULL). It returns five summaries:
     - `by_side`: the total per side;
     - `seeker_kind_city`: seekers by kind × city;
     - `lister_kind_city`: listers by kind × city, with `units` as the sum of units (`'3+'` counts as 3);
     - `lister_available`: listers by `available`;
     - `lister_phone`: how many listers left a phone.

     It never selects `email` or `phone`.
   - `waitlist-delete` (review B1): `cd waitlist && WRANGLER_VERSION=$(WRANGLER_VERSION) node delete.mjs`.
     `delete.mjs` (Node built-ins only) reads the address from stdin (never argv or a make variable), normalises
     it with `normaliseEmail`, matches on `hex(email) = '<upper-case hex of the UTF-8 address>'`, prints the
     `SELECT COUNT(*)`, runs the `DELETE` and counts again, calling wrangler with `execFileSync` (no shell).
     Unit test: `waitlist/test/delete.test.js::b1_delete_by_hex_is_injection_safe`.
   - `test-waitlist: web/node_modules/.modules.yaml`:
     1. `node --test 'waitlist/test/*.test.js'` (a quoted glob: Node 22 does not expand a directory argument);
     2. `$(PNPM) exec playwright install --with-deps chromium` (as `make e2e` does; a no-op when present);
     3. `$(PNPM) exec playwright test -c playwright.waitlist.config.ts`.

     It joins `make test` (`test: test-api test-web test-waitlist`). In CI the `make test` step runs **before** the
     e2e step, which is where browsers are otherwise installed, so the install line above is what makes the page
     test work there (GitHub-hosted runners only restore a browser cache on a hit). With it, `ci.yml` does not
     change. `node:sqlite` needs no flag: CI's `setup-node` resolves `web/.nvmrc`'s `22` to the newest 22.x
     (≥ 22.13, where `node:sqlite` is unflagged). Locally, run it with Node 22 on `PATH` as for `test-web`.
5. **Media.** The source video is not in git: it is `promo-video/out/homie-promo.mp4` (16.6 MB) in the **main
   checkout**, which is `../rent-app/` from the spec worktree. Encode it from there:
   `ffmpeg -i ../rent-app/promo-video/out/homie-promo.mp4 -vf scale=1280:-2 -c:v libx264 -crf 26 -preset slow
   -movflags +faststart -c:a aac -b:a 128k waitlist/public/media/homie-promo.mp4`.
   - **Video:** the target is ≤ 8 MB. If it comes out larger, raise `-crf` one step at a time. The coder records
     the real size in the PR. The file is committed: Pages' limit is 25 MiB per file.
   - **Poster:** frame `../rent-app/promo-video/out/final/f0300.png`, or the frame that best shows the app (the
     coder picks), as WebP ≤ 150 KB at 1280 px.
   - **`og.png`:** the Hebrew lockup and the default turtle on `accent-soft`, 1200×630. It is made once with any
     local tool and committed (no build step).
6. **`_headers`** for `/*`:
   ```
   Content-Security-Policy: default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self';
     script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none';
     form-action 'self'
   X-Content-Type-Options: nosniff
   Referrer-Policy: strict-origin-when-cross-origin
   Strict-Transport-Security: max-age=31536000
   Permissions-Policy: camera=(), microphone=(), geolocation=()
   ```
   The CSP is one line in the real file; it wraps here only for reading. There is no third-party request of any kind:
   no analytics, no Google Fonts, no CDN. Under this CSP, `index.html` has no inline `<script>`, `<style>` or `style=`
   attribute and no `on*=` handler; JS changes styles through classes or `element.style`. `_headers` covers static
   files only, so each Function sets its own `Content-Type: application/json` and `X-Content-Type-Options: nosniff`.
7. **The page:** see UI.
8. **Page test:** `web/playwright.waitlist.config.ts`, modelled on `playwright.screens.config.ts`:
   - `testDir: 'e2e/waitlist'`, `testMatch: '*.waitlist.ts'`. The suffix keeps it out of `make e2e`'s default
     `*.spec.ts` match and out of vitest.
   - It reuses web's installed `@playwright/test` and `@axe-core/playwright`, so there is no new dependency. The
     test file sits under `web/` so those imports resolve from `web/node_modules`.
   - Its `webServer` is `python3 -m http.server 4179 --directory ../waitlist/public` with `reuseExistingServer:
     false`, so a port taken by another worktree fails instead of serving the wrong files.
   - The tests stub `/api/signup` and `/api/count` with `page.route`.
   - It is **not** `make e2e` (rule 8): it starts no compose stack and no API, serves static files only, and may run
     locally. It runs from `make test` (item 4).
   - `make lint` (eslint, prettier, tsc over `web/e2e` and `web/*.ts`) covers both new files.
9. **Top-level `README.md`**: one line pointing to `waitlist/README.md`.
10. **`.gitignore`**: `waitlist/.dist/` and `waitlist/.wrangler/`.

**Out:**
- Emailing the list (a confirmation email, double opt-in, the launch announcement) and exporting it (a later
  spec, before the launch email; `waitlist-stats` never shows addresses).
- Importing the waitlist into the app's `users` table. Waitlisters sign up in the app like anyone else.
- Analytics, cookies, A/B tests, a CAPTCHA (Turnstile). If bots show up, Turnstile is the follow-up.
- English. The page is Hebrew only (PRODUCT "Language").
- Editing your own entry. A second signup with the same email on the same side changes nothing.
- A `deploy-guard` (clean `main`) for `deploy-waitlist`: it is 0013a's, not merged; the static page needs none.

**New dependencies:** none.
- `wrangler` runs through `pnpm dlx` at the pinned `WRANGLER_VERSION` (item 4), the same way 0013a will run it.
- `node --test` and `node:sqlite` are built in.
- Playwright and axe are already in `web/`.
- `ffmpeg` and `python3` are local or runner tools, not dependencies.

## Data
D1 database `homie-waitlist`. Migration `waitlist/migrations/0001_signups.sql`:
```sql
CREATE TABLE signups (
  id            INTEGER PRIMARY KEY,
  side          TEXT NOT NULL CHECK (side IN ('seeker', 'lister')),
  email         TEXT NOT NULL CHECK (length(email) BETWEEN 3 AND 254),   -- trimmed, lower-cased
  kind          TEXT NOT NULL CHECK (kind IN ('apartment', 'room')),
  city          TEXT NOT NULL,                                          -- a key from cities.js
  neighbourhood TEXT CHECK (neighbourhood IS NULL OR length(neighbourhood) <= 60),  -- lister only
  units         TEXT CHECK (units IN ('1', '2', '3+')),                 -- lister only, required for listers
  available     TEXT CHECK (available IN ('now', '1-3m', 'later')),     -- lister only, required for listers
  phone         TEXT CHECK (phone IS NULL OR phone GLOB '05[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'),  -- lister only, optional
  consent       INTEGER NOT NULL CHECK (consent = 1),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (side, email),
  CHECK (side = 'lister' OR (neighbourhood IS NULL AND units IS NULL AND available IS NULL AND phone IS NULL)),
  CHECK (side = 'seeker' OR (units IS NOT NULL AND available IS NOT NULL))
);
```
- The same email may join both sides (one row each).
- A brand-new database means no backwards-compatibility concern.
- D1 migrations have no `downgrade`: hard rule 6 covers Alembic, which this database does not use. Rollback is
  `DROP TABLE signups` before launch, written in the README.

**Cities** (`cities.js`, key → label, in this order):

| Key | Label | Key | Label |
| --- | --- | --- | --- |
| `tel-aviv` | תל אביב-יפו | `herzliya` | הרצליה |
| `ramat-gan` | רמת גן | `ramat-hasharon` | רמת השרון |
| `givatayim` | גבעתיים | `kiryat-ono` | קריית אונו |
| `bnei-brak` | בני ברק | `givat-shmuel` | גבעת שמואל |
| `holon` | חולון | `or-yehuda` | אור יהודה |
| `bat-yam` | בת ים | `yehud` | יהוד-מונוסון |
| `rishon` | ראשון לציון | `other` | עיר אחרת |
| `petah-tikva` | פתח תקווה | | |

The order runs down the left pair of columns, then down the right pair. The server rejects any other key.

**Normalisation (validate.js):**
- **Email:** trimmed and lower-cased; must match `^[^\s@]+@[^\s@]+\.[^\s@]+$` and be ≤ 254 characters.
- **Phone:** strip spaces, `-` and `()`, and turn a leading `+972` or `972` into `0`. The result must be `05` + 8
  digits. Empty → `null`.
- **Neighbourhood:** trimmed, ≤ 60 visible characters, control characters rejected. Empty → `null`.
- Fields that belong to the other side are rejected (400), never silently dropped.

## API
**`POST /api/signup`**
- **Auth rule:** public, anonymous. Scope 2's host + `Origin` rule: the request origin must be `ALLOWED_ORIGIN`,
  `http://localhost:*` or `http://127.0.0.1:*`, and `Origin` must equal it. Cloudflare rate-limit rule (Setup
  step 5).
- **Request:** JSON `{side, email, kind, city, consent: true, website: ""}`, plus for listers `units, available,
  neighbourhood?, phone?`.
- **Response:** `200 {"ok": true}`.
- **Errors:**
  - `400 {"error": "invalid", "fields": ["email", …]}`;
  - `403 {"error": "origin"}`;
  - `405`;
  - `413`;
  - `415` (not JSON);
  - `500 {"error": "server"}`: a D1 failure, logged with `console.error` without the email or phone.

**`GET /api/count`**
- **Auth rule:** public, anonymous.
- **Response:** `200 {"total": n | null}`. Edge-cached 60 s.
- **Errors:** `405`; `500 {"error": "server"}`.

## UI
One page, `waitlist/public/index.html`, `dir="rtl" lang="he"`. There is no artboard (PRODUCT "Brand": no new
artboards, so the design is specified here). The brand kit wins:
- tokens as CSS custom properties copied from `design/brand/tokens.json`;
- Fredoka 600 only for display/h1/h2 and the wordmark, never below 24 px; Rubik for everything else;
- black and white with `accent` as the only colour;
- **no shadows on cards** (`border` instead);
- `radius-lg` cards, `radius-md` buttons and inputs, `radius-pill` chips;
- logical CSS properties only (hard rule 5: `margin-inline-start`, `inset-inline-end`, `text-align: start`, never
  left/right).

The layout is mobile-first. Breakpoints are 768 px and 1200 px, with a content max-width of 1120 px and 16 px side
padding on phones.

**The enterprise-modern feel** comes from restraint:
- wide whitespace: sections 96 px apart on desktop, 64 px on phone;
- a strict 12-column grid on desktop;
- large type;
- a quiet hairline grid or a soft `accent-soft` radial wash behind the hero (CSS only, no images);
- crisp 1 px borders;
- one accent-filled element per viewport.

Motion is small. The hero turtle floats 6 px on a 6 s loop, and sections fade up 12 px on first scroll into view
(IntersectionObserver). **All motion is off under `prefers-reduced-motion: reduce`.** No carousel, no parallax.

**Sections, top to bottom:**
1. **Header** (sticky, white, 64 px, bottom `border` once scrolled): `homie-lockup-he.svg` at the start, as the
   app's header uses the lockup next to its one turtle. At the end, an ink button "הצטרפות לרשימה" (anchor to
   #join).
2. **Hero**, two columns on desktop with text at the start and the turtle at the end (stacked on phones, turtle
   first, 200 px wide):
   - a pill badge in `accent-soft` / `accent-strong`: "בקרוב בגוש דן";
   - display heading: "למצוא בית בגוש דן, בלי הבלגן.";
   - lead text (`ink-muted`, 18 px): "הומי מחברת בין מי שמשכירים דירה או חדר לבין מי שמחפשים בית או שותפים.
     בלי מתווכים, עם התאמה אמיתית. נרשמים עכשיו ושומעים ראשונים על ההשקה.";
   - two buttons. Primary (ink): "מחפשים בית". Secondary (white, `border-strong`): "משכירים נכס". Each scrolls to
     #join and selects that tab;
   - the counter line under the buttons, only when `total` is a number: "כבר {n} נרשמו לרשימה", with n formatted
     with `toLocaleString('he-IL')`. It is hidden on null, on a failed fetch and while loading (no spinner, no
     layout shift: the line's height is reserved);
   - the turtle: `homie-turtle-hello.svg`, 360 px on desktop, on an `accent-soft` circle (never on `accent`),
     `alt=""`.
3. **Two doors** (#sides): two equal cards side by side (stacked on phones). Each has an h2 and three lines, and
   each line has a small `accent` check icon (inline SVG, `aria-hidden`):
   - "למחפשים": "מודעות מבעלי הדירות עצמם, בלי מתווכים" · "ציון התאמה לכל דירה וחדר" · "מגישים מועמדות בהודעה
     קצרה, והצ'אט נפתח כשיש עניין".
   - "למשכירים": "מועמדים מאומתים באימייל" · "כל הפניות במקום אחד, ובוחרים למי לענות" · "הערכת שכר דירה לפי
     נתונים רשמיים".
   - The card footer link is "להצטרפות ←", which goes to #join and selects that card's tab (the arrow points to
     the reading direction's end in RTL).
4. **Video** (#video):
   - h2 "ככה זה נראה" and the line "43 שניות על הומי".
   - `<video controls preload="none" playsinline poster="media/homie-promo-poster.webp" src="media/homie-promo.mp4">`
     in a 16:9 `radius-lg` frame with a `border`, at max 960 px. `aria-label` on the video: "סרטון ההיכרות של הומי".
   - A large round ink play button with the label "צפייה בסרטון" covers the poster. Clicking it calls
     `video.play()` and hides the button, after which the native controls take over.
   - If the file fails to load (`error` event), the frame shows the poster with the line "הסרטון לא נטען. אפשר
     לנסות שוב מאוחר יותר.".
5. **Join** (#join): h2 "הצטרפות לרשימת ההמתנה" and a segmented control with two tabs ("מחפשים" | "משכירים").
   - It follows WAI-ARIA tabs: `role="tablist"`, and the arrow keys move between tabs. In RTL the right arrow goes to
     the previous tab, matching visual order.
   - The default tab is "מחפשים". `?side=lister` in the URL, or a button from sections 2–3, selects that tab.
   - Each tab has its own `<form novalidate>` in a `radius-lg` card, max 560 px, centred.
   - **Seeker form:**
     - "אימייל" (`type=email`, `autocomplete=email`, required);
     - "מה מחפשים?": a radio group shown as two chips, "דירה" / "חדר בדירת שותפים" (required, no default);
     - "באיזו עיר?": a `<select>` with a first disabled option "בחירת עיר", then `cities.js` (required).
   - **Lister form:**
     - "אימייל" (required);
     - "טלפון (לא חובה)" (`type=tel`, `inputmode=tel`, `autocomplete=tel`), hint "רק אם נוח שנחזור אליכם
       בוואטסאפ";
     - "מה מפרסמים?": chips "דירה" / "חדר בדירת שותפים" (required);
     - "באיזו עיר?" (required);
     - "שכונה (לא חובה)" (text, maxlength 60);
     - "כמה נכסים?": chips "1" / "2" / "3 ומעלה" (required);
     - "מתי הנכס מתפנה?": chips "כבר עכשיו" / "בעוד חודש עד שלושה" / "מאוחר יותר" (required).
   - **Both:**
     - a consent checkbox, required and unchecked: "אפשר לשלוח לי עדכון במייל כשהומי עולה לאוויר";
     - the honeypot `website` input, visually hidden by a class in `styles.css` (`position: absolute;
       inset-inline-start: -9999px`; no inline style, Scope 6), with `tabindex=-1`, `autocomplete=off` and
       `aria-hidden=true`;
     - the submit: an ink, full-width button "הרשמה לרשימה".
   - **The privacy line** under the button (`caption`, `ink-muted`): "שומרים רק את מה שמילאתם כאן, כדי לעדכן על
     ההשקה ולדעת כמה מחכים בכל עיר. לא מעבירים לאף אחד. למחיקה מהרשימה: {CONTACT_EMAIL}". The committed
     `index.html` holds the placeholder `contact@example.com` as a `mailto:` link (both the `href` and the text).
     `deploy-waitlist` writes the real address into the deployed copy only (`build.mjs`, Scope 4).
   - **States:**
     - *Empty:* the form as above.
     - *Loading:* the submit button shows "בשליחה…", is `aria-disabled`, and a second click is ignored.
     - *Field error*, client-side on submit from `validate.js` and repeated server-side: a `danger` message with
       an icon under each bad field, linked by `aria-describedby`, with `aria-invalid`. Focus moves to the first
       bad field. A server 400 maps its `fields` to the same messages:
       - email: "צריך אימייל תקין, למשל name@example.com";
       - phone: "מספר הטלפון לא נראה תקין. אפשר גם להשאיר ריק.";
       - kind: "צריך לבחור מה מחפשים" (seeker) / "צריך לבחור מה מפרסמים" (lister);
       - city: "צריך לבחור עיר";
       - units: "צריך לבחור כמה נכסים";
       - available: "צריך לבחור מתי הנכס מתפנה";
       - consent: "כדי להירשם צריך לסמן את האישור".
     - *Error:* a 5xx, 403, 413 or network failure shows a `danger` banner above the button with `role="alert"`:
       "משהו השתבש. אפשר לנסות שוב בעוד רגע." When `navigator.onLine === false` it says "אין חיבור לאינטרנט"
       instead (the app's string). Field values are kept.
     - *Success:* the card's content is replaced, and focus moves to its heading. It shows:
       - `homie-turtle-celebrate.svg` (160 px, `alt=""`);
       - the h2 "נרשמתם!";
       - the line "נעדכן ב-{email} ברגע שהומי עולה לאוויר. לאט לאט? ממש לא." (the one turtle joke on the page);
       - a text button that joins the other side and switches tabs to a fresh form with the email pre-filled. Its
         text is the literal "גם משכירים? להרשמה גם שם" after a seeker signup, or "גם מחפשים? להרשמה גם שם" after
         a lister signup.

       The hero turtle and this turtle never share a viewport, because #join sits well below the hero. The counter
       does not refresh.
6. **Footer** (`surface-subtle`, top `border`): `homie-wordmark-he.svg` at 24 px high, "© הומי 2026", and the
   contact `mailto:` (the same placeholder).

**`<head>`:**
- `<title>הומי | רשימת המתנה</title>`;
- meta description = the hero lead text;
- `<link rel="canonical" href="https://join.example.com/">`;
- Open Graph and Twitter card tags: `og:title` "הומי: למצוא בית בגוש דן, בלי הבלגן", `og:url`
  `https://join.example.com/`, `og:image` `https://join.example.com/img/og.png` (absolute URLs: scrapers ignore
  relative ones; `build.mjs` writes the real origin), `og:locale` he_IL;
- `homie-favicon.svg` as the icon, and `theme-color` `#FFFFFF`;
- `<link rel="preload">` for the two Hebrew woff2 files.

There is no JS framework. `app.js` is a `type="module"` script. Without JS the forms still render, but submitting
does nothing useful, which is acceptable (it is noted in the README).

**Quality bar:**
- Lighthouse mobile ≥ 95 for Performance, Accessibility, Best Practices and SEO. The coder records the scores in
  the PR from a local run against `wrangler pages dev .dist` (after a `build.mjs` run with a dummy address and
  origin in the environment), or against the python server for everything but SEO.
- Total page weight is ≤ 500 KB before the video, which loads only on play (`preload="none"`).
- WCAG 2.2 AA: contrast from the tokens, visible `accent` focus rings, target size ≥ 24 px, and every chip group is
  a `<fieldset>` with a `<legend>`.

**Hard rule 4** (i18n keys) covers `web/` only, like the admin's English (PRODUCT "Admin"). This page's Hebrew
is written in `index.html` and `app.js`, and every string is listed above. `make i18n-check` does not scan
`waitlist/` and must not start to. The new `web/e2e/waitlist/*.ts` file holds Hebrew only in test assertions, like
the existing e2e files.

## Setup (Gilad, once; written into `waitlist/README.md`)
1. The domain is on Cloudflare DNS (0013a runbook step "DNS"; do it first if 0013a has not been deployed yet).
2. From `waitlist/`:
   1. Run `pnpm dlx wrangler@<v> login`.
   2. Run `pnpm dlx wrangler@<v> d1 create homie-waitlist`.
   3. Run `pnpm dlx wrangler@<v> pages project create homie-waitlist --production-branch main`.
   4. In `waitlist/wrangler.toml`, replace the `database_id` with the printed one and `ALLOWED_ORIGIN` with
      `https://join.<domain>`, then commit (neither is a secret). `wrangler.toml` is then the source of truth for the
      project's binding and vars; the dashboard does not edit them.

   `<v>` is the Makefile's `WRANGLER_VERSION`.
3. Run `make waitlist-migrate`.
4. Run `make deploy-waitlist CONTACT_EMAIL=…`. In the Pages project, add the custom domain `join.<domain>`
   (Cloudflare adds the DNS record).
5. In Cloudflare → Security → WAF → Rate limiting rules (the free plan includes one rule), add: hostname equals
   `join.<domain>` and path equals `/api/signup`, method POST, 5 requests per 10 s per IP → block for 10 s. If 0013a
   needs the zone's one free rule later, that is its call; this rule can be widened to an OR of both paths.
6. Run `make waitlist-stats` any time.
7. To remove an entry on request: `make waitlist-delete`, then type or paste the address (stdin). Never paste an
   address into a `d1 execute --command` by hand: the email rule allows quotes, `$(…)` and backticks (review B1).

## Acceptance criteria
Unit tests run under `node --test`. `waitlist/test/signup.test.js` calls the Functions' `onRequest` with a `Request`
and a context `{request, env: {DB, ALLOWED_ORIGIN: "https://join.example.com"}}`. The request URL is
`https://join.example.com/api/…` with the matching `Origin`, unless the test says otherwise.
- [ ] AC1 Given a valid seeker body, when it is POSTed, then the response is 200 `{ok: true}` and one row exists
  with the email trimmed and lower-cased and the lister columns null — `waitlist/test/signup.test.js::ac1_seeker_signup_stored`
- [ ] AC2 Given a valid lister body with phone "+972 52-123-4567", then the stored phone is "0521234567" and
  units/available are stored; with phone "" it is null — `…::ac2_lister_signup_normalises_phone`
- [ ] AC3 Given the same (side, email) twice, then both responses are 200 `{ok: true}` and there is one row; the
  same email on the other side makes a second row — `…::ac3_duplicate_is_silent_and_sides_independent`
- [ ] AC4 Each of these returns 400 with exactly the bad keys in `fields`, and no row is stored: a bad email, an
  unknown city, a missing kind, `consent: false`, a lister without units or available, a phone "123", or a seeker
  body carrying `phone`. Invalid JSON returns 400 too — `…::ac4_invalid_fields_rejected` (table-driven)
- [ ] AC5 Given a filled `website` field, then 200 `{ok: true}` and no row — `…::ac5_honeypot_drops_silently`
- [ ] AC6 `…::ac6_origin_host_size_type_and_method_guards`:
  - an `Origin` other than the request's own origin → 403;
  - no `Origin` → 403;
  - a request URL on `https://homie-waitlist.pages.dev` with a matching `Origin` → 403;
  - `http://localhost:8788` with a matching `Origin` → 200;
  - a body over 4 KB → 413;
  - a `Content-Type` that is not JSON → 415;
  - a GET to `/api/signup` → 405 with `Allow: POST`.
- [ ] AC7 Given 49 rows, `GET /api/count` returns `{total: null}`; given 50, `{total: 50}`. It carries
  `Cache-Control: public, max-age=60`. With a fake `caches.default` that already holds a response for the URL, a GET
  returns it and does not touch D1. A POST to `/api/count` → 405 — `…::ac7_count_threshold_and_cache`
- [ ] AC8 Given D1 throws on insert, then 500 `{error: "server"}`, and the logged line contains neither the email
  nor the phone — `…::ac8_db_failure_logged_without_pii`
- [ ] AC9 `validate.js` is the one rule set. The test imports `public/validate.js` directly and the rule functions
  that `lib/signup.js` uses, and asserts they are the same function objects (`===`). It also checks that `app.js`'s
  source imports `./validate.js` — `…::ac9_single_validation_source`
- [ ] AC10 Page: the default tab is seekers; "משכירים נכס" in the hero and `?side=lister` both open the lister tab;
  the arrow keys move between tabs in visual (RTL) order — `web/e2e/waitlist/waitlist.waitlist.ts::ac10_tabs_and_deep_link`
- [ ] AC11 Page: submitting empty shows each required field's message, focus lands on the email field, and no
  request is sent; a stubbed 400 `{fields: ["city"]}` shows the city message — `…::ac11_field_errors`
- [ ] AC12 Page: a stubbed 200 shows the success state with the celebrate turtle and the email; the "גם משכירים?"
  button opens the lister tab with the email pre-filled — `…::ac12_success_and_other_side`
- [ ] AC13 Page: a stubbed 500 shows the `role=alert` banner and keeps the field values; a double click while
  loading sends one request — `…::ac13_error_and_single_submit`
- [ ] AC14 Page: count stubbed `{total: 1234}` shows "כבר 1,234 נרשמו לרשימה"; `{total: null}` and a 500 both
  show no counter line — `…::ac14_counter`
- [ ] AC15 Page: the video has `preload="none"`, and no request for `homie-promo.mp4` is made before the click.
  Clicking the play button calls `play()` once and hides the overlay. Playwright's Chromium has no H.264 decoder, so
  an `addInitScript` replaces `HTMLMediaElement.prototype.play` with a recorder that resolves —
  `…::ac15_video_click_to_play`
- [ ] AC16 Page: axe finds no violations at 375×812 and 1280×800 in the empty, error and success states, and
  `prefers-reduced-motion: reduce` sets no running animation (`getAnimations()` is empty) — `…::ac16_axe_and_reduced_motion`
- [ ] AC17 `_headers` holds the Scope 6 headers. A string check compares each header name and value, with the CSP
  whitespace normalised — `signup.test.js::ac17_headers_file`. The page makes no request to any origin other than its
  own (the test fails on any non-localhost request) — `waitlist.waitlist.ts::ac17_no_third_party_requests`
- [ ] AC18 `stats.sql`, run with `node:sqlite` against an in-memory database built from the real migration and
  seeded with fixture rows of both sides:
  - it is a single statement;
  - it returns the five summaries with the expected counts, including `units` with `'3+'` counted as 3;
  - no column is named `email` or `phone`, and no fixture email or phone appears in any value.

  `waitlist/test/stats.test.js::ac18_stats_query`. `waitlist-stats` runs the same file.
- [ ] AC19 `build.mjs` writes the address and origin into `.dist/index.html`, run into a temp copy of `waitlist/`
  with `CONTACT_EMAIL=hello@homie.test` and a `wrangler.toml` holding `https://join.homie.test`:
  - neither placeholder remains, `mailto:hello@homie.test` is there, `og:image` is `https://join.homie.test/img/og.png`,
    and `public/index.html` is unchanged;
  - it exits non-zero for an empty address, `contact@example.com`, an address containing `"`, and the placeholder
    origin.

  `waitlist/test/build.test.js::ac19_build_writes_contact_and_origin`
- [ ] NF1 Page weight ≤ 500 KB before video; video ≤ 8 MB; Lighthouse ≥ 95 ×4 on mobile — measured, numbers in the PR body
- [ ] NF2 No log line, error body or stats output contains an email or phone — AC8 + AC18

## Tests to write
- **Unit (`node --test 'waitlist/test/*.test.js'`):**
  - `signup.test.js` (AC1–AC9, AC17 headers). It uses a fake D1 (`prepare().bind().run()/.first()/.all()`) backed by
    an in-memory `node:sqlite` `DatabaseSync` running the real migration, so the CHECKs and the UNIQUE constraint
    are exercised.
  - `stats.test.js` (AC18).
  - `build.test.js` (AC19).
- **Page (Playwright, `web/playwright.waitlist.config.ts`):** `web/e2e/waitlist/waitlist.waitlist.ts` (AC10–AC17).

## Risks / open questions
- **The counter can be inflated** by bots that get past the honeypot and the rate-limit rule. The threshold and
  the 60 s cache limit the damage. Turnstile is the follow-up if `waitlist-stats` shows junk.
- **The phone number is PII held outside the app's retention rules (0013h).** The privacy line promises deletion on
  request (Setup step 7). The security reviewer should check that nothing logs it.
- **Bundling `public/validate.js` into a Function:** wrangler's esbuild resolves relative imports outside
  `functions/`, and the coder confirms it with `pages functions build` (Scope 1). If it ever fails, move
  `validate.js` and `cities.js` to `lib/`, and have `build.mjs` copy them into `.dist/`. The page then loads the
  copies, AC9 keeps its `===` check on `lib/`, and the PR says so.
- **The Makefile overlaps with 0013a** (`WRANGLER_VERSION`, `CONTACT_EMAIL`). Whichever merges second keeps one
  `WRANGLER_VERSION` line (Blast radius).
- **Gilad defaults D1–D3** above. The digest asks him to confirm.

## Blast radius
`graphify affected` (graph at `../rent-app/graphify-out`) has no node for the Makefile or `.gitignore`. For
`README.md` and `playwright.config.ts` it finds no dependents. Checked with grep instead:
- **`Makefile` `test` target** (gains `test-waitlist`):
  - CI's "Test" step (`make test`) runs it, so the page test needs the browser install in `test-waitlist` (Scope 4).
  - The `test-api` and `test-web` targets are untouched.
- **`Makefile` top level** (gains `WRANGLER_VERSION :=`, new targets, `.PHONY`):
  - `api/tests/test_dotenv.py` copies and `include`s the real Makefile, so the additions must stay parse-time
    free: plain literals only (Scope 4). It needs no change.
  - 0013a (verified, not merged) also defines `WRANGLER_VERSION` and a `CONTACT_EMAIL` make variable. Whichever
    merges second resolves the conflict to one definition, and the orchestrator tells 0013a's session.
- **`web/` lint/tsc scope:** `tsconfig.json` includes `e2e` and `*.ts`, so the new config and test are type-checked
  and linted.
  - `playwright.config.ts` (`testDir: 'e2e'`, default `*.spec.ts` match) does not pick up `*.waitlist.ts`.
  - vitest (`src/**/*.test.*`, `scripts/__tests__`) does not pick it up either.
  - `playwright.screens.config.ts` only matches `*.screens.ts`.
- **`README.md`**, **`.gitignore`**: one line each; nothing reads them.
- **`.github/workflows/ci.yml`**: not changed (Scope 4 explains why).

## Verifier notes (2026-11-16, one round, applied)
1. `WRANGLER_VERSION` does not exist on `main` (0013a is unmerged and pins no exact number), so this spec now defines
   it as a plain `:=` literal (newest 4.x ≥ 2 weeks old). Whichever of 0013a and 0017 merges second keeps one line.
2. `CONTACT_EMAIL` as a make variable is also 0013a's (unmerged). `deploy-waitlist` now defines it. `build.mjs`
   reads it from the environment (never shell-interpolated), validates it against an HTML-safe pattern, writes it
   into a git-ignored `.dist/` copy, and refuses the placeholder. The committed `index.html` keeps
   `contact@example.com`. AC19 tests it.
3. CI's `make test` runs before `make e2e`, the only step that installs browsers, and GitHub-hosted runners only
   restore them on a cache hit. `test-waitlist` now runs `playwright install --with-deps chromium` itself, so
   `ci.yml` stays unchanged. The "move it to the e2e step" branch is removed.
4. `waitlist/e2e/waitlist.spec.ts` could not resolve `@playwright/test` (Node resolves from the file's folder, not
   `web/node_modules`), and the `.spec.ts` name would join `make e2e`. The test moved to
   `web/e2e/waitlist/waitlist.waitlist.ts` with `testMatch: '*.waitlist.ts'`, the `screens` config's pattern.
   `reuseExistingServer: false` is set.
5. `node:sqlite` is unflagged from Node 22.13, and CI's `setup-node` resolves `.nvmrc` `22` to the newest 22.x. The
   skip and JS-map fallbacks are dropped, so AC18 cannot be silently skipped. `waitlist/package.json` with
   `"type": "module"` was added so `node --test` loads the ES modules. `node --test waitlist/test/` became a quoted
   glob, because Node 22 does not expand a directory argument.
6. The `ALLOWED_ORIGIN` dashboard env var conflicted with a `wrangler.toml` deploy, where the file owns vars and
   bindings. It moved to `[vars]` in `wrangler.toml`, filled at Setup step 2 with `database_id`. `compatibility_date`
   and a Setup `pages project create` step were added (a first `pages deploy` prompts otherwise).
7. Security: `*.pages.dev` bypassed the zone's WAF rate-limit rule. The origin guard now also requires the request
   host itself to be `ALLOWED_ORIGIN` or localhost (AC6), and the WAF rule is scoped to the hostname.
8. The "405 is Pages' default" claim was wrong: a missing `onRequestGet` falls through to static assets. Each
   Function now exports one `onRequest` that returns 405 with `Allow` (AC6, AC7).
9. `waitlist-stats` with a remote `--file` prints no rows, and a multi-statement `--command` is fragile. `stats.sql`
   is now one `UNION ALL` SELECT run through `--command "$$(cat stats.sql)"`. AC18 tests the same file with
   `node:sqlite`, says "five summaries" (it said six; Scope lists five) and drops the `--local` wrangler mention.
10. The promo video is git-ignored and exists only in the main checkout. Scope 5 now names
    `../rent-app/promo-video/out/…` (16.6 MB source → ≤ 8 MB, committed; Pages' limit is 25 MiB).
11. AC15: Playwright's Chromium cannot decode H.264, so the "1 s test clip, `paused` is false" check could not pass.
    It now spies on `HTMLMediaElement.prototype.play` and asserts no video request before the click.
12. `/api/count` reads every row (D1 bills a `COUNT(*)` per row) on each uncached view, and Function responses are
    not edge-cached. It now uses `caches.default` for 60 s (AC7).
13. CSP `style-src 'self'` forbids inline styles: the honeypot hiding is a class, and Scope 6 says there are no
    inline scripts, styles or handlers. `og:image` and `og:url` must be absolute: the `https://join.example.com`
    placeholder is written by `build.mjs`, and a canonical link was added. The footer uses the wordmark file
    (Fredoka is outlined, 24 px high). Turtles get `alt=""`. The other-side button's text is two literal strings.
14. PRODUCT check: voice is gender-neutral (plural, infinitive or noun forms, no slash forms), there is one turtle
    joke, and Fredoka is only ≥ 24 px. The header lockup carries the app icon as the app's own header does. Hero and
    success turtles never share a viewport. No contradiction found. Setup step 7 (delete on request) and
    `.gitignore` entries were added.

## Digest (filled by orchestrator after verification)
Verified 2026-11-16 (one verifier round, 14 fixes applied in place). Build: one Opus/high coder run, reviewers code, security, ux, qa. Merging delegated by Gilad ("Yes, merge it").
- Delivers: `join.<domain>` waitlist page (own Pages project + D1), `POST /api/signup`, `GET /api/count`, `make waitlist-migrate|deploy-waitlist|waitlist-stats|test-waitlist`.
- Defaults for Gilad to confirm: D1 counter from 50 signups, D2 video click-to-play, D3 subdomain `join`.
- Risk: the Makefile overlaps with 0013a (`WRANGLER_VERSION`, `CONTACT_EMAIL`); whichever merges second keeps one definition.
