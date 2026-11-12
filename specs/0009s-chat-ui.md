---
id: 0009s
title: Chat looks like the artboards' cards on a phone and opens as two panes on a desktop — the conversation list beside the open thread — with the same routes, the same event stream and message text still rendered as plain text
status: in-progress
depends_on: [0009h]   # 0009h (which depends on 0009d): the kit (Button, Card, Badge, Tag, Textarea, PageContainer, PageHeader), the tokens, the page roots and the pageWidths table this spec edits. Branch from 0009h's PR once it is open
reviewers: [code, qa, ux, security]   # security: chat rendering is restyled (message bodies and previews must stay text nodes, FOLLOWUPS 95); ux: no artboard, judged against Inbox / InboxDesktop; qa: routes, SSE refetches, the removed / closed / not-found states at both widths; no perf: no new request
estimate: 1 coder run (upper end)   # coder Opus/high: a route-structure change around the SSE-driven chat, at two widths, plus ClampedText and 15 states x 2 screenshots; Sonnet would be enough for the styling alone. Verifier: if the run overflows, the coder stops and reports; it never trims an AC
---

## Goal
After this ships, the chat is built from the `0009d` kit and its tokens.
- **On a phone** (`< 1024 px`): the list `/chat` and the thread `/chat/:id` stay two screens, as today, with
  Inbox-style rows and bubbles.
- **On a desktop** (`≥ 1024 px`):
  - `/chat/:id` shows the conversation list beside the thread, with the open one highlighted;
  - `/chat` shows the list beside a "pick a chat" panel;
  - switching chats keeps the list in place.

The routes, the guards, `ChatStreamProvider`, every query key, every event-, focus- and send-driven refetch, and
the text-only rendering of message bodies are unchanged (the two desktop request differences are listed in API).
The group member line gets a "show all" control (FOLLOWUPS 193).

This is Slice 9b (Gilad, 2026-11-12). No artboard covers chat, and Gilad decided there will be no new ones. The
nearest artboards:
- `Inbox.dc.html` gives the mobile row anatomy: the 48 px initial avatar, the 17 px / 800 name with status pills,
  muted sub-lines and the 20 px card.
- `InboxDesktop.dc.html` gives the desktop two-pane: a card column beside a 380 px-class panel, the selected card
  with a 1.5 px accent border (the brand drops the shadow), and the page header.
- The bubbles use the artboards' accent and the white card on `bg`.

## Scope
**In:**

### 0. Rules for every in-scope file
In-scope files:
- `app/routes.tsx` (the chat routes only);
- `features/chat/ChatLayout.tsx` and `features/chat/ConversationsPane.tsx` (both new);
- `features/chat/ChatListPage.tsx`, `ChatThreadPage.tsx`, `Composer.tsx`;
- `features/chat/__tests__/harness.tsx`;
- `components/ClampedText.tsx` (new, §5a) and its test;
- `components/PageHeader.tsx`: only `title`'s type, `string` → `ReactNode` (§5), with one new case in
  `components/__tests__/PageHeader.test.tsx`.

The desktop switch is `0009d`'s `useIsDesktop()` from `web/src/components/useMediaQuery.ts` (§1). No new hook
file.

Rules:
- **Brand** (`specs/0009-brand-amendment.md`, `design/brand/`, Gilad 2026-11-12) wins over the artboards for
  colour, type, shape and voice. The artboards still give layout and anatomy. In this spec:
  - **Colours** use the brand names only:
    - `surface` (page and cards), `surface-subtle` (quiet areas);
    - `ink`, `ink-muted`, `on-ink`;
    - `accent`, `accent-strong`, `accent-soft`;
    - `border`, `border-strong`;
    - `success`, `warning`, `danger`.
  - **Accent text** sits only on `surface` (`text-accent`). On `accent-soft` it is `text-accent-strong`.
  - **Type:** `font-display` (Fredoka) only for an `h1` / `h2` of 24 px or more (`text-h1`, `text-h2`). Everything
    else is Rubik in `text-h3` / `text-body` / `text-body-sm` / `text-label` / `text-caption`.
  - **Shape:**
    - cards are `rounded-lg` with a `border` and **no shadow**; `Card variant="selected"` is a `border-accent`
      outline with no shadow;
    - buttons and inputs are `rounded-md`;
    - chips and badges are `rounded-full`.
  - **Buttons:** `Button variant="primary"` is `ink` with `on-ink`. At most one accent-filled element per screen,
    so no `solid` badge repeats down a list.
  - **Status colours** always come with words or an icon. Icons are outline, 1.5–2 px stroke, round caps, `ink` /
    `ink-muted`.
  - **Empty states** use the kit's `Mascot` through `EmptyState pose`:
    - one mascot per screen, at least 96 px, never on `accent`, never flipped;
    - `sleep` for no messages, no likes and no applications;
    - `celebrate` after joining a flat.
  - **New copy:** no slash forms and never one gender. Buttons are 1–3 words starting with the action noun.
  - The kit's variant names (`Button`, `Card`, `Tag`, `Badge`) are `0009d`'s; their colours come from the amended
    kit.
- **Kit only.**
  - Buttons and button-looking links are `Button`.
  - Rows, the placeholder and the composer box are `Card`.
  - Counts and "new" are `Badge`; static chips are `Tag`.
  - The textarea is the kit `Textarea`.
  - The thread `<h1>` is `PageHeader`.
  - Inline notices (the money warning, system lines) are token classes on a `<p>`: the kit has no notice
    component.
- **Tokens only.** No hex. An arbitrary `[…]` value is allowed only in the exceptions table at the end of this
  section.
- **Behaviour is unchanged, and so is what other specs added.** Every `role`, `aria-*`, `data-testid`, `dir`,
  `ref`, focus effect, live region, query, mutation and guard on the base branch stays:
  - `role="log"`, `role="note"`, `role="status"`, `role="group"`;
  - `data-testid="message-body"` / `last-message` / `sender-name`;
  - the `UUID` check and the lowercase `Navigate`;
  - `useThread` / `useConversations` / `useSendMessage` / `refreshChat`, untouched;
  - the scroll-to-last effect;
  - the `Removed` focus;
  - the composer's `inFlight`, `readOnly` while sending, and Enter-is-newline.
  
  That includes what `0009c` adds (`components/Loading`, `usePageTitle`, `ErrorState page`, `RouteFocus`),
  what `0009t` adds (the always-mounted log and joined status, focus on the closed note when the chat closes)
  and what `0009g` adds (composer drafts, the closed chat's unsent block, the drafts cleared on `Removed` /
  not found), whichever lands first. If one lands after this spec, it rebases onto this layout. (Same-name
  sender runs need `MessageOut.sender_key`, an API field; they are in no spec, FOLLOWUPS 194.)
- **Message text stays text** (FOLLOWUPS 95, security):
  - `message.body`, `last.body`, `sender_name`, `other_name` and member names render as React text children
    only;
  - no `dangerouslySetInnerHTML`, no linkifying, no markdown;
  - every one of them keeps `dir="auto"`.

| Exception | Where | Why no token |
| --- | --- | --- |
| `max-w-[85%]` | a bubble's `li` (today's) | a percentage of the thread width; no token |
| `max-h-[calc(100dvh-3rem)]` | the sticky list pane (desktop branch only, so no `lg:` prefix) | a viewport-relative height (top and bottom 1.5 rem) |
| `[overflow-wrap:anywhere]` | the thread title's `<span dir="auto">` inside `PageHeader`'s `<h1>` (PageHeader takes no `<h1>` class) and the member line (today's) | no Tailwind utility; `break-words` does not shrink a flex item |

### 1. Desktop or phone: `useIsDesktop()` from `web/src/components/useMediaQuery.ts` (`0009d`)
`0009d` §2 ships `useMediaQuery` and `useIsDesktop()` (`(min-width: 1024px)`, `false` without
`window.matchMedia`) with its test (`useMediaQuery.test.tsx::ac3_media_query`), and says `0009l`'s planned
`app/useIsDesktop.ts` is not needed. Import it; add no hook. `1024` is Tailwind's `lg`, the kit's desktop switch.

Why JS and not CSS: a CSS-only switch would keep the hidden list in the DOM on a phone's thread. jsdom ignores
CSS, so every existing thread test and e2e strict selector would see duplicate links, and the a11y tree would
depend on the stylesheet. With the hook, the phone's DOM is today's.

### 2. Routes (`app/routes.tsx`) — URLs unchanged
Inside the existing `<Route element={<RequireUser />}>`:
```
<Route path="chat" element={<ChatLayout />}>
  <Route index element={<ChatListPage />} />
  <Route path=":id" element={<ChatThreadPage />} />
</Route>
```
`/chat` and `/chat/:id` resolve as before, and `me/flats` is untouched. `features/chat/__tests__/harness.tsx`'s
`chatRoutes` mirrors this nesting, so the page tests render the real layout.

### 3. `ChatLayout.tsx` (new)
**Hooks rule.** `ChatLayout` calls only `useIsDesktop()` and returns `isDesktop ? <DesktopChatLayout /> : <PhoneChatLayout />`.
Both are local components of `ChatLayout.tsx`, so every other hook below lives in `DesktopChatLayout` and is never
called conditionally (a resize across 1024 px swaps the component, never the hook order; AC1).

**Phone** (`PhoneChatLayout`): `<PageContainer width="default"><Outlet /></PageContainer>`. This renders today's
two screens.

**Desktop** (`DesktopChatLayout`):
- `const match = useMatch('/chat/:id')` and `activeId = match?.params.id?.toLowerCase()`.
- `const paneHeadingId = useId()`.
- `const conversations = useConversations()`: the same cached query the header's count already holds, so no new
  list request. (The pane's `useMyFlats()` does add one `GET /me/flats` on a desktop `/chat/:id` entered
  directly, the request the phone's `/chat` already sends; see API.)
- `twoPane = match !== null || (conversations.data?.length ?? 0) > 0`.
- The tree is the same in both cases, so `ConversationsPane` is never remounted when `twoPane` changes or when
  the chat changes. Its state (the joined line) survives, and so does the list's scroll:
```
<PageContainer width="wide">
  <div className={twoPane ? 'flex items-start gap-6' : 'flex justify-center'}>
    <section aria-labelledby={paneHeadingId}
             className={twoPane
               ? 'w-96 flex-none sticky top-6 max-h-[calc(100dvh-3rem)] overflow-y-auto p-1'
               : 'w-full max-w-page'}>
      <ConversationsPane headingId={paneHeadingId} headingLevel={match ? 2 : 1} activeId={activeId} />
    </section>
    {twoPane && (
      <div className="min-w-0 flex-1">{match ? <Outlet /> : <PickOne />}</div>
    )}
  </div>
</PageContainer>
```
Notes on the tree:
- The classes are written without the `lg:` prefix because this branch renders only at `≥ 1024 px`.
- `p-1` keeps the rows' focus rings inside the scroll box.
- On desktop `/chat`, the index route's `ChatListPage` is not rendered: the pane is the list. With no chats
  (loading, error, empty), the list sits alone in a 720 px column, and no "pick a chat" panel shows.

**`PickOne`** (local to `ChatLayout.tsx`): `Card variant="muted" padding="lg"` with `flex min-h-96 flex-col
items-center justify-center gap-3 text-center`. It holds:
- an `aria-hidden` 40 px chat-bubble icon (`M21 12a8 8 0 0 1-11.6 7.2L4 21l1.8-5A8 8 0 1 1 21 12z`,
  `stroke="currentColor"`, `text-ink-muted`);
- the new key `chat.pickOne` in `text-body text-ink-muted`.

**No chat opens by itself.** `/chat` never opens the newest chat on its own, because the thread GET marks it read
(`0005a`).

**The thread is the main content.** At `/chat/:id` the thread's name is the page's only `<h1>`, and the list
heading is an `<h2>`. At `/chat` the list heading is the `<h1>` (one `<h1>` per state, `0009c`).

### 4. `ConversationsPane.tsx` (new) and `ChatListPage.tsx`
`ConversationsPane({ headingId, headingLevel: 1 | 2, activeId?: string })` holds what `ChatListPage` renders
today, in the same order:
- the heading row;
- the joined status line;
- the body (loading, error, empty or list).

It moves over intact:
- `isJoined` and the `navigate(…, { replace: true, state: null })` effect;
- `useMe` (the empty text by role);
- `useMyFlats` (the "my flats" link).

Its root is `<div className="flex flex-col gap-4">` (today's `section` column; on a desktop it sits inside
`ChatLayout`'s labelled `section`).

`0009c`'s `usePageTitle` moves here as `usePageTitle(headingLevel === 1 ? t('chat.list.title') : undefined)`.
Hooks cannot be skipped, and `undefined` sets `app.title`; on a desktop `/chat/:id` the pane's effect runs before
the thread's (DOM order), so the thread's title wins. `ChatLayout.test.tsx::ac3` asserts `document.title` once
`0009c` is on the base.

`ChatListPage` becomes `const id = useId(); return <ConversationsPane headingId={id} headingLevel={1} />;`. It is
the phone's `/chat`.

**Heading row:** `flex flex-wrap items-center justify-between gap-x-4 gap-y-1`. It holds:
- `<h1>` or `<h2>` (by `headingLevel`), with `id={headingId}`, `font-display text-h1 lg:text-h2` (the phone page's
  `<h1>` size, and one size in the desktop pane at both levels, so nothing jumps between `/chat` and `/chat/:id`) and `chat.list.title`. It is not `PageHeader`: its level changes with the route, which
  `PageHeader` cannot do.
- When `flats.data.length > 0`: `Button variant="ghost" size="sm" to="/me/flats"` with `chat.myFlats`.

**Joined line:** `<p role="status">` in `text-body-sm font-medium text-success`. While `joined` is true, the
kit's `Mascot pose="celebrate"` (96 px) sits beside it in a `flex items-center gap-4` row, and the empty state
below then passes no `pose` (one mascot per screen) (always mounted, if `0009c`
made it so).

**Rows:** `ul` `flex flex-col gap-2`. Each row is a `Card as="li" padding="none"`, with `variant="selected"` when
`conversation.id === activeId` and `default` otherwise. Inside it is a `NavLink to={`/chat/${id}`}` that fills
the card. `NavLink` sets `aria-current="page"` on the open chat.

The link is `flex min-h-tap items-start gap-3 rounded-lg p-3.5` plus `focusRing`. The whole row stays one
link, so its accessible name is unchanged. Its content, in order:
1. The `aria-hidden` avatar: `flex h-12 w-12 flex-none items-center justify-center rounded-full bg-accent-soft
   text-h3 font-semibold text-accent-strong`, holding the first character of `other_name`.
2. A `flex min-w-0 flex-1 flex-col gap-1` column:
   - **name line:** `flex min-w-0 items-center gap-2`:
     - the name `<span dir="auto" className="min-w-0 flex-1 truncate text-h3 font-medium">`;
     - then the unread mark at the inline end: `Badge tone="accent" srLabel={t('chat.list.unread', { count })}`
       with the number (not `solid`: the brand allows one accent-filled element per screen, and a list repeats it), or
       `Badge tone="new"` with `chat.list.new` when `is_new`. Today's sr-only sentence becomes `srLabel`, so the
       mark's accessible text stays the same.
   - **chips line** (only if any chip): `flex flex-wrap gap-1`, holding `Tag size="sm"`s in today's order:
     - `tone="accent"` `chat.flatmateChip` (when `my_role === 'flatmate'`);
     - `tone="neutral"` `chat.group` (when `member_count > 2`);
     - `tone="neutral"` `chat.list.closed` (when `!can_send`).

     The chips sit on their own line, so a 384 px pane never squeezes the name to nothing.
   - **listing line:** `truncate text-caption text-ink-muted`, the title as the base renders it.
   - **last message line:** `flex min-w-0 items-baseline gap-2`:
     - `<span data-testid="last-message" dir="auto" className="min-w-0 flex-1 truncate text-body">`, text only;
     - `<time className="flex-none text-caption text-ink-muted">`;
     - or `chat.list.noMessages` in `text-body text-ink-muted`.

**Loading:** the base's loading wrapper (and its list or `div`s, whichever `0009c` left) around three
`Skeleton className="h-20 w-full rounded-lg"`, one per row (a row's height). Exactly one `Skeleton` per row
keeps `ChatListPage.test.tsx:59`'s count of three `data-testid="skeleton"` (`0009h`: one test id per `Skeleton`);
a row-shaped skeleton of three bars would make it nine.

**Error:** `ErrorState`.

**Empty:** `EmptyState pose="sleep"` with today's role-based message (no `pose` while the joined line shows). `0009f` may add the flatmate text (FOLLOWUPS 195);
`EmptyState`'s `action` slot stays free.

### 5. `ChatThreadPage.tsx`
The page renders no `PageContainer`: `ChatLayout` does. The outer `section` stays `flex flex-col gap-4`. The
thread, removed and not-found branches start with a `PageHeader` that has `back={{ to: '/chat', label:
t('chat.thread.back') }}`. The loading and error branches start with `BackLink` alone (`PageHeader.tsx`'s export,
same `to` / `label`), because they have no `<h1>` of their own (`0009c`: loading shows `Loading`; error is
`ErrorState page`). This replaces `BackToChats`, and the link stays visible at every width: the e2e clicks it at
1280 px.

**Branch titles:**
- **thread:** `title={<span dir="auto" className="[overflow-wrap:anywhere]">{thread.other_name}</span>}`.
  `0009d` types `PageHeader`'s `title` as `string`; this spec widens it to `ReactNode` (one line in
  `PageHeader.tsx`) and adds `PageHeader.test.tsx::title_accepts_a_node` (a `<span dir="auto">` title renders
  inside the one `<h1>`). `subtitle` stays `string`.
- **removed:** `title={t('chat.removed')}` with `titleRef`. Today's focus-on-mount moves to that ref. `PageHeader`
  gives `tabIndex={-1}` and `focus:outline-none`.
- **not found:** `title={t('chat.thread.notFound')}`.
- **loading / error:** `BackLink`, then `Loading` / `ErrorState` as on the base.

**Removed: the list is refreshed.** When `Removed` mounts, it calls `queryClient.invalidateQueries({ queryKey:
CONVERSATIONS_KEY, exact: true })` once, guarded by a `useRef` flag so `<StrictMode>`'s second effect run sends no
second request. Today the list refetched because `ChatListPage` remounted on the way back to `/chat`. In two
panes the list never remounts, and a removal publishes no event (FOLLOWUPS 177), so without this the removed chat
would stay listed. It is the only behaviour line this spec adds.

**The thread, in today's DOM order:**
1. **Member line** (groups only), FOLLOWUPS 193:
   - It is a 2-line clamp with a "show all" toggle, for touch users who cannot hover `title`.
   - It uses `web/src/components/ClampedText.tsx` (§5a) with `lines={2}`, `id` (from `useId()`), and
     `textProps` = `role="group"`, `aria-label={t('chat.members')}` and `className="text-caption text-ink-muted
     [overflow-wrap:anywhere]"`. The `title` attribute is removed.
   - Its text is the joined member string as today, so `flatmates.spec.ts`'s `toHaveText` on the `role="group"`
     element holds (the toggle sits outside that element).
2. **Listing line:** `<p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-ink-muted">`. It
   holds the title · price text, then `Button variant="ghost" size="sm" to=…` with `chat.thread.toApplicants` or
   `chat.thread.toListing` (same targets).
3. **Money warning:** the `<p role="note">` (text exactly `chat.thread.warning`), as an inline notice:
   - `flex items-start gap-2 rounded-lg border border-border bg-surface-subtle px-4 py-3 text-body leading-relaxed
     text-ink`;
   - an `aria-hidden` 18 px outline warning mark first (`M12 6v7` and a dot at 17.5, `stroke="currentColor"`,
     `strokeWidth={2}`, round caps) in `text-warning`: the status colour comes with the words.
4. **System lines** (joined note, truncated note): `self-center rounded-md bg-surface-subtle px-3 py-1 text-center
   text-caption text-ink-muted`, as messaging apps mark a date.
5. **The log:** `role="log"` and `aria-label` unchanged, holding `ol` `flex flex-col gap-2`. Each message is an
   `li`:
   - `flex max-w-[85%] flex-col gap-1 lg:max-w-xl`;
   - `self-end` for mine and `self-start` for theirs. Both classes are asserted by `ChatThreadPage.test.tsx:109-113`
     and kept.

   In each `li`:
   - **sender name** (when shown, by today's run rule): `<span data-testid="sender-name"
     dir="auto" className="text-caption font-semibold text-ink-muted">`;
   - **bubble:**
     - mine: `rounded-lg rounded-ee-sm bg-accent-soft px-3.5 py-2 text-ink` (not solid accent: one accent fill per
       screen, and a thread repeats it);
     - theirs: `rounded-lg rounded-es-sm border border-border bg-surface px-3.5 py-2`.
     
     The small corner is the tail at the bottom inline end (mine) or start (theirs). `rounded-es` / `-ee` are
     logical, so they flip in RTL.
   - **inside the bubble:** today's `Bubble` (the sr-only speaker, then `message-body` `text-body leading-relaxed
     whitespace-pre-wrap break-words`, text only), and a `time` in `text-caption`, with `text-ink-muted` on mine
     and `text-ink-muted` on theirs.
6. **Empty thread:** a `flex flex-col items-center gap-3 py-8` block with the kit's `Mascot pose="sleep"` (96 px)
   above `chat.thread.empty` in `text-body text-ink-muted` (the screen's one mascot: the desktop pane holds rows).
7. **Bottom:** the composer, or the closed note.
   - **closed note:** `<p role="status">` in a `Card variant="muted" padding="md"`, with `text-body text-ink-muted`.
     `0009g`'s unsent block follows it if present.

### 5a. `web/src/components/ClampedText.tsx` (new; no other spec defines it)
`0009g` moved FOLLOWUPS 193 out and dropped `ClampedText` (its Out); `0009l` lists it as Out too. So this spec
defines it, and `0009l` (applicant message, FOLLOWUPS 72) may reuse it later.
- Props: `lines: 2 | 3 | 4`; `id: string` (the text element's id); `textProps?: HTMLAttributes<HTMLParagraphElement>`
  (`role`, `aria-label`, `className`, …); `children: ReactNode` (plain text only).
- `const clamp = { 2: 'line-clamp-2', 3: 'line-clamp-3', 4: 'line-clamp-4' } as const` in `ClampedText.classes.ts`
  (literal class names, so Tailwind generates them; a `.ts` sibling, per `0009d` §2's `i18n-check` rule).
- Renders `<div className="flex flex-col items-start gap-1">` holding:
  - `<p {...textProps} id={id} className={cx(textProps?.className, !expanded && clamp[lines])}>{children}</p>`;
  - then, only when `overflowing || expanded`, `<Button variant="ghost" size="sm" aria-expanded={expanded}
    aria-controls={id} onClick={toggle}>` with `common.showMore` / `common.showLess`. Focus stays on the button.
- `overflowing`: measured in a `useLayoutEffect` on `[children, expanded]` while clamped, as
  `el.scrollHeight > el.clientHeight + 1`; re-measured by a `ResizeObserver` on the `<p>` when
  `typeof ResizeObserver !== 'undefined'` (jsdom has none). While expanded it is not re-measured.
- Test: `web/src/components/__tests__/ClampedText.test.tsx::clamps_and_toggles` (also required by `0009h`'s
  `coverage.test.ts`): with `scrollHeight` / `clientHeight` stubbed through `Object.defineProperty`, the button
  appears with `aria-expanded="false"` and `aria-controls` = the `<p>`'s id; a click removes `line-clamp-2` and
  shows "הצגת פחות"; with equal heights no button renders; `textProps` land on the `<p>`.

### 6. `Composer.tsx`
Behaviour unchanged. The parts:
- **The form:**
  - `flex flex-col gap-2`;
  - at `lg`: `lg:sticky lg:bottom-0 lg:z-10 lg:bg-surface lg:pb-4 lg:pt-2`, so on a desktop it stays at the bottom of
    the viewport while the thread scrolls (the desktop has no bottom bar, `0009a`);
  - below `lg` it stays in normal flow, as today (see Risks).
- **DOM order inside the form** (today's order, one wrapper added): the alert `<p role="alert">` (when shown), then
  the box `Card padding="sm" className="flex flex-col gap-2"` holding the sr-only label, the `Textarea`, the
  remaining counter (when shown) and the row.
- **The box:** `Card padding="sm"` (`flex flex-col gap-2`), as above.
- **The textarea:**
  - the sr-only `<label htmlFor>` (unchanged), then the kit `Textarea` with `rows={2}`;
  - the same props as today: `ref`, `id`, `dir="auto"`, `maxLength`, `value`, `readOnly`, `onChange`,
    `aria-describedby`.
- **The alert:** `text-body-sm font-semibold text-danger`, above the textarea.
- **The remaining counter:** `text-body-sm text-ink-muted`.
- **The row:** `flex items-center justify-between gap-2`:
  - `Button variant="tint" size="sm" shape="pill"` with `chat.composer.viewing`;
  - `Button variant="primary"` (`type="submit"`, `disabled` + `aria-busy` as today) with the send / sending
    label.

### 7. Page widths table (`0009h`)
In `web/src/app/__tests__/pageWidths.test.ts`:
- add `chat/ChatLayout.tsx` → `['default', 'wide']`. If the table holds one width per file, widen its value type
  to `Width | Width[]`;
- keep the keys `chat/ChatListPage.tsx` and `chat/ChatThreadPage.tsx` (`routes.tsx` still imports both, and
  `0009h` AC4 (b) compares the table's keys with those imports), with a new value `'inLayout'`: rendered inside
  `ChatLayout`'s `PageContainer`. For an `'inLayout'` file, check (a) is inverted: the file contains **no**
  `<PageContainer` (no double gutters);
- the "no `mx-auto` / `w-full` / `max-w-` in a `PageContainer` `className`" rule holds: §3 centres with `flex
  justify-center`, and its `max-w-page` sits on the inner `section`, not on `PageContainer`.

### 8. `web/src/locales/he.json` (new keys)
| Key | Hebrew |
| --- | --- |
| `chat.pickOne` | "בחרו שיחה מהרשימה כדי לקרוא ולכתוב" |
| `common.showMore` | "הצגת עוד" |
| `common.showLess` | "הצגת פחות" |

All three are new (`ClampedText`, §5a, is this spec's). None is count-dependent.

**Out:**
- Message search, day separators, read receipts, typing indicators, avatars beyond the initial, and opening a chat
  by itself on desktop `/chat`.
- A sticky composer on a phone (see Risks).
- Hiding the bottom bar in a thread: `0009a` already lists `/chat/:id` in its `FOCUSED_ROUTES`.
- The header's chat link and count (`0009a`).
- Copy of existing keys (`0009b` / `0009f`), focus and announcements (`0009c`), drafts and `sender_key`
  (`0009g`).
- `ConversationOut.status` for a withdrawn seeker (FOLLOWUPS 91 / 111, an API shape).
- The composer's cut-off template (FOLLOWUPS 108, behaviour).
- The flatmates and my-flats pages: `0009q`.

**New dependencies:** none.

## Data
None.

## API
None. The same `GET /me/conversations`, `GET /conversations/{id}`, `POST /conversations/{id}/messages`,
`GET /me/flats` and `GET /me/events`. On a desktop, the list and the open thread read the same cached queries the
phone screens do. A `chat` event still refetches the open thread, then the list, once each (`refreshChat`).

Two request-level differences on a desktop, both accepted:
- a desktop `/chat/:id` entered directly also sends the pane's `GET /me/flats` (the phone's `/chat` sends it today);
- moving between `/chat` and `/chat/:id` no longer refetches the list on mount, because the pane stays mounted.
  The event stream, the window-focus refetch (the header's observer) and §5's `Removed` invalidation keep it
  current. A flatmate join or leave publishes no event (FOLLOWUPS 177), so a desktop list's member count can lag
  until the next event or focus, as an open thread's member line does today.

## UI
| Width | `/chat` | `/chat/:id` |
| --- | --- | --- |
| < 1024 px | the list page (`PageContainer default`): heading row, joined line, rows | the thread page: back, `<h1>`, members, listing, warning, log, composer in flow |
| ≥ 1024 px, chats | `wide`: the 384 px sticky list pane with `<h1>`, then the "pick a chat" panel | `wide`: the list pane (`<h2>`, open row selected) beside the thread; the composer sticks to the viewport bottom |
| ≥ 1024 px, no chats yet / loading / error | the list alone in a 720 px column | (as with chats) |

States per pane:
- **List:** loading (row skeletons), error (`ErrorState`), empty (`EmptyState`), rows, the joined line.
- **Thread:**
  - loading, error, not found, removed;
  - open (with and without messages);
  - group (member line clamped, "הצגת עוד");
  - closed (note);
  - composer errors (422, 429, other);
  - remaining counter.

**RTL:**
- The list pane is at the inline start (right) and the thread at the end, which is DOM order.
- The bubble tails use logical corners.
- Mine aligns to the inline end (left in RTL), as today.
- All names and bodies are `dir="auto"`. A Latin name keeps its order (today's `[overflow-wrap:anywhere]`).

**Tab order on desktop:** the list rows come before the thread (DOM order equals visual order). The skip link and
route focus are `0009c`'s. `0009c`'s `RouteFocus` focuses `<main>` and scrolls to the top on every PUSH that
changes the pathname, so clicking a row moves focus to `<main>` (as every route change does); a keyboard user
tabs back into the list. This spec does not change `RouteFocus` (focus is `0009c` / `0009t`'s); see Risks.

## Acceptance criteria
In the tests, "desktop" means `window.matchMedia` is stubbed (`vi.stubGlobal`) to report `matches: true` for
`(min-width: 1024px)`, with `addEventListener` / `removeEventListener`. "Phone" means no stub (jsdom has none).
Hebrew strings use `\uXXXX` escapes or `he.json` lookups.

- [ ] AC1 Resize across 1024 px (the hooks rule of §3): on `/chat/X` with the stub at `matches: true`, a
  `change` event to `matches: false` swaps to the phone layout (no list pane, the thread's `<h1>` still shown,
  the URL unchanged) without a React error (a `console.error` spy stays uncalled); a `change` back to `true`
  shows the pane again. (`useIsDesktop` itself is `0009d`'s, tested by `useMediaQuery.test.tsx`.)

  — `web/src/features/chat/__tests__/ChatLayout.test.tsx::ac1_resize_swaps_layout`
- [ ] AC2 Phone DOM is today's:
  - at `/chat/X` the page has no conversation row link, and no `<h2>` named "צ'אט";
  - the `<h1>` is the thread's name;
  - at `/chat` the `<h1>` is "צ'אט" with the rows;
  - every existing `ChatThreadPage.test.tsx` and `ChatStreamProvider.test.tsx` case passes through the nested
    `chatRoutes`, and every `ChatListPage.test.tsx` case passes with its own routes (it renders `ChatListPage`
    alone, which is `ConversationsPane` at level 1). Assertions change only where a class changed
    (`min-h-[44px]` and the like) or the back link's element changed.

  — `web/src/features/chat/__tests__/ChatLayout.test.tsx::ac2_phone_unchanged`, plus the existing suites
- [ ] AC3 Desktop `/chat/X`, with two conversations X and Y:
  - the `<h2>` "צ'אט" and two row links are shown;
  - X's link has `aria-current="page"`, and its `li` carries the selected Card variant;
  - the `<h1>` is X's `other_name` and the `role="log"` is present;
  - there is exactly one `role="note"`, one `role="group"` (for a group) and no textbox outside the composer;
  - when `usePageTitle` (`0009c`) is on the base, `document.title` starts with X's `other_name`.

  Clicking Y's row:
  - navigates to `/chat/Y` and shows Y's thread;
  - leaves the pane's `section` as the same DOM node (a reference taken before the click is still connected);
  - moves `aria-current` to Y. — `ChatLayout.test.tsx::ac3_two_panes_switch_without_remount`
- [ ] AC4 Desktop `/chat`:
  - with two conversations: the `<h1>` "צ'אט", the rows, no `aria-current`, the text "בחרו שיחה מהרשימה כדי לקרוא
    ולכתוב", and no `GET /conversations/{id}`;
  - with zero conversations: the `EmptyState` alone, without the "pick a chat" text;
  - with `location.state.joined` while the list is still pending: "הצטרפת לדירה…" is shown, and still shown after
    the list resolves to two items and the layout becomes two panes.

  — `ChatLayout.test.tsx::ac4_list_page_and_pick_one`
- [ ] AC5 Same requests as today. The thread's first reply is a `deferred` resolved after the list has loaded (as
  `ChatThreadPage.test.tsx::ac5` does), so `useThread`'s "restart a list fetch still in flight" rule does not
  fire and the counts are deterministic; `GET /me/flats` is mocked:
  - on desktop `/chat/X`, the first render sends one `GET /me/conversations`, one `GET /conversations/X` and one
    `GET /me/flats`;
  - a `chat` event for X (through `FakeEventSource`) sends exactly one more of each;
  - a `resync` refetches the thread and the list once each;
  - switching to Y sends one `GET /conversations/Y` and no extra list request.

  — `ChatLayout.test.tsx::ac5_stream_refetches_unchanged`
- [ ] AC6 Removed refreshes the list. On desktop `/chat/X`, a send answering 404 and then the thread refetch
  answering 404 show the `<h1>` `chat.removed` (focused). One more `GET /me/conversations` follows. When it
  answers without X, X's row is gone. The same on the phone: the refetch happens, and the existing removed tests
  pass. — `ChatLayout.test.tsx::ac6_removed_refreshes_list`
- [ ] AC7 Text only (security), on both widths. Given a conversation whose `last_message.body`, `other_name` and a
  message `body` / `sender_name` are `<img src=x onerror="alert(1)"><b>b</b>`, Then:
  - the list row and the thread contain no `img` or `b` element;
  - `last-message`, `message-body` and `sender-name` have that exact `textContent`;
  - each has `dir="auto"`;
  - a static check (source read as `pageWidths.test.ts` reads it) finds no `dangerouslySetInnerHTML` in
    `web/src/features/chat/**/*.tsx` or `web/src/components/ClampedText.tsx`.

  — `ChatLayout.test.tsx::ac7_bodies_render_as_text`
- [ ] AC8 Rows:
  - an unread row shows an `accent` Badge (not `solid`) whose accessible text is "הודעות שלא נקראו: 2";
  - a new row shows "חדש";
  - a flatmate row has the accent `Tag` "שותף/ה";
  - a group of 4 has "קבוצה · 4";
  - a closed row has "סגורה";
  - the chips sit in their own line (a sibling after the name line, not inside it);
  - a row's link is still one link whose accessible name holds, in this order: the name, the mark's sentence,
    the chips, the listing title, the last message and the time. (Today the mark sits between the group and
    closed chips; moving it to the name line reorders the name, which no e2e or test depends on: they match a
    substring.)

  — `web/src/features/chat/__tests__/ChatListPage.test.tsx::ac8_row_anatomy`
- [ ] AC9 Thread look:
  - mine `li` is `self-end` with an `accent-soft` bubble; theirs is `self-start` with a bordered surface bubble;
  - the `role="note"` text equals `chat.thread.warning` exactly;
  - the back link "לכל השיחות" leads to `/chat`;
  - the toListing / toApplicants link keeps its target per role;
  - the composer is in a `Card`, its submit is a `Button` named "שליחה", and the form carries `lg:sticky`;
  - the closed note is `role="status"`;
  - the existing composer tests (viewing chip, remaining counter, 422 / 429 alerts, Enter-is-newline) pass.

  — `ChatThreadPage.test.tsx::ac9_thread_kit_layout`
- [ ] AC10 Member line (FOLLOWUPS 193), in a group of six members:
  - with `scrollHeight` stubbed above `clientHeight`, a "הצגת עוד" button with `aria-expanded="false"` and
    `aria-controls` the line follows the `role="group"` line;
  - a click shows "הצגת פחות" and removes the clamp;
  - the line has no `title`;
  - with equal heights, no button renders;
  - the line's text equals today's joined string.

  — `ChatThreadPage.test.tsx::ac10_member_line_show_all` and
  `web/src/components/__tests__/ClampedText.test.tsx::clamps_and_toggles`
- [ ] AC11 E2E, no new sign-up: `test.step`s in `web/e2e/flatmates.spec.ts::ac5_group_chat_flow`, right after
  step 4 (F has opened the group chat). They run on `flatmatePage`, which returns to its default viewport
  afterwards.
  - **At 1440×900, on `/chat/{applicationId}`:**
    - the row link for SEEKER has `aria-current="page"`;
    - the `<h2>` "צ'אט" and the `role="log"` are visible;
    - the row's bounding box is to the right of the log's (`row.x > log.x + log.width - 1`);
    - the composer's bottom edge is within the viewport.
  - **Back to `/chat` (the back link):**
    - the `<h1>` is "צ'אט";
    - "בחרו שיחה מהרשימה כדי לקרוא ולכתוב" is visible;
    - `scrollWidth <= clientWidth`.
  - **At 390×844, `flatmatePage.goto(`/chat/${applicationId}`)`** (a reload, no sign-up):
    - no link named by SEEKER is present;
    - the `<h1>` is SEEKER;
    - `scrollWidth <= clientWidth`.
  - Then `setViewportSize({ width: 1280, height: 720 })` (Desktop Chrome's default, the project's), still on
    `/chat/{applicationId}`, so step 5 types into the composer as today.
  - Geometry uses `boundingBox()`; widths compare with `document.documentElement.clientWidth`, never a literal.
  - The rest of the test (step 7's removal, then `/chat` without the chat) runs at 1280×720, that is the desktop
    layout, and passes with §5's list refresh.

  — `web/e2e/flatmates.spec.ts::ac5_group_chat_flow`
- [ ] AC12 Visual check. Screenshots at 390×844 and 1440×900 of every state below, captured on the final local
  head. The ux reviewer compares them with `Inbox.dc.html` (rows, pills, buttons) and `InboxDesktop.dc.html`
  (two panes, the selected card, the header) for layout, and with `design/brand/README.md` for colour, type,
  shape and the mascot. The states:
  1. list loading;
  2. list error;
  3. list empty (owner);
  4. list with six rows (unread 3, new, flatmate role, group of 4, closed, no messages; one long Latin name) and
     the joined line;
  5. desktop `/chat` with "pick a chat";
  6. thread loading;
  7. thread not found;
  8. thread error;
  9. 1:1 thread with eight messages (mine and theirs, one of 6 lines, one Latin);
  10. group thread with six members (line clamped), sender names, joined and truncated notes;
  11. the same with the member line expanded;
  12. closed thread;
  13. removed;
  14. composer with the remaining counter and a 429 alert;
  15. thread with no messages.

  At 1440, every thread state shows the list pane with the open row selected.

  **Capture:**
  - Use the repo's screenshot harness when it is on the branch. `0009i`, `0009k`, `0009l`, `0009p` and `0009q`
    all name it the same way (`0009l`'s), so there is one form.
  - If none is there, add it exactly so:
    - `web/playwright.screens.config.ts`: `testDir: 'e2e/screens'`, `testMatch: '*.screens.ts'` (so `make e2e`
      never runs it), two projects, `mobile` 390×844 and `desktop` 1440×900, base URL `http://localhost:5173`;
    - a Makefile target `screens` (`cd web && pnpm exec playwright test -c playwright.screens.config.ts`) with a
      `##` help line;
    - `web/screens/` in `.gitignore`.
  - This spec's file is `web/e2e/screens/chat.screens.ts`, with fixtures in `web/e2e/screens/fixtures-chat.ts`.
  - Each conversation a thread state opens is also in that state's `/me/conversations` fixture, so the 1440 shot
    shows its row selected (not found and removed excepted).
  - `page.route` answers `/me` (owner and flatmate variants), `/me/conversations`, `/conversations/{id}`, the
    POST (a 429 for state 14) and `/me/flats`, and aborts `/me/events`. An unmatched API request fails the run.
  - Output: `web/screens/0009s/NN-<state>-<width>.png`.

  — `web/e2e/screens/chat.screens.ts`, the PNGs listed in the digest
- [ ] AC13 Kit and tokens:
  - `grep -nE '\[[0-9.]+px\]|#[0-9A-Fa-f]{3,8}\b'` over the in-scope files prints nothing beyond the exceptions
    table;
  - `0009h`'s `noColourLiterals` and `pageWidths` tests pass with §7's table;
  - no in-scope file defines a local button, card, badge, chip or textarea style;
  - no old token name is left in the in-scope files: `grep -nE 'accent-(tint|text)|\b(bg|text)-warn|border-line|bg-bg\b|surface-muted|ink-soft|shadow-|font-extrabold|Heebo'` prints nothing;

  The digest quotes the grep. — `pageWidths.test.ts` (table updated), the grep in the digest
- [ ] NF1 `make lint`, `make test`, `make i18n-check`, `make build-web` and local `make e2e` are green on the final
  head (Speed rule 7). Check that port 5173 is free first. The e2e result and the screenshot folder go in the
  digest.

## Tests to write
- **Unit:** `components/__tests__/ClampedText.test.tsx` (§5a) and the new `PageHeader.test.tsx` case (§5).
- **Component:**
  - `ChatLayout.test.tsx` (new, AC1–AC7), using `chatRoutes`, `ES`, `openStream` and `settle` from `harness.tsx`,
    and counting `fetch` calls per URL. "Desktop" stubs `window.matchMedia` per test and `afterEach` calls
    `vi.unstubAllGlobals()`, so the other suites stay on the phone path;
  - `ChatListPage.test.tsx` AC8 and `ChatThreadPage.test.tsx` AC9–AC10 (existing files).
- **E2E:** AC11, as steps in an existing test (0 new sign-ups).
- **Visual:** AC12.

## Risks / open questions
- **Kit additions** (each with a test, as `0009d` allows a screen spec to add):
  - `PageHeader`'s `title` widened from `string` to `ReactNode` (§5);
  - `ClampedText` (§5a), new, because no other spec defines it any more.
  - `useIsDesktop` is `0009d`'s (§1); nothing to add.
- **Same files as `0009c` / `0009t` / `0009g` / `0009f`.** `ChatListPage`, `ChatThreadPage` and `Composer` are
  touched by them:
  - `0009c`: `Loading`, `usePageTitle`, `ErrorState page`;
  - `0009t`: the always-mounted log and joined status, focus on the closed note;
  - `0009g`: drafts, the unsent block, drafts cleared on `Removed` / not found;
  - `0009f`: the flatmate empty text (FOLLOWUPS 195).

  Web specs never build together, so the second to merge rebases, and rule §0 keeps every behaviour line. One
  specific point: `0009c`'s `usePageTitle` call for the list moves into `ConversationsPane` (§4). FOLLOWUPS 193 is
  this spec's alone (`0009g` Out sends it to "0009q"; the orchestrator moved it here on 2026-11-12, and `0009q`
  does not take it).
- **Phone composer in flow.** `0009a` hides its bottom tab bar on `/chat/:id` below `lg` (`FOCUSED_ROUTES`), so
  nothing covers the composer or the last message on a phone thread. The phone keeps today's in-flow composer
  anyway; a sticky phone composer is a possible follow-up.
- **Sticky list pane.** `top-6` assumes the desktop header scrolls away, as the desktop artboards draw it. If
  `0009a` makes it sticky, `top-6` becomes its height (a one-class change).
- **`RouteFocus` (`0009c`) scrolls to the top on every push.**
  - In two panes, switching chats scrolls the page to the top, and then the new thread's own effect scrolls to its
    last message once its data arrives.
  - A cached thread renders in the same commit, so its child effect runs before `RouteFocus`'s, and the page ends
    at the top. That also happens on a phone today, after `0009c`.
  - It also moves focus to `<main>` on each row click, so a keyboard user re-enters the list from the top.
  - Flagged for `0009c` / `0009t` (a follow-up for the orchestrator): `RouteFocus` could skip both `scrollTo` and
    the `<main>` focus when only the `:id` under `/chat` changed and focus is inside the list pane. It is not
    changed here.
- **Resize across 1024 px** swaps the layout and remounts the pages (the list's scroll resets). That is rare. The
  composer's text survives only through `0009g`'s drafts, as on any remount; without them it is lost (accepted).
  AC1 proves the swap is hook-safe.
- **Product questions for Gilad:** none. Two panes on a desktop is a layout choice the brief left to this spec.
  Behaviour, copy and API are unchanged.
- **Verifier round 1:** 24 findings (20 applied in the text, 4 notes), all applied; second round waived. The brand
  amendment was then applied as a spec edit (orchestrator, 2026-11-12), without re-running the verifier.

## Verifier findings
Round 1 (the only round; 2026-11-12). Items 1–20 are applied in the
text above; 21–24 are notes.
1. **[major] Duplicate hook.** §1 added `app/useIsDesktop.ts`, but `0009d` §2 ships `useIsDesktop()` in
   `components/useMediaQuery.ts` and says that file is not needed. Applied: import it; AC1 became a resize test.
2. **[major] Hooks rule.** §3 called `useMatch` / `useConversations` only in the desktop branch of one component,
   which breaks `react-hooks/rules-of-hooks` and crashes on a resize. Applied: `PhoneChatLayout` /
   `DesktopChatLayout`; AC1 proves it.
3. **[major] `ClampedText` had no definition.** `0009g` §6 is `he.json`; `0009g` Out drops `ClampedText` and sends
   193 to "0009q"; `0009l` lists it as Out. Applied: §5a defines it; the keys and the test are unconditional
   (`0009h`'s `coverage.test.ts` requires the test).
4. **[major] `pageWidths` table.** Dropping the `ChatListPage` / `ChatThreadPage` keys fails `0009h` AC4 (b),
   because `routes.tsx` still imports them, and (a), because neither file has a `PageContainer` any more. Applied:
   an `'inLayout'` value with (a) inverted.
5. **[major] `Badge tone="count"` does not exist** (`0009d`: `new | accent | neutral | solid`). Applied: `solid`,
   which is the artboard's accent count (`Inbox.dc.html:52`).
6. **[major] Skeleton count.** Three bars per row gives nine `data-testid="skeleton"` and fails
   `ChatListPage.test.tsx:59`, against AC2's "assertions change only where a class changed". Applied: one
   row-height `Skeleton` per row.
7. **[major] Loading / error header.** "Every branch starts with a `PageHeader`" needs a title, so it would add an
   `<h1>` and break `0009c`'s one-`<h1>` rule. Applied: `BackLink` alone in those branches.
8. **[minor] `PageHeader` title type.** `0009d` types it `string`. Applied: the widening is definite and has a
   test. `[overflow-wrap:anywhere]` cannot reach `PageHeader`'s `<h1>`, so it goes on the title's span.
9. **[minor] AC5 counts.** `useThread` restarts a list fetch still in flight (the `race` case asserts two list
   GETs), so AC5 was order-dependent. Also, a desktop `/chat/:id` adds `GET /me/flats`, so "no request is
   added" was false. Applied: a deferred thread reply, the `/me/flats` mock, and the API section's wording.
10. **[minor] Focus claim.** "Clicking a row keeps focus on that row" contradicts `0009c`'s `RouteFocus`, which
    focuses `<main>` on every PUSH. Applied: UI and Risks now say what happens, with a follow-up suggestion for
    `0009c` / `0009t`.
11. **[minor] Undeclared change.** On a desktop the list no longer refetches when it would have mounted
    (staleTime 0). Applied: declared in Goal and API, and accepted.
12. **[minor] Accessible name.** AC8's "keeps today's accessible name" was false, because the mark moves ahead
    of the chips. Applied: AC8 states the new order.
13. **[minor] StrictMode.** The double effect would invalidate twice in dev. Applied: a ref guard.
14. **[minor] Stale cross-references.** The log, the joined status and the closed-note focus are `0009t`'s, not
    `0009c`'s. `sender_key` is not in `0009g` (FOLLOWUPS 194). `0009a` already hides the tab bar on
    `/chat/:id` and exposes `--bottom-nav-h`. Applied.
15. **[minor] AC11 e2e steps.** The spec did not say how the test reaches `/chat/:id` at 390, what "default
    viewport" means, or how to measure. Applied: `goto`, then `1280×720`, with measurements against
    `clientWidth`.
16. **[minor] AC12 harness fallback.** It pointed at a sibling draft. Applied: it is self-contained, using the
    one naming (`0009k` has also converged on `0009l`'s).
17. **[minor] AC2 setup.** AC2 said `ChatListPage.test.tsx` uses `chatRoutes`; it has its own routes. Applied.
18. **[minor] Missing structure.** The composer's DOM inside the `Card`, the `ConversationsPane` root, and
    `usePageTitle` without skipping a hook were not specified. Applied.
19. **[nit] Exceptions table.** It used `lg:max-h-…`, while the tree has no prefix. Applied.
20. **[nit] AC7 static check.** It now covers `ClampedText.tsx` too.
21. **[note] Existing e2e at 1280 px with two panes.** None of the existing selectors breaks:
    - `inbox.spec.ts`: `role=note` (one), the `status` filtered by closed (one), the textbox count 0, the
      `toApplicants` link and the row by owner name;
    - `flatmates.spec.ts` ac5 / ac6: the `myFlats` link (one), the row regex, the `group` `toHaveText` (the toggle
      sits outside the group), the joined note, the composer label "הודעה" (the log's "הודעות" does not contain
      it), `removed` and the back link;
    - `people.spec.ts`: the level-1 heading, which is the thread's;
    - `likes.spec.ts`: the URL only.

    The pane adds an `<h2>`, one row link per chat, one ghost "הדירות שלי" link and an empty status.

    The `Removed` invalidation is enough for ac5 step 7: the header's observer and the pane are active, the
    refetch omits X, and `/chat` with zero chats is `EmptyState` alone.
22. **[note] Phone path of the harness.** `PhoneChatLayout` only adds a wrapper `div`. The thread and stream
    suites query by role and text, and `BackLink` keeps the name and the `href`. The extra list GET from
    `Removed` hits the `() => json([])` function replies, so no "body used" error occurs. `ac5`'s
    `LIST` count of 1 has no `Removed` in it.
23. **[note, orchestrator] Pointers in other specs.** Point `0009g` Out (line 189, "193 → 0009q") and `0009l`
    (lines 114, 256, 330, 338: "0009g's `ClampedText`") at this spec.
24. **[note] Product questions.** None remain.

Verdict: passes with 1–20 applied. One coder run, at the upper end. Reviewers unchanged.

## Digest (filled by orchestrator after verification)
See `/digest`.
