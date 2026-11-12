---
id: 0009l
title: An owner's applicant inbox is restyled to the Inbox artboard — kit cards with the score ring in a corner, the status and mutual badges by the name, one row of disclosures, a long message that opens with "הצגת עוד", scrolling underline filter tabs and a kit dialog for decline — one column at every width, behaviour unchanged
status: verified
depends_on: [0009d, 0009h]   # 0009d: the kit (Button, Card, Badge, Tabs + TabPanel + tabId, useConfirm, PageContainer, PageHeader + BackLink) and the token scale; 0009h: the full-width shell and the hex swap of every feature file (it rewrites ApplicantsPage / ApplicantCard's colour classes, so this branches from 0009h's PR)
reviewers: [code, qa, ux, security]   # ux: restyled screen against Inbox.dc.html (screenshots); qa: every inbox state, the dialog, the clamp, 390 px; security (narrow brief): the seeker's message stays text-only and fully reachable behind "הצגת עוד" (FOLLOWUPS 72's security note), and room answers stay behind "עוד פרטים" on room applications only (PRODUCT.md "Rooms"); no perf: no query change
estimate: 1 coder run   # coder Opus/medium: no auth, money or data, but six shared pieces, three kit prop additions with tests and ~20 test edits. Split by the verifier into 0009l (phone layout, shared pieces) and 0009u (desktop grid + detail pane); 0009p (people browse) is the third part
---

## Goal
After this ships, `/me/listings/:id/applicants` takes its layout and anatomy from
`design/screens-v1/Inbox.dc.html`, at every width, in 0009h's `default` page container. Its colour, type, shape
and voice come from the brand kit (`design/brand/`, `specs/0009-brand-amendment.md`), which overrides the
artboard on those four. The page is one column and complete on its own; `0009u` then adds the desktop grid and
detail pane of `InboxDesktop.dc.html`. The page has, from the top:
- the back link, "מועמדויות עבור" over the listing title, the price, and three stat tiles;
- underline filter tabs that stay on one row (they scroll inside it at 390 px), and the sort pills;
- full-width applicant cards. A card has the avatar, the name with its status badge (and "התאמה הדדית" for a
  mutual match), the score ring in the inline-end corner, two reason chips, and the message in a quiet box. A
  long message is clamped to four lines with "הצגת עוד". Then come "למה ההתאמה?" and "עוד פרטים" in one row,
  and the action row (shortlist / decline / chat).
- Decline asks in the kit's dialog, not `window.confirm`.

What the owner can do is unchanged: the same data, filters, sort, actions, errors and focus rules as `0004d`,
`0006g`, `0007c` and `0008b` built them. This serves PRODUCT.md "Applications" and "Matching" (screen 9 of the
Product Plan). It is Slice 9b. It closes FOLLOWUPS 72, 131, 152 and 172, and does the extraction half of 169.

## Scope
**In:**

1. **Page frame and states.** `ApplicantsPage.tsx` keeps 0009h's `PageContainer` (`width` absent, i.e.
   `default`; 0009h's `pageWidths.test.ts` row is unchanged here, and `0009u` takes it to `wide`). Each branch:
   - **"My listings" pending.** `PageContainer` and today's single skeleton, with no `PageHeader`. Today the
     wrapper is `aria-busy` + `aria-label` and has no `<h1>`. If `0009c` is on the branch, keep exactly its form
     instead: the `<h1>` `applicants.title` and `components/Loading`.
   - **"My listings" failed.** The kit `BackLink` (`{ to: '/me/listings', label: t('listings.edit.backToMine') }`)
     and `ErrorState` with retry, plus `0009c`'s `<h1>` `applicants.title` if it is on the branch.
   - **Not found** (the id is not in my listings). `PageHeader` with that `back` and `title={t('applicants.notFound')}`.
   - **Found** (applicants pending, failed, empty or loaded). `PageHeader` with:
     - `back` as above;
     - `eyebrow={t('applicants.titleFor')}` (kit addition, item 8);
     - `title={cardTitle(t, listing)}` (`features/listings/cardTitle.ts`). The `<h1>`'s accessible name is then
       "מועמדויות עבור 3 חדרים, רחוב …", and a room is titled "חדר ב־…";
     - `subtitle={`${formatIls(listing.price_ils)} ${t('listings.units.ils')}`}`, as today;
     - `titleRef={headingRef}`, which stays the last focus fallback.
     If `0009c`'s `usePageTitle` is on the branch, it receives that `<h1>` text (`${titleFor} ${cardTitle}`).
   - Under the found header:
     - pending: three `Skeleton` cards (`0009c`'s `Loading` wrapper if present, else today's `aria-busy` list);
     - failed: `ErrorState` with retry;
     - empty: `EmptyState pose="sleep"` (0009d's mascot, brand amendment) with `applicants.empty`. The wording
       of that key is `0009b`'s; under the brand voice it becomes an invitation, not an apology;
     - loaded: the stat tiles, the `gone` alert, the tabs row and the `TabPanel`.
   - The sr-only `role="status"` announcement stays the container's last child.
   - The `<h1>`'s `0009b` wording and `cardTitle`: `0009b` also switches today's title line to `cardTitle`
     (FOLLOWUPS 147, theirs). Whichever merges second keeps `cardTitle`.
   - `BackToMine` is no longer imported here. If no file imports it after this change, delete its export
     (0009k's note: whoever removes the last importer deletes it).

2. **Stat tiles** (loaded and non-empty only, as today). They come right after the `PageHeader`:
   - `<ul data-testid="applicant-totals" class="flex gap-2">` with three `li` in today's order: total,
     shortlisted, new;
   - each `li` is `flex min-w-24 flex-1 flex-col gap-0.5 rounded-lg px-3 py-3`, with
     `<span class="font-display text-h2">{n}</span>{' '}<span class="text-caption">{label}</span>`;
   - tones: total and new `bg-surface-subtle`; shortlisted `bg-accent-soft text-accent-strong`. On
     `accent-soft` the text is `accent-strong`, by the brand rule;
   - the number uses `font-display text-h2` (Fredoka at 24 px, the smallest size it is allowed). The label uses
     Rubik `text-caption`;
   - three tiles fit at 390 px (3 × 96 + 2 × 10 = 308 px of 358). `0009u` moves them into the header's
     `actions` on desktop.
   - Then the page-level `gone` alert (`applicants.errors.gone`, `role="alert"`, now `text-body-sm font-semibold
     text-danger`), where it is today.

3. **Filter tabs and sort.**
   - The filter becomes the kit `Tabs`:
     - `label={t('applicants.filter.label')}`, `items` = the four filters with today's labels
       (`applicants.filter.all|new|shortlisted|declined` with `{count}`), `value={filter}`;
     - `onChange` does today's `setGone(false); setFilter(f)`;
     - `variant="underline"`, `scrollable` (kit addition, item 8), `panelId={panelId}` (a `useId`).
   - The tabs measure about 430 px at 390, so without `scrollable` the kit's `flex-wrap` would break them onto
     two lines.
   - The list (the cards or `applicants.emptyFilter`) is `<TabPanel panelId={panelId} value={filter}>`.
   - The focus target "the pressed filter button" becomes the selected tab,
     `document.getElementById(tabId(panelId, filter))`. `filterRefs` goes. The rest of `FocusRequest` is
     unchanged: the card's `<h2>`, else the selected tab, else the `<h1>`.
   - The sort keeps its semantics, so tests `ac2_sort_toggle_*` are unchanged:
     - `role="group"` named `applicants.sort.label`, two buttons with `aria-pressed`, client-side order;
     - each button is a kit `Button size="sm" shape="pill"`, `variant="tint"` when pressed and `"ghost"` when
       not;
     - the group sits on its own line under the tabs, at the inline start.

4. **The card** (`ApplicantCard.tsx`). One layout, at every width. It gets a new prop
   `confirmDecline: (name: string) => Promise<boolean>` (item 6).
   - **Root.** `<li>` → `Card as="article" aria-labelledby={headingId} padding="sm" radius="card"
     className="flex flex-col gap-3"`. The brand gives a card: `rounded-lg` (16 px), `space-3` padding
     (12 px), a `border`, **no shadow**, and `gap-3` between cards. The artboard's 20 / 16 / 12 is overridden.
   - **Top row** `flex items-start gap-3`:
     - **Avatar.** `size-12 rounded-full bg-surface-subtle text-ink-muted text-h3`, with the
       first letter, `aria-hidden`. Inbox.dc.html is neutral after the first card; `0009u` tints the selected
       one.
     - **Text column** `min-w-0 flex-1 flex-col gap-0.5`:
       - the name row, `<div data-testid="applicant-name-row" class="flex flex-wrap items-center gap-x-2
         gap-y-1">`, holds:
         - the `<h2 id={headingId} tabIndex={-1}>` (`text-h3`, `focus:outline-none`, and today's
           `[overflow-wrap:anywhere]`, so a long unbroken name wraps);
         - the status badge (`ApplicationStatusChip viewer="owner"`, now a kit `Badge`, item 7);
         - for `source === 'like'`, the mutual badge `<Badge tone="accent"
           data-testid="applicant-mutual">{t('applicants.mutual')}</Badge>` (`bg-accent-soft
           text-accent-strong`). It moves here from the message slot (FOLLOWUPS 172);
       - `applicants.appliedAt` (`text-caption text-ink-muted`);
       - `RoomLine` for a room applicant. It stays a `<p>` right after the applied-at line, as the existing
         `lineAfterApplied` lookups need;
       - the `applicants.summary` line with `applicants.flexible` (`text-caption text-ink-muted`). Each line shows
         only when it shows today.
     - **Score**, `flex-none`, at the inline end: `MatchRing size="md" label` (item 7). With `match === null` it
       is `Badge tone="neutral"` with `match.noScore`. The score leaves the name row, so a long name or
       "ברשימה הקצרה" never wraps it (FOLLOWUPS 131).
   - **Chips.** `MatchChips voice="owner"` as today, in its `0009i` look. This spec does not restyle it.
   - **Message** (`source !== 'like'`, FOLLOWUPS 72):
     ```
     <ClampedText lines={4} id={`${headingId}-message`} describedBy={headingId}
       textProps={{ dir: 'auto', 'data-testid': 'applicant-message',
         className: 'self-stretch whitespace-pre-line break-words rounded-md bg-surface-subtle px-3 py-3 text-body-sm text-ink' }}>
       {applicant.message}
     </ClampedText>
     ```
     It renders React text children only, never linkified or HTML (FOLLOWUPS 72's security note). The full text
     is one click away, and a screen reader reads all of it either way.
   - **Disclosures** (FOLLOWUPS 152). One wrapper `flex flex-col gap-2`:
     - first, a `flex flex-wrap gap-x-4` row with "למה ההתאמה?" (when `profile !== null`) and "עוד פרטים"
       (when `room !== null`) side by side. Each is a `DisclosureButton` (item 7) with today's `aria-expanded`,
       `aria-controls` and `aria-describedby={headingId}`;
     - then the "why" panel (`ReasonList` + `ProfileFacts`) and the "more" panel (`RoomDetails`), always in the
       DOM with `hidden` while closed, as today. They open and close independently (test
       `ac12_patch_and_independent_disclosures` unchanged).
   - **Actions**, as today: submitted → shortlist + decline; shortlisted → unshortlist + decline + chat;
     declined → none.
     - a `flex gap-2` row;
     - the status buttons are kit `Button size="md"` with `className="flex-1"`:
       - shortlist is `primary`, which the brand draws in `ink` with `on-ink`, not accent: one accent-filled
         element per screen at most, and this screen has none;
       - unshortlist is `tint` (`accent-soft` + `accent-strong`);
       - decline is `secondary` (`border-strong`);
       - they keep today's `disabled={change.isPending}`, `aria-busy` on the pressed one, and
         `aria-describedby={headingId}`;
     - the chat link is `<Button to={`/chat/${applicant.id}`} variant="secondary" icon={<ChatIcon />}
       aria-label={t('chat.withName', { name })} aria-describedby={headingId} className="flex-none" />`, with no
       children (the kit's icon-only form). `ChatIcon` is today's svg path, moved into a local component;
     - the action error line keeps `role="alert"` and the text on the branch: today's `common.error`, or
       `0009f`'s `applicants.errors.actionFailed` / `common.offline`. It is styled `text-body-sm font-semibold
       text-danger`.

5. **(Reserved for `0009u`.)** The card takes no `layout` prop here. `0009u` adds `layout: 'stacked' |
   'compact'`, and today's card becomes its `stacked` branch.

6. **Decline confirm.** `ApplicantsPage` calls the kit's `useConfirm()` once and renders its `dialog`. Each card
   gets `confirmDecline = (name) => confirm({ title: t('applicants.declineConfirm', { name }), confirmLabel:
   t('applicants.actions.decline'), tone: 'danger' })`. The cancel label is the kit's default, `common.cancel`
   "ביטול".
   - In `ApplicantCard.onAction('declined')`:
     - set `inFlight.current = true` before `await confirmDecline(name)`;
     - on `false`, reset it and return. Nothing is sent, and the kit returns focus to the decline button;
     - on `true`, continue exactly as today: one PATCH, and the same `onSettled` focus and announcement.
   - Shortlist and unshortlist do not confirm, as today.
   - The key `applicants.declineConfirm` keeps its wording (`0009b` owns it).

7. **Shared pieces.** These are extractions and compositions of the kit, not new kit components:
   - **`web/src/features/match/MatchRing.tsx`** (`{ score: number; size: 'md' | 'lg'; label?: boolean }`):
     - the ring: `md` is `size-12 border-2 text-label tabular-nums` (48 px), and `lg` is `size-14 border-4 text-h3
       tabular-nums` (56 px). It is Rubik: Fredoka is never used below 24 px. It is `rounded-full flex
       items-center justify-center` and shows `t('match.card.score', { score })` ("94%");
     - tone from `bucket(score)`: `high` is `border-accent bg-accent-soft text-accent-strong` (the brand's accent
       ring); `good` and `partial` are `border-border-strong bg-surface-subtle text-ink-muted`;
     - `label` adds `t('match.ring.label')` "התאמה" under the ring (`text-caption font-semibold text-ink-muted`);
     - the visible parts are `aria-hidden`, and a `<span class="sr-only">` carries `t('match.badge', { score })`
       ("התאמה 94%");
     - the root `inline-flex flex-col items-center gap-0.5` has `data-testid="match-ring"` and
       `data-bucket={bucket(score)}`.
     `MatchBadge` (the pill of search, the map, the listing page and likes) is untouched: it is 0009i's. `0009j`
     may use the ring in `MatchCard`.
   - **`web/src/features/match/ReasonList.tsx`** (`{ lines: { kind: ReasonKind; text: string }[] }`): today's
     reason markup moved out of `ApplicantCard`. It is a `ul flex flex-col gap-2` of `li flex items-center
     gap-2 text-body-sm text-ink` with `AgreeIcon` / `DifferIcon`. The differ line's words carry the meaning,
     and the icon repeats it.
   - **`web/src/features/match/icons.tsx`**, the brand look. `0009j`'s `MatchCard` shares this file, and the
     first to merge does it:
     - both icons are outline, stroke 2, round caps and `currentColor`; the hex `stroke` values go;
     - `AgreeIcon` is the check in `text-accent-strong` on a `size-6 rounded-full bg-accent-soft`;
     - `DifferIcon` is the "!" in `text-warning`, with no fill. The amber `bg-warn` circle is gone: the brand's
       `warning` is a text and icon colour, and always comes with words.
   - **`web/src/features/applicants/ApplicantDetails.tsx`**: `ProfileFacts` moved out of `ApplicantCard.tsx`.
     Its rows and labels are unchanged; only the tokens change (`gap-2`, `bg-surface-subtle`, `py-2`,
     `gap-0.5`).
   - **`web/src/features/applicants/RoomLine.tsx`** (`{ gender: ApplicantRoom['gender']; age: number | null }`):
     today's `RoomLine`, exported, so `0009p` can use it (FOLLOWUPS 169).
   - **`web/src/features/applicants/DisclosureButton.tsx`** (`{ open: boolean; controls: string; describedBy?:
     string; onToggle: () => void; children: ReactNode }`):
     - a kit `Button variant="ghost" size="sm"` with `aria-expanded={open}`, `aria-controls={controls}` and
       `aria-describedby={describedBy}`;
     - children first, then today's chevron svg (`M6 9l6 6 6-6`, `aria-hidden`), turned with `rotate-180` while
       open and `motion-reduce:transition-none`;
     - it replaces `ApplicantCard`'s local `Chevron` (FOLLOWUPS 169).
   - **`web/src/components/ClampedText.tsx`** (FOLLOWUPS 72), the design `0009c` verified for its Part B. If
     `0009q` merged it first, reuse it. Props: `{ lines: 2 | 4; id: string; describedBy?: string; textProps?:
     HTMLAttributes<HTMLParagraphElement> & { 'data-testid'?: string }; children: string }`.
     - Structure: `<div class="flex flex-col items-start gap-1">`, then `<p id={id} {...textProps}>` with
       `line-clamp-2` / `line-clamp-4`, then the button. The clamp class is picked from a literal map, so Tailwind
       sees it, and is removed while expanded.
     - The button renders only when the clamped text overflows (`scrollHeight > clientHeight + 1`, measured only
       while clamped) or is expanded. It re-measures in `useLayoutEffect`, on `ResizeObserver` (when present),
       and when `children` changes.
     - It is a kit `Button variant="ghost" size="sm"` with `common.showMore` "הצגת עוד" / `common.showLess`
       "הצגת פחות", `aria-expanded`, `aria-controls={id}` and `aria-describedby={describedBy}`.
     - The clamp is visual only.
   - **`web/src/features/applications/ApplicationStatusChip.tsx`**: only its **owner** branch changes. It
     returns `<Badge tone={…} data-testid="application-status">`. Every badge has words, so colour only repeats
     the meaning:
     - `submitted` "חדש" → `accent` (`bg-accent-soft text-accent-strong`): it draws the eye, as the artboard's
       amber did;
     - `shortlisted` "ברשימה הקצרה" → `success` (kit addition, item 8): `text-success` with an outline check
       icon, on `surface` with a `border`;
     - `declined` "נדחה" → `neutral` (`bg-surface-subtle text-ink-muted`).

     The artboard's amber / teal are overridden by the brand. The seeker branch (ApplySection, My
     applications) and its span are unchanged.
   - **`web/src/features/applicants/RoomDetails.tsx`**: arbitrary values become tokens (`gap-2`, `py-2`,
     `gap-0.5`). Nothing else changes.

8. **Kit additions.** 0009d lets a screen spec add a prop with a test. Each goes in the component's existing
   test file:
   - **`PageHeader`**: `eyebrow?: string`. When set, the `<h1>` renders
     `<span class="block font-sans text-caption text-ink-muted">{eyebrow}</span>{' '}` before `title`, so the
     accessible name is "eyebrow title". `font-sans` is needed because the `<h1>` is Fredoka, and Fredoka is never
     used below 24 px. — `PageHeader.test.tsx::eyebrow_in_h1`
   - **`Badge`**:
     - it spreads the rest of its props onto the root span (`Omit<HTMLAttributes<HTMLSpanElement>,
       'children'>`): `data-testid`, `id`, `aria-*`. Without this, every `application-status` /
       `applicant-mutual` lookup breaks;
     - it gains `tone="success"`: `border border-border bg-surface text-success` with a leading outline check
       (`aria-hidden`), for a positive status. Skip this if 0009d's brand pass already has the tone.

     — `Badge.test.tsx::forwards_attributes`, `Badge.test.tsx::success_tone`
   - **`Tabs`**: `scrollable?: boolean` (underline only). The list swaps `flex-wrap` for `flex-nowrap
     overflow-x-auto`, and each tab gets `shrink-0 whitespace-nowrap`. The roving focus is unchanged; the browser
     scrolls a focused tab into view. — `Tabs.test.tsx::scrollable_underline`

9. **`web/src/locales/he.json`**, new keys only:

   | Key | Hebrew |
   | --- | --- |
   | `applicants.titleFor` | "מועמדויות עבור" |
   | `match.ring.label` | "התאמה" |
   | `common.showMore` | "הצגת עוד" (unless `0009q` added it) |
   | `common.showLess` | "הצגת פחות" (unless `0009q` added it) |

   `applicants.title` is still rendered by the "my listings" pending and failed states when `0009c` is on the
   branch.

10. **Screenshots** (the visual check). The 9b family shares one harness: 0009i, 0009k and 0009q name this
    one. Whichever of them builds first adds it; the others add only their script.
    - `web/playwright.screens.config.ts`: `testDir: 'e2e/screens'`, `testMatch: '*.screens.ts'` (so `make e2e`
      never runs it), projects `mobile` at 390×844 and `desktop` at 1440×900, and `baseURL`
      `http://localhost:5173`.
    - A Makefile target `screens: web/node_modules/.modules.yaml` running `cd web && $(PNPM) exec playwright
      test -c playwright.screens.config.ts`, with a `##` help line and an entry in `.PHONY`.
    - `web/screens/` in `.gitignore`.
    - `web/e2e/screens/applicants.screens.ts` answers every API request with `page.route(`${API}/**`)`:
      - `API` comes from `e2e/helpers.ts`, and the fixtures are shaped as
        `features/applicants/__tests__/fixtures.ts`;
      - the API is cross-origin and credentialed, so every fulfilment sends `Access-Control-Allow-Origin:
        http://localhost:5173` and `Access-Control-Allow-Credentials: true`;
      - `OPTIONS` preflights are answered `204`, with `Access-Control-Allow-Methods: GET, PATCH` and
        `Access-Control-Allow-Headers: content-type`;
      - the event stream is aborted;
      - an unmatched request fails the run.
      So it needs only the vite server on 5173, with no sign-up and no OTP. It saves `page.screenshot({
      fullPage: true, path: `screens/0009l/${state}-${testInfo.project.name}.png` })` for each state in "UI".

**Out:**
- The desktop layout: `PageContainer wide`, the card grid, the selected card, the detail pane, the tiles at the
  header's end, and tabs and sort in one row. They are `0009u`.
- The people page (`0009p`).
- The visible "moved out of this filter" line and the 404 / 401 handling of the applications GET (`0009g`,
  FOLLOWUPS 83 / 85; see "How the siblings fit").
- Focus order and landmarks beyond what is listed here, and the axe checks (`0009c` / `0009t`).
- The wording of existing keys (`0009b`). The header, bottom tab bar and landing (`0009a`). Tokens, the kit and
  the shell (`0009d` / `0009h`). `MatchBadge` / `MatchChips` looks (`0009i`).
- Artboard elements with no data or behaviour behind them (see the gap list).

**New dependencies:** none.

## Data
None.

## API
None. The page reads `GET /me/listings` and `GET /listings/{id}/applications`, and sends `PATCH
/listings/{id}/applications/{id}`, exactly as today.

## UI
Artboard: `design/screens-v1/Inbox.dc.html` (mobile, 390). `InboxDesktop.dc.html`'s desktop-only elements are
listed in `0009u`. Until `0009u` ships, 1440 px shows this one-column layout in 0009h's 720 px container.

### Gap list (Inbox.dc.html → today → this spec)
| # | Element | Artboard | Today (8c3c480) | 0009l |
| --- | --- | --- | --- | --- |
| 1 | Header band | white, full-bleed band with a bottom border holding back, title, tiles and tabs | the page background in `Layout`'s 640 px column | the page background in 0009h's `PageContainer` with its gutters. No band: the shell owns full-bleed surfaces, and a band inside a gutter container would need negative margins |
| 2 | Back | 44 px icon-only button | `BackToMine` text link with chevron | `PageHeader` `back` (the kit `BackLink`, chevron + "חזרה למודעות שלי"). A labelled link is clearer than an icon-only one |
| 3 | Title | "מועמדויות עבור" (12 px, muted) over the listing title (17/800, ellipsis) | `<h1>` "מועמדויות", then a bold title line | one `<h1>`: `eyebrow` + `cardTitle`, at the kit's `<h1>` size; the title wraps instead of an ellipsis |
| 4 | Kebab "אפשרויות נוספות" | in the header | none | out (no action behind it) |
| 5 | Price | — (desktop only: "7,200 ₪ · …") | price line | `subtitle`, as today. No view count (PRODUCT.md "Applications") |
| 6 | Stat tiles | 3 equal: grey / tint / grey, 24/800 number, 13 px label | 3 `bg-[#F5F5F4]` tiles | item 2's tiles in brand tokens: `surface-subtle` / `accent-soft`, number in Fredoka `text-h2` |
| 7 | Filter | `role="tablist"`, underline, selected bold with a 2.5 px bar; "חדשות" has a count pill | `role="group"` of `aria-pressed` buttons, "(N)" labels | kit `Tabs variant="underline" scrollable` + `TabPanel`, with "(N)" labels. The pill is dropped: the label already carries the count, and `InboxDesktop` uses "(N)" |
| 8 | Sort | "ממוין לפי ציון התאמה" + "שינוי ▾" | two `aria-pressed` pills on their own line | the same two pills as kit `Button sm pill`. Behaviour is unchanged, so there is no single "שינוי" toggle |
| 9 | Card box | white, `line` border, radius 20, padding 16, gap 12 | the same, raw classes | brand card: `rounded-lg` 16, padding 12, `border`, no shadow, gap 3 |
| 10 | Avatar | 48 px, tint on the first card, grey on the others | 48 px, tint on every card | 48 px, neutral (`0009u` tints the selected card) |
| 11 | Name row | name 17/800, "· ages", status pill 11/700 | `<h2>` 17/800, status chip 13/700, and the score pill in the same wrapping row | `<h2>`, status `Badge` (`sm`, 11/700), mutual `Badge`. No ages: apartment applicants have none (PRODUCT.md "Matching"), and a room applicant's age is in `RoomLine` |
| 12 | Occupation line | "מהנדסת תוכנה · פיזיותרפיסט" | none | none (PRODUCT.md "Matching": no occupation) |
| 13 | Household · move-in | "זוג, בלי ילדים · כניסה 1.1.27" | `applicants.summary` | the same line, in tokens |
| 14 | Applied at | — | `applicants.appliedAt` | kept: it is today's data, and `InboxDesktop`'s pane shows it too |
| 15 | Score | 52 px ring, 3 px border (accent when high, grey otherwise), "התאמה" under it, in an end column | `MatchBadge` pill in the name row (it wraps at 390, FOLLOWUPS 131) | `MatchRing md label` in the end column, 48 px, accent ring when high (brand) |
| 16 | Chips | two pills with tick / "!" icons | `MatchChips`, no icons | `MatchChips` as 0009i leaves it (brand: the differ chip is `warning` with its words, not amber) |
| 17 | Message | not on the card (the desktop pane has it in a grey box) | full text on the card | kept on the card (it is the application's content; dropping it would change behaviour), in a quiet `surface-subtle` box, clamped to 4 lines with "הצגת עוד" (FOLLOWUPS 72) |
| 18 | Mutual match | — | teal tag in the message slot | `Badge accent` (`accent-soft`) in the name row (FOLLOWUPS 172); no message box |
| 19 | Disclosures | none (the desktop pane has the details) | "למה ההתאמה?" and "עוד פרטים" stacked about 56 px apart (FOLLOWUPS 152) | one row of two `DisclosureButton`s, with the panels under it. Room answers stay behind "עוד פרטים" (PRODUCT.md "Rooms") |
| 20 | Actions | shortlist (flex 1.5, primary) / decline (outline) / 44 px chat icon on every card; shortlisted: "הסרה מהרשימה" in tint | natural-width buttons; chat only when shortlisted | equal `flex-1` kit Buttons and the icon-only chat Button. Chat still shows only when shortlisted (PRODUCT.md "Chat": it opens on shortlist). The 1.5 ratio is dropped: no token, and the artboards are not pixel-perfect |
| 21 | Bottom tab bar | owner tabs | none | `0009a` |
| 22 | Decline confirm | — | `window.confirm` | kit `useConfirm`, `tone: 'danger'` |
| 23 | Colours, radii, type, voice | teal, Heebo, hex literals | hex and `[Npx]` classes | the brand kit wins (`design/brand/tokens.json`, `specs/0009-brand-amendment.md`): Rubik, Fredoka only at 24 px and up, ink primary buttons, no card shadows, tokens only (AC12) |
| 24 | Empty inbox | — | `EmptyState` text | `EmptyState pose="sleep"` (the brand mascot, one per screen) |

### Layout (every width; checked at 390×844, and at 1440×900 in the 720 px container)
One column, from the top: the `PageHeader` (back, the two-line `<h1>`, price), the tiles, the `gone` alert, the
tabs (one row, scrolling inside it), the sort pills, and the cards in `flex flex-col gap-3`. The page never
scrolls horizontally at 390.

### States (each one is a screenshot at both sizes)
- `listings-loading` (one skeleton) · `listings-error` · `not-found` · `applicants-loading` (the found header and
  three skeleton cards) · `applicants-error` · `empty`.
- `all`: five applicants. A new high-score apartment applicant with a message; a shortlisted one (with the chat
  link); a pre-Slice-6 one with no score; a declined one; a mutual one.
- `disclosures-open`: a room applicant with both panels open. `room`: a room listing's applicant with `RoomLine`.
- `filter-new-newest`: the "new" tab plus sort by date. `filter-empty`: `applicants.emptyFilter`.
- `decline-dialog`: the dialog open. `long-message`: 500 characters with 12 line breaks, clamped with
  "הצגת עוד". `long-message-open`: the same, expanded. `action-error`: a PATCH 500, with the card's alert.

### How the siblings fit
- **`0009u` (desktop).** It builds on this spec's card as its `stacked` branch. Its compact card shows a plain
  2-line preview with no `ClampedText`, because its pane shows the full message.
- **`0009g`** (FOLLOWUPS 83 / 85):
  - its visible "moved out" status line sits between the tabs row and the `TabPanel`;
  - its 404 branch is this spec's not-found state;
  - both specs edit `ApplicantsPage.tsx` and neither depends on the other, so the second to merge rebases.
- **`0009c`** (verified): it renders the `<h1>` `applicants.title` and `components/Loading` in the inbox's
  loading and list-error states. With this spec, the states where the listing is known have the two-line
  `<h1>` instead. Its `ApplicantsPage.test.tsx::ac4_h1_while_loading_and_on_error` must then expect "מועמדויות
  עבור …" for the applicants-pending and applicants-failed states. Whichever merges second updates that test;
  the orchestrator is asked to note this in `0009c`.
- **`0009f`**: it changes the card's action error text (`applicants.errors.actionFailed`, `useOnline`). This
  spec keeps that text and changes only its classes. The second to merge rebases.

RTL: logical properties only (`ms-`/`me-`/`ps-`/`pe-`, `start`/`end`, `text-start`). The ring is in the inline-end
column. The message keeps `dir="auto"`. Every control is at least 44 px (the kit's sizes).

## Acceptance criteria
- [ ] AC1 **Header.** Given listing A (an apartment) with five applicants:
  - the `<h1>`'s accessible name is "מועמדויות עבור " + A's `cardTitle`, and a room listing's continues with
    "חדר ב־";
  - the back link `listings.edit.backToMine` goes to `/me/listings`;
  - the price line shows "7,200 ₪", and no "צפיות" appears;
  - `applicant-totals` reads `5 מועמדויות` / `2 ברשימה הקצרה` / `2 חדשות`;
  - `PageHeader` with `eyebrow` renders it inside the `<h1>`, before the title.

  — `web/src/features/applicants/__tests__/ApplicantsPage.test.tsx::ac3_header_totals_and_filters` (updated).
  The exact `he.applicants.title` `<h1>` lookups that now see the two-line `<h1>` become
  `new RegExp(`^${he.applicants.titleFor}`)`: `ac2_states` (lines 155, 184) and `ac6_action_errors` (lines 488,
  569). Also `web/src/features/listings/__tests__/RequireOwner.test.tsx::ac1_owner_only_routes` (the
  `APPLICANTS` title, same regex) and `web/src/components/__tests__/PageHeader.test.tsx::eyebrow_in_h1`.
- [ ] AC2 **States.**
  - "My listings" pending: no `PageHeader`, and one skeleton (today's `ac2_states` assertions, or `0009c`'s if
    it is on the branch);
  - "my listings" failed: the back link and `ErrorState`;
  - an unknown id: the `<h1>` `applicants.notFound` and the back link;
  - applicants pending: the found `<h1>` and three skeleton cards;
  - applicants failed: the found `<h1>` and `ErrorState`, whose retry refetches;
  - zero applicants: `applicants.empty`, with no tiles and no tabs.

  — `ApplicantsPage.test.tsx::ac2_states` (updated)
- [ ] AC3 **Tabs.**
  - The filter is a `tablist` named "סינון מועמדויות" with four `tab`s, labelled with counts as today. Only
    the selected tab has `aria-selected="true"`.
  - Clicking "חדשות (2)" shows the two submitted cards inside the `tabpanel`. With no declined applicant,
    "נדחו (0)" shows `applicants.emptyFilter` and no `article`.
  - After an action under a filter that the card leaves, and after a 404 "gone", the selected tab has focus.
  - The `Tabs` list has `flex-nowrap overflow-x-auto` with `scrollable`, and `flex-wrap` without it.

  — `ac3_header_totals_and_filters`, `ac5_shortlist_unshortlist_decline` and `ac6_action_errors`. Their
  `filters()` / `filterButton` helpers become `getByRole('tablist', { name })` / `getByRole('tab', { name })`,
  and the filter's `aria-pressed` becomes `aria-selected`. Also `web/src/components/__tests__/Tabs.test.tsx::scrollable_underline`.
- [ ] AC4 **Card anatomy.** For a submitted apartment applicant with a profile and a match of 94:
  - the card's `match-ring` has `data-bucket="high"` and text containing "התאמה 94%", and is not inside
    `applicant-name-row`;
  - the `<h2>` and the status badge "חדש" (`application-status`) are inside `applicant-name-row`;
  - `applicant-message` keeps the full text, `dir="auto"`, `whitespace-pre-line`, `break-words` and no `<a>`;
  - every button in the card is described by the `<h2>`.

  Also:
  - a pre-Slice-6 applicant shows "אין ציון" and no `match-ring`;
  - a shortlisted one has the link named "צ'אט עם …" to `/chat/{id}`, with no visible text;
  - a declined one has no action buttons.

  `Badge` forwards `data-testid` and `id`.
  — `ac4_applicant_card` (gains the ring, `data-bucket` and name-row assertions), `ac1_sorted_by_match`,
  `ac5_patch_keeps_place` and `ac6_room_gender_age` (their `match-badge` lookups become `match-ring`),
  `ac10_chat_button_on_shortlisted`, and `web/src/components/__tests__/Badge.test.tsx::forwards_attributes`
- [ ] AC5 **Mutual.** An applicant with `source: 'like'` shows `applicant-mutual` "התאמה הדדית" inside
  `applicant-name-row`, and no `applicant-message`. An `apply` applicant shows its message. —
  `ac8_mutual_tag` (updated)
- [ ] AC6 **Disclosures in one row.** For a room applicant with a profile, "למה ההתאמה?" and "עוד פרטים" are
  children of one row element. Each still controls its own panel and opens on its own. `ac4_why_disclosure*`,
  `ac9_more_disclosure_keyboard` and `ac12_patch_and_independent_disclosures` pass unchanged. —
  `ApplicantsPage.test.tsx::ac6_disclosures_share_a_row`
- [ ] AC7 **Long message** (FOLLOWUPS 72). `ClampedText`, with the `scrollHeight` / `clientHeight` getters
  stubbed on `HTMLElement.prototype`:
  - with overflow, the button "הצגת עוד" shows with `aria-expanded="false"` and `aria-controls` naming the text;
  - a click removes the clamp class, sets `aria-expanded="true"` and the label "הצגת פחות";
  - with equal heights, no button renders.

  On the inbox:
  - an overflowing message gets the button, described by the card's `<h2>`;
  - the text node still holds the whole message, and there is no `<a>`;
  - `buttonsOf(name)` has no extra button for a short message.

  — `web/src/components/__tests__/ClampedText.test.tsx::ac7_toggle_only_when_overflowing`,
  `ApplicantsPage.test.tsx::ac7_long_message_show_more`
- [ ] AC8 **Decline dialog.** With `window.confirm` spied on: focus the card's "דחייה", then click it.
  - A `dialog` opens whose name contains the applicant's name (`applicants.declineConfirm`).
  - "ביטול" closes it with no PATCH, and the decline button has focus again.
  - Doing it again and pressing the dialog's "דחייה" sends exactly one PATCH `{status: "declined"}`. The card
    then shows "נדחה" and no actions.
  - The spy has 0 calls.

  It uses the jsdom `<dialog>` stand-in 0009d adds in `test-setup.ts`. — `ac5_shortlist_unshortlist_decline`
  (its decline part rewritten; it is the only test that spies on `window.confirm` today)
- [ ] AC9 **`MatchRing`.**
  - 80 is `high`, with the accent classes; 79 and 59 are neutral;
  - `label` adds "התאמה";
  - the sr-only text is `match.badge` ("התאמה 87%"), and the visible parts are `aria-hidden`;
  - `size="lg"` has `size-14`.

  — `web/src/features/match/__tests__/MatchRing.test.tsx::ac9_ring`
- [ ] AC10 **Visual check.** `make screens` writes one PNG per state in "UI" at 390×844 and at 1440×900, under
  `web/screens/0009l/`. The spec session hands the folder and this spec's gap list to the ux reviewer, who
  compares each 390 screenshot with `Inbox.dc.html` row by row for layout and anatomy, and with `design/brand/` for colour, type, shape and voice. The 1440 set checks that nothing breaks in the
  720 px container. The build digest gives the PNG count and the reviewer's verdict. —
  `web/e2e/screens/applicants.screens.ts` (measurement)
- [ ] AC11 **E2E** (no new sign-up). In `web/e2e/inbox.spec.ts::ac12_shortlist_chat_decline`, at the default
  1280×720 (a desktop viewport; this layout is the same at every width):
  - the `<h1>` lookup uses `he.applicants.titleFor`;
  - `getByTestId('match-badge')…toHaveText(…)` becomes `getByTestId('match-ring')…toContainText(withScore(he.match.badge, 100))`;
  - the decline drops `page.once('dialog', …)`: it clicks the card's "דחייה", expects `page.getByRole('dialog')`
    to contain the seeker's name, and clicks the dialog's "דחייה". The existing "no actions remain" checks
    follow;
  - a final `test.step('phone 390x844')` sets that viewport and reloads the room's inbox. Then all four tabs
    share one `offsetTop`, `document.documentElement.scrollWidth <= innerWidth`, and the seeker's
    `match-ring` is inside the card's top row.

  The other inbox steps are `flatmates.spec.ts` (shortlist) and `people.spec.ts` (`applicant-mutual`, no
  `applicant-message`). They pass unchanged. — `web/e2e/inbox.spec.ts::ac12_shortlist_chat_decline`
- [ ] AC12 **Tokens only.** `grep -nE '#[0-9A-Fa-f]{3,8}\b|\[[0-9.]+px\]'` over `web/src/features/applicants/`,
  `web/src/features/match/MatchRing.tsx`, `ReasonList.tsx` and `web/src/components/ClampedText.tsx` finds
  nothing. Two exceptions:
  - the `<h2>`'s `[overflow-wrap:anywhere]` (not a px value), commented;
  - in `ApplicationStatusChip.tsx`, the seeker branch's `py-[5px] text-[13px]` span is excluded by name. It is
    not this spec's; `0009q` converts it. Only its owner branch is checked.

  0009h's `noColourLiterals` test covers hex app-wide. — the build digest quotes the grep
- [ ] NF1 `make lint`, `make test`, `make i18n-check`, `make build-web` and local `make e2e` are green on the
  final head (Speed rule 7). The e2e result goes in the digest. The coder also checks the clamp on a real
  6-line message at 390 px in `make dev` and says so in the digest.

## Tests to write
- **Component** (`ApplicantsPage.test.tsx`):
  - update the helpers: `filters()` / `filterButton` to the tablist / tab, `aria-pressed` → `aria-selected` for
    the filter only, `match-badge` → `match-ring`, the `<h1>` regexes;
  - rewrite the decline part of `ac5` with the dialog (focus first, then click);
  - add `ac6_disclosures_share_a_row` and `ac7_long_message_show_more`;
  - extend `ac4_applicant_card`, `ac8_mutual_tag` and `ac2_states` as the ACs say.
- **Unit**:
  - `MatchRing.test.tsx`, `ClampedText.test.tsx`;
  - the three kit cases (`PageHeader`, `Badge`, `Tabs`);
  - `RequireOwner.test.tsx`'s inbox title.
- **E2E**: `inbox.spec.ts` as in AC11. No new spec file and no new sign-up.
- **Screens**: `e2e/screens/applicants.screens.ts` (AC10), plus the config and the Makefile target if they are
  not there yet.

## Risks / open questions
- **Kit API.** The props come from `specs/0009d-ui-kit.md` §3. The two gaps that blocked this layout are fixed
  here, each with a test: `PageHeader` `title` is a string, so `eyebrow` is added, and `Badge` did not forward
  attributes. Tabs wrap, so `scrollable` is added. If the merged kit already has one of these, use it and drop
  the addition.
- **Shared files.**
  - `0009u` (the desktop half) builds on this spec.
  - `0009g`, `0009c` and `0009f` touch `ApplicantsPage` / `ApplicantCard` (see "How the siblings fit"). The
    second to merge rebases.
  - `ApplicationStatusChip.tsx`: this spec changes only its owner branch, and `0009q` changes the seeker
    branch.
  - `MatchChips` / `MatchBadge` are not edited here (0009i).
  - `ClampedText` is shared with `0009q`, and `MatchRing` / `ReasonList` may be reused by `0009j`. The first to
    merge creates each.
- **Harness name.** 0009i, 0009k and 0009q now point at this harness (`make screens`,
  `playwright.screens.config.ts`, `e2e/screens/`, `web/screens/`). The orchestrator is asked to confirm it as the
  one name.
- **ClampedText measuring.** jsdom has no layout, so the unit test stubs the heights and NF1 adds a real check
  at 390 px.
- **No product question for Gilad.** Every artboard element left out is out by a standing decision (ages,
  occupation, view count), has no behaviour today (kebab), or belongs to another spec (bottom bar, desktop
  pane).
- **FOLLOWUPS claimed** (line numbers as of `8c3c480`):
  - closed here: **72** (clamp + "הצגת עוד"; moved from 0009c by the orchestrator), **131** (score out of the
    name row), **152** (disclosures in one row), **172** (mutual tag in the name row);
  - **169**: its extraction half here (`RoomLine`, `DisclosureButton`, `ReasonList`). `0009p` closes it.
  - Line 147 is `0009b`'s and is not claimed here.
- Verifier round 1: 1 blocker, 9 majors and 13 minors on the original single 0009l, all applied. The verifier
  split it into this spec (phone layout and shared pieces) and `0009u` (desktop); `0009p` was already split off.
  The blocker (room answers shown open in the pane) and the selection-model findings live in `0009u`. Second
  round waived (one verifier round, Gilad).

Brand amendment (orchestrator, 2026-11-12, `specs/0009-brand-amendment.md`) applied as a spec edit without a verifier re-run: brand token names, accent ring and selected states, `warning` with words or an icon, bordered cards with no shadow, the mascot on empty states, and new copy in the brand voice.

## Digest (filled by orchestrator after verification)
See `/digest`.
