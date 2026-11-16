---
id: 0018e
title: The lister's tour-times page and the seeker's slot picker in the chat thread, with tour lines in the thread and the chat list (web half of 0018a)
status: in-review
depends_on: [0018a]   # all 7 endpoints, the chat fields (`MessageOut.tour`, `LastMessageOut.tour`, `ThreadOut.tour`) and the error codes are 0018a's. Branch from 0018a's branch once its PR is open; merge origin/main after it lands (Speed rule 3)
reviewers: [qa, ux]   # qa: two flows (open times, book/move/cancel), error mapping; ux: a new page, a thread card, a dialog, a system line. No security: no new endpoint or rule (0018a's are reviewed there). No perf
estimate: 1 coder run   # coder Sonnet/medium: UI over a finished API, no migration
---

## Goal
After this ships a lister opens "זמני סיור" from a live card in "my listings" (apartment or room) and adds tour
times for a day; a seeker they shortlisted opens the chat thread, picks a free slot and has a tour at once, can
move it to another free slot or cancel it; the lister can cancel it from the thread. Every change shows as a centred
line in the thread and as the chat list's preview. Split from 0018a by the verifier (2026-11-16); the API, rules and
error codes are 0018a's (`specs/0018a-tour-slots.md`, API section) and are not restated here. PRODUCT.md "Tours".

## Decisions this spec builds on (Gilad, 2026-11-16; do not reopen)
As 0018a's list: instant booking for a shortlisted seeker, one seeker a slot, either side cancels, the seeker
reschedules, flatmates see nothing of tours (0018a's API already returns no tour line and `tour: null` to them).

## Scope
**In:**
- `make client` (0018a's API; 0018a already added `tour: null` to the chat fixtures so `tsc` passes).
- `web/src/features/tours/` (new): `api.ts` (`fetchTourWindows`, `createTourWindow`, `deleteTourWindow`,
  `fetchTourSlots`, `bookTour`, `rescheduleTour`, `cancelTour`, each non-2xx → `ApiError` as
  `features/listings/api.ts`), `format.ts` (`formatTourWhen(iso)` → "יום ג׳ 18.11 · 18:20" from
  `Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', … })` parts, as `chat/format.ts`; `formatTourTime(iso)`
  → `HH:mm` in Israel (`hourCycle: 'h23'`); `tourDay(iso)` = `todayInIsrael(new Date(iso))` (`listings/format.ts`);
  `formatTourDay(isoDay, today)` → `tours.day.today` "היום" / `tours.day.tomorrow` "מחר" (via `addDays`) / else
  `tours.day.other` "{{weekday}}, {{date}}" (`he-IL` `weekday: 'long'` on `${isoDay}T00:00:00Z` with `timeZone:
  'UTC'`, and `formatDate`'s day) — the exact signatures and keys 0018b names, so 0018b reuses them and adds none), `useTourWindows.ts`, `useTourSlots.ts`, `useTourActions.ts`
  (`useBookTour`, `useRescheduleTour`, `useCancelTour`: on success invalidate `threadKey(conversationId)`, the slots
  key and `CONVERSATIONS_KEY`), `TourTimesPage.tsx`, `TourCard.tsx`, `SlotPicker.tsx`, `tourLineText.ts`
  (`tourLineText(t, tour, senderName)`, one mapping for the thread line and the list preview), `errors.ts`
  (`tourErrorText(t, error, online)`).
- `web/src/app/routes.tsx`: `me/listings/:id/tours` → `TourTimesPage`, inside `RequireUser` next to
  `me/listings/:id/flatmates`.
- `web/src/features/listings/MyListingsPage.tsx`: a "זמני סיור" button (`to={`/me/listings/${listing.id}/tours`}`,
  `variant="secondary" size="sm"`, `aria-describedby={titleId}`) on **live** cards of both types, after
  "applicants" (serves `/me/listings` and `/market/mine`).
- `web/src/features/chat/ChatThreadPage.tsx`: a message with `tour !== null` renders as a centred `systemLine`
  `<li>` (no bubble, no sender name row) with `tourLineText`; `TourCard` sits between the warning note and the log
  when `thread.tour !== null` or (`thread.my_role` is `seeker` or `owner`, `thread.listing !== null` and
  `thread.can_send`).
- `web/src/features/chat/ConversationsPane.tsx`: a `last_message` with `tour !== null` previews `tourLineText`.
- `web/src/locales/he.json`: the keys under UI.
- Vitest: `web/src/features/tours/__tests__/{TourTimesPage,TourCard}.test.tsx` and `format.test.ts` (new),
  `features/chat/__tests__/ChatThreadPage.test.tsx`, `ChatListPage.test.tsx`,
  `features/listings/__tests__/MyListingsPage.test.tsx` (fixtures gain a tour line and a thread with a `tour` where a test needs one; 0018a already added `tour: null`).

**Out:** everything API (0018a); the `/tours` agenda and its header links (0018b); emails (0018c); the feed card
(0018d); the composer's "הצעת סיור" chip stays as it is (0018a R8). E2E: none (0018a R10: two signed-in accounts and
a shortlist cost 2 OTP codes in a shard near its budget; Vitest covers the flows against mocked API answers).

**New dependencies:** none.

## API
None new. Uses 0018a's endpoints and responses as written there; the web maps its 409 codes as below.

## UI
No artboard covers tours (PRODUCT.md "Brand": no new artboards); anatomy from the kit (`PageHeader`,
`PageContainer`, `Card`, `Button`, `Dialog`, `Field`, `TextInput`, `Select`, `EmptyState`, `ErrorState`,
`Skeleton`, `Badge`), colours and type from `design/brand/`. Logical properties only. Every date/time renders in
`Asia/Jerusalem` inside `<bdi dir="ltr">` for the digits; every `<time>` carries `dateTime` = the UTC ISO string.

**`/me/listings/:id/tours` (`TourTimesPage`)** — the lister's tour times of one listing.
- Header: `tours.times.title` "זמני סיור", back to the listing's "my listings" list (`/me/listings`, or
  `/market/mine` for a room, as `FlatmatesPage` does).
- `listing_live = false`: a muted `Card` `tours.times.notLive` "המודעה לא פעילה, אז אי אפשר לקבוע בה סיורים. אחרי
  הפעלה מחדש אפשר להוסיף זמנים." and no form; existing windows still listed (delete allowed).
- Add form (`<form>`, one `Field` each): `tours.times.date` "תאריך" (`type="date"`, `min` today in Israel, `max`
  +30 days), `tours.times.start` "משעה" and `tours.times.end` "עד שעה" (`type="time"`, `step="300"`),
  `tours.times.slot` "אורך כל סיור" (`Select`: `tours.times.slotOption` "{{count}} דקות" for 15/20/30/45, default 30),
  submit `tours.times.add` "הוספת זמנים" (busy while pending). Client check before sending: end after start →
  `tours.times.errors.range` "שעת הסיום צריכה להיות אחרי שעת ההתחלה". Server errors → `tours.times.errors.*`:
  `invalid_window` "אי אפשר לפתוח את הזמנים האלה. בודקים שהם בעתיד, עד 30 יום קדימה ועד 12 שעות ביום",
  `window_overlap` "הזמנים חופפים לזמנים שכבר פתוחים", `too_many_windows` "אפשר לפתוח עד 30 חלונות זמן קדימה",
  `listing_not_live` = `tours.times.notLive`; others via `tourErrorText` (offline, 429, generic). Errors in
  `role="alert"`; success moves focus to the new window's heading.
- Windows list grouped by Israeli day (`formatTourDay`), each window a `Card`: "18:00–20:00 · 20 דקות"
  (the window heading is JSX: a `<bdi dir="ltr">` time range plus `tours.times.slotOption`; no `tours.times.window` key), its slots as a list: free → `tours.times.free` "פנוי"; booked → `tours.times.booked`
  "תפוס · {{name}}" + a ghost link `tours.times.toChat` "לצ'אט" (`/chat/:conversation_id`). A ghost `Button`
  `tours.times.delete` "מחיקה" (confirm `Dialog`: `tours.times.deleteConfirm` "למחוק את החלון הזה?"); a 409
  `window_has_tours` → `tours.times.errors.hasTours` "יש סיורים שנקבעו בחלון הזה. אפשר לבטל אותם מהצ'אט ואז למחוק".
- States: loading `Skeleton`; error `ErrorState` with retry; empty (no windows) `EmptyState`
  `tours.times.empty` "עוד אין זמני סיור. כל זמן שפותחים כאן מופיע למי שעבר לרשימה הקצרה, בצ'אט איתם". 404 → the
  app's not-found pattern of `FlatmatesPage`.

**Thread `TourCard`** (between the warning note and the log; `Card padding="md"`, heading `tours.card.title`
"סיור"):
- Seeker, current tour: `tours.card.booked` "נקבע סיור: {{when}}"; buttons `tours.card.reschedule` "שינוי מועד"
  (opens `SlotPicker` in reschedule mode) and ghost `tours.card.cancel` "ביטול הסיור" (confirm `Dialog`
  `tours.card.cancelConfirm` "לבטל את הסיור?").
- Seeker, no tour, `can_send`: `tours.card.book` "קביעת סיור" opens `SlotPicker`; `listing_live = false` or no
  slots → the picker's empty state.
- Owner, current tour: "נקבע סיור: {{when}}" + "ביטול הסיור" (same confirm).
- Owner, no tour, `can_send`: `tours.card.ownerHint` "אפשר לפתוח זמני סיור, והם יופיעו כאן לבחירה" + link
  `listings.mine.tours` "זמני סיור" to `/me/listings/:listing_id/tours`.
- Not shown to a flatmate, in a direct chat, or when `can_send` is false and there is no tour.
- `SlotPicker` (`Dialog`, title `tours.picker.title` "בחירת זמן לסיור"): slots grouped by Israeli day as a radio group
  (one `ChoiceGroup` per day, label = time), submit `tours.picker.confirm` "קביעה" (reschedule: "העברה לזמן הזה",
  `tours.picker.move`). Empty: `tours.picker.empty` "עוד אין זמנים פתוחים. אפשר לכתוב בצ'אט ולתאם". Loading
  `Skeleton`; error `ErrorState`. 409 `slot_unavailable` → `tours.errors.slotUnavailable` "הזמן הזה כבר נתפס. אפשר
  לבחור זמן אחר" and the slots refetch; `listing_not_live` → `tours.errors.listingNotLive` "המודעה לא פעילה כרגע";
  `tour_exists`/`tour_not_cancellable` → refetch the thread and close. Success closes the dialog, focus returns to
  the card's heading, and the new line appears via the thread refetch.

**Tour line** (thread `<li>` with `systemLine`, list preview), `tourLineText` over `tours.line.*` with `when` =
`formatTourWhen(tour.starts_at)` and `name` = sender name (or `account.deletedName`):
- `booked` "נקבע סיור: {{when}}"; `rescheduled` "הסיור הועבר ל־{{when}}"; `cancelled_by_seeker` and
  `cancelled_by_lister` "הסיור של {{when}} בוטל על ידי {{name}}"; `cancelled_by_system` "הסיור של {{when}} בוטל".
  My own cancel reads impersonally, as `cancelled_by_system` ("הסיור של {{when}} בוטל"): the brand voice has no second person (UX review: `cancelledMine` "ביטלת…" dropped).

**i18n keys added** (`web/src/locales/he.json`, voice impersonal, no gendered forms): every key quoted above under
`tours.times.*`, `tours.card.*`, `tours.picker.*`, `tours.line.*`, `tours.errors.*` (`slotUnavailable`,
`listingNotLive`, `generic` "משהו השתבש. אפשר לנסות שוב"; offline reuses the existing `common.offline`, no new key),
`tours.day.*` (under `format.ts` above), and `listings.mine.tours` "זמני סיור".

## Acceptance criteria
- [ ] AC1 `TourTimesPage`: add a window (sends Israeli date, start, end and slot), shows free and booked slots with the
  chat link, delete with confirm, each 409 message, the not-live note, empty / loading / error / not-found —
  `web/src/features/tours/__tests__/TourTimesPage.test.tsx`
- [ ] AC2 `TourCard` + `SlotPicker`: the seeker books (dialog, a radio per slot, success closes and refetches the
  thread), reschedules, cancels with confirm; 409 `slot_unavailable` shows the message and refetches the slots; the
  owner sees the hint link or the cancel; nothing for a flatmate, a direct chat, or `can_send = false` with no tour —
  `web/src/features/tours/__tests__/TourCard.test.tsx`
- [ ] AC3 A tour message renders as a centred system line with the right text for each `change` (and
  the impersonal text for my own cancel), and as the list preview —
  `web/src/features/chat/__tests__/ChatThreadPage.test.tsx::ac3_tour_line`,
  `web/src/features/chat/__tests__/ChatListPage.test.tsx::ac3_tour_preview`
- [ ] AC4 `formatTourWhen`, `formatTourTime`, `tourDay` show Israeli wall time across both DST changes (e.g.
  `2026-11-17T22:30:00Z` is `2026-11-18`, 00:30); `formatTourDay` gives היום / מחר / a weekday —
  `web/src/features/tours/__tests__/format.test.ts`
- [ ] AC5 A live card (apartment and room) has "זמני סיור" linking to `/me/listings/:id/tours`; paused, expired and
  removed cards do not — `web/src/features/listings/__tests__/MyListingsPage.test.tsx::ac5_tours_link`

## Tests to write
Unit: `tourLineText` (each change, mine, deleted sender), the format helpers (AC4). Component: AC1–AC3, AC5 with the
house `ApiError` / `fetch` mocks. E2E: none (Out). `make screens` states: none required; the UX reviewer reads the
Vitest-rendered states and the kit.

## Blast radius
From `graphify affected` on `main` (2026-11-16):
- `web/src/features/chat/api.ts::MessageOut` / `ThreadOut` (the generated types gain `tour`, `body` is
  `string | null`) → `ChatThreadPage.tsx` (renders the line), `ConversationsPane.tsx` (`last.body` preview: a tour
  line has `body === null`, so the preview branch must come first), `Composer.tsx`, `useSendMessage.ts` (a sent
  message always has a body: unchanged), `chat/__tests__/fixtures.ts`, `chat/__tests__/harness.tsx`,
  `ChatLayout.test.tsx`, `ChatThreadPage.test.tsx`, `ChatListPage.test.tsx`, `ChatStreamProvider.test.tsx`,
  `web/e2e/screens/chat.screens.ts`, `fixtures-chat.ts`, `market-people.screens.ts` (0018a made them compile; this
  spec changes behaviour only in the first two).
- `web/src/features/listings/MyListingsPage.tsx` → `MyListingsPage.test.tsx`, `web/e2e/screens/my-listings.screens.ts`
  (one more button on live cards: re-take its screenshots if the shard diffs them) and `/market/mine` (same component).
- `web/src/app/routes.tsx` → one new route; no existing route changes.
- `web/src/locales/he.json` → `make i18n-check`; add the `tours` object once (0018b adds its keys inside it).

## Risks / open questions
- **R1 0018b overlap.** 0018b's web half reuses this spec's `features/tours/api.ts::cancelTour`, `format.ts` and the
  `tours` i18n object; it should branch from this spec's branch (orchestrator: 0018b `depends_on` gains 0018e for its
  web half).
- **R2 Gender-neutral copy.** Resolved by the UX review: no `tours.line.cancelledMine`; my own cancel uses the impersonal "הסיור של {{when}} בוטל".
- Product questions stay on 0018a (R3, R6, R7, R8, R12).

## Digest (filled by orchestrator after verification)
See `/digest`.
