---
id: 0009h
title: The app fills the screen on desktop (a full-width shell; forms at 480 px, content at 720 px, wide pages up to 1400 px) and every colour in the code is a homie brand token
status: verified
depends_on: [0009d]   # 0009d: the brand tokens and deprecated aliases (web/tailwind.config.ts), PageContainer, Card, Button, Mascot, focusRing, cx and the coverage test this spec widens
reviewers: [code, qa, ux]   # ux: every screen's width and brand colours at 390 / 1280 px; qa: no layout regressions (gutters, horizontal scroll, the map); no security or perf
estimate: 1 coder run (upper end)   # coder Opus/medium: ~60 files, mostly a mechanical rename, but reconciling ErrorState / Layout / the coverage test with 0009c / 0009g needs judgement (verifier)
---

> **Brand kit amendment (orchestrator, 2026-11-12, no verifier re-run):** `design/brand/` (README.md, tokens.json) wins over the artboards and over any older wording below for colour, type (Fredoka for display/h1/h2, Rubik for the rest), radii, no card shadows, the name homie / הומי, the mascot and the voice (no slash forms: plural, infinitive or noun; action-noun buttons; errors say "what happened. what to do."). Token and kit names are those of 0009d. Where this spec still names a teal token, Heebo or a slash form, the builder applies the brand equivalent.

## Goal
After this ships, the shell no longer squeezes every route into one column. Today that column is 608 px of
content: `max-w-[640px] px-4` under preflight's border-box.
- The header row spans a wide container, up to 1336 px of content (1400 px with the gutters).
- Each page sits at its type's width: forms at 480 px and content pages at 720 px. Wide pages (the landing,
  search and the inbox) opt into `wide` in their own screen specs.
- Every colour in `web/src` is a **homie brand token** (`specs/0009-brand-amendment.md`): each hex literal and
  each old token name becomes its brand name. `0009d`'s deprecated aliases are then deleted, so the teal / stone
  palette is gone from the code.
- `ChoiceGroup`, `EmptyState`, `ErrorState`, `Skeleton` and `Switch` use the kit. `EmptyState` gains the brand's
  optional mascot `pose`.

This serves Dev Plan slice 9 → **Slice 9b, the UI pass** (Gilad, 2026-11-12: "layouts do not fill the screen").
It is part 2 of the foundation, after `0009d`. `0009a` and every 9b screen spec should depend on this spec and
branch from its PR once it is open. This spec rewrites the colour classes of ~60 files and every page's root, so a
screen spec built beside it would conflict in most of the same files.

## Scope
**In:**

### 1. The shell (`web/src/app/Layout.tsx`)
- Remove the outer `<div className="mx-auto max-w-[640px] px-4">`.
- The `<header>` spans the page. Its contents (the row and the tagline) move unchanged into
  `<PageContainer width="wide">`, as a **direct child** of `<header>`.
- `<main className="pb-8 pt-6">` spans the page, with no width or padding of its own. Each page's
  `PageContainer` is a **direct child** of `<main>` and sets both.
- The logo's `<svg stroke="#FFFFFF">` becomes `stroke="currentColor"` with `className="text-on-ink"`. `0009a`
  replaces the whole mark with the `Logo` component.
- Nothing else in the header changes: its look, brand, links and wrapping are `0009a`'s (FOLLOWUPS line 122).
- If `0009c` has landed, keep its `<SkipLink />` (first child), `<RouteFocus />` and `<main id="main"
  tabIndex={-1} …>` attributes exactly. Only the width and padding classes move.
- `ChatStreamProvider` still wraps everything.

### 2. Page widths
Every routed page renders its outermost element, **on every return path** (loading, error, not-found, success),
as `PageContainer` with the width below. A `<Navigate>` return is not wrapped.
- The page's own `mx-auto w-full max-w-[480px]` / `max-w-[640px]` classes go. Its column classes move to
  `PageContainer`'s `className`, and its element to `as`.
- A `const section = 'mx-auto flex w-full max-w-[…] flex-col gap-4'` keeps only the column classes.
- No `PageContainer` `className` may contain `mx-auto`, `w-full` or `max-w-`.
- Gutters: `px-4` (as today on a phone), `md:px-6` and `lg:px-8`, all from `PageContainer`.

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
| `/dev/kit` (dev only) | `app/KitPreview.tsx` | `0009d` mounts it outside `Layout`, in its own `<main>` with `PageContainer width="wide"` | unchanged; checked by AC4 |

The `default` pages go from 608 to 720 px of content (+112 px) on a wide screen and change nowhere else. No page
gets a new layout here: two panes, side panels and grids are the screen specs'.

Stays as it is (do not "fix"):
- `ListingWizard.tsx`'s sticky footer keeps `-mx-4 px-4`, so it stays 512 px wide from `md` up.
- `PageContainer` sets no position, overflow, z-index or transform. So `MyLikesPage`'s `relative z-10`,
  `ListingCard`'s stretched link, `SearchMap`'s `h-[60vh]` and the sticky footer behave as today.
- `ChatThreadPage` has one page return path, plus the canonical-id `<Navigate>`.

### 3. Every colour becomes a brand token
The brand names are `0009d`'s (`specs/0009-brand-amendment.md`). The app takes the brand palette, so pixels
**do** change: warm stone greys become the brand's cool greys, and the old red `#B91C1C` becomes `danger`
`#DC2626`. Only class names and SVG colour attributes change: no markup, copy, spacing, radius or arbitrary `[Npx]`
value.

**(a) Hex and `rgba()` literals:**

| Literal | Becomes |
| --- | --- |
| `#D6D3D1` | `border-border-strong`; `bg-border-strong` for the switch track |
| `#B91C1C` | `text-danger` / `border-danger`, also inside `aria-[invalid=true]:`, `peer-aria-[invalid=true]:`, `group-aria-[invalid=true]:` and `has-[[aria-invalid=true]]:` |
| `#44403C` | `text-ink-muted` |
| `#F5F5F4` | `bg-surface-subtle` |
| `#E7E5E4` | `border-border` as a border; `bg-surface-subtle` as a background (`MatchBadge`'s neutral pill, `ViewToggle`'s track) |
| `#F0EEEB` | `divide-border` |
| `#DDD6CE` | `bg-surface-subtle` (image placeholders) |
| SVG `stroke="#FFFFFF"` / `"#A8A29E"` / `"#92400E"` / `"#0B5F52"` | `stroke="currentColor"`, with `text-on-ink` / `text-ink-muted` / `text-warning` / `text-accent-strong` on the `<svg>` |
| `bg-[rgba(28,25,23,0.78)]` (the room pill on the photo) | `bg-ink`, with its `text-white` → `text-on-ink` (the brand allows one badge in the photo's corner, and no overlays) |
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

**(b) Old token names**, in every class and every variant prefix (`hover:`, `peer-checked:`, `aria-[…]:`, `has-[…]:`,
`placeholder:`, …), across `web/src` (~56 files):

| Old | New |
| --- | --- |
| `bg-bg` (`index.css`) | `bg-surface` |
| `*-muted` (`text-muted`, …) | `*-ink-muted` |
| `*-line` (`border-line`, `bg-line`, `divide-line`) | `*-border` (`border-border`, `bg-border`, `divide-border`) |
| `*-accent-tint` | `*-accent-soft` |
| `*-accent-text` | `*-accent-strong` |
| `bg-warn` | `bg-surface-subtle` |
| `text-warn-text` | `text-warning` |
| `bg-white` / `text-white` | `bg-surface` / `text-on-ink` (same pixels, brand names) |

`accent`, `ink` and `danger` keep their names; their values are already the brand's from `0009d`.

**(c) Delete the deprecated aliases** from `web/tailwind.config.ts`: `bg`, `muted`, `line`, `accent.tint`,
`accent.text` and `warn`, with their `DEPRECATED` comment. `0009d`'s `tokens.test.ts` expectation for `colors` is
updated to the brand names only.

**(d) Tests.** Every test that asserts an old class moves to the new one: `MatchBadge.test.tsx`, and any
`bg-accent-tint` / `bg-warn` / `text-warn-text` / `text-muted` assertion (`SearchPage.test.tsx`,
`ListingCard.test.tsx` and others). At build time, find them with
`grep -rnE 'accent-tint|accent-text|bg-warn|warn-text|text-muted|-line\b|#[0-9A-Fa-f]{6}' web/src --include='*.test.*'`.
Re-run the §3 greps at build time too, because the branch may have moved.

### 4. Shared components onto the kit
The props stay as they are, except `EmptyState`'s new optional `pose`, which the brand amendment asks for. Every
current call site compiles unchanged. If `0009c` / `0009g` has landed, keep every behaviour prop and effect it
added: `ErrorState`'s `page`, its promise-aware busy retry and offline text, and `Loading`. Change only the look.
- `components/ChoiceGroup.tsx`: brand tokens.
  - An option is `border border-border-strong bg-surface text-ink`.
  - Checked: `peer-checked:border-accent peer-checked:bg-accent-soft peer-checked:text-accent-strong`.
  - Invalid: `peer-aria-[invalid=true]:border-danger`. The error text is `text-danger`.
  - It exports its option label classes as `choiceSegment`, so a look-alike copy can reuse them (asked for by
    `0009k`). No check mark: FOLLOWUPS line 128 moves whole to the wizard / profile screen spec.
- `components/EmptyState.tsx`: a `Card` (`padding="md"`), with the message in `text-body text-ink-muted`.
  - A new optional `pose?: MascotPose` (from `0009d`'s `Mascot`) renders `<Mascot pose={pose} width={120} />`
    above the message. The card is then `flex flex-col items-center gap-3 py-8 text-center` (the brand's
    `space-8` around the mascot).
  - Without `pose`, it renders as today. Every current caller passes none; screen specs choose the poses and
    write the brand's "invitation" copy.
- `components/ErrorState.tsx`: a `Card` with `role="alert"`, the `common.error` text, and the retry as
  `<Button shape="pill">` (`primary`, `md`).
  - `primary` is now `ink` with the accent focus ring (`0009d`). `0009c`'s ink-ring rule applies only to controls
    filled with accent, so it does not hit this button.
  - If `0009g` has made the retry promise-aware, its pending state uses `Button`'s `busy`, not `disabled`.
- `components/Skeleton.tsx`:
  - Exactly one `data-testid="skeleton"` per `Skeleton`, on its outer `aria-hidden` element.
  - The default block is `<Card padding="none">` with `px-4 py-3.5` (54 px tall).
  - The bars are `bg-border` with `motion-reduce:animate-none`.
  - The `className` branch stays a plain bar.
- `components/Switch.tsx`: a `bg-border-strong` track (`peer-checked:bg-accent`), a `bg-surface shadow-thumb`
  thumb and a `text-body` label.
- `components/map/MapCanvas.tsx`: the class swaps of §3 only (`border-border-strong`, `shadow-pin`, `bg-surface`,
  `text-on-ink`).
- Tests:
  - Each of the five top-level components has its own `web/src/components/__tests__/<Name>.test.tsx`.
  - `0009d`'s `coverage.test.ts` changes from its constant list to **every** `web/src/components/*.tsx`. Any
    component without a test file at build time gets a minimal test in this PR. For example, `SkipLink` and
    `Loading`, if `0009c` has merged.

### 5. Guards
- `web/src/app/__tests__/noColourLiterals.test.ts` reads every `web/src/**/*.{ts,tsx,css}` file. It excludes
  `__tests__/`, `test-setup.ts` and the generated `api/`. SVG files are not read. It flags:
  - a hex colour (`/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/`);
  - an `rgb(` / `rgba(` / `hsl(` / `hsla(`;
  - an old token class: `/(?:^|[\s"'`:])(?:[a-z-]+:)*(?:bg|text|border|divide|ring|outline|fill|stroke|placeholder|decoration|from|to|via)-(?:bg|muted|line|warn|warn-text|accent-tint|accent-text)\b/`
    (`text-ink-muted` is not matched);
  - a `max-w-[480px]` / `max-w-[640px]` literal.
- It collects every hit and fails once, with the full `file:line` list.

### 6. FOLLOWUPS
The build ticks line 34, line 127 and the colour half of line 43 (the radius half stays for the screen specs).
Line 128 is not this spec's.

**Out:**
- The header's look, brand, the `Logo` in the header and the links (`0009a`). The skip link, landmarks and the
  shared components' behaviour (`0009c`, `0009g`).
- A new layout for any screen (`0009i`, `0009l`, and the other 9b specs).
- Choosing mascot poses and writing empty-state copy: the screen specs. This spec only adds `pose`.
- Other new props on the shared components: `EmptyState` `action`, `ErrorState` `message` and a `ChoiceGroup`
  check mark.
- Arbitrary `[Npx]` / radius classes, Tailwind's default `xs`–`3xl` font sizes, and moving screens to `Button` /
  `Card` / `Field`: the screen specs.
- The PWA colours in `vite.config.ts` / `index.html` (`0009a`).

**New dependencies:** none.

## Data
None (web only).

## API
None.

## UI
Every screen keeps its content, copy and states. Loading (`Skeleton`), empty (`EmptyState`), error (`ErrorState`)
and success render as today, with four changes:
- the width (table above) and the `md:` / `lg:` gutters;
- the brand palette everywhere: a white page, ink text and primary actions, the brand's greys and borders, blue
  accents, and `danger` red;
- the restyled shared components: a `Card` for empty and error, an ink pill for retry, and blue checked choices;
- the guards' pending and error states sit in the `default` column.

No i18n key is added or changed. RTL: `PageContainer`'s gutters are symmetric `px-`, and the mascot is never
flipped.

The UX reviewer checks each route at 390 px and 1280 px for:
- width and centring;
- readable contrast in the new palette (`ink-muted` 6.1:1, `accent` 5.2:1 on `surface`);
- where `surface-subtle` replaced amber (the "differs" chips), that the words still carry the status.

## Acceptance criteria
- [ ] AC1 Given `web/src` after the swap, Then none of the following remains outside the excluded paths, and on
  failure the test lists every `file:line` at once:
  - a hex colour (3, 4, 6 or 8 digits);
  - an `rgb(` / `rgba(` / `hsl(` / `hsla(`;
  - an old token class (`bg-bg`, `*-muted` without `ink-`, `*-line`, `*-warn`, `*-warn-text`, `*-accent-tint`,
    `*-accent-text`);
  - a `max-w-[480px]` / `max-w-[640px]` literal.

  — `web/src/app/__tests__/noColourLiterals.test.ts::ac1_no_colour_literals_in_src`
- [ ] AC2 `web/tailwind.config.ts` has no `bg`, `muted`, `line`, `warn` or `accent.tint` / `accent.text` key, and
  `0009d`'s `tokens.test.ts::ac1_token_scale` passes with the brand-only `colors`. `MatchBadge.test.tsx` and every
  other test that asserted an old class pass with the new ones, and the rest of the suite passes unchanged. —
  `tokens.test.ts` (updated), `MatchBadge.test.tsx` (updated) and `make test`
- [ ] AC3 Given `AppRoutes` rendered at `/login` with `features/auth/__tests__/harness.tsx` (`renderRoutes` +
  `mockApi`: `GET /me` 401, `GET /areas` `[]`), Then:
  - the header's direct child has `max-w-wide` and holds the row and the tagline;
  - `<main>`'s direct child is the page's `PageContainer` (`max-w-narrow`);
  - `<main>` has no `max-w-*` / `px-*`;
  - no element has `max-w-[640px]`.

  And given a protected route while `GET /me` is pending, the guard's skeleton has a closest `.max-w-page`. `0009a`
  later deletes this test's tagline clause. — `web/src/app/__tests__/Layout.test.tsx::ac3_full_width_shell`
- [ ] AC4 Static source check: a constant maps each page file in the §2 table, the three guards and
  `app/KitPreview.tsx` to its width. Then:
  - (a) each file has at least one `<PageContainer`, and every `/\bwidth="(narrow|default|wide)"/` match equals its
    width (`default` may be absent);
  - (b) the constant's page keys equal the components imported from `../features/` in `app/routes.tsx` (minus the
    guards) plus `KitPreview`;
  - (c) no `PageContainer` `className` (a literal, or the `const section` it uses) contains `mx-auto`, `w-full` or
    `max-w-`.

  — `web/src/app/__tests__/pageWidths.test.ts::ac4_page_roots_use_page_container`
- [ ] AC5 The shared components:
  - `ChoiceGroup`:
    - with `error`, every radio is `aria-invalid` and the error has `role="alert"`;
    - an option's label carries the `choiceSegment` classes, including `peer-checked:bg-accent-soft`;
  - `EmptyState`:
    - without `pose`, it renders its message in a `Card` and no `<img>`;
    - with `pose="sleep"`, it renders the sleep mascot `<img>` (120 px, `alt=""`) above the message, centred;
  - `ErrorState`:
    - it has `role="alert"`, and its retry calls `onRetry`;
    - the retry's classes include `bg-ink`, `rounded-full` and `focus-visible:outline-accent`;
  - `Skeleton` renders exactly one `aria-hidden` `data-testid="skeleton"`, and its bars carry `bg-border` and
    `motion-reduce:animate-none`;
  - `Switch` has `role="switch"`, and clicking the label toggles it;
  - `coverage.test.ts` passes over every `src/components/*.tsx`.

  — `ChoiceGroup.test.tsx::ac5_error_marks_radios`, `EmptyState.test.tsx::ac5_message_and_pose`,
  `ErrorState.test.tsx::ac5_retry_ink_pill`, `Skeleton.test.tsx::ac5_one_hidden_skeleton`,
  `Switch.test.tsx::ac5_switch_toggles`, `coverage.test.ts::ac10_every_kit_component_has_a_test` (widened)
- [ ] AC6 E2E at 1280×800 (no sign-up). Locators: `page.locator('header > .max-w-wide')`,
  `page.locator('main > .max-w-narrow')` and `page.locator('main > .max-w-page')`, each `toHaveCount(1)`. A width is
  `getComputedStyle(el).width`. "Centred" means the left and right offsets differ by ≤ 1 px. Then:
  - `/login`'s container is 480 px and centred;
  - `/listings/00000000-0000-4000-8000-000000000000` (public, not found) is 720 px and centred;
  - the header's container is `Math.min(1336, clientWidth − 64)` px wide, and at 1600×900 it is 1336 px and
    centred;
  - `body`'s computed background is `rgb(255, 255, 255)` (`surface`).

  A screen spec that changes a measured page's width updates this test. — `web/e2e/layout.spec.ts::ac6_desktop_widths`
- [ ] AC7 E2E at 390×844 on `/login`, `/signup` and `/listings/00000000-0000-4000-8000-000000000000`: no
  horizontal scroll, and the page container's computed `padding-left` and `padding-right` are 16 px. —
  `web/e2e/layout.spec.ts::ac7_mobile_gutters`
- [ ] NF1 `make lint`, `make test`, `make i18n-check` and `make build-web` are green, and local `make e2e` is green
  on the final head (Speed rule 7). The result goes in the digest. `map.spec.ts` and `0009d`'s `kit.spec.ts` must
  still pass.

## Tests to write
- Unit:
  - `noColourLiterals.test.ts` (AC1), `Layout.test.tsx` (AC3), `pageWidths.test.ts` (AC4) and the five component
    tests (AC5);
  - the widened `coverage.test.ts`, the updated `tokens.test.ts`, and every test whose class assertions move
    (AC2).
- `Layout.test.tsx` and `ErrorState.test.tsx` are also created by `0009c` / `0009g`. Create the file, or add this
  spec's `it` to it. Never drop or replace another spec's cases.
- E2E: `web/e2e/layout.spec.ts` (AC6, AC7). Public pages only.

## Risks / open questions
- **Merge order with `0009a`, `0009b`, `0009c` and `0009g`.**
  - Shared lines: the header (`0009a`), the wording near renamed classes (`0009b`), the skip link and `<main>`
    (`0009c`), `ErrorState` (`0009c`'s `page`; `0009g`'s busy retry and offline text) and `Loading` (`0009c`).
  - The second to merge rebases, keeps every behaviour prop that has landed and changes only the look.
  - The rename is class-only, so conflicts are line-local. A spec that lands after this one must use the brand
    names: AC1's guard fails on any old name.
- **For the orchestrator:**
  - `0009g` AC4 should make the pending retry `Button`'s `busy`;
  - `0009c` should add `SkipLink.test.tsx` and `Loading.test.tsx` if this spec has merged first;
  - `0009c` §3's ink-ring rule now applies only to accent-filled controls. Primary buttons are ink. Map pins
    (`MapCanvas`) are accent-filled when selected, so `0009c` judges that ring.
- **The palette really changes.**
  - Amber "differs" / "new" become `surface-subtle` with `warning` text, or the accent badge. The words carry the
    status, as the brand requires.
  - The UX reviewer checks every screen. Anything unreadable is fixed here, inside §3's mapping (a different brand
    token), never with a hex literal.
- **608 → 720 px.** The `default` columns widen by 112 px on desktop. The UX reviewer judges it at 1280 px; a page
  that looks worse still stays at `default`, and its screen spec fixes it.
- **AC4 is a source check.** It cannot prove every return path is wrapped. AC3 / AC6 / AC7 measure, and the code
  reviewer checks the rest.
- **The colour-literal regex** could hit a non-colour `#abc` string (none exist today). Reword the string; never
  exclude a file.
- **Product questions for Gilad:** none.
- **Verification.** Spec-verifier round 1 rejected with 6 majors and 10 minors, and all are applied:
  - guards and `/dev/kit` in the table;
  - the retry's focus ring;
  - `ErrorState` / `EmptyState` keep their props;
  - the coverage test gap closed at build time;
  - e2e locators, and a 720 px page that `0009i` does not change;
  - 608 px, not 640;
  - the `aria-[invalid=true]:` prefix;
  - AC4 rebuilt from `routes.tsx`;
  - a wider colour guard;
  - the `Skeleton` contract;
  - the check mark moved out;
  - the harness named;
  - the "stays as it is" list;
  - coder Opus/medium.

  The second round is waived (one verifier round, Gilad).
- **Brand amendment (orchestrator, 2026-11-12),** applied without re-verification as instructed:
  - the §3 mapping now targets the brand names;
  - the old token names are renamed and `0009d`'s aliases deleted;
  - the guard also catches old names;
  - `EmptyState` `pose`;
  - the retry is an ink pill with the accent ring;
  - the brand-token Skeleton, Switch and ChoiceGroup;
  - the e2e checks the white page.

## Digest (filled by orchestrator after verification)
See `/digest`.
