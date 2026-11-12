---
id: 0009qb
title: The flatmates screens (invite link and members, joining a flat, my flats) look like the artboards' cards on a phone and use the width on a desktop, and their confirms are the kit's in-app dialog
status: verified
depends_on: [0009qa]   # 0009qa (which depends on 0009h → 0009d): the screens harness and the EmptyState / Badge / Tag additions it may add, and the shared pageWidths.test.ts / he.json edits; build from 0009qa's branch once its PR is open
reviewers: [code, qa, ux, security]   # security: the join page's JSX is rebuilt around the invite token, a bearer secret (AC5 pins it); ux: three screens without an artboard, judged against Inbox / InboxDesktop / Main; qa: every state and the async confirm guards; no perf: no query
estimate: 1 coder run   # coder Opus/high: the token page and the async confirm guards (verifier)
---

## Goal
After this ships, three flatmates screens are built from the `0009d` kit and its tokens:
- `/me/listings/:id/flatmates`: the invite link and the members side by side on a desktop;
- `/flatmates/join`: one centred invitation card;
- `/me/flats`: Inbox-style cards.

The native `window.confirm` boxes (rotate, disable, remove, leave) become the kit's in-app dialog
(`useConfirm`). Behaviour, routes, the invite token's handling and the API are unchanged.

This is Slice 9b (Gilad, 2026-11-12). No artboard covers these screens, and Gilad decided there will be no new
ones. The designs below extrapolate from `Inbox.dc.html` / `InboxDesktop.dc.html` (card, header, buttons) and
`Main.dc.html` (the brand mark). This is the second half of the original `0009q`, which the verifier split; the
seeker lists are `0009qa`.

## Scope
**In:**

### 0. Rules for every in-scope file
In-scope files:
- `features/flatmates/FlatmatesPage.tsx`;
- `features/flatmates/JoinFlatPage.tsx`;
- `features/flatmates/MyFlatsPage.tsx`.

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
- **Kit only.** A button or a button-looking link is `Button` (with `to` for a link). A white box is `Card`. A
  status pill is `Badge`. A static chip is `Tag`. A text box is `Field` + `TextInput`. A page `<h1>` block is
  `PageHeader`, with `back` for a back link. The page root is `PageContainer`. Nothing defines a local button,
  card, chip or input style. The one documented exception is an inline notice. The kit has no notice component,
  so the warning notice below is token classes on a `<p>` / `<div>`.
- **Tokens only.** No hex. An arbitrary `[…]` value is allowed only in the exceptions table at the end of this
  section. Today's literals map to tokens:
  - `min-h-[44px]` → `min-h-tap`;
  - `text-[15px]` / `[13px]` / `[17px]` / `[20px]` / `[12px]` / `[11px]` → `text-body` / `text-body-sm` /
    `text-h3` / `text-h3` / `text-caption` / `text-caption`;
  - `py-[14px]` / `pt-[14px]` → `py-3.5` / `pt-3.5`;
  - `rounded-[14px]` / `[20px]` → `rounded-md` / `rounded-lg`;
  - `border-[1.5px]` → `border-1.5`;
  - `tracking-[-0.3px]` → `tracking-tight`;
  - `h-[200px]` → `h-48`.
- **Behaviour is unchanged, and so is what other specs added.** Every `role`, `aria-*`, `id`, `data-testid`,
  `tabIndex`, `ref`, focus effect, live region, mutation guard (`inFlight`) and query call on the base branch stays.
  That includes what `0009c` (the `<h1>` in loading states; `components/Loading`; `usePageTitle`; `ListingCard
  titleAs`), `0009t` (focus after withdraw, unlike, remove, leave and a final join error; `LikeRoomButton
  onUnliked`), `0009g` (`LikeRoomButton onGone`, the likes "gone" line, `ErrorState` busy / offline) and `0009f`
  (the join page's way-out links) add, if they land first. If one of them lands after this spec, it rebases onto
  this layout.
- **Ownership.** The wording of existing keys is `0009b` / `0009f`'s; only the new key below is this spec's.
  The kit additions (`EmptyState action`, `Badge` / `Tag` attributes) are `0009qa`'s. This spec does not need
  them.

| Exception | Where | Why no token |
| --- | --- | --- |
| `[overflow-wrap:anywhere]` | long names / titles (today's class, kept) | Tailwind has no utility; `break-words` does not shrink a flex item's min-content |

### 1. `/me/listings/:id/flatmates` — `FlatmatesPage.tsx`
Nearest artboard: `InboxDesktop.dc.html` (the page header with a back link, the panel cards, the buttons).

**Width:** `PageContainer width="default"`, `as="section"`, `className="flex flex-col gap-5"`, on every return
path.

**Header:** `PageHeader`:
- `back={{ to: '/me/listings', label: t('flatmates.back') }}` (replaces the local `Back`);
- `title={t('flatmates.title')}`;
- `titleRef={headingRef}` (the disable focus is kept);
- `subtitle={cardTitle(t, listing)}`.

The not-found and error branches render the same `PageHeader` with `title={t('flatmates.notFound')}` (not found)
or `flatmates.title` above the `ErrorState` (error). Keep `0009c`'s `<h1>` rules.

**Body:** `div` `flex flex-col gap-5 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6`, with two columns in DOM
order. On a phone they stack, invite first.

**Column 1: invite.**
- `<h2 id={inviteTitleId} className="text-h3">` with the new key `flatmates.invite.title`.
- Then the `InviteBlock` as `Card padding="md"` (`flex flex-col gap-3`):
  - **no link:** `flatmates.invite.hint` in `text-body`, then `Button variant="primary" size="lg"` with
    `flatmates.invite.create`;
  - **active, not shown:** `flatmates.invite.active` in `text-body font-semibold`, then a row with two
    `Button variant="secondary" size="sm"`: rotate and disable;
  - **just created or rotated:** the URL `Field label={t('flatmates.invite.linkLabel')} labelHidden` wrapping
    `TextInput readOnly dir="ltr" className="text-start"`, with its `ref`, `onFocus` select and the
    focus-on-mount kept. Then `Button variant="secondary"` with `flatmates.invite.copy`;
  - `TextInput` puts `className` on its outer box (`0009d`), so `text-start` is on the box, not the `<input>`.
    The `<input>` carries `dir="ltr"`, and `text-align`'s initial value `start` then resolves to the left, so
    the class is not needed on it. `FlatmatesPage.test.tsx:99`'s `toHaveClass('text-start')` on the textbox is
    replaced by `toHaveAttribute('dir', 'ltr')` (already asserted at :98) plus
    `expect(input.closest('.text-start')).not.toBeNull()`;
  - the input and the copy button sit in `flex flex-col gap-2 sm:flex-row lg:flex-col`. The column is full width
    below `lg` and half width at `lg`. This replaces `min-[400px]:flex-row`;
  - the `role="status"` copied line in `text-body-sm font-medium text-success` (the words carry it);
  - the once-warning as an inline notice: `flex items-start gap-2 rounded-md border border-border bg-surface-subtle px-3
    py-2 text-body-sm text-ink`, led by an `aria-hidden` 16 px outline warning mark (`M12 6v7` and a dot at 17.5,
    `stroke="currentColor"`, `strokeWidth={2}`, `strokeLinecap="round"`) in `text-warning`;
  - the rotate / disable row below;
  - the error `<p role="alert">` in `text-body-sm font-semibold text-danger`.

**Column 2: members.**
- The `<h2 id={listTitleId}>` with `flatmates.list.title`, its focus target from `0009c` kept.
- With flatmates: a `Card padding="md"` holding the `ul aria-labelledby={listTitleId}`.
- With none: `EmptyState pose="sleep"` with `flatmates.list.empty` (the page's one mascot).
- Loading: `Skeleton`. Error: `ErrorState`.

**`FlatmateRow`** (`li`, `flex flex-wrap items-center gap-3 border-t border-border pt-3 first:border-t-0 first:pt-0`):
- an `aria-hidden` avatar: `flex h-10 w-10 flex-none items-center justify-center rounded-full bg-accent-soft
  text-body font-semibold text-accent-strong`, holding the name's first character (`Array.from(name)[0]`, as the
  chat list does);
- a `min-w-0 flex-1` column: the name (`text-h3 [overflow-wrap:anywhere]`, `dir="auto"`,
  `id={nameId}`) and `flatmates.list.joinedAt` in `text-caption text-ink-muted`;
- `Button variant="secondary" size="sm"` with `flatmates.list.remove`, `aria-describedby={nameId}`;
- the row's error `<p role="alert">` spans the full width under the row (`basis-full`; the `li` is `flex-wrap`).

**Confirms → `useConfirm()`.** `FlatmatesPage` calls `const [confirm, dialog] = useConfirm()` at its top, before any
early return, and renders `dialog` once, in its main return. `InviteBlock` and `FlatmateRow` get `confirm` as a
prop (typed `ReturnType<typeof useConfirm>[0]`, unless `Dialog.tsx` exports a named type), so `InviteBlock`'s `key={removals}` remount
never unmounts an open dialog. The handlers become `async`. Each `window.confirm(x)` becomes
`await confirm({ … })`, and the action proceeds only on `true`:
- **rotate:** `title: t('flatmates.invite.rotateConfirm')`, `confirmLabel: t('flatmates.invite.rotate')`,
  `tone: 'primary'`;
- **disable:** `title: t('flatmates.invite.disableConfirm')`, `confirmLabel: t('flatmates.invite.disable')`,
  `tone: 'danger'`;
- **remove:** `title: t('flatmates.list.removeConfirm', { name })`, `confirmLabel: t('flatmates.list.remove')`,
  `tone: 'danger'`.

The guard order, exactly:
```
if (inFlight.current) return;
const ok = await confirm({ … });
if (!ok || inFlight.current) return;   // re-checked after the await
inFlight.current = true;
mutate(…, { onSettled: () => { inFlight.current = false; } });
```
A same-tick double click calls `confirm` twice; `useConfirm` resolves the first call `false` (`0009d`: a second
`confirm()` supersedes the first), so one dialog shows and at most one request is sent. In a browser the modal's
backdrop blocks the second click anyway. The opener regains focus on cancel and on confirm (the kit does this);
on a confirmed remove or disable, the later focus target (`0009t`'s list `<h2>`, today's `<h1>` after a disable)
wins, because it runs after the mutation settles. No key changes: the confirm sentences stay `0009b`'s wording,
used as titles.

Tests that look up the row's "הסרה" while the dialog is open scope it (`within(row)`), and the dialog's buttons
through `within(screen.getByRole('dialog'))`: both say "הסרה", and jsdom has no top layer or `inert`.

### 2. `/flatmates/join` — `JoinFlatPage.tsx`
Nearest artboard: `Inbox.dc.html`'s card and `Main.dc.html`'s brand mark (an invitation reads like an auth step).

**Width:** `PageContainer width="narrow"` (480 px, centred), `as="section"`, `className="flex flex-col gap-4"`,
in `Frame` (every state).

**Header:** `Frame` renders `PageHeader title={t('flatmates.join.title')}` in place of its `<h1>`.

**The invitation card** (preview loaded; member or not): `Card padding="lg"` (`flex flex-col gap-4`).
In order:
1. The kit's `Mascot` at its 96 px minimum, `self-center`: `pose="hello"` on the invitation (a welcome screen,
   `design/brand/README.md`) and `pose="celebrate"` in the member state (already joined). It is decorative
   (`aria-hidden`, as the kit renders it).
2. The title block: `cardTitle(t, listing)` in `text-h3`, and `flatmates.join.invitedBy` in
   `text-body text-ink-muted dir="auto"`.
3. The main line, in today's order (a non-final failure such as `rateLimited` shows both the button and the
   alert):
   - member: `flatmates.join.member` in `text-body font-semibold` (and nothing below);
   - not member and not spent: `Button variant="primary" size="lg" fullWidth` with `flatmates.join.cta`,
     `disabled` + `aria-busy` as today;
   - then, for a join failure other than `other`: the alert `<p role="alert">` in `text-body font-semibold
     text-danger`, the element `0009t` focuses.
   - `other` keeps today's `ErrorState` after the card (`JoinFlatPage.tsx:266`).
4. An actions row, `flex flex-wrap gap-2`, rendered only when it has children:
   - member: `Button variant="secondary" to="/chat"` with `flatmates.join.toChats`;
   - `0009f`'s way-out links for the failure states go here (FOLLOWUPS 189). They are `0009f`'s keys and
     links; this spec only places the row.

**Failure with no preview** (no token, or the preview's final 4xx): `Card padding="lg"` holding
the alert `<p role="alert">` (`text-body font-semibold`) and the same actions row slot. It has no mascot,
because a failure is not an empty state.

**`other` errors:** `ErrorState`. **Loading:** `Skeleton` in the base's loading wrapper.

**The token is not touched.** These stay byte for byte:
- the hash read;
- `stashInviteToken` / `readInviteToken` / `clearInviteToken`;
- the `navigate(JOIN_PATH, { replace: true })`;
- the login redirect;
- the POST bodies.

Only JSX and classes change. The token is never rendered (AC5).

### 3. `/me/flats` — `MyFlatsPage.tsx`
Nearest artboard: `Inbox.dc.html`'s card.

**Width:** `PageContainer width="default"`, `as="section"`, `className="flex flex-col gap-4"`.

**Header:** `PageHeader back={{ to: '/chat', label: t('flatmates.mine.back') }} title={t('flatmates.mine.title')}`.

**Card:** `Card as="li" padding="md"`, `flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between`:
- the text column (`flex min-w-0 flex-col gap-1`):
  - the title `cardTitle` in `text-h3`, with `id={titleId}` and `dir="auto"`;
  - `flatmates.mine.owner` in `text-caption text-ink-muted`, `dir="auto"`;
  - `flatmates.mine.joinedAt` in `text-caption text-ink-muted`;
- `Button variant="secondary" size="sm"` with `flatmates.mine.leave` and `aria-describedby={titleId}`, `self-start
  lg:self-center`;
- the error alert under them (`text-body-sm font-semibold text-danger`).

**Leave:** goes through `useConfirm()` with `title: t('flatmates.mine.leaveConfirm')`, `confirmLabel:
t('flatmates.mine.leave')`, `tone: 'danger'`, using the same guard rule as §1. `MyFlatsPage` owns the one
`useConfirm()` and passes `confirm` to each `FlatRow`. `0009t`'s focus on the page `<h1>` after a leave goes
through `PageHeader`'s `titleRef`.

**States:**
- empty: `EmptyState pose="sleep"` with `flatmates.mine.empty`;
- loading: `Skeleton`;
- error: `ErrorState`;
- list: `ul` `flex flex-col gap-3`.

### 4. Page widths table (`0009h`)
In `web/src/app/__tests__/pageWidths.test.ts`'s table constant, set:
- `flatmates/FlatmatesPage.tsx` → `default`;
- `flatmates/MyFlatsPage.tsx` → `default`.

`flatmates/JoinFlatPage.tsx` stays `narrow`.

### 5. `web/src/locales/he.json` (new key only)
| Key | Hebrew |
| --- | --- |
| `flatmates.invite.title` | "קישור הזמנה" |

It is not count-dependent.

### 6. E2E edits (no new sign-up)
- `web/e2e/flatmates.spec.ts::ac5_group_chat_flow`, the remove step: delete `page.once('dialog', …)`. After the
  row's "הסרה" click, click `page.getByRole('dialog').getByRole('button', { name: he.flatmates.list.remove })`.
- The desktop checks of AC6 are `test.step`s inside existing tests.

**Out:**
- The seeker lists: `0009qa`. The chat: `0009s`.
- The header and the bottom bar: `0009a`.
- Copy of existing keys and the join page's way-out links: `0009b` / `0009f`.
- Focus and announcements: `0009c` / `0009t`.
- `ErrorState` behaviour: `0009g`.

**New dependencies:** none.

## Data
None.

## API
None. The screens read and write the same endpoints as today.

## UI
Every state is listed per screen in Scope §1–§3.

**At 390 px:**
- one column;
- 16 px gutters;
- buttons at least 44 px tall;
- no horizontal scroll.

**At ≥ 1024 px:**
- flatmates: 720 px, with the invite and the members side by side;
- join: a centred 480 px card;
- `/me/flats`: 720 px, with each card's button at the inline end.

**RTL:**
- logical classes only;
- the invite URL is `dir="ltr"` and `text-start`;
- names and owner lines are `dir="auto"`.

**i18n:** one new key (§5).

## Acceptance criteria
Hebrew test strings use `\uXXXX` escapes or `he.json` lookups, as the listings fixtures do.

- [ ] AC1 Flatmates page:
  - the header has the back link "חזרה למודעות שלי", the `<h1>` "שותפים בדירה" and the room's title as
    subtitle;
  - the invite column has the `<h2>` "קישור הזמנה";
  - after create, the textbox named "קישור ההזמנה" holds the `#token` URL, is `dir="ltr"`, and its `TextInput`
    box (`input.closest('.text-start')`) carries `text-start`;
  - each member row has an `aria-hidden` initial and a "הסרה" button described by the name.

  — `web/src/features/flatmates/__tests__/FlatmatesPage.test.tsx::ac1_layout` (and the existing tests, with
  `window.confirm` spies replaced as in AC2)
- [ ] AC2 Confirms are in-app dialogs:
  - rotate, disable and remove each open a `dialog` whose name is the existing confirm sentence and whose confirm
    button is the action's label;
  - "ביטול" sends nothing and returns focus to the opener;
  - confirming sends exactly one request;
  - a double click on "הסרה" opens one dialog;
  - `window.confirm` is never called (spy).

  The same holds for "יציאה מהדירה" on `/me/flats`. — `FlatmatesPage.test.tsx::ac2_confirm_dialogs`,
  `web/src/features/flatmates/__tests__/MyFlatsPage.test.tsx::ac2_leave_dialog`
- [ ] AC3 Join page, per state:
  - each state renders inside a `PageContainer` with `max-w-narrow` and one `<h1>` "הזמנה להצטרף לדירה";
  - the preview state shows the room title, "הוזמנת על ידי …" and a full-width "הצטרפות לדירה" button;
  - member shows the message and a "לשיחות" link to `/chat`;
  - each final failure (`invalid`, `own`, `applied`, `declined`, `full`) and `rateLimited` shows its
    `role="alert"` text;
  - `other` shows `ErrorState`;
  - the existing `JoinFlatPage.test.tsx` cases pass unchanged.

  — `web/src/features/flatmates/__tests__/JoinFlatPage.test.tsx::ac3_states_layout`
- [ ] AC4 My flats: two flats render as two `li` cards with title, owner and joined lines and a "יציאה מהדירה"
  button described by the title. Empty, loading and error render their states. —
  `MyFlatsPage.test.tsx::ac4_cards_and_states`
- [ ] AC5 The invite token stays out of every URL and out of the page:
  - for `/flatmates/join#T` (with `T` a valid token), neither `document.body.textContent` nor any `[href]`
    contains `T` at each checkpoint: the first render, after the hash effect, with the preview shown, after a 429
    join (alert and button), and after a final 409 join;
  - after the effect, `location.hash` is empty;
  - the POST body carries `T`;
  - `web/e2e/flatmates.spec.ts::ac6_invite_and_join`'s URL / `Referer` checks pass unchanged.

  — `JoinFlatPage.test.tsx::ac5_token_never_rendered`, `web/e2e/flatmates.spec.ts::ac6_invite_and_join`
- [ ] AC6 E2E flatmates layout, two `test.step`s in `web/e2e/flatmates.spec.ts::ac6_invite_and_join`, no new
  sign-up:
  - `test.step('0009qb join at 1440')` on `flatmatePage`, right **before** the "הצטרפות לדירה" click (after the
    join page's `<h1>` check, `flatmates.spec.ts:91-93`), at 1440×900:
    - the "הצטרפות לדירה" button is at most 480 px wide;
    - its centre is `clientWidth / 2` ± 2 px;
  - `test.step('0009qb flatmates at 1440 and 390')` on `page`, right **after** "O's flatmates page lists F"
    (`flatmates.spec.ts:99-100`):
    - at 1440×900, `getByRole('heading', { level: 2, name: he.flatmates.invite.title, exact: true })` and the
      `h2` "שותפים שהצטרפו" share a top edge (±2 px), and the invite heading's x is greater than the members
      heading's (RTL: the invite is at the start). `exact: true`, because the hint and the create button also
      contain "קישור הזמנה";
    - at 390×844, the members heading's top is below the invite card's bottom.
  - Geometry from `boundingBox()`; `clientWidth` is `document.documentElement.clientWidth`. After each step, `setViewportSize({ width: 1280,
    height: 720 })`.

  — `web/e2e/flatmates.spec.ts::ac6_invite_and_join`
- [ ] AC7 Visual check. Screenshots at 390×844 and 1440×900 of every state below, captured on the final local
  head. The ux reviewer compares them with `Inbox.dc.html` / `InboxDesktop.dc.html` (cards, header, buttons) and
  `Main.dc.html` for layout, and with `design/brand/README.md` for colour, type, shape and the mascot. The states:
  1. flatmates loading;
  2. flatmates not found;
  3. flatmates, no link and no members;
  4. flatmates, link just created, with two members;
  5. flatmates, active link, three members, one with a remove error;
  6. flatmates, the remove dialog open;
  7. join loading;
  8. join preview;
  9. join member;
  10. join invalid;
  11. join own;
  12. join applied;
  13. join declined;
  14. join full;
  15. join rate-limited;
  16. join other error;
  17. my flats loading;
  18. my flats empty;
  19. my flats with two flats;
  20. my flats, the leave dialog open.

  **Capture:**
  - Use the repo's screenshot harness when it is on the branch (`0009i`, `0009k`, `0009l` and `0009p` all use
    `0009l`'s names).
  - If none is there, add `0009l`'s form:
    - `web/playwright.screens.config.ts` (`testDir: 'e2e/screens'`, `testMatch: '*.screens.ts'`, so `make e2e`
      never runs it; one project per size; base URL `http://localhost:5173`);
    - a `make screens` target with a `##` comment;
    - `web/screens/` in `.gitignore`.
  - This spec's file is `web/e2e/screens/flatmates.screens.ts`, with fixtures in
    `web/e2e/screens/fixtures-flatmates.ts`.
  - Every API request is answered by `page.route`: an owner `/me` with `/me/listings` and the flatmates GETs /
    POSTs / DELETEs, a seeker `/me` with the invite preview and the join answers per state, `/me/flats`, an empty
    `/me/conversations`, and the event stream aborted. An unmatched API request fails the run, so it needs only the
    web on port 5173: no sign-up and no OTP.
  - Output: `web/screens/0009qb/NN-<state>-<width>.png`.

  — `web/e2e/screens/flatmates.screens.ts`, the PNGs listed in the digest
- [ ] AC8 Kit and tokens:
  - `grep -nE '\[[0-9.]+px\]|#[0-9A-Fa-f]{3,8}\b|window\.confirm'` over the in-scope files prints nothing beyond
    the exceptions table;
  - `0009h`'s `noColourLiterals` and `pageWidths` tests pass with §4's table;
  - no in-scope file defines a local button, card, badge, chip or input style;
  - no old token name is left in the in-scope files: `grep -nE 'accent-(tint|text)|\b(bg|text)-warn|border-line|bg-bg\b|surface-muted|ink-soft|shadow-|font-extrabold|Heebo'` prints nothing;

  The digest quotes the grep. — `web/src/app/__tests__/pageWidths.test.ts` (table updated), the grep in the digest
- [ ] NF1 `make lint`, `make test`, `make i18n-check`, `make build-web` and local `make e2e` are green on the final
  head (Speed rule 7). Check that port 5173 is free first. The e2e result and the screenshot folder go in the
  digest.

## Tests to write
- **Component** (vitest, the existing `fetch` stubs): AC1–AC5 in the files named.
- The existing flatmates tests swap `vi.spyOn(window, 'confirm')` for clicks in the `dialog`; jsdom gets
  `0009d`'s `showModal` stand-in.
  - These tests change: `FlatmatesPage.test.tsx` ac1 (declines, a double-click disable that sends one DELETE,
    the `<h1>` focused after a disable) and ac2 (a decline, a double-click remove that sends one DELETE, the 500
    alert), and `MyFlatsPage.test.tsx` leave.
  - What they assert still holds.
- **E2E:** AC6 as steps in an existing test (0 new sign-ups), plus the dialog step change in
  `flatmates.spec.ts::ac5`.
- **Visual:** AC7.

## Risks / open questions
- **Same files as `0009c`, `0009t`, `0009g` and `0009f`**: focus after remove / leave / a final join error, `<h1>`
  states, titles, `ErrorState`, and the join page's way-out links. Web specs never build together, so the second
  to merge rebases, and rule §0 keeps every behaviour line.
- **`useConfirm` replaces `window.confirm`.** `0009d` says migrating is the screen specs' work, and `0009l` does
  the same for decline. The only e2e that accepts a native flatmates dialog is `flatmates.spec.ts::ac5`'s remove
  step (§6).
- **The invite token.**
  - Only JSX and classes change on the join page (§2).
  - AC5 pins that the token is never rendered and the hash is dropped.
  - The e2e `ac6_invite_and_join` keeps its URL / `Referer` checks.
- **Product questions for Gilad:** none.
- **Verifier round 1** (on the combined `0009q`): 22 findings, all applied, including this split (finding 1).
  Second round waived. The brand amendment was then applied as a spec edit (orchestrator, 2026-11-12), without
  re-running the verifier.

## Digest (filled by orchestrator after verification)
See `/digest`.
