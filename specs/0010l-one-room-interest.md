---
id: 0010l
title: On a room a seeker has one way to say "I'm interested", the application; the seeker's room-like is removed, and a lister's like becomes an invite that the seeker's application answers with an open chat
status: done
depends_on: []   # 0008a/0008c/0010b/0010h done; #82 (my applications active/past) merged
reviewers: [code, qa, security]   # security: the apply path now opens a chat (shortlist without the lister's click) and the lock order changes; qa: the room page, /me/likes and the inbox end to end
estimate: 1 coder run, large   # coder Opus/high (migration, apply concurrency; Speed rule 6). ~45 files, most of it deletion; cannot split (see Risks)
---

## Goal
After this ships a seeker looking at a room sees **one** action, the application (PRODUCT.md "People & likes",
changed 2026-11-14), instead of a like button and an apply form side by side. A lister keeps one inbox for
"who wants my room" (the applicant inbox) instead of two (inbox + "liked you" in people browse). A lister can
still find people through people browse and like them; that like is now an **invite**: when the invited seeker
applies, the application is shortlisted at once and the chat opens (the old mutual match).

Why: a seeker's room-like already became an application when the lister liked back
(`services/people.py::_mutual`), so the like was only a message-less application parked in a second list, with
its own endpoints, its own screen and a like-vs-apply race (`test_ac8_apply_racing_a_lister_like`, flaky).

## Scope
**In:**
- API: remove the seeker's room-like (`PUT` / `DELETE /listings/{id}/like`, `like_room`, `unlike_room`).
  `POST /listings/{id}/applications` on a room whose lister liked the caller makes a **shortlisted**,
  `source = 'like'` application, opens its chat and publishes the chat event (R1–R7). Message optional on a
  room (Q1, decided). People browse shows opted-in people only. `ListingDetail.like` keeps only `liked_me`.
  `MyLikesOut.mine`, `liked_me_count`, `PersonOut.liked_me` and `LikeOut.application_id` are removed (a
  lister's like can no longer be the second like, so it never creates an application).
- Migration `0018_one_room_interest`: drop `room_pairs.seeker_liked_at`; replace `ck_applications_message`.
- Web: room page without `LikeRoomButton`; `ApplySection` on a room with an optional message, the label
  "אני מעוניין/ת", an invite hint and a chat link once shortlisted; `/me/likes` rooms part without the "rooms
  I liked" section and without the like-back button; map pins without the "liked" mark; my listings without
  the liked-me chip; people browse without the "liked you" marker and without the lister-side mutual banner;
  the inbox and "my applications" show a message whenever there is one (not by `source`).
- Tests, e2e and `make screens` mocks that cover the removed paths are rewritten or deleted (list below).
- `specs/PRODUCT.md` rows "People & likes" and "Applications" (done by the orchestrator with the spec); the
  orchestrator also drops "and likes rooms" from the "Account roles" row.

**Out:**
- Apartments: unchanged (message required, no likes).
- Person-to-person likes in שוק השותפים (`person_pairs`, 0010h/0010i, direct chats): unchanged. `MutualBanner`
  stays: `MarketPeoplePage` and the people part of `MyLikesPage` render it for person matches
  (`people-market.spec.ts::ac19`).
- The lister's like and unlike of a person (`PUT` / `DELETE /listings/{id}/people/{person_id}/like`) and the
  seeker's "rooms that liked me" list (`MyLikesOut.liked_me`, `LikesNavLink`'s count): kept, see API.
- Renaming `source = 'like'` or the "התאמה הדדית" tag: kept as is (it still means "the lister chose them first").

**New dependencies:** none.

## Data
Migration `0018_one_room_interest` (down_revision `0017`):
1. `ALTER TABLE room_pairs DROP COLUMN seeker_liked_at`. Pending seeker likes (a seeker like with no
   application) are dropped with it (Q2, decided: no real users before launch). A pair whose lister liked stays an invite.
2. `ck_applications_message` becomes: the message is NULL or 1–500 characters, and it is NULL only on a room
   application:
   ```sql
   (message IS NULL OR char_length(message) BETWEEN 1 AND 500)
   AND (message IS NOT NULL OR listing_type_at_apply = 'room')
   ```
   (Neither term can evaluate to NULL, so no NULL slips through.) Existing rows pass it: `'apply'` rows carry a
   message, `'like'` rows are room rows with none. `source` stays `'apply' | 'like'` (`ck_applications_source`
   unchanged); a `'like'` row may now carry a message (the seeker who answers an invite may write one).
3. Downgrade (works on any data, as 0011's does): `UPDATE applications SET message = NULL WHERE source =
   'like'` (an invite answer's message is lost), then `UPDATE applications SET message = '(ללא הודעה)' WHERE
   message IS NULL AND source = 'apply'` (a placeholder, as 0011 uses one), then the old CHECK, then re-add
   `seeker_liked_at` (nullable, empty). The migration docstring says what the downgrade loses.

`models/room_pair.py` and `models/application.py` match the migration (autogenerate sees no diff,
`test_migrations.py`). Docstrings and column comments that describe seeker likes or "NULL exactly when
`source = 'like'`" are updated in the same files and in `schemas/application.py` (`MyApplicationOut.message`,
`ApplicantOut.message`: "null when the seeker sent none").

## API
| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| POST | `/listings/{id}/applications` | signed in (unchanged rules, 0010b) | `ApplicationIn`: `message` optional in the schema (absent, null, or blank after strip = none); required on an apartment, enforced in the service | `MyApplicationOut`, 201; on a room whose lister liked the caller `status: 'shortlisted'`, `source: 'like'` | unchanged; plus 422 `{"detail": "message_required"}` on a public apartment without a message (a string `detail`, as `unknown_area` / `photo_order_mismatch`; not counted) |
| PUT / DELETE | `/listings/{id}/like` | — | — | **removed** (no route left on the path: 404) | — |
| GET | `/me/likes` | signed in | — | `MyLikesOut` without `mine`; `liked_me` (rooms whose lister invited the caller and that they have not applied to) unchanged | unchanged |
| GET | `/listings/{id}` | public | — | `ListingDetail.like`: `{liked_me: bool}` or null (unchanged null rules); `liked_by_me` removed | unchanged |
| GET | `/me/listings` | owner | — | `liked_me_count` removed from each listing | unchanged |
| GET | `/me/listings/{id}/people` | owner of a live room | — | `PersonOut.liked_me` removed; candidates are opted-in only (`people_visible`), order score, then age of the pair, then id | unchanged |
| PUT | `/listings/{id}/people/{person_id}/like` | owner of a live room | — | `LikeOut` = `{liked: true}` (`application_id` removed): the like is recorded as an invite | unchanged (409 `already_applied` when the person has a non-withdrawn application) |

`ApplicationIn`: `message: Message | None = None`, with a `BeforeValidator` that maps a blank-after-strip
string to None (otherwise `str_strip_whitespace` + `min_length=1` would 422 it). The other `Message` rules
(length, newlines, visible characters) are unchanged for a non-blank message.

Rules for the apply path (`services/applications.py` and `routers/applications.py`):
- R0 Order of checks in `apply`: role (`SeekerOnlyError`), then `message is None and gate.listing_type ==
  'apartment'` → `MessageRequiredError` (422, nothing counted; a non-public apartment has no type there and
  falls through to the counted 404, so it reveals nothing), then the profile and the rest as today.
- R1 `consume_likes` becomes the pair read: under the pair's row lock it returns the pair's `lister_liked_at`
  and `price_ils_seen` as they were **before** clearing, e.g. `SELECT id, lister_liked_at, price_ils_seen FROM
  room_pairs WHERE … FOR UPDATE` and then the existing UPDATE (now `lister_liked_at = NULL` only). Under READ
  COMMITTED the `FOR UPDATE` waits for a running like and returns its committed row. Lock order listing
  (`FOR KEY SHARE`, unchanged) → pair → `applications`, the same as `like_person`. No pair row: no lock,
  nothing to read (an un-invited apply, R3).
- R2 Lister had liked → `_upsert` writes `status = 'shortlisted'`, `source = 'like'`, the message as sent (or
  NULL), price snapshot = the pair's frozen `price_ils_seen` (as `_mutual` did, 0008a); otherwise R3. It stays
  **one** `INSERT … SELECT … WHERE NOT flatmate_of(…) ON CONFLICT DO UPDATE … WHERE status = 'withdrawn'`
  with `status`, `source`, `message` and the snapshots taken from `excluded`, so the flatmate re-test (0008d)
  and the one-application rule hold on both branches. When the row is shortlisted, its conversation is inserted
  in the same transaction exactly as `_mutual` did (`id = application_id`, `seeker_read_at = now()`,
  `owner_read_at = NULL`, `ON CONFLICT (application_id) DO NOTHING`). `_mutual` is then deleted (its two
  callers, `like_room` and `like_person`'s mutual branch, are gone); this is the single writer of a
  like-sourced application. No new import cycle: `services/applications.py` already imports from
  `services/people.py` inside functions.
- R3 Lister had not liked (or no pair) → today's apply (`submitted`, `source = 'apply'`, the live price snapshot).
- R4 A withdrawn row is reopened the same way in both cases (R2's one statement), so two concurrent applies
  still yield one application and one `AlreadyAppliedError`; a refusal still runs today's flatmate check
  (404) before `AlreadyAppliedError`.
- R5 A lister like racing the seeker's apply: whichever takes the pair lock second sees the other's commit
  (the apply's `FOR UPDATE` returns `lister_liked_at` and shortlists; the like's UPDATE re-evaluates, then its
  post-lock `_has_application` sees the application and gets 409). No path creates two applications or a
  shortlisted application without a conversation.
- R6 Rate limits unchanged: apply counts `rl:apply:*`; the lister's like counts `rl:like:*`.
- R7 Chat event: `routers/applications.py::apply`, after the service committed, when the returned
  application's `status == 'shortlisted'`, publishes `chat_events.publish(r, chat_service.event_members(db,
  application, listing.owner_id), application.id, "status")` — the call `routers/people.py::like_room` makes
  today, so the lister's and the flatmates' open inbox/chat (SSE) refresh as they did for a mutual. A
  `submitted` apply publishes nothing (as today).

Code removed: `like_room`, `unlike_room` (service and router), `_mutual`, `pending_seeker_like`, the
`seeker_liked_at` branch of `_shown` (it becomes `people_visible`; `like_person`'s UPDATE keeps using it), the
`seeker_liked_at` order term in `list_people`, the seeker part of `like_state`, `search.liked_rooms`'s
`seeker_liked_at` column and filter (it returns lister-liked rooms only; `my_likes` loses `mine`),
`services/listings.py`'s `liked_me` subquery and `routers/listings.py`'s `liked_me_count`,
`RoomSectionRequiredError`, the schema fields above. `count_like`'s docstring drops "room likes". The module
docstrings of `services/people.py` and `services/applications.py` are rewritten for the invite. Run
`make client` (`web/src/api/schema.d.ts`).

## UI
- **Room page** (`features/listings/ListingPage.tsx`): the action column shows only the apply card; the
  `mutualId` state and the `LikeRoomButton` / `MutualBanner` render go. `LikeRoomButton.tsx` and
  `useLikeRoom.ts` are deleted (`likeRoom` / `unlikeRoom` in `likes/api.ts` too). `MutualBanner.tsx` stays (Out).
- **`ApplySection`** on a room: heading/button "אני מעוניין/ת", message field labelled optional
  ("הודעה (לא חובה)"), same 500 limit and counter; an empty message is sent as no `message` (the client-side
  "required" check stays for apartments only). When `listing.like?.liked_me` is true, a hint above the
  button: "המפרסמים כבר בחרו בך — פנייה תפתח צ'אט מיד". `Applied`: when `status === 'shortlisted'` it adds a
  link to `/chat/{application.id}` (existing key `applications.chat`); after a submit that comes back
  shortlisted, focus moves to that link (as `MutualBanner` did), otherwise as today. Apartments: unchanged.
- **Inbox and my applications** (`applicants/ApplicantCard.tsx`, `applicants/ApplicantPane.tsx`,
  `applications/MyApplicationsPage.tsx`): the message block renders when `message !== null`, independent of
  `source`; the "התאמה הדדית" tag still keys on `source === 'like'` (both can show). A room applicant without a
  message shows no empty message box.
- **`/me/likes`** (`MyLikesPage.tsx`): the "rooms I liked" section (`likes-mine`) is removed; "rooms that
  liked me" stays, each card is a plain link to the room page (where the seeker applies): `RoomList` loses
  `LikeRoomButton`, `like`, `onMutual`, `onToMine`, `onGone`; the `focusMine` / `mineRef` logic and the
  `'gone'` / `'alreadyApplied'` reasons go (`'personGone'` and the people part's `MutualBanner` stay). Empty,
  loading, error states as now. `LikesNavLink` count unchanged (it counts `liked_me`).
- **Map pins** (`features/search/useListingPins.ts`, `pins.ts`, the `Pin` mark type in
  `components/map/MapCanvas.tsx`, its `MARK_PATHS` entry): the `liked` set and the `'liked'` mark are removed; `useListingPins` no longer
  calls `useMyLikes`; applied pins already cover a seeker's rooms.
- **My listings** (`MyListingsPage.tsx`, `useCreateListing.ts`'s optimistic row): the liked-me chip and the
  field are removed (new applicants already show).
- **People browse** (`PeoplePage.tsx`, `PersonCard.tsx`, `useLikePerson.ts`): the "liked you" marker, the
  `Mutual` type, `onMutual`, the page's mutual banner and `refresh.mutual` are removed; a like flips the
  button as today.
- i18n: add `applications.room.cta` ("אני מעוניין/ת"), `applications.room.messageOptional` ("הודעה (לא
  חובה)"), `applications.room.invitedHint` (the hint above). Delete: `likes.like`, `likes.liked`,
  `likes.likedYouLine`, `likes.hint`, `likes.mine`, `likes.mineEmpty`, `likes.errors.*`, `people.likedMe`,
  `people.mutual`, `listings.mine.peopleLiked_*`, `search.map.pinLiked`. Keep `likes.mutual`, `likes.toChat`,
  `likes.title`, `likes.likedMe*`, `likes.badgeLabel_*`, `likes.toProfile`, `likes.people.*`. Reword
  `people.empty` without "או יאהבו את החדר". `make i18n-check` passes.
- RTL: no new layout (a hint line and a link in an existing card). Artboards: none changed; the room page drops a card.

## Acceptance criteria
- [ ] AC1 Given a room, when a signed-in seeker applies without a message (absent, null, or "   "), then 201
  `submitted`, `source: 'apply'`, `message: null` — `api/tests/test_applications.py::test_ac1_room_apply_without_message`
- [ ] AC2 Given a public apartment, when a seeker applies without a message, then 422 `{"detail":
  "message_required"}`, no row and no rate-limit count — `test_applications.py::test_ac2_apartment_needs_message`
  (`test_ac5_message_text_rules`' `json={}` case moves here)
- [ ] AC3 Given a lister liked a seeker in people browse, when that seeker applies (with and without a
  message), then 201 `shortlisted`, `source: 'like'`, the message as sent, a conversation exists
  (`seeker_read_at` set, `owner_read_at` null), the price snapshot is the pair's frozen price, `lister_liked_at`
  is cleared, and one `status` chat event went to the lister, the flatmates and the seeker (`published`
  fixture) — `test_applications.py::test_ac3_apply_answers_invite`; the flatmates case replaces
  `test_flatmates.py::test_ac10_mutual_match_includes_flatmates`
- [ ] AC4 Given AC3's pair after a withdraw, when the seeker applies again, then `submitted`, `source: 'apply'`
  (the invite was consumed) — `test_applications.py::test_ac4_reapply_after_invite_withdrawn`
- [ ] AC5 Concurrency: a lister like and the seeker's apply in parallel yield exactly one application, and if
  it is shortlisted it has its conversation — `test_applications.py::test_ac5_apply_racing_lister_like`
  (replaces `test_people.py::test_ac8_apply_racing_a_lister_like`; run 20 rounds as the old test does); a
  flatmate join racing an invited apply never yields both — `test_flatmates.py::test_ac8_join_racing_like_is_never_both`
  rewritten to apply on an invited pair
- [ ] AC6 `PUT` and `DELETE /listings/{id}/like` return 404 and are not in `/openapi.json` —
  `test_people.py::test_ac6_room_like_removed`
- [ ] AC7 People browse lists only opted-in candidates, cards have no `liked_me`, and a lister like returns
  `{liked: true}` — `test_people.py::test_ac7_browse_opted_in_only`
- [ ] AC8 `GET /me/likes` has no `mine`; `liked_me` still lists invites without an application —
  `test_people.py::test_ac8_my_likes_invites_only`
- [ ] AC9 Migration 0018 up on a DB with a pending seeker like, an invite and a mutual application; then a room
  apply without a message and an invite answer with one; down succeeds (placeholder / NULL as in Data), up again;
  autogenerate shows no diff — `api/tests/test_migrations.py::test_ac9_one_room_interest_upgrade_downgrade`
- [ ] AC10 Room page: no like button; the apply card says "אני מעוניין/ת", sends without a message, shows the
  invite hint when `like.liked_me`, and after a shortlisted reply shows the tag and the chat link with focus on
  it — `web/src/features/applications/__tests__/ApplySection.test.tsx`
- [ ] AC11 `/me/likes` renders without the "rooms I liked" section and without a like button on "rooms that
  liked me" — `web/src/features/likes/__tests__/MyLikesPage.test.tsx`
- [ ] AC12 E2E: a lister likes a seeker in people browse, the seeker opens the room from `/me/likes`, applies
  without a message, sees "התאמה הדדית", follows the chat link and sends a message the lister receives —
  `web/e2e/likes.spec.ts::ac9_seeker_answers_invite_and_chats` (replaces `ac9_seeker_likes_back_and_chats`)
- [ ] AC13 axe passes on the room page and `/me/likes` in AC12's run (`expectNoAxeViolations` from
  `web/e2e/a11y.ts`, as the old test does)
- [ ] AC14 The inbox card/pane and "my applications" show a message on a `'like'` row that has one and no
  empty box on an `'apply'` row without one — `web/src/features/applicants/__tests__/ApplicantsPage.test.tsx`
  (`ac8_mutual_tag` extended), `web/src/features/applications/__tests__/MyApplicationsPage.test.tsx`

## Tests to write
Unit/integration: AC1–AC9 above. Existing API tests (rule: assertions about a seeker room-like, `mine`,
`liked_me_count`, `PersonOut.liked_me` or `LikeOut.application_id` go or switch to invite + apply; lister-like,
browse and flatmate assertions stay):
- `test_people.py`: delete `ac7_mutual_becomes_shortlisted_application`, `ac8_concurrent_second_likes`,
  `ac8_apply_racing_a_lister_like` (moved, AC5), `ac10_seeker_like_gates_and_limit`,
  `ac11_like_shares_card_with_that_room_only` (AC7 replaces), `ac5_like_room_needs_both_parts`; rewrite
  `ac9_mutual_lifecycle` as invite → apply → withdraw, `ac12_listing_like_state_and_count` (`like` =
  `{liked_me}`, no count), and update `ac1` (order), `ac3` (card keys), `ac4_room_likes_and_browse_for_any_account`,
  `ac6_lister_like_unlike`, `ac9_apply_consumes_pending_likes`, `ac12_withdrawn_applicant_like_not_revived`,
  `ac6_no_looking_part_leaves_people_browse`, `ac6b_my_likes_without_looking_part`; drop `_like_room` /
  `_mutual` helpers and `NO_LIKE`'s `liked_by_me`.
- `conftest.py::make_pair`: drop `seeker_liked`.
- `test_flatmates.py`: `ac8_flatmate_cannot_apply_or_like_own_flat` (like part goes; `liked_me_count` asserts
  go), `ac8_join_racing_like_is_never_both` (AC5), `ac10_mutual_match_includes_flatmates` (AC3).
- `test_direct_chat.py:427`, `test_person_photo.py:342`: replace `_like_room` with a lister like (invite).
- `test_search.py:488/492`, `test_room_search.py:195` (`like` shape), `test_inbox.py:55`,
  `test_listings.py:404` (`liked_me_count`), `test_applications.py::test_ac5_message_text_rules` (`{}` case).
- `test_migrations.py`: the 0011 test's `seeker_liked_at` insert runs at 0011 and stays.

Web: AC10, AC11, AC14; `ListingPage.test.tsx` like block (`likeRoom(...)`, ~L1089–1340) rewritten for the
hint/apply card; `MyListingsPage.test.tsx` and `listings/__tests__/fixtures.ts` (`liked_me_count`);
`pins.test.ts` and `SearchMap.test.tsx` (`liked` mark, `/me/likes` mocks, `ac7_owner_on_the_market_gets_liked_and_applied_marks`
→ applied only); `PeoplePage.test.tsx` and `people/__tests__/fixtures.ts` (`liked_me`, mutual);
`likes/__tests__/fixtures.ts` (`myLikes` without `mine`). Untyped `{ liked_me: [], mine: [] }` mocks in
`app/__tests__/*` may stay.

E2E and `make screens`: AC12; `helpers.ts` (`likeRoom` deleted, `likePerson` returns nothing);
`people.spec.ts::ac10_owner_likes_back_and_chats` becomes "owner likes, seeker applies, chat" or is folded into
AC12 (it also asserts `peopleLiked_one` and `people.likedMe`); screens mocks: `listing.screens.ts` (`like`
shape, the `likedYouLine` state → invite hint, `/me/likes` mock), `people.screens.ts` (`liked_me_count`,
`liked_me`, the `'mutual'` like mode), `seeker-lists.screens.ts` (`like` mode and the `PUT /listings/{id}/like`
route), `fixtures-seeker.ts` (`LIKES.mine`), `fixtures-listings.ts`, `fixtures-flatmates.ts`,
`fixtures-my-listings.ts`, `applicants.screens.ts` (`liked_me_count`). `market.spec.ts` and
`people-market.spec.ts` have no room likes (checked); `people-market.spec.ts::ac19` keeps `MutualBanner`.
**E2E runs in CI only** (no local e2e).

## Risks / open questions
- **Q1 decided (Gilad 2026-11-14):** the message on a room is **optional**; apartments keep it required.
- **Q2 decided (Gilad 2026-11-14):** pending seeker room-likes are **dropped** by the migration (no real users
  before launch).
- Biggest risk: breadth (~45 files, most of it deletion). It cannot be split into an API and a web PR:
  `make client` regenerates `schema.d.ts`, and the web stops type-checking the moment `liked_by_me`, `mine`,
  `liked_me_count` and the like endpoints leave the schema. The coder works API first (migration, service, tests,
  `make client`), then fixes every `tsc` error, then i18n and e2e.
- Verifier (resolved): R1's `SELECT … FOR UPDATE` keeps listing → pair → applications; R2 folds `_mutual` into
  `_upsert` (keeps the 0008d flatmate re-test, which `_mutual` lacked); R7 names the chat event's publisher.

## Blast radius
From `graphify affected` on `main` (d617753) plus grep for column/field names the graph does not hold:
- `seeker_liked_at` (column; graph: none) — `services/people.py` (`consume_likes`, `_shown`, `pending_seeker_like`,
  `list_people` select/order, `_mutual`, `like_person`, `like_room`, `unlike_room`, `like_state`),
  `services/search.py::liked_rooms`, `routers/people.py` (`_person_out` L101, `my_likes`), `models/room_pair.py`,
  `tests/conftest.py::make_pair`, `test_people.py` (L174, 576–925, 1210), `test_migrations.py:1375` (0011, stays).
- `like_room` (service) — `routers/people.py::like_room`, `test_flatmates.py::test_ac8_join_racing_like_is_never_both`,
  `test_people.py` (`call()` L693, `_like_room`), via `_like_room`: `test_direct_chat.py`, `test_flatmates.py`,
  `test_person_photo.py`. All in Scope.
- `unlike_room` — `routers/people.py::unlike_room`. In Scope.
- `like_state` — `routers/search.py::get_listing` (L157): keeps calling it, now `{liked_me}`.
- `LikeStateOut` (api) — re-exported by `schemas/people.py`, imported by `routers/people.py`, `services/people.py`,
  `test_people.py`; the graph's `schemas/market_people.py` / `services/market_people.py` edges are module-level
  only (they use their own `liked_by_me` on market cards, untouched). (web) `likes/api.ts` type, used by
  `LikeRoomButton`, `useLikeRoom`, `MyLikesPage`, `MyLikesPage.test.tsx`; `ListingPage.tsx`, `routes.tsx` via imports.
- `pending_seeker_like` — `services/listings.py::list_own_listings` (L128) → `routers/listings.py::my_listings`
  (L65), `test_listings.py`. The other "imports_from" hits are module-level only.
- `liked_me_count` (field; graph: none) — `schemas/listing.py:324`, `routers/listings.py:73/81`,
  `services/listings.py`, `test_listings.py:404`, `test_inbox.py:55`, `test_flatmates.py:861/864`,
  `test_people.py:1074–1134`; web `MyListingsPage.tsx`, `useCreateListing.ts`, `listings/__tests__/fixtures.ts`,
  `MyListingsPage.test.tsx`, `useLikePerson.ts` (comment); e2e `fixtures-listings.ts`, `fixtures-flatmates.ts`,
  `fixtures-my-listings.ts`, `people.screens.ts`, `applicants.screens.ts`.
- `liked_by_me` on `ListingDetail.like` — `test_search.py:488`, `test_room_search.py:195`, `test_people.py`
  (`NO_LIKE`, L1083/1090), `ListingPage.test.tsx`, `MyLikesPage.tsx`, `LikeRoomButton`, `useLikeRoom`,
  `listing.screens.ts:112`. Untouched: `PersonOut.liked_by_me` (the lister's own like) and every market
  `liked_by_me` (`MarketPersonCard`, `useMarketPeople`, `market-people.screens.ts`, `test_market_people.py`).
- `PersonOut.liked_me` — `routers/people.py:101`, `PersonCard.tsx:123`, `PeoplePage.test.tsx`,
  `people/__tests__/fixtures.ts`, `people.screens.ts`, `test_people.py` (L277/283/1049).
- `MyLikesOut` (api) — `routers/people.py::my_likes`, `main.py` (openapi). (web) `likes/api.ts`,
  `likes/__tests__/fixtures.ts`, `MyLikesPage.test.tsx`, e2e `fixtures-seeker.ts`, `seeker-lists.screens.ts`,
  `listing.screens.ts`.
- `LikeOut` — `routers/people.py::like_person`; web `people/api.ts`, `PersonCard.tsx` (L85), `useLikePerson.ts`
  (L47), `people.screens.ts:193`, e2e `helpers.ts::likePerson`.
- `consume_likes` — `services/applications.py::_upsert` (L152) ← `apply` (L255); `test_people.py`,
  `test_applications.py`, `test_flatmates.py` import it. Other hits module-level.
- `_mutual` (`services/people.py`) — `like_person`, `like_room`, `test_flatmates.py:986`, `test_people.py`
  (`lister()` L894, `call()` L677/693). Deleted; tests rewritten. (`PersonCard.tsx::Mutual` type removed;
  `market_people.py::_mutual` is a different function, untouched.)
- `ApplicationIn` — `routers/applications.py::apply`; `main.py` (openapi); web `applications/api.ts` / `useApply.ts`
  via the generated type. `routers/people.py` / `market_people.py` hits are module-level only.
- `LikeRoomButton` — `ListingPage.tsx` (L209), `MyLikesPage.tsx` (`RoomList` L77); tests that render those pages:
  `ListingPage.test.tsx`, `ApplySection.test.tsx`, `ProfileNudge.test.tsx`, `MyLikesPage.test.tsx`, `routes.tsx`.
- `MutualBanner` — `ListingPage.tsx` (L205, removed), `MyLikesPage.tsx` (L346, **kept** for people matches),
  `MarketPeoplePage.tsx` (L178, **kept**), `MarketPeoplePage.test.tsx`, `people-market.spec.ts`. Not deleted.
- `useLikeRoom` — `LikeRoomButton.tsx` only. Deleted with it.
- `useMyLikes` — `LikesNavLink.tsx` (kept), `MyLikesPage.tsx` (kept), `AuthMenu.tsx` (kept, counts `liked_me`),
  `useListingPins.ts` (call removed) → `SearchMap.tsx`, `SideMap.tsx`, `SearchMap.test.tsx`.
- Readers of `source` to decide the message (not in the graph's lists): `ApplicantCard.tsx` (L254),
  `ApplicantPane.tsx` (L122), `MyApplicationsPage.tsx` (L116), `ApplySection.tsx` (L291, tag only).

## Digest (filled by orchestrator after verification)
Verified 2026-11-14 (one spec-verifier round, Opus/high; verdict ready, no product question). On a room the
seeker has one action, the application (message optional); the seeker's room-like, its endpoints and
`room_pairs.seeker_liked_at` go (migration 0018, pending likes dropped); a lister's like in people browse is an
invite that the seeker's application answers with a shortlisted "mutual match" and an open chat. Verifier
changes: `_mutual` folded into `_upsert` (keeps the flatmate re-test), the apply router publishes the chat
event on a shortlist, `MutualBanner` kept (person matches use it), the inbox shows a message whenever there is
one, an honest downgrade, a full blast-radius list. One large coder run (~45 files, mostly deletion).

Built 2026-11-14 (merged shape; PR open, not merged — Gilad merges):

    Spec 0010l — one room interest, the application   IN REVIEW (PR open, ready-to-merge)
    Shipped: on a room the seeker has one action, "אני מעוניין/ת" (message optional; still required on an
      apartment); the room-like and its endpoints are gone (migration 0018); a lister's like in people browse is
      an invite, and the seeker's application to it is shortlisted at once with an open chat.
    Demo: 1. as a lister open people browse on your room and like a seeker  2. as that seeker open /me/likes,
      open the room, press "אני מעוניין/ת" with no message  3. see "התאמה הדדית" and follow "לצ'אט עם המפרסמים".
    Tests: api +11 / −7 (pytest 582 green), web unit +8 / −12 rewritten (vitest 687 green), e2e 2 rewritten
      (likes.spec ac9 invite → apply → chat, axe on /me/likes and the room page). CI: on the PR.
    Findings: 0 blockers; 2 majors fixed (an invite could outlive an application in a browse+like race —
      now a (listing, seeker) advisory lock, with a test that drives the race; `make screens` hung on the
      removed "liked" pin); 4 minors fixed (header likes badge refresh, room chat-link copy, race test made
      event-driven, a flatmate's stale invite hidden); 9 nits dropped; 4 follow-ups logged.
    Changed in PRODUCT.md: nothing beyond the 2026-11-14 decision already recorded.
    Decision for you (optional): an invite has no expiry and survives the seeker opting out of browse —
      keep (recommend; it is the seeker's own action) or expire it. Logged in FOLLOWUPS.
