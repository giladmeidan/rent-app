---
id: 0009u
title: On a desktop, an owner's applicant inbox is InboxDesktop.dc.html — the stat tiles at the header's end, tabs and sort in one row, a two-column card grid and a sticky detail pane for the selected applicant — while phones keep 0009l's layout and behaviour is unchanged
status: in-progress
depends_on: [0009l]   # 0009l: the restyled card (this spec's `stacked` branch), MatchRing, ReasonList, ProfileFacts, RoomLine, DisclosureButton, the kit additions and the screenshot harness (0009l depends on 0009d + 0009h)
reviewers: [ux]   # quick route (Gilad 2026-11-12: a cosmetic, behaviour-unchanged spec gets one ux review; coder Sonnet/high). The spec session also greps its diff for raw-HTML rendering (dangerouslySetInnerHTML / innerHTML / linkify) and runs lint, test and e2e. Was: reviewers: [code, qa, ux, security]
estimate: 1 coder run   # coder Opus/medium: selection and focus logic, a second card branch, a new pane, the e2e desktop step; the desktop half of the verifier's 0009l split
---

## Goal
After this ships, `/me/listings/:id/applicants` at 1024 px and wider follows `design/screens-v1/InboxDesktop.dc.html`:
- the stat tiles sit at the inline end of the page header, and the tabs and sort share one row;
- the applicant cards form a grid: one column at 1024–1279 px, two from 1280 px. Each card is compact: a
  2-line message preview, no disclosures, its own actions. Clicking a card selects it;
- a sticky detail pane beside the grid shows the selected applicant: the head with the large score ring, the
  housing facts, the reasons, the questionnaire answers behind "עוד פרטים" for a room, the full message, and the
  chat link once shortlisted.

Below 1024 px, `0009l`'s one-column layout is unchanged. What the owner can do is unchanged: no data, filter,
sort, action, error or focus rule changes. This serves PRODUCT.md "Applications" (screen 9 of the Product
Plan). It is Slice 9b, the desktop half that the verifier split from `0009l`.

## Scope
**In:**

1. **Layout switch.** `ApplicantsPage` reads the kit's `useIsDesktop()` (`web/src/components/useMediaQuery.ts`,
   `(min-width: 1024px)`, Tailwind `lg`). It is `false` without `window.matchMedia` (jsdom), so every existing
   component test keeps the phone layout.
   - `ApplicantCard` gets `layout: 'stacked' | 'compact'`: `stacked` is `0009l`'s card, unchanged; `compact` is
     item 4. The page passes `isDesktop ? 'compact' : 'stacked'`.
   - Why JS and not CSS: the two layouts have different controls. Compact drops two disclosures and gains a
     select button. A CSS-only switch would leave hidden duplicates in the DOM.
   - Every existing e2e runs at Playwright's default 1280×720, which is this desktop layout (AC8).

2. **Width.**
   - Every return path of `ApplicantsPage` uses `PageContainer width="wide"`. Update 0009h's
     `web/src/app/__tests__/pageWidths.test.ts` row for `ApplicantsPage.tsx` from `default` to `wide`, as `0009i`
     does for search.
   - Below `lg` the phone list keeps today's measure: the stacked `<ul>` gets `max-w-page`, so a tablet does not
     stretch a card to 960 px. The header and tiles are full width.

3. **Header and tabs row on desktop.**
   - The stat tiles move into `PageHeader`'s `actions` when `isDesktop`. Below `lg` they stay right after the
     header, as in `0009l`.
   - On desktop each tile is `lg:min-w-32` (InboxDesktop: 120 px). Total and new turn `bg-surface border
     border-border`, and shortlisted stays `bg-accent-soft text-accent-strong`.
   - The tabs row: when `isDesktop`, the `Tabs` and the sort group sit in one
     `<div class="flex items-end justify-between gap-3 border-b border-border">`, with the tabs at the inline
     start and the sort at the inline end ("ממוין לפי ציון התאמה" in InboxDesktop).
   - The `Tabs` list's own bottom border stays. Two 1 px lines meet at the same y, so no double line shows.
     If they do not, pass `className="border-b-0"` (layout only) to the row's `Tabs`.

4. **The compact card** (`layout === 'compact'`). It is the same component, and these parts differ from stacked:
   - **Root.** `Card as="article" … radius="card" className="relative flex flex-col gap-3"`, with
     `variant="selected"` when `selected` (brand: an accent border and **no shadow**; the artboard's shadow is overridden).
   - **Avatar.** `bg-accent-soft text-accent-strong` when `selected`, neutral otherwise.
   - **Selection control.** The `<h2>`'s text is
     `<button type="button" aria-controls={paneId} aria-current={selected ? 'true' : undefined} onClick={onSelect}>{name}</button>`,
     styled as the heading's text (no chrome) with the kit `focusRing`.
     - It is the card's stretched control: `after:absolute after:inset-0` on the button, so a click anywhere on
       the card selects it.
     - Only the action row and its alert line get `relative z-10`. They sit above the stretched area and keep
       their own action.
     - The badges, chips and text stay under it. Clicking them selects the card.
     - `Card interactive` is not used: its ring is `has-[a:focus-visible]`, which never fires for a `<button>`.
   - **Message preview.** For `source !== 'like'`: a plain
     `<p data-testid="applicant-message" dir="auto" class="line-clamp-2 whitespace-pre-line break-words text-body-sm text-ink-muted">`
     with text children only.
     - It has no `ClampedText` and no "הצגת עוד": the pane shows the full message, so the clamp hides nothing.
     - InboxDesktop's cards have no message. The preview is a design choice for scanning many applicants, and
       the ux reviewer judges it.
   - **No disclosures.** Their content is in the pane.
   - The top row, ring, badges, chips and action row are `0009l`'s, unchanged. The ring stays `md` with its
     label, a 4 px difference from InboxDesktop's 48 px, unlabelled card ring, accepted for one look across
     widths.
   - New props: `selected?: boolean`, `onSelect?: () => void`, `paneId?: string`. They are used only by compact.

5. **Selection model** (`ApplicantsPage`, desktop only).
   - State `selectedId: string | null`, initially `null`.
   - The selected applicant is derived on each render: `shown.find((a) => a.id === selectedId) ?? shown[0]`.
     `shown` is the filtered and sorted list.
   - The rules:
     - **a sort change** keeps the selection (the applicant is still in view);
     - **a tab change** (`Tabs.onChange`) also sets `selectedId` to `null`, so the new tab opens on its first
       card. Selecting B, going to "new" and back to "הכל" shows the first card, not B;
     - **a status change that keeps the card in view** keeps it selected;
     - **one that takes it out of view** falls back to the first card shown;
     - **an empty view** (`applicants.emptyFilter`) renders no pane.
   - Focus and announcements:
     - selecting moves no focus and announces nothing, and the page's existing announcement and focus rules are
       unchanged;
     - keyboard users select with the name button and reach the pane by Tab after the grid, or by landmark
       navigation (`complementary` "פרטי המועמדות").
   - Below `lg`, `selectedId` is kept and ignored. A resize back to desktop shows it again if it is still in view.

6. **The detail pane** (new `features/applicants/ApplicantPane.tsx`, props `{ id, applicant, spots, flatLifestyle,
   flatIsRoom }`). It is rendered as `<ApplicantPane key={selected.id} …>`. The key remounts it on every new
   selection, so its scroll position starts at the top and its "עוד פרטים" disclosure starts closed.
   - **Container.** `<aside id={id} aria-label={t('applicants.pane.label')} tabIndex={0}>` with
     `w-96 flex-none self-start sticky top-6 max-h-[calc(100dvh-3rem)] overflow-y-auto rounded-lg` and the kit
     `focusRing`.
     - `tabIndex` makes the scrolling pane keyboard-scrollable when it is taller than the viewport, as with a
       500-character message with line breaks and seven answers. Axe's `scrollable-region-focusable` would flag
       it otherwise.
     - The `calc` is viewport-relative, so no token fits. The code says so in a comment.
     - 0009a's top bar is not sticky, so `top-6` is plain.
   - Inside it is a `Card radius="card" padding="md" className="flex flex-col gap-4"`. It stays the default
     `div`, never an `article`, so `getByRole('article')` still finds cards only.
   - **Content**, in this order (InboxDesktop's aside, adapted to the data the API has):
     1. **Head** `flex items-center gap-3`:
        - the avatar, `size-14`, `bg-accent-soft text-accent-strong`;
        - a column `min-w-0 flex-1` with:
          - the `<h2>` name (`font-display text-h2 [overflow-wrap:anywhere]`);
          - a badge row: the status `Badge` (`data-testid="pane-status"`), plus the mutual `Badge` for
            `source === 'like'`;
          - `RoomLine` for a room applicant;
          - `applicants.appliedAt`;
        - `MatchRing size="lg"` with no label, or the `match.noScore` `Badge`.
     2. **Facts**: `ProfileFacts` when `profile !== null` (InboxDesktop's facts grid).
     3. **Reasons**, when `profile !== null && match !== null`: a `<section>` with
        `<h3 class="text-h3">{t('applicants.why')}</h3>` and the `ReasonList` of `ownerReason`
        lines, open as InboxDesktop draws them. PRODUCT.md "Rooms" lists reasons among what the inbox shows.
     4. **Questionnaire answers**, when `room !== null`, **behind a closed disclosure** (PRODUCT.md "Rooms": the
        answers sit behind a "see more", and never show on apartment applications):
        - `DisclosureButton` with `applicants.more`, `controls={`${id}-more`}` and `describedBy` the pane's
          `<h2>` id;
        - `<div id={`${id}-more`} hidden={!open}>` with `RoomDetails`.
     5. **Message**, when `source !== 'like'`: a `<section>` with `<h3>{t('applicants.pane.message')}</h3>`, then
        `<p data-testid="pane-message" dir="auto" class="whitespace-pre-line break-words rounded-md bg-surface-subtle px-3 py-3 text-body-sm text-ink">`
        with the full message. It has text children only and no clamp.
     6. **Chat**, when `status === 'shortlisted'`:
        `<Button to={`/chat/${applicant.id}`} variant="secondary" fullWidth icon={<ChatIcon />}>{t('applicants.pane.chat')}</Button>`.
   - The pane has **no** shortlist, decline or "הצעת סיור" buttons (see Risks), and no live region.
   - **Page layout** inside the `TabPanel`, desktop:
     - `<div class="flex items-start gap-6">`, holding first the cards
       `<ul class="grid min-w-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-2">`, then the pane;
     - two columns from 1280 px, as InboxDesktop at 1280. At 1024–1279 two columns would each be under 280 px,
       so the grid stays at one;
     - in RTL the grid sits at the inline start (right) and the pane at the inline end (left), as the artboard.

7. **`web/src/locales/he.json`**, new keys only:

   | Key | Hebrew |
   | --- | --- |
   | `applicants.pane.label` | "פרטי המועמדות" |
   | `applicants.pane.message` | "הודעה אישית" |
   | `applicants.pane.chat` | "פתיחת צ'אט" (brand: buttons start with the action noun) |

8. **Screenshots.** `web/e2e/screens/applicants.screens.ts` (`0009l`'s script) gains the desktop states listed in
   "UI". Its 1440 PNGs now show this layout. Output goes under `web/screens/0009u/`.

**Out:**
- The phone layout, the shared pieces and the kit additions (`0009l`). The people page (`0009p`).
- Status actions and a tour button in the pane (see Risks).
- `0009g`'s "moved out" line and 404 handling (it sits between the tabs row and the `TabPanel`, full width).
- The wording of existing keys (`0009b`). Focus and axe beyond the pane's label and tab stop (`0009c` / `0009t`).

**New dependencies:** none.

## Data
None.

## API
None.

## UI
Artboard: `design/screens-v1/InboxDesktop.dc.html` (1280; checked at 1440×900, with 1280×720 covered by the e2e
suite). The elements shared with the phone layout are `0009l`'s gap list. These are the desktop-only ones.

### Gap list (InboxDesktop.dc.html → today → this spec)
| # | Element | Artboard | Today (8c3c480) | 0009u |
| --- | --- | --- | --- | --- |
| D1 | Page width | content up to 1400 px, 32 px gutters | `Layout`'s 640 px column | `PageContainer wide` (1336 px, the kit's `lg:px-8` gutters) |
| D2 | Back | "כל המודעות", 13 px muted, chevron | `BackToMine` | `0009l`'s `BackLink`. The label stays "חזרה למודעות שלי" (`0009b`'s wording) |
| D3 | `<h1>` | the listing title, 28/800 | "מועמדויות" | `0009l`'s eyebrow + title at `lg:text-display` (28). The eyebrow stays, because there is no global "מועמדויות" nav item to name the page |
| D4 | Meta line | "7,200 ₪ · פורסם לפני 6 ימים · 214 צפיות" | price only | the price only. No views (PRODUCT.md "Applications"); "published N days ago" is not shown today (out) |
| D5 | Stat tiles | at the header's inline end, white with a border / tint, min 120 px | in the body | in `PageHeader` `actions`, `lg:min-w-32`, white / tint |
| D6 | Tabs + sort | one row with a bottom border, tabs at the start, "ממוין לפי ציון התאמה" at the end | two rows | one row; sort = `0009l`'s pills |
| D7 | Card grid | 2 columns, gap 14 | one column | `grid-cols-1 xl:grid-cols-2 gap-3` |
| D8 | Selected card | 1.5 px accent border, shadow, tint avatar | — | `Card variant="selected"` (accent border, no shadow), `accent-soft` avatar, `aria-current` on the name button |
| D9 | Card content | no message, no disclosures, ring 48 without a label | — | 2-line message preview (design choice), no disclosures, ring `md` with its label |
| D10 | Card actions | 42 px buttons | — | `0009l`'s 44 px kit buttons (the kit's minimum target) |
| D11 | Pane | 380 px white aside, radius 20, padding 22, gap 18 | none | `aside` `w-96` (384), `Card radius="card" padding="md"` (brand `rounded-lg` 16, padding 16, `border`, no shadow), `gap-4`, sticky |
| D12 | Pane head | avatar 60, name 20/800, shield "מאומתים בטלפון · הגישו לפני 3 שעות", ring 60 | — | avatar 56 (`size-14`), name `text-xl`, status + mutual badges, `RoomLine`, `applicants.appliedAt` (absolute date, as today), ring `lg` 56. No phone-verified line (no phone collected, PRODUCT.md "Signup data") |
| D13 | Facts | ages, household, occupation, move-in (flexible), contract, pets | (in the card's disclosure) | `ProfileFacts`: household, move-in, contract, pets, smoker, parking. No ages or occupation (PRODUCT.md "Matching") |
| D14 | Reasons | "למה ההתאמה גבוהה" + tick / "!" lines | (in the card's disclosure) | `<h3>` `applicants.why` + `ReasonList`. One heading for every score |
| D15 | Room answers | — | (the card's "עוד פרטים") | a closed `DisclosureButton` + `RoomDetails` (PRODUCT.md "Rooms") |
| D16 | Message | "הודעה אישית" + grey box | (on the card) | `<h3>` `applicants.pane.message` + the box, full text |
| D17 | Pane actions | shortlist (48 px primary), chat, "הצעת סיור", decline | — | the chat link only, for shortlisted. No status actions and no tour (Risks) |
| D18 | Top nav | brand, links, avatar | `Layout` header | `0009a` |

### Desktop layout (≥ 1024 px, checked at 1440×900)
From the top:
- `PageHeader`, with the tiles at its inline end;
- the `gone` alert;
- the tabs + sort row;
- the grid and the sticky pane. The first card of the view is selected on load.

At 1440 the grid is two columns of about 460 px, and the pane is 384 px. Nothing scrolls horizontally at 1024
or 1440.

### States (desktop screenshots, added to the script)
- `d-all` (five applicants, the first selected);
- `d-selected-shortlisted` (the shortlisted card selected: the pane's chat link);
- `d-selected-noscore` (pre-Slice-6: head and message only);
- `d-room` (a room applicant, the pane's "עוד פרטים" open);
- `d-mutual` (no message section);
- `d-long-message` (the preview clamped, the pane scrolled to show the full text);
- `d-filter-empty` (no pane);
- `d-decline-dialog`;
- `d-loading`, `d-error`, `d-not-found`, `d-empty`;
- `d-1024` (one grid column next to the pane; captured with `page.setViewportSize({ width: 1024, height:
  768 })` in the desktop project).

## Acceptance criteria
Component tests opt in to desktop with a `stubDesktop(matches = true)` helper:
- it calls `vi.stubGlobal('matchMedia', (q: string) => mql(q))`, where `mql` returns
  `{ matches: matches && q === '(min-width: 1024px)', media: q, addEventListener, removeEventListener }`. Only
  the desktop query is true, so a reduced-motion query stays false;
- it keeps the listeners, so a test can fire `change`;
- the existing `vi.unstubAllGlobals()` clears it.

- [ ] AC1 **Pane content.** On desktop, with applicants A (score 94, a profile, a message), B (shortlisted) and C
  (a room applicant with answers):
  - a `complementary` landmark named "פרטי המועמדות" holds:
    - A's name as `<h2>`, `pane-status` "חדש", and a `match-ring` with no "התאמה" label;
    - the `ProfileFacts` rows;
    - the `<h3>` "למה ההתאמה?" with A's `ownerReason` lines;
    - `pane-message` with A's full message;
  - A's name button has `aria-current="true"`, and the other cards' have none;
  - the cards have no "למה ההתאמה?" or "עוד פרטים" button, and each `applicant-message` has `line-clamp-2`;
  - clicking B's name button moves `aria-current` to B. The pane then shows B and a link "לצ'אט" to
    `/chat/{B.id}`.

  — `web/src/features/applicants/__tests__/ApplicantsPage.test.tsx::ac1_desktop_pane`
- [ ] AC2 **Room answers stay behind "עוד פרטים"** (PRODUCT.md "Rooms"). Selecting C shows "עוד פרטים" with
  `aria-expanded="false"`, and its panel is `hidden`. A click opens `RoomDetails` with the differing line.
  Selecting A then C again shows it closed. An apartment applicant's pane has no "עוד פרטים" and no answers. —
  `ApplicantsPage.test.tsx::ac2_pane_room_answers_behind_more`
- [ ] AC3 **Selection follows the view.** On desktop:
  - select B, then sort by date: B is still selected;
  - choose "חדשות" (B is shortlisted): the pane shows that tab's first card;
  - back to "הכל": the first card is selected, not B;
  - choose a tab with no cards: `applicants.emptyFilter`, and no `complementary`;
  - under "הכל", shortlisting A from its card sends one PATCH, leaves A selected, and does not move focus to the
    pane;
  - a click on C's card body (its chips) selects C, and a click on C's "לרשימה הקצרה" shortlists without
    selecting. jsdom has no layout to prove the overlay, so the e2e checks the real click.

  — `ApplicantsPage.test.tsx::ac3_desktop_selection_follows_view`
- [ ] AC4 **Breakpoint switch.** Starting on desktop, a `change` event to `matches: false` re-renders the stacked
  layout: no `complementary`, the disclosures back on the cards, and no name button. Back to `true`, the pane
  returns with the previous selection if it is still in view. — `ApplicantsPage.test.tsx::ac4_breakpoint_switch`
- [ ] AC5 **Desktop header.** On desktop, `applicant-totals` is inside the `PageHeader`'s actions container (the
  `<h1>`'s row). The tabs and the sort group share one parent row element. Below `lg`, the tiles come after the
  `PageHeader`. — `ApplicantsPage.test.tsx::ac5_desktop_header_row`
- [ ] AC6 **Width.** `pageWidths.test.ts` maps `ApplicantsPage.tsx` to `wide`, and the file passes
  `width="wide"` on every `PageContainer`. — `web/src/app/__tests__/pageWidths.test.ts::ac4_page_roots_use_page_container`
  (the row updated)
- [ ] AC7 **Visual check.** `make screens` writes the desktop states at 1440×900 (plus `d-1024`) under
  `web/screens/0009u/`. The spec session hands the folder and gap list D1–D18 to the ux reviewer, who compares
  each screenshot with `InboxDesktop.dc.html` row by row for layout, and with `design/brand/` for colour, type, shape and voice. The 390 set is re-captured to show that the phone
  layout is unchanged. The digest gives the PNG count and the verdict. — `web/e2e/screens/applicants.screens.ts`
  (measurement)
- [ ] AC8 **E2E** (no new sign-up). In `web/e2e/inbox.spec.ts::ac12_shortlist_chat_decline`:
  - Right after the "my listings" link checks, `page.setViewportSize({ width: 390, height: 844 })`. The inbox
    steps, including `0009l`'s phone step, then run the stacked layout with today's selectors.
  - A final `test.step('desktop 1440x900')` sets 1440×900 and opens the room's inbox:
    - `page.getByRole('complementary', { name: he.applicants.pane.label })` shows the seeker's name as `<h2>`,
      `ROOM_LINE`, `pane-message` with `MESSAGE`, and `he.match.owner.budget.agree`;
    - the pane's `he.applicants.more` button is `aria-expanded="false"`. Clicking it shows
      `he.applicants.room.differs`;
    - the card has no `he.applicants.why` / `he.applicants.more` button, and its name button
      (`getByRole('button', { name: SEEKER_NAME })`) has `aria-current="true"`;
    - `document.documentElement.scrollWidth <= innerWidth`;
    - on the apartment's inbox, `pane-status` reads `he.applicants.status.declined` and the pane has no link.
  - At the default 1280×720, the desktop layout, these pass unchanged:
    - `flatmates.spec.ts`'s inbox step, which clicks the compact card's "לרשימה הקצרה". It proves that the
      overlay leaves the action row clickable;
    - `people.spec.ts`'s, which reads `applicant-mutual` and no `applicant-message` in the compact card.

  — `web/e2e/inbox.spec.ts::ac12_shortlist_chat_decline`, `web/e2e/flatmates.spec.ts`, `web/e2e/people.spec.ts`
- [ ] AC9 **Tokens only.** `grep -nE '#[0-9A-Fa-f]{3,8}\b|\[[0-9.]+px\]' web/src/features/applicants` finds
  nothing. The pane's `max-h-[calc(100dvh-3rem)]` and the `<h2>`s' `[overflow-wrap:anywhere]` are the only
  arbitrary values (not px), each with a code comment. — the build digest quotes the grep
- [ ] NF1 `make lint`, `make test`, `make i18n-check`, `make build-web` and local `make e2e` are green on the
  final head (Speed rule 7). The e2e result goes in the digest.

## Tests to write
- **Component** (`ApplicantsPage.test.tsx`): the `stubDesktop` helper, and `ac1_desktop_pane`,
  `ac2_pane_room_answers_behind_more`, `ac3_desktop_selection_follows_view`, `ac4_breakpoint_switch` and
  `ac5_desktop_header_row`. The existing tests stay on the phone layout, with no stub, and pass unchanged.
- **Unit**: the `pageWidths.test.ts` row.
- **E2E**: `inbox.spec.ts` as AC8 (one viewport line and the desktop step). No new sign-up.
- **Screens**: the desktop states in `applicants.screens.ts`.

## Risks / open questions
- **No status actions in the pane** (D17). This is a deliberate deviation: the artboard repeats shortlist and
  decline there.
  - Two live sets of status controls for one applicant would need one in-flight guard across two
    `useSetApplicantStatus` instances. They would also double the focus rules and the `buttonsOf` / e2e
    expectations.
  - The selected card's actions stay one glance away, beside the pane.
  - "הצעת סיור" would be new behaviour (a chat deep link with the tour template). It is the chat composer's chip
    (PRODUCT.md "Chat").

  The ux reviewer judges this. It is not a product question.
- **e2e at 1280.** Playwright's default viewport is this layout. So the compact card keeps the badges, the
  actions and the `applicant-message` element, and only the two disclosures move to the pane.
- **The stretched control.** If the overlay covered the action row, a click on "לרשימה הקצרה" would select
  instead of shortlist. `flatmates.spec.ts` at 1280 catches it, and AC3 covers the jsdom side.
- **The `tabIndex={0}` pane** adds one tab stop on desktop. It is needed for keyboard scrolling.
- **Shared files.** `0009l` (the base); `0009g` / `0009c` / `0009f` (see `0009l`'s "How the siblings fit"); 0009h's
  `pageWidths.test.ts`. The second to merge rebases.
- **No product question for Gilad.** Every element left out is out by a standing decision (ages, occupation,
  phone, view count) or has no behaviour today (tour button, "published N days ago").
- **FOLLOWUPS claimed:** none; `0009l` has them.
- Verifier round 1 (run on the single 0009l before the split) had 1 blocker, 9 majors and 13 minors. All are
  applied: the blocker in item 6.4 / AC2, and the selection, focus, overlay and sticky findings in items 4–6.
  Second round waived (one verifier round, Gilad).

Brand amendment (orchestrator, 2026-11-12, `specs/0009-brand-amendment.md`) applied as a spec edit without a verifier re-run: brand token names, accent ring and selected states, `warning` with words or an icon, bordered cards with no shadow, the mascot on empty states, and new copy in the brand voice.

## Digest (filled by orchestrator after verification)
See `/digest`.
