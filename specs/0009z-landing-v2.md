---
id: 0009z
title: A visitor at `/` gets a full landing page that shows what the site holds (map search, match score, שוק השותפים, the owner side, real listings) and leads into each part
status: verified
depends_on: []
reviewers: [ux, qa, code]   # ux: a rebuilt screen, compared against design/screens-v2/Main.html. qa: a UI change with a new query and rewritten tests (checklist line 8). code: a new shared Button variant + the blast radius. No auth, data or API change.
estimate: 1 coder run   # coder Opus/medium: the product's front door, design-heavy
---

## Goal
Gilad, 2026-11-14: the homepage should be a modern landing page, fuller and with more detail, that keeps today's
content and makes it obvious that a full site sits behind it.

After this ships a visitor at `/` sees six sections instead of today's hero + three steps:
the hero (today's copy and CTAs, with the trust claims and an example of why a listing matches), four "doors"
into the site (map search, match score, שוק השותפים, the owner's applicant cards), up to three real listings
from the site, "how it works" for both sides, five common questions, and a closing band with the two CTAs.
Every door, listing and CTA is a link into the real site.

Serves Product Plan screen 1 (Landing), Slice 9 (landing + polish). Replaces the page built by 0009a; the
market entry point of 0010a stays.

## Scope
**In:** only `web/`.

1. **`web/src/features/landing/LandingPage.tsx`** rebuilt to the artboard `design/screens-v2/Main.html`
   (one responsive page: phone below `lg`, desktop from `lg`). The coder may split it into files under
   `web/src/features/landing/` (one per section); nothing moves into `components/`.
2. **The six sections, top to bottom** (copy is the artboard's; every string is an i18n key, see UI):
   1. **Hero.** A `<section aria-labelledby>` (the `<h1>`'s id): a `bg-accent-soft` panel (`rounded-lg`, a
      faint dot pattern in `mascot-blush`). Inline-start column: the `Tag` with `tone="neutral"` (border +
      subtle fill, so it shows on the panel; `accent` would vanish on `accent-soft`, and `cx` does not merge
      classes, so no `bg-surface` override; the artboard's white tag is the one accepted deviation), the
      `<h1>`, the subtitle, the two CTAs and the market link (the same three destinations, variants and
      chevrons as today, unchanged), then the three trust claims as a `<ul>` of check-mark items (today's
      three `landing.trust.*` keys; the strip at the page's end goes away).
      Inline-end column: the page's one turtle (`Mascot pose="hello"`), then the `<figure>`: today's
      `<figcaption>` (`landing.example.caption`, kept: it tells a screen reader the card is an example),
      today's example `ListingCard` with its `MatchBadge` (`exampleListing`, `titleAs="p"`, unchanged), and
      under it a small "why" card as a `<ul>`: a caption (`landing.example.why.title`, interpolating
      `{{score}}` = `EXAMPLE_SCORE`) and three lines (two with a `text-success` check, one `text-ink-muted`
      dash). The example's facts back the lines (7,200 ₪, one parking spot; a profile's `parking_needed`
      goes up to 2).
   2. **"מה מחכה בפנים": four doors.** A grid (`lg`: six columns; map tile spans 4, match 2, market 2,
      owner 4; below `lg`: one column). Each tile is one `<Link>` (the whole card, `focusRing`), named by
      `aria-labelledby` = its `<h3>`'s id (so its accessible name is the title alone, and the owner tile's
      "more" label "פרסום דירה" never collides with the CTAs of that name), with an icon chip, the `<h3>`,
      one sentence, a small decorative mini-illustration (`aria-hidden`) and a "more" label:
      | Tile | Destination |
      | --- | --- |
      | חיפוש עם מפה | `/search?view=map` |
      | ציון התאמה לכל דירה | `/signup?role=seeker&next=%2Fme%2Fprofile` |
      | שוק השותפים | `/market` |
      | מועמדויות מסודרות לבעלי דירות | `/signup?role=owner&next=%2Flistings%2Fnew` (the owner CTA's) |
      The mini-illustrations are plain markup with tokens (a sketched map with five price pins; a 91% score
      with a bar; three initials and a heart; three applicant rows with score badges). They are not
      screenshots and load no image.
   3. **"עלו לאחרונה": real listings.** One plain `useQuery` (not `useSearch`: that is an infinite query
      keyed `['search', filters]` with `PAGE_SIZE` 20 and would share the search page's cache), calling the
      existing client directly:
      `useQuery({ queryKey: ['landing', 'latest'], queryFn: () => searchListings({ listing_type: 'apartment', sort: 'newest' }, 0, { limit: 3 }) })`.
      `searchListings` (`web/src/features/search/api.ts`) already takes a `Filters` object and
      `opts.limit`; the request is `GET /listings?limit=3&offset=0&listing_type=apartment&sort=newest`
      (`SORTS` in `filters.ts`; the API orders `newest` by `created_at DESC, id`, `limit` 1..max). No new
      client code. Rendered as a `<ul>` of three `ListingCard`s, each
      `<ListingCard listing={l} today={today} to={`/listings/${l.id}`} coverUrl={l.cover?.small_url} titleAs="h3" />`
      (as `ResultsList` passes them; default `layout="stack"`). For a visitor the card has no `MatchBadge`
      (`match` is null), no "mine" chip (`is_mine` false) and no room chips (apartments only): the 16:10
      photo box (the cover, lazy-loaded, or the placeholder icon), the price, the title as the card-wide
      link, and the facts line. A "לכל הדירות" link to `/search` in the section head. **The section exists
      only when the request succeeded with at least three listings** (render `items.slice(0, 3)`). While
      pending, on an error, or with fewer than three, the section is absent: no skeleton, no error text, no
      empty state. Below `lg` the three cards are one swipe row (scroll-snap, each card about 82% of the
      width, the row scrolls inside itself so the document never does); from `lg` three columns. The card's
      stretched link keeps the whole card as the tap target (well over 44 px).
   4. **"איך זה עובד": both sides.** Two cards side by side from `lg` (stacked below): "מחפשים דירה" with
      today's three steps (`landing.how.step1..3`, unchanged) and the seeker CTA (`secondary`, → `/search`);
      "מפרסמים דירה" with three new owner steps and the owner CTA (`primary`, → the owner signup address).
      Each side's label is a neutral `Tag` (not a heading) whose id names its `<ol>` (`aria-labelledby`).
      Owner step 3's text is corrected (see "Copy corrections" below): chat opens on **shortlist**, not on
      an "approval".
   5. **"שאלות נפוצות".** Five questions as native `<details>` / `<summary>` (no JS state), the first open.
      From `lg` the heading sits in the inline-start third and the questions in the other two thirds.
      Answer 4 is corrected (see "Copy corrections").
   6. **Closing band.** A `bg-ink` panel with an `<h2>`, one line (`text-on-ink`, not the artboard's
      `#D1D5DB`, which is no token), and the two CTAs (seeker first). Verified against
      `Button.classes.ts`: the **seeker** CTA uses the existing `secondary` variant (white `surface`, `ink`
      text: the artboard's `on-ink` button as is). The **owner** CTA needs an outline on ink, which no variant
      gives (`primary` is ink on ink; `ghost` is `text-accent`, 3.6:1 on ink, below 4.5:1 for text), so add
      **one** variant to `web/src/components/Button.classes.ts`:
      `inverse: 'border border-on-ink bg-transparent text-on-ink hover:bg-on-ink/10'`, and use it for that
      CTA only. The focus ring needs no change: every variant carries `focusRing` (2 px `accent` outline,
      2 px offset), and `accent` #2563EB on `ink` #111111 is 3.6:1, above WCAG 1.4.11's 3:1, so it shows on
      the band. No restyling by `className`.
   **Copy corrections (verifier, against the code and PRODUCT.md; the artboard is corrected to match):**
   - Owner step 3 text: the artboard's "מאשרים את מי שמתאים, ומתאמים סיור בלי לצאת מהאתר." implies an
     "approve" action that does not exist; chat opens when the owner shortlists ("לרשימה הקצרה",
     PRODUCT.md "Chat: Opens only on owner shortlist or mutual interest"). Now:
     "מעבירים לרשימה הקצרה את מי שמתאים, וממשיכים בצ'אט באתר לתיאום סיור."
   - FAQ answer 4: the artboard's "רואים מי גר בדירה" is not true for a visitor: flatmates appear only by
     their own choice and only to seekers (PRODUCT.md "שוק השותפים": "A flatmate is shown on the room's page
     **only by their own choice**"; "Flatmate ages and answers on a room stay visible **only to seekers**").
     Now: "אזור נפרד לחדרים בדירות שותפים ולאנשים שמחפשים שותפים. לייק הדדי פותח צ'אט."
   - Checked true, kept: FAQ 1 (search, map and `/market` are public routes; the score needs an account and
     a profile), FAQ 2 (Pricing: free; Brokers: not allowed), FAQ 3 (Matching: budget, move-in, household,
     with the agree/differ explanation beside the score), FAQ 5 (Gush Dan only); owner step 1 "בחמישה
     צעדים" (an owner at `/listings/new` without `?type=` gets `type, details, photos, preferences,
     preview`: five, `ListingWizard.tsx:152-156`; the landing's owner link carries no `type`); owner step 2
     (a seeker needs a profile to apply, so an application carries a profile and a score); the map tile's
     filters (price, rooms, entry date exist in `filters.ts`).
3. **Motion**, CSS only, in `web/src/app/index.css`: sections' cards rise 24 px and fade in as they enter the
   viewport (`animation-timeline: view()`, inside `@supports` and `@media (prefers-reduced-motion:
   no-preference)`; browsers without it show the page still). A door tile lifts 2 px and takes an `ink`
   border on hover and focus-visible. Under `prefers-reduced-motion: reduce` nothing moves.
4. **`web/src/locales/he.json`**: the new `landing.*` keys (UI section). **No key is removed**: the rebuild
   still reads every existing one (`badge`, `title`, `subtitle`, `cta.owner/seeker/market`,
   `example.caption/street/city`, `how.title`, `how.step1..3.{title,text}`, `trust.verified/noBrokers/free`).
   `HomeRoute.test.tsx` (`landing.badge`, `landing.title`), `auth/__tests__/routes.test.tsx`
   (`landing.title`) and `e2e/landing.spec.ts` (`landing.title`, `landing.cta.owner/seeker`) keep working.
5. **The new Button variant's two exhaustive users**: `web/src/app/KitPreview.tsx` (`variantLabel` is a
   `Record<ButtonVariant, string>`, so `tsc` fails without an `inverse` entry; show the `inverse` row on a
   `bg-ink` strip, not in the white `VARIANTS` loop, or it is white on white) and
   `web/src/components/__tests__/Button.test.tsx` (add an `inverse` row to its variants table: its classes
   and the accent focus ring).
6. **Tests**: `web/src/features/landing/__tests__/LandingPage.test.tsx` rewritten for the new page;
   `web/e2e/landing.spec.ts` updated (see Tests). `HomeRoute.tsx` and its test do not change.
7. **Constraints from existing tests**: `LandingPage.tsx` keeps its one `<PageContainer width="wide">`
   with no `mx-auto` / `w-full` / `max-w-` on it, and no other `width="narrow|default"` string in that file
   (`app/__tests__/pageWidths.test.ts` reads it as `INNER.LandingPage`); section files the coder splits out
   use no `PageContainer`.
8. **Phone tab bar: nothing to do.** The tab bar is the signed-in `AuthMenu` nav (`max-lg:fixed
   bottom-0`); a visitor's `AuthMenu` renders only the "כניסה" link, and `HomeRoute` sends anyone signed in
   away from `/`, so the landing never sits above a tab bar. `<main>`'s `pb-8` (`Layout.tsx:51`) stays.

**Out:** the header and tab bar (`Layout.tsx`); a footer (decided: none until Slice 12); `HomeRoute`'s
redirect for signed-in people; any API or schema change; SEO / meta tags / Open Graph; a search box in the
hero; listing counts or other numbers about the site; a dark theme; photos or screenshots of the app.

**New dependencies:** none.

## Data
None.

## API
No new endpoint. The page reads the existing public `GET /listings` (no auth; the same request `/search`
makes for a visitor).

## UI
**Screen:** `/` for a visitor. **Artboard:** `design/screens-v2/Main.html` (structure, spacing, copy and the
mini-illustrations; it sketches the app header only for context). Colour, type and shape stay
`design/brand/` and the Tailwind tokens: no new colour, font size, radius or shadow; cards take `border`, no
shadow (the sketched map's price pins may use the existing `shadow-pin`).

**States.** The page itself is static and has no loading or error state. The listings section: success with
three or more → shown; everything else → absent (above).

**Headings.** One `<h1>` (hero). Each section's title is an `<h2>` (Fredoka, `text-h2`; the closing band's
may use `text-h1` / `lg:text-display`). Tile, step and listing titles are `<h3>`. No level is skipped. Each
section is a `<section aria-labelledby>`.

**RTL.** Logical properties only. "More" chevrons point to the inline end (the left, in RTL), as today's CTA
chevrons do. The swipe row starts at the inline start.

**Brand rules that bite here.** One turtle on the page (the hero's; none in the band: the mascot never sits
on `ink`-like fills other than `surface` / `accent-soft`). Interface icons are outline, stroke 2, round caps.
No emoji. Plural, gender-neutral Hebrew. The turtle joke appears once (the closing band).

**i18n keys added** (Hebrew from the artboard, verbatim, after the verifier's two copy corrections above):
- `landing.example.why.title` ("לדוגמה: למה {{score}}%"), `.fits1`, `.fits2`, `.partial`
- `landing.doors.title`, `.subtitle`; per tile `landing.doors.{map,match,market,owner}.{title,text,more}`;
  the mini-illustrations' words (`landing.doors.match.caption`, `landing.doors.market.badge`,
  `landing.doors.market.initials` ("נעד", one avatar per character), `landing.doors.owner.row1..3.{name,meta}`
  (each row's avatar letter is its name's first character, no key); the five pin prices and the 91% are
  formatted numbers (`formatIls` + `listings.units.ils`; `EXAMPLE_SCORE`), not keys)
- `landing.latest.title`, `.subtitle`, `.all`
- `landing.how.seeker`, `landing.how.owner.label`, `landing.how.owner.step1..3.{title,text}`
- `landing.faq.title`, `.subtitle`, `landing.faq.q1..q5.{q,a}`
- `landing.closing.title`, `.text`

## Acceptance criteria
- [ ] AC1 Given a visitor at `/` Then the hero (the region named by the `<h1>`) shows the tag, the `<h1>`
  "מתאימים, לא גוללים.", the subtitle, the links "פרסום דירה" → `/signup?role=owner&next=%2Flistings%2Fnew`,
  "חיפוש דירה" → `/search`, the market link → `/market`, and the three trust claims; the page has exactly
  one mascot image (`img[src*="homie-turtle"]`, `alt=""`; listing covers are other `img`s) —
  `web/src/features/landing/__tests__/LandingPage.test.tsx::ac1_hero` (queries scoped
  `within(region named TITLE)`: the CTA names repeat in "איך זה עובד" and the closing band)
- [ ] AC2 The hero's figure holds the example listing with "התאמה 91%" and the "why" list of three lines —
  `LandingPage.test.tsx::ac2_example_and_why`
- [ ] AC3 The doors section has four links, each named by its title, going to `/search?view=map`,
  `/signup?role=seeker&next=%2Fme%2Fprofile`, `/market` and the owner signup address; the mini-illustrations
  are hidden from assistive technology — `LandingPage.test.tsx::ac3_doors`
- [ ] AC4 Given the listings request returns three or more items Then "עלו לאחרונה" shows exactly three
  cards, each linking to its `/listings/:id`, and "לכל הדירות" → `/search`; the request carried
  `listing_type=apartment`, `sort=newest` and `limit=3`, and it is the only request besides `GET /me` —
  `LandingPage.test.tsx::ac4_latest_listings` (stub `'GET /listings': [json({ items: listings(3), total: 3,
  sort: 'newest' })]` with `mockApi` from `auth/__tests__/harness` and `listings` / `publicListing` from
  `search/__tests__/fixtures.ts`; read the params from `api.calls('GET /listings')[0].request.url`)
- [ ] AC5 Given the request is pending, fails, or returns fewer than three items Then there is no "עלו
  לאחרונה" heading, no error text and no skeleton, and every other section is present —
  `LandingPage.test.tsx::ac5_latest_absent` (pending: a never-resolved promise as the reply, as
  `HomeRoute.test.tsx` does for `/me`; fails: `json({}, 500)` (the test client does not retry); fewer:
  `listings(2)`)
- [ ] AC6 "איך זה עובד" holds two ordered lists of three steps, named "מחפשים דירה" (today's three step
  titles) and "מפרסמים דירה" (the three owner step titles), each followed by its side's CTA (→ `/search`,
  → the owner signup address) — `LandingPage.test.tsx::ac6_how_both_sides`
- [ ] AC7 "שאלות נפוצות" holds five `<details>`, each with a `<summary>` holding its question; the first is
  open, the other four closed — `LandingPage.test.tsx::ac7_faq` (opening on activation is the browser's
  native `<details>` behaviour, not the page's code, and is not tested)
- [ ] AC8 The closing band has an `<h2>` and the two CTAs with the hero's destinations, the seeker one
  `secondary` and the owner one `inverse`; the page has no `<footer>` —
  `LandingPage.test.tsx::ac8_closing_no_footer`; the `inverse` classes and the accent focus ring —
  `web/src/components/__tests__/Button.test.tsx` (its variants table)
- [ ] AC9 The page has one `<h1>`, no skipped heading level, and no axe violations —
  `LandingPage.test.tsx::ac9_headings` and `web/e2e/landing.spec.ts::ac8_landing_smoke` (its existing axe check)
- [ ] AC10 Given a 390 px wide viewport Then the document does not scroll sideways
  (`scrollWidth <= clientWidth`) and the five static sections sit in one column —
  `web/e2e/landing.spec.ts::ac10_phone_no_overflow`
- [ ] AC11 Given `prefers-reduced-motion: reduce` Then a door tile and a step card have opacity 1 and no
  transform before and after scrolling — `web/e2e/landing.spec.ts::ac11_reduced_motion`
- [ ] AC12 A signed-in person at `/` still goes to their home and never sees the landing —
  `web/src/features/landing/__tests__/HomeRoute.test.tsx::ac5_home_states` (unchanged, still passing)
- [ ] NF1 `make lint`, `make i18n-check` and `make test` pass; no new dependency; no physical-direction class
- [ ] NF2 A visitor's `/` makes one request beyond `/me` (the listings query) and loads no new image file
  besides the mascot and any listing covers (covers lazy-loaded) — checked by the code reviewer in the diff

## Tests to write
Unit (vitest + Testing Library): AC1–AC9 above, through `visitLanding()` as today (`mockApi` stubs `fetch`;
`'GET /me'` 401 plus a `'GET /listings'` reply per test; an unstubbed route answers 599, so tests that do
not care about the listings get the absent section). The other tests that render a visitor's `/`
(`HomeRoute.test.tsx`, `auth/__tests__/routes.test.tsx`, `app/__tests__/Layout.test.tsx`) do not stub
`GET /listings`, get that 599 and the absent section, and need no change.
E2E (CI only, Speed rule 8): keep `ac8_landing_smoke` passing with updated selectors: the CTA clicks are
scoped to the hero region (`main.getByRole('region', { name: TITLE })`), since "פרסום דירה" and "חיפוש
דירה" now appear three and two times in `<main>` and Playwright's strict mode fails on an unscoped
`getByRole`; `page.getByRole('figure')` stays unique. Its two `expectNoAxeViolations` calls run after
`page.emulateMedia({ reducedMotion: 'reduce' })`, so no card is caught mid-fade (axe counts opacity in
colour contrast); AC11 covers the motion itself. Add `ac10_phone_no_overflow` and `ac11_reduced_motion`.
The e2e database may hold fewer than three listings, so no e2e test depends on the listings section.

## Risks / open questions
Resolved by the verifier against the code (answers written into Scope / AC / Tests above):
- `sort`: `'newest'` (`SORTS` in `search/filters.ts`); called as `searchListings({ listing_type:
  'apartment', sort: 'newest' }, 0, { limit: 3 })` inside a plain `useQuery` keyed `['landing', 'latest']`,
  not `useSearch` (Scope 2.3).
- `ListingCard`: `to` makes the title a stretched link (the whole card is the target, `Card interactive` is
  `relative`); `coverUrl={listing.cover?.small_url}`, `<img loading="lazy">` in the fixed 16:10 box, the
  placeholder icon without one. A visitor's card: no badge, no chips (Scope 2.3).
- `/signup?role=seeker&next=%2Fme%2Fprofile`: `safeNext('/me/profile')` returns it unchanged (one leading
  `/`, no control character); `SignupPage` passes it to `OtpForm`, which navigates there after the code;
  `/me/profile` is behind `RequireUser` (any account), so a new seeker lands on the profile form.
- `Button` on ink: `secondary` already is the white button; one new `inverse` variant for the outline;
  the existing accent focus ring is 3.6:1 on ink and needs no change (Scope 2.6).
- Phone tab bar: a visitor has none; nothing to pad (Scope 8).
- Dropped `he.json` keys: none (Scope 4). Blast radius below.

Choices made with Gilad's brief in hand, built as recommended; Gilad sees them on the PR's page and can
change any before merge (each is a small edit):
- **Q1 real listings on the landing.** Shown only with three or more live apartments, never a count. Other
  options: always hide until launch; show from one listing.
- **Q2 new copy and claims.** The FAQ says the search and map are open without signing up, that the site is
  free for seekers with no broker fees, how the score is computed in one sentence, what שוק השותפים is, and
  that the site works in Gush Dan. The owner steps say "five steps" and "chat on the site". The closing line
  is "הבית הבא מתחיל כאן." with the turtle joke "לאט לאט? ממש לא.".
- **Q3 no footer**, as decided for Slice 9; the closing band ends the page.

## Blast radius
From `graphify affected` on `main` (2026-11-14), one line per changed symbol:
- `LandingPage()` (rebuilt): called only by `HomeRoute()` (`landing/HomeRoute.tsx:28`) → `AppRoutes()`.
  Tests: `landing/__tests__/LandingPage.test.tsx` (rewritten, Scope 6), `HomeRoute.test.tsx` (unchanged:
  reads `landing.badge` / `landing.title`, both kept), `auth/__tests__/routes.test.tsx` (unchanged: reads
  `landing.title`), `app/__tests__/pageWidths.test.ts` (unchanged, constrains the file: Scope 7),
  `e2e/landing.spec.ts` (updated, Tests). Also listed: `MarketMinePage.test.tsx`, `Layout.test.tsx`,
  `queryClient.test.tsx`, `SideSwitch.test.tsx`, `usePageTitle.test.tsx`, `search/__tests__/routes.test.tsx`
  (they import `AppRoutes`/`Layout`; any that renders a visitor's `/` now also sends `GET /listings`, gets
  the harness's 599 and no section; untouched).
- `buttonClasses()` / `ButtonVariant` (one variant added): `Button.tsx` and its ~40 callers are untouched
  (no existing variant changes). Exhaustive users that must change: `Button.classes.ts` `VARIANTS`,
  `app/KitPreview.tsx` `variantLabel` (Scope 5), `components/__tests__/Button.test.tsx` (Scope 5).
- `searchListings()` / `useSearch()`: not changed, only called (a new caller); `useSearch`'s users
  (`SearchView`, `useMapSearch`, `SearchMap`) untouched; the landing's key `['landing', 'latest']` does not
  share their `['search', …]` cache.
- `ListingCard()`: not changed, only called with existing props (as `ResultsList` does); its other callers
  untouched.
- `safeNext()`, `Layout()`, `HomeRoute()`, `exampleListing()`: not changed (checked, see Risks).
- `web/src/app/index.css`: new rules only (`.reveal`-style entrance and tile hover), scoped to classes the
  landing adds; nothing else reads them.
- `he.json`: keys added only; none dropped.

## Verifier findings
One round; every fixable fact was fixed in place (listed in the report). Remaining, none blocking the build:
1. (line 7, PRODUCT.md) PRODUCT.md "שוק השותפים" records "the landing page gains one entry point to the
   market", and `specs/MARKET-PLAN.md` Q7 says "Add one entry point to the market; a full rework waits".
   This spec is that rework and adds a second link (the market door) plus an FAQ answer. Not a
   contradiction of intent, but the standing line now reads wrong. Suggested fix: the orchestrator adds to
   PRODUCT.md (Slice 9 copy + UX or "שוק השותפים") "Landing v2 (0009z, Gilad 2026-11-14): the full rework;
   the market has the hero link and a door tile" when Gilad accepts Q1–Q3 on the PR.
2. (line 5, design) The hero tag cannot be the artboard's white chip without a new `Tag` tone; the spec
   uses `tone="neutral"`. If the ux reviewer or Gilad wants the exact look, add a `surface` tone to
   `components/Tag.tsx` (one line + KitPreview) in a follow-up; not worth a kit change here.

## Digest (filled by orchestrator after verification)
    Spec 0009z — Landing page v2   (verified, one part)
    What a user can do after this: a visitor at `/` sees a full landing page (hero, four doors into the
      site, three real listings, how it works for both sides, five questions, a closing band) and can
      enter any part of the site from it.
    Decisions, built as recommended and open to change on the PR: 1. real listings shown only with three
      or more live apartments, never a count  2. the new copy (FAQ, owner steps, closing line)
      3. still no footer
    KPIs this slice moves: visitor → search / signup click-through from `/`.
    Acceptance targets: one request beyond `/me`; no new dependency, image file or design token;
      no sideways scroll at 390 px; nothing moves under reduced motion.
    Risks: the look is a taste call — mitigation: Gilad merges this one himself after seeing the page.
      PRODUCT.md's "one entry point to the market" line gets a landing-v2 note when he accepts it.
    Reviewers: ux, qa, code   Estimated: 1 coder run (Opus/medium), 1 review round
    Links: specs/0009z-landing-v2.md · Product Plan screen 1 (Landing) · design/screens-v2/Main.html
