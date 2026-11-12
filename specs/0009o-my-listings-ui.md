---
id: 0009o
title: "My listings" shows the owner's cards in a responsive grid, each with its status, its expiry date and its actions on the 0009d kit, in the Inbox artboards' language, with every behaviour unchanged
status: in-progress
depends_on: [0009h]   # 0009h (which depends on 0009d): Button, Badge, PageContainer, PageHeader, the restyled Skeleton / EmptyState / ErrorState, the page-width table and the colour swap. Independent of 0009k: the second to merge rebases listings.spec.ts, he.json, pageWidths.test.ts and ListingWizard.test.tsx
reviewers: [ux]   # quick route (Gilad 2026-11-12: a cosmetic, behaviour-unchanged spec gets one ux review; coder Sonnet/medium). The spec session also greps its diff for raw-HTML rendering (dangerouslySetInnerHTML / innerHTML / linkify) and runs lint, test and e2e. Was: reviewers: [code, qa, ux]
estimate: 1 coder run   # coder Sonnet/medium: one page, one small component, mechanical; split from 0009k by its verifier
---

> **Brand kit amendment (orchestrator, 2026-11-12, no verifier re-run):** `design/brand/` (README.md, tokens.json) wins over the artboards and over any older wording below for colour, type (Fredoka for display/h1/h2, Rubik for the rest), radii, no card shadows, the name homie / הומי, the mascot and the voice (no slash forms: plural, infinitive or noun; action-noun buttons; errors say "what happened. what to do."). Token and kit names are those of 0009d. Where this spec still names a teal token, Heebo or a slash form, the builder applies the brand equivalent.

## Goal
After this ships, an owner's "my listings" (`/me/listings`) has the page header of `InboxDesktop.dc.html` (h1, the
"N מתוך 3 מודעות פעילות" line, the "מודעה חדשה" button), and its cards sit one per row on a phone, two from 768 px
and three from 1280 px. Each card is `ListingCard` (the search card, 0009i's) with the owner's block in the
language of `Inbox.dc.html`'s applicant card: a status pill in the price row, the expiry date, small manage buttons
(pause / resume, edit) and a row of link buttons (applicants, people, flatmates) carrying their amber badges. Nothing
a user can do changes: the same controls under the same conditions, the same requests and errors. A failed
background refetch no longer replaces a loaded list with an error (FOLLOWUPS 84).

This serves the owner's "my listings" in the Product Plan, PRODUCT.md "Listings" and "Listing edit". It is Slice 9b
(real UI/UX styling, Gilad 2026-11-12), split from `0009k` (the wizard) by the verifier. There is no artboard for this
screen; it is designed here in the Inbox / InboxDesktop artboards' language.

**Brand (orchestrator's brand amendment, 2026-11-12, `specs/0009-brand-amendment.md`).** `design/brand/` overrides
the artboards' colours, type, shape and voice; they keep layout and anatomy. So: brand token names only (`surface`,
`ink`, `ink-muted`, `accent`, `accent-strong`, `accent-soft`, `border`, `border-strong`, `warning`, `danger`); cards
have a `border` and no shadow (`rounded-lg`); the primary `Button` is `ink` with `on-ink`; Rubik text tokens
(`text-body-sm`, `text-caption`, `text-label`), Fredoka only for the h1; brand spacing (cards `gap-3`). Two mascot
moments: after a publish, `Mascot pose="celebrate"` with `listings.mine.published` (the wizard, 0009k, navigates here
with `state: { published: true }`; the line uses the saved line's mechanism, once, `role="status"`, inside a bordered
`Card` with the 96 px mascot at the inline start, decorative); the empty list is `EmptyState pose="sleep"` with
`listings.mine.empty` and the action `Button variant="secondary" to="/listings/new"` `listings.mine.emptyAction`.
One turtle per screen (the two never show together). Status pills: live → `Badge tone="accent"`, paused →
`neutral`, expired → a new additive `Badge tone="warning"` (`border border-warning bg-surface text-warning`, the
label is the words; one case in `Badge.test.tsx`) in place of the amber `new` tone below. The saved notice is
`rounded-md bg-accent-soft text-accent-strong`. Wherever this spec below says `line`, `muted`, `accent-soft`,
`accent-strong`, `rounded-xl`, `text-sm`, `font-semibold` or `bg-warn`, the brand name above wins. New keys:
`listings.mine.published` "המודעה באוויר! מועמדויות חדשות יופיעו כאן." and `listings.mine.emptyAction` "פרסום דירה".
New ACs: `MyListingsPage.test.tsx::ac7_published_celebrates` (state `published` → the line and one celebrate mascot;
not on a plain visit) and `::ac8_empty_sleeps` (empty → the sleep mascot and the action to `/listings/new`); the
badge-class assertions (`:223`, `:269`) follow the kit's `new` tone classes. Screens add state 7 "after a publish".
Applied as a spec edit without a second verifier round.

## Scope
**In:**
- `web/src/features/listings/MyListingsPage.tsx`: the page, the grid, the owner block in each card, the states, and
  the FOLLOWUPS 84 guard.
- `web/src/features/listings/StatusBadge.tsx`: on the kit `Badge`.
- `web/src/app/__tests__/pageWidths.test.ts` (0009h's): `/me/listings` becomes `wide`.
- `web/src/locales/he.json`: two new keys (UI). Existing keys keep their wording (0009b owns it).
- Tests: the new cases per AC and the assertion updates listed under "Tests to write", including
  `ListingWizard.test.tsx:185` (it reads the my-listings card after a publish).
- `web/e2e/listings.spec.ts`: one new `test.step` inside `ac12_owner_edits_listing` (no new sign-up).
- Screens: `web/e2e/screens/my-listings.screens.ts` and `web/e2e/screens/fixtures-my-listings.ts`, in 0009l's harness.
  If the harness is not on this spec's base when it builds, also `web/playwright.screens.config.ts`, the Makefile
  target `screens` and `web/screens/` in `.gitignore`, exactly as `0009l-inbox-ui.md` (UI § 9) describes them.

**Out:**
- `ListingCard.tsx`: 0009i restyles it. This spec consumes it as `main` has it (`badge`, `titleId`, `children`) and
  does not fork it.
- The wizard, the edit page and `BackToMine`: 0009k.
- The colour swap in these files and FOLLOWUPS 34: 0009h.
- Kept as found, not added here (the second to merge rebases):
  - 0009c: the `Loading` wrapper for the loading list, `usePageTitle`, the ink focus ring on the primary button;
  - 0009t: the "השינויים נשמרו" mechanism (FOLLOWUPS 52: read once, cleared from history, an always-mounted
    `role="status"`);
  - 0009b: the plural families that may replace `listings.mine.peopleLikedOne` and the `=== 1 ? … : …` branch, and
    `applicants.newBadge`'s calls. This spec keeps the `peopleLiked` / `applicants.newBadge` calls as it finds them.
- FOLLOWUPS 64 (resume on a paused listing past expiry): Slice 10's renewal.

**New dependencies:** none.

## Data
None (web only).

## API
None. The page calls `GET /me/listings` and `PATCH /listings/{id}` (`{status}`) as today.

## UI
No artboard. Rules: 0009d tokens and kit components only, logical properties only (in RTL the inline start is the
right edge), no arbitrary value. Every accessible name, role, test id and DOM order that tests and e2e use stays: one
`<article>` per card (`ListingCard`'s), `data-testid="status-badge"`, the buttons `listings.actions.pause` /
`resume`, the links `listings.actions.edit`, `applicants.link`, `listings.mine.people`, `listings.mine.flatmates`,
each with `aria-describedby={titleId}`, and the controls' order pause / resume, edit, applicants, people, flatmates.
Busy buttons keep today's `disabled` + `aria-busy` (both passed to `Button`, not its `busy` prop).

### Page
- `<PageContainer width="wide" as="section" className="flex flex-col gap-4">`.
- `PageHeader` with `title` `listings.mine.title`; `subtitle` `listings.mine.count` (`{ live, cap }`) once the list
  has loaded; `actions` a `Button` (`variant="primary"`, `to="/listings/new"`) `listings.mine.new`.
- The saved line under the header, its `role="status"` element as found (0009t's mechanism if on `main`, today's
  otherwise). While it holds text it has the notice classes `rounded-xl bg-accent-soft px-4 py-3 text-sm
  font-semibold text-accent-strong`; while it is empty it has none (an always-mounted empty line draws nothing).
- The list `<ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">`, one `<li>` per listing in API
  order. InboxDesktop.dc.html draws two columns of ~466 px cards beside a detail pane; with no pane here, the
  1336 px `wide` container holds three cards of about that width from 1280 px (`xl`), and two from 768 px (`md`).

### Each card
`ListingCard` with `listing`, `today`, `titleId`, `badge={<StatusBadge state={state} />}` and, as `children`, the
owner block `<div className="flex flex-col gap-3 pt-1">`:
1. The expiry line `<p className="text-caption text-muted">`: `listings.mine.expiresOn` "בתוקף עד {{date}}" before
   expiry (`expires_at > now`), `listings.mine.expiredOn` "פג תוקף ב־{{date}}" past expiry, whatever the status
   (`isPastExpiry`), with `date = formatDate(todayInIsrael(new Date(listing.expires_at)))` (Q2).
2. The manage row `<div className="flex flex-wrap gap-2">`, shown only when it has a control:
   - pause / resume: `Button variant="ghost" size="sm"`, today's conditions (`live` → pause, `paused` → resume,
     expired → none), `disabled={patch.isPending}`, `aria-busy={patch.isPending}`;
   - edit: `Button variant="ghost" size="sm" to={`/me/listings/${id}/edit`}`, only before expiry.
3. The link row `<div className="flex flex-wrap gap-2 border-t border-border pt-3">`, each a `Button
   variant="secondary" size="sm"` with `to`:
   - applicants (every card): `applicants.link` (`{ count }`), and when `new_applicant_count > 0` a `{' '}` text node
     then `<Badge tone="new">` with `applicants.newBadge` (no `srLabel`, so the link's name carries the badge text,
     with the space);
   - people (a live room only): `listings.mine.people`, and when `liked_me_count > 0` a `{' '}` then `<Badge
     tone="new">` with the liked text as found (`peopleLiked` / `peopleLikedOne` or 0009b's family);
   - flatmates (every room): `listings.mine.flatmates` (`{ count: flatmate_count }`).
4. The row error `<p role="alert" className="text-sm font-semibold text-danger">`: `listings.errors.capReached`
   (`{ cap }`) on a 409, else `common.error`, as today.

`StatusBadge`: `<Badge tone=…>` with live → `accent`, paused → `neutral`, expired → `new` (the amber tone: today's
colours), with `data-testid="status-badge"` on the element that holds the label (a wrapping `<span>` if `Badge`
does not pass the attribute through). `listingState` and `isPastExpiry` stay as they are.

### States
- Loading: three `Skeleton`s (the default card-shaped block) as `<li>`s of the grid list, `aria-busy` as today (0009c
  replaces the wrapper with `Loading` if it is on `main`).
- Error: `ErrorState` with retry **only when there is no data**: the branch becomes `listings.isError &&
  listings.data === undefined` (after `isPending`), so a failed background refetch keeps the cached cards
  (FOLLOWUPS 84; inbox actions invalidate this list).
- Empty: `EmptyState` with `listings.mine.empty`. The header's "מודעה חדשה" is the action.
- Success: the grid.
At 390 px everything is one column inside the 16 px gutters; the link row wraps.

### i18n keys added
| Key | Hebrew |
| --- | --- |
| `listings.mine.expiresOn` | "בתוקף עד {{date}}" |
| `listings.mine.expiredOn` | "פג תוקף ב־{{date}}" |

## Acceptance criteria
Hebrew test inputs use `\uXXXX` escapes, as the listings fixtures do.
- [ ] AC1 Given `/me/listings` with a live apartment (12 applicants, 5 new, expiring in 30 days), a paused apartment
  before expiry, an expired apartment, a live room (`liked_me_count` 2, `flatmate_count` 1) and a paused room past
  expiry, Then each `<article>` shows its status badge (`פעילה` / `מושהית` / `פג תוקף`) and "בתוקף עד …" (the live and
  the paused-before-expiry cards) or "פג תוקף ב־…" (the expired and the paused-past-expiry cards) with the Israel day
  of `expires_at`; the controls appear in the order pause / resume, edit, applicants, people, flatmates, as each state
  allows today; each badge is inside its link; the header's "מודעה חדשה" links to `/listings/new`. —
  `web/src/features/listings/__tests__/MyListingsPage.test.tsx::ac1_owner_block`
- [ ] AC2 Given a loaded list, When a background refetch answers 500, Then the cards stay and no `ErrorState` shows;
  with no data a failure still shows `ErrorState` with a working retry (FOLLOWUPS 84). —
  `MyListingsPage.test.tsx::ac2_cached_list_survives_failed_refetch`
- [ ] AC3 Every existing `MyListingsPage` test passes with only the assertion updates under "Tests to write": the
  states, pause / resume with the cap error, the edit link only before expiry, the applicants / people / flatmates
  links and their names. — `MyListingsPage.test.tsx`, `ListingWizard.test.tsx::ac4_preview_then_publish_navigates`
- [ ] AC4 E2E. The existing e2e passes unchanged (`listings.spec.ts`, and the my-listings steps of `inbox.spec.ts`,
  `people.spec.ts`, `flatmates.spec.ts`). A new `test.step('0009o my listings at 1440 and 390')` at the end of
  `ac12_owner_edits_listing` (the same owner, who holds the apartment and the room by then): at 1440×900 the two
  articles share a top edge (±2 px) and differ in x; at 390×844 the second article's top is below the first's bottom.
  The test calls `test.slow()`. No new sign-up. — `web/e2e/listings.spec.ts::ac12_owner_edits_listing`
- [ ] AC5 Arbitrary values. `grep -noE '[a-z0-9:-]*[a-z0-9]-\[[^] ]+\]' MyListingsPage.tsx StatusBadge.tsx` prints
  nothing; the digest quotes it. (Colour literals are 0009h's `noColourLiterals` guard.)
- [ ] AC6 Screens. `make screens` writes 12 PNGs under `web/screens/0009o/` (6 states × `mobile` 390×844 and `desktop`
  1440×900), listed in the digest; the API is answered by `page.route` from `web/e2e/screens/fixtures-my-listings.ts`
  (owner `/me`, `/me/listings`, the PATCH replies, an empty `/me/conversations`, the event stream aborted); an
  unmatched API request fails the run. No sign-up, no OTP. States: 1 loading · 2 error · 3 empty · 4 the five cards
  of AC1 · 5 the saved line · 6 a card's cap error after "הפעלה מחדש". — `web/e2e/screens/my-listings.screens.ts`
- [ ] NF1 `make lint`, `make test`, `make i18n-check`, `make build-web` and local `make e2e` are green on the final
  head (Speed rule 7); the e2e result and the screens folder go in the digest. Port 5173 is checked free first.

**Review checks** (the ux reviewer, not a test): states 4–6 at 390 and 1440 against Inbox.dc.html's card (pill in the
title row, small buttons in rows) and InboxDesktop.dc.html's page header and grid; 768 px once (two columns).

## Tests to write
Component tests use `mockApi` (`vi.stubGlobal('fetch', …)`) as today.
- New: `MyListingsPage.test.tsx::ac1_owner_block`, `::ac2_cached_list_survives_failed_refetch`.
- Assertion updates only (the behaviour asserted stays):
  - `MyListingsPage.test.tsx` `toHaveClass('min-h-[44px]')` (`:231`, `:312`) → `toHaveClass('min-h-tap')`;
  - `MyListingsPage.test.tsx:228`, `:275` and `ListingWizard.test.tsx:185` `link.querySelector('span')` ("no
    badge") → `within(link).queryByText(<the badge text>)` is null, since a kit `Button` may wrap its label in a span;
  - `toHaveClass('bg-warn', 'text-warning')` on the badges (`:223`, `:269`) holds as is (`Badge tone="new"`);
  - the accessible names with the space before the badge (`:224-226`) hold as is (the `{' '}` stays).
E2E: the AC4 step. Screens: AC6.

## Risks / open questions
**Question for Gilad** (the spec is written on the recommendation, marked "accepted by Gilad 2026-11-12"):
- **Q2 Show the expiry date on the "my listings" cards?** It is not shown today; a listing expires 90 days after it
  is created. (a) "בתוקף עד {date}" / "פג תוקף ב־{date}" (**recommended; accepted by Gilad 2026-11-12**: owners see when the 90 days
  end, and an expired listing says when it expired). It does not change FOLLOWUPS 64: a paused listing past expiry
  still shows "הפעלה מחדש", now next to its "פג תוקף ב־" date. (b) No date until Slice 10's renewal designs it.

**Other risks**
- `ListingCard` keeps its photo block, so each card is tall at 390 px; its placeholder is 0009i's (FOLLOWUPS 45).
  If 0009i lands after this spec, the screens show today's card with the new owner block.
- Shared files (the second to merge rebases, Speed rule 3): `MyListingsPage.tsx` with 0009c / 0009t / 0009b (see
  Out); `listings.spec.ts`, `he.json`, `pageWidths.test.ts` and `ListingWizard.test.tsx` with 0009k.
- `ac12_owner_edits_listing` grows by one more step; `test.slow()` (also added by 0009k) covers it.
- Verifier round 1 ran on the combined 0009k draft; this spec is its split-off half (finding 1) and carries the
  findings that concern "my listings", all applied: FOLLOWUPS 84 claimed here (finding 9), the `{' '}` before the
  badges, one grid rule (2 → 3 columns, with its reason) and the notice classes only while the line has text
  (finding 15), Q2's rationale reworded (finding 19), the `md` columns (finding 3), the arbitrary-value grep
  (finding 7), and the 0009t / 0009b references (finding 10). Second round waived (one verifier round, Gilad).

FOLLOWUPS claimed (line numbers as of 8c3c480): 84. Line 34 is 0009h's; 52 is 0009t's; 64 stays for Slice 10.

## Digest (filled by orchestrator after verification)
See `/digest`.
