---
id: 0012a
title: "A suspended account is signed out and hidden, a listing removed by homie stays off the site, and an account's own listing cap shows in the app"
status: done
depends_on: []
reviewers: [code, security, qa, perf, ux]   # security: login and session rule; qa: every place a listing or card is shown; perf: the search, browse and likes hot paths (Sonnet/medium); ux: the new states (login, my listings, edit page)
estimate: 1 coder run   # coder Opus/high (auth + migration; Speed rule 6); on the large side
---

## Goal
After this ships, the public app obeys the three switches that Slice 12's admin dashboard (`0012b`)
flips, and nothing else in the public app changes. PRODUCT.md "Admin (Slice 12)":
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
  - the suspended user's chats, applications and likes stay as they are;
  - a hidden listing reads "removed by homie" to its owner, has resume, renew and edit blocked, and frees
    its cap slot.
- Partial index users(id) WHERE suspended_at IS NOT NULL (Gilad, 2026-11-15), so the owner check stays
  flat as users grows.
- PRODUCT.md "Trust (MVP)": reports are stored only (0011b). This spec still never hides anything because
  of a report; only the admin's action does.
- Visibility already lives in a few rules, and this spec adds one condition to each rather than a check
  per endpoint:
  - `services/search.py` `_public_listings()` for listings;
  - `market_people._candidate` and `people._shown` for people cards;
  - `flatmates.shown_people`, `flatmates.preview` and `flatmates.join` for a room's flatmates and invite
    tokens.

## Scope
**In:**
- **Migration and models:**
  - migration `0024_admin_moderation` (Data): `0015a`'s `0023_listing_shelter` landed first, so
    `down_revision` is 0023;
  - `api/app/models/user.py` (`suspended_at`), `listing.py` (`removed_at` + CHECK; its docstring's
    migration list gains this one), `report.py` (`resolved_at`), and a new `admin_action.py`
    (`AdminAction`), exported from `app/models/__init__.py`.
- **Sign-in and sessions:**
  - `api/app/services/auth.py`:
    - `resolve_session` adds `User.suspended_at IS NULL` and stays one statement. Every session of a
      suspended user stops resolving, so every route answers 401 `unauthenticated`, and `optional_user`
      routes treat the caller as a visitor;
    - `verify_otp` raises a new `AccountSuspendedError` for an existing user with `suspended_at` set. It
      runs **after** the code is claimed (`_SETTLE_CODE` `del`) and **outside** the `try` whose `except`
      restores the code, so the code stays consumed. It writes no `last_login_at` and creates no session.
  - `api/app/routers/auth.py`: maps it to **403 `account_suspended`**. `user_out` (which builds `UserOut`
    field by field) sets `listing_cap`.
- **Listing visibility:** `api/app/services/search.py` `_public_listings()` adds "the owner is not
  suspended" as a `NOT EXISTS (SELECT 1 FROM users WHERE users.id = listings.owner_id AND suspended_at IS
  NOT NULL)`. It is not a join, so the callers' `FOR KEY SHARE OF listings` locks and FROM lists stay as
  they are.
- **People cards:**
  - `api/app/services/market_people.py` `_candidate` and `api/app/services/people.py` `_shown` add "the
    card's user is not suspended".
  - Every card and like statement goes through these two (Blast radius), with **one deliberate
    exception**: a `match` row in `GET /me/people-likes` (`likes_statement`) stays, as it does for a
    hidden card today, because the match is the chat's entry and chats stay.
- **Rooms and invites** (`api/app/services/flatmates.py`):
  - `shown_people`'s flatmate branch adds `User.suspended_at IS NULL` (`User` is already joined), so a
    suspended flatmate disappears from a room's page;
  - `preview` and `join` add "the owner is not suspended" as a `NOT EXISTS` on `users`, so `join`'s
    `FOR UPDATE` still locks only the listing. They answer 404 `not_found`, as for a disabled token.
- **Removed listings:** a new `ListingRemovedError` for a listing with `removed_at` set. Every check reads
  the row its function already locks, so a hide cannot slip between the check and the write. It is raised
  by:
  - `api/app/services/listings.py` `update_listing` (any field, `status` included; locked `FOR UPDATE`),
    checked before `ListingExpiredError`;
  - `renew_listing` (`FOR UPDATE`), checked before `RenewalNotOpenError`;
  - `api/app/services/photos.py` `_lock_own_listing` (`FOR NO KEY UPDATE`; add, delete, reorder) and
    `check_listing_upload` (before the upload body is read).

  It always comes after the owner check, and nothing is written. The routers map it to **409
  `listing_removed`**. The upload route's 409 description lists both `photo_limit` and
  `listing_removed`. `set_closure` (the closure answer) is unchanged.
- **Schemas:**
  - `api/app/schemas/listing.py` `ListingOut` (the owner's view: `GET /me/listings`, the create, PATCH and
    renew responses; `MyListingOut` inherits it): `removed: bool` (`removed_at IS NOT NULL`);
  - `api/app/schemas/auth.py` `UserOut`: `listing_cap: int`. `test_auth.py:136`'s exact key set gains it.
- **Web:**
  - `web/src/features/listings/constants.ts`: `LISTING_CAP` is deleted. `MyListingsPage.tsx` (the count),
    `ListingWizard.tsx` / `PreviewStep.tsx` (the cap error) and `useRenewListing.ts::actionErrorText` read
    `listing_cap` from `useMe()` (`features/auth/useMe.ts`). `actionErrorText` is a plain function, so the
    cap becomes a parameter that both callers pass.
  - `ListingWizard.tsx::outcome` today maps every 409 except `listing_expired` to `capReached`. It now maps
    `listing_removed` to a new `PublishError` `removed` (`PreviewStep.tsx`), shown as
    `listings.errors.removed`.
  - `useRenewListing.ts::actionErrorText` maps `listing_removed` to `listings.errors.removed`.
  - `StatusBadge.tsx`: `ListingState` gains `removed`, returned first by `listingState` when
    `listing.removed`, with tone `danger`.
  - `MyListingsPage.tsx`, `EditListingPage.tsx` and `OtpForm.tsx`: the states under UI.
  - `web/src/locales/he.json`: the keys under UI.
  - Fixtures:
    - `features/auth/__tests__/harness.tsx::noa` gains `listing_cap: 3`;
    - every typed `ListingOut` / `MyListingOut` fixture gains `removed: false`
      (`features/listings/__tests__/fixtures.ts`, `web/e2e/screens/fixtures-listings.ts` `listing()`, and
      whatever else `tsc` reports);
    - the e2e `/me` fixtures are typed as `UserOut`, starting with `OWNER` in
      `web/e2e/screens/fixtures-listings.ts`. e2e runs only in CI.
- `make client` regenerates `web/src/api` (two new response fields).
- `specs/FOLLOWUPS.md`: the 0002b `LISTING_CAP` line is closed.

**Out:**
- The dashboard, its database role and every write to these columns: `0012b`. That includes ending
  sessions on suspend.
- Anything a report triggers on its own (PRODUCT.md "Trust (MVP)").
- **A suspended user's past footprint:**
  - their messages, applications, chats and match rows stay as they are and readable by the other side,
    who can still send into a chat with them;
  - the suspended user cannot read or answer, since they cannot sign in;
  - `applications.list_my_applications`, `applications.list_applicants`, the chat summaries,
    `flatmates.my_flats` and the geocoding worker are untouched (Blast radius).
- A reason or contact line in the suspended message: there is no contact channel until Slice 13.
- Deleting or anonymising an account: the pre-launch privacy pass.
- `web/src/features/listings/syncPhotos.ts`: it runs only after a PATCH has succeeded, and the PATCH
  refuses first. A photo 409 in that race counts as one failed photo, like any other failure.

**New dependencies:** none.

## Data
Migration `api/alembic/versions/0024_admin_moderation.py` (`down_revision` 0023, `0015a`'s), with a
working `downgrade` that drops all four in reverse order:

| Table | Change | Rule |
| --- | --- | --- |
| `users` | `suspended_at timestamptz NULL`; index `ix_users_suspended ON users (id) WHERE suspended_at IS NOT NULL` | NULL = not suspended. Only the dashboard writes it. The partial index holds only the suspended rows, so the "not suspended" check reads a handful of rows however large `users` grows (Gilad, 2026-11-15) |
| `listings` | `removed_at timestamptz NULL` | NULL = not removed. `ck_listings_removed_paused CHECK (removed_at IS NULL OR status = 'paused')`: a removed listing is never active, so it is never live and never takes a cap slot |
| `reports` | `resolved_at timestamptz NULL` | NULL = open. Only the dashboard writes it |
| `admin_actions` (new) | `id uuid PK default gen_random_uuid()`, `action text NOT NULL`, `target_type text NOT NULL`, `target_id uuid NOT NULL`, `detail text NULL`, `created_at timestamptz NOT NULL default now()` | `ck_admin_actions_action`: `'suspend'`, `'unsuspend'`, `'hide_listing'`, `'unhide_listing'`, `'set_listing_cap'`, `'resolve_reports'`, `'read_chat'`. `ck_admin_actions_target_type`: `'user'`, `'listing'`, `'report'`, `'chat'`. `ck_admin_actions_detail_length`: `char_length(detail) BETWEEN 1 AND 200`. No FK on `target_id` (it points into four tables; the log outlives its target) |

**Each action's target in `admin_actions`** (0012b writes them):

| Action | `target_type` | `target_id` | `detail` |
| --- | --- | --- | --- |
| `suspend`, `unsuspend` | `user` | the user's id | none |
| `set_listing_cap` | `user` | the user's id | e.g. "3→10" |
| `hide_listing`, `unhide_listing` | `listing` | the listing's id | none |
| `resolve_reports` | `report` | the id of the report it ran on | how many reports it closed |
| `read_chat` | `chat` | the conversation's id | the report's id |

- `admin_actions` has one admin (Gilad), so it has no "who" column.
- The running public app never reads or writes `admin_actions` or `reports.resolved_at`.
- `conftest.py`'s `db_engine` TRUNCATE gains `admin_actions`.
- Backwards-compatible: nullable columns and a new table. Every existing row is valid under the new CHECK,
  since `removed_at` is NULL everywhere.
- `users.listing_cap` already has `ck_users_listing_cap` (0–100); unchanged.
- As in 0011b, the model builds the CHECK IN-lists from `Literal` types (`AdminActionKind`,
  `AdminTargetType` in `app/models/admin_action.py`). The migration freezes the same texts, and
  autogenerate sees no diff.

## API
No new endpoint. Changed answers:

| Method | Path | Auth rule | Change |
| --- | --- | --- | --- |
| any | any route behind `current_user` / `optional_user` | session cookie | A suspended user's session no longer resolves: 401 `unauthenticated`, or a visitor on `optional_user` routes |
| GET | `/me/events` | session cookie | Checked at connect, as today. A stream already open ends within `STREAM_MAX_S` + `STREAM_JITTER_S` (up to 960 s), and its reconnect gets 401 |
| POST | `/auth/otp/verify` | none | The right code for a suspended account: **403 `account_suspended`**, no session and no cookie. The code is consumed. A wrong code is still 401 `invalid_code`. `POST /auth/otp/request` is unchanged for a suspended email, so nobody can test whether an email is suspended without its mailbox |
| GET | `/me` (and `POST /auth/otp/verify`, `PUT /me/photo`, which return `UserOut`) | session cookie | `UserOut.listing_cap: int` |
| GET | `/me/listings` (and create, PATCH, renew responses) | session cookie / owner | `ListingOut.removed: bool` |
| PATCH | `/listings/{id}` | owner | 409 **`listing_removed`** on a removed listing, nothing written (checked before `listing_expired`) |
| POST | `/listings/{id}/renew` | owner | 409 `listing_removed`, nothing written (checked before `renewal_not_open`) |
| POST / DELETE / PUT | `/listings/{id}/photos…` | owner | 409 `listing_removed`, nothing written (the upload checks before reading the body) |
| GET / POST | `GET /listings` (search, the map's `bbox`, market rooms), `GET /listings/{id}`, `POST /listings/{id}/applications`, `POST /reports`, `GET /people`, `PUT /people/{card_id}/like`, `GET /me/people-likes`, `GET /me/likes`, `GET /listings/{id}/people`, the invite-token preview and join | as today | A suspended owner's listings, a suspended person's card and a suspended flatmate are absent or 404, exactly like a paused listing or a hidden card today. In `GET /me/people-likes`, `match` rows stay |

## UI
There are no artboards, and no new layout. The badge, the hint line and the refusal reuse `StatusBadge`,
the card's caption line and `PageHeader`, which already use logical properties (RTL).

### Login (`OtpForm.tsx`, step 2)
- A 403 `account_suspended` becomes a step-2 error kind `suspended`. It shows in the same alert slot as
  `failed`, not as a field error on the code (the code was right), and the code field is cleared.
- Key `auth.errors.suspended`: "החשבון הזה הושעה, ולכן אי אפשר להתחבר אליו." (voice: no gendered forms).
- The signup step behaves the same: an existing suspended email that signs up again reaches the same 403.
- Other states (idle, sending, wrong code, too many) are unchanged.

### My listings (`MyListingsPage.tsx`, `ListingRow`)
- A row with `removed: true`:
  - shows the `StatusBadge` state `removed` (`listings.status.removed` "הוסרה על ידי הומי", tone
    `danger`) where the live, paused and expired badge sits;
  - shows one caption line `listings.mine.removedHint` "המודעה הוסרה מהאתר בעקבות בדיקה שלנו, ואי אפשר
    לפרסם אותה מחדש.";
  - has no pause/resume, renew or edit controls and no expiry line;
  - keeps its applicants link, the closure question (apartments; `set_closure` is allowed) and the
    flatmates link (rooms), as a paused row does.
- `removed` wins over `expired`: a removed listing past its expiry shows the removed badge and hint, never
  the renew button.
- Any 409 `listing_removed` on a row action shows `listings.errors.removed` in the row's existing alert
  (`actionErrorText`).
- The cap count (`listings.mine.count`) uses `me.listing_cap`. While `useMe()` is loading, the count is not
  rendered, and a 3 is never shown in its place.
- Other states (loading, empty, error) are unchanged.

### Wizard (`ListingWizard.tsx` / `PreviewStep.tsx`)
- The cap error (`listings.errors.capReached`) uses `me.listing_cap`.
- A 409 `listing_removed` (the edit flow's PATCH) shows `listings.errors.removed`, not the cap error.

### Edit page (`EditListingPage.tsx`)
- Opening a removed listing is checked before the expired refusal. The page is laid out as its not-found
  state:
  - `PageHeader` with `listings.errors.removed` "המודעה הוסרה על ידי הומי ואי אפשר לערוך אותה." as its
    `<h1>`, focused on arrival and used as the tab title;
  - the back link;
  - no card, no form and no renew button.
- A 409 `listing_removed` from the PATCH (the listing was removed while the page was open) shows the same
  key through `outcome` / `PublishError` `removed`.

i18n keys added: `auth.errors.suspended`, `listings.status.removed`, `listings.mine.removedHint`,
`listings.errors.removed`.

## Acceptance criteria
- [ ] AC1 Given a signed-in user, When `suspended_at` is set on their row, Then their next `GET /me` and
  `GET /me/listings` answer 401 `unauthenticated`, and `GET /listings` answers as for a visitor (`match`
  is null on every item) — `api/tests/test_moderation.py::test_ac1_suspended_session_stops_resolving`
- [ ] AC2 Given a suspended account, When the right code is verified, Then:
  - it answers 403 `account_suspended`, with no `sessions` row and no `Set-Cookie`;
  - `last_login_at` is unchanged, and the code cannot be used again;
  - a wrong code is still 401 `invalid_code`;
  - `POST /auth/otp/request` still answers as for any email.

  — `test_moderation.py::test_ac2_suspended_account_cannot_sign_in`
- [ ] AC3 Given a suspended user U, with:
  - a live apartment and a live room;
  - a visible card;
  - a place as a shown flatmate on another owner's live room;
  - an invite token on their own room;
  - a mutual match with a person P;

  When anyone does any of the following:
  - searches (`GET /listings`, with and without `bbox`) or lists market rooms;
  - opens either listing (`GET /listings/{id}`), applies to it, or reports it;
  - opens the other owner's room page;
  - browses people (`GET /people`) or likes U's card;
  - lists people likes (`GET /me/people-likes`) or invites (`GET /me/likes`);
  - opens the people page of another lister's live room that U fits;
  - previews or joins with U's invite token;

  Then neither listing, U's card, nor U as a flatmate appears; the by-id routes, the like, and the token
  preview and join answer 404. P's `GET /me/people-likes` still holds the `match` row with U —
  `test_moderation.py::test_ac3_suspended_user_hidden_everywhere`
- [ ] AC4 Given AC3's user, When `suspended_at` is set back to NULL, Then they sign in again, and
  everything AC3 checked is back — `test_moderation.py::test_ac4_lifting_suspension_restores_everything`
- [ ] AC5 Given a removed listing (`status = 'paused'`, `removed_at` set), When its owner:
  - PATCHes a field;
  - PATCHes `status: active`;
  - renews it;
  - uploads, deletes or reorders a photo;

  Then each answers 409 `listing_removed` (the upload before reading its body), and the row and photos
  are unchanged. `PUT /listings/{id}/closure` still works, and `GET /listings/{id}/applicants` still
  answers 200 — `test_moderation.py::test_ac5_removed_listing_refuses_owner_writes`
- [ ] AC6 Given AC5's listing, When the owner lists `GET /me/listings` and creates new listings up to
  their cap, Then the row has `removed: true` and takes no cap slot —
  `test_moderation.py::test_ac6_removed_listing_frees_cap`
- [ ] AC7 Given any listing, When an UPDATE sets `removed_at` with `status = 'active'`, Then the database
  refuses it (`ck_listings_removed_paused`) — `test_moderation.py::test_ac7_removed_listing_never_active`
- [ ] AC8 Given a user with `listing_cap = 10` and 0011c's create limit raised in the test
  (`monkeypatch.setattr(limits, "CREATE", limits.Bucket("create", 100, 100))`, as `test_listings.py:188`),
  When they call `GET /me` and then create 10 live listings, Then `listing_cap` is 10, and the 11th
  answers 409 `listing_cap_reached` — `test_moderation.py::test_ac8_me_returns_listing_cap`
- [ ] AC9 Given an `admin_actions` row with an action, target type or detail outside its CHECK, When it is
  inserted, Then it is refused. The migration upgrades and downgrades cleanly, and autogenerate sees no
  diff:
  - `test_moderation.py::test_ac9_admin_actions_checks`;
  - `api/tests/test_migrations.py::test_ac9_admin_moderation_upgrade_downgrade` (new);
  - `::test_ac4_autogenerate_sees_no_diff_with_postgis_extensions` (existing).
- [ ] AC10 Given step 2 of sign-in, When verify answers 403 `account_suspended`, Then the alert shows
  `auth.errors.suspended`, the code field is cleared, and no navigation happens —
  `web/src/features/auth/__tests__/OtpForm.test.tsx::ac10_suspended_account`
- [ ] AC11 Given my listings with one removed row (also past its expiry), When it renders, Then:
  - the row shows `listings.status.removed` and `listings.mine.removedHint`;
  - it has no pause, resume, renew or edit control;
  - it keeps the applicants link and, for an apartment, the closure question.

  A 409 `listing_removed` on a row action shows `listings.errors.removed` —
  `web/src/features/listings/__tests__/MyListingsPage.test.tsx::ac11_removed_row`
- [ ] AC12 Given `GET /me` with `listing_cap: 10`, When my listings and the wizard's cap error render,
  Then both say 10, and nothing renders a 3 while `/me` is loading:
  - `MyListingsPage.test.tsx::ac12_cap_from_me`;
  - `__tests__/ListingWizard.test.tsx::ac12_cap_from_me`.
- [ ] AC13 Given a removed listing, When its edit page opens, or a PATCH there answers 409
  `listing_removed`, Then `listings.errors.removed` shows (as the focused `<h1>` on open), and no form,
  card or renew button is offered — `__tests__/EditListingPage.test.tsx::ac13_removed_listing`
- [ ] NF1 Given the search's count and page statements, When they are EXPLAIN ANALYZEd (FORMAT JSON)
  with `SET LOCAL enable_seqscan = off` at 2,000 live apartments with fresh statistics, Then the owner
  check is one filtered pass over users or a primary-key probe, never a per-listing scan, served by the
  partial index on suspended users (`ix_users_suspended`, one loop under a Hash or Materialize).
  `test_market_people.py::test_ac13_statement_counts_and_plan` still passes. The perf reviewer
  re-measures 0003a's NF2 (each search statement under 50 ms at 10,000 live apartments) —
  `test_moderation.py::test_nf1_owner_check_is_one_pass`
- [ ] NF2 No log line carries a suspended user's email. The 403 is logged like other auth errors, with no
  user id — `test_moderation.py::test_nf2_no_email_in_logs` (caplog)

## Tests to write
- **Unit and integration:** `api/tests/test_moderation.py` (AC1–AC9, NF1, NF2), using conftest's
  `make_owner`, `make_seeker`, `make_card`, `make_pair` and `make_person_like`, with direct SQL to set
  `suspended_at` and `removed_at`, since the dashboard is `0012b`. `test_migrations.py` gains the new
  round trip.
- **Web vitest:** AC10–AC13, plus the fixture changes in Scope (`noa`, `removed: false`).
- **E2E:** none new. CI's existing suite must stay green; the `LISTING_CAP` removal touches the wizard and
  my listings, and the e2e `/me` fixtures gain their type.

## Blast radius
From `graphify affected` on `main` (5713d57), checked against the code with grep (the graph missed
`card_user`, `check_listing_upload` and `actionErrorText`'s cap use).
- `services/auth.py::resolve_session` → `app/auth.py::optional_user` / `current_user` (every signed-in
  and optional route) and `routers/events.py::_user_id_for` / `stream_user_id` (SSE, at connect). In
  Scope (AC1). It stays one statement, so the "session" counts in `test_market_people.py::test_ac13_statement_counts_and_plan`
  and other statement-count tests are unchanged; `test_chat_events.py` only imports it.
- `services/auth.py::verify_otp` → `routers/auth.py::verify_otp` (the 403, in Scope). Tests `test_auth.py`
  `verify()`, `test_otp_single_use_under_concurrency`, `test_code_survives_database_failure_at_login`:
  untouched, as long as the suspended check sits after the claim and **outside** the `try`, whose
  `except` restores the code (`_RESTORE_CODE`).
- `search.py::_public_listings` → `_filtered` / `search_listings` (`GET /listings`: search, the map's
  `bbox`, market rooms), `get_public_listing_with_match` (`GET /listings/{id}`; `applications.apply`
  locks it `FOR KEY SHARE OF listings`), `public_listing_owner` (`POST /reports`, listing), `liked_rooms`
  (`GET /me/likes`), `applications.apply` (its `listing_type` subquery), `people._own_room` (the room
  people routes) and `people.room_person_user` (correlated EXISTS). All inherit the condition with no
  change of their own; a `NOT EXISTS` keeps the `OF listings` locks and the callers' FROM lists as they
  are. Not through it, untouched (own or member footprint, like chats): `applications.list_my_applications`,
  the chat listing summaries, `flatmates.my_flats`, the geocoding worker (`geocoding.py:254`, harmless).
  `flatmates.preview` / `join` (by invite token, any status): see Verifier finding 1.
- `market_people._candidate` → `card_user` (`POST /reports`, person), `browse_statement` / `browse`
  (`GET /people`), `like` (`PUT /people/{card_id}/like`), `likes_statement` / `my_people_likes`
  (`GET /me/people-likes`, its `mine` and `liked_me` rows). Bypass: `likes_statement`'s `match` rows
  (the chat-member rule), see finding 2. `test_market_people.py::test_ac13_statement_counts_and_plan`
  EXPLAINs the browse and likes statements and must still pass.
- `people._shown` → `list_people` (its snapshot INSERT … SELECT and its page; `GET /listings/{id}/people`),
  `like_person` (its UPDATE), `room_person_user` (`POST /reports`, room_person). `test_applications.py`
  `call()` and `test_flatmates.py::test_ac8_join_racing_like_is_never_both` untouched. Not through it:
  `flatmates.shown_people` (a room page's shown flatmates), finding 1; `applications.list_applicants`
  and chat members (Out: applications and chats stay).
- `listings.update_listing` → `routers/listings.py::update_listing` (409 mapping, in Scope).
  `test_listings.py`'s whole-body comparisons keep passing (`removed` is on both sides).
- `listings.renew_listing` → `routers/listings.py::renew_listing`; `test_listing_renewal.py` `renew()` /
  `test_ac7_concurrent_renewals_respect_cap` call it directly: untouched (the check reads the locked row).
- Photo writes: `photos._lock_own_listing` → `add_listing_photo`, `delete_listing_photo`,
  `reorder_listing_photos` (POST / DELETE / PUT under `/listings/{id}/photos`); `check_listing_upload` →
  `routers/photos.py::upload_listing_photo` (the pre-body check). `api/scripts/seed_promo.py::main` calls
  `add_listing_photo` on fresh listings: untouched. The person photo (`PUT` / `DELETE /me/photo`): untouched.
- `schemas/listing.py::ListingOut` → `routers/listings.py` create / `my_listings` / update / renew and
  `MyListingOut` (inherits); `test_geocoding.py`, `test_inbox.py` only import it. Web
  `features/listings/api.ts::ListingOut` / `MyListingOut`: every typed fixture gains `removed` (tsc
  covers `src` and `e2e`), finding 4.
- `schemas/auth.py::UserOut` → `routers/auth.py::user_out` (builds it field by field: add `listing_cap`)
  → `GET /me`, `POST /auth/otp/verify`, `PUT /me/photo`; `test_auth.py:136` asserts the exact key set
  (add `listing_cap`); `test_photos.py`, `test_person_photo.py`, `test_market_people.py` `run()` untouched.
  Web `UserOut`: `features/auth/__tests__/harness.tsx::noa` (typed) and the untyped e2e `/me` fixtures,
  finding 4.
- `web/src/features/listings/constants.ts::LISTING_CAP` → `MyListingsPage.tsx` (the count),
  `PreviewStep.tsx` (the wizard's cap error), `useRenewListing.ts::actionErrorText` (the row's and the
  edit page's cap error; a plain function, so the cap becomes a parameter). Tests asserting `cap: 3`:
  `MyListingsPage.test.tsx`, `ListingWizard.test.tsx`, `EditListingPage.test.tsx`,
  `market/__tests__/MarketMinePage.test.tsx` (pass through the shared `noa`). Other graph hits
  (`routes.tsx`, `RequireOwner.test.tsx`, `wizard.tsx`, `MarketMinePage.tsx`, `ListingWizard.tsx`) import
  those modules, not the constant: untouched.
- Also reached (finding 4): `ListingWizard.tsx::outcome` (every 409 but `listing_expired` reads as
  `capReached` today), `StatusBadge.tsx::listingState` / `StatusBadge` (callers `MyListingsPage`,
  `people/RoomInviteHint.tsx` → `MarketPeoplePage`: live-only, unaffected).
- Models `User`, `Listing`, `Report`, `AdminAction`: nullable columns and a new table; the new CHECK bites
  only on writes that set `status = 'active'` (`update_listing`'s resume, `renew_listing`), which refuse
  first. `Listing`'s docstring list of migrations gains 0024. `test_migrations.py` round trip and
  autogenerate.

## Risks / open questions
- **Hiding by rule, not by flag:** the hiding happens inside the visibility rules, so lifting a suspension
  restores everything with no undo code. The cost is one `NOT EXISTS` by primary key on the search,
  browse and likes paths (NF1, perf reviewer).
- **A suspended user's footprint stays:** their chats, applications and match rows stay visible to the
  other side, who can still send into those chats. If reports show that confuses people, a later spec can
  show "this account was suspended" in those places. This is not a question for now.
- **Open SSE streams** last up to 960 s after a suspension. They only carry "a chat changed" pings, and
  every fetch they trigger gets 401. This is accepted.
- **Old sessions on lifting:** this spec only stops sessions from resolving. Without more, lifting a
  suspension would revive the account's unexpired sessions (up to 30 days). `0012b`'s Suspend therefore
  also revokes the user's live sessions (`sessions.revoked_at`, orchestrator 2026-11-15, the safer
  default), so a lifted account signs in afresh.
- **Open product questions:** none. Gilad decided all three behaviours on 2026-11-15.
- **NF1 reworded (2026-11-15).** At realistic scale Postgres plans the `NOT EXISTS` as one pass over
  the suspended users, not a per-listing primary-key probe. Gilad chose the partial index (option b),
  and NF1 now asks for that one-pass shape.
## Verifier notes
One round (2026-11-15, against `main` 5713d57). The verifier found 8 issues, and the orchestrator applied
all of them to the text above:
1. flatmates and invite tokens added to the hiding;
2. the `match`-row exception made explicit;
3. `perf` added, and NF1 made a plan check;
4. the files Scope missed (`user_out`, the photo lock points, `outcome`, `actionErrorText`, `StatusBadge`,
   fixtures);
5. the removed row and edit-page states;
6. real routes and test names;
7. the admin log targets and the migration number;
8. the stream timing and the old-sessions risk.

Perf review (2026-11-15, EXPLAIN ANALYZE at 10,000 live apartments, before → after 0012a, before the
partial index; count / page in ms): no params 3.7/17.0 → 6.5/23.0; filtered 2.5/6.4 → 3.6/7.8; offset
10000 3.6/20.8 → 6.0/25.3; bbox 3.8/17.8 → 6.1/22.9; market rooms 2.0/3.1 → 3.1/4.8; match sort
5.4/69.0 → 6.9/71.0 (over 50 ms before 0012a too, FOLLOWUPS); people browse 19.1 → 20.7; people likes
5.6 → 6.5.

## Digest (filled by orchestrator after verification)
Spec 0012a — Suspension, removed listings and the per-account cap in the public app   (verified 2026-11-15; part 1 of 2, 0012b is the dashboard)
What a user can do after this: nothing new to click. The app obeys the admin's three switches: a suspended account
is signed out, cannot sign in ("החשבון הזה הושעה…"), and its listings, card, flatmate spots and invite links vanish;
lifting brings all of it back. A listing removed by homie leaves the site, and its owner sees "הוסרה על ידי הומי"
with resume, renew, edit and photos blocked. "My listings" and the wizard show the account's real cap, not a fixed 3.
Decisions I need from you: none. FYI: (1) suspended users' chats, applications and existing matches stay as they
are (your "footprint stays" call); (2) all of Slice 12's schema lands here in one migration, so 0012b has none.
KPIs this slice moves: trust (time from report to action, once 0012b ships).
Acceptance targets: NF1 the "owner not suspended" check uses the users primary key, and search stays under 50 ms per
statement at 10,000 live apartments (perf reviewer re-measures); NF2 no suspended user's email in any log line.
Risks: one more condition on the search, browse and likes hot paths, mitigated by a primary-key NOT EXISTS plus a
plan test; migration number race with 0015a (both want 0023), so whichever merges second renames.
Reviewers: code, security, qa, perf, ux   Estimated: 1 coder run (Opus/high), 1 review round
Links: `specs/0012a-moderation-data.md` · PRODUCT.md "Admin (Slice 12)" · `specs/0012b-admin-dashboard.md`
