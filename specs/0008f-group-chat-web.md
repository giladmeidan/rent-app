---
id: 0008f
title: Room chats become group chats on screen — every thread with flatmates lists its members and names each sender, a flatmate sees when their history starts, and a flatmate finds and leaves their flats from the chat list
status: verified
depends_on: [0008e]   # 0008e: features/flatmates (api.ts, formatDay, the ['me','flats'] key) and the join flow; 0008d via 0008e: ThreadOut.members/my_role/visible_from, MessageOut.sender_name, ConversationOut.my_role/member_count, GET/DELETE /me/flats
reviewers: [code, qa, security, ux]   # security: chat membership rendering and the owner-only link now keyed on my_role; ux: group header, sender names; qa: group vs one-to-one rendering
estimate: 1 coder run   # coder Sonnet/medium. Split from the draft 0008e by the verifier
---

## Goal
After this ships, every thread with more than two members shows a member line in its header, for example
"רוני (בעל/ת הדירה) · את/ה · נועה". In a group thread, each message from someone else carries its sender's
name. A flatmate sees the note "הצטרפת לשיחה ב־{{date}}. הודעות קודמות לא מוצגות." In the chat list, a
flatmate's conversations carry "שותף/ה", and any group carries "קבוצה · N". A link "הדירות שלי" opens
`/me/flats`, where a flatmate leaves a flat. One-to-one threads look exactly as they do today.

This serves PRODUCT.md "Flatmates" ("the chat header lists every member"; history from joining on). It is Dev
Plan slice 8, part f. The thread keeps `0005b`'s layout, after `InboxDesktop.dc.html`'s chat column.

## Scope
**In:**
- `web/src/app/routes.tsx`: inside `RequireUser`, `me/flats` → `MyFlatsPage`.
- `web/src/features/chat/ChatThreadPage.tsx`:
  - The toApplicants link (line ~95) is chosen by `thread.my_role === 'owner'`, not `me.data?.role`. An
    owner-role account can be a flatmate in someone else's flat.
  - When `members.length > 2`:
    - a member line under the title, labelled for screen readers by `chat.members`. Each member renders as
      `chat.memberWithRole` (`{{name}} ({{role}})`, with `chat.roles.owner` / `chat.roles.flatmate`), the
      seeker by name only, and the member with `is_me` as `chat.you`;
    - every message with `mine` false shows `sender_name` above its bubble, once per run of consecutive
      messages from the same sender. `Bubble`'s sr-only "theirs" label (`chat.thread.theirs`) uses
      `message.sender_name`, not `other_name`.
  - When `visible_from` is set: a muted note at the top, `chat.joinedNote` with `formatDay(visible_from)`
    (`features/flatmates/format.ts`, `0008e`).
  - One-to-one threads render exactly as today.
- `web/src/features/chat/ChatListPage.tsx`: an item with `my_role === 'flatmate'` carries the chip
  `chat.flatmateChip`. Any item with `member_count > 2` shows `chat.group` ("קבוצה · {{count}}"). A link
  `chat.myFlats` → `/me/flats` sits in the page header and shows only when `useMyFlats` returns at least one
  flat.
- `web/src/features/flatmates/`:
  - `api.ts` gains `useMyFlats()` (key `['me', 'flats']`) and `useLeaveFlat()`, which invalidates the my-flats
    key and `CONVERSATIONS_KEY`.
  - `MyFlatsPage.tsx`:
    - **loading**: `Skeleton`;
    - **error**: `ErrorState`;
    - **empty**: `flatmates.mine.empty`, with the back link to `/chat`;
    - **success**: each flat shows `cardTitle(listing)`, the owner's name (`flatmates.mine.owner`),
      `flatmates.mine.joinedAt` with the day, and "יציאה מהדירה" (`window.confirm(t('flatmates.mine.leaveConfirm'))`).
      A failed leave shows `common.error` inline.
- `web/src/locales/he.json`:

  | Key | Hebrew |
  | --- | --- |
  | `chat.members` | "משתתפים בשיחה" |
  | `chat.memberWithRole` | "{{name}} ({{role}})" |
  | `chat.roles.owner` | "בעל/ת הדירה" |
  | `chat.roles.flatmate` | "שותף/ה" |
  | `chat.you` | "את/ה" |
  | `chat.joinedNote` | "הצטרפת לשיחה ב־{{date}}. הודעות קודמות לא מוצגות." |
  | `chat.group` | "קבוצה · {{count}}" |
  | `chat.flatmateChip` | "שותף/ה" |
  | `chat.myFlats` | "הדירות שלי" |
  | `flatmates.mine.title` | "הדירות שאני שותף/ה בהן" |
  | `flatmates.mine.empty` | "לא הצטרפת לאף דירה." |
  | `flatmates.mine.back` | "חזרה לשיחות" |
  | `flatmates.mine.owner` | "בעל/ת הדירה: {{name}}" |
  | `flatmates.mine.joinedAt` | "הצטרפת ב־{{date}}" |
  | `flatmates.mine.leave` | "יציאה מהדירה" |
  | `flatmates.mine.leaveConfirm` | "לצאת מהדירה? לא תראה/י יותר את השיחות על החדר." |
- Fixtures (`features/chat/__tests__/fixtures.ts`): the conversation gains `my_role: 'seeker'` and
  `member_count: 2`. The thread gains `my_role`, `members` (two, one `is_me`) and `visible_from: null`. Each
  message gains `sender_name`. The existing tests pass unchanged with these one-to-one defaults.

**Out:**
- Any flatmate view of the inbox, people page or applicant profile (PRODUCT.md: chat only).
- Avatars or colours per sender. The name is enough.

**New dependencies:** none.

## Data
None (web only).

## API
Consumes `0008d`: `ThreadOut` (`my_role`, `members[{name, role, is_me}]`, `visible_from`), `MessageOut.sender_name`,
`ConversationOut` (`my_role`, `member_count`), `GET /me/flats`, `DELETE /me/flats/{listing_id}`.

## UI
RTL: logical classes only. The member line separates names with " · " and wraps. At 360 px it wraps to at
most two lines (`line-clamp-2`), with the full list in `title` and an sr-only copy. Sender names sit above the
bubble on the start side, `text-sm text-muted`. MyFlatsPage is one column, `max-w-[480px]`.

## Acceptance criteria
- [ ] AC1 Given a thread with `members` [owner רוני, flatmate דנה `is_me`, seeker נועה] and `visible_from`
  set, Then:
  - the header lists "רוני (בעל/ת הדירה) · את/ה · נועה" with the joined note (Asia/Jerusalem day);
  - others' consecutive messages show the sender's name once per run;
  - each bubble's sr-only label names its sender;
  - no toApplicants link renders (`my_role` is flatmate).

  — `web/src/features/chat/__tests__/ChatThreadPage.test.tsx::ac1_group_header_and_senders`
- [ ] AC2 Given a one-to-one thread (the existing fixtures), Then no member line, no sender names and no note
  render, and every `0005b` assertion passes. Given an owner-role user whose `my_role` is `flatmate`, no
  toApplicants link renders. Given `my_role: 'owner'`, it renders as today. — `ChatThreadPage.test.tsx::ac2_one_to_one_unchanged_and_owner_link`
- [ ] AC3 Given `/me/conversations` with a flatmate item (`my_role: 'flatmate'`, `member_count` 3) and a
  one-to-one item, Then the first shows "שותף/ה" and "קבוצה · 3" and the second neither. "הדירות שלי"
  shows only when `GET /me/flats` is non-empty. — `web/src/features/chat/__tests__/ChatListPage.test.tsx::ac3_flatmate_items`
- [ ] AC4 `/me/flats` lists the flats with the owner's name and the join day. "יציאה מהדירה" → confirm →
  `DELETE /me/flats/{listing_id}` and a refetch. The empty, loading and error states and a failed leave show.
  — `web/src/features/flatmates/__tests__/MyFlatsPage.test.tsx::ac4_flats_and_leave`
- [ ] AC5 E2E with three browser contexts:
  1. Owner `O` posts a room and creates the link (`createInvite` helper).
  2. `F` joins through the UI.
  3. Seeker `S` applies through the API, and `O` shortlists in the inbox.
  4. `F` opens the chat: the header lists the three members and the joined note.
  5. `F` sends "היי, אני דנה".
  6. `S`'s thread shows the message with `F`'s name above it.
  7. `O` removes `F` on the flatmates page: `F`'s chat list no longer has the conversation.

  — `web/e2e/flatmates.spec.ts::ac5_group_chat_flow`
- [ ] NF1 `make lint`, `make test`, `make i18n-check`, `make build-web` and local `make e2e` are green (Speed
  rule 7). The e2e result goes in the digest.

## Tests to write
Component tests: the cases above, using the chat harness (`features/chat/__tests__/harness.tsx`) and
`vi.stubGlobal('fetch', ...)`. E2E: one test added to `web/e2e/flatmates.spec.ts`.

## Risks / open questions
- Group rendering must leave one-to-one threads unchanged. AC2 runs the existing assertions on the default
  fixtures.
- `/chat` makes one more request (`/me/flats`) per visit. It is cheap and cached.

This file was split from the draft `0008e` by spec-verifier round 1 (finding 3). The findings that apply here
(6a/6b, the `is_me` member flag, the keys, the dates and the states) are written in. The second round is waived.

## Digest (filled by orchestrator after verification)
    Spec 0008f - Group chat web   (verified, Slice 8; depends on 0008e; split from 0008e by the verifier)
    What a user can do after this: room chats with flatmates list every member in the header and name each
             sender; a flatmate sees where their history starts and leaves a flat from "הדירות שלי".
    Decisions I need from you: none.
    KPIs this slice moves: messages sent by flatmates per room chat.
    Acceptance targets: lint/test/i18n/build clean + make e2e green locally; one-to-one threads unchanged.
    Risks: group rendering leaking into one-to-one threads - mitigation: the existing thread tests run unchanged.
    Reviewers: code, qa, security, ux   Estimated: 1 coder run (Sonnet/medium)
    Links: specs/0008f-group-chat-web.md - PRODUCT.md "Flatmates" - design/screens-v1/InboxDesktop.dc.html
