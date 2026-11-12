---
id: 0009h
title: The app fills the screen on desktop — a full-width shell, every page at its page type's width (forms 480 px, content 720 px, wide pages up to 1400 px) — and no one-off colour is left in the code
status: verified
depends_on: [0009d]   # 0009d: the token scale (web/tailwind.config.ts), PageContainer, Card, Button, focusRing, cx and the coverage test this spec widens
reviewers: [code, qa, ux]   # ux: every screen's width and colours at 390 / 1280 px; qa: no layout regressions (gutters, horizontal scroll, the map); no security or perf
estimate: 1 coder run   # coder Opus/medium: ~55 files, mostly mechanical, but reconciling ErrorState / Layout / the coverage test with 0009c / 0009g needs judgement (verifier)
---

> **Brand kit amendment (orchestrator, 2026-11-12, no verifier re-run):** `design/brand/` (README.md, tokens.json) wins over the artboards and over any older wording below for colour, type (Fredoka for display/h1/h2, Rubik for the rest), radii, no card shadows, the name homie / הומי, the mascot and the voice (no slash forms: plural, infinitive or noun; action-noun buttons; errors say "what happened. what to do."). Token and kit names are those of 0009d. Where this spec still names a teal token, Heebo or a slash form, the builder applies the brand equivalent.

## Goal
After this ships, the shell no longer squeezes every route into one column. Today that column is 608 px of
content: `max-w-[640px] px-4` under preflight's border-box.
- The header row spans a wide container, up to 1336 px of content (1400 px with the gutters).
- Each page sits at its type's width: forms at 480 px and content pages at 720 px. Wide pages (the landing,
  search and the inbox) opt into `wide` in their own screen specs.
- Every colour in `web/src` comes from a named token. The swap changes no rendered colour, because the tokens
  equal today's literals.
- `ChoiceGroup`, `EmptyState`, `ErrorState`, `Skeleton` and `Switch` use the kit's tokens and components, and
  keep their props.

This serves Dev Plan slice 9 → **Slice 9b, the UI pass** (Gilad, 2026-11-12: "layouts do not fill the screen").
It is part 2 of the foundation, after `0009d`. `0009a` and every 9b screen spec should depend on this spec and
branch from its PR once it is open. This spec rewrites the colour classes of ~43 files and every page's root, so
a screen spec built beside it would conflict in most of the same files.

## Scope
**In:**

### 1. The shell (`web/src/app/Layout.tsx`)
- Remove the outer `<div className="mx-auto max-w-[640px] px-4">`.
- The `<header>` spans the page. Its contents (the row and the tagline) move unchanged into
  `<PageContainer width="wide">`, as a **direct child** of `<header>`.
- `<main className="pb-8 pt-6">` spans the page, with no width or padding of its own. Each page's
  `PageContainer` is a **direct child** of `<main>` and sets both.
- The logo's `<svg stroke="#FFFFFF">` becomes `stroke="currentColor"` with `className="text-white"`.
- Nothing else in the header changes: its look, brand, links and wrapping are `0009a`'s (FOLLOWUPS line 122).
- If `0009c` has landed, keep its `<SkipLink />` (first child), `<RouteFocus />` and `<main id="main"
  tabIndex={-1} …>` attributes exactly. Only the width and padding classes move.
- `ChatStreamProvider` still wraps everything.

### 2. Page widths
Every routed page renders its outermost element, **on every return path** (loading, error, not-found, success),
as `PageContainer` with the width below. A `<Navigate>` return is not wrapped.
- The page's own `mx-auto w-full max-w-[480px]` / `max-w-[640px]` classes go. Its column classes (`flex flex-col
  gap-N`) move to `PageContainer`'s `className`, and its element to `as` (`section` where it is one today).
- A `const section = 'mx-auto flex w-full max-w-[…] flex-col gap-4'` keeps only the column classes.
- No `PageContainer` `className` may contain `mx-auto`, `w-full` or `max-w-`. `w-full` on a `box-content` box
  overflows by its gutters.
- Today the gutters come from `Layout`'s `px-4` at every width. After this, `PageContainer` gives `px-4` (as today
  on a phone), `md:px-6` and `lg:px-8`.

| Route | Page | Today (content px) | After |
| --- | --- | --- | --- |
| `/` | `features/areas/AreasList.tsx` | 608 (Layout) | `default` (`0009a` replaces it with the landing) |
| `/login` | `features/auth/LoginPage.tsx` | 480 | `narrow` |
| `/signup` | `features/auth/SignupPage.tsx` | 480 | `narrow` |
| `/search` | `features/search/SearchPage.tsx` | 608 (Layout) | `default` (`0009i` takes it to `wide` at `lg`) |
| `/listings/:id` | `features/listings/ListingPage.tsx` | 608 | `default` |
| `/flatmates/join` | `features/flatmates/JoinFlatPage.tsx` | 480 | `narrow` |
| `/listings/new` | `features/listings/NewListingPage.tsx` | 480 | `narrow` |
| `/me/listings` | `features/listings/MyListingsPage.tsx` | 480 | `narrow` |
| `/me/listings/:id/edit` | `features/listings/EditListingPage.tsx` | 480 | `narrow` |
| `/me/listings/:id/applicants` | `features/applicants/ApplicantsPage.tsx` | 608 | `default` (`0009l` takes it to `wide` at `lg`) |
| `/me/listings/:id/people` | `features/people/PeoplePage.tsx` | 608 | `default` |
| `/me/listings/:id/flatmates` | `features/flatmates/FlatmatesPage.tsx` | 480 | `narrow` |
| `/me/applications` | `features/applications/MyApplicationsPage.tsx` | 480 | `narrow` |
| `/me/likes` | `features/likes/MyLikesPage.tsx` | 480 | `narrow` |
| `/me/profile` | `features/profile/ProfilePage.tsx` | 480 | `narrow` |
| `/chat` | `features/chat/ChatListPage.tsx` | 608 (Layout) | `default` |
| `/chat/:id` | `features/chat/ChatThreadPage.tsx` | 608 (Layout) | `default` |
| `/me/flats` | `features/flatmates/MyFlatsPage.tsx` | 480 | `narrow` |
| guards: pending `<Skeleton />` and failed-`/me` `<ErrorState>` | `features/auth/RequireOwner.tsx`, `RequireSeeker.tsx`, `RequireUser.tsx` | 608 (Layout) | `default`. `<Navigate>` and `<Outlet />` are not wrapped |
| `/dev/kit` (dev only) | `app/KitPreview.tsx` | `0009d` mounts it outside `Layout`, in its own `<main>` with `PageContainer width="wide"`, and wraps the `Suspense` fallback in a `PageContainer` | unchanged; checked by AC4 (AC3's "`<main>`'s direct child" holds for it too) |

The `default` pages go from 608 to 720 px of content (+112 px) on a wide screen and change nowhere else. No page
gets a new layout here: two panes, side panels and grids are the screen specs' (`0009i`, `0009l`, …).

Stays as it is (do not "fix"):
- `ListingWizard.tsx`'s sticky footer `-mx-4 px-4` matches the phone gutter. From `md` up the `narrow` column is
  centred, and the footer stays 512 px wide as today. Keep `-mx-4`, and do not make it `md:-mx-6`.
- `PageContainer` sets no position, overflow, z-index or transform. So `MyLikesPage`'s `relative z-10`,
  `ListingCard`'s stretched link, `SearchMap`'s `h-[60vh]` and the sticky footer behave as today.
- `ChatThreadPage` has one page return path, plus the canonical-id `<Navigate>`, and no full-height layout.

### 3. The colour swap
Every colour literal in `web/src` (outside `__tests__/`) becomes a `0009d` token. The tokens equal the literals,
so no pixel changes.

| Literal | Becomes |
| --- | --- |
| `#D6D3D1` | `border-border-strong` / `bg-line-strong` |
| `#B91C1C` | `text-danger` / `border-danger`, also inside `aria-[invalid=true]:`, `peer-aria-[invalid=true]:`, `group-aria-[invalid=true]:` and `has-[[aria-invalid=true]]:` |
| `#44403C` | `text-ink-soft` |
| `#F5F5F4` | `bg-surface-muted` |
| `#E7E5E4` | `bg-line` / `border-border` |
| `#F0EEEB` | `divide-line-soft` |
| `#DDD6CE` | `bg-photo` |
| SVG `stroke="#FFFFFF"` / `"#A8A29E"` / `"#92400E"` / `"#0B5F52"` | `stroke="currentColor"`, with `text-white` / `text-faint` / `text-warning` / `text-accent-strong` on the `<svg>` |
| `bg-[rgba(28,25,23,0.78)]` | `bg-overlay` |
| `shadow-[0_1px_2px_rgba(0,0,0,0.08)]` / `shadow-[0_1px_3px_rgba(0,0,0,0.2)]` / `shadow-[0_3px_8px_rgba(0,0,0,0.12)]` | `shadow-segment` / `shadow-thumb` / `shadow-pin` |

As of `8c3c480` the files are:
- `components/`: `ChoiceGroup.tsx`, `Switch.tsx`, `map/MapCanvas.tsx`.
- `app/`: `Layout.tsx`.
- `features/applicants/`: `ApplicantCard.tsx`, `ApplicantsPage.tsx`, `RoomDetails.tsx`.
- `features/applications/`: `ApplySection.tsx`, `MyApplicationsPage.tsx`.
- `features/auth/`: `AuthMenu.tsx`, `OtpForm.tsx`, `RoleChoice.tsx`.
- `features/chat/`: `ChatListPage.tsx`, `Composer.tsx`.
- `features/flatmates/`: `FlatmatesPage.tsx`, `JoinFlatPage.tsx`, `MyFlatsPage.tsx`.
- `features/likes/`: `LikeRoomButton.tsx`.
- `features/listings/`: `DetailsStep.tsx`, `ListingCard.tsx`, `ListingPage.tsx`, `ListingWizard.tsx`,
  `MyListingsPage.tsx`, `OwnerPreferences.tsx`, `PreferencesStep.tsx`, `PreviewStep.tsx`, `RoomFields.tsx`,
  `RoomPreview.tsx`.
- `features/match/`: `MatchBadge.tsx`, `MatchCard.tsx`, `icons.tsx`.
- `features/people/`: `PeoplePage.tsx`, `PersonCard.tsx`.
- `features/profile/`: `ProfilePage.tsx`.
- `features/search/`: `FiltersForm.tsx`, `ResultsList.tsx`, `SearchMap.tsx`, `SearchPage.tsx`, `SortSelect.tsx`,
  `ViewToggle.tsx`.

Re-run `grep -rnE '#[0-9A-Fa-f]{6}|rgba?\(' web/src --include='*.tsx' --include='*.ts' --include='*.css'` at
build time, because the branch may have moved. Only class names and SVG colour attributes change: no markup,
copy, spacing or arbitrary `[Npx]` value. `features/match/__tests__/MatchBadge.test.tsx` asserts
`bg-line text-ink-soft` in place of the hex classes. No other test asserts a hex class.

### 4. Shared components onto the kit
Props stay exactly as they are. No new prop is added, and every current call site compiles unchanged. If `0009c`
or `0009g` has landed, keep every behaviour prop and effect it added: `ErrorState`'s `page`, its promise-aware
busy retry and offline text, and `Loading`. Change only the look.
- `components/ChoiceGroup.tsx`: tokens only (`border-border-strong`, `border-danger`, `text-danger`). It also
  exports its segment label classes as `choiceSegment`, so a copy can reuse them; today that is `PreferencesStep`'s
  households, asked for by `0009k`. ChoiceGroup itself uses the export. No check mark: FOLLOWUPS line 128 moves
  whole to the wizard / profile screen spec, so look-alike copies (`RoleChoice`, `ProfilePage`'s areas,
  `PreferencesStep`) never disagree.
- `components/EmptyState.tsx`: a `Card` (`padding="md"`) with the message in `text-body text-muted`. The
  props are unchanged (`message`).
- `components/ErrorState.tsx`: a `Card` with `role="alert"`, the `common.error` text, and the retry as
  `<Button shape="pill">` (`primary`, `md`: 15 px bold). Its focus ring is `0009d`'s `outline-ink` for solid
  buttons (FOLLOWUPS 15, `0009c` §3), never the accent outline. If `0009g` has made the retry promise-aware, its
  pending state uses `Button`'s `busy`, which keeps focus, not `disabled`.
- `components/Skeleton.tsx`: tokens.
  - Exactly one `data-testid="skeleton"` per `Skeleton`, on its outer `aria-hidden` element. At least 14 tests
    count them.
  - The default block is `<Card padding="none">` with `px-4 py-3.5`, so it stays 54 px tall, like the boxes it
    stands in for.
  - The bars add `motion-reduce:animate-none`.
  - The `className` branch stays a plain bar (`MapCanvas` passes `absolute inset-0 h-full w-full`).
- `components/Switch.tsx`: tokens (`bg-line-strong` track, `shadow-thumb` thumb, a `text-body` label).
- `components/map/MapCanvas.tsx`: the two class swaps only (`border-border-strong`, `shadow-pin`).
- Tests:
  - Each of the five top-level components has its own `web/src/components/__tests__/<Name>.test.tsx`.
  - `0009d`'s `coverage.test.ts` changes from its constant list to **every** `web/src/components/*.tsx`. At
    build time, list them: any component without a test file gets a minimal test in this PR. For example,
    `SkipLink` and `Loading`, if `0009c` has merged.

### 5. Guards
- `web/src/app/__tests__/noColourLiterals.test.ts` reads every `web/src/**/*.{ts,tsx,css}` file. It excludes
  `__tests__/`, `test-setup.ts` and the generated `api/`. It flags:
  - a hex colour (`/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/`);
  - an `rgb(` / `rgba(` / `hsl(` / `hsla(`;
  - a `max-w-[480px]` / `max-w-[640px]` literal (page widths belong to `PageContainer`).
- It collects every hit and fails once, with the full `file:line` list.
- `web/tailwind.config.ts` is outside `src` and is where the literals live.

### 6. FOLLOWUPS
The build ticks line 34, line 127 and the colour half of line 43 (the radius half stays for the screen specs).
Line 128 is not this spec's.

**Out:**
- The header's look, brand, links and wrapping (`0009a`). The skip link, landmarks and the shared components'
  behaviour (`0009c`, `0009g`).
- A new layout for any screen: `/search` at `lg` (`0009i`), the inbox's list and detail pane (`0009l`), and the
  other 9b screen specs.
- New props on the shared components: `EmptyState` `action`, `ErrorState` `message` and a `ChoiceGroup` check
  mark. A screen spec adds them with their first caller.
- Arbitrary `[Npx]` and radius classes, and moving screens to `Button` / `Card` / `Field`: the screen specs.
- The PWA colours in `vite.config.ts` / `index.html` (`0009a`). They are outside `src` and already equal the tokens.

**New dependencies:** none.

## Data
None (web only).

## API
None.

## UI
Every screen keeps its content, copy and states. Loading (`Skeleton`), empty (`EmptyState`), error (`ErrorState`)
and success render as today, with three changes:
- the width (table above) and the `md:` / `lg:` gutters;
- the restyled shared components: tokens, `Card` for empty and error, and a `Button` pill for retry;
- the guards' pending and error states sit in the `default` column instead of going edge to edge.

No i18n key is added or changed.

RTL: `PageContainer`'s gutters are symmetric `px-`, and no physical side is used anywhere.

The UX reviewer checks each route in the table at 390 px (unchanged apart from the shared components) and at
1280 px (centred at its width, with the header row at `min(1336, viewport − 64)` px).

## Acceptance criteria
- [ ] AC1 Given `web/src` after the swap, Then no hex colour (3, 4, 6 or 8 digits), `rgb(` / `rgba(` /
  `hsl(` / `hsla(` or `max-w-[480px]` / `max-w-[640px]` literal remains outside the excluded paths. On failure,
  the test lists every `file:line` at once. —
  `web/src/app/__tests__/noColourLiterals.test.ts::ac1_no_colour_literals_in_src`
- [ ] AC2 The swap keeps every colour: `MatchBadge.test.tsx` passes with `bg-line text-ink-soft` for the
  `good` / `partial` buckets, and every other existing web test passes unchanged. —
  `web/src/features/match/__tests__/MatchBadge.test.tsx` (existing, assertion updated) and `make test`
- [ ] AC3 Given `AppRoutes` rendered at `/login` with `features/auth/__tests__/harness.tsx` (`renderRoutes` +
  `mockApi`: `GET /me` 401, `GET /areas` `[]`, as `routes.test.tsx` does), Then:
  - the header's direct child has `max-w-wide` and holds the row and the tagline;
  - `<main>`'s direct child is the page's `PageContainer` (`max-w-narrow`);
  - `<main>` itself has no `max-w-*` or `px-*` class;
  - no element has `max-w-[640px]`.

  And given a protected route while `GET /me` is pending, the guard's skeleton has a closest `.max-w-page`.
  `0009a` later deletes this test's tagline clause. — `web/src/app/__tests__/Layout.test.tsx::ac3_full_width_shell`
- [ ] AC4 Static source check: a constant maps each page file in the §2 table, the three guards and
  `app/KitPreview.tsx` to its width. Then:
  - (a) each file contains at least one `<PageContainer`, and every `/\bwidth="(narrow|default|wide)"/` match
    equals its width (`default` may also be the attribute's absence);
  - (b) the constant's page keys equal the components imported from `../features/` in `app/routes.tsx` (minus the
    `Require*` guards, which the constant lists itself) plus `KitPreview`, so a new or deleted route must update
    the table;
  - (c) no `PageContainer` `className` (a literal, or the `const section` it uses) contains `mx-auto`, `w-full`
    or `max-w-`.

  — `web/src/app/__tests__/pageWidths.test.ts::ac4_page_roots_use_page_container`
- [ ] AC5 The shared components:
  - `ChoiceGroup`: with `error`, every radio is `aria-invalid` and the error has `role="alert"`; a checked
    option's label carries the `choiceSegment` classes;
  - `EmptyState` renders its message inside a `Card`;
  - `ErrorState`: it has `role="alert"`, its retry calls `onRetry`, and the retry's classes include
    `focus-visible:outline-ink` and `rounded-full`;
  - `Skeleton` renders exactly one `data-testid="skeleton"`, `aria-hidden`, and its bars carry
    `motion-reduce:animate-none`;
  - `Switch` has `role="switch"`, and clicking the label toggles it;
  - `coverage.test.ts` passes over every `src/components/*.tsx`.

  — `ChoiceGroup.test.tsx::ac5_error_marks_radios`, `EmptyState.test.tsx::ac5_message_in_card`,
  `ErrorState.test.tsx::ac5_retry_ring_and_pill`, `Skeleton.test.tsx::ac5_one_hidden_skeleton`,
  `Switch.test.tsx::ac5_switch_toggles`, `coverage.test.ts::ac9_every_kit_component_has_a_test` (widened)
- [ ] AC6 E2E at 1280×800 (no sign-up). Locators: `page.locator('header > .max-w-wide')`,
  `page.locator('main > .max-w-narrow')` and `page.locator('main > .max-w-page')`, each `toHaveCount(1)`. A width
  is `getComputedStyle(el).width`, which under `box-content` is the content width. "Centred" means
  `boundingBox().x` and `document.documentElement.clientWidth − (x + width)` differ by ≤ 1 px. Then:
  - `/login`'s container is 480 px and centred;
  - `/listings/00000000-0000-4000-8000-000000000000` (public, not found, `default`) is 720 px and centred;
  - the header's container is `Math.min(1336, clientWidth − 64)` px wide, and at 1600×900 it is 1336 px and
    centred.

  A screen spec that changes a measured page's width updates this test. — `web/e2e/layout.spec.ts::ac6_desktop_widths`
- [ ] AC7 E2E at 390×844 on `/login`, `/signup` and `/listings/00000000-0000-4000-8000-000000000000`: no
  horizontal scroll (`scrollWidth <= clientWidth`), and the page container's computed `padding-left` and
  `padding-right` are 16 px, as today. — `web/e2e/layout.spec.ts::ac7_mobile_gutters`
- [ ] NF1 `make lint`, `make test`, `make i18n-check` and `make build-web` are green, and local `make e2e` is green
  on the final head (Speed rule 7). The result goes in the digest. `map.spec.ts` must still pass, since the map
  sits in the 720 px column, and so must `0009d`'s `kit.spec.ts` (no horizontal scroll at 390).

## Tests to write
- Unit: `noColourLiterals.test.ts` (AC1), `Layout.test.tsx` (AC3), `pageWidths.test.ts` (AC4) and the five
  component tests (AC5), plus the widened `coverage.test.ts` and the updated `MatchBadge.test.tsx` (AC2).
- `Layout.test.tsx` and `ErrorState.test.tsx` are also created by `0009c` / `0009g`. Create the file, or add
  this spec's `it` to it if it exists. Never drop or replace another spec's cases.
- E2E: `web/e2e/layout.spec.ts` (AC6, AC7). Public pages only, so no OTP budget is spent.

## Risks / open questions
- **Merge order with `0009a`, `0009b`, `0009c` and `0009g`.** All four may touch the same lines:
  - the header (`0009a`);
  - the wording near swapped classes (`0009b`);
  - the skip link and `<main>` attributes (`0009c`);
  - `ErrorState` (`page` from `0009c`; the busy, promise-aware retry and offline text from `0009g`);
  - `Loading`, moved into `components/` by `0009c`.

  The second to merge rebases. Keep every behaviour prop that has landed and change only the look. The swap is
  class-only, so conflicts are line-local. `0009a` should depend on this spec (see Goal), so the header restyle
  starts from the wide container.
- **For the orchestrator** (verifier findings 4b and 5):
  - `0009g` AC4 should make the pending retry `Button`'s `busy` (focusable), not `disabled`;
  - `0009c` should add `SkipLink.test.tsx` and `Loading.test.tsx` under `components/__tests__/` if this spec has
    merged first. Otherwise this spec adds them.
- **608 → 720 px.** The listing page, chat, people, inbox and search columns widen by 112 px on desktop. The map
  (`SearchMap`, `h-[60vh]`) and the listing page's 200 px photo placeholder grow with them. The UX reviewer judges
  it at 1280 px. If a page looks worse, it still stays at `default`, and its screen spec fixes it.
- **AC4 is a source check.** It cannot prove that every return path is wrapped. The e2e (AC6 / AC7) measures
  public pages, AC3 measures one guard, and the code reviewer checks the other return paths.
- **The colour-literal regex** could hit a non-colour `#abc` string (none exist today; `#main`, `#root` and
  `join#…` are not hex). Fix a false hit by rewording the string, never by excluding a file.
- **Product questions for Gilad:** none.
- **Verification.** Spec-verifier round 1 rejected with 6 majors and 10 minors, and all are applied:
  - guards and `/dev/kit` in the table;
  - the retry's ink ring, with `0009d` amended;
  - `ErrorState` / `EmptyState` keep their props (`message` and `action` dropped);
  - the coverage test gap closed at build time;
  - e2e locators, and a 720 px page that `0009i` does not change;
  - 608 px, not 640;
  - the `aria-[invalid=true]:` prefix;
  - AC4 rebuilt from `routes.tsx`;
  - a wider colour guard;
  - the `Skeleton` contract;
  - the check mark and FOLLOWUPS 128 moved to a screen spec;
  - the harness named;
  - the "stays as it is" list;
  - coder Opus/medium.

  Also applied: `0009k`'s request for an exported segment class (`choiceSegment`) and `0009c`'s request to keep
  `id="main"`. The second round is waived (one verifier round, Gilad).

## Digest (filled by orchestrator after verification)
See `/digest`.
