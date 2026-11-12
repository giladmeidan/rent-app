---
id: 0009qa
title: A seeker's "my applications" and "likes" look like the artboards' cards on a phone and use the width on a desktop — a 720 px list of Inbox-style application cards, and a grid of liked rooms with search's match badge
status: verified
depends_on: [0009h]   # 0009h (which depends on 0009d): the kit (Button, Card, Badge, Tag, PageContainer, PageHeader), the tokens, the page roots and the pageWidths table this spec edits. Branch from 0009h's PR once it is open
reviewers: [code, qa, ux]   # ux: two screens without an artboard, judged against Search / Inbox / InboxDesktop; qa: every state, the like toggle, the mutual banner; no security: no chat, token or PII rendering changes; no perf: no query added beyond the cached profile
estimate: 1 coder run   # coder Sonnet/high: styling and layout only, no auth / money / data; Opus if the run overflows
---

## Goal
After this ships, two seeker screens are built from the `0009d` kit and its tokens:
- `/me/applications`: Inbox-style cards in one 720 px column. Ended applications are muted.
- `/me/likes`: a grid of listing cards on a desktop (2 columns at `md`, 3 at `xl`), each with the match badge,
  chips and "your age" chip that search shows (FOLLOWUPS 183).

The mutual banner gets the brand's look (`design/brand/`); the like toggle is `0009j`'s. Behaviour, routes and
the API are unchanged.

This is Slice 9b (Gilad, 2026-11-12: "the app does not look good, layouts do not fill the screen"). No artboard
covers these screens, and Gilad decided there will be no new ones. Each screen's design is written below,
extrapolated from the kit and from the nearest artboard:
- `Inbox.dc.html` / `InboxDesktop.dc.html`: the card, the name / status row, the buttons and the page header;
- `Search.dc.html`: the listing card and the grid.

This is the first half of the original `0009q`, which the verifier split. The flatmates screens are `0009qb`
and the chat is `0009s`.

## Scope
**In:**

### 0. Rules for every in-scope file
In-scope files:
- `features/applications/MyApplicationsPage.tsx`;
- `features/applications/ApplicationStatusChip.tsx` (the seeker branch only);
- `features/likes/MyLikesPage.tsx` and `features/likes/MutualBanner.tsx`. `LikeRoomButton`'s restyle is
  `0009j`'s (orchestrator, 2026-11-12); this spec only places it;
- the kit additions below.

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
  so the tint panel below (`MutualBanner`) is token classes on a `<p>` / `<div>`.
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
- **Kit additions this spec makes, each with a test** (`0009d` lets a screen spec add a prop):
  - `EmptyState` gains `action?: ReactNode`, rendered after the message inside its `Card` (`flex flex-col
    items-start gap-3`), unless it is on the base already. `0009h` lists it as "a screen spec adds it with its
    first caller" (its Out); this spec is that caller. Test:
    `components/__tests__/EmptyState.test.tsx::action_renders_after_message`.
  - `Badge` and `Tag` pass their remaining HTML attributes (`HTMLAttributes<HTMLSpanElement>`, `data-testid`
    included) to their root, unless they do already (`0009d` lists no rest props). Tests:
    `Badge.test.tsx::passes_html_attributes`, `Tag.test.tsx::passes_html_attributes`. `0009l` needs the same for
    the owner chip; whichever builds first adds it.
- **Ownership.**
  - Wording of existing keys is `0009b` / `0009f`'s. Only the new keys below are this spec's.
  - `ListingCard`, `MatchBadge` and `MatchChips` are `0009i`'s: they are rendered as they are, never edited.
  - The owner branch of `ApplicationStatusChip` is `0009l`'s.

| Exception | Where | Why no token |
| --- | --- | --- |
| `[overflow-wrap:anywhere]` | long names / titles (today's class, kept) | Tailwind has no utility; `break-words` does not shrink a flex item's min-content |

### 1. `/me/applications` — `MyApplicationsPage.tsx`
Nearest artboard: `Inbox.dc.html`'s applicant card and `InboxDesktop.dc.html`'s "הודעה אישית" block.

**Width:** `PageContainer width="default"` (720 px), `as="section"`, `className="flex flex-col gap-4"`.

**Desktop: a list, not a grid.**
- The page is a status tracker, read top to bottom in the API's order (newest first).
- The cards carry the seeker's own message (1–500 characters, line breaks kept), so their heights vary a lot. A
  grid would break the order into a right-to-left zigzag and leave ragged rows.
- One 720 px column is a comfortable reading measure.
- The header and the shell already span the screen (`0009h`).

**Header:** `PageHeader title={t('applications.mine.title')}`, with no back link and no actions.

**Card:** `Card as="article" padding="md"` at every width (`0009d` §2: `className` never overrides padding). Ended cards (`declined`, `withdrawn`)
use `variant="muted"`, and every other card `default`. The card is a `flex flex-col gap-3`. In order:
1. A row, `flex items-start justify-between gap-3`:
   - the price `text-h3 font-semibold`, then a space and `listings.units.perMonth` in
     `text-caption font-medium text-ink-muted`;
   - `ApplicationStatusChip` at the inline end.
2. The title `<h2 id={titleId}>` (`text-h3 leading-snug [overflow-wrap:anywhere]`). It holds the
   `Link` to `/listings/{id}` with `inline-flex min-h-tap items-center rounded text-accent underline
   underline-offset-4` plus `focusRing`. The title text is whatever the base renders (`0009b` may switch it to
   `cardTitle`).
3. The meta line `applications.applied` in `text-caption text-ink-muted`. For `declined` only, the next line is
   `applications.declinedHint` in `text-caption text-ink-muted`.
4. The message block:
   - When `source === 'like'`: `<Tag tone="accent" data-testid="application-mutual">` with
     `applications.mutual`. Keep the test id on the element holding the text.
   - Otherwise: a label `applications.yourMessage` (`text-label text-ink-muted`), then the message
     `<p data-testid="application-message">` in `rounded-md bg-surface-subtle px-3.5 py-3 text-body leading-relaxed
     text-ink whitespace-pre-line break-words`. This is InboxDesktop's "הודעה אישית" box. On a muted
     card the box is `bg-surface`. The message is still React text children only.
5. The actions row (only when today's condition holds), `flex flex-wrap gap-2 pt-1`:
   - shortlisted: `Button variant="primary" to={`/chat/${id}`} aria-describedby={titleId}` with
     `applications.chat`;
   - withdrawable: `Button variant="secondary"`, `disabled` + `aria-busy` as today, `aria-describedby={titleId}`,
     with `applications.withdraw`;
   - on a phone, both buttons are `flex-1`; at `lg` they are `lg:flex-none`, at the inline start;
   - the error `<p role="alert">` (`text-body-sm font-semibold text-danger`) sits under the row, as today.

**Status chip:** in `ApplicationStatusChip.tsx`, the seeker branch renders `<Badge data-testid="application-status"
size="md" tone={…}>` with `shortlisted` → `accent` and `submitted`, `declined` and `withdrawn` → `neutral`. The
brand allows one accent-filled element per screen, so the old solid shortlisted chip goes. The words carry each
status (brand: a status always comes with words), and the muted card adds "ended" on this page. On the listing
page (`ApplySection`, `0009j`) only one chip shows at a time.

**States:**
- **Loading:** three `Skeleton` blocks (Card-shaped, `0009h`) in the base's loading wrapper.
- **Error** (nothing cached): `ErrorState`.
- **Empty:** `EmptyState pose="sleep" message={t('applications.mine.empty')} action={<Button variant="primary" to="/search">…</Button>}`
  with `applications.mine.search` (the `action` prop this spec adds, §0). This replaces today's separate link.
- **List:** `ul` `flex flex-col gap-4`, one `li` per card.

### 2. `/me/likes` — `MyLikesPage.tsx`, `MutualBanner.tsx`
Nearest artboard: `Search.dc.html`'s vertical listing card (via `0009i`'s `ListingCard`). The grid follows
`InboxDesktop.dc.html`'s card grid.

**Width:** `PageContainer width="wide"`, `className="flex flex-col gap-6"`.

**Desktop: a grid.**
- The items are uniform listing cards with a photo band, and the seeker scans their photos and prices.
- The cards' anatomy is drawn for about 360–430 px, so three columns of about 430 px at 1440 look like the
  artboard's card.
- A list of 1336 px wide cards would stretch the photo band into a strip.

**Header:** `PageHeader title={t('likes.title')}`.

**Notices slot:** a `div` (`flex flex-col gap-3`) right under the header. It holds the `MutualBanner` and, when
`0009g` is on the base, its "gone" alert region. Without `0009g` it renders only while the banner shows. With
`0009g` it is always rendered, because `0009g` keeps that region always mounted (`tabIndex={-1}`, under the
`<h1>`); the region moves into the slot unchanged.

**Sections:** two sections, in today's order. Each is a `<section aria-labelledby>` with an
`<h2 className="font-display text-h2">`. The ids `likes-liked-me` / `likes-mine` and the `tabIndex` from
`0009c` are kept. Each section holds:
- a `ul` `grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 items-start`, one `li` per room;
- or its empty state.

**Each room:**
```
<ListingCard listing today to seekerBirthYear={profile?.birth_year}
             badge={listing.match && <MatchBadge score={listing.match.score} />}>
  {listing.match && <MatchChips match={listing.match} listing={listing} profile={profile} />}
  <div className="relative z-10"><LikeRoomButton … /></div>
</ListingCard>
```
- This is FOLLOWUPS 183: the same badge, chips and "your age" chip as `ResultsList.tsx:74-83`.
- `profile` is `useProfile().data ?? undefined` (`features/profile/useProfile.ts`). The page sits under
  `RequireSeeker`, so it is always a seeker. The profile is usually cached from search, and a missing profile
  simply hides the age chip, as in search. A 401 on it clears the session, as `useProfile` does on search.
- The existing `MyLikesPage.test.tsx` cases add `'GET /me/profile': [() => json(null)]` to their mocks (today an
  unmocked route answers 599, which would only hide the chips, but the tests should not lean on it).
- `0009c`'s `titleAs="h3"` is passed through if it is on the base.

**Empty states** (`EmptyState`). Only the first empty section in DOM order passes `pose="sleep"`, because the
brand allows one mascot per screen:
- liked me: `likes.likedMeEmpty`, with `action` = `Button variant="ghost" to="/me/profile?section=room"`
  (`likes.toProfile`), replacing today's separate link;
- mine: `likes.mineEmpty`.

**Loading:** in the base's loading wrapper, a `grid … xl:grid-cols-3` of three `Skeleton className="h-64 w-full
rounded-lg"`.

**Error:** `ErrorState`.

**`MutualBanner`:**
- a `<div role="status">` in `flex flex-wrap items-center justify-between gap-3 rounded-lg bg-accent-soft px-4
  py-3.5` (an inline notice);
- the text `likes.mutual` in `text-body font-medium text-accent-strong` (on `accent-soft`);
- `Button variant="primary" to={`/chat/${id}`}` with `likes.toChat`. It keeps the `ref`, so the existing
  focus-on-mount works, and needs `Button` to forward refs (`0009d`). The button is `ink` (primary), so the
  banner adds no accent fill.

**`LikeRoomButton`** is `0009j`'s (orchestrator, 2026-11-12). It renders as `0009j` leaves it, inside the
`relative z-10` wrapper above. This spec does not edit it.

### 3. Page widths table (`0009h`)
In `web/src/app/__tests__/pageWidths.test.ts`'s table constant, set:
- `applications/MyApplicationsPage.tsx` → `default`;
- `likes/MyLikesPage.tsx` → `wide`.

### 4. `web/src/locales/he.json`
No new key.

**Out:**
- The flatmates screens (flatmates page, join, my flats) and their confirms: `0009qb`.
- The chat list and thread: `0009s`.
- `ListingCard`, `MatchBadge` and `MatchChips` themselves: `0009i`.
- The owner branch of `ApplicationStatusChip`: `0009l`.
- The header and the bottom bar: `0009a`.
- Copy of existing keys: `0009b` / `0009f`.
- Focus and announcements: `0009c` / `0009t`.
- Drafts, the "gone" line and `ErrorState` behaviour: `0009g`.
- A status summary ("N מועמדויות · M ברשימה הקצרה", InboxDesktop's stat tiles) on `/me/applications`. It would be
  new content, and a candidate follow-up.

**New dependencies:** none.

## Data
None.

## API
None. The screens read the same endpoints as today. `/me/likes` also reads `GET /me/profile` through
`useProfile`, which search already calls, so the response is usually cached.

## UI
Every state is listed per screen in Scope §1–§2.

**At 390 px:**
- one column;
- 16 px gutters (`PageContainer`);
- buttons at least 44 px tall;
- no horizontal scroll;
- the bottom tab bar (`0009a`) is below the content (`Layout`'s `main` padding).

**At ≥ 1024 px:**
- `/me/applications`: a 720 px list;
- `/me/likes`: a 1336 px grid, 2 columns at `md` and `lg`, 3 at `xl`.

**RTL:**
- logical classes only;
- the mascot is never flipped (the brand's rule, enforced by the kit).

**i18n:** no new key.

## Acceptance criteria
Hebrew test strings use `\uXXXX` escapes or `he.json` lookups, as the listings fixtures do.

- [ ] AC1 Given `/me/applications` answering five applications (`submitted` with a three-line message,
  `shortlisted`, `declined`, `withdrawn`, and a `source: 'like'` mutual), Then:
  - there are five `article`s in API order;
  - each `application-status` badge shows the seeker label, with the `accent` tone for shortlisted and `neutral` for
    submitted, declined and withdrawn (their classes);
  - the declined and withdrawn cards carry the `Card` muted variant (its class), and the others the default one;
  - only the shortlisted card has a link "לצ'אט עם בעלי הדירה" to `/chat/{id}`, `aria-describedby` its title;
  - the message keeps its line breaks (`whitespace-pre-line`) and renders as text;
  - the mutual card shows `application-mutual` and no `application-message`;
  - the title link has `min-h-tap` and `underline` (the existing assertion at
    `MyApplicationsPage.test.tsx:145`, updated from `min-h-[44px]`).

  — `web/src/features/applications/__tests__/MyApplicationsPage.test.tsx::ac1_cards_kit_layout`
- [ ] AC2 `/me/applications`:
  - empty shows `EmptyState` with a link "לחיפוש דירות" to `/search` inside it;
  - a withdraw answering 500 shows the card's alert;
  - the existing withdraw, 401 and focus tests pass unchanged.

  — `MyApplicationsPage.test.tsx::ac2_empty_action_and_errors`
- [ ] AC3 Given `/me/likes` with two `liked_me` rooms (one with `match` score 82) and one `mine` room, and
  `/me/profile` answering a profile with `birth_year`, Then:
  - both sections render as `region`s named by their `h2`;
  - each list is a `ul` with the grid classes (`grid-cols-1`, `md:grid-cols-2`, `xl:grid-cols-3`);
  - the scored card shows `MatchBadge` ("82") and the match chips;
  - a room whose flatmates are near the seeker's age shows "שותפים בגילך";
  - a room without `match` shows neither badge nor chips;
  - liking back still shows the mutual banner with "לצ'אט".

  — `web/src/features/likes/__tests__/MyLikesPage.test.tsx::ac3_grid_and_match`
- [ ] AC4 Brand pieces:
  - `MutualBanner` is a `role="status"` on `bg-accent-soft` whose text carries `text-accent-strong`, and its
    "לצ'אט" link is the primary (ink) `Button`, focused on mount;
  - `/me/applications` empty renders the `sleep` mascot;
  - `/me/likes` with both sections empty renders exactly one mascot (in "אהבו אותך"); with only "mine" empty, it
    is there;
  - no status badge on `/me/applications` uses the `solid` tone.

  — `MyLikesPage.test.tsx::ac4_banner_and_one_mascot`, `MyApplicationsPage.test.tsx::ac4_sleep_mascot_and_tones`
- [ ] AC5 E2E desktop and phone layout of the seeker lists, a `test.step('0009qa lists at 1440 and 390')` in
  `web/e2e/likes.spec.ts::ac9_seeker_likes_back_and_chats`, with no new sign-up:
  - **before liking back**, at 1440×900 on `/me/likes`:
    - the "אהבו אותך" region is at least 1200 px wide;
    - its card (`article` filtered by the street) is at most 460 px wide;
  - at 390×844:
    - the card is `clientWidth − 32` ± 2 px wide (358 without a scrollbar; `clientWidth` is
      `document.documentElement.clientWidth`, never a literal);
    - `scrollWidth <= clientWidth`;
  - **at the end of the test**, on `/me/applications`:
    - at 1440×900 the card is 720 ± 2 px wide and centred (its left offset and `clientWidth − right` within 2 px);
    - at 390×844 it is `clientWidth − 32` ± 2 px.
  - Widths and offsets come from `boundingBox()`. After each size check, `setViewportSize({ width: 1280, height:
    720 })` (Desktop Chrome's default, the project's) before the rest of the test.

  — `web/e2e/likes.spec.ts::ac9_seeker_likes_back_and_chats`
- [ ] AC6 Visual check. Screenshots at 390×844 and 1440×900 of every state below, captured on the final local
  head. The ux reviewer compares them with `Inbox.dc.html` / `InboxDesktop.dc.html` (cards, header, buttons) and
  `Search.dc.html` (the likes cards) for layout, and with `design/brand/README.md` for colour, type, shape and the
  mascot. The states:
  1. applications loading;
  2. applications error;
  3. applications empty;
  4. applications with AC1's five cards;
  5. applications with a withdraw error;
  6. likes loading;
  7. likes error;
  8. likes, both sections empty;
  9. likes with two "liked me" and four "mine" rooms (two with a match);
  10. likes with the mutual banner;
  11. likes with a room-section error on a card.

  **Capture:**
  - Use the repo's screenshot harness when it is on the branch (`0009i`, `0009k`, `0009l` and `0009p` all use
    `0009l`'s names).
  - If none is there, add `0009l`'s form:
    - `web/playwright.screens.config.ts` (`testDir: 'e2e/screens'`, `testMatch: '*.screens.ts'`, so `make e2e`
      never runs it; one project per size; base URL `http://localhost:5173`);
    - a `make screens` target with a `##` comment;
    - `web/screens/` in `.gitignore`.
  - This spec's file is `web/e2e/screens/seeker-lists.screens.ts`, with fixtures in
    `web/e2e/screens/fixtures-seeker.ts`.
  - Every API request is answered by `page.route`: seeker `/me`, `/me/applications`, `/me/likes`, `/me/profile`,
    an empty `/me/conversations`, and the event stream aborted. An unmatched API request fails the run, so it
    needs only the web on port 5173: no sign-up and no OTP.
  - Output: `web/screens/0009qa/NN-<state>-<width>.png`.

  — `web/e2e/screens/seeker-lists.screens.ts`, the PNGs listed in the digest
- [ ] AC7 Kit and tokens:
  - `grep -nE '\[[0-9.]+px\]|#[0-9A-Fa-f]{3,8}\b|window\.confirm'` over the in-scope files prints nothing beyond
    the exceptions table;
  - `0009h`'s `noColourLiterals` and `pageWidths` tests pass with §3's table;
  - no in-scope file defines a local button, card, badge, chip or input style;
  - no old token name is left in the in-scope files: `grep -nE 'accent-(tint|text)|\b(bg|text)-warn|border-line|bg-bg\b|surface-muted|ink-soft|shadow-|font-extrabold|Heebo'` prints nothing;

  The digest quotes the grep. — `web/src/app/__tests__/pageWidths.test.ts` (table updated), the grep in the digest
- [ ] NF1 `make lint`, `make test`, `make i18n-check`, `make build-web` and local `make e2e` are green on the final
  head (Speed rule 7). Check that port 5173 is free first. The e2e result and the screenshot folder go in the
  digest.

## Tests to write
- **Component** (vitest, the existing `fetch` stubs): AC1–AC4 in the files named.
- **Kit** (§0): `EmptyState.test.tsx::action_renders_after_message`, `Badge.test.tsx::passes_html_attributes`,
  `Tag.test.tsx::passes_html_attributes`, each only if this spec adds the prop.
- **E2E:** AC5 as a step in an existing test (0 new sign-ups).
- **Visual:** AC6.

## Risks / open questions
- **Ownership settled** (orchestrator, 2026-11-12): `0009j` restyles `LikeRoomButton`; this spec owns
  `MutualBanner` and places the button on `/me/likes`.
- **Same files as `0009c`, `0009t`, `0009g`, `0009i`, `0009j` and `0009l`.**
  - `MyApplicationsPage` and `MyLikesPage` are touched by others (focus, `<h1>` states,
    titles, the gone line).
  - `ApplicationStatusChip` is shared with `0009l` (owner branch).
  - `ListingCard` is read only.

  Web specs never build together (port 5173), so the second to merge rebases. Rule §0 keeps every behaviour
  line, so conflicts are class-level. If `0009i` has not landed, the likes grid shows today's `ListingCard`
  restyled by `0009h`, and the ux reviewer judges the grid, not the card.
- **FOLLOWUPS 183** (the match badge, chips and age chip on likes cards) is claimed here.
  - It adds no request beyond the seeker's profile, which search already loads.
  - It shows data `/me/likes` already returns (`ListingPublic.match`).
  - It is the one visible content addition in a "behaviour unchanged" slice: a ux minor from 0008c's review,
    consistent with search and with PRODUCT.md's room-privacy rule, since `/me/likes` is seeker-only.

  The orchestrator names it in the digest so Gilad sees it.
- **Muted ended cards.** The chip is `accent` for shortlisted and `neutral` otherwise (§1),
  and the ended card is also `muted`. That is a visual call the ux reviewer may push back on; the fallback keeps
  every card `default`, a one-line change.
- **Product questions for Gilad:** none. Every choice here is layout or visual. Behaviour, copy and API are
  unchanged.
- **Verifier round 1** (on the combined `0009q`): 22 findings, all applied, including the split into
  `0009qa` / `0009qb` (finding 1). Finding 4 (the `LikeRoomButton` owner) was settled by the orchestrator:
  `0009j`. Second round waived. The brand amendment was then applied as a spec edit (orchestrator,
  2026-11-12), without re-running the verifier.

## Digest (filled by orchestrator after verification)
See `/digest`.
