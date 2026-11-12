---
id: 0009j
title: The listing page looks like Listing.dc.html on a phone — a photo band, the price and match badge, an icon facts grid, the sections as cards and a sticky apply bar — and on a desktop puts the same content in a main column beside a sticky column with the like and apply blocks
status: done
depends_on: [0009d, 0009h, 0009i]   # 0009d: tokens and the kit (PageContainer, BackLink, Button, Card, Tag, Field + Textarea); 0009h: shell, page roots, the hex swap of every file here; 0009i: features/listings/facts.ts (FOLLOWUPS 42), MatchBadge's size, the `make screens` harness (its AC10), and the 390 px pin of search.spec.ts this spec's e2e step extends
reviewers: [ux]   # quick route (Gilad 2026-11-12: a cosmetic, behaviour-unchanged spec gets one ux review; coder Sonnet/high). The spec session also greps its diff for raw-HTML rendering (dangerouslySetInnerHTML / innerHTML / linkify) and runs lint, test and e2e. Was: reviewers: [code, qa, ux]
estimate: 1 coder run (upper end, ~4 h)   # coder Opus/medium: styling of ~10 components plus one new phone control, with the room-privacy rule as a guard (Speed rule 6, "when in doubt, the stronger one")
---

> **Brand kit amendment (orchestrator, 2026-11-12, no verifier re-run):** `design/brand/` (README.md, tokens.json) wins over the artboards and over any older wording below for colour, type (Fredoka for display/h1/h2, Rubik for the rest), radii, no card shadows, the name homie / הומי, the mascot and the voice (no slash forms: plural, infinitive or noun; action-noun buttons; errors say "what happened. what to do."). Token and kit names are those of 0009d. Where this spec still names a teal token, Heebo or a slash form, the builder applies the brand equivalent.

## Goal
After this ships, `/listings/:id` fills the screen and matches `design/screens-v1/Listing.dc.html`.
- **On a phone** (below 1024 px, checked at 390 px) it shows, in order:
  - a full-width photo band (a placeholder until `0002c`);
  - the price with the match badge, the title and the facts line;
  - a three-column facts grid with an icon per fact;
  - the description;
  - the location;
  - "מה בעל הדירה מחפש" and "ההתאמה שלך" as cards;
  - then the like and apply blocks.

  While the action block is below the screen, a sticky bottom bar offers the apply button
  (`applications.apply`); it jumps to the section.
- **On a desktop** (1024 px and up, checked at 1440 px) there is no desktop artboard, so this layout is designed in
  the artboard's language:
  - the photo band spans the page;
  - below it a main column holds the same sections;
  - a sticky 24 rem column at the inline end holds the like block and the apply card, so the action stays in view
    while reading.

Behaviour, requests, copy and **who sees what** are unchanged. In particular, per PRODUCT.md "Rooms", a room's
flatmate ages and questionnaire answers still show only to a signed-in seeker. This serves the Product Plan's
screen 6 (Listing page) and `specs/FOLLOWUPS.md` lines 43, 45 and 53 (the listing page's parts). It is
Slice 9b (Gilad, 2026-11-12).

## Scope
**In** (paths under `web/src/`):
- `features/listings/ListingPage.tsx`: the layout below ("UI").
  - It uses `PageContainer width="wide"` on every return path. 0009h sets `default`; the two-column desktop
    layout needs the width. This spec changes the page's row in 0009h's `web/src/app/__tests__/pageWidths.test.ts`
    to `wide`.
  - It also changes `web/e2e/layout.spec.ts`, which measures `/listings/00000000-0000-4000-8000-000000000000`:
    - `ac6_desktop_widths`: that URL's check becomes `page.locator('main > .max-w-wide')` with `toHaveCount(1)`,
      `Math.min(1336, clientWidth - 64)` px wide and centred (the 720 px check is dropped, not moved);
    - `ac7_mobile_gutters`: if its locator for that URL is `.max-w-page`, it becomes `.max-w-wide`; the 16 px
      padding assertions stay.
  - The back link is the kit's `BackLink` (`{ to: '/search', label: t('listing.backToSearch') }`), FOLLOWUPS 53.
  - The description paragraph is `max-w-prose`, so lines stay readable in the wide main column.
  - The success state is one `<article>` (`flex flex-col gap-5`, a grid from `lg`, see "Desktop") holding, in
    DOM order:
    - the photo band;
    - `<div data-testid="listing-main">`, with the title block, `ListingFacts`, `RoomFacts` (rooms),
      the description, the location, `OwnerPreferences` and `MatchCard`, in today's order;
    - `<div data-testid="listing-actions">` (`flex flex-col gap-5`), with the like block (or `MutualBanner`) and
      `ApplySection` inside a `Card` (`padding="md"`).
  - Loading, error and not-found keep their branches (0009c / 0009g own their content). Only the skeleton's
    shapes follow the new layout.
- `features/listings/ApplyBar.tsx` (new): the phone's sticky bar. See "The apply bar".
- `features/listings/factIcons.tsx` (new): eight decorative 24 px outline SVG icons, `aria-hidden`, drawn with
  `stroke="currentColor"`, `strokeWidth` 1.75, round caps and joins, no fill (the brand's icon rule):
  - six from `Listing.dc.html`'s facts grid (elevator, parking, furnished, pets, arnona, vaad);
  - two for the room facts: a person (Search.dc.html's profile icon) for "העדפת מגדר", and the vaad people icon
    for "שותפים בדירה".
  These are icons, not UI components.
- `features/listings/ListingFacts.tsx`, `features/rooms/RoomFacts.tsx`:
  - the artboard's fact cells, three columns (six from `xl`), an icon inside each `<dt>`;
  - the `dl` / `dt` / `dd` structure, the order of rows, `data-testid="room-facts"` / `"room-lifestyle"` and the
    rule "render only what the response holds" are unchanged.
- `features/listings/OwnerPreferences.tsx`: a `Card` with neutral `Tag`s inside the same `<ul>` / `<li>`. It
  also renders in the wizard preview (0009k), which gets the same look.
- `features/match/MatchCard.tsx`, `features/match/icons.tsx`: `Card` (`variant="selected"` for a high score),
  tokens, icons in `currentColor`. Same structure and copy.
- `features/applications/ApplySection.tsx`, `ProfileGate.tsx`, `features/rooms/RoomGate.tsx`:
  - kit `Button` (`primary` / `secondary`, `size="lg"`, `fullWidth` where they are full width today, `to` where
    they are links). A control that is `disabled` today (the submit while sending) stays `disabled` with
    `aria-busy`, not the kit's `busy`, because the tests pin `disabled`;
  - `Field` + `Textarea` for the message, keeping every id, `aria-describedby`, the counter's conditional
    `aria-live` and the `role="alert"` errors. `Field` gets `id={fieldId}`, `label`, `hint` and the field error
    (`error`); the counter and the server error stay siblings after it, and their ids go in the `Textarea`'s own
    `aria-describedby`, which `Field` appends after its hint and error ids (the tests read it with `toContain`);
  - an accent `Tag` for "התאמה הדדית";
  - `ApplySection` gains `headingRef?: Ref<HTMLHeadingElement>`, and its `<h2>` gets `tabIndex={-1}`, so the
    apply bar can move focus there.
  No branch of the state logic changes. 0009g's draft props, if merged, are kept.
- `features/likes/LikeRoomButton.tsx`, `features/likes/MutualBanner.tsx`: kit `Button` (`variant="secondary"`
  idle and `"soft"` pressed, with `aria-pressed`, `disabled` while its request runs as today); `MutualBanner` is a
  `rounded-lg bg-accent-soft p-4` box with its line in `text-body font-semibold text-accent-strong` and its link a
  primary `Button` link; the lines and errors use `text-accent-strong` / `text-danger`. They also render on `/me/likes`, which gets the same look.
- Tests and e2e: see "Tests to write". Visual states: AC9.

**Out:**
- Artboard elements with nothing behind them in the product:
  - the photo gallery's pictures, its "1 / 12" counter and the thumbnail strip (no photos before `0002c`);
  - the share button (not built);
  - the gallery's save heart (likes are rooms-only and live in the action block, PRODUCT.md "People & likes");
  - the owner's avatar, name and "מאומתת בטלפון" line (the public listing shows no owner identity, PRODUCT.md
    "Search"; verification badges are Slice 10);
  - the "הכנסה יציבה" chip (no such preference);
  - the "4 דק׳ לרכבת הקלה" places line (no data);
  - the artboard's tour button (tours are a chat composer chip, PRODUCT.md "Chat").
- The location hint as a pill on the map: the hint stays a text line under the map, because it must show when the
  map fails or there are no coordinates.
- Owned by other specs:
  - the not-found link (FOLLOWUPS 46, 0009g);
  - the one-`<h1>` and loading rules, the focus rules and the small map's `aria-hidden` (0009c);
  - every wording change (0009b);
  - `ApplicationStatusChip`'s look (shared with the inbox and "my applications"; it gets tokens with those
    screens);
  - the shell's header and footer (0009a / 0009d).

**New dependencies:** none.

## Data
None (web only).

## API
None changed. It consumes `GET /listings/{id}` (`ListingDetail`), `GET /me`, `GET /me/applications` and
`GET /me/profile` exactly as today. The apply bar reads the same `useMe` / `useMyApplications` queries
`ApplySection` already makes (same keys, so no new request).

## UI
Artboard: `design/screens-v1/Listing.dc.html` (phone only). The coder reads it for structure; the ux reviewer
compares the screenshots (AC9) element by element using the table below. "Today" means `8c3c480`.

### Tokens and the allowed arbitrary values
- 0009h has already swapped every colour in these files to the brand tokens of 0009d / `specs/0009-brand-amendment.md`
  (`surface`, `surface-subtle`, `ink`, `ink-muted`, `on-ink`, `accent`, `accent-strong`, `accent-soft`, `border`,
  `border-strong`, `warning`, `danger`, SVG `currentColor`), and deleted the old names. This spec uses only those
  names, adds no colour literal, and 0009h's `noColourLiterals.test.ts` keeps it that way.
- Brand rules that apply here: primary buttons are `ink` (`Button variant="primary"`); no shadows on cards;
  interface icons are outline in `ink` / `ink-muted`; accent text only on `surface`, `accent-strong` on
  `accent-soft`; Fredoka (`font-display`) only with `text-h2` / `text-h1`.
- What is left is the size half (FOLLOWUPS 43's radius half for this page). Each `rounded-[14px]` /
  `rounded-[18px]` / `rounded-2xl` / `text-[15px]` / `text-[17px]` / `text-[13px]` / `text-[30px]` /
  `min-h-[44px]` / `min-h-[52px]` / `h-[52px]` / `border-[1.5px]` / `px-[10px]` / `tracking-[…]`-style class
  becomes the brand scale's step (0009d):
  - radii: `rounded-md` (12, buttons and inputs), `rounded-lg` (16, cards, cells, the map, the band), `rounded-full`
    (chips and badges);
  - type: `text-caption` (12), `text-body-sm` (14), `text-label` (14, weight 500), `text-body` (16), `text-h3` (18),
    `text-h2` (24), `text-h1` (32); each carries its line height, so no `leading-*` is added;
  - sizes: `min-h-tap` (44), `min-h-13` / `h-13` (52);
  - borders: `border` (1 px); the selected match card's 2 px accent edge is `Card variant="selected"`'s ring;
  - the nearest spacing step; tracking classes are dropped.
- Arbitrary values only where no token fits, each with a one-line comment:
  - `lg:grid-cols-[minmax(0,1fr)_24rem]`: the main column and the 24 rem action column;
  - `lg:max-h-[calc(100vh-3rem)]`: the sticky action column fits the viewport, with `lg:overflow-y-auto`;
  - `pb-[max(0.75rem,env(safe-area-inset-bottom))]`: the apply bar clears the iPhone home indicator.

### Phone (below `lg`), against `Listing.dc.html`
| Artboard element | Today | This spec |
| --- | --- | --- |
| Gallery: 280 px, edge to edge; round back button over it (inline start); share and save buttons (inline end); "1 / 12" | A 200 px rounded placeholder under a text back link | The back link stays **above** the band: the kit's `BackLink` (`listing.backToSearch`, to `/search`). It must exist in the loading and error states too, where there is no band. The band is a placeholder `h-40` (160 px), edge to edge: `-mx-4 md:-mx-6` (the container's gutters below `lg`), no radius. It has `bg-surface-subtle` (the brand's image placeholder) and a 48 px outline icon in `text-ink-muted`. The full 280 px gallery and its controls come with photos (`0002c`), FOLLOWUPS 45. Share, save and the counter are Out. |
| Thumbnail strip | — | Out (no photos). |
| Price 30 px weight 800, "/ חודש" 14 px muted; badge pill 14 px at the row's end | Same, with literal sizes | The price is `text-h2 font-bold` in Rubik (no `font-display`: it is not a heading), `/ חודש` is `text-body-sm text-ink-muted`, `MatchBadge` (as 0009i leaves it) at the row's end. The badge's parent still holds the price (`ac8_match_card` asserts it). |
| `<h1>` 20 px weight 700 | `text-xl font-bold` | `font-display text-h2 break-words` (the brand's h2 style, as 0009d's `PageHeader` title on a phone; Fredoka never below 24 px). |
| Meta line 14 px muted: "4 חדרים · קומה 3 מתוך 5 · 95 מ״ר · כניסה 1.1.27" | floor · m² · entry · flexible | The same items through 0009i's `floorFact` / `sizeFact` / `entryFact`, plus `entryFlexible`. Rooms stay only in the `<h1>` (no duplicate). |
| Facts grid: 3 columns, 10 px gap, white cards with a 14 px radius, a 22 px icon in accent text, a 12 px muted label, a 14 px bold value | 2 columns (3 from `sm`), no icons | `grid-cols-3 gap-2.5`, and `xl:grid-cols-6` on the desktop's wide main column. Each cell is a `Card` (`as="div"`, `padding="sm"`; a `dl` may hold `div`s) with the layout-only `className` `flex flex-col items-center gap-1.5 text-center`: the brand's `rounded-lg` bordered card, no shadow. The `<dt>` is a column holding the icon (`text-ink`, the brand's icon colour, not the artboard's accent) and the label (`text-caption text-ink-muted`); the `<dd>` is the value (`text-body-sm font-bold`). The `<dt>` is followed directly by its `<dd>`, as the tests read them. |
| — | "על החדר" (rooms) | Same cards: "העדפת מגדר" with the person icon and "שותפים בדירה" with the people icon, in `grid-cols-3`. The lifestyle list ("אורח החיים בדירה") is a plain `dl`: `rounded-lg border border-border bg-surface divide-y divide-border`; its "אורח החיים בדירה" `<h3>` is `text-body font-medium`, its rows `text-body-sm` (topic `text-ink-muted`, answer `font-bold`). It is not a `Card`, because `Card` cannot render as a `dl` and its `className` adds no colour (the dividers). Only what the response holds renders (privacy, AC5). |
| "על הדירה": `<h2>` 17 px weight 800, paragraph 15 px / 1.55 in `#44403C` | Same, with the hex | Every section `<h2>` on the page (description, location, `RoomFacts`, `OwnerPreferences`, `MatchCard`, `ApplySection`) is `text-h3 font-semibold` in Rubik (Fredoka never below 24 px; 0009d's `Dialog` sets the same precedent). The paragraph is `text-body text-ink max-w-prose` (body text is `ink` in the brand), `whitespace-pre-line break-words` as today. |
| "מיקום": 150 px map with a 16 px radius, an overlay pill with the area and the hint, a places line | 150 px map, then the address line and the hint | Map `h-40` (160 px), `rounded-lg`, `border border-border`. The address (`text-body font-medium`) and the hint (`text-body-sm text-ink-muted`) stay as lines under it. The pill and the places line are Out. |
| "מה בעל הדירה מחפש": a card with the owner's avatar, name and verified line, then chips with the muted fill and `line` border | Chips in a bordered box | A `Card` (`padding="md"`) whose `<ul>` holds `Tag as="li" tone="neutral"` chips. No owner identity (Out). |
| "ההתאמה שלך": a card with a 1.5 px accent border, a 64 px ring (accent border, tint fill, 19 px weight 800), label and basis, lines with a 24 px tick or "!" | Same, with hex for good / partial | `Card variant="selected"` when `bucket` is `high`, else `default`. The ring is `size-16 border-4` with the score in `text-h3 font-bold`: high uses `border-accent bg-accent-soft text-accent-strong`; otherwise `border-border-strong bg-surface-subtle text-ink`. The bucket label is `text-body font-semibold`, the basis `text-caption text-ink-muted`. Lines are `text-body-sm`, the differ line in `text-ink-muted` (its "!" icon and words carry the status). The icons are `AgreeIcon` / `DifferIcon` in `currentColor`. "עריכת הפרופיל" is a ghost `Button` link with the same href. |
| Sticky action bar: the apply button (accent, 52 px, flex 1.4) and the tour button (outline) | The apply section inline at the end; nothing sticky | `ApplyBar` (below) holds only the apply button (`applications.apply`, an `ink` primary per the brand); the tour button is Out. The full `ApplySection` stays at the end, in a `Card`. |
| — | Like button and hint, the "liked you" line, `MutualBanner` | First in `listing-actions`, above the apply card, restyled (see "In"). |

### Desktop (`lg` and up, checked at 1440 px): designed in the artboard's language
- The back link, then the photo band across the container (`lg:mx-0 lg:h-64 lg:rounded-lg`, inside the gutters).
- Below the band, the `article` is a grid: `lg:grid lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-x-10 lg:gap-y-6`. The
  band spans both columns (`lg:col-span-2`).
- `listing-main` is in the first column, at the inline start (right in RTL):
  - the `<h1>` steps up to `lg:text-h1`;
  - the facts grid is six columns from `xl` (one row for six facts);
  - the map is `lg:h-60`.
- `listing-actions` is in the second column, at the inline end (left), with
  `lg:sticky lg:top-6 lg:self-start lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto lg:p-1`. The `p-1` keeps the
  focus rings of its controls inside the scroll box (0009c's "focus never obscured").
- No apply bar (`lg:hidden`).
- With `PageContainer width="wide"` (`max-w-wide`, 1336 px), the main column at 1440 px is about 900 px and the
  action column 384 px. At 1024 px they are about 530 px and 384 px.

### The apply bar (phone only)
`ApplyBar({ listing, target, headingRef })`, rendered by `ListingPage` after the `article`.
- **Who sees it:**
  - shown when `me.data === null` (a visitor);
  - or when the caller is a seeker whose `useMyApplications` list has loaded with no application to this
    listing other than `withdrawn`, and `listing.room_fit !== false`. This covers the profile and room gates:
    the section shows them.
  - never for an owner, while `me` or the list is pending, or when either failed.
- **When:**
  - only while an `IntersectionObserver` on `target` (`listing-actions`), with `rootMargin: '0px 0px -96px 0px'`,
    reports it below the viewport: `!entry.isIntersecting && entry.boundingClientRect.top > 0`. Scrolled past it
    (into the footer), the bar does not show, so it never covers the footer;
  - nothing renders before the observer's first callback, or when `IntersectionObserver` is missing (jsdom), so
    the existing component tests see no extra button.
- **What:**
  - a `div` with `data-sticky-footer` (0009c's `scroll-padding-bottom` rule; if 0009c has not merged, add that one
    rule to `app/index.css` as 0009c words it) and `data-testid="apply-bar"`;
  - `fixed inset-x-0 bottom-0 z-30 bg-surface border-t border-border px-4 pt-3` plus the safe-area padding, and
    `lg:hidden`. `z-30` is 0009a's tab-bar layer: above MapLibre's controls, below 0009c's skip link (`z-50`).
    `bottom-0` is right, because 0009a hides its bottom tab bar below `lg` on `/listings/:id` (a focused route,
    for this bar); without 0009a there is no tab bar;
  - inside it, one `Button variant="primary" size="lg" fullWidth` with `applications.apply`.
- **Click:**
  - `target.current.scrollIntoView({ block: 'start' })`, which is instant and so respects reduced motion;
  - then `headingRef.current.focus({ preventScroll: true })`, the apply section's `<h2>`.
  - The section is then in view, so the bar unmounts. Focus is already on the heading, never on `<body>`.

### States
These are unchanged, with shapes in the new layout:
- loading: a band-shaped skeleton, three lines, and a block for the action column at `lg`;
- error and not-found (with 0009g's link);
- the apply section's own states: visitor, owner, seeker form, gates, applied, misfit, errors.

### RTL
- Logical classes only.
- The main column is the grid's first column (inline start).
- The back chevron is `BackLink`'s (0009d): `M9 6l6 6-6 6`, pointing to the inline start (right) in RTL, as
  today, and turned by `ltr:rotate-180`.
- The phone band's negative margins are `-mx-*`, which are symmetric, so they need no logical form.
- The bar's padding is logical.

### i18n keys
None added; the bar reuses `applications.apply`.

## Acceptance criteria
- [ ] AC1 Structure. Given a seeker on an apartment with a minimum contract and a `match`, Then:
  - the `article` holds `listing-main` and then `listing-actions`;
  - inside `listing-main`, the location section, `OwnerPreferences` and `MatchCard` are consecutive siblings, as
    today;
  - `MatchCard` precedes the apply region in document order;
  - the apply region is inside `listing-actions`;
  - the badge's parent holds the price.

  `ac8_match_card`'s `section.nextElementSibling === apply` line is replaced by `actions.contains(apply)`; its
  existing `compareDocumentPosition` order check and its other sibling checks stay. — `web/src/features/listings/__tests__/ListingPage.test.tsx::ac8_match_card`
  (updated) and `::ac1_layout_columns`
- [ ] AC2 Facts grid. Given an apartment with arnona and vaad, Then `facts()` (the existing helper) returns the
  same label/value pairs as today, and every `<dt>` holds one `svg[aria-hidden="true"]`. A room's `room-facts`
  rows are unchanged and each `<dt>` has its icon. — `ListingPage.test.tsx::ac7_public_listing_page` (one
  assertion added) and `::ac7_room_facts_and_lifestyle` (one assertion added)
- [ ] AC3 Apply bar. With `IntersectionObserver` stubbed (the bar's phone-only rule is the CSS `lg:hidden`, so no
  `matchMedia` is needed), and the observer reporting `listing-actions` below the viewport (`isIntersecting: false`,
  `boundingClientRect.top` > 0):
  - a visitor sees `apply-bar` with one button named `he.applications.apply`;
  - clicking it calls `scrollIntoView` on `listing-actions` and focuses the `<h2>` named
    `he.applications.heading`;
  - reporting it on screen (`isIntersecting: true`) removes the bar, and so does reporting it above the viewport
    (`isIntersecting: false`, `boundingClientRect.top` < 0).

  The tests name copy by its `he.json` key, never by literal Hebrew, so 0009b's wording pass does not break them.

  These callers get no bar: a seeker with a `submitted` application; a seeker on a room with `room_fit: false`;
  an owner; a seeker whose `GET /me/applications` is pending. A seeker with no application and no profile does get
  it (the section shows the profile gate).

  With no `IntersectionObserver` there is no bar, and the existing tests stay green.

  — `ListingPage.test.tsx::ac3_apply_bar`
- [ ] AC4 Kit and tokens:
  - `ApplySection`'s apply, submit, cancel, login and signup controls keep their roles, names, `aria-expanded` /
    `aria-controls` / `aria-busy` / `disabled` and ids;
  - `LikeRoomButton` keeps `aria-pressed` and its disabled-while-pending behaviour.

  Every existing `ApplySection.test.tsx`, `ListingPage.test.tsx` and `MyLikesPage.test.tsx` case passes with no
  change other than AC1's, AC2's and class assertions that move to the brand classes. — the existing suites
- [ ] AC5 Who sees what is unchanged.
  - Given `GET /listings/R` for a women-only room answering `flatmate_ages: []` and `lifestyle: {}`, rendered:
    - for a visitor;
    - for the room's owner, with `['me', 'listings']` pre-seeded with the same room holding `flatmate_ages:
      [27, 30]` and two answers,
    Then neither shows "27", "30" or the "אורח החיים בדירה" heading.
  - Given a seeker and the response with ages and answers, both show, in `room-facts` and `room-lifestyle`.

  — `ListingPage.test.tsx::ac5_room_privacy_unchanged`
- [ ] AC6 E2E, desktop and phone, reusing `applications.spec.ts`'s seeker. A last `test.step('0009j the listing
  page on a desktop and a phone')` in `ac9_fill_profile_apply_withdraw`, after the `ac13` step, while the seeker is
  a woman on the room with the apply button shown.
  - The apply region is `page.getByRole('region', { name: he.applications.heading })`; the bar's button is
    `page.getByTestId('apply-bar').getByRole('button', { name: he.applications.apply })`.
  - At 1440×900 (`page.setViewportSize`) on `/listings/${roomId}`:
    - the apply region's box lies left of the `<h1>`'s box (`apply.x + apply.width <= h1.x + 1`);
    - after `window.scrollTo(0, document.body.scrollHeight)`, the apply region's box still intersects the
      viewport (`box.y < 900 && box.y + box.height > 0`), because it is sticky;
    - `scrollWidth <= innerWidth`;
    - `apply-bar` has count 0.
  - At 390×844 on the same page, from the top:
    - `apply-bar` is visible;
    - clicking its button focuses the region's `<h2>` (`he.applications.heading`), and the region is in the
      viewport;
    - then `apply-bar` has count 0;
    - `scrollWidth <= innerWidth`.

  — `web/e2e/applications.spec.ts::ac9_fill_profile_apply_withdraw`
  **Moved (spec session, 2026-11-12, after PR CI):** `ac9` sits at 16–21 s on CI and timed out at 30 s on slow
  runners (0009u's PR failed it too, without this step), so the step lives in `search.spec.ts::ac9` instead,
  after AC7's step, as that test's visitor on the room page: the visitor's apply region (count and log-in link)
  and the bar (offered to a visitor) carry the same layout, sticky, focus and overflow checks. Zero new sign-ups;
  `applications.spec.ts` is unchanged by this spec.
- [ ] AC7 E2E, room privacy on the desktop layout. A step appended to `search.spec.ts::ac9`, after 0009i's
  desktop step (whose `page.setViewportSize({ width: 1440, height: 900 })` it inherits), as the same visitor on
  `/listings/${roomId}`:
  - `room-facts` is visible;
  - the page shows no "27, 30";
  - there is no `lifestyle.title.flat` heading.
  This is the desktop counterpart of `ac12`'s phone check, with zero new sign-ups. —
  `web/e2e/search.spec.ts::ac9_visitor_searches_and_opens_listing`
- [ ] AC8 Existing e2e pass unchanged:
  - `applications`, `likes`, `listings`, `search`, `map`, `flatmates` and `people` (at the project's 1280×720,
    the desktop layout, except `search.spec.ts` at 390 px);
  - `section`-scoped selectors still find one apply button (the bar is outside the section, and `display: none`
    from `lg`);
  - `page.getByRole('article')` on a listing page is still one element.
  — `make e2e`
- [ ] AC9 Visual check, in the `make screens` harness that 0009i (a dependency) adds in its AC10
  (`web/playwright.screens.config.ts`, projects `mobile` 390×844 and `desktop` 1440×900).
  - `web/e2e/screens/listing.screens.ts` mocks every API call with `page.route`, and answers OSM tiles with the 1×1
    PNG.
  - It captures, in both projects (390×844 and 1440×900), full page, 12 PNGs at
    `web/screens/0009j/<state>-<project>.png`:
    - `apartment-visitor`: the artboard's listing: 7,200 ₪, 4 rooms, Katznelson, Givatayim, floor 3 of 5, 95 m²,
      elevator, 1 parking, partly furnished, pets, arnona 960 (bi-monthly) and vaad 150, the description, a map,
      preferences couple or single / no smokers / 12 months;
    - `apartment-seeker`: 87%, three agrees and the parking differ, apply form open;
    - `room-seeker`: ages and answers, the "liked you" line and the like button;
    - `room-visitor`: no ages or answers;
    - `applied`: a submitted application;
    - `loading`.
  - On the phone the `apartment-visitor` shot is also taken scrolled halfway, with `apply-bar` showing.
  - The ux reviewer gets the PNGs and `Listing.dc.html`.
- [ ] NF1 `make lint`, `make test`, `make i18n-check`, `make build-web` and local `make e2e` are green (Speed rule
  7). The e2e result goes in the digest.
- [ ] NF2 0009h's `noColourLiterals.test.ts` stays green, and `pageWidths.test.ts` passes with `/listings/:id`
  set to `wide`. `grep -nE '\[[^]]*(px|rem|vh|env)[^]]*\]' <the files in "In">` lists only the three values
  under "Tokens", each with its comment. The digest has that output.

## Tests to write
- **Component, new:**
  - `ListingPage.test.tsx` `ac1_layout_columns`, `ac3_apply_bar` and `ac5_room_privacy_unchanged`;
  - `ac3` stubs `IntersectionObserver` with a class that records `observe` and lets the test fire the callback,
    and stubs `HTMLElement.prototype.scrollIntoView`.
- **Component, updated (only these):**
  - `ac8_match_card`'s last sibling check (AC1);
  - one icon assertion each in `ac7_public_listing_page` and `ac7_room_facts_and_lifestyle` (AC2);
  - class assertions that move to this spec's brand classes;
  - `web/src/app/__tests__/pageWidths.test.ts` (the `/listings/:id` row to `wide`) and `web/e2e/layout.spec.ts`
    (`ac6_desktop_widths`, `ac7_mobile_gutters`; see Scope).
- **E2E:** the AC6 step in `applications.spec.ts` and the AC7 step in `search.spec.ts`. There are zero new
  sign-ups.
- **Visual:** `web/e2e/screens/listing.screens.ts` (AC9), run by `make screens`, not by `make e2e`.

## Risks / open questions
- **No questions for Gilad.** Everything the artboard shows and the product lacks is Out, with the PRODUCT.md line
  that decides it.
- **Decisions this spec takes** (the ux reviewer judges them against their reasons):
  - the back link above the band, not over it;
  - a 160 / 256 px band until photos;
  - the hint as a line, not a map pill;
  - a jump bar, not a second apply form. The form stays in one place, so its draft (0009g), errors and focus
    rules exist once.
- **No desktop artboard.** The desktop layout follows the common listing-page pattern (content column plus a
  sticky action column), built from the artboard's cards, chips and type. If Gilad wants a desktop artboard first,
  the phone half can ship alone; the desktop rules are only `lg:` classes.
- **The sticky column scrolls internally** when the open apply form is taller than the viewport (at 720 px high, a
  6-line message with errors). This is acceptable; the alternative (sticky only while the form is closed) is more
  code for a rare case.
- **The apply bar and the phone tab bar.** Settled: 0009a lists `/listings/:id` as a focused route and hides its
  bottom tab bar there below `lg`, so `--bottom-nav-h` is 0 and the apply bar sits at `bottom-0`. Nothing to
  coordinate.
- **The brand over the artboard.** The artboard's accent fact icons, 30 px / 800 price, 17 px / 800 section titles,
  14 / 18 / 20 px radii and accent primary button give way to the brand (ink icons and primary buttons, Rubik
  `text-h2` / `text-h3`, `rounded-md` / `rounded-lg`); the ux reviewer judges against `design/brand/README.md`
  first, the artboard second.
- **Shared components.**
  - `OwnerPreferences` (the wizard preview, 0009k), `LikeRoomButton` and `MutualBanner` (`/me/likes`) and
    `ApplySection`'s gates change look there too, by design.
  - 0009c edits `ListingPage` (loading `Loading`, `ErrorState page`, the small map's `aria-hidden`),
    `ApplySection` (focus after a 201 / 409 / 404) and `LikeRoomButton` (no `aria-label` override). 0009g edits
    `ApplySection`'s `ApplyForm` (drafts) and `ListingPage`'s not-found branch. Whichever merges second rebases
    (Speed rule 3).
  - This spec changes no logic those specs touch. The new `headingRef` and `tabIndex={-1}` on the apply `<h2>` are
    compatible with 0009c's focus targets.
- **Room privacy.** The page renders only `GET /listings/{id}`'s fields: no other cache (my listings) or query
  feeds `RoomFacts`. AC5 pins this for a visitor, an owner with a cached copy, and a seeker.
- **FOLLOWUPS lines claimed** (as of `8c3c480`):
  - 43, the radius half for `ListingPage.tsx`. 0009h ticks the colour half; the search files are 0009i's;
  - 45 (the page's placeholder; the card's is 0009i's);
  - 53, the listing page's half: its back link becomes the kit's `BackLink`. 0009k claims the wizard's half
    (`BackToMine`), so 53 closes when both have merged.
  Line 42 is closed by 0009i, and line 127 by 0009h (the colour swap).
- verifier round 1 (orchestrator-run): 14 findings, all applied; second round waived. (1 blocker: class and
  token names that 0009d / 0009h do not define, now the brand scale; 5 major: `layout.spec.ts` ac6 / ac7 locators
  made deterministic, slash-form copy and literal Hebrew in tests replaced by keys, brand type / icon / button
  rules, the bottom-nav open question settled by 0009a's focused route, the bar no longer shows over the footer
  and gets `z-30`; 8 minor: harness owner is 0009i, BackLink chevron direction, band margins at `md`, `Field` id
  wiring, AC1's order helper, AC4 vs "Tests to write", the article's flex / grid display, the estimate.)

## Digest (filled by orchestrator after verification)
See `/digest`.

Spec 0009j — the listing page on the kit: photo band, icon facts grid, cards, a phone apply bar and a desktop sticky action column   PR open, not merged
Shipped: `/listings/:id` follows Listing.dc.html on a phone: back link, a 160 px band, price with match badge, Fredoka h1, meta line, a 3-column icon facts grid, description, map, preferences chips and match card as cards, then the like block and the apply card; a sticky bottom bar "הגשת מועמדות" shows while the action block is below the screen and jumps to it, focusing its heading. At ≥ 1024 px (`max-w-wide`): the band across the page, the main column at the inline start (facts in 6 columns from `xl`), and a sticky 24 rem column at the inline end with the like block and the apply card. Same requests, copy, states and who-sees-what. Demo: open a listing at 390 and scroll (bar appears, tap it); at 1440 scroll to the end (apply card stays in view); open a room as a visitor (no ages or answers).
Tests: +3 unit cases (`ac1_layout_columns`, `ac3_apply_bar` covering visitor, jump, on-screen and scrolled-past, profile gate, and the no-bar callers, `ac5_room_privacy_unchanged`); updated `ac8_match_card` (`actions.contains(apply)`) and the two `ac7` cases (an icon per `<dt>`); `pageWidths.test.ts` row → `wide`. +2 e2e steps, both in `search.spec.ts::ac9` as its visitor (AC7 desktop room privacy; AC6 at 1440 and 390, moved out of `applications.spec.ts::ac9` after the first CI run); `layout.spec.ts` ac6 / ac7 → `.max-w-wide`. 13 screenshots in `web/screens/0009j/` (6 states × mobile / desktop + the phone scrolled with the bar).
Findings (ux only, quick route; one round): 0 blockers, 0 majors, 2 minors, both fixed (the like button had become a pill: back to the brand's button radius; the desktop action column's focus-ring padding now offset with `lg:-m-1`, so its cards line up with the band's edge). 4 nits dropped. The two fixes are one class each; the screenshots predate them. The reviewer found no behaviour change, so no reviewers were added. No `dangerouslySetInnerHTML` / `innerHTML` / linkify in the diff.
NF2 grep: `ApplyBar.tsx:68 pb-[max(0.75rem,env(safe-area-inset-bottom))]`, `ListingPage.tsx:31 TWO_COLUMNS = 'lg:grid lg:grid-cols-[minmax(0,1fr)_24rem] …'`, `ListingPage.tsx:185 lg:max-h-[calc(100vh-3rem)]`: the three allowed values, each commented.
Coder choices kept: the scrolled phone shot is at `scrollTo(0, 320)`, not halfway (the mocked page is ~1470 px, so halfway already shows the action block and the bar correctly hides); full-page shots hide the fixed bar; one `FactCell` exported from `ListingFacts.tsx` and reused by `RoomFacts`; `MutualBanner.tsx` and `match/icons.tsx` unchanged (already on spec after 0009qa / 0009h); `OwnerPreferences` keeps its props (0009k's preview gets the new look).
Checks on the final head (main at 0009k + 0009m merged): make lint / test (api 476, web 524) / i18n-check / build-web green. Local e2e skipped on the orchestrator's instruction (Mac load ~25). Before that, `applications.spec.ts::ac9` with the new step passed on its own (16.6 s, 17.4 s), and full runs timed out only under load, in pre-existing steps (the `signUp` helper, a11y ac5). CI e2e is the gate. First CI run (905f2c0): `applications.spec.ts::ac9` hit the 30 s test timeout before reaching this spec's step. In that run every test was ~1.5× slower than main's, and 0009u's PR failed the same test the same way. The cause was runner speed on a test that runs 16–21 s, so the AC6 step moved to `search.spec.ts` (see AC6).
FOLLOWUPS: 53 closed (with 0009k); the listing page's halves of 43 (radii) and 45 (placeholder) noted closed. Changed in PRODUCT.md: nothing.
