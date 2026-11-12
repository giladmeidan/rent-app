---
id: 0009c
title: The app's accessibility baseline — a skip link, focus and scroll at the top of every new page with a tab title that names it, one h1 per page state, announced loading blocks, focus rings that show and are never hidden, 44 px fields, reduced motion honoured, honest toggle names — and an axe check in e2e that keeps it that way
status: in-progress
depends_on: []
reviewers: [code, qa, ux]   # ux: headings, focus order, titles (no new screen); qa: keyboard flows, the axe e2e and the OTP budget per shard; no security: no auth, data or PII change (page titles show only what the page shows, see Risks); no perf: no query change
estimate: 1 coder run   # coder Opus/high: ~25 files, mostly mechanical, but route focus is easy to get subtly wrong (Speed rule 6, "when in doubt, the stronger one")
---

## Goal
After this ships:
- a keyboard user skips the header with one Tab and Enter;
- after any in-app navigation, the new page starts at the top with focus on `<main>` (or on what the page
  focused itself), and the browser tab's title names the page;
- every page state has exactly one `<h1>`, and loading blocks are announced as "טוען…";
- focus rings, in the brand's `accent`, show on every control, accent-filled ones included, and are never hidden under the wizard's
  sticky footer;
- the borderless inputs take taps over their full row;
- animations stop under `prefers-reduced-motion`;
- toggle buttons are named by their visible text;
- `make e2e` fails if axe finds a WCAG 2.2 A/AA (or best-practice) violation on the main pages.

This is Dev Plan slice 9 ("polish"), the accessibility baseline. Focus after actions, announced status lines
and the map's landmark and states are in `0009t` (split off by the verifier).
Error, session and draft states are in `0009g`. This spec closes `specs/FOLLOWUPS.md` line 15 (as of
`8c3c480`). The rest comes from a sweep of every route done for this spec (headings, focus, motion, touch,
landmarks, WCAG 2.2). Line 71's behaviour parts are already done on `main`; its copy part is `0009f`'s.

No artboard changes: the screens keep their layout (`design/screens-v1/*.dc.html`). The skip link uses the
existing tokens.

## Scope
**In:**

1. **Shell: skip link, main target, navigation focus, page titles**
   - New `web/src/components/SkipLink.tsx`:
     - an `<a href="#main">`, rendered as the **first child** of `Layout`'s root, before `<header>`;
     - classes `sr-only focus:not-sr-only focus:fixed focus:top-2 focus:start-2 focus:z-50
       focus:inline-flex focus:min-h-[44px] focus:items-center focus:rounded-full focus:bg-surface focus:px-4
       focus:font-semibold`, plus the accent focus ring (Scope 3). Every visible-state class is
       `focus:`-prefixed, so none fights `sr-only`;
     - text `a11y.skipToMain`;
     - a click calls `preventDefault()`, then focuses `#main` and scrolls it into view, so the URL hash and
       later router navigations are untouched.
   - `web/src/app/Layout.tsx`: `<main id="main" tabIndex={-1} className="… focus:outline-none">`, three
     attributes. The container widths are `0009d`/`0009h`'s, and the header is `0009a`'s.
   - New `web/src/app/RouteFocus.tsx`, rendered once inside `Layout`, using `useLocation()` and
     `useNavigationType()`. When `pathname` changes and the navigation type is `PUSH` or `REPLACE`, it runs
     **in a `useLayoutEffect`**:
     - `window.scrollTo(0, 0)`, then `document.getElementById('main')?.focus({ preventScroll: true })`;
     - it never runs on the first render, on `POP`, or when only `search`/`hash` changed. Back and forward
       keep the browser's own scroll restoration.

     Because a layout effect runs before every passive `useEffect` of the new page, a page's own mount
     effects run after it and win:
     - `ProfilePage.tsx:91-94` focuses the room `<h2>` on `?section=room`;
     - `EditListingPage.tsx:28-30` focuses the expired heading;
     - `ChatThreadPage.tsx:108-114` scrolls a cached thread to its latest message.
   - New `web/src/app/usePageTitle.ts`: `usePageTitle(page: string | undefined)` sets `document.title` to
     `t('app.pageTitle', { page, app: t('app.title') })`, or to `t('app.title')` when `page` is undefined.
     Its cleanup restores `t('app.title')` on unmount, so `/` (0009a's landing, which calls no hook) never
     keeps the last page's title.
     - Every route page except `/` calls it with the text of its current `<h1>`: LoginPage, SignupPage,
       SearchPage, ListingPage (`cardTitle`, or `listing.notFound`), JoinFlatPage, NewListingPage /
       EditListingPage (through `ListingWizard`'s heading text, or the edit page's not-found / expired
       heading), MyListingsPage, ApplicantsPage, PeoplePage, FlatmatesPage, MyApplicationsPage, MyLikesPage,
       ProfilePage, ChatListPage, ChatThreadPage (`other_name`, or `chat.thread.notFound` /
       `chat.removed`) and MyFlatsPage.
     - A loading state whose `<h1>` comes from the data passes `undefined`.
     - `index.html`'s `<title>` is `0009a`'s. `App.tsx`'s one-off `document.title = …` stays as the initial
       value.
   - `web/src/test-setup.ts`: add `window.scrollTo = () => {};` next to `scrollIntoView`, because jsdom does
     not implement it.
   - `web/src/app/routes.tsx`: the `*` route stays `<Navigate to="/" replace />`. There is no 404 page in
     Slice 9 (`0009a` left this to `0009c`).

2. **One `<h1>` per state, announced loading blocks**
   - `web/src/components/Loading.tsx` is moved from `features/chat/Loading.tsx`, which is deleted and its
     imports updated: `<div aria-busy="true">`, an sr-only `common.loading`, then the `aria-hidden`
     skeletons.
   - It replaces every loading wrapper that puts `aria-label` on a role-less `<div>` (axe
     `aria-prohibited-attr`) or names a list of `aria-hidden` skeleton items (read as an empty list):
     - divs: `ListingPage.tsx:40`, `ApplySection.tsx:297`, `EditListingPage.tsx:38`, `FlatmatesPage.tsx:281,
       309`, `MyFlatsPage.tsx:74`, `ProfilePage.tsx:523`, `PeoplePage.tsx:83`, `ApplicantsPage.tsx:116`,
       `MyLikesPage.tsx:57`;
     - lists: `ResultsList.tsx:40`, `MyListingsPage.tsx:137`, `MyApplicationsPage.tsx:134`,
       `PeoplePage.tsx:107`, `ApplicantsPage.tsx:145`, and `ChatListPage.tsx:130-137`, whose inner `<ul>` of
       skeleton `<li>`s becomes plain `<div>`s;
     - `MatchCard.tsx:50-55` (`role="status" aria-busy aria-label`) uses `Loading`;
     - `JoinFlatPage.tsx:70-77` defines a local `Loading` function; it is deleted and
       `components/Loading` imported;
     - the guards' pending `<Skeleton />` (`RequireOwner.tsx:14`, `RequireSeeker.tsx:14`,
       `RequireUser.tsx:14`) becomes `<Loading><Skeleton /></Loading>`.
     `features/areas/AreasList.tsx` (`/`) is `0009a`'s.
   - These existing tests find the loading block by the `aria-label` that goes away:
     - `ApplicantsPage.test.tsx:144, 190`;
     - `FlatmatesPage.test.tsx:260, 293`;
     - `MyFlatsPage.test.tsx:71`;
     - `EditListingPage.test.tsx:139`;
     - `SearchPage.test.tsx:236`;
     - `MyApplicationsPage.test.tsx:83`;
     - `PeoplePage.test.tsx:368`;
     - `MyListingsPage.test.tsx:26`;
     - `LoginPage.test.tsx:225` (the AreasList on `/`; drop that assertion if `0009a` has already deleted
       AreasList).

     They switch to `screen.getByText(he.common.loading).closest('[aria-busy="true"]')`, the pattern of
     `ChatListPage.test.tsx:60`, with no new helper.
   - `ErrorState` gains `page?: boolean`. When it is true, the message renders as an `<h1>` (no `<p>`) with
     the paragraph's current classes, so a page whose only content is the error still has its one `<h1>`.
     Pass `page` only where `ErrorState` replaces a page that has no other `<h1>`:
     - the three guards' failed `/me`;
     - `ListingPage`'s error branch;
     - `ChatThreadPage`'s error branch.
   - Pages whose `<h1>` text needs no data render that `<h1>` in their loading and list-error states as
     well, above `Loading` / `ErrorState`, and do not pass `page`:
     - `ApplicantsPage` (`applicants.title`);
     - `PeoplePage` (`people.title`);
     - `FlatmatesPage` (`flatmates.title`);
     - `EditListingPage` (`listings.edit.title`).
   - Heading order: `ListingCard` gains `titleAs?: 'h2' | 'h3' | 'p'` (default `'h2'`), rendered with a
     literal element switch. `MyLikesPage` passes `'h3'`, because its cards sit under section `<h2>`s.
     `0009a` adds the same prop with `'h2' | 'p'`: whichever spec merges first creates it, and the other
     widens the union. `0009i`'s `layout` prop is separate.
   - The rule the coder keeps: every state of every route renders **exactly one `<h1>`**. The only exceptions
     are the guards' pending state and a loading state whose heading is the loaded data (`ListingPage`,
     `ChatThreadPage`); those show `Loading`.

3. **Focus visible, never obscured** (FOLLOWUPS 15)
   - **Brand amendment (2026-11-12, `specs/0009-brand-amendment.md`).** Focus rings are `accent`
     everywhere: `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2
     focus-visible:outline-accent`, which is the brand kit's rule (`design/brand/README.md`: accent is for
     focus rings). Token names are the amendment's (`surface`, `ink`, `ink-muted`, `on-ink`, `accent`,
     `accent-strong`, `accent-soft`, `border`, `border-strong`, `warning`, …); the teal set is gone.
   - FOLLOWUPS 15 (an accent ring on an accent-filled button reads as a thicker button) closes through the
     brand: primary buttons are `ink` with `on-ink`. `ErrorState`'s retry is therefore `bg-ink text-on-ink`
     with the accent ring. If `0009h` has already restyled `ErrorState` onto the kit's `Button primary`, the
     coder only checks it.
   - Any control that stays accent-filled (the brand allows one per screen; the coder greps `bg-accent `)
     keeps `outline-offset-2`, so a `surface` gap separates ring and fill. The same holds for
     `MapCanvas.tsx:49`'s pin button: its ring moves from offset 0 to `outline-offset-2`, so it no longer
     abuts the selected (accent) chip.
   - If `0009d`'s kit (`Button`, `focusRing`) has merged first, the ring lives once in `focusRing`, not at
     each call site.
   - `web/src/app/index.css`:
     - `@layer base { :focus-visible { outline: 2px solid theme('colors.accent'); outline-offset: 2px; } }`
       (`colors.accent.DEFAULT` if the config nests it), a fallback for anything without its own ring (MapLibre's controls included); component
       classes still win;
     - `html:has([data-sticky-footer]) { scroll-padding-bottom: 96px; }`. `ListingWizard.tsx:480`'s
       `sticky bottom-0` footer gets `data-sticky-footer`, so a field focused by Tab is never under it
       (WCAG 2.4.11). `0009k` restyles that footer and keeps the attribute.
   - `ChatThreadPage.tsx:222` (`Removed`, `<h1 tabIndex={-1}>`) gets `focus:outline-none`, like the other
     programmatic focus headings.

4. **Touch targets**
   - Add `self-stretch min-h-[44px]` to the three `bare` input class constants (`DetailsStep.tsx:24`,
     `ProfilePage.tsx:49`, `FiltersForm.tsx:132`), not per input. The borderless inputs inside the 48 px
     `box` wrappers then take a tap anywhere over the field's full row height. The padding and the suffix
     still do not focus it. The visual size is unchanged, and `DetailsStep.tsx:236`'s `max-w-[3.5rem]`
     still applies.
   - Everything else is already ≥ 44 px, or is an inline link in running text (the WCAG 2.5.8 exception).

5. **Reduced motion**
   - `web/src/app/index.css`: `@media (prefers-reduced-motion: reduce) { *, ::before, ::after {
     animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration:
     0.01ms !important; scroll-behavior: auto !important; } }`.
   - This covers `Skeleton`'s `animate-pulse`, `Switch`'s transitions, the wizard progress
     `transition-[width]` and the chevrons. No `scrollIntoView` uses `smooth` today, and none may. MapLibre's
     camera animations are left to the library, because the map moves only on gestures and zoom buttons.

6. **Toggle names** (WCAG 2.5.3)
   - `LikeRoomButton.tsx:69`: remove the `aria-label` override. The name is the visible text, and
     `aria-pressed` carries the state. `likes.unlikeLabel` is then unused and is deleted from `he.json`. Its
     tests (`ListingPage.test.tsx:600`, `MyLikesPage.test.tsx:84`) find the button by its visible name with
     `pressed: true`.

7. **Automated check**
   - New dev dependency **`@axe-core/playwright`**, an exact pinned version, the latest 4.x at build time. It
     brings `axe-core`. It is used in e2e only and never reaches the bundle.
   - Move `TILE` and `routeTiles` from `map.spec.ts:10-33` into `web/e2e/helpers.ts` (exported), and use
     them from both `map.spec.ts` and `a11y.spec.ts`, so no run ever calls OpenStreetMap.
   - New `web/e2e/a11y.ts` with `expectNoAxeViolations(page, label)`:
     - it runs `new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa',
       'best-practice'])`;
     - it fails with each violation's `id`, `impact`, `help` and first three `target`s in the message;
     - **no rule is disabled** unless it fails for a reason another spec owns. Then the `disableRules([...])`
       line carries a comment naming the rule, the reason and the owning spec, and the digest lists it;
     - colour: fix in place only a one-off hex or class in a file this spec already edits, and list it in
       the digest. Never touch `tailwind.config.ts`. Otherwise `disableRules(['color-contrast'])` with a
       comment naming `0009d`/`0009h`; the orchestrator then adds a FOLLOWUPS line "re-enable
       color-contrast in `web/e2e/a11y.ts`";
     - the only allowed `exclude` is MapLibre's attribution (`.maplibregl-ctrl-attrib`), for
       `color-contrast` over map tiles;
     - map rules that `0009t` fixes (the nested map landmark) may be disabled with a comment naming it,
       until it merges.
   - New `web/e2e/a11y.spec.ts`. It needs **no sign-up and no data**:
     - `ac5_public_pages_pass_axe`: `/search`; `/search?view=map` with `routeTiles`, once the region shows
       `aria-busy="false"` (15 s timeout, as `map.spec.ts:136`); `/login`; `/signup`; `/flatmates/join` (no
       token); and `/listings/<random uuid>` (not found);
     - `ac6_skip_link_and_route_focus`;
     - `ac7_reduced_motion`.
   - `expectNoAxeViolations` calls go **inside existing e2e tests**, at points where those tests already
     render the page signed in, so there are **zero new sign-ups**. The coder may move a call within its test,
     never to another test:

     | Page | Test |
     | --- | --- |
     | listing page with content (visitor) | `map.spec.ts::ac8_visitor_finds_a_listing_on_the_map`, after line 117 |
     | wizard step 1, `/me/listings` | `listings.spec.ts::ac9_owner_creates_and_pauses_listing` |
     | applicants inbox | `inbox.spec.ts::ac12_shortlist_chat_decline` |
     | listing page with the apply form open, `/me/profile`, `/me/applications` | `applications.spec.ts::ac9_fill_profile_apply_withdraw` |
     | `/chat`, a group thread, `/me/listings/:id/flatmates` | `flatmates.spec.ts::ac5_group_chat_flow` |
     | `/me/flats` | `flatmates.spec.ts::ac5_group_chat_flow`: a new `flatmatePage.goto('/me/flats')` after line 165, already signed in |
     | `/me/listings/:id/people` | `people.spec.ts::ac10_owner_likes_back_and_chats` |
     | `/me/likes` | `likes.spec.ts::ac9_seeker_likes_back_and_chats` |

8. **`web/src/locales/he.json`** (new keys only; `0009b` owns existing wording; one deletion):

   | Key | Hebrew |
   | --- | --- |
   | `a11y.skipToMain` | "דילוג לתוכן הראשי" |
   | `app.pageTitle` | "{{page}} · {{app}}" |

   Deleted: `likes.unlikeLabel` (Scope 6). Neither new key is count-dependent. `app.pageTitle` takes
   `app.title`, whose value `0009a` sets.

**Out:**
- Focus after actions (`focusMainIfLost`), announced status lines, the OTP live region, and the map's single
  landmark, states above the fold and loading pill (FOLLOWUPS 23, 52, 55, 73, 74, 75, 76, 123, 149, 184):
  `0009t`.
- Error, session, retry, draft and vanished-card states: `0009g`. The disabled sign-in button's reason
  (FOLLOWUPS 24) and the offline text (17): `0009f`. Wording of existing keys: `0009b`.
- The `/` route and `AreasList` (FOLLOWUPS 14, 22), the header's structure and `<nav>`, `index.html`'s
  `<title>`, and the fixed bottom tab bar's `scroll-padding-bottom`: `0009a`.
- Colour tokens and the text fields' own focus style (today a faint `ring-accent-tint`; under the brand an
  `accent` ring on `border-strong` fields): `0009d`/`0009h`.
- Shared files: `0009h` (the `ErrorState` restyle, page roots), `0009i` (`ListingCard`, `/search`), `0009k`
  (the wizard footer, which keeps `data-sticky-footer`; `MyListingsPage`), `0009l` (`ApplicantsPage`),
  `0009m` (`LoginPage`, `SignupPage`, `ProfilePage`), `0009q` (`LikeRoomButton`, `MyLikesPage`) and `0009s` (the chat routes; `usePageTitle` moves with the
  list's `<h1>`). This spec changes behaviour only, and the second to merge rebases.
- Left for later, as `specs/FOLLOWUPS.md` lines the orchestrator may add:
  - `aria-required` on required fields;
  - focusing the first new card after "load more";
  - `aria-disabled` in place of `disabled` on buttons that hold focus while pending (the kit's `Button
    busy` covers new code);
  - a "done" text on the wizard's completed steps, and dropping its duplicate `role="progressbar"`;
  - fewer named `<section>` regions on the listing page.

**New dependencies:** `@axe-core/playwright` (devDependency, e2e only; pulls in `axe-core`), the automated
WCAG check that keeps this sweep from regressing.

## Data
None.

## API
None. No endpoint changes.

## UI
No new screen. On every page:
- **any state**: the skip link on the first Tab;
- **after a PUSH/REPLACE navigation**: scrolled to the top, with focus on `<main>` or on what the page
  focused;
- **title**: `document.title` = "{{page}} · {{app}}";
- **loading**: `Loading` (announced "טוען…"), with the page `<h1>` where its text needs no data;
- **whole-page error**: `ErrorState page`, with its `<h1>`;
- **success / empty**: unchanged apart from the heading level on `/me/likes`' cards, and the focus rings and
  tap areas described above.

The listing wizard never hides a focused field under its footer.

RTL: the skip link sits at `focus:start-2`, the inline start (the right in Hebrew). Every new class is
logical, with no `left`/`right`. Touch targets ≥ 44 px.

## Acceptance criteria
- [ ] AC1 Rendering `AppRoutes` at `/search`:
  - the first focusable element in document order (`a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])`)
    is the skip link "דילוג לתוכן הראשי" with `href="#main"`;
  - `fireEvent.click` on it focuses `<main id="main">` and leaves `location.hash` empty;
  - `<main>` has `tabIndex` -1.

  The real Tab key is AC6's e2e. — `web/src/app/__tests__/Layout.test.tsx::ac1_skip_link_focuses_main`
- [ ] AC2 Route focus, in a `MemoryRouter` with `AppRoutes`, with `vi.spyOn(window, 'scrollTo')`:
  - a PUSH from `/search` to `/me/applications` (a Link click) leaves focus on `<main>` and calls
    `scrollTo(0, 0)`;
  - changing only `?view=map` calls neither;
  - a `POP` calls neither;
  - a PUSH to `/me/profile?section=room` with a cached profile ends with focus on the room `<h2>`;
  - a PUSH to a chat thread whose data is cached calls `Element.prototype.scrollIntoView` after `scrollTo`
    (spy call order).

  — `Layout.test.tsx::ac2_route_change_focus_and_scroll`
- [ ] AC3 `document.title`:
  - `/me/applications` → "המועמדויות שלי · {app.title}";
  - a chat thread → "{other_name} · {app.title}";
  - a not-found listing → "{listing.notFound} · {app.title}";
  - while the listing loads → `{app.title}`;
  - going from `/me/applications` to `/` leaves `{app.title}`.

  — `web/src/app/__tests__/usePageTitle.test.tsx::ac3_page_titles`, `MyApplicationsPage.test.tsx::ac3_page_title`,
  `ChatThreadPage.test.tsx::ac3_page_title`, `ListingPage.test.tsx::ac3_page_title`
- [ ] AC4 Headings and loading:
  - the guards' pending state has an `aria-busy` region with the text "טוען…", and no `aria-label` on a
    role-less element;
  - the guards' failed `/me` has exactly one `<h1>` ("משהו השתבש");
  - `ErrorState page` renders an `<h1>` with `common.error` and no `<p>`;
  - `ApplicantsPage`, `PeoplePage`, `FlatmatesPage` and `EditListingPage` have their `<h1>` in the loading
    and list-error states;
  - `MyLikesPage`'s card titles are `<h3>` under the section `<h2>`s.

  — `web/src/features/listings/__tests__/RequireOwner.test.tsx::ac4_pending_and_error_states`,
  `web/src/components/__tests__/ErrorState.test.tsx::ac4_page_variant_renders_h1`,
  `ApplicantsPage.test.tsx::ac4_h1_while_loading_and_on_error`, `PeoplePage.test.tsx::ac4_h1_while_loading_and_on_error`,
  `FlatmatesPage.test.tsx::ac4_h1_while_loading_and_on_error`, `EditListingPage.test.tsx::ac4_h1_while_loading_and_on_error`,
  `MyLikesPage.test.tsx::ac4_card_heading_level`
- [ ] AC5 axe:
  - `/search`, `/search?view=map` (tiles stubbed), `/login`, `/signup`, `/flatmates/join` and an unknown
    `/listings/<uuid>` have no axe violation under the tags above;
  - every signed-in page in the Scope 7 table passes the same check inside the test named there.

  — `web/e2e/a11y.spec.ts::ac5_public_pages_pass_axe`, plus the `expectNoAxeViolations` calls in the tests in
  the Scope 7 table
- [ ] AC6 E2E keyboard, no data:
  - at 390×600 on `/search`, append a 2000 px spacer to `body` with `page.evaluate`, scroll to the bottom,
    and assert `scrollY > 0`;
  - Tab → the skip link is visible and focused; Enter → `<main>` is focused;
  - click the header link "כניסה" → `/login`, `<main>` is focused, `scrollY === 0`, and `document.title`
    ends with `app.title`.

  — `a11y.spec.ts::ac6_skip_link_and_route_focus`
- [ ] AC7 E2E reduced motion: with `page.emulateMedia({ reducedMotion: 'reduce' })`, a `div.animate-pulse`
  appended to `/search` computes `animationDuration` ≤ 0.001 s; without it, 2 s. —
  `a11y.spec.ts::ac7_reduced_motion`
- [ ] AC8 The like toggle on a listing page has the accessible name of its visible text in both states, has
  `aria-pressed` true after liking, and has no `aria-label`. — `ListingPage.test.tsx::ac8_like_toggle_name_matches_text`
- [ ] NF1 On the final head, `make lint`, `make test`, `make i18n-check`, `make build-web` and local
  `make e2e` (3 shards, with the new spec) are green (Speed rule 7). `a11y.spec.ts` sorts first and shards
  split by file, so the coder runs `pnpm exec playwright test --list --shard=i/3` for i = 1..3 and confirms
  each shard has ≤ 8 sign-ups (the limit is 10 OTPs per IP per 15 min; about 8 / 7 / 3 today). The digest
  reports:
  - the e2e result;
  - the sign-ups per shard;
  - any disabled axe rule or in-place colour fix, with its reason.

## Tests to write
- Unit (vitest + Testing Library):
  - `Layout.test.tsx` (AC1–AC2): `MemoryRouter` with `AppRoutes`, `window.scrollTo` stubbed in
    `test-setup.ts` and spied on;
  - `usePageTitle.test.tsx` (AC3);
  - `ErrorState.test.tsx` (AC4);
  - the page cases named in AC3, AC4 and AC8, in the existing test files and harnesses;
  - the loading-selector updates listed in Scope 2.

  Hebrew literals come from `he.json` or use `\uXXXX` escapes, as the existing tests do.
- E2E: `a11y.spec.ts` (AC5–AC7, no sign-up, no data), and the calls in the Scope 7 table (zero new sign-ups).
  `0009a` also creates `web/src/app/__tests__/Layout.test.tsx`, so the second to merge rebases.

## Risks / open questions
- **axe may find more than the sweep did.** A finding is fixed here when it is a markup fix in a touched
  file, and disabled with a comment only when another spec owns it (colour: `0009d`/`0009h`; `/`: `0009a`;
  the map landmark: `0009t`). `best-practice` rules are the likeliest tail. If more than ~5 unrelated
  best-practice rules fail, the coder may drop `best-practice` from the tags and add back
  `page-has-heading-one`, `heading-order`, `landmark-one-main`, `region` and `landmark-unique` through
  `withRules`. The digest says which.
- **Route focus.** Focusing `<main>` after navigation is the established SPA pattern: a screen reader
  announces "main" and continues from the top. Running in a layout effect lets every page's own mount focus
  and scroll win: `ProfilePage`'s `?section=room` heading, `EditListingPage`'s expired heading and the chat
  thread's scroll to the latest message (AC2). `OtpForm` focuses its code input only after an in-page step,
  which this does not touch.
- **Privacy of titles.** `document.title` will hold another person's display name (a chat thread) and listing
  addresses, and titles reach browser history and the OS window list. This is accepted: a title shows only
  what the page already shows, so no security review is needed.
- **Shared `Layout.tsx`** with `0009a` (header) and `0009h` (widths). This spec's diff there is the skip
  link, `RouteFocus` and three attributes on `<main>`, and the second to merge rebases. Notes for `0009a`,
  in the shared notes folder:
  - keep the skip link first and `id="main"` on `<main>`;
  - `HomeRoute`'s pending state uses `components/Loading`;
  - the fixed bottom tab bar needs `scroll-padding-bottom` while it shows (WCAG 2.4.11);
  - the `*` route stays a redirect;
  - `titleAs` is shared with this spec;
  - `Layout.test.tsx` is created by both, so the second to merge rebases.
- **Split history.** The author first pre-split error/session/draft work into `0009g`. Verifier round 1
  then split this file again: focus after actions, announcements and the map went to `0009t`, which
  depends on this spec and is verified on its own.
- Verifier round 1: 35 findings, all applied. 1–20 and 32–35 are here; 21–31 travel with `0009t`. The
  second round is waived.
- Brand amendment (2026-11-12): the focus-ring rule, token names and the skip link's classes follow
  `specs/0009-brand-amendment.md`. This was applied as a spec edit, without re-running the verifier.
  FOLLOWUPS 15 now closes through the brand's `ink` primary button.
- No open product questions.

## Digest (filled by orchestrator after verification)
See `/digest`.
