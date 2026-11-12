---
id: 0009e
title: The app installs from the browser as a Hebrew RTL PWA named by `app.title`, with real icons and a service worker that precaches only the build's static files and never caches an API response; every page's HTML carries the title, description, theme colour and a Heebo preload; a build check proves all of it
status: verified
depends_on: [0009a]   # 0009a: the Rubik and Fredoka font files the preload points at, the final `app.title`, the header surface that `theme_color` matches. (0009a depends on 0009h → 0009d, which provide the `bg` / `surface` tokens read here.) Split out of 0009a by its verifier (round 1, 2026-11-12)
reviewers: [code, qa, security, ux]   # security: the service-worker caching policy against the cookie session `rent_session`; qa: AC9's signed-in install and offline check; ux (Sonnet/medium, narrow brief): the icons, favicon and theme / background colours against Main.dc.html:24-25 and AC9's screenshots — 0009a's Risks promise the UX reviewer judges the teal → white status bar
estimate: 1 coder run   # coder Opus/high: the caching rule is security-relevant (Speed rule 6)
---

> **Brand kit amendment (orchestrator, 2026-11-12, no verifier re-run):** `design/brand/` (README.md, tokens.json) wins over the artboards and over any older wording below for colour, type (Fredoka for display/h1/h2, Rubik for the rest), radii, no card shadows, the name homie / הומי, the mascot and the voice (no slash forms: plural, infinitive or noun; action-noun buttons; errors say "what happened. what to do."). Token and kit names are those of 0009d. Where this spec still names a teal token, Heebo or a slash form, the builder applies the brand equivalent.

## Goal
After this ships, Chrome (desktop and Android) offers to install the app, and iOS adds it to the home screen
with a proper icon. The installed app is named by `app.title` (Hebrew, RTL) and opens on `/`. Its service
worker precaches only the build's own files, so every API answer, including anything sent with the
`rent_session` cookie, always comes from the network. Every page's HTML carries `<title>`, a description, the
theme colour and a preload for the Hebrew Rubik file. A build check in CI fails if any of this regresses.

This serves PRODUCT.md "Platform" (web first, responsive, PWA-installable) and Dev Plan slice 9, part a. It
was split out of `0009a` by that spec's verifier. It resolves FOLLOWUPS line 81 (as of 8c3c480).

## Scope
**In:**
- `web/html.config.ts` (new, at the web root next to `vite.config.ts`; `tsconfig.json` includes `*.ts`). It
  exports `htmlTags({ themeColor }): Plugin`, a Vite plugin.
  - Its `transformIndexHtml` (`order: 'post'`) returns tags with `injectTo: 'head'` (after the charset meta):
    - `<title>` from `he.app.title`;
    - `<meta name="description">` from `he.app.tagline`. Both are read from `src/locales/he.json`, so the
      config holds no Hebrew literal;
    - `<meta name="theme-color" content={themeColor}>`;
    - in a build only, `<link rel="preload" as="font" type="font/woff2" crossorigin>` for the emitted
      `heebo-hebrew-wght-normal-*.woff2`, found in `ctx.bundle`. The `href` is the resolved `config.base`
      plus the file name. The build **throws** when no such file exists, so a renamed font file breaks the
      build instead of silently losing the preload.
  - **Verify on the first `make build-web`** that `dist/index.html` holds the preload. Under Vite 8 /
    Rolldown, CSS-referenced fonts should already be in `ctx.bundle` when the `post` HTML hooks run.
    - If they are not, move the preload into a `generateBundle` hook (`order: 'post'`) that patches
      `bundle['index.html'].source`. It must **not** be a `closeBundle` hook, because vite-plugin-pwa writes the
      worker and the precache revision of `index.html` in `closeBundle` (`dist/index.js:416-429`).
    - Say in the digest which hook was used.
  - `vite.config.ts`:
    - `import tailwind from './tailwind.config'`, then `const { colors } = tailwind.theme.extend`;
    - `htmlTags({ themeColor: colors.surface.DEFAULT })` is added to `plugins`. 0009d makes `surface` an
      object (`DEFAULT` plus `muted`), as `accent` already is.
  - `App.tsx`'s runtime `document.title = i18n.t('app.title')` stays.
- `web/pwa.config.ts` (new) exports `pwaOptions` (it reads `colors` the same way), and `vite.config.ts` calls
  `VitePWA(pwaOptions)`.
  - `registerType: 'autoUpdate'` and `injectRegister: 'auto'`, as today.
  - `manifest`:
    - `id: '/'`. A fixed id keeps an installed app's identity across a later rename;
    - `name` and `short_name` from `he.app.title`, and `description` from `he.app.tagline`;
    - `lang: 'he'`, `dir: 'rtl'`, `start_url: '/'`, `scope: '/'`, `display: 'standalone'`;
    - `background_color: colors.bg`, the page background, which is also the splash screen;
    - `theme_color: colors.surface.DEFAULT`, the header surface (0009a) and the installed app's status bar.
      This replaces today's teal `#2563EB`; see Risks;
    - `icons`: `/icons/icon-192.png` and `/icons/icon-512.png` (`purpose: 'any'`), and
      `/icons/icon-maskable-192.png` and `/icons/icon-maskable-512.png` (`purpose: 'maskable'`), all
      `type: 'image/png'`.
  - `workbox` (generateSW). This is **the security rule of this spec**, and it has exactly these five keys:
    - `globPatterns: ['**/*.{js,css,html}', 'assets/heebo-{hebrew,latin}-wght-normal-*.woff2']`;
    - `globIgnores: ['**/maplibre-gl-*']`, as today: the lazy map library is never precached.
      workbox-build adds `sw.js` and `workbox-*.js` to the ignores itself (`generate-sw.js:68-82`);
    - `navigateFallback: 'index.html'`, so a navigation gets the app shell. The shell is the same HTML for
      every visitor and holds no personal data;
    - `navigateFallbackDenylist: [/^\/api\//]`, a guard in case Slice 12 ever proxies the API on the web
      origin;
    - `cleanupOutdatedCaches: true`.

    These two are the plugin's defaults too (`dist/index.js:835-838`). They are stated so the test can pin
    them.
  - **Not set**: `runtimeCaching`, `importScripts`, `inlineWorkboxRuntime`, `strategies`, `injectManifest`,
    `selfDestroying` and `devOptions`. So every API call goes to the network, untouched by the worker. That
    covers `VITE_API_URL` (another origin, with the `rent_session` cookie), the OSM tiles, the map style
    (`/map/osm-raster.json`, which `globPatterns` does not match) and the map chunk.
  - `includeManifestIcons` stays at its default (`true`), so the manifest and its four icons are precached too
    (`dist/index.js:68-77, 103-137`).
  - A comment names the rollback lever: `selfDestroying: true` ships a worker that unregisters itself.
- **Update behaviour** is what `autoUpdate` sets: `skipWaiting` + `clientsClaim` (`dist/index.js:874-877`).
  - A new deploy's worker takes control as soon as the browser fetches it, which happens on a navigation.
  - The open tab keeps running the code it loaded; the next navigation or reload gets the new shell.
  - There is no "new version" prompt and no forced reload, because a reload could lose a wizard step or a
    chat draft.
- **Icons**:
  - `web/icons/icon.svg`: the artboard's mark, a white house (`Main.dc.html:24-25`) on an `accent` rounded
    square, on transparent;
  - `web/icons/icon-maskable.svg`: a full-bleed `accent` square, with the house inside the maskable safe
    zone (the circle of 80 % diameter at the centre);
  - both SVG sources carry the `accent` hex with a comment naming the token. AC3 checks that the hex equals
    `colors.accent.DEFAULT`. They are design assets outside `web/src`, so 0009h's colour-literal check does
    not cover them;
  - `web/scripts/make-icons.mjs` renders them with Playwright's Chromium (`@playwright/test` is already a
    devDependency, so no new dependency). It uses `deviceScaleFactor: 1`, a viewport equal to the target size,
    and `omitBackground: true` for the `any` icons. It writes:
    - `web/public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-192.png` and `icon-maskable-512.png`;
    - `web/public/icons/apple-touch-icon.png` (180 px, the maskable artwork, opaque);
    - `web/public/icons/favicon-32.png` (the `any` artwork), the PNG fallback for browsers that ignore SVG
      favicons;
    - a copy of `icon.svg` at `web/public/favicon.svg`;
  - the new Makefile target `icons` runs `pnpm exec playwright install chromium`, then the script. The
    generated files are committed, and CI never regenerates them.
- `web/index.html`:
  - gains `<link rel="icon" href="/favicon.svg" type="image/svg+xml">`, `<link rel="icon"
    href="/icons/favicon-32.png" sizes="32x32" type="image/png">` and `<link rel="apple-touch-icon"
    href="/icons/apple-touch-icon.png">`;
  - loses its hard-coded `<meta name="theme-color" content="#2563EB">`, which `htmlTags` now injects.
- `web/package.json` and **`web/pnpm-lock.yaml`**: `vite-plugin-pwa` moves from `dependencies` to
  `devDependencies`, with the lockfile's importer entry regenerated, because CI installs with
  `--frozen-lockfile`. This is FOLLOWUPS line 81.
  - It is a build-time plugin, and the app imports nothing from it at runtime: `injectRegister: 'auto'` writes
    a plain `registerSW.js`, and there is no `virtual:pwa-register` import.
  - The web Dockerfile runs a full `pnpm install`, so dev dependencies are still installed.
  - There is no bump. vite-plugin-pwa 2.0.0 and workbox-build 7.4.1 are the latest releases (`npm view`,
    2026-11-12). glob's fix needs ≥ 14.0.2, but workbox-build pins `^11`. minimatch comes through glob, and
    deepmerge has no patched version.
  - After the move, `pnpm audit --prod` is clean, while a plain `pnpm audit` still lists the three build-time
    advisories.
- `web/scripts/build-check.mjs` (new) checks `dist` **against itself**. It needs no TypeScript or JSON imports.
  - **Invocation:**
    - it takes the dist directory as `argv[2]`, defaulting to `<scriptDir>/../dist` resolved from the
      script's own directory, as `i18n-check.mjs:23-25` does;
    - it prints one line per problem and exits 1 on any;
    - it exits 2 with "run make build-web first" when the directory is missing.
  - **`manifest.webmanifest`:**
    - `id`, `start_url` and `scope` are `/`; `lang` is `he`; `dir` is `rtl`; `display` is `standalone`;
    - `name`, `short_name` and `description` are non-empty;
    - `background_color` and `theme_color` match `^#[0-9A-Fa-f]{6}$`;
    - exactly four icons: 192 and 512 for each of `any` and `maskable`. Each file exists, and its PNG IHDR
      (width at byte 16, height at byte 20) has the declared size.
  - **`index.html`:**
    - exactly one `<title>`, equal to the manifest's `name`;
    - the description meta, equal to the manifest's `description`;
    - the theme-color meta, equal to the manifest's `theme_color`;
    - the manifest link, `apple-touch-icon`, the SVG favicon and the PNG favicon, each pointing at a file that
      exists;
    - a font preload whose file exists;
    - a `/registerSW.js` script, and the file exists.

    The link from these values to `he.json` and the tokens is AC2's job (`pwa.test.ts`).
  - **`sw.js`:**
    - it starts with the AMD header `define(["./workbox-<hex>"]`, and that `workbox-<hex>.js` exists in the
      directory. An inlined runtime (`inlineWorkboxRuntime`) would mangle the class names and hide a runtime
      strategy;
    - **at least one** precache entry, with `index.html` among them. Entries are parsed as either `url:"…"`
      (minified, production) or `"url": "…"` (unminified);
    - every precache URL is a relative path to a file that exists in the directory. None contains `http`,
      `sw.js`, `workbox-` or `maplibre-gl`;
    - **exactly one** `registerRoute(` (the navigation route; the precache route is registered inside
      `precacheAndRoute`) and exactly one `NavigationRoute`;
    - no `importScripts`, and none of `NetworkFirst`, `NetworkOnly`, `CacheFirst` or `StaleWhileRevalidate`.
- The Makefile, honouring Hard rule 2 (every target is added to `.PHONY` at `Makefile:29`):
  - `build-check` runs `node scripts/build-check.mjs dist` in `web/`. It does **not** depend on `build-web`,
    so CI builds once;
  - `icons` (see Icons) depends on `web/node_modules/.modules.yaml`, as the other web targets do
    (`Makefile:88,115,124`);
  - `preview-web` has the same dependency. It exits with "run make build-web first" when `web/dist` is
    missing, then runs `pnpm exec vite preview --port 4173 --strictPort`. Port 4173 is not the pinned 5173;
  - `audit-web` has the same dependency and runs `pnpm audit --prod`.
- `README.md`: the targets table (`README.md:119-121`) gains `build-check`, `icons`, `preview-web` and
  `audit-web`. The CI line (`:157`) gains "build-check".
- `.github/workflows/ci.yml`, `web` job: one step, `make build-check`, right after the existing Build step. It
  adds under a second, so it stays in the push tier (Speed rule 8).
- `web/scripts/i18n-check.mjs`: only the header comment at lines 9-10 changes, to: "Only .tsx is scanned, so
  non-.tsx files (vite.config.ts and the *.config.ts files beside it, which read the product name from
  he.json) are never read." The old mention of `web/public/manifest.webmanifest`, which never existed, goes.

**Out:**
- A custom "install the app" button or banner (`beforeinstallprompt`). The browser's own install UI is
  enough for now; this is a FOLLOWUPS proposal.
- Social link previews (`og:*` tags and a 1200×630 image), a FOLLOWUPS proposal for Slice 12.
- `sw.js` / `index.html` cache headers at the host (`Cache-Control: no-cache` in Cloudflare Pages
  `_headers`). This is deploy work for Slice 12 and a FOLLOWUPS proposal.
- An offline page, and offline-aware error copy (FOLLOWUPS line 17; 0009g's and 0009c's error states).
- Manifest `screenshots` and `shortcuts`.

**New dependencies:** none. `vite-plugin-pwa` moves to `devDependencies`, and the icon script uses the
existing `@playwright/test`.

## Data
None (web only).

## API
None. The API is never routed through the service worker.

## UI
No screen changes.
- Chrome shows the install icon in its address bar. Android offers "Add to Home screen" / "Install". The
  installed app opens standalone with the `surface` status bar.
- iOS uses `apple-touch-icon`.
- The tab shows the favicon and `app.title`.

No i18n key is added: `app.title` and `app.tagline` are read at build time.

## Acceptance criteria
- [ ] AC1 `htmlTags`, with `transformIndexHtml.handler` run directly:
  - with no `bundle`, it returns `title` = `he.app.title`, `meta[name=description]` = `he.app.tagline` and
    `meta[name=theme-color]` = the given colour, all `injectTo: 'head'`, and no preload;
  - with a `bundle` holding `assets/heebo-hebrew-wght-normal-abc.woff2` and base `/`, it also returns the
    preload `link` (`as=font`, `type=font/woff2`, `crossorigin`, `href=/assets/heebo-hebrew-wght-normal-abc.woff2`);
  - with a `bundle` holding no Rubik Hebrew file, it throws;
  - `vite.config.ts`, `html.config.ts` and `pwa.config.ts` contain no Hebrew letter.

  — `web/scripts/__tests__/html.test.ts::ac1_head_tags`
- [ ] AC2 `pwaOptions.manifest`:
  - `name` and `short_name` equal `he.app.title`, and `description` equals `he.app.tagline`;
  - `lang` is `he`, `dir` is `rtl`, `id`, `start_url` and `scope` are `/`, and `display` is `standalone`;
  - `background_color` equals tailwind `colors.bg`, and `theme_color` equals `colors.surface.DEFAULT`;
  - the icons are 192 and 512 at each of `any` and `maskable`.

  — `web/scripts/__tests__/pwa.test.ts::ac2_manifest`
- [ ] AC3 Icons:
  - every manifest icon, `public/icons/apple-touch-icon.png` (180) and `public/icons/favicon-32.png` (32)
    exists under `web/public` with its declared size, read from the PNG IHDR;
  - the `any` icons have colour type 6 (RGBA, transparent background);
  - `public/favicon.svg` exists;
  - both `web/icons/*.svg` contain `colors.accent.DEFAULT`.

  — `pwa.test.ts::ac3_icons`
- [ ] AC4 The service-worker policy:
  - `Object.keys(pwaOptions.workbox).sort()` equals `['cleanupOutdatedCaches', 'globIgnores',
    'globPatterns', 'navigateFallback', 'navigateFallbackDenylist']`, with the values in Scope;
  - `navigateFallbackDenylist` matches `/api/x`;
  - `strategies`, `injectManifest`, `selfDestroying` and `devOptions` are unset on `pwaOptions`;
  - `registerType` is `autoUpdate`.

  — `pwa.test.ts::ac4_sw_policy`
- [ ] AC5 `web/package.json` lists `vite-plugin-pwa` in `devDependencies` and not in `dependencies`. —
  `pwa.test.ts::ac5_plugin_is_dev_only`. Also, `make audit-web` reports no vulnerabilities, and its output goes
  in the digest.
- [ ] AC6 `build-check.mjs`, run by the test on fixtures **generated in temp directories** (`mkdtempSync`, as
  `i18n-check.test.ts:12-22` does). The test builds one `good` template: `index.html`, `manifest.webmanifest`,
  an AMD `sw.js`, `workbox-abc.js`, `registerSW.js`, a font file, and PNGs written with `Buffer` (signature +
  IHDR). Each case below applies one mutation to it. No fixture file is committed, so `eslint .` and
  `prettier --check .` never see one.
  - The `good` directory passes.
  - Each of these fails, with a line naming the problem:
    - in `index.html`:
      - no `<title>`, or two;
      - a `<title>` that differs from the manifest's `name`;
      - no description;
      - a theme-color that differs from the manifest's;
      - no manifest link;
      - no `apple-touch-icon`;
      - no favicon;
      - no preload, or a preload pointing at a missing file;
      - no `registerSW.js`;
    - in the manifest:
      - an icon whose file is missing;
      - an icon whose IHDR says 191 px;
      - three icons;
      - `dir` `ltr`;
    - in `sw.js`:
      - an `sw.js` with no `define(["./workbox-…"]` header, or one whose workbox file is missing;
      - `NetworkFirst`;
      - two `registerRoute(` calls;
      - `importScripts`;
      - a precache URL starting with `http`;
      - a precache URL `sw.js`;
      - a precache URL containing `maplibre-gl`;
      - zero precache entries;
      - no `index.html` entry;
      - zero `NavigationRoute`s, or two;
      - an unminified `"url": "…"` entry for a missing file.
  - A missing directory exits 2.

  — `web/scripts/__tests__/build-check.test.ts::ac6_good_passes_and_each_defect_fails`
- [ ] AC7 On the branch, `make build-web && make build-check` passes against the real `dist`. This is the CI
  `web` job's new step. The digest says which hook carries the preload (Scope, the first-build check).
- [ ] AC8 Security, by the reviewer against the real `dist/sw.js` and `dist/workbox-*.js`:
  - the only routes are the precache route and one `NavigationRoute` to `index.html`;
  - no request to `VITE_API_URL` can match a route;
  - Cache Storage can never hold a response fetched with the session cookie.

  Recorded in the review digest.
- [ ] AC9 Manual, by QA, **signed in**, in a fresh Chrome profile (or after Application → Clear site data,
  because a worker on `localhost:4173` persists across worktrees). Run these in the 0009e worktree; none binds
  port 5173:

  ```
  WEB_ORIGIN=http://localhost:4173 make dev-api
  VITE_API_URL=http://localhost:$API_PORT make build-web
  make preview-web
  ```

  The results and screenshots go in the digest:
  - Application → Manifest shows no installability error, and the install icon appears in the address bar;
  - sign in through the outbox code, then open `/search`, `/me/applications` (or `/me/listings`) and a chat;
  - Application → Cache Storage holds only `workbox-precache-v2-*`, with build-file URLs and nothing from
    `localhost:$API_PORT`;
  - an offline reload (DevTools → Network → Offline) of a signed-in page shows the shell with the error state;
  - installed, the window's title bar uses `surface`. On Android, through `chrome://inspect` port forwarding,
    if a device is at hand: the status bar and the splash screen use `surface` / `bg`. Otherwise the digest
    says "not checked on Android".

  Afterwards run `make down` in that worktree, and `make dev-api` with the default `WEB_ORIGIN` before any
  `make e2e`.
- [ ] NF1 `make lint`, `make test`, `make i18n-check`, `make build-web` and `make build-check` are green on
  the final head. Local `make e2e` is green too (Speed rule 7): this spec adds no e2e test, but it changes
  `index.html` and the Vite config. The e2e result goes in the digest.

## Tests to write
- Unit (`web/scripts/__tests__/`, already in vitest's `include`):
  - `html.test.ts` (AC1);
  - `pwa.test.ts` (AC2–AC5);
  - `build-check.test.ts` (AC6), with its generated temp fixtures.
- Build: `make build-check` (AC7, in CI).
- Manual: AC8 (the security reviewer) and AC9 (QA).
- No e2e. The dev server registers no service worker (`devOptions` disabled), so Playwright against `make dev`
  cannot see one. AC6's fixtures and AC7's check on the real build replace it.

## Risks / open questions
No question for Gilad: the product name this reads is 0009a's Q1.

**Spec decisions** (the verifier and the reviewers challenge these):
- **No personal data can enter Cache Storage.**
  - The SPA's HTML is identical for every visitor, and the precache holds only build files.
  - The API is another origin (`VITE_API_URL`; Slice 12 puts it on `api.X` beside `app.X`, FOLLOWUPS line 8),
    and no route matches it. So cookie-bearing responses pass through the browser's normal network stack, and
    the worker never stores them.
  - Three checks prove it from different sides:
    - AC4 pins the workbox options;
    - AC6 proves the build check catches a strategy, an extra route, `importScripts` and an inlined runtime;
    - AC8 has the security reviewer confirm the real worker, and AC9 confirms it signed in.
- **Update behaviour: silent `autoUpdate`.** A prompt ("גרסה חדשה זמינה") adds UI for little gain at this
  size, and a forced reload risks lost input.
  - Known edge: a tab left open across a deploy that then lazy-loads the old map chunk gets a 404 from the
    host. This happens with or without a service worker, because the chunk is never precached. The map's error
    state covers it.
  - Rollback: `selfDestroying: true`.
- **`theme_color` becomes `surface` (white), not today's teal.** It matches 0009a's white header, so the
  installed app's status bar and the header read as one strip. `background_color` stays the page's `bg`. The
  UX reviewer judges this, with the icons and the favicon (frontmatter).
- **The precache is small**: the JS, CSS and HTML; two woff2 subsets (~30–40 kB each); the manifest; and four
  icons. The MapLibre chunk (~300 kB gzip) stays out, and AC6 now proves it.
- **Icons are rendered with Playwright, not `@vite-pwa/assets-generator`.** That generator would add a
  dependency with a native binary (`sharp`) to produce six PNGs once. The PNGs are committed, and `make icons`
  regenerates them.
- **Build-check fixtures are generated, not committed**, so lint and prettier never see a minified `sw.js` or a
  binary PNG. One template plus one mutation per case keeps the test short.
- **FOLLOWUPS line 81 is claimed** as: move to `devDependencies`, no bump available. The orchestrator replaces
  it with: `- [ ] 0009e · web/package.json (vite-plugin-pwa → workbox-build) · build-time advisories remain in
  plain pnpm audit (glob needs ≥ 14, workbox-build pins ^11; deepmerge unpatched) · re-check on the next
  vite-plugin-pwa / workbox release`.
- **FOLLOWUPS proposals** the orchestrator adds when this merges:
  - an install button;
  - `og:*` previews;
  - `no-cache` headers for `sw.js` and `index.html` at deploy (Slice 12).
- **Siblings.** Three references to `0009a` are now this spec's, and the orchestrator notes them:
  - 0009h's Out ("the PWA colours in `vite.config.ts` / `index.html`");
  - 0009d's matching line;
  - 0009c's line 70 ("`index.html`'s `<title>` is `0009a`'s").

  No other Slice 9 spec edits `vite.config.ts` or `index.html`.

Verifier round 1: 17 findings (4 major, 7 minor, 6 nit), all applied. The second round was waived.

## Digest (filled by orchestrator after verification)
See `/digest`.
