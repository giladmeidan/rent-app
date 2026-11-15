---
id: 0012a
title: "A suspended account is signed out and hidden, a listing removed by homie stays off the site, and an account's own listing cap shows in the app"
status: draft
depends_on: []
reviewers: [code, security, qa, ux]   # security: login and session rule; qa: every place a listing or card is shown; ux: the two new states (login, my listings)
estimate: 1 coder run   # coder Opus/high (auth + migration; Speed rule 6)
---

## Goal
After this ships, the public app obeys the three switches Slice 12's admin dashboard (`0012b`) flips, and
nothing else in the public app changes. PRODUCT.md "Admin (Slice 12)":
- A **suspended** account is signed out at once, cannot sign in, and is told so. Its listings and its
  person card are hidden everywhere. Lifting the suspension brings everything back.
- A listing **removed by homie** leaves the site. Its owner sees "הוסרה על ידי הומי" and cannot resume,
  renew or edit it.
- An account's **listing cap** (`users.listing_cap`) reaches the web, so a raised cap shows. This closes
  FOLLOWUPS 0002b.

It also adds the dashboard's two own tables (`reports.resolved_at`, `admin_actions`), so all of Slice 12's
schema lands in one migration and `0012b` has none.

## Decisions this spec builds on
- PRODUCT.md "Admin (Slice 12)" (Gilad, 2026-11-15):
  - the dashboard is a separate app (`0012b`) that writes these columns directly;
  - a suspended user is told "suspended", with no reason, and the suspension can be lifted;
  - a hidden listing reads "removed by homie" to its owner, has resume, renew and edit blocked, and frees
    its cap slot.
- PRODUCT.md "Trust (MVP)": reports are stored only (0011b); this spec still never hides anything because
  of a report. Only the admin's action does.
- `services/search.py` `_public_listings()` is the one visibility rule for listings. People cards have
  theirs in `market_people._candidate` and `people._shown`. This spec adds one condition to each rule
  rather than a check per endpoint.

## Scope
**In:**
- Migration `0023_admin_moderation`: the four schema changes below.
- `api/app/models/user.py` (`suspended_at`), `listing.py` (`removed_at` + CHECK), `report.py`
  (`resolved_at`), a new `admin_action.py` (`AdminAction`), exported from `app/models/__init__.py`.
- `api/app/services/auth.py`:
  - `resolve_session` adds `User.suspended_at IS NULL`: every session of a suspended user stops
    resolving, so every route answers 401 `unauthenticated`;
  - `verify_otp` raises a new `AccountSuspendedError` after the code is claimed, for an existing user with
    `suspended_at` set: no `last_login_at` write, no session;
  - `routers/auth.py` maps it to **403 `account_suspended`**.
- `api/app/services/search.py` `_public_listings()`: adds "the owner is not suspended". One `NOT EXISTS`
  on `users` by primary key, or a join, whichever keeps NF1.
- `api/app/services/market_people.py` `_candidate` and `api/app/services/people.py` `_shown`: add "the
  card's user is not suspended". This applies wherever a card is shown or can be liked: market browse,
  the likes lists, and a room's people page. If any card or like statement does not go through these
  two, it gets the same condition. The verifier lists them in Blast radius.
- `api/app/services/listings.py` and `api/app/services/photos.py`: a new `ListingRemovedError` for a
  listing with `removed_at` set. It is raised by:
  - `update_listing` (any field, `status` included);
  - `renew_listing`;
  - the listing-photo writes (add, delete, reorder).

  It is checked after the owner check and before `ListingExpiredError` / `RenewalNotOpenError`, and
  nothing is written. The routers map it to **409 `listing_removed`**. `set_closure` (the closure answer)
  is unchanged.
- `api/app/schemas/listing.py` `ListingOut` (the owner's view: `GET /me/listings`, the PATCH and renew
  responses): `removed: bool` (`removed_at IS NOT NULL`).
- `api/app/schemas/auth.py` `UserOut`: `listing_cap: int`.
- Web:
  - `web/src/features/listings/constants.ts`: `LISTING_CAP` is deleted. `MyListingsPage.tsx`,
    `PreviewStep.tsx` and `useRenewListing.ts` read `listing_cap` from `useMe()`
    (`features/auth/useMe.ts`).
  - `MyListingsPage.tsx`: the removed state (UI below).
  - `EditListingPage.tsx`: refuses a removed listing.
  - `OtpForm.tsx`: the suspended error.
  - `web/src/locales/he.json`: the keys below.
- `make client` regenerates `web/src/api` (two new response fields).
- `specs/FOLLOWUPS.md`: the 0002b `LISTING_CAP` line is closed.

**Out:**
- The dashboard, its database role and every write to these columns: `0012b`.
- Anything a report triggers on its own (PRODUCT.md "Trust (MVP)").
- A suspended user's past messages, applications, likes and chats. They stay as they are and readable by
  the other side, and the other side can still send into a chat with them. The suspended user cannot
  read or answer, since they can't sign in. Revisit if reports show the need (Risks).
- A reason or contact line in the suspended message: there is no contact channel until Slice 13.
- Deleting or anonymising an account: the pre-launch privacy pass.

**New dependencies:** none.

## Data
Migration `api/alembic/versions/0023_admin_moderation.py`, with a working `downgrade` (drops all four in
reverse order):

| Table | Change | Rule |
| --- | --- | --- |
| `users` | `suspended_at timestamptz NULL` | NULL = not suspended. Only the dashboard writes it |
| `listings` | `removed_at timestamptz NULL` | NULL = not removed. `ck_listings_removed_paused CHECK (removed_at IS NULL OR status = 'paused')`: a removed listing is never active, so it is never live and never takes a cap slot |
| `reports` | `resolved_at timestamptz NULL` | NULL = open. Only the dashboard writes it |
| `admin_actions` (new) | `id uuid PK default gen_random_uuid()`, `action text NOT NULL`, `target_type text NOT NULL`, `target_id uuid NOT NULL`, `detail text NULL`, `created_at timestamptz NOT NULL default now()` | `ck_admin_actions_action`: `'suspend'`, `'unsuspend'`, `'hide_listing'`, `'unhide_listing'`, `'set_listing_cap'`, `'resolve_reports'`, `'read_chat'`. `ck_admin_actions_target_type`: `'user'`, `'listing'`, `'report'`, `'chat'`. `ck_admin_actions_detail_length`: `char_length(detail) BETWEEN 1 AND 200`. No FK on `target_id` (it points into four tables; the log outlives its target) |

- `admin_actions` has one admin (Gilad), so it has no "who" column. The running public app never reads or
  writes it, nor `reports.resolved_at`.
- Backwards-compatible: nullable columns and a new table. Every existing row is valid under the new CHECK
  (`removed_at` is NULL everywhere).
- As in 0011b, the model builds the CHECK IN-lists from `Literal` types (`AdminActionKind`,
  `AdminTargetType` in `app/models/admin_action.py`). The migration freezes the same texts, and
  autogenerate sees no diff.

## API
No new endpoint. Changed answers:

| Method | Path | Auth rule | Change |
| --- | --- | --- | --- |
| any | any route behind `current_user` / `optional_user` | session cookie | A suspended user's session no longer resolves: 401 `unauthenticated` (or anonymous on `optional_user` routes) |
| GET | `/me/events` | session cookie | Checked at connect, as today. A stream already open ends within `STREAM_MAX_S` (900 s), and its reconnect gets 401 |
| POST | `/auth/otp/verify` | none | The right code for a suspended account: **403 `account_suspended`**, no session and no cookie. The code is consumed. A wrong code is still 401 `invalid_code`. `POST /auth/otp/request` is unchanged for a suspended email, so nobody can test whether an email is suspended without its mailbox |
| GET | `/me` | session cookie | `UserOut.listing_cap: int` |
| GET | `/me/listings` | session cookie | `ListingOut.removed: bool` |
| PATCH | `/listings/{id}` | owner | 409 **`listing_removed`** on a removed listing, nothing written (checked before `listing_expired`) |
| POST | `/listings/{id}/renew` | owner | 409 `listing_removed`, nothing written (before `renewal_not_open`) |
| POST / DELETE / PUT | `/listings/{id}/photos…` | owner | 409 `listing_removed`, nothing written |
| GET | `/search`, the map, `/listings/{id}`, market rooms, apply, reports, the people pages | as today | A suspended owner's listings and a suspended person's card are absent or 404, exactly like a paused listing or a hidden card today (`_public_listings()`, `_candidate`, `_shown`) |

## UI
There are no artboards. The kit and the existing patterns apply.

### Login (`OtpForm.tsx`, step 2)
- A 403 `account_suspended` becomes a step-2 error kind `suspended`. It shows in the same alert slot as
  `failed` (not as a field error on the code, since the code was right), and the code field is cleared.
- Key `auth.errors.suspended`: "החשבון הזה הושעה, ולכן אי אפשר להתחבר אליו." (voice: no gendered forms).
- The signup step behaves the same: an existing suspended email that signs up again reaches the same 403.

### My listings (`MyListingsPage.tsx`, `ListingRow`)
- A row with `removed: true`:
  - shows a status badge `listings.mine.removed` "הוסרה על ידי הומי" where the live, paused and expired
    badge sits;
  - shows one line `listings.mine.removedHint` "המודעה הוסרה מהאתר בעקבות בדיקה שלנו, ואי אפשר לפרסם אותה
    מחדש." under it;
  - has no pause/resume, renew or edit controls and no expiry line;
  - keeps its applicants link, so the applicants stay readable as on an expired row.
- The cap count (`listings.mine.count`) and the wizard's cap error (`listings.errors.capReached`) use
  `me.listing_cap`. While `useMe()` is loading, the count is not rendered, and a 3 is never shown in its
  place.

### Edit page (`EditListingPage.tsx`)
- Opening a removed listing shows `listings.errors.removed` "המודעה הוסרה על ידי הומי ואי אפשר לערוך
  אותה." with the page's existing back link and no form, in the same layout as the expired-listing
  refusal.
- Any 409 `listing_removed` from a mutation (PATCH, renew, photos), for example when the listing was
  removed while the page was open, shows the same key.

i18n keys added: `auth.errors.suspended`, `listings.mine.removed`, `listings.mine.removedHint`,
`listings.errors.removed`.

## Acceptance criteria
- [ ] AC1 Given a signed-in user, When `suspended_at` is set on their row, Then their next `GET /me` and
  `GET /me/listings` answer 401 `unauthenticated`, and an `optional_user` route (`GET /search`) treats
  them as anonymous — `api/tests/test_moderation.py::test_ac1_suspended_session_stops_resolving`
- [ ] AC2 Given a suspended account, When the right code is verified, Then 403 `account_suspended`, no
  `sessions` row, no `Set-Cookie`, `last_login_at` unchanged, and the code cannot be used again. A wrong
  code is still 401 `invalid_code`, and `POST /auth/otp/request` still answers as for any email —
  `test_moderation.py::test_ac2_suspended_account_cannot_sign_in`
- [ ] AC3 Given a suspended owner with a live apartment, a live room and a visible card, When anyone
  searches, opens the map, opens either listing's page, lists market rooms, applies or reports either
  listing, browses people, lists likes, or opens the room's people page as its lister, Then neither
  listing nor the card appears, and the by-id routes answer 404 —
  `test_moderation.py::test_ac3_suspended_user_hidden_everywhere`
- [ ] AC4 Given AC3's user, When `suspended_at` is set back to NULL, Then they sign in again, and both
  listings and the card are back where AC3 checked —
  `test_moderation.py::test_ac4_lifting_suspension_restores_everything`
- [ ] AC5 Given a removed listing (`status = 'paused'`, `removed_at` set), When its owner PATCHes a field,
  PATCHes `status: active`, renews it, or adds, deletes or reorders a photo, Then each answers 409
  `listing_removed` and the row and photos are unchanged. `PUT /listings/{id}/closure` still works, and
  `GET /listings/{id}/applicants` still answers 200 —
  `test_moderation.py::test_ac5_removed_listing_refuses_owner_writes`
- [ ] AC6 Given AC5's listing, When the owner lists `GET /me/listings` and creates new listings up to
  their cap, Then the row has `removed: true`, and it takes no cap slot —
  `test_moderation.py::test_ac6_removed_listing_frees_cap`
- [ ] AC7 Given any listing, When an UPDATE sets `removed_at` with `status = 'active'`, Then the database
  refuses it (`ck_listings_removed_paused`) — `test_moderation.py::test_ac7_removed_listing_never_active`
- [ ] AC8 Given a user with `listing_cap = 10`, When they call `GET /me` and then create 10 live listings
  (within 0011c's hourly and daily limits, frozen or patched in the test as `test_listings.py` does), Then
  `listing_cap` is 10, and the 11th answers 409 `listing_cap_reached` —
  `test_moderation.py::test_ac8_me_returns_listing_cap`
- [ ] AC9 Given an `admin_actions` row with an action, target type or detail outside its CHECK, When it is
  inserted, Then it is refused. The migration upgrades and downgrades cleanly, and autogenerate sees no
  diff — `test_moderation.py::test_ac9_admin_actions_checks`, `api/tests/test_migrations.py` (existing
  round trip)
- [ ] AC10 Given step 2 of sign-in, When verify answers 403 `account_suspended`, Then the alert shows
  `auth.errors.suspended`, the code field is cleared, and no navigation happens —
  `web/src/features/auth/__tests__/OtpForm.test.tsx::ac10_suspended_account`
- [ ] AC11 Given my listings with one removed row, When it renders, Then that row shows
  `listings.mine.removed` and `listings.mine.removedHint`, has no pause, resume, renew or edit control,
  and keeps the applicants link — `web/src/features/listings/__tests__/MyListingsPage.test.tsx::ac11_removed_row`
- [ ] AC12 Given `GET /me` with `listing_cap: 10`, When my listings and the wizard's cap error render,
  Then both say 10, and nothing renders a 3 while `/me` is loading —
  `MyListingsPage.test.tsx::ac12_cap_from_me`, `__tests__/PreviewStep.test.tsx::ac12_cap_from_me`
- [ ] AC13 Given a removed listing, When its edit page opens, or a PATCH there answers 409
  `listing_removed`, Then `listings.errors.removed` shows and no form is offered —
  `__tests__/EditListingPage.test.tsx::ac13_removed_listing`
- [ ] NF1 Search stays within NF2 of 0003a: the `EXPLAIN` of the search statement does not seq-scan
  `users`, and the existing search timing test still passes —
  `test_moderation.py::test_nf1_owner_check_uses_pk`, `api/tests/test_search.py` (existing)
- [ ] NF2 No log line carries a suspended user's email. The 403 is logged like other auth errors, with no
  user id — `test_moderation.py::test_nf2_no_email_in_logs` (caplog)

## Tests to write
- Unit and integration: `api/tests/test_moderation.py` (AC1–AC9, NF1, NF2), using conftest's
  `make_owner`, `make_seeker`, `make_card` and `make_pair`, with direct SQL to set `suspended_at` and
  `removed_at`, since the dashboard is `0012b`.
- Web vitest: AC10–AC13.
- E2E: none new. CI's existing suite must stay green (the `LISTING_CAP` removal touches the wizard and my
  listings).

## Blast radius
The verifier fills this from `graphify affected` for: `resolve_session`, `verify_otp`,
`_public_listings`, `_candidate`, `_shown`, `update_listing`, `renew_listing`, the photo writes,
`ListingOut`, `UserOut`, `LISTING_CAP`.

## Risks / open questions
- **Hiding by rule, not by flag:** the hiding happens inside the three visibility rules, so lifting a
  suspension restores everything with no undo code. The cost is one extra condition on the search hot
  path (NF1).
- **A suspended user's footprint stays:** their chats, applications and likes stay visible to the other
  side, who can still send into those chats. If reports show that confuses people, a later spec can show
  "this account was suspended" in those places. This is not a question for now.
- **Open SSE streams** last up to 15 minutes after a suspension. They only carry "a chat changed"
  pings, and every fetch they trigger gets 401. This is accepted.
- **No open product questions:** Gilad decided all three behaviours on 2026-11-15.

## Digest (filled by orchestrator after verification)
See `/digest`.
