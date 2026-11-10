---
id: 0005b
title: Owners and shortlisted seekers open their chats from the header, the owner inbox or "my applications", read a thread that updates the moment a message arrives, and send messages under a deposit warning
status: verified
depends_on: [0005a, 0005c, 0004b, 0004d]   # 0005a: the API; 0005c: the event stream; 0004b: RequireSeeker (copied), clearSession, MyApplicationsPage, the e2e signUp / postListing helpers and the `rl:*` clear; 0004d: ApplicantCard, the e2e inbox flow this spec extends
reviewers: [code, qa, ux, security]   # ux: two new screens with no artboard of their own and a changed header; security (scoped): another user's free text rendered (NF3), the clearSession paths, the event stream closed on logout
estimate: 1 coder run
---

## Goal
After this ships, a logged-in owner or seeker sees "צ'אט" in the header with a count of chats that have something
new, opens `/chat` (their chats: the other person's name, the listing, the last message, new / unread / closed
marks) and `/chat/:id` (the thread, updated within a second by `0005c`'s event stream, with the deposit-before-viewing
warning at the top and a composer while the chat is open); an owner reaches a shortlisted applicant's chat from
the inbox card's chat button (`design/screens-v1/Inbox.dc.html`), a seeker from the shortlisted card on "my
applications". Serves Dev Plan slice 5 (Chat), part b of three (split in `0005a` Goal). API: `0005a`, `0005c`. PRODUCT.md
"Chat — opens only on owner shortlist", "Trust (MVP) — deposit-before-viewing warning in chat".

## Scope
**In:**
- `web/src/features/chat/` (new feature folder):
  - `api.ts`: types `ConversationOut`, `ThreadOut`, `MessageOut` (generated schema); `fetchConversations()`,
    `fetchThread(id)`, `sendMessage(id, body)`, each throwing `ApiError` (from `features/listings/api.ts`) on a
    non-2xx, as `features/applications/api.ts` does.
  - `ChatStreamProvider.tsx` (new; wraps the header and `<Outlet />` in `Layout.tsx`): while `useMe()` holds a
    user, opens **one** `new EventSource(`${import.meta.env.VITE_API_URL}/me/events`, { withCredentials: true })`
    per tab (`0005c`). The effect is keyed on `me?.id`, so a `/me` refetch does not reopen it: it is open while
    `/me` holds a user and closed otherwise (`null`, removed by `clearSession`, error) and on unmount; the backoff
    timer is cleared on close and unmount. Handlers:
    `chat` (data `{conversation_id, kind}`) → `invalidateQueries` on `CONVERSATIONS_KEY` and on
    `['me', 'conversation', conversation_id]`; `resync` → on `CONVERSATIONS_KEY` and the `['me', 'conversation']`
    prefix; `open` → `connected = true`, and **only when this source or a previous one has had an `error`** the
    same full invalidation (it catches events missed while disconnected; nothing is replayed) and the backoff reset
    to 5 s — the first `open` of a page load refetches nothing; `error` → `connected = false`; when `readyState ===
    CLOSED` (the server refused: 401 / 429, which `EventSource` never retries) it calls `invalidateQueries({
    queryKey: ME_KEY, exact: true })` (`exact`: `['me']` prefix-matches every chat key; a 401 then surfaces through
    `/me` and the normal logout path) and reopens after a backoff of 5 s, doubling to at most 5 min, while a user is
    logged in. (An `error` while open leaves `CONNECTING`; the browser retries by itself after the server's 3 s.) Exposes `useChatStreamConnected(): boolean`.
  - `useConversations.ts`: `CONVERSATIONS_KEY = ['me', 'conversations']` (under `['me', …]`, so `clearSession`
    removes it), `refetchInterval: connected ? false : 60_000` (a fallback only while the stream is down),
    `useConversations(enabled = true)`.
  - `useThread.ts`: key `['me', 'conversation', id]`; `retry: false` (the stream or the fallback poll is the
    retry); `refetchInterval: q => isNotFound(q.state.error) || connected ? false : 15_000` (fallback while the
    stream is down; a 404 stops it; TanStack's default `refetchIntervalInBackground: false` stops it in a hidden
    tab). Its `queryFn`, after
    `fetchThread` resolves, writes `unread_count: 0, is_new: false` onto that id's item in `CONVERSATIONS_KEY`
    with `setQueryData` (the GET marked it read; no refetch, no effect), so the header count drops at once.
  - **401 on a query**: both `queryFn`s catch `ApiError` 401, call `clearSession(queryClient)` (`0004b`) and
    rethrow, so an expired session stops every refetch (the header falls back to the login links, `RequireUser`
    redirects to `/login`, and the provider closes the stream).
  - `useSendMessage.ts` (mutation): `onSuccess(msg)` → append `msg` to the thread cache with `setQueryData`
    **unless its id is already there**, then `invalidateQueries` on the thread key and on `CONVERSATIONS_KEY` (the
    default `cancelRefetch: true` restarts any refetch begun before the commit, so none lands without the message;
    cancelling instead would also drop a refetch the other person's event started); errors as in UI. On a **401** it calls `clearSession(queryClient)`; `RequireUser` then
    redirects to `/login`. Bubbles are keyed by `message.id`, so the live region announces only new ones.
  - `format.ts`: `formatMessageTime(iso: string, now = new Date()): string` — built from
    `Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', hour:
    '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(…)` (never the ICU-dependent joined string):
    `HH:mm` when its Israel day equals `todayInIsrael(now)` (`listings/format.ts`), otherwise `dd.MM HH:mm`.
  - `ChatListPage.tsx`, `ChatThreadPage.tsx`, `Composer.tsx`: see UI.
  - `ChatNavLink.tsx`: the header link (below); the only caller of `useConversations()` outside `/chat`.
    Rendered only in `AuthMenu`'s logged-in branch, so it unmounts on logout.
- `web/src/features/auth/RequireUser.tsx` (new, copy of `0004b`'s `RequireSeeker` without the role check):
  logged out → `/login`, `/me` pending → `Skeleton`, `/me` error → `ErrorState`; either role passes.
- `web/src/app/Layout.tsx`: `<ChatStreamProvider>` around the header and `<main>`.
- `web/src/app/routes.tsx`: `<Route element={<RequireUser />}>` with `chat` → `ChatListPage` and `chat/:id` →
  `ChatThreadPage`.
- `web/src/features/auth/AuthMenu.tsx`: the logged-in branch renders `<ChatNavLink />` before the role link, and
  its inner `div` gains `flex-wrap` (four controls at 390 px, NF2). `ChatNavLink`: a link `header.chat` →
  `/chat`, styled as `header.myListings`; inside it, when `n > 0` (n = conversations with `unread_count > 0 ||
  is_new`), an amber pill (`bg-warn text-warn-text`, as `0004d`'s new badge) showing `n` (`aria-hidden`) plus a
  visually hidden `header.chatNew` (`{{count}}` = n), so the link's accessible name carries both. A pending or
  failed conversations query shows no pill (never blocks the header).
- `web/src/features/applicants/ApplicantCard.tsx` (`0004d`): a `shortlisted` card gets, after its two buttons, a
  44 px icon link (chat-bubble SVG `aria-hidden`, as the artboard's button) to `/chat/{applicant.id}` with
  `aria-label` `chat.withName` (`{{name}}` = `applicant_name`). Other statuses: none.
- `web/src/features/applications/MyApplicationsPage.tsx` (`0004b`): a `shortlisted` card gets a link
  `applications.chat` → `/chat/{application.id}` (≥ 44 px, secondary button style, before the withdraw button).
- `web/src/locales/he.json`: the keys in UI.
- Tests: `web/src/features/chat/__tests__/ChatListPage.test.tsx`, `ChatThreadPage.test.tsx`, `format.test.ts`,
  `fixtures.ts` (`conversation(overrides)` → `ConversationOut`, `thread(overrides)` → `ThreadOut`,
  `message(overrides)` → `MessageOut`); `web/src/features/auth/__tests__/RequireUser.test.tsx`; additions to
  `AuthMenu.test.tsx` (every existing logged-in case adds `'GET /me/conversations': [json([])]`),
  `ApplicantsPage.test.tsx` and `MyApplicationsPage.test.tsx`; `web/src/features/chat/__tests__/
  ChatStreamProvider.test.tsx`. `web/src/test-setup.ts`: `Element.prototype.scrollIntoView = () => {}` and a
  `FakeEventSource` stubbed as the global `EventSource` (jsdom has neither): static `CONNECTING` / `OPEN` / `CLOSED`,
  `addEventListener` for named events, a static `instances` list (for "exactly one non-closed"), the URL and
  `withCredentials`; test controls `emit(type, data)`, `open()`, `fail(closed)` (sets `readyState` 2 or 0, then
  dispatches `error`); `close()` sets `readyState` 2.
- E2E: **no new file and no new signup** (the suite already spends 9 of the 10 OTP requests per IP per 15 min
  once `0004b` / `0004d` land, and the `rl:*` clear runs once before it): extend `0004d`'s
  `web/e2e/inbox.spec.ts::ac8_owner_shortlists_and_declines`, renamed `ac12_shortlist_chat_decline`, with the
  chat steps between its shortlist and its decline.

**Out:**
- Push / email notifications (`0005a` Q3), loading messages older than the newest
  200 (`0005a` shortcut; the thread says so).
- Report / block (Slice 10), attachments, message edit / delete, typing and read indicators.
- A chat artboard: none exists; the screens reuse the Inbox artboards' tokens, card and pill anatomy and the
  "צ'אט" nav label. A designed chat screen can come with Slice 9's polish.
- Desktop two-pane layout (list + thread side by side): one 640 px column, as the rest of the app.
- Mirroring the API's text rules on the client: a 422 shows `chat.errors.invalid`.

**New dependencies:** none.

## Data
None (web only).

## API
Consumes `0005a`: `GET /me/conversations`, `GET /conversations/{id}`, `POST /conversations/{id}/messages`. No
change.

## UI
No chat artboard (see Out). Reference: `design/screens-v1/Inbox.dc.html` / `InboxDesktop.dc.html` for tokens,
avatar, pill and card anatomy, and the chat button on the applicant card. Single column `max-w-[640px]`, `px-4`,
logical properties only.

**Header**: logged in → `header.chat` (+ the pill) before `header.myListings` / `header.myApplications`; the
`Layout` row and `AuthMenu`'s inner row both wrap on a narrow screen. Visitor → unchanged.

Loading blocks below are `<div aria-busy="true">` with the `Skeleton`(s) (which are `aria-hidden`) and a visually
hidden `common.loading`.

**`/chat` (`ChatListPage`)**, behind `RequireUser`:
- `<h1>` `chat.list.title`.
- loading (`data === undefined`): three `Skeleton` rows in a `<ul aria-busy>`.
- error (`data === undefined`): `ErrorState` with retry; a failed background refetch keeps the list.
- empty: `EmptyState` `chat.list.emptyOwner` or `chat.list.emptySeeker` by `me.role`.
- success: a `<ul>` in API order; each `<li>` is one `<Link to="/chat/{id}">` (≥ 44 px, card style) holding: an
  initial avatar (`Array.from(other_name)[0]`, `aria-hidden`), `other_name` (bold), the listing's
  `listings.card.title` (`rooms: formatRooms(…)`, `street`, `city`, as `0004b`; muted), the last message on one
  line (`truncate`, `dir="auto"`, prefixed by `chat.list.you` when `mine`) and its `formatMessageTime`, or
  `chat.list.noMessages` and no time when `last_message` is null; and at most one mark: the
  unread count pill (number `aria-hidden` + visually hidden `chat.list.unread`) when `unread_count > 0`, else the
  `chat.list.new` pill when `is_new`; plus a muted `chat.list.closed` tag when `!can_send`.

**`/chat/:id` (`ChatThreadPage`)**, behind `RequireUser`:
- A link `chat.thread.back` → `/chat` above the heading (≥ 44 px, as `BackToMine` in `ListingWizard.tsx`).
- not found (checked **first**: the query's `error` is an `ApiError` 404, even with cached `data`, e.g. a send's
  404 then a 404 refetch): `<h1>` `chat.thread.notFound` and the back link; the fallback poll stops.
- loading (`data === undefined`): one `Skeleton` (see the loading rule above).
- error (`data === undefined`, not 404): `ErrorState` with retry. A failed refetch keeps the thread on screen.
- found: `<h1>` `other_name`; a line with `listings.card.title` · `formatIls(price_ils)` `listings.units.ils`
  and a link — seeker: `chat.thread.toListing` → `/listings/{listing.id}`; owner: `chat.thread.toApplicants` →
  `/me/listings/{listing.id}/applicants`; then, always, the warning `chat.thread.warning` (`role="note"`, amber
  `bg-warn text-warn-text`, rounded card); `chat.thread.truncated` (muted) when `truncated`; then:
  - empty (no messages): `chat.thread.empty` (muted);
  - messages: a `<div role="log" aria-label={t('chat.thread.log')}>` (polite live region, so pushed messages are
    announced; `role="log"` is not allowed on `<ol>`) wrapping an `<ol>`, oldest first; each `<li key={id}>` a
    bubble: mine at the inline end (`self-end`, `bg-accent text-white`), theirs at the inline start
    (`self-start`, white with the line border); a visually hidden prefix `chat.thread.mine` or
    `chat.thread.theirs` (`{{name}}`), the body as **plain text** (`whitespace-pre-wrap break-words`,
    `dir="auto"`, never linkified, never HTML), and `<time dateTime={created_at}>` with `formatMessageTime`.
  - Scrolling: on the first render of messages and after the caller's own send only, the last bubble is scrolled
    into view (`scrollIntoView`); a pushed message does not scroll the page.
  - `can_send` → `Composer`; `!can_send` → `chat.thread.closed` (`role="status"`) in its place.

**`Composer`**: a `<form>` with a visually hidden `<label>` `chat.composer.label`, a `<textarea dir="auto"
maxLength={2000} rows={2}>` (full width), `chat.composer.remaining` (`{{count}}`) when fewer than 200 characters
are left, a chip button `chat.composer.viewing` (`0005a` Q5) that puts `chat.composer.viewingTemplate` into an
empty textarea or appends it on a new line, then focuses the textarea; and the submit button
`chat.composer.send` (primary, ≥ 44 px). Enter inserts a newline; only the button sends.
- disabled while the trimmed text is empty or a send is pending (`aria-busy`, text `chat.composer.sending`); a
  same-tick guard (ref) against a double click.
- success: the textarea clears and focus returns to it (a ref; the click moved focus to the button); the bubble
  appears (from the mutation, before the stream's refetch lands).
- errors (the text is kept every time; `role="alert"` line above the textarea): 409 `chat_closed` → the thread is
  refetched (the closed note replaces the composer); 404 → refetched (not found); 422 → `chat.errors.invalid`;
  429 → `chat.errors.rateLimited`; 401 → `clearSession`; network / 5xx / other → `common.error`.

**RTL**: bubbles align by `self-start` / `self-end` only (in RTL "mine" sits on the left, as Hebrew chat apps
do); the time follows the body in inline order; the chip and the send button sit in a `flex` row, send at the
inline end; avatar at the inline start of each list row. No physical properties.

**a11y**: every target ≥ 44 px; the thread's `<h1>` is the other person's name; bubbles have speaker prefixes;
errors `role="alert"`; the closed note `role="status"`; the icon link in the inbox has `aria-label` and
`aria-describedby` = the card's `<h2>` id.

**i18n keys** (`he.json`):
| key | text |
| --- | --- |
| `header.chat` | `צ'אט` |
| `header.chatNew` | `שיחות חדשות: {{count}}` |
| `chat.withName` | `צ'אט עם {{name}}` |
| `applications.chat` | `לצ'אט עם בעלי הדירה` |
| `chat.list.title` | `צ'אט` |
| `chat.list.emptyOwner` | `אין עדיין שיחות. שיחה נפתחת כשמוסיפים מועמד/ת לרשימה הקצרה.` |
| `chat.list.emptySeeker` | `אין עדיין שיחות. שיחה נפתחת כשבעלי הדירה מוסיפים אותך לרשימה הקצרה.` |
| `chat.list.you` | `את/ה: {{body}}` |
| `chat.list.noMessages` | `עוד אין הודעות` |
| `chat.list.new` | `חדש` |
| `chat.list.unread` | `הודעות שלא נקראו: {{count}}` |
| `chat.list.closed` | `סגורה` |
| `chat.thread.back` | `לכל השיחות` |
| `chat.thread.notFound` | `השיחה לא נמצאה` |
| `chat.thread.toListing` | `לעמוד הדירה` |
| `chat.thread.toApplicants` | `למועמדויות` |
| `chat.thread.warning` | `לעולם אל תעבירו כסף (פיקדון, דמי רצינות או מקדמה) לפני שראיתם את הדירה ונפגשתם.` |
| `chat.thread.truncated` | `מוצגות 200 ההודעות האחרונות` |
| `chat.thread.empty` | `עוד אין הודעות. אפשר להתחיל לכתוב.` |
| `chat.thread.log` | `הודעות` |
| `chat.thread.mine` | `את/ה:` |
| `chat.thread.theirs` | `{{name}}:` |
| `chat.thread.closed` | `השיחה סגורה. אי אפשר לשלוח בה הודעות חדשות.` |
| `chat.composer.label` | `הודעה` |
| `chat.composer.send` | `שליחה` |
| `chat.composer.sending` | `שולח…` |
| `chat.composer.viewing` | `הצעת סיור` |
| `chat.composer.viewingTemplate` | `אשמח לתאם סיור בדירה. מתי נוח לך?` |
| `chat.composer.remaining` | `נותרו {{count}} תווים` |
| `chat.errors.invalid` | `ההודעה מכילה תווים שאי אפשר לשלוח.` |
| `chat.errors.rateLimited` | `נשלחו הרבה הודעות בזמן קצר. אפשר לנסות שוב מאוחר יותר.` |
Copy is final-for-now; Slice 9 owns wording.

## Acceptance criteria
Unit tests use the project's fetch mock (`'METHOD /path': [responses]`, as `ApplicantsPage.test.tsx`) and the
`chat/__tests__/fixtures.ts` builders. Non-ASCII test inputs as `\uXXXX` escapes.
- [ ] AC1 Given an owner and, separately, a seeker logged in, Then the header has a link `header.chat` to `/chat`; Given conversations `[unread 2, is_new, read and not new]`, Then the link holds a pill "2" and its accessible name contains `header.chatNew` with count 2; Given `[]` or a 500 on `GET /me/conversations`, Then no pill and the rest of the header renders; Given a 401 on `GET /me/conversations`, Then the header shows the login links and no further `GET /me/conversations` is sent after 60 s; Given a visitor, Then no chat link and no `GET /me/conversations`; with fake timers and the stream **connected**, no second `GET /me/conversations` after 60 s; with it **not connected**, a second one after 60 s — `web/src/features/auth/__tests__/AuthMenu.test.tsx::ac1_chat_link_and_count`
- [ ] AC2 Given a visitor, When opening `/chat` and `/chat/X`, Then redirected to `/login`; Given an owner and a seeker, Then both pages render; `/me` pending → `Skeleton`; `/me` 500 → `ErrorState` — `web/src/features/auth/__tests__/RequireUser.test.tsx::ac2_require_user`
- [ ] AC3 Given `GET /me/conversations` pending, Then a busy list of three skeletons; 500 → `ErrorState` and retry refetches; `[]` → `chat.list.emptyOwner` for an owner and `chat.list.emptySeeker` for a seeker; Given four conversations (one with `last_message.mine`, one with `last_message: null` and `is_new`, one with `unread_count: 3`, one with `can_send: false`), Then four links in API order to `/chat/{id}`, each with the other name and listing title; the first preview starts with `chat.list.you`'s prefix and has `dir="auto"`; the second shows `chat.list.noMessages` and the `chat.list.new` pill; the third a "3" pill with `chat.list.unread`; the fourth the `chat.list.closed` tag — `web/src/features/chat/__tests__/ChatListPage.test.tsx::ac3_list_states`
- [ ] AC4 Given a seeker and a thread with messages theirs / mine / theirs, Then `<h1>` is `other_name`, a link `chat.thread.toListing` to `/listings/{listing.id}`, the `role="note"` warning, a `role="log"` list of three items oldest first with the `chat.thread.theirs` / `chat.thread.mine` prefixes and `self-start` / `self-end`; Given an owner, Then the link is `chat.thread.toApplicants` to `/me/listings/{listing.id}/applicants`; Given a body `"<b>x</b> https://example.com\nline2"`, Then that exact text is rendered, the log contains no `<a>` and no `<b>`, and the body element has `dir="auto"`; Given no messages, Then `chat.thread.empty` and the warning; Given `truncated: true`, Then `chat.thread.truncated` — `ChatThreadPage.test.tsx::ac4_thread_renders_plain_text`
- [ ] AC5 Given the thread loaded and `CONVERSATIONS_KEY` holding that id with `unread_count: 2, is_new: true`, Then that item becomes `unread_count: 0, is_new: false` without a new `GET /me/conversations` (and stays so after the caller sends a message); with the stream connected, When the provider receives `chat` `{conversation_id: id}`, Then one `GET /conversations/{id}` follows and its new message appears in the log, and no GET follows after 15 s of fake time; with the stream not connected, a second GET is sent after 15 s; a 500 on such a refetch keeps the three messages on screen and shows no `ErrorState` — `ChatThreadPage.test.tsx::ac5_refetch_on_event_and_marks_read`
- [ ] AC6 Given an open thread, Then send is disabled for an empty or whitespace-only textarea; When typing `"hi"` and clicking `chat.composer.send`, Then one `POST /conversations/{id}/messages` with `{"body":"hi"}`, the button disabled with `aria-busy` while pending, then the textarea empty and focused and the new bubble in the log; a double click sends one POST; Given a refetch (a `chat` event) that started while the POST was pending and would answer without the new message, Then it is restarted after the POST succeeds and the new bubble is in the log exactly once; When clicking `chat.composer.viewing` on an empty textarea, Then it holds `chat.composer.viewingTemplate`; on `"hi"`, Then `"hi\n" + template` — `ChatThreadPage.test.tsx::ac6_send_and_viewing_chip`
- [ ] AC7 Given an open thread and the text `"hi"`, When the POST answers 409 `chat_closed`, Then the thread is refetched and, the refetch returning `can_send: false`, the composer is replaced by `chat.thread.closed`; 429 → `chat.errors.rateLimited` (`role="alert"`) and the text kept; 422 → `chat.errors.invalid`; 500 → `common.error`; 401 → redirected to `/login`; Given the thread's own GET (or a later poll) answers 401, Then redirected to `/login`, no further GET is sent and the `EventSource` is closed — `ChatThreadPage.test.tsx::ac7_send_errors`
- [ ] AC8 Given `can_send: false`, Then the messages render, no textarea, and `chat.thread.closed` has `role="status"` — `ChatThreadPage.test.tsx::ac8_closed_thread`
- [ ] AC9 Given `GET /conversations/X` → 404, Then `<h1>` `chat.thread.notFound`, the back link to `/chat`, and exactly one GET was sent, also after 10 s of fake time; Given a loaded thread whose POST answers 404 and whose refetch answers 404, Then `chat.thread.notFound` replaces the thread — `ChatThreadPage.test.tsx::ac9_not_found`
- [ ] AC10 Given the owner inbox with a `shortlisted`, a `submitted` and a `declined` applicant, Then only the shortlisted card has a link named `chat.withName` (`{{name}}` its applicant name) to `/chat/{id}`; Given "my applications" with a `shortlisted` and a `submitted` one, Then only the shortlisted card has `applications.chat` to `/chat/{id}` — `ApplicantsPage.test.tsx::ac10_chat_button_on_shortlisted`, `MyApplicationsPage.test.tsx::ac10_chat_link_on_shortlisted`
- [ ] AC11 `formatMessageTime`: a time earlier today in Israel → `HH:mm`; yesterday → `dd.MM HH:mm`; `2026-11-10T22:30:00Z` with now `2026-11-11T08:00:00Z` → today (00:30 Israel time) — `web/src/features/chat/__tests__/format.test.ts::ac11_message_time`
- [ ] AC12 In `0004d`'s `web/e2e/inbox.spec.ts::ac8_owner_shortlists_and_declines`, renamed `ac12_shortlist_chat_decline` (its owner and seeker contexts, no new signup): after the owner shortlists, Then the applicant card has the link `chat.withName`; When the owner clicks it, Then the owner is on `/chat/{id}` with the `role="note"` warning; the owner sends "Hello"; When the seeker's page reloads, Then its header link carries the pill, `/chat` lists the owner's display name, and the thread shows "Hello"; the seeker replies "Hi" and the owner's open thread shows "Hi" within 3 s without a reload (the event stream, `0005c`); then the test's existing decline runs (`page.once('dialog', d => d.accept())`), and after a reload the seeker's thread shows `chat.thread.closed` and no textarea — `web/e2e/inbox.spec.ts::ac12_shortlist_chat_decline`
- [ ] AC13 Given a visitor, Then no `EventSource` is created; Given a logged-in user, Then exactly one non-closed instance, to `${VITE_API_URL}/me/events` with `withCredentials: true`, also across navigating `/` → `/chat` → `/chat/X` and across a `/me` refetch; its first `open` triggers no refetch; When it emits `chat` `{conversation_id: X, kind: "message"}`, Then `GET /me/conversations` and `GET /conversations/X` refetch (when mounted) and no other thread key does; `resync` → the list and every mounted thread refetch; `open` after an `error` → the same full refetch and `useChatStreamConnected()` true again; `fail(closed)` → `GET /me` refetches and, with fake timers, a new `EventSource` is created after 5 s, then 10 s, … capped at 5 min while still logged in; When the user logs out, Then the source is closed (`readyState` 2) and none is reopened — `web/src/features/chat/__tests__/ChatStreamProvider.test.tsx::ac13_one_stream_per_tab`
- [ ] NF1 `make lint`, `make test`, `make i18n-check`, `make build-web` clean — CI `web` job; `make e2e` — CI `e2e` job
- [ ] NF2 Layout: logical properties only, every target ≥ 44 px, RTL as above, 390 px width without horizontal scroll — ux reviewer; AC4 checks alignment classes
- [ ] NF3 Message text is never HTML: no `dangerouslySetInnerHTML` and no link detection in `features/chat/` — AC4 + code reviewer

## Tests to write
Unit (vitest + Testing Library + the fetch mock + `FakeEventSource`): AC1–AC11 and AC13 in the files named. E2E (Playwright, compose stack):
AC12 in `inbox.spec.ts` (extended). Existing `AuthMenu.test.tsx` cases gain the `GET /me/conversations` mock and render inside `ChatStreamProvider`;
nothing else changes.

## Risks / open questions
**Decisions:** Gilad 2026-11-11 (PRODUCT.md "Chat"): Q1 push over `0005c`'s event stream (polling only as the
fallback while the stream is down), Q2 (a) closed-but-readable, Q3 (a) no notifications, Q5 (a) the viewing chip.
No new product question.

**Assumptions (orchestrator, not Gilad calls):** "mine" bubbles at the inline end; Enter is a newline and only the
button sends (mobile-first); the header count is chats with something new, not messages; no client-side text
rules (a 422 names nothing); the owner's thread links to the inbox, the seeker's to the public listing (which
shows `listing.notFound` once the listing is paused or expired — FOLLOWUPS `0004a`).

**Technical risks the verifier should challenge:**
- **Refetch storms after an outage:** when Redis or an API process restarts, every tab reconnects and refetches
  its list (and open thread) at once. `EventSource`'s own 3 s retry plus `0005c`'s 0–60 s stream-end jitter spread
  normal reconnects; the provider's 5 s → 5 min backoff applies only to refused streams. Accepted.
- **Fallback polling:** while a tab's stream is down it polls the list every 60 s and an open thread every 15 s, so
  an outage degrades to slow polling, not to silence.
- **Event vs. send race:** the sender's own `message` event triggers a refetch that may start before the POST
  answers; `onSuccess` appends by id once and invalidates, which restarts that refetch after the commit (AC6).
- **Fake timers with TanStack intervals** (AC1, AC5, AC13): `vi.useFakeTimers({ shouldAdvanceTime: true })` and
  `advanceTimersByTimeAsync`.
- **`0004b` / `0004d` not merged yet:** this spec edits their `MyApplicationsPage` and `ApplicantCard`; it starts
  after both merge (`depends_on`), from `main`. It is the third web spec in a row on 5173.
- **E2E OTP budget:** 10 OTP requests per IP per 15 min, cleared once before the suite; the suite is at 9 once
  `0004b` / `0004d` land, so AC12 reuses `0004d`'s two signups. A later e2e needing a new user must first add a
  CI-only limit override (FOLLOWUPS `0001b` e2e entry).

## Verifier findings — one round, 11 findings, all applied
1. E2E OTP budget (10 per IP per 15 min; 9 used once 0004b/0004d land): no new file or signup — AC12 extends `0004d`'s `inbox.spec.ts` flow; the pill is asserted after a reload.
2. Only the mutation handled 401: both query functions now `clearSession` and rethrow on 401, so polling stops (AC1, AC7).
3. `AuthMenu` returns early for visitors: the header link is a new `ChatNavLink` in the logged-in branch (unmounts on logout); `AuthMenu`'s row gets `flex-wrap`.
4. `useThread`: `retry: false`, polling stops on 404, not-found is checked before `data` (AC9).
5. Mark-read moved from an effect into `queryFn` (no double fire from the send's `setQueryData` or StrictMode).
6. Send race: `onSuccess` cancels in-flight polls, appends by id once; bubbles keyed by id (AC6).
7. `role="log"` moved to a wrapping `div` with `chat.thread.log`; loading blocks carry a visually hidden `common.loading` (`Skeleton` is `aria-hidden`).
8. jsdom has no `scrollIntoView`: stub in `test-setup.ts`; scrolling only on first load and own send.
9. `formatMessageTime` from `formatToParts` + `todayInIsrael()`; no time on a row without messages.
10. Reviewers + security (scoped to NF3, the `clearSession` paths, `ChatNavLink` teardown).
11. Focus returns to the textarea via a ref; card title uses `formatRooms`; back link pattern is `BackToMine` in `ListingWizard.tsx`.
Split considered and not taken: two screens is at the limit, and both halves would be web specs on 5173 (no parallelism).

## Verifier findings — round on the stream rework (0005c contract), 4 findings, all applied
1. `cancelQueries` in `onSuccess` would also drop a refetch started by the other person's event: append by id, then invalidate (restarts it after the commit).
2. A full invalidation on every `open` doubled each page load: only after an `error`; the backoff resets then.
3. Provider effect keyed on `me?.id` (a `/me` refetch never reopens), `ME_KEY` invalidated with `exact: true`, the backoff timer cleared on close and unmount.
4. `FakeEventSource` spelled out (static states, named listeners, `instances`, `fail(closed)`).

## Digest (filled by orchestrator after verification)

    Spec 0005b - Chat web: header badge, /chat list, /chat/:id thread   (verified, part 3 of 3, depends on 0005a, 0005c, 0004b, 0004d)
    What a user can do after this: an owner or a shortlisted seeker sees "צ'אט" with a count of chats that have
             something new, opens their chats and a thread that updates the moment a message arrives, and writes
             under a fixed "never pay a deposit before viewing" warning; entry points from the inbox card and
             "my applications".
    Decisions: answered (Gilad 2026-11-11): push via 0005c, Q2-Q3-Q5 (a). Nothing new.
    KPIs this slice moves: shortlist -> first message rate; time from shortlist to first reply.
    Acceptance targets: NF1 lint, test, i18n-check, build, e2e clean - NF2 logical properties, 44 px targets, no
             horizontal scroll at 390 px - NF3 message text never rendered as HTML or linkified.
    Risks: the e2e OTP budget (10 per IP per 15 min, 9 already used) - mitigation: the chat steps extend 0004d's inbox
             e2e, no new signup. Reconnect storms after an outage - mitigation: browser retry + server jitter,
             slow fallback polling while a stream is down.
    Reviewers: code, qa, ux, security (scoped)   Estimated: 1 coder run, 1 review round
    Links: specs/0005b-chat-web.md - PRODUCT.md "Chat", "Trust (MVP)" - design/screens-v1/Inbox.dc.html (no chat artboard)
