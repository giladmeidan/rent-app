---
id: 0020a
title: A chat thread opens with a short header and its messages, not a stack of captions, buttons and cards
status: verified
depends_on: []   # web only, over the existing API
reviewers: [ux]   # cosmetic: the same controls and states, moved and restyled (Speed rule 4); coder Sonnet/medium
estimate: 1 coder run (small)
---

## Goal
Gilad, 2026-11-17: the chat thread "feels too crowded with information", and that information sits in the
middle of the chat. Today up to six blocks stack between the name and the first message
(`web/src/features/chat/ChatThreadPage.tsx` `Thread`, lines ~234–301): the member line, a caption row with the
listing and two or three buttons, a full-width warning card, the tour card (heading, text, buttons), and the joined
and truncated notes. On a phone that fills most of the first screen. After this ships the listing (or "mutual
match") is the header's subtitle, the rarely used actions sit behind one "פעולות" disclosure, the tour card is one
slim row, and the safety warning is a quiet system line just above the messages. Gilad approved this layout from a
sketch on 2026-11-17 (before/after mockup in the orchestrator session).

## Scope
**In:**
- `web/src/features/chat/ChatThreadPage.tsx`, `Thread` only:
  - **Subtitle.** `PageHeader` gets `subtitle` (its existing string prop, rendered `text-body-sm text-ink-muted`):
    a listing chat → `` `${cardTitle(t, thread.listing)} · ${formatIls(thread.listing.price_ils)} ${t('listings.units.ils')}` ``
    (today's caption text, same pieces); a direct chat → `t('chat.thread.direct')`. `MemberLine` stays where it
    is (right after the header, group chats only), unchanged.
  - **Actions disclosure.** `PageHeader` gets `actions={<DisclosureButton …>{t('chat.thread.actions')}</DisclosureButton>}`,
    reusing `web/src/features/applicants/DisclosureButton.tsx` as `PersonCard` already does (ghost `sm` Button,
    `aria-expanded`, `aria-controls`, chevron that turns). State: `const [actionsOpen, setActionsOpen] = useState(false)`;
    the panel id from the existing `useId` import. `Thread` is keyed by the chat id, so another chat starts closed.
    Right after `MemberLine` (or the header when there is none): `<div id={actionsId} hidden={!actionsOpen}
    className={actionsOpen ? 'flex flex-wrap items-center gap-2' : undefined}>` — the class only while open, as
    `PersonCard` does (`PersonCard.tsx:175–177`): with Tailwind 3.4 the `.flex` utility overrides preflight's
    `[hidden] { display: none }`, so a permanent `flex` class would leave the panel visible in a real browser while
    the jsdom tests still pass. The panel holds, in this order and with today's props and conditions
    unchanged: the listing `Button` (`toApplicants` for the owner, `toListing` otherwise; listing chats only), the
    "remove the match" `Button` (direct chat while `can_send`, with `busy` and `onRemoveMatch`), and `reportButton`.
    The `removeFailed` alert moves out of the old caption row to directly under the panel, outside it, so it shows
    even if the panel is closed. The confirm dialog, `removing` ref and the closed-note focus logic stay as they are.
  - **Delete** the old caption rows: the listing `<div>` and the direct-chat `<div>` (lines ~244–287); their
    content now lives in the subtitle and the panel.
  - **Warning line.** The `<p role="note">` moves from above `TourCard` to below it, as the first of the system
    lines (warning, then joined, then truncated), so the order is: header, member line, panel, alert, tour card,
    system lines, log, composer. It keeps `role="note"` and the `chat.thread.warning` text (no copy change), and its
    class becomes `` `${systemLine} flex items-start gap-1.5 text-start` `` (the existing centred caption pill, with
    the mark inline; `text-start` because a two-line sentence reads badly centred in RTL). `WarningMark` shrinks to
    `width`/`height` 14 (it is used only here).
- `web/src/features/tours/TourCard.tsx`, layout only: `<Card padding="sm" className="flex flex-wrap items-center
  gap-x-3 gap-y-2">` (was `padding="md"`, `flex flex-col gap-3`); the `<h2>` class becomes `text-label
  focus:outline-none` (was `text-h3 …`), keeping its `ref`, `tabIndex={-1}`, level and `tours.card.title` text, so
  focus after a booking/move/cancel still lands on it. The booked/owner-hint `<p>`s become `text-body-sm`. The
  error `<p role="alert">` gets `basis-full` so it takes its own row. Drop `className="self-start"` from the
  "book" and "tours page" `Button`s (in a row it pins them to the top instead of centring them; it existed only
  for the old column). The closed `<dialog>`s (`SlotPicker`, the confirm) are `display: none`, so they take no
  slot or gap in the row. Button props otherwise, `SlotPicker`, the confirm dialog and every branch (`tour`, seeker, owner, nothing for a flatmate/direct chat) are unchanged.
- `web/src/locales/he.json`: one new key `chat.thread.actions` = "פעולות".
- Tests (vitest, `web/src/features/chat/__tests__/ChatThreadPage.test.tsx`): a local helper
  `openActions()` (clicks the button named `he.chat.thread.actions`) is called **before every assertion about the
  listing link, the remove-match button or the report button, including the `queryBy… toBeNull()` ones** — a
  `hidden` panel drops its content from the accessibility tree, so without opening it an absence check passes
  whatever the code does. Known sites (line numbers on `main`): 96–100, 124–128, 632, 649–656, 686, 707, 1035–1038
  (`button.closest('div')` is then the panel, which still holds the listing link), 1060, 1075 (group chat's report
  click), 1094–1095, 1135, 1148–1200 (both remove-match tests; the panel stays open through the confirm, so one
  `openActions()` after the first `h1` per render), 1211 and 1219 (`queryByRole('button', { name })`, one call per
  render), 1261. Three assertions are rewritten, not just preceded by `openActions()`:
  - ~1061 `report.closest('div')).toHaveTextContent(he.chat.thread.direct)` → the subtitle is there
    (`getByText(he.chat.thread.direct)` is the header's `<p>`).
  - ~1092 `caption).toHaveClass('text-caption', 'text-ink-muted')` → `toHaveClass('text-body-sm', 'text-ink-muted')`
    (`PageHeader`'s subtitle class).
  - ~1155–1156 `caption.parentElement).toContainElement(removeButton())` → the remove button is inside the panel
    (`document.getElementById(toggle.getAttribute('aria-controls'))`).
  The `getByRole('note')` assertions (101, 147, 681, 1096) and `ChatLayout.test.tsx:189` keep passing unchanged.
- e2e (edited, **run only in CI**, never locally): click `getByRole('button', { name: he.chat.thread.actions })`
  before `e2e/inbox.spec.ts:114` (report) and `:133` (to applicants), `e2e/people-market.spec.ts:103` (remove match),
  and `e2e/screens/market-people.screens.ts:345` (`chat-direct`) and `:353` (`chat-direct-confirm`, a separate screen
  with its own page load, so it needs its own click). Each `page` opens its own panel (`inbox.spec.ts:114` is the
  seeker's page, `:133` the owner's).
  `e2e/inbox.spec.ts:87` (`getByRole('note')`) is unchanged.

**Out:** an avatar in the header and an icon-only "⋮" menu (the sketch had both; the existing `DisclosureButton`
does the job without a new shared menu component); any copy change to the warning; the composer, bubbles, sender
runs, `MemberLine` (FOLLOWUPS 0008f stays open), the closed-chat card and unsent draft; `Removed` / not-found /
loading branches; the chat list.

**New dependencies:** none.

## Data / API
None.

## UI
No artboard (`design/` has no chat thread screen); kit components and `design/brand/` tokens. RTL: the
disclosure sits at the header row's inline end (left), as `PageHeader` places `actions`; logical properties only.
States are today's: loading/error/not-found/removed untouched; empty thread shows the mascot under the system
lines as now; a closed chat keeps its panel with whatever applies (report always, listing link for listing chats,
no remove-match once closed). A deleted account (`other_name` null) keeps its report title and subtitle. At 320 px
the header's title and "פעולות" wrap as `PageHeader` already allows (`flex-wrap`); the tour row wraps its buttons
under the text. i18n: one key added (`chat.thread.actions`).

## Acceptance criteria
- [ ] AC1 A listing chat (seeker and owner) and a direct chat show their caption as the header subtitle (`<p>` inside
  the `PageHeader`, text equal to the caption) and no caption row below it; the "פעולות" button has
  `aria-expanded="false"` and `aria-controls` naming a `hidden` element; the listing link, remove-match and report
  buttons are not in the accessibility tree until it is clicked, then are (`aria-expanded="true"`), the listing link
  before report in a listing chat and remove match before report in an open direct chat; a second click hides them
  again — `ChatThreadPage.test.tsx::ac1_actions_behind_disclosure`
- [ ] AC2 The warning `role="note"` comes after the tour card's `<h2>` (when there is one) and before the
  `role="log"` element in DOM order, keeps the `chat.thread.warning` text, and precedes the joined/truncated
  lines — `ChatThreadPage.test.tsx::ac2_warning_is_a_system_line_above_the_log`
- [ ] AC3 A failed remove-match shows its alert with the panel closed (click the toggle again after the failure;
  the alert stays visible) — added to the existing remove-match failure test in `ChatThreadPage.test.tsx`
- [ ] AC4 Every existing `ChatThreadPage.test.tsx`, `ChatLayout.test.tsx` and `TourCard.test.tsx` test passes, with
  only the `openActions()` calls and the three rewritten assertions (~1061, ~1092, ~1155) changed (TourCard's heading/focus tests,
  lines ~69–116, unchanged); `make lint`, `make test`, `make i18n-check` green; CI e2e green.
- [ ] AC5 The ux reviewer checks a listing chat (seeker with a booked tour, owner with the hint), a direct chat and a
  group chat in the running app at 320, 390 and 1280 px: the first message is visible on the first screen at 390 px
  with a booked tour, no horizontal scroll, the tour card is one row (wrapping only its buttons), focus moves to the
  tour heading after a booking.

## Tests to write
Unit: AC1, AC2 (new tests), AC3 (one assertion in an existing test), AC4 (edits listed in Scope). E2E: the four
edits in Scope; no new e2e (CI only; never run e2e locally).

## Blast radius
`graphify affected` on `main`'s graph, 2026-11-17.
- `ChatThreadPage` / `Thread` — route in `web/src/app/routes.tsx`; tests through `chat/__tests__/harness.tsx`
  (`ChatThreadPage.test.tsx`, `ChatLayout.test.tsx`) and `auth/__tests__/RequireUser.test.tsx`; the other app-level
  tests (`App.tsx`, `Layout.test.tsx`, `KitPreview.test.tsx`, …) only mount the route table and never open a thread.
  e2e: `inbox.spec.ts`, `people-market.spec.ts`, `screens/market-people.screens.ts` (edited, see Scope).
- `TourCard` — only caller `Thread`; test `tours/__tests__/TourCard.test.tsx` (queries by role and name, no class
  assertions on the card), unchanged.
- `DisclosureButton` — reused, not changed; callers `ApplicantCard`, `ApplicantPane`, `MyApplicationsPage`,
  `PersonCard` are untouched.
- `PageHeader` — `subtitle` and `actions` are existing props; not changed.

## Risks / open questions
- Report is one tap further away (behind "פעולות"). Gilad approved this in the sketch (2026-11-17). Checked: 0011d
  AC1 places the button "in the caption row" (superseded here) but no AC requires it visible without interaction;
  PRODUCT.md "report button everywhere" still holds.
- `hidden` on the panel, not conditional rendering: it keeps the `ReportButton`'s mounted dialog and the
  remove-match `busy` state alive. The `ReportDialog` stays inside the panel (no move): `showModal()` puts it in the
  top layer, so the panel's flex layout does not affect it, and while it is open the page is inert, so the toggle
  cannot hide the panel under it. Focus returns to the report button on close, which is still visible. The
  remove-match confirm is rendered outside the panel (`{confirmDialog}` at the end of `Thread`), unchanged.
- None for Gilad.

## Verifier notes
- Panel class only while open (PersonCard pattern): Tailwind 3.4 `.flex` beats `[hidden]`, so the spec's markup
  would never hide in a browser.
- Test sites: added 1075, 1211, 1219 and the two broken assertions at ~1092 (subtitle class) and ~1155 (caption's
  parent held the remove button); AC4 updated to match.
- e2e: `market-people.screens.ts:353` is its own page load, needs its own click.
- TourCard: drop `self-start` from the two buttons in the row layout.
- AC1 order made testable (listing link and remove match never coexist); toggle-closes check added.
- Risks resolved: dialog stays in the panel (top layer, page inert while open); 0011d has no visibility AC.

## Digest (filled by orchestrator after verification)
See `/digest`.
