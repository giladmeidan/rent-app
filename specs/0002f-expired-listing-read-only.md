---
id: 0002f
title: An owner can no longer edit an expired listing — its card has no edit link, and the edit URL explains that renewal comes later
status: in-review
depends_on: []           # 0002e is merged (9023687)
reviewers: [code, qa]    # small change on an existing screen and route; no ux: no new layout, one message block reusing EmptyState; no security: no API change
estimate: 1 coder run (small)
---

## Goal
After this ships, an expired listing is read-only in the web, as Gilad decided on 2026-11-10 (PRODUCT.md
"Listing edit": "an expired listing is not editable … until Slice 10's renewal"). This reverses 0002e's Q1
default (a), which let an expired listing be edited with a hint.

## Scope
**Rule:** a listing is *past expiry* when `new Date(listing.expires_at) <= now`, whatever its `status`. That covers
`listingState === 'expired'` and a paused listing past its expiry (which `listingState` reports as `paused`; it can
never go live again without Slice 10's renewal). Export one helper `isPastExpiry(listing, now)` next to
`listingState` in `web/src/features/listings/StatusBadge.tsx` and use it in both places below.

**In:**
- `web/src/features/listings/MyListingsPage.tsx` (`ListingRow`, where the edit link is rendered): the edit link
  (`listings.actions.edit`) renders only when `!isPastExpiry(listing, now)`. Everything else on the card is
  unchanged (badge, pause/resume as 0002b defines it, the edit link's `aria-describedby` on editable cards).
  Update the stale comment at `MyListingsPage.tsx:27` to match.
- `web/src/features/listings/EditListingPage.tsx`: when the listing found in `['me','listings']` is past expiry,
  render no wizard and send no PATCH. Render an inline section, built like the existing not-found branch (not
  `EmptyState`, which only takes `{ message }`): an `<h1 tabIndex={-1}>` with `listings.edit.expiredTitle`, a
  `<p>` with `listings.edit.expiredBody`, and the existing `BackToMine` link. A `useEffect` focuses that `<h1>`
  on mount. (The not-found branch keeps its current behaviour; adding focus to it is not required.)
- Remove the 0002e expired hint: the `listings.edit.expiredHint` key, its `<p>` in `ListingWizard.tsx`, and the
  `expired` / `listingState` code that only fed it (`ListingWizard.tsx` ~line 155), so lint stays clean.
- `web/src/locales/he.json`: add the two keys below; remove `listings.edit.expiredHint`.
- `specs/PRODUCT.md` is already updated (row "Listing edit").

**Out:** an API rule that rejects field edits on a past-expiry listing (the API still allows PATCH; with no UI
path that is acceptable until Slice 10 renewal; the build logs it in FOLLOWUPS); renewal (Slice 10); any change
to pause/resume.
**New dependencies:** none.

## Data
None.

## API
No change.

## UI
- `/me/listings`: past-expiry cards lose the edit link; nothing else on the card changes.
- `/me/listings/:id/edit` for a past-expiry listing: the inline section above, RTL as the not-found branch.
- Not-found, live and paused-before-expiry behaviour of the edit page is unchanged.

| Key | Hebrew (placeholder copy, Slice 9 owns wording) |
| --- | --- |
| `listings.edit.expiredTitle` | `לא ניתן לערוך מודעה שפג תוקפה` |
| `listings.edit.expiredBody` | `חידוש מודעות יגיע בקרוב. בינתיים אפשר לפרסם מודעה חדשה.` |

## Acceptance criteria
- [ ] AC1 Given four listings (live; paused before expiry; active past expiry; paused past expiry) on
  `/me/listings`, Then the live and the paused-before-expiry cards each have the edit link with its
  `aria-describedby` naming the card title, and the two past-expiry cards have no element named
  `listings.actions.edit`; the existing assertions of the old test stay (pause/resume buttons and their
  descriptions as today; `state: { saved: true }` shows `role="status"` `listings.edit.saved`, without it no
  status) — `web/src/features/listings/__tests__/MyListingsPage.test.tsx`: rename
  `ac10_edit_link_on_every_card` to `ac1_edit_link_only_before_expiry` and extend it
- [ ] AC2 Given listing A active with `expires_at` in the past, When the owner opens `/me/listings/A/edit` with
  the mock serving only `GET /me` (owner), `GET /me/listings` and `GET /areas`, Then the `<h1>` with
  `listings.edit.expiredTitle` has focus (`toHaveFocus()`), `listings.edit.expiredBody` and a link to
  `/me/listings` are shown, no `textbox` / `combobox` / `spinbutton` is rendered, and the PATCH handler's call
  count is 0 — `web/src/features/listings/__tests__/EditListingPage.test.tsx::ac2_past_expiry_listing_is_read_only`
  (replaces `ac8_expired_listing_editable_with_hint`); the same test also covers a paused listing past expiry
- [ ] AC3 Given a live listing and a paused listing before expiry, Then the edit page shows the wizard as before
  and no expired section — same file, `ac3_live_and_paused_before_expiry_still_editable`
- [ ] NF1 `make lint`, `make test`, `make i18n-check` clean; all other 0002e tests and the `listings` e2e pass
  unchanged

## Tests to write
Unit: AC1–AC3 (edits to existing 0002e test files). E2E: none new (no e2e helper can expire a listing; the
existing `listings` e2e must stay green).

## Risks / open questions
- A listing that expires while its edit page is open can still be saved once (the API allows it). Harmless
  (it stays hidden); the API rule is logged as a follow-up for Slice 10.

## Digest (filled by orchestrator after verification)
See `/digest`.

## Verifier findings — one round, 6 findings, all applied
1. Inline section with `BackToMine` instead of `EmptyState`. 2. `<h1 tabIndex={-1}>` + focus effect, AC2 asserts
`toHaveFocus()`. 3. AC1 keeps the old saved-status and pause/resume assertions. 4. Paused-past-expiry covered:
rule is `expires_at <= now` via `isPastExpiry` (AC1, AC2). 5. Unused `expired`/`listingState` in `ListingWizard`
removed, stale comment updated. 6. AC2 names the mock setup and PATCH count 0.

## Digest (filled by orchestrator after verification)

    Spec 0002f - Expired listing is read-only (web)   (verified, web only, no API change)
    What a user can do after this: nothing new; an owner can no longer edit a listing whose expiry has passed (no
             edit link; the edit URL explains renewal comes later). Gilad's 0002e Q1 answer (b), 2026-11-10.
    Decisions I need from you: none.
    Reviewers: code, qa   Estimated: 1 small coder run, 1 review round
