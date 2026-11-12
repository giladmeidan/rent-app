---
id: 0009a
title: A visitor opens `/` and gets the homie landing page (hero, the hello turtle, two role CTAs, an example match card, "איך זה עובד", a true trust strip) in Fredoka + Rubik, under a header with the homie lockup; a signed-in owner or seeker goes straight to their home, with a bottom tab bar on mobile and a top-bar nav on desktop
status: in-progress
depends_on: [0009h]   # 0009h (0009d's shell half; it depends on 0009d, the kit + tokens): the full-width shell, the page roots and the kit in web/src/components/ (Button, Card, Tag, Badge, PageContainer). 0009h rewrites Layout.tsx and every page root, and its notes ask 0009a to depend on it (orchestrator, 2026-11-12: the landing and the header are built from the kit)
reviewers: [code, qa, ux]   # ux: new landing screen and the header/tab bar vs Main / Search / Inbox / InboxDesktop artboards; qa: CTAs, redirects, nav at 390 / 1280 px; no security: no auth, data or API change (the PWA and its service worker are 0009e)
estimate: 1 coder run   # coder Opus/high: the header and nav change every page and about 15 test files (Speed rule 6, "when in doubt, the stronger one"). If it overflows, the signed-in nav + tab bar becomes its own spec (verifier)
---

## Goal
After this ships, an anonymous visitor who opens `/` sees the landing page of `design/screens-v1/Main.dc.html`.
The page is in the **homie** brand of `design/brand/` (the orchestrator's `specs/0009-brand-amendment.md`). The
brand kit wins over the artboard for colour, type, shape, voice and the name; the artboard still gives the
layout, the section order and the anatomy. The page has:
- the hero `<h1>` "מתאימים, לא גוללים." and the subline;
- two role CTAs in the brand voice: "פרסום דירה" signs up as an owner and goes on to the listing wizard;
  "חיפוש דירה" opens the public search;
- the turtle mascot in its `hello` pose, the one turtle on the page;
- a static example of a listing card with a match score;
- "איך זה עובד" in three steps;
- a trust strip that claims only what is true today.

The headings are set in Fredoka and everything else in Rubik. The page fills a desktop screen with a two-column
hero. The header holds the homie lockup (`הומי`) and "כניסה". A signed-in owner who opens `/` lands on "המודעות
שלי", a signed-in seeker on the search.
Their navigation is a bottom tab bar below 1024 px (as the Search and Inbox artboards draw it) and a top-bar
nav from 1024 px (InboxDesktop / SearchDesktop).

This serves PRODUCT.md "Platform" (web first, responsive) and Dev Plan slice 9 ("Landing + polish"), part a.
It resolves FOLLOWUPS lines 14, 22 and 122 (as of 8c3c480). The installable PWA, the `<head>` tags (`<title>`,
description, font preload) and the build check are **`0009e`**, which depends on this spec (verifier split).

## Scope
**In:**
- `web/src/app/routes.tsx`: the index route renders `HomeRoute` instead of `AreasList`. The `*` route is
  unchanged.
- `web/src/features/landing/` (new):
  - `home.ts`: `homeFor(role)` gives `owner` → `/me/listings` and `seeker` → `/search`;
  - `HomeRoute.tsx`, driven by `useMe()`:
    - **pending**: a `Skeleton` inside `<PageContainer>` (the `default` width), wrapped in 0009c's announced
      `Loading` if that component is on `main`, otherwise with `aria-busy="true"`. No landing content shows,
      so a signed-in person never sees it flash;
    - **a user**: `<Navigate replace>` to `homeFor(role)`;
    - **`null` (401) or an error**: `LandingPage`. A failed `/me` counts as logged out, as `AuthMenu` does;
  - `LandingPage.tsx`:
    - the sections in "UI" below. It is static, with no API call of its own;
    - it sets `document.title` to `t('app.title')` on mount, so coming back from `/search` does not keep that
      page's title. It uses 0009c's `usePageTitle(undefined)` if that hook is on `main`, otherwise a one-line
      effect;
  - `example.ts`: `exampleListing({ street, city, today })` returns the example card's `CardFacts`. The
    caller passes `t('landing.example.street')` and `t('landing.example.city')` from `LandingPage.tsx`, so
    `make i18n-check` (which scans only `.tsx`) sees the keys. The example is:
    - a 4-room apartment, floor 2 of 4, 95 m², 7,200 ₪;
    - `available_from = addDays(today, 45)`, so the date is never in the past;
    - an elevator, one parking spot, `furnished: 'partial'`, pets allowed.

    `EXAMPLE_SCORE = 91`.
- `web/src/features/listings/ListingCard.tsx`: **one** heading prop, `headingLevel?: 2 | 3 | 'none'`
  (default `2`). `'none'` renders the title as a `<p>`. 0009c adds `2 | 3` (0009c, ListingCard bullet), and
  whichever spec lands second adds its value to the same prop. The landing passes `'none'`, so the example adds
  no heading to the page outline. 0009i restyles this card; this spec touches only the prop.
- `web/src/features/areas/AreasList.tsx` and `__tests__/AreasList.test.tsx` are deleted. This resolves
  FOLLOWUPS line 14 (AreasList's loading list). What stays:
  - `areas/api.ts`, because `ProfilePage`, `PeoplePage` and `ListingWizard` use `fetchAreas`;
  - `areas.empty`, used by `ProfilePage` and `DetailsStep`.

  `areas.heading` is deleted.
- `web/src/app/Layout.tsx`. The header content and look are this spec's; the container and the page widths
  are 0009h's:
  - the `<header>` gets `bg-surface border-b border-border` at every width, as the desktop artboards
    (`InboxDesktop.dc.html:22`) draw it. In the brand kit, `surface` is also the page background;
  - the brand is a `Link` to `/` holding 0009d's `Logo variant="lockup" tone="dark"`. That is
    `design/brand/logos/homie-lockup-he.svg`, the icon on the right, about 32 px tall, with the kit's clear
    space. It replaces today's teal house mark and the text `t('app.title')`: the wordmark is never retyped in
    a font. The Link's accessible name is `t('app.title')` ("הומי"), set either through the `Logo`'s own label
    or as an `aria-label` on the Link, whichever the kit's `Logo` supports, never both;
  - the `app.tagline` paragraph is removed from the header. The key stays: 0009e makes it the description;
  - the row is one line at every width: the brand at the inline start and `AuthMenu` at the inline end. From
    `lg`, a signed-in person's nav sits between them;
  - no ancestor of the tab bar (the header, the shell) gets `transform`, `filter` or `backdrop-filter`. Any of
    them would re-anchor `position: fixed` to that element.
- `web/src/features/auth/AuthMenu.tsx`:
  - **anonymous**: one `<nav aria-label={t('nav.label')}>`:
    - on `/`, only "כניסה" (`header.login`, to `/login`), exactly as the artboard;
    - elsewhere, "חיפוש דירות" (`header.search`, a `NavLink` to `/search`, moved here from `Layout.tsx:41-46`)
      and then "כניסה";
    - the "הרשמה" header button is removed on every page (accepted by Gilad 2026-11-12, Q5). The login form already signs up
      an unknown email (`auth.noAccountYet`, 0001b), and 0009m adds login ↔ signup cross-links. The
      `header.signup` key stays, because `ApplySection` uses it;
  - **pending** `/me`: the brand and today's skeleton. Nothing else shows: "חיפוש דירות" is hidden too, a
    change from today;
  - **signed in**: one `<nav aria-label={t('nav.label')}>` ("ניווט ראשי", the artboards' name) with
    `data-bottom-nav`. Its tabs are `NavTab`s (below):
    - the seeker's, in order: חיפוש (`nav.search`, `/search`); לייקים (`header.likes`, `/me/likes`, with the
      likes count); מועמדויות (`nav.applications`, `/me/applications`); צ'אט (`header.chat`, `/chat`, with the
      chat count); פרופיל (`nav.profile`, `/me/profile`);
    - the owner's: המודעות שלי (`header.myListings`, `/me/listings`), then צ'אט, then חיפוש;
    - the greeting (from `sm`) and the logout button (`Button variant="secondary"`) sit outside the nav, at
      the top bar's inline end.
  - **below `lg` (1024 px)** the signed-in nav is a bottom tab bar, fixed to the viewport (the Search / Inbox
    artboards):
    - `fixed inset-x-0 bottom-0 z-30`: above MapLibre's controls (z-index 2) and below 0009c's skip link
      (z-50);
    - `bg-surface border-t border-border`, with equal-width tabs. Each tab has the icon above a
      `text-caption` label (12 px; the artboard draws 11) and is at least `tap` (44 px) tall. Inactive tabs are
      `text-ink-muted`;
    - its `block-size` is `calc(var(--bottom-nav-h) + env(safe-area-inset-bottom))`, with
      `padding-bottom: env(safe-area-inset-bottom)`, because an installed app has no browser bar. The bar and
      the padding it causes cannot drift apart;
    - the first tab sits at the inline start (the right), as `Search.dc.html:120-136` draws it;
    - the active tab (`aria-current="page"`) is `text-accent` (accent text on `surface`, a selected state) and
      weight 500. `NavLink` matches nested paths, so `/me/listings/:id/applicants` keeps "המודעות שלי" active;
    - a count sits at the icon's top-end corner;
  - **from `lg`**, the same nav sits in the top-bar row after the brand, text only (the icons are
    `lg:hidden`). The active tab gets the accent bottom border of `InboxDesktop.dc.html`;
  - **focused routes**: below `lg` the tab bar is hidden on routes that have their own bottom UI:
    - the listing wizard (`/listings/new`, `/me/listings/:id/edit`), whose sticky action bar sits at
      `bottom-0` (`ListingWizard.tsx:480`);
    - the listing page (`/listings/:id`), whose artboard (`Listing.dc.html`) has a fixed bottom apply bar
      (0009j's). This also hides the bar for owners on a listing page, and before 0009j's apply bar exists.
      That is accepted: the brand and the back link remain;
    - a chat thread (`/chat/:id`), for its composer.

    There the nav gets `data-hidden-mobile` and `max-lg:hidden`, so it still shows in the top bar from
    `lg`. A `FOCUSED_ROUTES` list in `AuthMenu.tsx` is matched with `matchPath`.
  - This resolves FOLLOWUPS line 122 (the seeker header wraps at 390 and 1280 px).
- `web/src/components/NavTab.tsx` (new, a shared kit-level piece, so `features/chat` and `features/likes` can
  import it):
  - a `NavLink` with `icon`, `label` and an optional `count` / `countLabel`;
  - the count is 0009d's `Badge` in its count tone, with `srLabel={countLabel}`. The brand kit drops the
    amber "new" colour;
  - the label and the badge are separated by a `{' '}` text node, as `ChatNavLink.tsx:33` does today. This
    keeps the accessible name exactly "צ'אט <sentence>", which `AuthMenu.test.tsx:145` and `inbox.spec.ts:88`
    assert;
  - `ChatNavLink` and `LikesNavLink` keep their hooks and their sentences (whatever key or plural form
    `LikesNavLink` passes on `main`; 0009b turns `likes.badgeLabel*` into a plural family) and render a
    `NavTab`;
  - `web/src/components/__tests__/NavTab.test.tsx` covers it, which 0009h's `coverage.test.ts` also requires.
- `web/src/components/Button.tsx` (0009d's kit): a new optional `end?: ReactNode`. It renders a trailing
  node (`aria-hidden`) and switches the content to `justify-between`, for the landing CTAs' chevrons
  (`Main.dc.html:41`, space-between). Without `end`, the button is unchanged. Tested in
  `components/__tests__/Button.test.tsx::end_slot_between`.
- `web/src/app/index.css`. `:root` defines `--bottom-nav-h: 0px`. Below `lg`, while a tab bar shows (selector
  `:root:has([data-bottom-nav]:not([data-hidden-mobile]))`), it sets:
  - `--bottom-nav-h: 4rem` (64 px, the bar without the safe-area inset). So the variable is the visible bar's
    height, and 0 when there is no bar. 0009m's save bar uses `var(--bottom-nav-h, 0px)`;
  - `scroll-padding-bottom: calc(var(--bottom-nav-h) + env(safe-area-inset-bottom))` on `html`, so a control
    focused by Tab is never hidden under the bar (WCAG 2.4.11, as 0009c's sticky-footer rule);
  - `main { padding-bottom: calc(var(--bottom-nav-h) + env(safe-area-inset-bottom) + 2rem) }`, which keeps
    today's `pb-8` above the bar.

  No colour literal is added (0009h AC1).
- `web/src/locales/he.json`:
  - `app.title` becomes **"הומי"** (homie; the brand kit, which settles Q1). It is the single source of the
    name as text: `document.title`, the Link's accessible name, and in 0009e the `<title>` and the manifest.
    The visible name is the lockup SVG;
  - the new keys are in "UI" below;
  - `areas.heading`, `header.myApplications` and `header.myProfile` are deleted, because nothing uses them
    any more.
- Fonts: the brand kit's two families, self-hosted (accepted by Gilad 2026-11-12, Q6). Heebo is dropped. Each is one variable
  file per subset:
  - **`@fontsource-variable/rubik`** is the text font (`sans`). It is used at weights 400 and 500 (tokens.json
    `body` … `caption`, `h3`);
  - **`@fontsource-variable/fredoka`** is the display font. It is used at weight 600, only for the `display`,
    `h1` and `h2` styles, and never below 24 px or for running text;
  - `web/src/app/main.tsx` imports `@fontsource-variable/rubik/wght.css` and
    `@fontsource-variable/fredoka/wght.css` before `index.css`;
  - `web/tailwind.config.ts`, the file's only change here, sets two `fontFamily` entries from tokens.json's
    `families`:
    - `theme.extend.fontFamily.sans = ['"Rubik Variable"', 'Rubik', 'system-ui', 'sans-serif']`;
    - `theme.extend.fontFamily.display = ['"Fredoka Variable"', 'Fredoka', '"Rubik Variable"', 'Rubik',
      'system-ui', 'sans-serif']`.

    0009d's `tokens.test.ts` compares each token group separately, so a new `fontFamily` group does not break
    it. `body` already uses `font-sans`. The `font-display` class is used by every spec's `h1` / `h2` (the
    brand amendment's "Type");
  - each subset's `unicode-range` means a page fetches only what it uses: Hebrew, and Latin for digits and
    punctuation. Rubik's Arabic and Cyrillic files are never fetched;
  - the `<link rel="preload">` for the two Hebrew files is 0009e's.
- Tests of the sibling foundation specs that this spec changes:
  - 0009h `pageWidths.test.ts`: the `/` row becomes `features/landing/HomeRoute.tsx` → `default` (its
    pending state), plus an explicit row `features/landing/LandingPage.tsx` → `wide`, listed the way the guards
    are;
  - 0009h `Layout.test.tsx::ac3_full_width_shell`: its tagline clause goes, so it asserts the header row only
    (0009h says this spec deletes it). This spec's AC6 and AC7 are added to the same file, which 0009c also
    adds to.
- e2e, because a signed-in person no longer stays on `/`:
  - `web/e2e/helpers.ts`: the `signUp` default becomes `expectUrl = role === 'owner' ? '/me/listings' :
    '/search'`, and the `signUpOwner` doc comment is updated;
  - `auth.spec.ts:28`, `search.spec.ts:40` and `listings.spec.ts:37`: `toHaveURL('/')` becomes
    `toHaveURL('/me/listings')` (all three are owners);
  - `web/e2e/smoke.spec.ts` is deleted. Its RTL check moves to `web/e2e/landing.spec.ts`;
  - the coder greps `web/e2e` and `web/src` for `toHaveURL('/')`, `toBe('/')`, `header.myApplications`,
    `header.myProfile`, `header.signup` in a header context, and `header.search` in a signed-in header. Known
    hits: `AuthMenu.test.tsx`, `logout.test.tsx`, `ChatStreamProvider.test.tsx`, `ChatThreadPage.test.tsx`,
    `search/__tests__/routes.test.tsx`, `applications.spec.ts`, `inbox.spec.ts`, `likes.spec.ts` and
    `listings.spec.ts`;
  - e2e lookups of tabs are scoped to `getByRole('navigation', { name: he.nav.label })` and use `exact: true`.
    Playwright's `name` is a substring match, so "חיפוש", "פרופיל" and "מועמדויות" also match back links and
    the profile nudge.
- Unit tests whose meaning changes (`features/auth/__tests__/routes.test.tsx` and others):
  - `ac9_redirects`: a logged-in seeker (`noa`) on `/login` now ends on `/search` (mock `GET /listings`). An
    unknown path, logged out, ends on `/` with the landing `<h1>`;
  - `ac10` (lines 64-78) and `ac8` (lines 121-135): an owner on a seeker-only page now ends on `/me/listings`
    (mock `GET /me/listings`), not on `/`;
  - `search/__tests__/routes.test.tsx::ac1`: its "the header link is there on other pages too" step moves from
    `/` to `/login`, because the landing hides the link;
  - `AuthMenu.test.tsx`:
    - `ac1`'s "chat before the role link" order assertion flips for owners (המודעות שלי now comes first);
    - `ac2` loses its signup-link assertions.

**Out:**
- The PWA (manifest, icons, service worker), the `<title>` / description / theme-color / font-preload tags,
  the `build-check` script, and FOLLOWUPS line 81: **0009e**.
- The footer with תנאי שימוש / פרטיות / צור קשר. There are no such pages until Slice 12 launch readiness (Q3).
- A custom "install the app" button, and social link previews (`og:*`). FOLLOWUPS proposals.
- Per-route `document.title`, the skip link and focus management (0009c).
- The tokens, the shell's widths, and restyling other pages (0009d / 0009h / screen specs).
- Rewording existing keys (0009b), except `app.title` (the brand kit).
- Making the guards redirect straight to `homeFor(role)`. Today they redirect to `/`, which then redirects
  again. The extra hop is harmless, and the guard files are 0009c's to edit in this slice.

**New dependencies:** `@fontsource-variable/rubik` 5.3.0 and `@fontsource-variable/fredoka` 5.3.0 (both
OFL-1.1, `dependencies`): the brand kit's fonts, self-hosted. See Q6.

## Data
None (web only).

## API
None. Consumes `GET /me` (`useMe`), as today.

## UI
### `/` (`HomeRoute` → `LandingPage`), `Main.dc.html`
The page is built from 0009d's `PageContainer`, `Button`, `Card`, `Tag`, `Mascot` and `Logo` (in the header),
and from the brand tokens. It uses no colour literal, no arbitrary `[Npx]` class, and logical properties only.
- The root is `<PageContainer width="wide">`. Below `lg`, an inner wrapper caps the column at `max-w-page`
  (`max-lg:mx-auto max-lg:max-w-page`; 0009h forbids those classes on `PageContainer` itself).
- Sections sit `gap-6` (space-6) apart, with `py-8` (space-8) at the top and bottom of the page. The step cards
  sit `gap-3` apart.
- Cards have a `border` and no shadow: the artboard's card shadow goes (brand "Shape").
- Colour follows the brand rules:
  - `ink` on `surface`, with `ink-muted` for secondary text;
  - exactly **one accent-filled element** on the page, the example card's match badge;
  - the primary CTA is `ink` with `on-ink` text;
  - accent text appears only on `surface`, and on `accent-soft` it is `accent-strong`.
- Icons are outline icons with a 2 px stroke, round caps and `currentColor` (`ink` / `ink-muted`).

**Below `lg`**: one column, in the artboard's order.
1. **Hero chip**: `Tag` (tone `accent`: `accent-soft` with `accent-strong` text), `landing.badge`.
2. **`<h1>`**: `landing.title` in `font-display text-h1` (Fredoka 600, 32/40), and `lg:text-display` (48/52).
   `whitespace-pre-line` keeps the artboard's line break after the comma.
3. **Subline**: a `text-ink-muted` `<p>` in `text-body`, `landing.subtitle`.
4. **CTAs**: two `block` `Button`s of size `lg` (52 px; the artboard draws 60 px). Each has a leading outline
   `icon` and `end={chevron}`. The brand voice applies: 1–3 words, starting with the action noun, no slash
   forms (accepted by Gilad 2026-11-12, Q2):
   - **primary** (`ink`): the house icon, `landing.cta.owner` "פרסום דירה",
     `to="/signup?role=owner&next=%2Flistings%2Fnew"`. Signup preselects the role, and the wizard opens after
     the code. Its first step asks apartment or room, so room listers are served too. A returning owner who
     uses this form is simply logged in (`verify_otp` ignores the profile for a known email). A returning seeker
     lands on `/` and so on `/search`, via `RequireOwner`;
   - **secondary** (`surface` with `border-strong`): the magnifier icon, `landing.cta.seeker` "חיפוש דירה",
     `to="/search"`, which is public (PRODUCT "Search");
   - the chevron is the artboard's `M15 6l-6 6 6 6`, which points to the inline end in RTL;
   - the CTAs no longer reuse `auth.role.*`. Those radio labels are identities ("אני מחפש/ת" today), and their
     rewording is 0009b's.
5. **Mascot**: 0009d's `Mascot pose="hello"` (the kit's welcome pose, `homie-turtle-hello.svg`), the
   page's one turtle:
   - it sits on `surface`, never on `accent`, never flipped, at 160 px wide below `lg` and 200 px from `lg`;
   - it is decorative (`aria-hidden`), because it says nothing the copy does not;
   - below `lg` it opens the "visual" group, above the example card and centred. From `lg` it sits in the hero's
     second column, above the card.
6. **Example card**: a `<figure>` with a muted `<figcaption>` (`landing.example.caption`) above the real
   `ListingCard`:
   - its props: `listing={exampleListing({ street: t('landing.example.street'), city:
     t('landing.example.city'), today })}` with `today = todayInIsrael()`, `today`, `badge={<MatchBadge
     score={EXAMPLE_SCORE} />}`, `headingLevel="none"`, and no `to`. It is not a link;
   - it is **static** because an anonymous visitor has no profile, so there is no real score to show. A live
     "featured" listing would also put a real owner's listing in marketing without asking, and add an API call
     to the busiest page. Reusing the real card means the example is exactly what the search shows. The caption
     keeps anyone from hunting for a 7,200 ₪ flat on כצנלסון.
7. **"איך זה עובד"**:
   - `<h2>` `landing.how.title` in `font-display text-h2`, then an `<ol>` of three `Card`s (`as="li"`);
   - each card has the number tile (`accent-soft` with `accent-strong` digits, `aria-hidden`, because the list
     already gives the order), an `<h3>` (`text-h3`, Rubik) with the step title and an `ink-muted` `<p>`:
     `landing.how.step1.title` / `.text`, then `step2` and `step3`.
8. **Trust strip**: a centred, wrapping `<ul>` of three `<li>`s:
   - `landing.trust.verified`, with the artboard's shield icon (outline, `aria-hidden`);
   - `landing.trust.noBrokers`;
   - `landing.trust.free` (Q2).

   Every `<li>` after the first starts with an `aria-hidden` "·" span **inside** it. A bare element between
   `<li>`s is invalid and fails axe's `list` rule.
9. **No footer** (Q3).

**From `lg` (≥ 1024 px)**:
- the hero is a two-column grid, vertically centred, with generous block padding:
  - the inline-start column (the right, in RTL) holds the chip, the `<h1>` (`text-display`), the subline
    (`max-w-xl`), and the two CTAs side by side (not `block`);
  - the inline-end column holds the mascot above the example `<figure>` (`max-w-md`);
- "איך זה עובד" is the `<h2>` over the three step cards in three equal columns;
- the trust strip is centred under them;
- between 640 and 1023 px the page stays one column.

**States:**
- **loading** (`/me` pending): `HomeRoute`'s skeleton;
- **error** (`/me` fails): the landing, as when logged out;
- **empty**: none, because the landing has no data.

**RTL:**
- the grid's first column is the inline start;
- the CTA chevrons point to the inline end;
- the trust strip wraps;
- digits in the card render as `ListingCard` renders them.

### Header and navigation (every route)
- **Anonymous**: on `/`, the brand and then "כניסה". Elsewhere, also "חיפוש דירות". Both links sit in the
  named `<nav>`.
- **Pending `/me`**: the brand and the skeleton.
- **Signed in, below `lg`**:
  - the top bar is one row: the brand at the start, and at the end the greeting (from `sm`) and logout;
  - the bottom tab bar holds the role's tabs, and is hidden on the focused routes.
- **Signed in, from `lg`**: one top-bar row with the brand, the nav (text tabs), the greeting and logout.
- The signed-in tabs are a single `<nav>` inside the `<header>` at every width, so there is one navigation
  landmark. Its DOM order is brand → nav → greeting/logout. The anonymous `<nav>` and the signed-in one never
  render together. 0009c owns the skip link, and its name for the landmark wins if it differs.
- **Icons**: the coder copies the SVG paths from the artboards: search, saved (used for "לייקים"),
  applications and profile from `Search.dc.html`; my listings and chat from `Inbox.dc.html`. Each uses
  `stroke="currentColor"`, is `aria-hidden`, and leaves the label as the tab's name.

### i18n keys
No new key depends on a count. The two existing counts keep their keys and their 0009b forms.

| Key | Hebrew |
| --- | --- |
| `app.title` | "הומי" (changed from "דירה"; the brand kit) |
| `landing.cta.owner` | "פרסום דירה" (accepted by Gilad 2026-11-12, Q2) |
| `landing.cta.seeker` | "חיפוש דירה" (accepted by Gilad 2026-11-12, Q2) |
| `landing.badge` | "גוש דן · השקה בעברית" |
| `landing.title` | "מתאימים,\nלא גוללים." |
| `landing.subtitle` | "פרופילים מובנים, ציון התאמה לכל דירה וכרטיסי מועמדות מסודרים — במקום מאות הודעות בקבוצות." |
| `landing.example.caption` | "לדוגמה: כך נראית דירה עם ציון התאמה" |
| `landing.example.street` | "כצנלסון" |
| `landing.example.city` | "גבעתיים" |
| `landing.how.title` | "איך זה עובד" |
| `landing.how.step1.title` | "ממלאים פרופיל קצר" |
| `landing.how.step1.text` | "תקציב, תאריך כניסה, אורח חיים והעדפות דיור — פעם אחת." (accepted by Gilad 2026-11-12, Q2) |
| `landing.how.step2.title` | "רואים ציון התאמה לכל דירה" |
| `landing.how.step2.text` | "מה מסתדר, מה פחות — לפני שמבזבזים זמן על סיור." |
| `landing.how.step3.title` | "מגישים מועמדות בהודעה קצרה" (artboard: "…בלחיצה"; accepted by Gilad 2026-11-12, Q2) |
| `landing.how.step3.text` | "בעלי הדירה מקבלים כרטיס מסודר, לא עוד הודעה בצ'אט." (plural, brand voice) |
| `landing.trust.verified` | "משתמשים מאומתים באימייל" (artboard: "…בטלפון"; accepted by Gilad 2026-11-12, Q2) |
| `landing.trust.noBrokers` | "בלי מתווכים" |
| `landing.trust.free` | "חינם למחפשים" (accepted by Gilad 2026-11-12, Q2) |
| `nav.label` | "ניווט ראשי" |
| `nav.search` | "חיפוש" |
| `nav.applications` | "מועמדויות" |
| `nav.profile` | "פרופיל" |

Deleted: `areas.heading`, `header.myApplications`, `header.myProfile`. Reused: `header.login`, `header.search`,
`header.chat`, `header.likes`, `header.myListings`. `app.tagline` stays
for 0009e.

## Acceptance criteria
- [ ] AC1 Given a logged-out visitor (`/me` 401) on `/`, Then:
  - there is exactly one `<h1>`, named "מתאימים, לא גוללים.";
  - the badge and the subline are visible;
  - there is no `areas` heading;
  - `document.title` equals `app.title`.

  — `web/src/features/landing/__tests__/LandingPage.test.tsx::ac1_hero`
- [ ] AC2 Then the link named `landing.cta.owner` has href `/signup?role=owner&next=%2Flistings%2Fnew`, and the
  link named `landing.cta.seeker` has href `/search`. — `LandingPage.test.tsx::ac2_ctas`
- [ ] AC3 Then a `figure` shows the caption, "התאמה 91%", "7,200", "כצנלסון", "גבעתיים" and an entry date
  after today, and contains no link and no heading. — `LandingPage.test.tsx::ac3_example_card`, plus
  `web/src/features/listings/__tests__/ListingCard.test.tsx::ac3_heading_level_none` (`'none'` renders no
  heading; the default still renders an `h2`)
- [ ] AC4 Then:
  - the `h2` "איך זה עובד" is followed by a list of three items, each with its `h3` title and its text;
  - the trust strip is a list of exactly three items, and no text on the page says "טלפון";
  - there is no link named "תנאי שימוש", "פרטיות" or "צור קשר".

  — `LandingPage.test.tsx::ac4_steps_trust_no_footer`
- [ ] AC5 `HomeRoute`:
  - while `/me` is pending, a busy skeleton shows and there is no `<h1>`;
  - a 401, a 500 or a network error shows the landing;
  - an owner ends on `/me/listings` and a seeker on `/search`, with `replace`.

  — `web/src/features/landing/__tests__/HomeRoute.test.tsx::ac5_home_states`
- [ ] AC6 Header, anonymous:
  - on `/`, the banner has the brand link to `/`, named by `app.title`, and the navigation "ניווט ראשי"
    holds exactly one link, "כניסה" to `/login`;
  - on `/search`, that navigation holds "חיפוש דירות" and "כניסה";
  - the banner never has "הרשמה" or the `app.tagline` text;
  - while `/me` is pending, the banner has the brand and no "חיפוש דירות".

  — `web/src/app/__tests__/Layout.test.tsx::ac6_anonymous_header` (0009h's file)
- [ ] AC7 Header, signed in:
  - a seeker gets one navigation "ניווט ראשי" with, in order: חיפוש → `/search`, לייקים → `/me/likes`,
    מועמדויות → `/me/applications`, צ'אט → `/chat`, פרופיל → `/me/profile`;
  - an owner gets המודעות שלי → `/me/listings`, then צ'אט, then חיפוש;
  - the logout button is outside the nav;
  - with two new chats, the chat tab's accessible name is exactly "צ'אט " followed by the `header.chatNew`
    sentence for 2;
  - on `/me/listings/L/applicants`, "המודעות שלי" is `aria-current="page"`;
  - on `/listings/new`, `/me/listings/L/edit`, `/listings/L` and `/chat/C` the nav has `data-hidden-mobile`, and
    on `/search` and `/chat` it does not.

  — `Layout.test.tsx::ac7_signed_in_nav`, plus `web/src/components/__tests__/NavTab.test.tsx::ac7_tab_name_and_badge`
- [ ] AC8 E2E, no sign-up. A visitor opens `/`. Then:
  - the page is `html[dir=rtl][lang=he]` and the `<h1>` is visible;
  - the document has loaded `FontFace`s "Fredoka Variable" and "Rubik Variable" (after `document.fonts.ready`); Fredoka is the first family of the `<h1>` and Rubik of `body`, and it is the first
    family of the `<h1>`'s computed `font-family`;
  - the banner's navigation has "כניסה" and no "הרשמה";
  - at 390×844 the document has no horizontal scroll;
  - at 1280×800 the `<h1>` and the example `figure` sit side by side: their vertical ranges overlap, and the
    figure is to the left of the `<h1>`;
  - the owner CTA opens `/signup?role=owner&next=%2Flistings%2Fnew` with the owner radio checked. The form is
    not submitted;
  - back on `/`, the seeker CTA opens `/search` and its `<h1>`;
  - if 0009c's `web/e2e/a11y.ts` is on `main`, `expectNoAxeViolations(page, '/')` passes at 390 and at 1280,
    with no rule disabled.

  — `web/e2e/landing.spec.ts::ac8_landing_smoke`
- [ ] AC9 E2E, appended to the existing seeker test (no new sign-up). After `signUp(page, 'seeker')` ends on
  `/search`, at 390×844:
  - `getByRole('navigation', { name: he.nav.label })` is visible, its five links share one row, and its
    bottom edge is the viewport's;
  - the banner's brand and logout share one row;
  - `main`'s computed `padding-bottom` is at least the nav's rendered height;
  - the document has no horizontal scroll;
  - then at 1280×800 the nav is inside the banner and its top is above 100 px.

  The viewport is restored for the rest of the test. — `web/e2e/likes.spec.ts::ac9_seeker_likes_back_and_chats`
- [ ] AC10 `Button` with `end` renders the trailing node `aria-hidden` and the classes for `justify-between`.
  Without `end` it is unchanged. — `web/src/components/__tests__/Button.test.tsx::end_slot_between`
- [ ] NF1 `make lint`, `make test`, `make i18n-check` and `make build-web` are green, and local `make e2e` is
  green on the final head (Speed rule 7). The e2e result goes in the digest.

## Tests to write
- Component:
  - `LandingPage.test.tsx` (AC1–AC4) and `HomeRoute.test.tsx` (AC5), with `mockApi` / `renderRoutes` from
    `features/auth/__tests__/harness.tsx`;
  - AC6 and AC7 in 0009h's `web/src/app/__tests__/Layout.test.tsx`, rendering `AppRoutes` with `mockApi` stubs
    for `/me`, `/me/conversations` and `/me/likes`, as `ChatStreamProvider.test.tsx` and
    `AuthMenu.test.tsx` do;
  - `NavTab.test.tsx`, `Button.test.tsx::end_slot_between`, and `ListingCard.test.tsx::ac3_heading_level_none`;
  - the updated `routes.test.tsx` (auth and search), `AuthMenu.test.tsx`, and 0009h's `pageWidths.test.ts`
    rows.
- E2E:
  - `landing.spec.ts` (AC8) adds no sign-up;
  - AC9 is a few lines appended to `likes.spec.ts`;
  - the helper and expectation edits add no sign-ups. The e2e OTP budget is unchanged.

## Risks / open questions
**Questions for Gilad.** The orchestrator batches them. The spec is written on each recommendation, pending
Gilad.
- **Q1 Product name**: settled by the brand kit (orchestrator, 2026-11-12): homie / `הומי`. `app.title` is one key, and 0009e's `manifest.id: '/'` keeps an installed app's identity across a later rename (the kit calls homie a working name).
- **Q2 The landing's claims must be true today.**
  - The artboard says "משתמשים מאומתים בטלפון", but signup is email OTP and SMS is stubbed until launch.
  - Step 3 says "מגישים מועמדות בלחיצה", but applying needs a profile and a 1–500-character message.
  - Step 1's "אורח חיים" (the questionnaire) applies only to seekers looking for a room.
  - "חינם למחפשים" is true, but it implies owners may pay one day (PRODUCT "Brokers" reserves a paid tier).

  Options:
  - (a) **"משתמשים מאומתים באימייל", "מגישים מועמדות בהודעה קצרה", step 1 as the artboard, and "חינם
    למחפשים" as the artboard**. The first becomes "…בטלפון" when SMS switches on in Slice 12 (a FOLLOWUPS
    proposal);
  - (b) as (a), but "כל חשבון מאומת בקוד חד־פעמי", which stays true after SMS but is vaguer, and plain
    "חינם", which is true for both sides;
  - (c) drop the verification item and keep two items.

  - CTAs (brand voice, 1–3 words starting with the action noun, no slash forms): (a) **"פרסום דירה" / "חיפוש דירה"**; (b) "מפרסמים דירה" / "מחפשים דירה" (the orchestrator's example).

  **Recommendation: (a).** Step 1 lists what a seeker may fill in, and the questionnaire is one of those.
  "בלי מתווכים" stays: brokers are not allowed at launch (PRODUCT "Brokers", the 3-listing cap), and reporting
  them comes with Slice 10's report button.
- **Q3 Footer links (תנאי שימוש / פרטיות / צור קשר) with no pages yet**:
  - (a) **no footer until Slice 12** writes the terms and privacy pages and picks a contact channel, so nothing
    points at a page that does not exist;
  - (b) "צור קשר" only, as a `mailto:` to an address Gilad chooses;
  - (c) all three, to short placeholder pages written now. Legal text needs review, and a "coming soon" privacy
    page on a site that collects emails reads worse than none.

  **Recommendation: (a).** A FOLLOWUPS proposal goes to Slice 12.
- **Q4 What a signed-in person gets at `/`**:
  - (a) **straight to their home**: an owner to "המודעות שלי", a seeker to the search. Login with no `next`,
    the brand link, the installed app's `start_url` and the wrong-role guards all land somewhere useful;
  - (b) the landing for everyone, with CTAs pointing at their own pages, so a returning user gets marketing
    after every login;
  - (c) a signed-in dashboard (a later slice).

  **Recommendation: (a).** The cost is one `/me` round trip before an anonymous visitor's first paint. The
  header already waits for the same query, and a signed-in user never sees the landing flash.
- **Q6 Font hosting for Fredoka + Rubik**:
  - (a) **self-hosted** `@fontsource-variable/fredoka` and `@fontsource-variable/rubik` (OFL, version pins, hashed immutable URLs, precached by 0009e, no visitor IP sent to Google);
  - (b) Google Fonts (the kit notes both are free there): no dependency, but a third-party request per visitor, two extra hosts, outside the precache.

  **Recommendation: (a).** `font-display: swap`; 0009e preloads both Hebrew files.
- **Q5 The "הרשמה" header button.** The artboard shows only "כניסה", but it covers only `/`, so removing the
  button elsewhere changes the signup entry on pages no artboard draws.
  - (a) **remove it on every page**. Login signs up an unknown email; the landing CTA, the listing page's apply
    section and 0009m's login ↔ signup links remain;
  - (b) remove it on `/` only.

  **Recommendation: (a)**: one header everywhere. 0009m already assumes (a).

**Spec decisions** (the reviewers challenge these; they are not for Gilad):
- **Fonts**: see Q6.
- **Header surface and theme colour.** The header is `bg-surface` (white) with a bottom border at every width,
  as the desktop artboards and the mobile Search / Inbox top areas draw it. `Main.dc.html` alone draws the
  landing's top bar on the old `bg`. 0009e sets `theme_color` (the installed app's status bar) to the same `surface`,
  which replaces today's teal `#0E7C6B`. In the brand kit `surface` (#FFFFFF) is also the page background, so the status bar, the header and the page read as one. The UX reviewer judges it.
- **The landing hides "חיפוש דירות"**, as the artboard does, because the seeker CTA is the same link. Other
  pages keep it.
- **Bottom tab bar.** FOLLOWUPS line 122 asked for "a nav row or a shorter label". The mobile artboards' tab
  bar ("ניווט ראשי") is both, and suits an installed app. It uses short labels (`nav.*`) and is hidden on the
  focused routes.
  - Risk: a page with its own `fixed` / `sticky` bottom element that is not in `FOCUSED_ROUTES`. Today only
    `ListingWizard.tsx:480` has one (`grep -rn 'sticky\|fixed' web/src`).
  - The shared notes tell 0009j, 0009k and 0009m the routes and `--bottom-nav-h`. 0009m already offsets its
    save bar by it.
- **Sibling e2e at 390 px.** Signed-in e2e tests pinned to 390×844 (0009i `search.spec.ts::ac9`, 0009l
  `inbox.spec.ts::ac12`, 0009m) run with the fixed tab bar on screen. A click on an element under it fails.
  Whichever spec merges second reruns them, and scrolls the target into view or uses a focused route.
- **Merge order.** `depends_on: [0009h]` brings in 0009d. If the kit's props differ when this builds, adapt
  the calls, not the components. The two kit edits (`Button`'s `end`, the new `NavTab`) come with their tests.
  - 0009c, 0009h, 0009i and 0009m edit `Layout.tsx`, `index.css` and `ListingCard.tsx` in the same slice,
    and the second to merge rebases (Speed rule 3). `ListingCard`'s heading prop is shared with 0009c, as
    above.
  - 0009c's `Loading`, `usePageTitle` and `e2e/a11y.ts` are used when they are on `main`; they are not a
    dependency.
- **FOLLOWUPS proposals** the orchestrator adds when this merges:
  - an install button;
  - `og:*` link previews;
  - "…בטלפון" when SMS is on;
  - the footer and legal pages (Q3).

FOLLOWUPS lines claimed (as of 8c3c480): **14** (AreasList's loading list, resolved by deleting it), **22** (`/`
has no `<h1>`) and **122** (the seeker header wraps). Line **81** is 0009e's.

Verifier round 1: 30 findings (5 major, 14 minor, 11 nit), all applied. The fix for M1 needed two
adjustments:
- 0009d's `tokens.test.ts` already compares token groups one by one, so `fontFamily` needs no change;
- 0009h's `layout.spec.ts::ac7` does not measure `/`.

Nit 8 (the guards could redirect straight home) is listed under Out, because the verifier rated the double
redirect harmless. The split put Part 2 and the `<head>` / build-check work in `0009e`. A second round was
waived.

Brand amendment (orchestrator, 2026-11-12; `specs/0009-brand-amendment.md`, `design/brand/`): applied as a spec edit without re-verification, per the orchestrator. It changed the name (Q1 closed), the lockup `Logo`, Fredoka + Rubik (Q6), one `Mascot` (hello), the brand voice for the CTAs and step 3, and the token names (`border`, `accent`, `ink-muted`, `text-caption`, `text-h1` / `text-display`).

## Digest (filled by orchestrator after verification)
See `/digest`.
