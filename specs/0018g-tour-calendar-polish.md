---
id: 0018g
title: The tour calendar's month bar uses arrow buttons on one row, and the seeker's slot picker opens in a wider, taller dialog
status: verified
depends_on: []   # 0018f is merged (PR #125)
reviewers: [ux]   # cosmetic: behaviour unchanged (Speed rule 4); coder Sonnet/medium
estimate: 1 coder run (small)
---

## Goal
Gilad, 2026-11-17, after trying 0018f as a seeker: the month bar reads as three stacked lines of text
("החודש הקודם" / "נובמבר 2026" / "החודש הבא"; in his tab the two buttons even showed the raw keys
`tours.calendar.prevMonth` / `nextMonth`), and the picker dialog is too narrow and short for a calendar. After this
ships the month bar is one row (arrow, month, arrow) on both tour screens, and the seeker's picker is wider and
taller. Spec 0018f (`specs/archive/0018f-tour-calendar.md`) stays as written otherwise.

## Scope
**In:**
- `web/src/features/tours/MonthCalendar.tsx`, month bar only:
  - prev/next become the kit's icon-only buttons: `<Button variant="ghost" size="sm" aria-label={…} icon={<svg…/>}
    className="shrink-0" />` with **no children**. `Button` then renders square by itself (`Button.classes.ts`:
    `iconOnly` → `px-0 w-tap`, plus `min-h-tap`) and wraps `icon` in an `aria-hidden` span; `className` stays
    layout-only (`shrink-0`, so the row never squeezes a button below 44 px). `aria-label` =
    `t('tours.calendar.prevMonth')` / `t('tours.calendar.nextMonth')` (existing keys, now the accessible name, not
    visible text). The icon is the chevron `BackLink` draws in `web/src/components/PageHeader.tsx` (`width`/`height`
    20, `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, `strokeWidth="2"`, round caps/joins, path
    `M9 6l6 6-6 6`, `aria-hidden="true"`), written inline in `MonthCalendar.tsx` as one local `Chevron` used twice:
    prev points to the inline start (as the back link: no rotation in RTL, `className="ltr:rotate-180"`), next
    points to the inline end (`className="rtl:rotate-180"`). Tailwind 3.4.19 ships `ltr:`/`rtl:` built in
    (`index.html` sets `dir="rtl"`; `PageHeader.tsx` and `PhotosStep.tsx` already use `ltr:rotate-180`). No new
    icon file, no dependency.
  - The bar is one row that never wraps: the wrapper becomes `flex flex-nowrap items-center justify-between gap-2`
    (it is `flex items-center justify-between gap-2` today), order prev, title, next. The month title is a `<p>`
    with `min-w-0 text-center text-h3` (was `text-label`), still `aria-live="polite"`, not a heading (0018f's
    heading levels stay). In the same PR the coder deletes the FOLLOWUPS line "0018f · … (caption) · at 320 px in
    the dialog the month title and the prev/next labels wrap" from `specs/FOLLOWUPS.md` (this spec closes it).
  - Disabled arrows stay visible (as 0018f: `disabled`, the kit's `disabled:opacity-60`).
- `web/src/components/Dialog.tsx`: an optional `size?: 'default' | 'wide'` prop on `DialogProps` (default
  `'default'`, so the other 5 callers — `useConfirm` in the same file, `ClosureDialog`, `DeleteAccountSection`,
  `ReportDialog`, `CalendarFeedButton` — pass nothing and render the same class string as today). The `<dialog>`
  className picks from a literal lookup (whole class strings, so Tailwind's content scan sees them):
  `default` → `max-w-dialog` (unchanged); `wide` → `max-w-dialog-wide min-h-[min(36rem,calc(100dvh-3rem))]`
  (**replaces** `max-w-dialog`, never both). Everything else on the element stays (`w-full p-0 rounded-lg border
  border-border bg-surface text-ink backdrop:bg-ink/40`). New `maxWidth` token in `web/tailwind.config.ts`:
  `'dialog-wide': 'min(40rem, calc(100% - 2rem))'`. The min-height keeps the dialog tall so it does not jump in
  height between months or days; `-3rem` keeps it under the browser's own modal `max-height` (`calc(100% - 2em -
  6px)`, and `min-height` beats `max-height` in CSS), so that `max-height` + `overflow: auto` still make it scroll
  on a short screen (0018f verifier).
- `web/src/features/tours/SlotPicker.tsx`: passes `size="wide"` to its `<Dialog>`; nothing else changes there.
  `MonthCalendar` gets **no** new prop: its table is already `w-full table-fixed` with `w-full` day buttons, so
  the cells widen with the dialog by themselves.
- Raw keys: the keys exist in `web/src/locales/he.json` (`tours.calendar.prevMonth` "החודש הקודם",
  `nextMonth` "החודש הבא") and the dev server serves them, so the raw text Gilad saw is most likely a tab loaded
  before the stack restart. The coder checks both screens in the running app after a hard reload, and AC1 pins the
  Hebrew names.
- Vitest: `web/src/features/tours/__tests__/MonthCalendar.test.tsx` gains `ac1_month_bar_arrows_have_hebrew_names`;
  `web/src/components/__tests__/Dialog.test.tsx` gains `ac2_wide_size_uses_the_wide_width`. No existing test needs
  to change: every prev/next lookup already uses `getByRole('button', { name: he.tours.calendar.prevMonth |
  nextMonth })` (`MonthCalendar.test.tsx` `ac1_month_grid_range_and_navigation`,
  `ac1_three_months_when_today_is_the_31st_of_january`; `TourTimesPage.test.tsx` lines ~172/175), which an
  `aria-label` satisfies; `TourCard.test.tsx` never touches the arrows; `Dialog.test.tsx`'s existing
  `toHaveClass('max-w-dialog', …)` covers the default size and stays.

**Out:** any other calendar change (selection, marks, keyboard: 0018f); the other dialogs; the FOLLOWUPS 0018f minors
except the nav wrap.

**New dependencies:** none.

## Data / API
None.

## UI
No artboard. Kit components and `design/brand/` tokens. States unchanged from 0018f (loading, error, empty, success
on both screens). RTL: the prev arrow sits at the inline start (right) and points right; next at the inline end
(left) and points left; logical properties only. At 320 px the bar stays one row. Checked: the wide dialog is
`min(40rem, 320 − 32)` = 288 px; minus 2 px border and `p-6` (48 px) that leaves 238 px; two 44 px buttons plus two
8 px gaps take 104 px, leaving 134 px for the title, and the longest title ("אוקטובר 2026", 18 px Rubik medium) is
about 110–120 px. On `/tours/times` the page has `px-4`, so 288 px for the bar. The day cells inside the dialog at
320 px stay ~34 px wide as in 0018f (unchanged, out of scope). i18n: no new keys (the two existing keys become
`aria-label`s).

## Acceptance criteria
- [ ] AC1 Prev/next render as icon-only buttons whose accessible names are the literal "החודש הקודם" / "החודש הבא"
  (asserted as Hebrew strings, not via `he.json`, so a raw key fails), each with empty `textContent` and an
  `svg[aria-hidden="true"]` inside, and both share one parent with the month title `<p aria-live="polite">`
  (prev, title, next in DOM order) that has class `flex-nowrap` —
  `MonthCalendar.test.tsx::ac1_month_bar_arrows_have_hebrew_names`
- [ ] AC2 `Dialog size="wide"` has `max-w-dialog-wide` and `min-h-[min(36rem,calc(100dvh-3rem))]` and not
  `max-w-dialog`; a Dialog without `size` has `max-w-dialog` and neither wide class —
  `Dialog.test.tsx::ac2_wide_size_uses_the_wide_width`
- [ ] AC3 The seeker's picker opens with `size="wide"` (its dialog has `max-w-dialog-wide`: one added assertion in
  the existing `TourCard.test.tsx::ac6_picker_calendar_shows_every_day_with_slots`); the existing
  `TourCard.test.tsx` `ac2_*` / `ac6_*`, `TourTimesPage.test.tsx` and `MonthCalendar.test.tsx` tests pass
  unchanged otherwise
- [ ] AC4 `make lint`, `make test`, `make i18n-check` green; the ux reviewer checks both screens at 320, 390 and
  1280 px in the running app (one row, no horizontal scroll, the dialog wider and taller, Hebrew names on the arrows).

## Tests to write
Unit: AC1, AC2 (new tests), AC3 (one assertion in an existing test). E2E: none (CI only; tours have no e2e; never
run e2e locally).

## Blast radius
`graphify affected` on `main`'s graph, 2026-11-17.
- `Dialog` — direct callers: `useConfirm` (Dialog.tsx), `ClosureDialog`, `DeleteAccountSection`, `ReportDialog`,
  `CalendarFeedButton`, `SlotPicker`; test `components/__tests__/Dialog.test.tsx`. Depth-2 hits are `useConfirm`'s
  users (`KitPreview`, `ApplicantsPage`, `ChatThreadPage` Thread, `FlatmatesPage`, `MyFlatsPage`, `ListingWizard`,
  `TourCard`, `ToursPage`, `TourTimesPage`). Only `SlotPicker` is in Scope; all others are untouched because
  `size` is optional and the default class string is byte-for-byte today's.
- `MonthCalendar` — callers `SlotPicker` (via `TourCard`, `ChatThreadPage`) and `TourTimesPage` (route in
  `app/routes.tsx`); tests `MonthCalendar.test.tsx`, `TourTimesPage.test.tsx`, `TourCard.test.tsx`. No prop
  change, so callers are untouched; the tests already find the arrows by role + name (see Scope) and keep passing.
- `SlotPicker` — caller `TourCard` (rendered by `ChatThreadPage`); test `TourCard.test.tsx` (AC3 adds one
  assertion). No prop change, so `TourCard`/`ChatThreadPage` are untouched.
- `tailwind.config.ts` `maxWidth` — additive key `dialog-wide`; existing `narrow`/`page`/`wide`/`dialog` unchanged.

## Risks / open questions
None for Gilad: he asked for exactly this (arrows instead of text, wider and taller picker).

## Digest (filled by orchestrator after verification)
See `/digest`.
