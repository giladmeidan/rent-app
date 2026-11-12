---
id: 0009f
title: Error, limit and dead-end screens say what happened and what to do next — offline vs error, why a button is disabled, how long to wait, and a way out of every join-flat state
status: verified
depends_on: [0009b]   # 0009b: the plural-aware i18n-check (the `common.in*` families need `_two`) and the same files (he.json, OtpForm, ApplySection, MyApplicationsPage, ChatListPage, reasons.ts); build from 0009b's branch once its PR is open
reviewers: [code, qa, ux]   # ux: new copy on ten screens; qa: the states and their tests; code: the one-line CORS change and ApiError. No security: no auth logic changes, a header is only read
estimate: 1 coder run   # coder Opus/medium (verifier: ten independent items over ~15 files is near the top of a Sonnet run; Speed rule 6 "when in doubt, the stronger one")
---

> **Brand kit amendment (orchestrator, 2026-11-12, no verifier re-run):** `design/brand/` (README.md, tokens.json) wins over the artboards and over any older wording below for colour, type (Fredoka for display/h1/h2, Rubik for the rest), radii, no card shadows, the name homie / הומי, the mascot and the voice (no slash forms: plural, infinitive or noun; action-noun buttons; errors say "what happened. what to do."). Token and kit names are those of 0009d. Where this spec still names a teal token, Heebo or a slash form, the builder applies the brand equivalent.

## Goal
After this ships:
- an error box says when the device is offline;
- a disabled sign-in button says why;
- a date field repeats the chosen day in Hebrew;
- the apply and code limits say how long to wait ("בעוד שעה", "בעוד יום");
- a withdraw that came too late, an owner on a listing page, a failed inbox action, the owner's parking chip
  and the people page's "למה ההתאמה?" each get words of their own;
- every final join-flat screen links somewhere;
- an empty `/chat` speaks to a flatmate.

This serves Dev Plan slice 9 ("polish") and clears the copy follow-ups that need a component change. It was
split from `0009b` by its author before verification (size). It follows `0009b`'s Conventions, plus one rule:
Hebrew dual nouns stay words ("שעתיים", "יומיים"), while other counts from 2 up are digits ("2 דקות").

## Scope
**In** (each item names its FOLLOWUPS line as of 8c3c480):

1. **Offline vs error** (line 17; owned here under the orchestrator's brief, see Conflicts).
   - `web/src/components/useOnline.ts` (new): `useOnline()` is `useSyncExternalStore` over the window's
     `online` / `offline` events, with `navigator.onLine` as the snapshot and `true` on the server.
   - `ErrorState` shows `common.offline` when offline and `common.error` otherwise. It re-renders on the
     events. Its ~30 callers are unchanged.
   - When `navigator.onLine` is true but the API is down, the box still says "משהו השתבש". That is accurate
     enough.
2. **Why the sign-in button is disabled** (line 24: both the hint and its `aria-describedby`; owned here
   under the orchestrator's brief, see Conflicts). In
   `OtpForm.tsx`, while a submit button is disabled for a missing input (not while pending):
   - a `<p id=… className="text-sm text-muted">` sits right below it;
   - the button's `aria-describedby` points at that `<p>`.

   The hint is chosen as follows:
   - Step 1 (signup, `withProfile`) with no role: `auth.hint.chooseRole`.
   - Step 2 with fewer than 6 digits: `auth.hint.enterCode`.
   - Step 2 with 6 digits while the `profile_required` reveal still has no role: `auth.hint.chooseRole`.

   An enabled button has no hint and no `aria-describedby`.
3. **Date read-back** (line 47).
   - The native `type="date"` control stays: mobile pickers, accessibility, and no dependency.
   - Its empty placeholder ("dd/mm/yyyy", or "mm/dd/yyyy" on an en-US browser) comes from the browser's
     language and cannot be translated.
   - Under each date input, a valid `YYYY-MM-DD` value shows `common.dateChosen` with the long Hebrew date:
     "התאריך שנבחר: 12 בנובמבר 2026". A day/month swap is then visible at once.
   - The pieces, all in `web/src/components/DateReadback.tsx` (new). Nothing under `components/` imports
     from `features/`, so `formatDate` stays where it is:
     - `isIsoDay(value)`: valid means `/^\d{4}-\d{2}-\d{2}$/` **and** a UTC round trip,
       `new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value`. V8 rolls "2026-02-30" over to
       2 March, and `Intl` throws a `RangeError` on an Invalid Date.
     - `formatLongDate(isoDay)`: `Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year:
       'numeric', timeZone: 'UTC' })`.
     - `DateReadback` (`{ id, value }`): renders nothing unless `isIsoDay(value)`.
   - It goes under `FiltersForm.tsx:301`, `DetailsStep.tsx:298` and `ProfilePage.tsx:286`. Its id joins the
     input's existing `aria-describedby` list (the hint and the error ids stay) **only while
     `isIsoDay(value)`**. That way there is never an idref to a missing element, which `0009c`'s axe check
     would flag.
4. **Withdraw too late, and how long to wait** (line 71, its copy parts only).
   - **Withdraw too late.** In `MyApplicationsPage.tsx:114-118`, a 409 `not_withdrawable` shows
     `applications.errors.notWithdrawable`, after the refetch that `useWithdraw` already does. Other errors
     keep `common.error`.
   - **Retry-After, API.** `api/app/main.py:99-104`'s `CORSMiddleware` gains `expose_headers=["Retry-After"]`.
     The web (5173) and the API are different origins in dev and in Slice 12's `app.X` / `api.X`, so the
     browser hides the header without it.
   - **Retry-After, web.**
     - `web/src/components/retryAfter.ts` (new) exports the only parser, `parseRetryAfter(headers:
       Headers): number | null`. It returns `Retry-After` as whole seconds (`/^\d+$/`, more than 0),
       otherwise null; the API never sends 0, since `rate_limit.py:20` floors it at 1.
     - `ApiError` (`features/listings/api.ts:23`) gains `readonly retryAfter: number | null`, set with
       `parseRetryAfter` from an optional fifth constructor argument `headers?: Headers`. `applyToListing`
       (`features/applications/api.ts:13-19`) passes `response.headers`; other callers are unchanged and get
       null.
     - The same file has `retryAfterText(t, seconds)`, which picks the unit:

       | Condition | Result |
       | --- | --- |
       | `m = ceil(s / 60)` is below 60 | `common.inMinutes` with `{count: m}` |
       | otherwise `h = ceil(s / 3600)` is below 24 | `common.inHours` with `{count: h}` |
       | otherwise | `common.inDays` with `{count: ceil(s / 86400)}` |

       So 3599 and 3600 → "בעוד שעה", 3601 → "בעוד שעתיים", 86399 → "בעוד יום". The keys are literal calls.
   - **Retry-After, the screens.**
     - `ApplySection.tsx:91,193-196`: a 429 keeps the seconds. With a value it shows
       `applications.errors.rateLimitedIn` with `{ when }`; without one it shows today's
       `applications.errors.rateLimited`.
     - `OtpForm.tsx` `requestCode` (step 1 and the resend; `api.POST` directly, no `ApiError`): a 429 calls
       `parseRetryAfter(response.headers)`, and its result carries the seconds, for example
       `{ kind: 'tooMany'; retryAfter: number | null }`; the coder picks the exact shape. The error line is
       `auth.errors.tooManyIn` with `{ when }`, or the reworded `auth.errors.tooMany`. This one comes from the he.json sweep, not from a
       FOLLOWUPS line: the per-email cap can lock a person out for a day (FOLLOWUPS line 10), so "בעוד כמה
       דקות" could be wrong by a day.
5. **An owner on a listing page** (line 77). `ApplySection` for an owner-role viewer (`me.data?.role ===
   'owner'`) shows the heading `applications.headingOwner` and the count line `applications.countOwner`,
   instead of the seeker-addressed `applications.heading` / `applications.count`. The API does not say whose
   listing it is, and no owner can apply anywhere, so this applies to every owner-role viewer. Visitors and
   seekers are unchanged.
6. **A failed inbox action** (line 87). `ApplicantCard.tsx:291-295`'s `showError` line reads
   `applicants.errors.actionFailed`, or `common.offline` when offline (`useOnline`). This includes the 409
   path, where the refetched status shows next to it; that path showed `common.error` before (FOLLOWUPS line
   69).
7. **The owner's parking chip** (line 129, accepted by Gilad 2026-11-12 Q6).
   - `ownerShort(criterion, kind, profile, spots, t)` (`features/match/reasons.ts:362`) gains `spots`, as
     `ownerReason` has.
   - Parking `agree` gives:
     - `match.owner.short.parking.agreeNone` when `parking_needed === 0`;
     - `match.owner.short.parking.agreePartial` when `spots < parking_needed` (two asked, one spot: the 0.5
       agree);
     - otherwise `agree` "חניה".

     The names follow the `agreeX` siblings (`agreeLong`, `agreeSmoker`, `agreePet`) and
     `match.owner.parking.agreeNone`.
   - `differ` stays "חסרה חניה".
   - The only `ownerShort` caller is `MatchChips.tsx:41`. It becomes `ownerShort(criterion, kind,
     props.profile, props.spots, t)`. `OwnerProps.spots` already exists (`MatchChips.tsx:26`), and
     `ApplicantCard.tsx:170` already passes it. `reasons.test.ts:622`'s call gains the row's `spots`
     (`row.spots ?? 1`, as the `ownerReason` line above it).
8. **The people page's "למה ההתאמה?"** (line 170). `personReason` (`reasons.ts:408`) gets its own key map,
   `PERSON_REASON`, of full fact-free sentences; `personShort` keeps `PERSON_BASE` for the chips:
   - budget, area and lifestyle reuse `match.owner.{budget,area,lifestyle}.*`, which are already fact-free;
   - move_in keeps `match.owner.move_in.*` with the date;
   - household, contract, parking, smoking and pets use the new `people.reason.*`.

   `PERSON_BASE.move_in` (`reasons.ts:381`) changes from `match.owner.move_in.*` to
   `match.owner.short.move_in.*` ("כניסה מתאימה" / "כניסה {{date}}"), so the chip and the line differ for
   every criterion, which is what FOLLOWUPS 170 asks for. The date is on the card anyway.

   No line states the seeker's household type, pets, smoking, contract length or parking count (`0008b`'s
   rule). Each line says only fit or no fit, which is what the chip already shows. Every line avoids the
   forbidden words of `reasons.test.ts:660-671`.
9. **Join-flat dead ends** (line 189, accepted by Gilad 2026-11-12 Q7). In `JoinFlatPage.tsx`, each final message gets a
   link in the member state's link style (`JoinFlatPage.tsx:226-231`). This covers both the preview failure
   and a final join failure:
   - `own` → `/me/listings`, `flatmates.join.toMyListings`;
   - `applied` → `/me/applications`, `flatmates.join.toApplications`;
   - `declined`, `full`, `invalid` and the no-token screen → `/search`, `flatmates.join.toSearch`;
   - `rateLimited` gets no link: the person retries later.

   The link is never inside the alert, because `0009c` focuses the alert `<p>`:
   - The no-token screen (`JoinFlatPage.tsx:169`) and the preview failure (`:207`) render the card as the
     `role="alert"` `<p>` itself. Each becomes a `<div className={card}>` holding the `role="alert"` `<p>`
     and then the `Link`.
   - On a final join failure, the link goes after the alert `<p>` inside the existing card (`:260-264`).
10. **An empty `/chat` for a flatmate** (line 195, accepted by Gilad 2026-11-12 Q8). In `ChatListPage.tsx:141-145`, when
    `conversations.data` is empty and `useMyFlats()` has at least one flat, the empty state is
    `chat.list.emptyFlatmate`. Otherwise it stays `emptyOwner` / `emptySeeker` by role. That includes while
    `useMyFlats()` is pending or failed: the role line shows first and switches once the flats arrive. An
    owner who is also a flatmate somewhere gets the flatmate line, which is the more specific one.

The keys are in Table C.

**Out:**
- Using `retryAfterText` for the other 429s. `likes.errors.rateLimited`, `chat.errors.rateLimited` and
  `flatmates.join.rateLimited` keep their fixed words; their callers do not read the header. One small spec
  can do it later.
- Focus, live regions and busy states on these screens (`0009c`). Colours and tokens (`0009d`).
- A recovery link in the listing not-found block (FOLLOWUPS line 46), the inbox's page alert (line 83) and
  MyLikesPage's error states (line 182). These are `0009g`'s states.

**New dependencies:** none.

## Data
None.

## API
No new endpoint. One change: `CORSMiddleware(..., expose_headers=["Retry-After"])` in `api/app/main.py`. The
web origin (`WEB_ORIGIN` only, unchanged) can then read the `Retry-After` header that the 429s of
`POST /auth/otp/request` (`routers/auth.py:48`) and `POST /listings/{id}/applications`
(`routers/applications.py:123`) already send. No auth rule changes.

## UI
Screens touched:
- every `ErrorState`;
- `/login` and `/signup` (OtpForm);
- `/search` filters;
- the listing wizard's details step;
- `/me/profile`;
- `/me/applications`;
- the listing page's apply section;
- the applicant inbox card;
- the people page card;
- `/flatmates/join`;
- `/chat`.

States: the items above are the changed states (error, disabled, rate-limited, empty, final). No screen
gains a loading or success state, and the others keep what their own specs defined. The new text is muted
`text-sm`, below the control it explains. Links use the existing link classes. RTL: logical classes only. The long date is Hebrew text with European digits, so its order is correct in an RTL
paragraph.

### Table C — new and changed keys
The build applies this table verbatim. A later change from Gilad is an edit to this table.

| # | Key | Current | Proposed | Item | Gilad |
| --- | --- | --- | --- | --- | --- |
| C1 | `common.offline` | — (new) | "אין חיבור לאינטרנט. כשהחיבור יחזור, אפשר לנסות שוב." | 1 | |
| C2 | `auth.hint.chooseRole` | — (new) | "כדי להמשיך, צריך לבחור מה מתאים לך" | 2 | |
| C3 | `auth.hint.enterCode` | — (new) | "צריך להקליד את כל 6 הספרות מהאימייל" | 2 | |
| C4 | `common.dateChosen` | — (new) | "התאריך שנבחר: {{date}}" | 3 | |
| C5 | `applications.errors.notWithdrawable` | — (new) | "כבר אי אפשר לבטל את המועמדות הזו. הסטטוס שלה עודכן." | 4 | |
| C6 | `applications.errors.rateLimitedIn` | — (new) | "הגשת הרבה מועמדויות בזמן קצר. אפשר לנסות שוב {{when}}." | 4 | |
| C7 | `auth.errors.tooManyIn` | — (new) | "יותר מדי ניסיונות. אפשר לנסות שוב {{when}}." | 4 | |
| C8 | `auth.errors.tooMany` | "יותר מדי ניסיונות. נסו שוב בעוד כמה דקות" | "יותר מדי ניסיונות. אפשר לנסות שוב מאוחר יותר." | 4: the wait can be a day; the same verb and full stop as C7 | |
| C9 | `common.inMinutes_one` / `_two` / `_other` | — (new) | "בעוד דקה" / "בעוד 2 דקות" / "בעוד {{count}} דקות" | 4 | |
| C10 | `common.inHours_one` / `_two` / `_other` | — (new) | "בעוד שעה" / "בעוד שעתיים" / "בעוד {{count}} שעות" | 4 | |
| C11 | `common.inDays_one` / `_two` / `_other` | — (new) | "בעוד יום" / "בעוד יומיים" / "בעוד {{count}} ימים" | 4 | |
| C12 | `applications.headingOwner` | — (new) | "מועמדויות" | 5 | |
| C13 | `applications.countOwner_zero` / `_one` / `_two` / `_other` | — (new) | "עוד אין מועמדויות" / "מועמדות אחת" / "2 מועמדויות" / "{{count}} מועמדויות" | 5 | |
| C14 | `applicants.errors.actionFailed` | — (new) | "השינוי לא נשמר. אפשר לנסות שוב." | 6 | |
| C15 | `match.owner.short.parking.agreePartial` | — (new) | "חניה חלקית" | 7 | **accepted by Gilad 2026-11-12 (Q6)** |
| C16 | `match.owner.short.parking.agreeNone` | — (new) | "חניה לא נדרשת" | 7 | **accepted by Gilad 2026-11-12 (Q6)** |
| C17 | `people.reason.household.agree` | — (new) | "משק הבית שלהם מתאים למה שביקשת" | 8 | |
| C18 | `people.reason.household.differ` | — (new) | "משק הבית שלהם לא ברשימה שלך" | 8 | |
| C19 | `people.reason.contract.agree` | — (new) | "משך החוזה שהם מחפשים מתאים לך" | 8 | |
| C20 | `people.reason.contract.differ` | — (new) | "משך החוזה שהם מחפשים קצר מהמינימום שלך" | 8 | |
| C21 | `people.reason.parking.agree` | — (new) | "מבחינת חניה, הדירה מתאימה להם" | 8 | |
| C22 | `people.reason.parking.differ` | — (new) | "הם צריכים יותר חניה ממה שיש בדירה" | 8 | |
| C23 | `people.reason.smoking.agree` | — (new) | "הם מתאימים לכללי העישון בדירה" | 8 | |
| C24 | `people.reason.smoking.differ` | — (new) | "הם לא מתאימים לכללי העישון בדירה" | 8 | |
| C25 | `people.reason.pets.agree` | — (new) | "הם מתאימים לכללי חיות המחמד בדירה" | 8 | |
| C26 | `people.reason.pets.differ` | — (new) | "הם לא מתאימים לכללי חיות המחמד בדירה" | 8 | |
| C27 | `flatmates.join.toMyListings` | — (new) | "למודעות שלי" | 9 | **accepted by Gilad 2026-11-12 (Q7)** |
| C28 | `flatmates.join.toApplications` | — (new) | "למועמדויות שלי" | 9 | **accepted by Gilad 2026-11-12 (Q7)** |
| C29 | `flatmates.join.toSearch` | — (new) | "לחיפוש דירות וחדרים" | 9 | **accepted by Gilad 2026-11-12 (Q7)** |
| C30 | `chat.list.emptyFlatmate` | — (new) | "אין עדיין שיחות על החדר. שיחה תופיע כאן כשבעלי הדירה יוסיפו מועמד/ת לרשימה הקצרה, או כשתהיה התאמה הדדית." | 10 | **accepted by Gilad 2026-11-12 (Q8)** |

## Acceptance criteria
Hebrew in tests is written as `\uXXXX` escapes. Tests stub `fetch` with `Response` objects, whose headers
jsdom exposes. The browser-side CORS part is proved by the API test in AC4. Existing assertions on text this
spec changes are updated to Table C, never the other way round. A test file marked "new" is extended instead
if a sibling spec created it first (`ErrorState.test.tsx` is also named by `0009c` and `0009g`).

- [ ] AC1 **Offline vs error.** Given `navigator.onLine` false (`vi.spyOn(navigator, 'onLine', 'get')`),
  `ErrorState` shows "אין חיבור לאינטרנט…". After it turns true and an `online` event fires, the box shows
  "משהו השתבש". The retry button calls `onRetry` in both. —
  `web/src/components/__tests__/ErrorState.test.tsx::ac1_offline_vs_server_error` (new, or extended)
- [ ] AC2 **Disabled sign-in says why.** —
  `web/src/features/auth/__tests__/OtpForm.test.tsx::ac2_disabled_submit_explains_why`
  - On signup step 1 with no role, "שלחו לי קוד" is disabled, the hint "כדי להמשיך, צריך לבחור מה מתאים
    לך" shows, and the button's `aria-describedby` is the hint's id. After a role is picked, both are gone.
  - On step 2 with 3 digits, the enterCode hint shows.
  - With 6 digits and the `profile_required` reveal without a role, the chooseRole hint shows. With a role,
    there is no hint.
  - While the request is pending, there is no hint.
- [ ] AC3 **Date read-back.**
  - `web/src/components/__tests__/DateReadback.test.tsx::ac3_reads_the_day_back` (new): "2026-11-12" renders
    "התאריך שנבחר: 12 בנובמבר 2026"; "", "2026-13-40" and "2026-02-30" render nothing, and `isIsoDay`
    is false for them.
  - `SearchPage.test.tsx::ac3_filter_date_read_back`: with the filter's date empty, the input's
    `aria-describedby` is the hint id alone. After a date is typed, it lists both the hint id and the
    read-back id, and the read-back element exists.
  - `DetailsStep.test.tsx::ac3_entry_date_read_back` and `ProfilePage.test.tsx::ac3_move_in_read_back`: the
    read-back shows under each input, and the error id (when there is one) stays in `aria-describedby`.
- [ ] AC4 **Withdraw too late, and how long to wait.**
  - `MyApplicationsPage.test.tsx::ac4_not_withdrawable_copy`: a withdraw answering 409 `not_withdrawable`
    shows "כבר אי אפשר לבטל את המועמדות הזו. הסטטוס שלה עודכן." next to the refetched status. A 500 shows
    "משהו השתבש". The 0004b test `ac8_withdraw` (`MyApplicationsPage.test.tsx:207`) changes its 409 assertion
    from `common.error` to `applications.errors.notWithdrawable`; its 404, 403 and network cases keep
    `common.error`.
  - `web/src/components/__tests__/retryAfter.test.ts::ac4_rounds_up_to_minutes_hours_days` (new):

    | Seconds | Text |
    | --- | --- |
    | 1, 60 | "בעוד דקה" |
    | 61 | "בעוד 2 דקות" |
    | 840 | "בעוד 14 דקות" |
    | 3599, 3600 | "בעוד שעה" |
    | 3601, 7200 | "בעוד שעתיים" |
    | 10800 | "בעוד 3 שעות" |
    | 86399, 86400 | "בעוד יום" |
    | 172800 | "בעוד יומיים" |
  - `ApplySection.test.tsx::ac4_rate_limit_names_the_wait`: a 429 with `Retry-After: 3600` shows
    "הגשת הרבה מועמדויות בזמן קצר. אפשר לנסות שוב בעוד שעה." With 86400 it ends "…בעוד יום.". With no header,
    it shows the existing `applications.errors.rateLimited` line.
  - `OtpForm.test.tsx::ac4_too_many_names_the_wait`: on step 1 and on resend, a 429 with `Retry-After: 840`
    shows "יותר מדי ניסיונות. אפשר לנסות שוב בעוד 14 דקות.". Without the header it shows "יותר מדי ניסיונות.
    אפשר לנסות שוב מאוחר יותר.". `OtpForm`'s existing `tooMany` assertions are updated to that text.
  - `api/tests/test_cors.py::test_ac4_retry_after_is_exposed_to_the_web_origin` (new):
    - `POST /auth/otp/request` with `Origin: <WEB_ORIGIN>` is repeated past its limit. The 429 carries both
      `Retry-After` and `access-control-expose-headers` containing `Retry-After`, next to
      `access-control-allow-origin: <WEB_ORIGIN>`.
    - The same request from `Origin: http://evil.example` gets no `access-control-allow-origin`, so the
      browser hides the whole response, header included.
    - Starlette adds `Access-Control-Allow-Credentials` and `Access-Control-Expose-Headers` to every response
      to a request with an `Origin` (`starlette/middleware/cors.py`), so only the allow-origin header is
      asserted, as `test_auth.py:379` does.
    - The test clears the rate-limit keys it spends, as the auth tests do (`redis_clean`).
- [ ] AC5 **An owner on a listing page.** Given an owner-role `/me` on a listing with 0 / 1 / 3 applicants, the
  section's heading is "מועמדויות" and its line is "עוד אין מועמדויות" / "מועמדות אחת" / "3 מועמדויות". A
  seeker and a visitor still see "הגשת מועמדות" and the seeker lines. —
  `ApplySection.test.tsx::ac5_owner_sees_owner_copy`
- [ ] AC6 **A failed inbox action.** — `ApplicantsPage.test.tsx::ac6_action_error_copy`
  - A shortlist answering 500 shows "השינוי לא נשמר. אפשר לנסות שוב.".
  - With `navigator.onLine` false, it shows the offline line.
  - A 409 shows the refetched status and "השינוי לא נשמר…". The 0004d test `ac6_action_errors` is updated
    from `common.error` to this.
- [ ] AC7 **The owner's parking chip.** — `reasons.test.ts::ac7_owner_parking_chip`
  - `parking_needed` 0 → "חניה לא נדרשת";
  - 2 asked and 1 spot (agree) → "חניה חלקית";
  - 1 asked and 1 spot → "חניה";
  - the differ → "חסרה חניה".

  `reasons.test.ts:622` (`ac6_owner_copy`) calls `ownerShort` with `row.spots ?? 1`, and its rows are
  unchanged. The inbox card tests pass with `MatchChips` passing `props.spots`.
- [ ] AC8 **The people page's reasons are sentences.** — `reasons.test.ts::ac8_person_reason_is_a_sentence`
  - For every criterion and kind, `personReason` differs from `personShort`. move_in included: its chip is
    now `match.owner.short.move_in.*`.
  - For household, contract, parking, smoking and pets, it is the `people.reason.*` text.
  - `reasons.test.ts::ac1_person_reasons_fact_free` (`0008b`) changes in two places:
    - line 677's `expect(personShort(…)).toBe(line)` becomes `.not.toBe(line)`;
    - lines 684-685 expect C24 "הם לא מתאימים לכללי העישון בדירה" and C25 "הם מתאימים לכללי חיות המחמד
      בדירה".

    Its forbidden-word loop (lines 660-680) stays as it is and passes on every new line.
  - `PeoplePage.test.tsx::ac1_cards`'s "למה ההתאמה?" assertions are updated to the sentences.
- [ ] AC9 **Every final join state links somewhere.** —
  `web/src/features/flatmates/__tests__/JoinFlatPage.test.tsx::ac9_final_states_have_a_way_out`
  - A preview answering 409 `own_listing` shows "למודעות שלי" → `/me/listings`.
  - A join answering 409 `already_applied` shows "למועמדויות שלי" → `/me/applications`.
  - `declined`, `flatmates_full`, a 404 and the no-token page show "לחיפוש דירות וחדרים" → `/search`.
  - A 429 shows no link.
  - In every case the link is not inside the `role="alert"` element.
- [ ] AC10 **An empty `/chat` for a flatmate.** Given no conversations and `/me/flats` with one flat, the empty
  state is the flatmate line. With no flats, the owner and seeker lines are as today. While `/me/flats` is
  pending, the role line shows. —
  `web/src/features/chat/__tests__/ChatListPage.test.tsx::ac10_empty_for_a_flatmate`
- [ ] NF1 These are all green on the final head (Speed rule 7): `make lint`, `make test` (api and web),
  `make i18n-check` (with `0009b`'s checker), `make build-web` and a local `make e2e`. The e2e result goes in
  the digest. `he.json` has no bidi or zero-width characters (the `0009b` NF1 grep).

## Tests to write
- **Unit:**
  - `web/src/components/__tests__/ErrorState.test.tsx`, `DateReadback.test.tsx` and `retryAfter.test.ts`
    (new);
  - `reasons.test.ts` (AC7, AC8).
- **Component:** `OtpForm`, `SearchPage`, `DetailsStep`, `ProfilePage`, `MyApplicationsPage`, `ApplySection`,
  `ApplicantsPage`, `JoinFlatPage`, `ChatListPage` and `PeoplePage` (AC2–AC10).
- **API:** `api/tests/test_cors.py` (new, AC4).
- **E2E:** none new.

## Risks / open questions
- **Q6 — the owner's parking chip** (FOLLOWUPS 129; C15, C16).
  - (a) **"חניה חלקית"** for two asked and one spot, and **"חניה לא נדרשת"** when none is needed.
  - (b) Only the not-needed fix; the partial agree keeps "חניה".
  - (c) The numbers, "חניה אחת מתוך 2". This is allowed on the inbox, which already shows the applicant's
    parking under "עוד פרטים", but it is longer than the other chips.

  Recommendation: (a). Written on (a), accepted by Gilad 2026-11-12.
- **Q7 — a way out of the join-flat states** (FOLLOWUPS 189; C27–C29).
  - (a) **A link per state**: own → "למודעות שלי", applied → "למועמדויות שלי", declined / full / invalid →
    "לחיפוש דירות וחדרים" (the same words as `0009g`'s `listing.toSearch`), and none for the rate limit.
    The three keys stay separate from `applications.viewMine`, so Gilad can change these links alone.
  - (b) One link "לדף הבית" on every state.
  - (c) No link (today).

  Recommendation: (a). Written on (a), accepted by Gilad 2026-11-12.
- **Q8 — an empty `/chat` for a flatmate** (FOLLOWUPS 195, the open 0008f copy decision; C30).
  - (a) **C30's line**, shown when the person has at least one flat.
  - (b) A shorter "שיחות על החדר יופיעו כאן".
  - (c) Keep the owner and seeker lines.

  Recommendation: (a). It says when a chat appears: on a shortlist or a mutual match, the two ways a chat
  opens (PRODUCT.md "Chat"). Written on (a), accepted by Gilad 2026-11-12.
- **`navigator.onLine` limits.** It is false only when the device has no network. A dead API on working wifi
  still reads "משהו השתבש", which is accurate enough. Nothing polls.
- **The CORS change is the only API change.** Exposing one response header to the one allowed origin reveals
  nothing new: the header was already sent, only hidden from scripts. No security reviewer is needed. The code
  reviewer checks the one line and its test.
- **SMS later (Slice 12).** C3 "…מהאימייל" (like today's `auth.code.label`) will be wrong once SMS OTP is
  switched on (PRODUCT.md "OTP"). Slice 12's SMS spec rewords both.
- **Ownership of FOLLOWUPS 17 and 24: resolved.** The orchestrator's brief gave both to the copy pass. The
  sibling drafts now agree:
  - `0009c:225` and `0009t:96,141` say FOLLOWUPS 24 and 17 are `0009f`'s;
  - `0009g:82,184` says the offline text is `0009f`'s (`useOnline`), and `0009g` changes only the retry
    button.

  `0009t`'s verifier note on the hint order (codeLength while fewer than 6 digits, then chooseRole, and none
  while pending) is what item 2 already says. Item 4 owns line 71's copy part, as `0009c:27` now says.
  `0009c`'s split took id `0009t`, so there is no clash with this spec's id. The 0009c planner confirmed on
  2026-11-12 that no other spec creates `auth.hints.*` or `common.offline`. `0009g` changes only the retry
  button (`aria-disabled` + `aria-busy`, still focusable), and `0009c` adds `page`; neither touches the
  message line.
- **Conflicts** (shared files; each overlap is a few lines, and the second to merge rebases):
  - `0009b`: this spec builds on its branch.
  - `0009c`: `OtpForm.tsx` (the resend live region), `ApplySection.tsx` / `MyApplicationsPage.tsx` (focus
    after submit and withdraw, drafts), `ApplicantCard.tsx`, and `JoinFlatPage.tsx` (it focuses the alert
    `<p>`; the link stays outside it, item 9).
  - `0009g`: `ErrorState.tsx`. Its promise-aware `onRetry` / busy retry sits next to item 1's message line.
    It also has `listing.toSearch`, the same words as C29.
  - `0009h`: the `ErrorState` restyle.
  - `0009m` (auth and profile styling): `OtpForm.tsx`, `ProfilePage.tsx`.
  - `0009i` (search): `FiltersForm.tsx`. `0009k` (wizard): `DetailsStep.tsx`. `0009l` (inbox):
    `ApplicantCard.tsx`, `MatchChips.tsx`. `0009p` (people): `PersonCard.tsx` reads `personReason` /
    `personShort`.
  - `0009q` (lists, chat, flatmates): `JoinFlatPage.tsx`, `ChatListPage.tsx`, `MyApplicationsPage.tsx`.
- **Verification.** Verifier round 1: 14 findings, all applied, second round waived. The findings were:
  - the CORS test proved on a real 429, asserting allow-origin only;
  - AC8 aligned with move_in's chip and the fact-free test;
  - 17/24 ownership stated above;
  - `ac8_withdraw` named;
  - the `MatchChips` call site;
  - the `agreePartial` / `agreeNone` names;
  - `isIsoDay`, the conditional describedby and `DateReadback`'s home;
  - join links outside the alert;
  - one `parseRetryAfter`;
  - Hebrew fixes to C8, C20, C21 and C23–C26, and C29 aligned with `0009g`;
  - `/chat` while the flats load;
  - the SMS note;
  - the estimate raised to Opus/medium.

  The verifier checked the Retry-After table and found it consistent.

## Digest (filled by orchestrator after verification)
See `/digest`.
