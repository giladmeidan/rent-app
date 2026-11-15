---
id: 0011d
title: "The report button reaches every other place people meet: a chat, the owner's inbox, a room's people page"
status: done
depends_on: [0011b]   # its ReportButton / ReportDialog, reasons, `report` i18n keys and POST /reports (chat, applicant and room_person targets already accepted)
reviewers: [code, qa, ux]   # web only: no API, data or auth change (0011b's security review covers POST /reports and its five target rules); qa: the entry points; ux: chat header, inbox card and pane, people card
estimate: 1 coder run   # coder Sonnet/high (web only, reuses 0011b's components; Speed rule 6)
---

## Goal
After this ships, the report button is everywhere a signed-in user meets another user (PRODUCT.md "Trust
(MVP)"): besides 0011b's listing page and market person cards, in **a chat** (application chats, room group chats
and direct market chats), on **an applicant in the owner's inbox** (phone card and desktop pane) and on **a
person on a room's people page**. The deposit warning (`chat.thread.warning`, 0005b) is unchanged: it stays above
the messages of every thread, direct and truncated ones included (PRODUCT.md "Trust (MVP)").

## Decisions this spec builds on
- PRODUCT.md "Trust (MVP)" (Gilad, 2026-11-14): reports stored only; the deposit line already shipped and left as
  it is.
- 0011b's choices: target = the id the page holds; a chat report names the chat's **other side** (the person in
  its header, `other_name`); `LISTING_REASONS` where a listing is involved, else `PERSON_REASONS`; the dialog,
  its states, offline and errors are 0011b's and unchanged here.

## Scope
**In:**
- `web/src/features/reports/ReportButton.tsx` and `ReportDialog.tsx` (0011b's): two optional props for the chat,
  `ariaLabel?: string` (the button's accessible name) and `hint?: string` (a `text-body-sm text-ink-muted`
  paragraph between the intro and the reasons, referenced by nothing else); absent, both render as in 0011b.
- `web/src/features/chat/ChatThreadPage.tsx` (`Thread`): a report button in the caption row (the listing row's
  `<p>` becomes a `<div>`).
- `web/src/features/applicants/ApplicantCard.tsx` (the phone's `stacked` card) and `ApplicantPane.tsx` (the
  desktop pane): a report button.
- `web/src/features/people/PersonCard.tsx` (a room's people page): a report button.
- `web/src/locales/he.json`: one key (`report.groupHint`).
- Tests: `ChatThreadPage.test.tsx`, `ApplicantsPage.test.tsx`, `PeoplePage.test.tsx`; the e2e
  `web/e2e/inbox.spec.ts::ac12_shortlist_chat_decline` amended.

**Out:**
- Any API, schema or data change (0011b's `POST /reports` already takes `chat`, `applicant`, `room_person`).
- Naming one flatmate in a group chat (0011b Risks, FOLLOWUPS); a report per message.
- The desktop inbox's compact cards (the pane beside them carries the button), the chat list, "my applications",
  invites and flatmate pages (each links to a chat or a listing page, which have the button).
- Any change to the deposit line (`chat.thread.warning`): its condition, place, copy and look stay as 0005b /
  0010g left them, in every thread.

**New dependencies:** none.

## Data
None.

## API
None new. The web posts to 0011b's `POST /reports` (auth: `current_user`) with:

| Place | `target_type` | `target_id` | Reasons |
| --- | --- | --- | --- |
| A chat with a listing (an application chat, a room group chat) | `chat` | the route's conversation id | `LISTING_REASONS` |
| A direct chat (`thread.listing === null`) | `chat` | the route's conversation id | `PERSON_REASONS` |
| An applicant (inbox card, desktop pane) | `applicant` | `ApplicantOut.id` | `PERSON_REASONS` |
| A person on a room's people page | `room_person` | `PersonOut.id` (the pair's id) | `PERSON_REASONS` |

## UI
No artboard; the kit and 0011b's `ReportButton` (ghost, small, outline flag icon) and dialog.

### Chat thread (`ChatThreadPage.tsx`, the loaded `Thread` only)
- **Report button.** In the caption row under the header, after the row's existing controls:
  - with a listing: the row that holds the listing line and "לעמוד הדירה" / "למועמדויות". It is a `<p>` today;
    it becomes a `<div>` with the same classes (the dialog's `<dialog>` element may not sit inside a `<p>`), the
    listing text staying in its `<span>`;
  - a direct chat: the inner row beside `chat.thread.direct` and, while it can send, "הסרת ההתאמה"; the report
    button shows whether or not the chat is closed.
  - `ReportButton` with `label = report.button`, `ariaLabel = title = t('report.title.person', { name:
    thread.other_name })` (the accessible name contains the visible word, WCAG 2.5.3), target `{chat, id}`,
    reasons per the API table, and in a group chat (`members.length > 2`) `hint = t('report.groupHint', {
    name: thread.other_name })`.
- States: loading, error, not found and removed are unchanged; the button exists only in the loaded thread; the
  dialog's own states are 0011b's.

### Owner's inbox (`ApplicantCard.tsx` `stacked`, `ApplicantPane.tsx`)
- The phone card: a last row (`flex justify-end`) after the actions and their error, for **every** status
  (submitted, shortlisted, declined): `ReportButton` with `describedBy = headingId` (as every other button of the
  card), `title = report.title.person` with `applicant_name`, `PERSON_REASONS`, target `{applicant,
  applicant.id}`. The compact desktop card (`layout="compact"`) gets none.
- The desktop pane: the same button as the card's last item (after the chat link when there is one),
  `describedBy` = the pane's `headingId` (`${id}-name`).
- States: the inbox's empty, loading and error states are unchanged (no card, no button).

### A room's people page (`PersonCard.tsx`)
The invite button's block becomes a row (`flex flex-wrap items-center justify-between gap-2`): the invite
button at the inline start, `ReportButton` at the inline end (`describedBy = headingId`, `title =
report.title.person` with `display_name`, `PERSON_REASONS`, target `{room_person, person.id}`); the invite
error stays under the row. Empty, loading, error and not-live states of `PeoplePage` are unchanged.

### i18n (`web/src/locales/he.json`)
| Key | Hebrew |
| --- | --- |
| `report.groupHint` | `הדיווח הוא על {{name}}. אם הבעיה היא עם מישהו אחר בשיחה, אפשר לכתוב את זה בפרטים.` |

Everything else is 0011b's (`report.*`).

### RTL
Logical properties only: the report buttons sit at the inline end of their rows (`justify-between` /
`justify-end`), after the row's other controls in reading order; the hint is start-aligned in the dialog body.

## Acceptance criteria
- [ ] AC1 (chat report) In an application chat (seeker view), the caption row holds a button named `דיווח על
  {other_name}` (visible text `report.button`); it opens the dialog with that title, six reasons, and posts
  `{target_type: "chat", target_id: <route id>}`; in a direct chat the button is there, open or closed, with
  five reasons (no `report.reasons.unavailable`); in a group chat (three members) the dialog shows
  `report.groupHint` with `other_name`, and a two-person chat does not — `web/src/features/chat/__tests__/ChatThreadPage.test.tsx::ac1_report_from_chat`
- [ ] AC2 (inbox) On the phone, every applicant card (submitted, shortlisted, declined) ends with
  `report.button`, described by the applicant's name like the card's other buttons; it opens `דיווח על {name}`
  with five reasons and posts `{target_type: "applicant", target_id: applicant.id}`; on the desktop the pane has
  the button and the compact cards do not. Existing tests that list a card's buttons gain `report.button`
  (e.g. `buttonsOf(MICHAL)`); the "every button described by the name" loops pass unchanged —
  `web/src/features/applicants/__tests__/ApplicantsPage.test.tsx::ac2_report_applicant`
- [ ] AC3 (room people page) Each person card has `report.button` described by the person's name, in the invite
  row; it opens `דיווח על {name}` with five reasons and posts `{target_type: "room_person", target_id: person.id}`
  — `web/src/features/people/__tests__/PeoplePage.test.tsx::ac3_report_room_person`
- [ ] AC4 (e2e, CI only) In `inbox.spec.ts::ac12_shortlist_chat_decline`, after the seeker's thread shows
  "Hello" and before the reply: the seeker presses the button named
  `דיווח על {OWNER_NAME}`, `expectNoAxeViolations(seekerPage, 'chat report dialog')`, picks
  `report.reasons.moneyBeforeViewing`, sends, sees `report.sent` and closes; the test then goes on unchanged —
  `web/e2e/inbox.spec.ts::ac12_shortlist_chat_decline`

## Tests to write
Vitest with the files' existing harnesses and mocked API (`POST /reports` answered 201): `ChatThreadPage.test.tsx`
(AC1), `ApplicantsPage.test.tsx` (AC2 at phone and desktop widths, as its 0009u tests switch),
`PeoplePage.test.tsx` (AC3). E2E: the amended `inbox.spec.ts` — **e2e runs only in CI, never
locally** (Speed rule 8; the coder does not run `make e2e`). `make screens`: the existing chat, applicants and
people states show the new button; no new state (the dialog's look is 0011b's state).

## Risks / open questions
No question blocks the coder.
- **Group chats** name the other side only (0011b's decision); the hint sends anything about another member to
  the note. FOLLOWUPS line is 0011b's.
- **Merge order**: this builds from 0011b's branch once its PR is open, and merges `origin/main` after 0011b
  lands (Speed rule 3).

## Blast radius
`graphify affected` on main's graph (built before Slice 14; confirmed with grep on `main`):
- `ChatThreadPage` / `Thread` (graphify): `AppRoutes` / `App.tsx`; tests `ChatThreadPage.test.tsx` (AC1 added; every
  existing test, including `ac4_thread_renders_plain_text` and `ac11_direct_chat_header_and_closed_note`, passes
  unchanged: the note is untouched; the caption row's `<p>`→`<div>` is asserted by none, grep),
  `chat/__tests__/harness.tsx`, `ChatLayout.test.tsx`,
  `ChatListPage.test.tsx`, `ChatStreamProvider.test.tsx`, `RequireUser.test.tsx`, `AuthMenu.test.tsx` and the
  app tests (they route through the page; none asserts the note or the caption's tag, grep); e2e
  `inbox.spec.ts:87` (unchanged) and AC4.
- `ApplicantCard` (graphify): `ApplicantsPage` → routes; `ApplicantsPage.test.tsx` (`buttonsOf` lists gain the
  report button; the `aria-describedby` loops hold), `RequireOwner.test.tsx` (routes only). e2e
  `inbox.spec.ts:130-133` count action buttons by name and links: the report button is neither.
- `ApplicantPane` (graphify): `ApplicantsPage`; `ApplicantsPage.test.tsx` (AC2), `RequireOwner.test.tsx`.
- `PersonCard` (graphify): `PeoplePage` → routes; `PeoplePage.test.tsx` (AC3), `RequireOwner.test.tsx`.
- `ReportButton` / `ReportDialog` (0011b, not in the graph yet): two optional props; 0011b's callers
  (`ListingPage`, `MarketPersonCard`) and `ReportDialog.test.tsx` pass none and are unchanged. `reasons.ts`: read
  only.

## Digest (filled by orchestrator after verification)
Spec 0011d — Report from chat, the inbox and a room's people   (verified 2026-11-14; part 2 of 2 after 0011b)
What a user can do after this: report the other side of a chat from its header, an applicant from the owner's inbox
(card and pane), and a person on a room's people page, with 0011b's dialog. Web only; the chat's deposit warning
stays exactly as 0005b shipped it.
Decisions I need from you: none. FYI: in a group chat the report names the chat's other side; flatmates are named
in the note (they cannot be picked one by one).
KPIs this slice moves: trust (reports reachable everywhere people meet).
Acceptance targets: no NF lines.
Risks: starts from 0011b's branch once its PR is open; merges `origin/main` after 0011b lands.
Reviewers: code, qa, ux   Estimated: 1 coder run (Sonnet/high), 1 review round
Links: `specs/0011d-report-chat-inbox.md` · `specs/0011b-report-button.md` · PRODUCT.md "Trust (MVP)"

Spec 0011d — Report from chat, the inbox and a room's people   PR #97 (head 25d5c61, ci green; merged as c4314cb)
Shipped: 0011b's report button now appears in every chat (application, room group, direct, open or closed;
listing chats get six reasons, direct chats five, group chats a hint naming the other side), on the owner's inbox
phone card for every status and on the desktop pane (not on compact cards), and on each person card on a room's
people page. The deposit warning is unchanged. Web only, one new i18n key (`report.groupHint`).
Demo: make dev → as a seeker open an application chat → "דיווח" in the caption row → pick a reason, send →
"sent". As the owner open the inbox → the applicant's "דיווח". Open a room's people page → "דיווח" beside the invite button.
Tests: +4 vitest (ac1 chat, ac2 pane + phone card, ac3 room person), `buttonsOf` lists amended, +0 e2e (AC4 step
added to `inbox ac12`)   CI: green in 8m42s (Flaky e2e warning: `market ac18` passed on retry, unrelated, logged)
Findings: 0 blockers, 0 majors, 3 minors fixed (test placement/order asserts; 2 duplicates), 4 nits dropped;
FOLLOWUPS: 1 added (the flaky `market ac18`).
Changed in PRODUCT.md: nothing.
Next spec I propose: none in Slice 11 (0011d was its last spec).

## Verifier findings
One round (2026-11-14). Rejected on checklist item 7: the deposit-line change contradicts PRODUCT.md "Trust
(MVP)": the deposit warning is "**already shipped** by 0005b (`chat.thread.warning`, above the messages of every
chat thread) and left as it is". This spec hides it in direct chats and in truncated threads. Everything else
passes (the four targets match 0011b's rules and the real `ApplicantCard` / `ApplicantPane` / `PersonCard` /
`ChatThreadPage` code; graphify + grep blast radius complete; one Sonnet coder run). Apply these and the spec is
report buttons only; then set `status: verified` (no second review).
1. **Frontmatter.** `title:` → "The report button reaches every other place people meet: a chat, the owner's
   inbox, a room's people page". `reviewers:` comment: drop "+ the deposit-line rule" (qa: the entry points).
2. **Goal.** Delete the sentence from "And the deposit warning becomes what Gilad decided" to "no API or data
   change." Add instead: "The deposit warning (`chat.thread.warning`, 0005b) is unchanged: it stays above the
   messages of every thread, direct and truncated ones included (PRODUCT.md \"Trust (MVP)\")."
3. **Decisions.** First bullet: "reports stored only; the deposit line already shipped and left as it is". Delete
   the whole "**Today's line**" bullet.
4. **Scope In.** The `ChatThreadPage.tsx` line becomes "(`Thread`): a report button in the caption row (the
   listing row's `<p>` becomes a `<div>`)". Tests line: drop nothing else; `ChatThreadPage.test.tsx` gains AC1
   only. **Scope Out:** replace "Keyword detection, a dismiss, or any change to the line's copy or look." with
   "Any change to the deposit line (`chat.thread.warning`): its condition, place, copy and look stay as 0005b /
   0010g left them, in every thread."
5. **UI → Chat thread.** Delete the "**Deposit line.**" bullet entirely. In "States", drop "and show neither"
   → "are unchanged; the button exists only in the loaded thread".
6. **i18n.** Change the last line to "Everything else is 0011b's (`report.*`)."
7. **AC2.** Delete it (and its test `ac2_deposit_line_only_at_the_start_of_application_chats`). Renumber
   AC3→AC2, AC4→AC3, AC5→AC4 in the ACs, the test names (`ac2_report_applicant`, `ac3_report_room_person`) and
   "Tests to write". `ac4_thread_renders_plain_text` and `ac11_direct_chat_header_and_closed_note` are **not**
   amended: they keep asserting the note as today.
8. **AC5 (now AC4, e2e).** Drop "the thread shows the `role=\"note\"` warning;" (it is 0005b's, unchanged); the
   rest stays.
9. **Tests to write.** `ChatThreadPage.test.tsx` "(AC1)" only, without "AC2 and the two amended tests".
10. **Risks.** Delete the "**Truncated threads lose the line.**" and "**0010g's test changes meaning**" bullets.
11. **Blast radius.** `ChatThreadPage` line: replace "(AC1, AC2, `ac4_…` and `ac11_…` amended; `ac9_…` and
    `ac2_one_to_one_…` keep their assertions on an untruncated application chat)" with "(AC1 added; every
    existing test, including `ac4_thread_renders_plain_text` and `ac11_direct_chat_header_and_closed_note`, passes
    unchanged: the note is untouched; the caption row's `<p>`→`<div>` is asserted by none, grep)"; "e2e
    `inbox.spec.ts:87` (unchanged) and AC4".

Applied by the orchestrator 2026-11-14; one verifier round.
