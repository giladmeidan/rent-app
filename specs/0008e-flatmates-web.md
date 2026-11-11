---
id: 0008e
title: A room's lister creates and shares the flat's invite link and manages flatmates; a flatmate joins from the link and chats in the room's group chats, where every thread lists its members and names each sender
status: draft
depends_on: [0008d, 0008b]   # 0008d: every endpoint and chat field used here; 0008b: the room card's link row in MyListingsPage that this extends (same file, built first)
reviewers: [code, qa, ux]   # ux: two new pages, a group header and sender names in the thread; qa: join states, rotate/disable, remove/leave, group vs one-to-one rendering; no security: the API (0008d) enforces access
estimate: 1 coder run   # coder Sonnet/medium; Opus if the run overflows
---

## Goal
After this ships, an owner's **room** card in `/me/listings` has **"שותפים בדירה"** (with the count). It opens
`/me/listings/:id/flatmates`, which offers:
- "יצירת קישור הזמנה": the link is shown once, with a copy button;
- "קישור חדש" to rotate the link, and "ביטול הקישור" to turn it off;
- the flatmates list, each with "הסרה" behind a confirm.

Whoever opens `/flatmates/join/:token` (after logging in, if needed) sees which flat it is and whose, and taps
"הצטרפות לדירה". The flatmate's chats then show the room's conversations. Every thread with more than two
members shows a member line in its header, "רוני (בעל/ת הדירה) · דנה (שותפה) · נועה". In a group thread each
message from someone else carries its sender's name. A flatmate sees the note "הצטרפת לשיחה ב־{{date}}. הודעות
קודמות לא מוצגות." The chat list offers "הדירות שלי" (`/me/flats`), where a flatmate can leave a flat.

This serves PRODUCT.md "Flatmates" (Gilad, 2026-11-11). It is Dev Plan slice 8, part e. No artboard. The thread
keeps `0005b`'s layout, after `InboxDesktop.dc.html`'s chat column.

## Scope
**In:**
- `web/src/app/routes.tsx`:
  - inside `RequireOwner`: `me/listings/:id/flatmates` → `FlatmatesPage`;
  - inside `RequireUser`: `flatmates/join/:token` → `JoinFlatPage` and `me/flats` → `MyFlatsPage`.

  `RequireUser` already sends a visitor to `/login?next=` (`0004b`'s safe `next`), so the token survives login.
- `web/src/features/flatmates/` (new):
  - `api.ts` holds the types, the query keys and these hooks: `useCreateInvite`, `useDisableInvite`,
    `useFlatmates(listingId)`, `useRemoveFlatmate`, `useInvitePreview(token)`, `useJoinFlat`, `useMyFlats`,
    `useLeaveFlat`.
  - `FlatmatesPage.tsx` holds the invite block and the list:
    - **Invite block.** With `flatmate_invite_active` false: a hint and "יצירת קישור הזמנה". After a create,
      the full URL is `${window.location.origin}/flatmates/join/${token}`. It shows in a read-only input with
      "העתקה" (`navigator.clipboard.writeText`; on failure, select the text), and the warning "הקישור מוצג פעם
      אחת. כל מי שמקבל אותו יכול להצטרף." With an active link whose token is no longer in memory (after a
      reload): "יש קישור פעיל" with "קישור חדש" (rotate, which shows the new link) and "ביטול הקישור"
      (disable).
    - **List.** Each flatmate shows their name and "הצטרף/ה ב־{{date}}", with "הסרה". The confirm dialog reads
      "להסיר את {{name}}? הוא/היא לא יראה/תראה יותר את השיחות על החדר."
  - `JoinFlatPage.tsx` renders one of these states:
    - **loading**;
    - **preview**: the listing title line (`cardTitle`), the city and street, "הוזמנת על ידי {{owner}}", and
      "הצטרפות לדירה";
    - **already a member**: "כבר הצטרפת לדירה הזו" with "לשיחות" → `/chat`;
    - **joined**: navigates to `/chat`, with the note `flatmates.join.done`;
    - **404**: "הקישור לא בתוקף. בקשו מבעל/ת הדירה קישור חדש.";
    - **own listing**: "זו המודעה שלך";
    - **already applied**: "הגשת מועמדות לחדר הזה, ולכן אי אפשר להצטרף כשותף/ה";
    - **full**: "בדירה כבר 7 שותפים";
    - **429**: the rate-limit text;
    - **other errors**: `ErrorState`.
  - `MyFlatsPage.tsx`: the flats list (listing title, owner name, the join date) with "יציאה מהדירה" behind a
    confirm. It has an empty state and a back link to `/chat`.
- `web/src/features/listings/MyListingsPage.tsx`: on every **room** card (any status), a link "שותפים בדירה
  ({{count}})" to `/me/listings/{id}/flatmates`, in the same link row as `0008b`'s "מחפשים חדר".
- `web/src/features/chat/`:
  - `ChatThreadPage.tsx`, when `members.length > 2`:
    - a member line under the title. Each member is shown as name plus role label (`chat.roles.owner` "בעל/ת
      הדירה", `chat.roles.flatmate` "שותף/ה", the seeker by name only), the caller shown as "את/ה";
    - every message whose `mine` is false shows `sender_name` above its bubble. Consecutive messages from the
      same sender show it once.

    When `visible_from` is set, a muted note at the top reads `chat.joinedNote`. One-to-one threads render
    exactly as today.
  - `ChatListPage.tsx`: an item with `my_role === 'flatmate'` carries the chip "שותף/ה". Any item with
    `member_count > 2` shows "קבוצה · {{count}}". A link "הדירות שלי" → `/me/flats` sits in the page header
    and shows only when `useMyFlats` returns at least one flat.
- `web/src/locales/he.json`: the `flatmates.*` keys (UI), `chat.roles.*`, `chat.joinedNote`, `chat.group`,
  `chat.flatmateChip`, `chat.myFlats` and `listings.mine.flatmates`.
- Fixtures: the chat fixtures gain `my_role`, `member_count`, `members`, `visible_from` and `sender_name`, with
  one-to-one defaults. The listing fixtures gain `flatmate_count: 0` and `flatmate_invite_active: false`.

**Out:**
- Any flatmate view of the inbox, people page or applicant profile (PRODUCT.md: chat only).
- Native share sheets (`navigator.share`). Copy is enough for MVP.
- Showing the invite token again after a reload. It is unrecoverable by design (`0008d`); rotate instead.

**New dependencies:** none.

## Data
None (web only).

## API
Consumes `0008d` (every flatmates endpoint, the new chat fields, `MyListingOut.flatmate_count` /
`flatmate_invite_active`). Run `make client`.

## UI
States as listed in Scope. Destructive actions (remove, leave, disable, rotate) use the existing confirm
pattern of `0004d`'s decline dialog. Rotating warns: "הקישור הקודם יפסיק לעבוד."

RTL: logical classes only. In the member line, names are separated by " · " and wrap. Sender names sit above
the bubble on the start side for others' messages. Mobile at 360 px: the member line wraps to two lines at
most, then truncates with the full list in a `title` and an `sr-only` copy.

i18n:
- `flatmates.title`, `flatmates.back`;
- `flatmates.invite.create`, `.rotate`, `.disable`, `.copy`, `.copied`, `.onceWarning`, `.active`,
  `.rotateConfirm`, `.disableConfirm`;
- `flatmates.list.empty`, `.joinedAt`, `.remove`, `.removeConfirm`;
- `flatmates.join.title`, `.invitedBy`, `.cta`, `.member`, `.toChats`, `.done`, `.invalid`, `.own`,
  `.applied`, `.full`, `.rateLimited`;
- `flatmates.mine.title`, `.empty`, `.leave`, `.leaveConfirm`;
- `chat.roles.owner`, `chat.roles.flatmate`, `chat.you`, `chat.joinedNote`, `chat.group`,
  `chat.flatmateChip`, `chat.myFlats`;
- `listings.mine.flatmates`.

## Acceptance criteria
- [ ] AC1 Given a room with `flatmate_invite_active: false`, When "יצירת קישור הזמנה" is clicked and the POST
  answers `{token: "T"}`, Then the input holds `http://localhost:5173/flatmates/join/T` (the test origin) with
  the once-only warning. "העתקה" calls `navigator.clipboard.writeText` with it (stubbed). After a remount with
  `flatmate_invite_active: true`, "יש קישור פעיל" shows "קישור חדש" and "ביטול הקישור". Each asks to
  confirm and then calls POST / DELETE. — `web/src/features/flatmates/__tests__/FlatmatesPage.test.tsx::ac1_invite_flow`
- [ ] AC2 Given `GET /listings/L/flatmates` with two flatmates, Then both show with their join dates. "הסרה" →
  confirm → `DELETE /listings/L/flatmates/{id}`, and the list refetches. An empty list shows
  `flatmates.list.empty`. — `FlatmatesPage.test.tsx::ac2_list_and_remove`
- [ ] AC3 `/flatmates/join/T`:
  - a preview renders the title, "הוזמנת על ידי רוני" and the CTA. The CTA POSTs the join and navigates to
    `/chat`;
  - `member: true` shows "כבר הצטרפת";
  - 404, 409 `own_listing`, `already_applied`, `flatmates_full` and 429 show their texts.

  A logged-out visit goes to `/login?next=%2Fflatmates%2Fjoin%2FT`. — `web/src/features/flatmates/__tests__/JoinFlatPage.test.tsx::ac3_states`
- [ ] AC4 Given a thread with `members` [owner רוני, flatmate דנה, seeker נועה], the caller being דנה, and
  `visible_from` set, Then the header lists "רוני (בעל/ת הדירה) · את/ה · נועה" (the caller shown as
  `chat.you`) and the joined note. Others' consecutive messages show the sender's name once per run. Given a
  one-to-one thread, no member line, no sender names and no note render: the DOM matches `0005b`'s
  assertions. — `web/src/features/chat/__tests__/ChatThreadPage.test.tsx::ac4_group_header_and_senders`
- [ ] AC5 Given `/me/conversations` with a flatmate item (`my_role: 'flatmate'`, `member_count` 3) and a
  one-to-one item, Then the first shows "שותף/ה" and "קבוצה · 3" and the second neither. "הדירות שלי"
  shows only when `GET /me/flats` is non-empty. — `web/src/features/chat/__tests__/ChatListPage.test.tsx::ac5_flatmate_items`
- [ ] AC6 `/me/flats` lists the flats. "יציאה מהדירה" → confirm → `DELETE /me/flats/{listing_id}` and a
  refetch. The empty state shows. — `web/src/features/flatmates/__tests__/MyFlatsPage.test.tsx::ac6_leave`
- [ ] AC7 `/me/listings`: every room card (live, paused, expired) has "שותפים בדירה (N)" linking to the
  flatmates page. Apartments have none. — `web/src/features/listings/__tests__/MyListingsPage.test.tsx::ac7_flatmates_link`
- [ ] AC8 E2E with three browser contexts:
  1. Owner `O` posts a room and creates the invite link on the flatmates page.
  2. User `F` signs up and opens the link, then joins.
  3. Seeker `S` applies through the API, and `O` shortlists in the inbox.
  4. `F` opens the chat: the header lists the three members and the joined note.
  5. `F` sends "היי, אני דנה".
  6. `S`'s thread shows the message with `F`'s name above it.
  7. `O` removes `F`: `F`'s chat list no longer has the conversation.

  — `web/e2e/flatmates.spec.ts::ac8_group_chat_flow`
- [ ] NF1 `make lint`, `make test`, `make i18n-check`, `make build-web` and local `make e2e` are green (Speed
  rule 7). The e2e result goes in the digest.

## Tests to write
Component tests: the cases above, with `vi.stubGlobal('fetch', ...)` as the existing tests do, and the
clipboard stubbed.
E2E: `web/e2e/flatmates.spec.ts`. `helpers.ts` gains `createInvite(page, listingId)` (API) for setup speed,
and the UI path is still exercised in step 1.

## Risks / open questions
- The token is shown once. An owner who loses it rotates. The copy says so (`flatmates.invite.onceWarning`).
- `MyListingsPage` gains a second link on room cards after `0008b`. This spec builds after `0008b`
  (`depends_on`), so there is no conflict.
- The thread's group rendering must leave one-to-one threads pixel-identical, and AC4 asserts it.
- The chat list's "הדירות שלי" adds one request (`/me/flats`) per visit to `/chat`. It is cheap, and it is cached
  by TanStack Query.

## Digest (filled by orchestrator after verification)
See `/digest`.
