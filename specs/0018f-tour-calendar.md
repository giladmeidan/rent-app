---
id: 0018f
title: The lister's tour times and the seeker's slot picker show a month calendar instead of day-by-day lists
status: verified
depends_on: []   # 0018a–e are merged; web only, over the existing API
reviewers: [qa, ux]   # ux: two screens change shape, a new keyboard grid; qa: the add/delete/book/move flows keep working. No new endpoint, no security. No perf
estimate: 1 coder run   # coder Sonnet/medium: UI over a finished API, no migration
---

## Goal
After this ships a lister's "זמני סיור" page (`/me/listings/:id/tours`) looks like a calendar: a month grid where
the days that have tour times are marked, and picking a day shows that day's windows and adds times to it; a
shortlisted seeker who presses "קביעת סיור" / "שינוי מועד" in the chat sees the **same** month grid with every day
that has a free slot (up to 30 days ahead), not only the nearest day, and picks a day, then a time. Gilad's request
2026-11-17. PRODUCT.md "Tours" (rules unchanged: booking 60 min–30 days ahead, windows up to 30 days ahead).

## Decisions (orchestrator defaults, 2026-11-17; Gilad may redirect before the build)
1. One shared component, `MonthCalendar`, used by both screens. Weeks start on **Sunday** (Israel), Hebrew
   narrow weekday headers (א׳ … ש׳), the month title "נובמבר 2026" from `Intl.DateTimeFormat('he-IL',
   { month: 'long', year: 'numeric', timeZone: 'UTC' })`. RTL comes from the page `dir` (Sunday at the inline start,
   i.e. the right). Days before today in Israel and after today + 30 are disabled; previous/next-month buttons
   only move within the months that hold days in that range (2 months, or 3 when today is 30 or 31 January).
2. **Lister**: the grid opens on the first day with a window (else today), selected. A marked day shows a dot;
   a day with a booked tour shows the dot in the accent colour plus a visually hidden "יש סיורים שנקבעו". Below the
   grid: the selected day's heading (`formatTourDay`), its `WindowCard`s (unchanged), then the add form **for that
   day** (the date `<input type="date">` is removed; the form sends the selected day as `date`). The day-grouped
   list of every window is removed (the calendar replaces it). The not-live note replaces the form as today.
3. **Seeker** (`SlotPicker` dialog): only days with a free slot are enabled; the grid opens on the first such
   day, selected; below it one `ChoiceGroup` with that day's times (as today, one day instead of all). Changing
   the day clears the selected time. The dialog's body scrolls inside the viewport (the native modal `<dialog>` already
   has the UA rule `max-height: calc(100% - 6px - 2em); overflow: auto`, and Tailwind 3.4's preflight only resets its
   `padding`; `Dialog.tsx` does not change), so it never runs off a small screen.
4. No new dependency (no date-picker library); dates stay `YYYY-MM-DD` strings via `listings/format.ts`'s
   `todayInIsrael` / `addDays`, instants via `tours/format.ts`'s `tourDay`.

## Scope
**In:**
- `web/src/features/tours/MonthCalendar.tsx` (new):
  `MonthCalendar({ label, today, lastDay, selected, onSelect, isEnabled, mark })` where days are `YYYY-MM-DD`,
  `isEnabled(day): boolean` (on top of the today…lastDay range), `mark(day): 'none' | 'has' | 'booked'`.
  Markup: a caption row (month title in an `aria-live="polite"` `<h3>`, prev/next `Button variant="ghost"
  size="sm"` with `aria-label`s), then `<table role="grid" aria-label={label}>` with a header row of 7 `<th
  scope="col" abbr={long weekday}>` and week rows of `<td>` each holding a `<button type="button">` (or an empty
  cell outside the month). Each day button: `aria-label` = `formatTourDay(day, today)` plus the mark text,
  `aria-pressed` = selected, `disabled` when not enabled, `min-h-tap`, the digit inside `<bdi dir="ltr">`.
  The month title is **not** a heading (a `<p className="text-label" aria-live="polite">`): the lister page's
  day heading is an `h2` and its `WindowCard`s are `h3`, and two existing tests query the single `level: 3`
  heading. Weekday headers come from `Intl.DateTimeFormat('he-IL', { weekday: 'narrow', timeZone: 'UTC' })`
  (א׳ … ש׳) and their `abbr` from the same with `weekday: 'long'` (hardcoded Hebrew fails `make i18n-check`).
  The shown months are every month from `today`'s to `lastDay`'s, computed (decision 1's "at most 2" is 3 when
  today is 30–31 January, e.g. 31 Jan + 30 = 2 Mar); prev/next are `disabled` (not hidden) at the first/last.
  Marks: `'has'` a small `bg-ink-muted` dot, `'booked'` a `bg-accent` dot; selected day
  `border-accent bg-accent-soft text-accent-strong` (as `ChoiceGroup`'s checked option); disabled `text-ink-muted`
  without a border.
  Keyboard (WAI-ARIA date grid): one roving tab stop (initially the selected day if it is in the shown month,
  else the shown month's first enabled day; it then follows the arrow-key focus);
  ArrowRight/ArrowLeft move a day **by visual direction** (in RTL ArrowLeft = next day), ArrowUp/ArrowDown a week,
  Home/End the week's start/end, PageUp/PageDown a month; when the target day is disabled, focus keeps
  stepping one day in the same direction (later for next-day/ArrowDown/End/PageDown, earlier for the others)
  to the nearest enabled day, and stays put if there is none in range; movement crosses months (switching the
  shown month). Arrows only move focus; Enter/Space (the native button click) selects. Direction is read as in
  `components/Tabs.tsx`: `el.closest('[dir]')?.getAttribute('dir') === 'ltr'` means LTR, anything else RTL. Styling from the kit tokens (`accent`, `accent-soft`,
  `border`, `ink-muted`), logical properties only.
- `web/src/features/tours/TourTimesPage.tsx`: decision 2 (`AddForm` takes `date` as a prop; selection state in
  the page, set once when the windows first load and kept across refetches; the selected day is shown under an
  `<h2>` `formatTourDay(day, today)`; after adding, the new window's heading still takes focus; after deleting
  the selected day's last window, the day stays selected and shows `tours.times.dayEmpty`). The lister's
  `isEnabled` is `() => true` (every day in range), `mark` is `'booked'` if any of the day's windows has a
  `booked` entry, else `'has'` if it has a window, else `'none'`. `tours.times.empty` (no windows at all) becomes
  a `<p className="text-body text-ink-muted">` above the grid (no `EmptyState` illustration above a calendar).
- `web/src/features/tours/SlotPicker.tsx`: decision 3 (`byDay` stays as the day → slots map; the list of groups
  becomes the calendar + one `ChoiceGroup` for the selected day, legend `formatTourDay(day, today)`; `isEnabled`
  = the day has a slot, `mark` = `'has'` for those days, else `'none'`; the day state is `null` until picked and
  then falls back to the first enabled day; `close()` also resets the day; after a refetch drops the selected
  day, the selection moves to the first enabled day after it, else the first enabled day, else the empty state).
- `web/src/components/Dialog.tsx`: **no change** (see decision 3).
- `web/src/locales/he.json` keys (under `tours.calendar` unless noted):
  `prevMonth` "החודש הקודם", `nextMonth` "החודש הבא", `hasTimes` "יש זמני סיור", `hasTours` "יש סיורים שנקבעו",
  `ownerLabel` "בחירת יום לזמני סיור", `seekerLabel` "בחירת יום לסיור", `tours.times.dayEmpty` "אין זמנים ביום
  הזה. אפשר להוסיף למטה", `tours.times.dayNotLive` "אין זמנים ביום הזה". **Remove** `tours.times.date`: its only
  use is the date field this spec deletes (`TourTimesPage.tsx:162`) and the test helpers' `t.date`, which this
  spec rewrites. `scripts/i18n-check.mjs` never fails on unused keys (it checks hardcoded copy, missing keys and
  plural families), so removal is for hygiene; `tsc` then flags any leftover `t.date` in the tests.
- Vitest: `web/src/features/tours/__tests__/MonthCalendar.test.tsx` (new). Both existing files pin the clock
  (as `ToursPage.test.tsx` does): `vi.useFakeTimers({ toFake: ['Date'] })` + `vi.setSystemTime('2026-11-17T10:00:00Z')`
  in `beforeEach`, `vi.useRealTimers()` in `afterEach`, and module-level dates become literals
  (`TourTimesPage.test.tsx`'s `TOMORROW = '2026-11-18'`). Without it `TourCard.test.tsx`'s fixed
  `2026-11-20`/`2026-11-21` slots fall before "today" (disabled) once the real date passes them, and
  `TourTimesPage.test.tsx`'s `TOMORROW` lands in the next, unshown month on a month's last day.
  - `TourTimesPage.test.tsx`: helpers `heading` (waits on `t.date` → wait on `t.start`) and `fill` (drops the
    date argument; callers click the day's button first); `ac1_add_window_sends_israeli_date_and_times` (click
    18 Nov, drop the date `toHaveValue('')` check; the `level: 2` "מחר" heading stays);
    `ac1_slot_default_and_client_range_check` (the date `min`/`max` checks become: 16 Nov and 18 Dec disabled or
    absent, 17 Nov and 17 Dec enabled); `ac1_server_errors` (via `fill`); `ac1_listing_not_live_note_without_form_but_windows_stay`
    (`queryByLabelText(t.date)` → `t.start`); `ac1_states_loading_error_empty_not_found`,
    `ac1_lists_free_and_booked_slots_with_chat_link` and `ac1_delete_with_confirm_and_has_tours` should pass
    unchanged (the window's day opens selected; `t.empty` is still shown when no windows remain).
  - `TourCard.test.tsx`: `ac2_seeker_books_a_slot` (one group showing `['17:00']`; clicking 21 Nov shows
    `['10:20']`); `ac2_slot_unavailable_shows_message_and_refetches_slots` (after the refetch 21 Nov is selected,
    one radio); `ac2_empty_picker` (also no `grid`); `ac2_tour_exists_…` and `ac2_seeker_reschedules` should pass
    unchanged (the first slot day opens selected). The cancel/owner/flatmate tests do not open the picker.

**Out:** API changes (the API already returns every free slot up to 30 days ahead and every window); a week or
day time-grid view (hours on an axis); drag to create windows; recurring windows ("every Tuesday"); the `/tours`
agenda page (0018b, stays a list); e2e (tours have none, 0018e).

**New dependencies:** none.

## Data
None.

## API
None. Uses `GET /listings/{id}/tour-windows`, `POST /listings/{id}/tour-windows`, `DELETE /tour-windows/{id}`,
`GET /applications/{id}/tour-slots`, `POST /applications/{id}/tour`, `POST /tours/{id}/reschedule` as 0018a.

## UI
No artboard (PRODUCT.md "Brand": no new artboards); kit components and `design/brand/` tokens.
- **Lister page** states: loading (`Skeleton` in place of the grid), error (`ErrorState` retry, as today),
  not found (as today), success with no windows (grid with today selected, `tours.times.dayEmpty` + the form, and
  the existing `tours.times.empty` hint above the grid), success with windows (decision 2), listing not live
  (grid still shows marks; the selected day lists its windows with delete; `tours.times.notLive` card instead of
  the form; an empty day says `tours.times.dayNotLive`).
- **Seeker dialog** states: loading and error (as today), no free slots (`tours.picker.empty`, no grid), success
  (decision 3), a 409 `slot_unavailable` (alert as today; the slots refetch and the grid updates; if the selected
  day lost its last slot, select the next enabled day).
- RTL: the grid relies on `dir="rtl"` from the document (no `flex-row-reverse`); the arrow keys follow visual
  direction, read from the nearest `[dir]` as `Tabs.tsx` does (jsdom does not compute `direction`). Digits in `<bdi dir="ltr">`.
- Width: `<table className="w-full table-fixed">`, 7 equal columns, each day button `w-full min-h-tap` with no
  min width. At a 320 px viewport the dialog content is 240 px (`max-w-dialog` = 320 − 2rem = 288, minus `p-6`)
  → ≈34 px per column; the lister page's is 288 px (`PageContainer` `px-4`) → ≈41 px. Buttons stay 44 px tall;
  ≥24 px wide meets WCAG 2.5.8. No horizontal scroll at 320 px (ux reviewer checks in the browser).

## Acceptance criteria
- [ ] AC1 Given today = a fixed date, `MonthCalendar` renders that month starting on Sunday, disables days before
  today and after today + 30, and its prev/next buttons stop at the range's months —
  `MonthCalendar.test.tsx::ac1_month_grid_range_and_navigation`
- [ ] AC2 Arrow keys move focus by visual direction in RTL (ArrowLeft = next day), skip disabled days, cross into
  the next month; Enter selects; only one day button has `tabIndex=0` —
  `MonthCalendar.test.tsx::ac2_keyboard_grid_rtl`
- [ ] AC3 A marked day's button names its mark ("יש זמני סיור" / "יש סיורים שנקבעו") and the selected day has
  `aria-pressed="true"` — `MonthCalendar.test.tsx::ac3_marks_and_selection_are_announced`
- [ ] AC4 The lister page opens on the first day with a window, shows only that day's windows; clicking another
  marked day shows its windows — `TourTimesPage.test.tsx::ac4_calendar_selects_day_and_lists_its_windows`
- [ ] AC5 Adding times sends the selected day as `date` (Israel) with start/end/slot, then focuses the new
  window's heading; the old tests for range check, server errors, delete-with-confirm, booked slots with chat link
  and not-live still pass, adapted to a day click — `TourTimesPage.test.tsx::ac1_*` (existing, updated) and
  `::ac5_add_uses_selected_day`
- [ ] AC6 The seeker picker shows the calendar with only days that have free slots enabled, opens on the first
  one; picking a later day shows that day's times; booking/rescheduling sends the chosen slot —
  `TourCard.test.tsx::ac6_picker_calendar_shows_every_day_with_slots` and the existing `ac2_*` (updated)
- [ ] AC7 `make lint`, `make test`, `make i18n-check` green.

## Tests to write
Unit (Vitest): `MonthCalendar.test.tsx` AC1–AC3 (pass a fixed `today` prop, no fake timers; render inside a
`<div dir="rtl">`; AC1 also covers a 3-month range, `today = '2026-01-31'`).
Integration (Vitest, mocked API): AC4–AC6 in the two existing test files. E2E: none (CI-only rule; tours have no
e2e, 0018e).

## Blast radius
`graphify affected` on main's graph, 2026-11-17, plus grep for the i18n key.
- `TourTimesPage` (and its private `AddForm`, `WindowCard`): `app/routes.tsx` `AppRoutes` mounts it — props
  unchanged, untouched; `TourTimesPage.test.tsx` — in Scope. The app-level tests that import `routes.tsx`
  (Layout, LandingPage, LegalPage, MarketMinePage, …) never render this route — untouched.
- `SlotPicker` (and its private `byDay`): `TourCard.tsx` → `ChatThreadPage.tsx` `Thread` — props unchanged,
  untouched; `TourCard.test.tsx` — in Scope.
- `Dialog`: not changed (decision 3). Its callers (`useConfirm`, `ClosureDialog`, `DeleteAccountSection`,
  `ReportDialog`, `CalendarFeedButton`, `SlotPicker`, `KitPreview`, `Dialog.test.tsx`, …) — untouched.
- `ChoiceGroup`, `formatTourDay`, `formatTourTime`, `tourDay`, `todayInIsrael`, `addDays`: reused as they are;
  `ToursPage.tsx` and `format.test.ts` — untouched.
- i18n `tours.times.date`: `TourTimesPage.tsx:162` and `TourTimesPage.test.tsx` (`t.date`, 6 lines) — both in
  Scope; no other use.
- `MonthCalendar`: new, no callers yet.

## Risks / open questions
- Decisions 1–3 are orchestrator defaults, not Gilad's; if he redirects (e.g. a week view), the spec changes
  before the build.

## Digest (filled by orchestrator after verification)
See `/digest`.
