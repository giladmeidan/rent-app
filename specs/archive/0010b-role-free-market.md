---
id: 0010b
title: Inside שוק השותפים there are no owner or seeker roles. Any account posts and manages a room, applies to and likes rooms, has a profile and sees its own listing marked as its own. Apartments keep their roles (only owners post apartments, only seekers apply to them), and signup from the market asks no role question
status: done
depends_on: [0010a]   # side.ts / sideOf, /market/mine and its two-panel Tabs, the per-side bottom bar, SearchPage type, wizard initialType (MARKET-PLAN section 7). Builds in wave 2 beside 0010g (no shared files)
reviewers: [code, qa, security, ux]   # security: every role gate in the API is swapped for current_user + ownership, and the room-privacy rule (decision 13) changes; ux: the market bar for every account, signup without the role question, own-listing states
estimate: 1 coder run   # coder Opus/high (auth gates, Speed rule 6). About 15 gate swaps, 13 role-gate tests and ~12 web files
---

## Goal
After this ships, any signed-in account can do every room action:
- post a room, edit it, pause it, and see its applicants;
- browse and like people for it, and manage its flatmates;
- apply to someone else's room, like rooms, and see its likes;
- keep the housing profile (`/me/profile`).

Apartments keep today's roles: only an **owner** posts an apartment, and only a **seeker** applies to one.
Every listing response says `is_mine`, so the caller's own room shows as theirs (labelled on cards, no apply or
like on its page) and is never hidden from them.

The room-privacy rule (flatmate ages and answers) moves from "role seeker" to "role seeker **or** has a profile"
(Gilad's answer to decision 13, 2026-11-13). Every account gets the same market bar: שוק · לייקים · שלי · צ'אט ·
פרופיל. "שלי" shows both the rooms and the room applications. Someone who signs up from the market is not asked
owner or seeker and is stored as a seeker.

This is `specs/MARKET-PLAN.md` section 3 "Step 2" and section 7, and PRODUCT.md "שוק השותפים" (decisions 3,
13; Q9 "a person looking" is the existing profile open to every account; Q10 signup from the market).

## Scope
**In — API.** One rule replaces the role gates. A room action is `current_user` plus the ownership checks that
already exist in the services. The role is read in exactly two places: creating an apartment (owner) and
applying to an apartment (seeker).
- `api/app/auth.py`: `current_owner` and `current_seeker` are deleted (no caller is left). `optional_user`
  and `current_user` are unchanged.
- `api/app/routers/listings.py` (module docstring rewritten):
  - `POST /listings` takes `UserDep = Annotated[User, Depends(current_user)]`. Before the service it checks
    `if body.listing_type == "apartment" and user.role != "owner": raise HTTPException(403, "owner_only")`.
    Nothing is locked or counted first. A room is open to any account. The live cap (`users.listing_cap`,
    `_lock_owner_cap`) applies to every account, shared by both types (Q5).
  - `GET /me/listings` and `PATCH /listings/{id}` take `current_user`. The service already filters on
    `owner_id == user.id`, so another's listing is the same 404. A seeker's own room appears in their list.
  - `_AUTH_ERRORS` keeps 403 only on the POST, described as "owner_only: an apartment by a non-owner".
- `api/app/routers/applications.py` (docstring rewritten):
  - `apply` takes `current_user`. `my_applications` and `withdraw` take `current_user` (they read only the
    caller's rows).
  - `list_applicants` and `set_applicant_status` take `current_user`. `services/applications.py` already
    answers 404 for another's listing.
  - `_SEEKER_ONLY` / `_OWNER_ONLY` become one `_SESSION` (401), plus 403 `seeker_only` on `apply` alone.
- `api/app/services/applications.py::apply`:
  - The existing first SELECT (`gate`, `:190-195`) gains a third column,
    `search_service._public_listings().with_only_columns(Listing.listing_type).where(Listing.id ==
    listing_id).scalar_subquery().label("listing_type")`, in the same statement, so no statement is added. It
    reads the type of a **public** listing only, so a paused, expired or inactive-area id is NULL, like an
    unknown one (verifier finding 2: no uncounted 403 that would tell a non-public listing from an unknown id).
  - Right after it, **before** the profile check: `if gate.listing_type == "apartment" and seeker.role !=
    "seeker": raise SeekerOnlyError` (new exception, router → 403 `seeker_only`). It is not rate-limited. The
    parameter keeps its name `seeker`; the docstring's "Raises, in this order" list gains it first.
  - An unknown or non-public id has `listing_type` NULL and falls through to today's path (counted 404).
  - The own-listing and flatmate guards (`:207-211`) are unchanged.
- `api/app/routers/people.py` (docstring rewritten):
  - `list_people`, `like_person` and `unlike_person` take `current_user`. `services/people.py::list_people` /
    `like_person` / `unlike_person` already answer 404 for a listing that is not the caller's own room.
  - `like_room`, `unlike_room` and `my_likes` take `current_user`. `like_room` already refuses the caller's own
    room, an apartment and a flat they live in (404), and asks for a profile (409 `seeker_profile_required`,
    `room_section_required`).
  - `my_likes` (`:240`) builds `LikedRoomOut.listing`, a `ListingPublic`, with `from_listing(..., seeker=True,
    match=match)`. It passes `is_mine=False` too (`liked_rooms` never returns the caller's own room,
    `services/search.py:215`), or the response fails validation.
  - `OwnerDep` / `SeekerDep` go.
- `api/app/routers/flatmates.py`: the four owner endpoints (`create_invite`, `disable_invite`,
  `list_flatmates`, `remove_flatmate`) take `current_user`. `services/flatmates.py` already answers 404 for
  another's listing (and an apartment on the invite). `OwnerDep` goes.
- `api/app/routers/profiles.py`: `GET` / `PUT /me/profile` take `current_user`. `services/profiles.py` has no
  role check (`:50`). `0010c` reshapes the body later; this spec changes only the gate.
- `api/app/routers/search.py` — **the seeker rule (decision 13)**:
  - `_profile_user_id(db, user)` returns `user.id` when `user is not None and
    profiles_service.has_profile(db, user.id)`, for **any** role (was seekers only). So any account with a
    profile gets `match`, the `match` default sort and the misfit-room filter.
  - The no-statement `_is_seeker(user)` is replaced by `_sees_room_privacy(user, profile_user_id) -> bool`:
    `user is not None and (user.role == "seeker" or profile_user_id is not None)`. The search and the listing
    page pass it as `seeker=` to `from_listing`. This is MARKET-PLAN section 7's sentence, with
    `has_profile` read through `_profile_user_id`'s one PK lookup.
  - Statements: a seeker's request is unchanged (`_profile_user_id` already ran for them). An owner's signed-in
    request gains that one PK lookup.
  - `get_listing`'s like state: `if user is not None and listing.listing_type == "room" and listing.owner_id !=
    user.id` (the `_is_seeker` term goes). `like_state` is the existing one-statement read.
  - **`is_mine`**: `ListingPublic` gains `is_mine: bool` (inherited by `ListingDetail`). Both routers pass
    `is_mine=user is not None and listing.owner_id == user.id` through `from_listing`'s `**fields`, so no
    statement is added.
  - For an own listing the router also passes `match=None` (no score for your own listing). The order of a
    `match` sort is unchanged.
- `api/app/services/search.py::search_listings`: the fit filter becomes
  `or_(room_fit(Listing, SeekerProfile).is_not(False), Listing.owner_id == profile_user_id)`. The caller's own
  room is never hidden from them, even when it would not "fit" them (a woman listing a men-only room). It is
  labelled, not hidden (MARKET-PLAN section 3 rec). The same predicate, in the same statement, so the count
  and the page still agree.
- Docstrings and comments, with no behaviour change:
  - `routers/search.py`'s module docstring (`:11-14`, "only a signed-in seeker gets them") and
    `services/people.py::like_state`'s docstring follow the new rules;
  - the web comments built on "403 → `RequireOwner` / `RequireSeeker` leaves the page" are reworded:
    `useSetApplicantStatus.ts:15`, `useLikePerson.ts:13`, `PersonCard.tsx:41`, `ApplicantCard.tsx:142`,
    `ProfilePage.tsx:142,612`, `useMyLikes.ts:12`, `MyLikesPage.tsx:83`, `PeoplePage.tsx:29`,
    `FlatmatesPage.tsx:296`, `ApplicantsPage.tsx:52`.
- `api/app/schemas/search.py`:
  - The module docstring and the `SEEKER_ONLY_FIELDS` comment change "a signed-in seeker" to "a signed-in
    seeker, or any account with a profile (decision 13)".
  - `is_mine` is listed in `ListingPublic` with the comment "the caller owns it (spec 0010b); false for a
    visitor".

**In — Web.** Market for everyone, apartments by role:
- `web/src/app/routes.tsx` guards:
  - **`RequireUser`:** `listings/new`, `me/listings/:id/edit`, `me/listings/:id/applicants`,
    `me/listings/:id/people`, `me/listings/:id/flatmates`, `me/likes`, `me/profile` (and `market/mine`, as in
    0010a).
  - **`RequireOwner`:** only `me/listings` (the apartments page).
  - **`RequireSeeker`:** only `me/applications` (apartment applications).
  - The comments at `RequireOwner.tsx:10-11` and `RequireSeeker.tsx` name those single routes.
- `web/src/features/listings/NewListingPage.tsx`: for a non-owner, `initialType` is always `'room'`, whatever
  `?type=` says. A non-owner never sees the apartment option or `TypeStep`. An owner keeps 0010a's behaviour.
- `web/src/features/auth/AuthMenu.tsx`:
  - The market bar is the same for every account: שוק `/market` · לייקים `/me/likes` · שלי `/market/mine` ·
    צ'אט · פרופיל `/me/profile` (MARKET-PLAN section 7, "0010b on"). The apartments bar keeps 0010a's per-role
    tabs.
  - The anonymous "כניסה" link is `/login?next=%2Fmarket` while `useSide() === 'market'` (so a new email that
    signs up through login gets the market rule below), and `/login` otherwise.
- `web/src/features/market/MarketMinePage.tsx`: `panels = ['listings', 'applications']` for every account. The
  pill tablist shows, and `?tab=applications` opens the second panel.
  `JoinFlatPage.tsx:46`'s `applied` outcome now links to `/market/mine?tab=applications` (0010a left it at
  `/market/mine`).
- `web/src/features/applications/canApply.ts` (new) is the one rule both apply surfaces read:

  ```ts
  /** Whether the signed-in `me` may apply to (or like) `listing`. */
  export function canApply(me: UserOut, listing: Pick<ListingDetail, 'listing_type' | 'is_mine'>): boolean {
    return !listing.is_mine && (listing.listing_type === 'room' || me.role === 'seeker');
  }
  ```
  - `ApplySection.tsx:328-331`: `isSeeker` becomes `me.data != null && canApply(me.data, listing)`, so the
    list and profile are requested exactly when the form can show.
  - `isOwner` (the `<h2>` at `:467` and the count line) becomes `ownerView = listing.is_mine || (me.data?.role
    === 'owner' && listing.listing_type === 'apartment')`. Your own listing, and an owner on any apartment,
    keep `applications.headingOwner` / `countOwner`, as today. On someone else's room an owner sees the
    applicant wording and the form.
  - A new branch **before** the `!isSeeker` one: `listing.is_mine` → the own-listing note `applications.own`
    with a ghost link `applications.manage` → `/market/mine` (room) or `/me/listings` (apartment).
  - A signed-in non-seeker on an apartment keeps today's `none` branch.
  - The visitor signup link stays `?role=seeker&next=…` (see Risks).
- `web/src/features/listings/ApplyBar.tsx:26`: `isSeeker` becomes `me.data != null && canApply(me.data,
  listing)`.
- `web/src/features/listings/ListingPage.tsx:46`: the mutual banner shows to any signed-in account (`useMe().data
  != null`). The like control already shows only when the API sends `like`.
- `web/src/features/search/SearchPage.tsx:39`, `web/src/features/match/MatchCard.tsx:38`: `useProfile(me.data !=
  null)`. Any signed-in account may have a profile.
- `web/src/features/match/ProfileNudge.tsx:14`: it shows to a signed-in account without a profile on the market
  side (`useSide() === 'market'`), and to a seeker without one on the apartments side.
- `web/src/features/listings/ListingCard.tsx`: when `listing.is_mine` (search, map and liked cards that carry
  it), a neutral `Tag` as the first item of the card's chips list (`ListingCard.tsx:218`, not the photo-box
  type tag): `listings.card.mineRoom` on a room, `listings.card.mineApartment` on an apartment. `MyListingsPage` cards have no `is_mine` field and are
  unchanged.
- `web/src/features/chat/ConversationsPane.tsx:182`: the empty line is one generic `chat.list.empty`. The
  flatmate line (`chat.list.emptyFlatmate`) stays as it is.
- Signup and login without the role question (Q10):
  - `web/src/features/auth/OtpForm.tsx`: `const askRole = !(initialRole === null && sideOf(nextPath(next)) ===
    'market')`, where `nextPath` drops the query and hash of `next` (already `safeNext`-ed).
  - When `askRole` is false, the `profileNeeded` effect (`:167-171`) focuses `nameRef` in place of
    `input[name="role"]`. The role `ChoiceGroup` is not rendered, `role` starts as `'seeker'`, and the
    "choose a role" hint never shows. This holds in both places the role is asked: signup step 1, and login's
    unknown-email step 2 (`:113`, `:214-221`, `:369-373`, `:426`).
  - The request body still carries `role: 'seeker'` (the API is unchanged).
  - `SignupPage.tsx` passes `next` (already does).
- `web/src/locales/he.json`:
  - **New keys:**

    | Key | Hebrew |
    | --- | --- |
    | `listings.card.mineRoom` | "החדר שלכם" |
    | `listings.card.mineApartment` | "המודעה שלכם" |
    | `applications.own` | "זו המודעה שלכם. את המועמדויות מנהלים מעמוד המודעה." |
    | `applications.manage` | "לניהול המודעה" |
    | `chat.list.empty` | "אין עדיין שיחות. שיחה נפתחת כשמועמדות עוברת לרשימה הקצרה, או כשיש התאמה הדדית." |

  - **Rewritten keys** (the role now means apartments only):

    | Key | Hebrew |
    | --- | --- |
    | `auth.role.label` | "מה מחפשים כאן?" |
    | `auth.role.owner` | "מפרסמים דירה להשכרה" |
    | `auth.role.seeker` | "מחפשים דירה" |

  - **Deleted keys:** `chat.list.emptyOwner` and `chat.list.emptySeeker` (each holds a slash form).
  - `make i18n-check` passes.

**Out:**
- The profile split (personal + "looking for"), the re-worded visibility switch, and `has_profile` meaning
  "the looking part is filled" (`0010c`). Here `has_profile` keeps meaning "a row exists", which today requires
  the whole housing block.
- People browse people, person likes, the entry ticket (`0010h`). Photos (`0010d`/`0010e`). Flat profile
  (`0010f`).
- A role switch for apartments (PRODUCT.md "Account roles", still "slice TBD"). An owner who wants to apply to an
  apartment still cannot.
- Dropping `users.role` or its CHECK: it still gates apartments. No migration.
- The web's `LISTING_CAP = 3` constant (FOLLOWUPS:32), unchanged.

**New dependencies:** none.

## Data
None. No migration. `users.role` stays `owner | seeker`. A market signup stores `seeker`.

## API
`UserDep` = `current_user` (401 `unauthenticated` without a session). "Own" = the services' existing
`owner_id == caller` check, whose failure is the same 404 `not_found` as an unknown id.

| Method | Path | Auth rule (was) | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| POST | `/listings` | `current_user`; an apartment needs `role = owner` (was `current_owner`) | `ListingIn` | 201 `ListingOut` | 401; 403 `owner_only` (an apartment by a non-owner); 409 `listing_cap_reached`; 422 |
| GET | `/me/listings` | `current_user`, own rows (was owner) | — | 200 `list[MyListingOut]`, both types | 401 |
| PATCH | `/listings/{listing_id}` | `current_user`, own listing (was owner) | `ListingPatch` (0010a) | 200 `ListingOut` | 401; 404; 409; 422 |
| POST | `/listings/{listing_id}/applications` | `current_user`; an apartment needs `role = seeker` (was `current_seeker`) | `ApplicationIn` | 201 `MyApplicationOut` | 401; 403 `seeker_only` (an apartment by a non-seeker, not counted); 404; 409 as today; 429 |
| GET | `/me/applications` | `current_user`, own rows (was seeker) | — | 200 | 401 |
| POST | `/me/applications/{application_id}/withdraw` | `current_user`, own application (was seeker) | — | 200 | 401; 404; 409 |
| GET | `/listings/{listing_id}/applications` | `current_user`, own listing (was owner) | `?sort` | 200 | 401; 404 |
| PATCH | `/listings/{listing_id}/applications/{application_id}` | `current_user`, own listing (was owner) | `ApplicantStatusIn` | 200 | 401; 404; 409 |
| GET | `/listings/{listing_id}/people` | `current_user`, own live room (was owner) | `?offset` | 200 | 401; 404; 409 `listing_not_live` |
| PUT, DELETE | `/listings/{listing_id}/people/{person_id}/like` | `current_user`, own room (was owner) | — | as today | 401; 404; 409; 429 |
| PUT, DELETE | `/listings/{listing_id}/like` | `current_user`, not own (was seeker) | — | as today | 401; 404; 409 `seeker_profile_required`, `room_section_required`, `room_gender_mismatch`, `already_applied`; 429 (DELETE: 401 or 204) |
| GET | `/me/likes` | `current_user` (was seeker) | — | 200 `MyLikesOut` | 401 |
| POST, DELETE | `/listings/{listing_id}/flatmate-invite` | `current_user`, own room (was owner) | — | as today | 401; 404 |
| GET | `/listings/{listing_id}/flatmates`; DELETE `/listings/{listing_id}/flatmates/{flatmate_id}` | `current_user`, own listing (was owner) | — | as today | 401; 404 |
| GET, PUT | `/me/profile` | `current_user` (was seeker) | `SeekerProfileIn` | as today | 401; 404 `seeker_profile_not_found` (GET); 422 |
| GET | `/listings`, `/listings/{listing_id}` (changed) | public (`optional_user`) | as 0010a | `+is_mine`; ages and answers to role seeker **or** anyone with a profile; `match` for anyone with a profile, `null` on own; own room never hidden by fit; `like` for any signed-in non-owner on a room | as today |

## UI
No artboard (PRODUCT.md: no new artboards). Kit only.
- **Bottom bar, market side**: five tabs for every account, as listed above. The apartments side is unchanged
  from 0010a.
- **`/market/mine`**: `<h1>` "שלי", then the pill tablist "החדרים שלי" / "מועמדויות לחדרים". Each panel keeps
  0010a's states: list, empty with CTA, loading, error.
- **Listing page, own listing**: no apply form, no apply bar, no like control. The action card shows the
  applicant count in the owner's wording, then "זו המודעה שלכם…" and a ghost "לניהול המודעה" link.
- **Cards**: the own listing carries a neutral `Tag` "החדר שלכם" / "המודעה שלכם" as the first chip, on search
  and map cards.
- **Signup / login from the market** (`next` on the market side): name + email only. No role radios, no
  "choose a role" hint.
- **Wizard for a non-owner**: always the room flow (3 steps, as 0010a's `?type=room`).
- **Chat list empty**: one line for everyone.

## Acceptance criteria
- [ ] AC1 Given a seeker `S` (no listings), When `S` POSTs a room, Then 201, and `GET /me/listings` lists it.
  `S` PATCHes its price (200), pauses it, and `S`'s fourth live room (cap 3, shared with apartments) is 409
  `listing_cap_reached`. When `S` POSTs an apartment, Then 403 `owner_only` and no row, with no cap lock taken
  (no `SELECT … FOR UPDATE` in the statement log). An owner PATCHing `S`'s room gets 404. Anonymous calls are
  401. This replaces `test_ac2_requires_owner_session`. —
  `api/tests/test_listings.py::test_ac2_rooms_for_any_account_apartments_for_owners`
- [ ] AC2 Given owner `O` with a full profile (inserted with `make_profile`) and someone else's live room `R`
  that fits, When `O` applies to `R`, Then 201, and `O`'s `GET /me/applications` lists it and `O` can withdraw it.
  When `O` applies to an apartment, Then 403 `seeker_only`, and the hourly apply counter is 0. That holds also
  when `O` has no profile, because the role check runs before the profile check. An unknown id is still the
  counted 404. `test_applications.py`:
  - `test_ac2_only_seekers_apply_never_to_own_listing` becomes `test_ac2_apartments_need_a_seeker_rooms_anyone`;
  - `test_ac6_my_applications_own_only_newest_first` (owner → 200 `[]`) and `test_ac7_withdraw_own_application`
    (an owner withdrawing another's application → 404) are amended;
  - `test_ac9_apply_rate_limits` (`:576`, an owner on an apartment → 403, not counted) passes unchanged.
  
  — `api/tests/test_applications.py::test_ac2_apartments_need_a_seeker_rooms_anyone`
- [ ] AC3 Given seeker `S` with room `R` and applicant `A`, When `S` lists `R`'s applicants and shortlists `A`,
  Then 200 and the chat opens. Another account doing the same gets 404. In `test_inbox.py`,
  `test_ac2_applicants_are_owner_only` becomes `test_ac2_applicants_are_the_listers_only` (a seeker on another's
  listing → 404, not 403), and `test_ac5_patch_ownership_and_validation` (`:474`) gets 404. —
  `api/tests/test_inbox.py::test_ac3_any_account_runs_its_room_inbox`
- [ ] AC4 Given seeker `S` with a live room `R`, When `S` browses `R`'s people and likes a candidate, Then 200,
  and an account that is not `R`'s lister gets 404 (no longer 403). When owner `O` with a room-section profile
  likes `R` and reads `/me/likes`, Then 200 and `R` is listed. `O` liking `O`'s own room is 404 (or 409
  `seeker_profile_required` without a profile, which is checked first). `test_people.py`:
  - `test_ac4_people_errors` (`:408-409` → 404);
  - `test_ac6_lister_like_unlike` (`:525` → 404);
  - `test_ac10_seeker_like_gates_and_limit` (`:960` → 409 `seeker_profile_required`; `:977` → 204).
  
  — `api/tests/test_people.py::test_ac4_room_likes_and_browse_for_any_account`
- [ ] AC5 Given seeker `S` with a room, When `S` creates, rotates and disables its invite link and lists and
  removes a flatmate, Then each succeeds. Another account gets 404. `test_flatmates.py::test_ac1_invite_create_rotate_disable`
  (`:305-308` → 404) and `test_ac6_remove_and_rejoin` (`:729-730` → 404) are amended. —
  `api/tests/test_flatmates.py::test_ac5b_any_lister_manages_flatmates`
- [ ] AC6 An owner `GET /me/profile` with none gets 404 `seeker_profile_not_found`, then `PUT` → 200, then
  `GET` → the saved body. Anonymous calls are 401. `test_ac3_profile_is_seeker_only` becomes
  `test_ac3_profile_for_any_account`. — `api/tests/test_profiles.py::test_ac3_profile_for_any_account`
- [ ] AC7 (security, decision 13) For a room with ages `[27, 30]` and two answers, `GET /listings?listing_type=room`
  and `GET /listings/{id}` return them to:
  - a seeker without a profile (role);
  - an owner with a profile (has_profile).

  They return `[]` and `{}` to:
  - an owner without a profile;
  - a visitor;
  - an expired cookie.

  An owner with a profile also gets `match` (non-null) and the `match` default sort. `test_room_search.py::test_ac7_room_ages_and_answers_only_to_seekers`
  is renamed to `test_ac7_room_privacy_seeker_rule` and gains the two owner rows. — `api/tests/test_room_search.py::test_ac7_room_privacy_seeker_rule`
- [ ] AC8 `is_mine` is true on the caller's own listing (search list, map bbox and listing page) and false for
  others and for a visitor. On the own listing `match` is null and `like` is null. `GET /me/likes` returns 200 with `is_mine: false` on
  every liked room. A woman `W` with a profile who
  lists a men-only room sees it in her own `GET /listings?listing_type=room` and `total`, while another woman
  does not. The seeker statement count in `test_room_search.py::test_ac4_fit_filter_pages_counts_and_adds_no_statement`
  is unchanged. — `api/tests/test_search.py::test_ac8_is_mine_and_own_room_never_hidden`
- [ ] AC9 No router depends on a role gate: a test walks `app.routes` and asserts that no dependant is named
  `current_owner` / `current_seeker` and that `app.auth` has no such attribute. The only role reads are the POST
  `/listings` apartment check and `apply`'s `SeekerOnlyError` (a grep test over `api/app` for `\b(user|seeker|owner|me)\.role\b`, allow-list of those two lines plus
  `services/auth.py` and `routers/search.py::_sees_room_privacy`; the chat member `m.role` does not match). —
  `api/tests/test_auth.py::test_ac9_role_read_only_for_apartments`
- [ ] AC10 Web guards:
  - a seeker reaches `/listings/new`, `/me/listings/:id/edit`, `/me/listings/:id/applicants`, `/people`,
    `/flatmates`, `/me/likes` and `/me/profile`; an owner reaches `/me/likes` and `/me/profile`;
  - `/me/listings` still sends a seeker to `/`, and `/me/applications` still sends an owner to `/`;
  - a seeker on `/listings/new?type=apartment` gets the room wizard with no `TypeStep`.
  
  Updated: `features/listings/__tests__/RequireOwner.test.tsx`,
  `features/applications/__tests__/RequireSeeker.test.tsx`, and in `features/auth/__tests__/routes.test.tsx`
  the route tables plus `::ac10_profile_is_seeker_only` and `::ac8_likes_is_seeker_only` (an owner now
  reaches both). — `web/src/features/auth/__tests__/routes.test.tsx::ac10_market_routes_for_any_account`,
  `web/src/features/listings/__tests__/ListingWizard.test.tsx::ac10_non_owner_room_only`
- [ ] AC11 The market bar is שוק · לייקים · שלי · צ'אט · פרופיל for an owner and for a seeker. The apartments
  bar is unchanged. On the market side, the anonymous "כניסה" link carries `next=%2Fmarket`. —
  `web/src/app/__tests__/Layout.test.tsx::ac11_market_bar_every_account`
- [ ] AC12 `/market/mine` shows the tablist with both panels for an owner and for a seeker, and `?tab=applications`
  selects the second. The arrow keys follow RTL (the existing `Tabs` behaviour). —
  `web/src/features/market/__tests__/MarketMinePage.test.tsx::ac12_two_panels_for_everyone`
- [ ] AC13 The listing page:
  - on own room (`is_mine: true`): no apply form, no `ApplyBar`, no like, the "זו המודעה שלכם" note and a
    manage link to `/market/mine` (`/me/listings` for an own apartment), and `applications.countOwner`;
  - an owner on someone else's room: the apply form and the like control;
  - an owner on an apartment: no form, today's `none`;
  - a seeker on an apartment: the form;
  - `canApply` is unit-tested on its four combinations.
  
  `ApplySection.test.tsx`'s owner cases and every web fixture of `ListingPublic` / `ListingDetail` gain
  `is_mine`, the typed e2e fixture `web/e2e/screens/fixtures-seeker.ts:103` included. `ListingPage.test.tsx:588-593`
  and `:866-870` (an owner on someone's listing finds `applications.headingOwner`) keep passing on apartment
  fixtures only; a room fixture there expects `applications.heading`. — `web/src/features/applications/__tests__/ApplySection.test.tsx::ac13_own_listing_and_room_for_anyone`,
  `web/src/features/applications/__tests__/canApply.test.ts::ac13_can_apply`
- [ ] AC14 `ListingCard` shows "החדר שלכם" on an own room and "המודעה שלכם" on an own apartment, and nothing
  otherwise. — `web/src/features/listings/__tests__/ListingCard.test.tsx::ac14_own_tag`
- [ ] AC15 The chat list's empty state shows `chat.list.empty` for an owner and for a seeker, and
  `chat.list.emptyFlatmate` for a flatmate. `ChatListPage.test.tsx:69-79,254-279`, `ChatLayout.test.tsx:239` and
  `web/e2e/screens/chat.screens.ts:169` are updated. —
  `web/src/features/chat/__tests__/ChatListPage.test.tsx::ac15_generic_empty`
- [ ] AC16 Signup and login:
  - `/signup?next=%2Fmarket` shows name and email and no role group, and submits `{display_name, role:
    'seeker'}`;
  - `/signup?next=%2Fmarket%2Fmine%3Ftab%3Dapplications` is the same;
  - `/signup?role=owner&next=%2Fmarket` shows the group with owner checked (an explicit role wins);
  - `/signup?next=%2Fsearch` and `/signup` show the group;
  - login with an unknown email and `next=/market` skips the role in step 2, and so does
    `/login?next=%2Fflatmates%2Fjoin` (a market path);
  - with no role group, step 2 focuses the name field.
  
  — `web/src/features/auth/__tests__/OtpForm.test.tsx::ac16_market_signup_skips_role`,
  `SignupPage.test.tsx::ac16_market_next`
- [ ] AC17 `ProfileNudge` shows to an owner without a profile on `/market` and not on `/search`. `useProfile` is
  requested for a signed-in owner on `/search` and on a listing page; `SearchPage.test.tsx:698-711` and
  `:853-862` (an owner never requests the profile) are inverted. — `web/src/features/match/__tests__/ProfileNudge.test.tsx::ac17_nudge_by_side`
- [ ] AC18 (e2e, CI only):
  - a visitor opens `/signup?next=%2Fmarket`, signs up as a new email with no role question, and lands on
    `/market`;
  - the bar has 5 tabs;
  - "שלי" → "חדר חדש" posts a room through the 3-step wizard; it shows on `/market/mine` and as "החדר שלכם" on
    `/market`;
  - its page has no apply form;
  - a second context, an owner, opens that room and sees the apply section's profile gate (not today's
    owner `none`): a room is open to an owner;
  - axe passes on `/market/mine` with two panels.
  
  `helpers.ts::signUp` gains `{ market: true }`: start `/signup?next=%2Fmarket`, no role click, `expectUrl`
  `/market`. `web/e2e/flatmates.spec.ts:94` drops its `he.auth.role.seeker` click (login step 2 with
  `next=/flatmates/join` no longer asks). — `web/e2e/market.spec.ts::ac18_role_free_market`

## Tests to write
Integration (api): AC1–AC9; 13 role-gate functions are rewritten as listed, and the rest are new. Unit (web):
AC10–AC17. E2E: `market.spec.ts` AC18. The existing e2e (people, likes, flatmates, inbox, applications) still
pass: their owners and seekers keep doing what they did. **e2e runs only in CI** (no local `make e2e`). The
spec session runs `make lint`, `make test`, `make i18n-check` and `make client` locally.

## Risks / open questions
- **Security: a gate removed is a check moved.** Every endpoint above now relies on the service's ownership
  check, not a role. AC1, AC3, AC4 and AC5 each prove "another account → 404" per endpoint. AC9 makes a
  reintroduced role gate or a stray role read visible. The security reviewer reads
  `services/{listings,applications,people,flatmates}.py`'s ownership predicates against this table.
- **Decision 13 widens room privacy** from role seekers to "seeker or has a profile". Any owner can now see
  flatmate ages by filling a profile. That is Gilad's rule (the profile is "a person looking"); `0010c` narrows
  it to "the looking part is filled".
- **Signup's role question** still shows on a room's page for a visitor (the apply section's link is
  `?role=seeker&next=/listings/:id`, and a listing page is a shared path, so `sideOf` is `null`). The radio is
  preset to seeker, so it is one extra look. The narrower contract rule (`sideOf(next) === 'market'`) is kept on
  purpose: an owner who browsed the market and then posts an apartment must still be asked.
- **"כניסה" on the market side returns to `/market`**, including for an existing owner (who would
  otherwise land on `/me/listings`) and for a visitor on a room's page (who loses the room). This is intended:
  `next` is "back to where you were", and Q6 fixes only the default landing with no `next`. The narrower
  `sideOf(next)` rule (above) is what stops a stored side from making an owner-to-be a seeker.
- **`match.nudge`** ("…לכל דירה") now also shows on the market side. Accepted until `0010c` reshapes the
  profile and its nudge.
- **No perf reviewer** although the search filter and the auth path change: the orchestrator confirms. The
  filter gains one `OR owner_id = :me` on the same statement, and owners gain one PK lookup.
- **An owner's signed-in search gains one PK lookup** (`has_profile`). No perf reviewer; it is one indexed
  primary-key read per request, as seekers already pay.
- **Own listing in a `match` sort** keeps its position by score while showing `match: null`. Accepted (cosmetic).
- **`is_mine` is on every `ListingPublic`**, the liked rooms of `/me/likes` included (always false there). It is
  not on `MyListingOut` / `ApplicationListingOut`.
- Spec-verifier round 1: 14 findings applied (3 majors, 11 minors). The ownership spot-check of every
  endpoint was clean.
- Cut line if the run overflows: the API gates, `is_mine`, the seeker rule and their tests (AC1–AC9) first; the
  web (AC10–AC18) as `0010b2`.

## Digest (filled by orchestrator after verification)
See `/digest`.
