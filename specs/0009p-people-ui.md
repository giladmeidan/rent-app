---
id: 0009p
title: A room lister's "מחפשים חדר" page uses the inbox's card family — kit cards with the score ring in the corner, the reason chips, an "about me" box and one row of disclosures; one column on a phone, two on a desktop — with behaviour unchanged
status: in-progress
depends_on: [0009l]   # 0009l: MatchRing, ReasonList, RoomLine, DisclosureButton, Badge's attribute forwarding and the screenshot harness (it depends on 0009d + 0009h, the kit and the shell). Independent of 0009u (desktop inbox): different files
reviewers: [ux]   # quick route (Gilad 2026-11-12: a cosmetic, behaviour-unchanged spec gets one ux review; coder Sonnet/medium). The spec session also greps its diff for raw-HTML rendering (dangerouslySetInnerHTML / innerHTML / linkify) and runs lint, test and e2e. Was: reviewers: [code, qa, ux]
estimate: 1 coder run   # coder Sonnet/medium: a mechanical restyle onto 0009l's pieces plus FOLLOWUPS 169 / 171; the third part of the 0009l / 0009u / 0009p split
---

## Goal
After this ships, `/me/listings/:id/people` looks like the applicant inbox (`0009l`), which follows
`design/screens-v1/Inbox.dc.html`.

- **Mobile (390 px)**: full-width kit cards. Each has the avatar, the name with the "אהב/ה את החדר" badge, the
  score ring at the inline-end corner, the gender / age, areas and move-in lines, two reason chips, "קצת עליי" in
  a grey box, "למה ההתאמה?" and "עוד פרטים" in one row, and the like toggle.
- **Desktop (≥ 1024 px)**: the same cards in two columns inside the wide page container.

What the lister can do is unchanged: likes, unlikes, paging, the mutual banner, the page and inline alerts,
every state of `0008b`. This also removes the helpers `PersonCard` and `usePeople` copied from the inbox
(FOLLOWUPS 169) and the copied back link (FOLLOWUPS 171). It serves PRODUCT.md "People & likes" and is Slice 9b,
the third part of the `0009l` (inbox, phone) / `0009u` (inbox, desktop) / 0009p split. There is no artboard for this screen. The orchestrator's
brief: style it as the same card family as the applicant card.

## Scope
**In:**

1. **Page** (`features/people/PeoplePage.tsx`):
   - Every return path is `PageContainer width="wide"`. Update 0009h's
     `web/src/app/__tests__/pageWidths.test.ts` row for `PeoplePage.tsx` from `default` to `wide`.
   - Every return path has a `PageHeader`:
     - `back`: `{ to: '/me/listings', label: t('listings.edit.backToMine') }`. The local `Back` and the key
       `people.back` are deleted (FOLLOWUPS 171: the copy lacked the chevron, and the key duplicated
       `listings.edit.backToMine`);
     - `title`: `people.title` (unchanged `<h1>`), or `people.notFound` / `people.notLive` on those states.
       `Notice` becomes these `PageHeader`s;
     - `subtitle`: `cardTitle(t, listing)`, as today's bold line, once the listing is known.
   - The "my listings" pending and failed states also render the `PageHeader`, with `title={t('people.title')}`,
     the back link and no subtitle (the listing is unknown there). Under it go the skeleton or `ErrorState`.
     This is `0009c`'s AC4 rule (`<h1>` while loading and on error). If `0009c` is on the branch, keep its
     `components/Loading` wrapper.
   - The mutual banner (`role="status"`) and the page alert (`role="alert"`) stay always mounted, with the same
     focus and scroll effects. Their open look moves to tokens: `rounded-lg px-4 py-3 text-body font-semibold`,
     with `bg-accent-soft text-accent-strong` (mutual) / `border border-border bg-surface text-warning` plus the outline "!" `DifferIcon` (page alert; brand: `warning` always with words and an icon). Their links get the kit `focusRing`.
   - The empty state (`total` 0) is `EmptyState pose="search"` with `people.empty` (the brand's "no results" mascot pose; the people page is a search, not an inbox).
   - The count line (`people.count` / `people.countOne`, `text-caption text-ink-muted`) is unchanged.
   - The list is `<ul class="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:items-start lg:gap-3">`. `items-start`
     keeps an open disclosure from stretching its row partner. The order runs in RTL reading order: the first
     card at the inline start.
   - "טעינת עוד" is a kit `Button variant="secondary"`, centred (`self-center`), with today's `disabled` and
     `aria-busy`.
   - The loading skeletons follow the grid.

2. **Card** (`features/people/PersonCard.tsx`). It is the stacked inbox card (`0009l` item 4) with the
   person's content:
   - `<li>` → `Card as="article" aria-labelledby={headingId} padding="sm" radius="card"` (brand card: `rounded-lg`, padding 12, `border`, no shadow), with
     `flex flex-col gap-3`.
   - **Top row** `flex items-start gap-3`:
     - the neutral avatar (`size-12 bg-surface-subtle text-ink-muted`);
     - the text column:
       - the name row `<div data-testid="person-name-row" class="flex flex-wrap items-center gap-x-2 gap-y-1">`:
         `<h2>` (`text-h3`, `[overflow-wrap:anywhere]`) and, when `liked_me`,
         `<Badge tone="accent" data-testid="person-liked-me">` (`accent-soft`) with `people.likedMe`. The `data-testid` relies on
         `0009l`'s change that makes `Badge` forward attributes;
       - `<RoomLine gender age />` (from `0009l`);
       - the areas line and the move-in line + `applicants.flexible` (`text-caption text-ink-muted`). Each
         shows only when it shows today;
     - `MatchRing size="md" label` at the inline end, `flex-none`. It replaces `MatchBadge` in the name row.
   - **Chips**: `<MatchChips voice="person" match={person.match} person={person} />` (item 3). The chip classes
     go from `PersonCard`.
   - **About me** (when non-empty):
     - the label `people.aboutMe` (`text-label text-ink-muted`);
     - `<p data-testid="person-about" dir="auto">` in the inbox's message box, `rounded-md bg-surface-subtle
       px-3 py-3 text-body-sm text-ink whitespace-pre-line break-words`;
     - text children only, as today.
   - **Disclosures**: one `flex flex-col gap-2` wrapper. First, a `flex flex-wrap gap-x-4` row of two
     `DisclosureButton`s (from `0009l`), `applicants.why` and `people.moreDetails`, each with
     `aria-describedby={headingId}`. Then their panels, always in the DOM and `hidden` while closed:
     - the why panel: `<ReasonList lines={…}>` (from `0009l`), built from `personReason`;
     - the more panel: `RoomDetails`, as today.
   - **Like toggle**: a kit `Button size="md"` with `variant={person.liked_by_me ? 'tint' : 'primary'}` and today's
     `aria-pressed`, `aria-describedby`, label `people.like` and the `aria-hidden` "✓" when liked.
     - `busy={pending}` gives `aria-busy="true"` + `aria-disabled="true"` while the mutation runs, and the
       button stays focusable.
     - When idle the kit renders no `aria-disabled` at all; today the attribute is `"false"`. So
       `ac3_like_unlike`'s `expect(button()).toHaveAttribute('aria-disabled', 'false')` (line 216) becomes
       `expect(button()).not.toHaveAttribute('aria-disabled', 'true')`.
     - The inline error keeps `role="alert"` and its texts (or `0009f`'s, if merged), now `text-body-sm font-semibold
       text-danger`.
   - The local `Chevron`, `fieldError`, `disclosure`, `chip` / `agreeChip` / `differChip` constants go
     (FOLLOWUPS 169).

3. **Shared helpers** (FOLLOWUPS 169, closed here):
   - `features/match/MatchChips.tsx` gains a third prop shape `{ voice: 'person'; match: MatchOut; person:
     PersonOut }`, whose `short` calls `personShort(criterion, kind, person, t)`. Rendering stays as 0009i
     leaves it, and the owner and seeker shapes are unchanged.
   - `features/search/useSearch.ts` `flattenPages` becomes generic:
     `flattenPages<T extends { id: string }>(data: InfiniteData<{ items: T[] }>): T[]`. Its body and
     `ResultsList`'s call are unchanged. `usePeople.ts` drops `flattenPeople`, and `PeoplePage` imports
     `flattenPages`.

4. **`web/src/locales/he.json`**: delete `people.back`. There are no new keys.

5. **Screenshots**: `web/e2e/screens/people.screens.ts` in `0009l`'s harness (`make screens`), with the API
   mocked by `page.route`. It saves each state below at 390×844 and 1440×900 under `web/screens/0009p/`.

**Out:**
- A detail pane on the people page. Its cards are already complete (about me is at most 300 characters and the
  answers are behind "עוד פרטים"), so desktop is a 2-column grid of full cards. A pane would be a new
  interaction with no artboard.
- Filters or sort on the page (`0008a` Out).
- The fact-free "למה ההתאמה?" sentences: FOLLOWUPS 170 is `0009f`'s, which gives `personReason` its own key map.
  This spec renders whatever `personReason` returns.
- The wording of existing keys (`0009b`). Focus and axe (`0009c`).

**New dependencies:** none.

## Data
None.

## API
None. The page uses `GET /listings/{id}/people`, the like `PUT` / `DELETE` and `GET /me/listings` as today.

## UI
No artboard. The card family is the stacked inbox card of `0009l` (Inbox.dc.html). The table maps each inbox
card element to its people counterpart:

| Inbox card (0009l) | Person card (0009p) |
| --- | --- |
| avatar, neutral | the same |
| `<h2>` + status `Badge` + mutual `Badge` | `<h2>` + "אהב/ה את החדר" `Badge tone="accent"` (`accent-soft`; the brand has no amber) |
| applied-at, `RoomLine`, household · move-in | `RoomLine`, "אזורים: …", "כניסה מ־…" (+ "(גמיש)") |
| `MatchRing md` + label, end column | the same |
| `MatchChips voice="owner"` | `MatchChips voice="person"` (fact-free texts, unchanged) |
| message in the grey box | "קצת עליי" label + the grey box |
| disclosure row (why, more) | the same row (why, "עוד פרטים") |
| action row (shortlist / decline / chat) | the like toggle (`primary` → `tint` when liked) |

**Mobile (< 1024 px, checked at 390×844):** `PageHeader` (back, "מחפשים חדר", the room's title), the banner and
alert slots, the count, one column of cards, then "טעינת עוד". The page is not horizontally scrollable.
**Desktop (≥ 1024 px, checked at 1440×900):** the same in the wide container, with the cards in two columns
(`lg:grid-cols-2`, about 650 px each at 1440). This is designed in the inbox's visual language, as there is no
artboard.

**States** (each a screenshot at both sizes): `loading` · `error` · `not-found` · `not-live` · `empty` ·
`list` (three people: one who liked the room with a 300-character about-me, one already liked by the lister,
one with no age and no about-me; `total` 25, so "טעינת עוד" shows) · `disclosures-open` (both panels open on
one card) · `mutual-banner` · `page-alert` (`already_applied`, with the link) · `inline-error` (a 429 on one
card).

RTL: logical properties only. The ring is at the inline end, and `person-about` keeps `dir="auto"`. Every
control is at least 44 px.

## Acceptance criteria
- [ ] AC1 Card. Given `P1` (liked the room, age 27, about-me) and `P2` (age null), each card shows:
  - a `match-ring` that is not inside `person-name-row`;
  - `person-liked-me` "אהב/ה את החדר" inside `person-name-row` (P1 only);
  - "אישה · גיל 27" / "גבר";
  - the areas and move-in lines;
  - the `match-chips` with the same texts as today (`match.owner.short.budget.agree` among them);
  - `person-about` with `dir="auto"`, `whitespace-pre-line` and `break-words`;
  - "למה ההתאמה?" and "עוד פרטים" as siblings in one row, each opening its own panel.

  No card shows a smoking, pets, household, contract or parking fact.
  — `web/src/features/people/__tests__/PeoplePage.test.tsx::ac1_cards` (updated: `match-badge` →
  `match-ring`, plus the row and ring placement)
- [ ] AC2 Page frame.
  - Every state's back link is named `listings.edit.backToMine`, with `href="/me/listings"`.
  - The `<h1>` is `people.title`, including while "my listings" is pending and when it fails, or else the
    not-found / not-live text.
  - The room's `cardTitle` is the subtitle once the listing is known.
  - The key `people.back` is gone from `he.json`, and `grep -rn "people.back" web/src web/e2e` finds nothing.
  - `pageWidths.test.ts` maps `PeoplePage.tsx` to `wide`.

  — `PeoplePage.test.tsx::ac6_page_states` (its back-link name updated; it gains the "my listings" pending and
  failed `<h1>`), `web/src/app/__tests__/pageWidths.test.ts::ac4_page_roots_use_page_container` (the row
  updated)
- [ ] AC3 Behaviour unchanged.
  - Like / unlike toggles `aria-pressed`. The button stays focusable with `aria-busy="true"` and
    `aria-disabled="true"` while it runs, and has no `aria-disabled="true"` after it.
  - Load more dedups.
  - The mutual banner survives the refetch.
  - The page and inline alerts are as `0008b`.

  — `PeoplePage.test.tsx::ac2_load_more_dedup`, `::ac4_mutual_banner` and `::ac5_like_errors` pass unchanged;
  `::ac3_like_unlike` passes with its line-216 `aria-disabled` assertion changed as in Scope 2
- [ ] AC4 Helpers shared (FOLLOWUPS 169):
  - `PersonCard.tsx` defines no `Chevron`, no `RoomLine` and no chip class constants;
  - `usePeople.ts` has no `flattenPeople`;
  - `MatchChips` with `voice="person"` renders `personShort`'s texts;
  - `flattenPages` serves both search and people (search's `ResultsList` tests pass unchanged).

  — `web/src/features/match/__tests__/MatchChips.test.tsx::ac4_person_voice` (a new file: there is no
  `MatchChips` test today), plus `grep -nE "function (Chevron|RoomLine)|agreeChip|flattenPeople"
  web/src/features/people` finding nothing (quoted in the digest)
- [ ] AC5 Visual check. `make screens` writes the ten states at 390×844 and 1440×900 under `web/screens/0009p/`.
  The ux reviewer compares them with the inbox's screenshots from `0009l` and with `Inbox.dc.html`'s card. The
  digest gives the PNG count and the verdict. — `web/e2e/screens/people.screens.ts` (measurement)
- [ ] AC6 E2E, desktop (no new sign-up). In `web/e2e/people.spec.ts::ac10_owner_likes_back_and_chats`, call
  `page.setViewportSize({ width: 1440, height: 900 })` before `page.goto('/me/listings')`. The rest runs
  unchanged at 1440, and one more check is added: the seeker's card's "למה ההתאמה?" opens its panel
  (`aria-expanded="true"`). The suite's other tests keep the default 1280×720. — `web/e2e/people.spec.ts::ac10_owner_likes_back_and_chats`
- [ ] AC7 Tokens only. `grep -nE '#[0-9A-Fa-f]{3,8}\b|\[[0-9.]+px\]' web/src/features/people` finds nothing except
  `[overflow-wrap:anywhere]` on the `<h2>`, which has a code comment giving its reason. — the build digest
  quotes the grep
- [ ] NF1 `make lint`, `make test`, `make i18n-check`, `make build-web` and local `make e2e` are green on the
  final head (Speed rule 7). The e2e result goes in the digest.

## Tests to write
- Component: update `PeoplePage.test.tsx`:
  - `match-badge` → `match-ring`;
  - the back-link name;
  - the ring and `person-name-row` placement in `ac1`;
  - line 216's `aria-disabled`;
  - the "my listings" pending and failed `<h1>` in `ac6`.

  Add the new `MatchChips.test.tsx::ac4_person_voice`. Update the `pageWidths.test.ts` row.
  `RequireOwner.test.tsx`'s people title is unchanged.
- E2E: the viewport line and one disclosure check in `people.spec.ts`. No new sign-up.
- Screens: `e2e/screens/people.screens.ts`.

## Risks / open questions
- `0009l` must be merged, or open as a PR to branch from, because its five shared pieces are imported here. If
  `0009l` renames one, follow it.
- `MatchChips.tsx` is 0009i's file to restyle. This spec adds one prop shape only, and the second to merge
  rebases.
- `0009f` also edits `PersonCard.tsx` (`personReason`'s sentences, FOLLOWUPS 170) and
  `PeoplePage.test.tsx::ac1_cards`'s "למה ההתאמה?" assertions. `0009c` adds the loading `<h1>`. The second to
  merge rebases.
- **Security waiver.** Requested from the orchestrator: `about_me` keeps today's rendering exactly, and only its
  classes change. If the orchestrator declines, add `security` with that one-line brief.
- `useSearch.ts` (search) gets a type-only change, so its tests are the check.
- No artboard: the ux reviewer judges the card against `0009l`'s inbox card. This was the orchestrator's
  instruction, so there is no product question.
- FOLLOWUPS claimed (line numbers as of `8c3c480`): **169** (closed here; `0009l` did the extraction half) and
  **171**.
- Verifier round 1: 3 majors and 5 minors, all applied (the `aria-disabled` assertion, the `pageWidths` row,
  qa added and a security waiver requested, `person-name-row`, the named `MatchChips` test, the "my listings"
  `<h1>`, FOLLOWUPS 170 to `0009f`, Badge forwarding from `0009l`). Second round waived (one verifier round,
  Gilad).

Brand amendment (orchestrator, 2026-11-12, `specs/0009-brand-amendment.md`) applied as a spec edit without a verifier re-run: brand token names, accent ring and selected states, `warning` with words or an icon, bordered cards with no shadow, the mascot on empty states, and new copy in the brand voice.

## Digest (filled by orchestrator after verification)
See `/digest`.

Spec 0009p — the room lister's "מחפשים חדר" page in the inbox card family   PR open, not merged
Shipped: `/me/listings/:id/people` is a `wide` page with a `PageHeader` (chevron back link `listings.edit.backToMine`, "מחפשים חדר", the room's title) in every state, including while "my listings" loads or fails. Each person is a bordered kit card with the avatar, the name and "אהב/ה את החדר" `Badge`, `RoomLine`, the areas and move-in lines, a `MatchRing md` at the inline end, `MatchChips voice="person"` (neutral `people.short.*`, no budget amount), "קצת עליי" in the grey box (text children, `dir="auto"`), the why / "עוד פרטים" disclosures in one row and the like toggle (`primary` → `soft` + ✓). One column on a phone, two on a desktop (`lg:items-start`). Likes, paging, the banner and the alerts are unchanged. Demo: open a live room's people page at 390 and 1440 → open both disclosures on a card → like a person who liked the room (mutual banner).
Tests: +1 unit (`MatchChips.test.tsx::ac4_person_voice`, new file); `PeoplePage.test.tsx` ac1 (ring outside `person-name-row`, disclosures as siblings) and ac6 (back-link name, pending and failed `<h1>`) extended, plus the one `aria-disabled` line in ac3; `pageWidths` row → `wide`. E2E: `people.spec.ts::ac10` runs at 1440×900 and opens "למה ההתאמה?" (no new sign-up). 20 screenshots in `web/screens/0009p/` (10 states × 390 / 1440, AC5).
Findings (ux only, quick route; one round): 0 blockers, 0 majors, 2 minors, 2 nits. Fixed: the closed banner and alert slots added two 16 px gaps under the subtitle, so closed they are now `sr-only` (still live regions, as on MyLikesPage). No change: "the '!' sits at the inline end" was a misread, because the screenshot shows it at the inline start. Nits dropped.
Spec text vs main: like toggle `soft` (the brand renamed `tint`); `Card` has no `radius` prop (always `rounded-lg`); `PersonCard` keeps its `<li>` around `Card as="article"`; the page alert's "!" is an inline icon in running text.
AC4 grep `function (Chevron|RoomLine)|agreeChip|flattenPeople` over `features/people`: nothing. AC7 hex / `[Npx]` grep: nothing (`[overflow-wrap:anywhere]` is commented). `people.back`: gone from `he.json`, the grep finds nothing. Raw-HTML grep (`dangerouslySetInnerHTML|innerHTML|linkify`) over the diff: nothing.
Checks on the final head (main at 0009k + 0009m merged): make lint / test (api 476, web 522) / i18n-check / build-web green. Local `people.spec.ts` 1/1 green. The full `make e2e` is left to CI (load ~21–25). `make screens` 125/126: `seeker-lists.screens.ts › 11-likes-card-error [mobile]` (0009qa/qb's file, untouched here) fails a strict `getByRole('alert')`, because MyLikesPage's always-mounted `sr-only` alert also matches. FOLLOWUPS 169 and 171 closed. Changed in PRODUCT.md: nothing.
