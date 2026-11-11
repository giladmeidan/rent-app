---
id: 0008a
title: A room lister browses the seekers who want a flatmate and likes them; a seeker likes rooms; when both have liked, it becomes a shortlisted application with its chat open
status: draft
depends_on: [0007c, 0007g]   # 0007g: match_columns(listing_type=...) and the lifestyle criterion people cards score with; 0007c: the inbox row (ApplicantOut.room) this spec adds `source` next to. 0007a/0007b/0007d (done): the room section, room_fit, listing_type_at_apply
reviewers: [code, qa, security, perf]   # security: a seeker's profile (gender, age, areas, answers) shown to owners, the budget-probe snapshot, a new write path into applications/conversations; perf: browse inserts snapshot rows and scores every candidate; qa: like/unlike/mutual state machine against apply, withdraw, decline
estimate: 1 coder run   # coder Opus/high (data, migration, PII; Speed rule 6)
---

## Goal
After this ships, an owner with a live **room** listing pages through the seekers who are looking for a room
there (`GET /listings/{id}/people`) and likes or unlikes them. A seeker likes or unlikes a room
(`PUT`/`DELETE /listings/{id}/like`) and sees the rooms that liked them and the rooms they liked
(`GET /me/likes`). When the second side likes, the pair becomes a **shortlisted application** tagged
`source: "like"`, and its chat opens. Chat, un-shortlist, decline and withdraw then work as in Slices 4–6.
A seeker can opt in to appear in people browse and can write an "about me" (`PUT /me/profile`).

This serves PRODUCT.md "People & likes" (Gilad, 2026-11-11, Slice 8 batch) and "Chat" ("opens only on owner
shortlist or mutual interest; never one-sided"). It is Dev Plan slice 8, part a. The web halves are `0008b`
(lister) and `0008c` (seeker); flatmates and group chats are `0008d` / `0008e`. No artboard covers people
browse.

## Scope
**In:**
- Migration `api/alembic/versions/0011_people_likes.py` (revision `"0011"`, down `"0010"`), see Data.
- `api/app/models/room_pair.py` (new) `RoomPair`, exported from `api/app/models/__init__.py`;
  `SeekerProfile` gains `people_visible`, `about_me` and the changed `ck_seeker_profiles_room_section`;
  `Application` gains `source`, `message` becomes `Mapped[str | None]`, and the message CHECK is replaced.
  Both model docstrings gain one line each on the new columns.
- `api/app/schemas/profile.py`:
  - `ABOUT_ME_MAX_LENGTH = 300`.
  - `AboutMe = Annotated[str, BeforeValidator(_lf_newlines), Field(min_length=1, max_length=300),
    AfterValidator(_visible_about_me)]`. `_visible_about_me` calls
    `visible_characters_only(value, allow_newlines=True, field="about_me", require_alnum=True)`, as
    `schemas/application.py`'s `Message` does. `_lf_newlines` is imported from `schemas/listing.py`, as
    `schemas/application.py` already imports it.
  - `SeekerProfileIn` gains `people_visible: bool = Field(default_factory=lambda: False)` and
    `about_me: AboutMe | None = None`. The factory keeps the key optional in the generated web type, as
    `0007a` did for `flatmate_gender`. `_room_section_needs_gender` also refuses `people_visible=True` or an
    `about_me` without a `gender` (a 422 that mirrors the CHECK).
  - `SeekerProfileOut` gains `people_visible: bool` and `about_me: str | None`, listed explicitly.
  - `services/profiles.py` needs no code change: `put_profile` upserts `data.model_dump()`. Omitting both
    fields on a `PUT` turns people browse off and clears the text. `0008c`'s form always sends them.
- `api/app/schemas/people.py` (new):
  - `PersonOut {id: UUID, display_name: str, gender: SeekerGender, age: int | None, area_ids: list[UUID],
    move_in_date: date, move_in_flexible: bool, lifestyle: Lifestyle, about_me: str | None, match: MatchOut,
    liked_by_me: bool, liked_me: bool}`. The fields are listed explicitly. `id` is the `room_pairs.id`, never
    a user id. There is no budget, `household`, pets, smoker, contract, parking or `flatmate_gender` field.
    `age` follows `0007c`: `dt.datetime.now(dt.UTC).year - birth_year`, or `None`.
  - `PeoplePageOut {items: list[PersonOut], total: int}`.
  - `PeopleParams {offset: int = 0 (0..PEOPLE_OFFSET_MAX = 1000)}`. The page size is the constant
    `PEOPLE_LIMIT = 20`, with no `limit` parameter.
  - `LikeOut {liked: bool, application_id: UUID | None}`. `application_id` is set only when this like made
    the pair mutual. It is also the chat's id (`0005a`: one conversation per application).
  - `LikeStateOut {liked_by_me: bool, liked_me: bool}`.
  - `LikedRoomOut {listing: ListingPublic, liked_at: datetime}`. `listing` is built with
    `ListingPublic.from_listing(..., seeker=True, match=...)` (`schemas/search.py`).
  - `MyLikesOut {liked_me: list[LikedRoomOut], mine: list[LikedRoomOut]}`.
- `api/app/schemas/application.py`: `ApplicationSource = Literal["apply", "like"]`. `MyApplicationOut` and
  `ApplicantOut` gain `source: ApplicationSource`, and their `message` becomes `str | None` (null exactly when
  `source == "like"`). The module docstring gains one sentence.
- `api/app/schemas/search.py`: `ListingDetail` gains `like: LikeStateOut | None` (see API, `GET /listings/{id}`).
- `api/app/schemas/listing.py`: `MyListingOut` gains `liked_me_count: int`.
- `api/app/services/people.py` (new) holds the people rules (see Rules). It is the only writer of
  `room_pairs`, and the only place a like turns into an application.
- `api/app/services/applications.py`: `_upsert` sets `source="apply"` on insert and on reopen (the `set_`
  gains `"source": "apply"`). Its docstring's "One row per (listing, seeker)" paragraph adds that a mutual
  like reopens a withdrawn row the same way (`services/people.py`).
- `api/app/services/listings.py::list_own_listings`: adds a third correlated count, `liked_me_count` (see
  Data, "pending seeker like"). Its return type becomes `tuple[Listing, int, int, int]`, and
  `routers/listings.py::my_listings` passes it through.
- `api/app/services/search.py`: `liked_rooms(db, seeker_id)` (see API). It lives here because it reads
  `_public_listings()`, the only statement of "public".
- `api/app/routers/people.py` (new), registered in `create_app` beside the other routers: the five people
  endpoints. `routers/search.py::get_listing` sets `like`. The routers stay thin.
- `api/app/routers/applications.py::_out` / `_applicant_out` pass `source` through.
- `api/app/services/rate_limit.py` is reused (`count_or_raise`). The constants are `LIKE_RATE_LIMIT_HOUR = 30`
  and `LIKE_RATE_LIMIT_DAY = 100`, per user, shared by the lister and seeker `PUT`s.
- Tests: `api/tests/test_people.py` (new), amendments in `test_profiles.py`, `test_migrations.py`,
  `test_inbox.py`, `test_applications.py` and `test_listings.py` (see Tests). `api/tests/conftest.py`
  gains `make_pair(engine, listing_id, seeker_id, *, price_ils_seen, lister_liked=False, seeker_liked=False)
  -> uuid.UUID`, and `make_profile` takes the two new columns through its `**overrides`.

**Out:**
- All web (`0008b` lister, `0008c` seeker). This spec needs no web change: the regenerated `message: string |
  null` renders as nothing in `ApplicantCard` / `MyApplicationsPage`, and `make lint` (tsc) on the web must
  stay green.
- Flatmates and group chats (`0008d`).
- Notifications of any kind (no email, no SSE event for a plain like; PRODUCT.md "Applications" / "Chat" lines
  hold). A mutual like publishes the existing `status` chat event (API).
- Hiding or declining a received like. One-sided likes stay until their giver unlikes, or until an
  application for the pair exists (FOLLOWUPS line, see Risks).
- Filters on people browse. The only order is "liked me first, then match".
- Apartment owners browsing people, and seekers browsing seekers (PRODUCT.md: room listers only).

**New dependencies:** none.

## Data
Migration `0011_people_likes` (down `0010`):

1. `seeker_profiles`:
   - `people_visible boolean NOT NULL DEFAULT false`.
   - `about_me text NULL` with `ck_seeker_profiles_about_me CHECK (about_me IS NULL OR char_length(about_me)
     BETWEEN 1 AND 300)`.
   - `ck_seeker_profiles_room_section` is dropped and recreated as `gender IS NOT NULL OR (birth_year IS NULL
     AND flatmate_gender = 'any' AND lifestyle = '{}'::jsonb AND NOT people_visible AND about_me IS NULL)`.
     Opting in and "about me" belong to the room section.
2. `room_pairs` (new). One row per (room listing, seeker) that either side ever saw or liked:
   - `id uuid PK DEFAULT gen_random_uuid()`. This is the person card's id, so the lister never handles a user
     id.
   - `listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE`.
   - `seeker_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE`.
   - `price_ils_seen integer NOT NULL`: the listing's `price_ils` when the row was created, **never updated**
     (Gilad 2026-11-11, "freeze price per pair"). Every budget input about this pair reads it: the card's
     score, and the application's `price_ils_at_apply` on a mutual like. So editing the price can never probe
     the seeker's budget through people browse.
   - `lister_liked_at timestamptz NULL`, `seeker_liked_at timestamptz NULL`. Null = not liked. Both are set
     back to null when the pair becomes mutual (the application takes over).
   - `created_at timestamptz NOT NULL DEFAULT now()`.
   - `uq_room_pairs_listing_seeker UNIQUE (listing_id, seeker_id)` (it also serves the listing's scans), and
     `ix_room_pairs_seeker_id (seeker_id)` for `/me/likes`.
   - `ck_room_pairs_price CHECK (price_ils_seen > 0)`.
3. `applications`:
   - `source text NOT NULL DEFAULT 'apply'` with `ck_applications_source CHECK (source IN ('apply',
     'like'))`. The default backfills every existing row and is kept, because the test helpers insert by SQL.
   - `message` drops NOT NULL. `ck_applications_message_length` is dropped, and
     `ck_applications_message CHECK ((source = 'apply' AND char_length(message) BETWEEN 1 AND 500) OR
     (source = 'like' AND message IS NULL))` is added.

Downgrade, in reverse: set `message = 'התאמה הדדית'` where it is null, restore NOT NULL and the old CHECK, and
drop `source`, `room_pairs`, the two profile columns and their CHECKs. The old `ck_seeker_profiles_room_section`
is restored last. No rows are deleted. The Hebrew literal is built from code points in the migration, as the
CLAUDE-noted `\u` rule asks.

Terms used below, each written **once** in `services/people.py`:
- **candidate** of room listing `L`: a `seeker_profiles` row `P` where every one of these holds:
  - `P.gender IS NOT NULL`;
  - `room_fit(L, P) IS TRUE` (`matching/fit.py`);
  - `P.user_id <> L.owner_id`;
  - (`P.people_visible` or the pair's `seeker_liked_at IS NOT NULL`);
  - no `applications` row for (`L`, `P.user_id`) with `status <> 'withdrawn'` exists.

  Declined, submitted and shortlisted applicants all live in the inbox. A decline is final, so a declined seeker
  never comes back to people browse.
- **pending seeker like** of `L`: a pair of `L` with `seeker_liked_at IS NOT NULL` and no non-withdrawn
  application for it. `liked_me_count` counts these without re-checking fit or opt-in. Browse re-checks
  (shortcut, see Risks).

## API
| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | `/listings/{listing_id}/people` | `current_owner`; `listing_id` is the caller's own **room** listing | `?offset=` | 200 `PeoplePageOut` | 401; 403 `owner_only`; 404 `not_found` (unknown, another owner's, an apartment); 409 `listing_not_live` (paused, expired, or its area inactive); 422 |
| PUT | `/listings/{listing_id}/people/{person_id}/like` | `current_owner`, own room listing | — | 200 `LikeOut` | 401; 403; 404 `not_found` (unknown pair, a pair of another listing, not a candidate any more); 409 `listing_not_live`, `already_applied`; 429 `rate_limited` |
| DELETE | `/listings/{listing_id}/people/{person_id}/like` | `current_owner`, own room listing | — | 204 | 401; 403; 404 `not_found` (unknown pair, or another listing's / owner's) |
| PUT | `/listings/{listing_id}/like` | `current_seeker` (`SeekerDep`) | — | 200 `LikeOut` | 401; 403 `seeker_only`; 404 `not_found` (unknown, not public, an apartment, the caller's own); 409 `seeker_profile_required`, `room_section_required`, `room_gender_mismatch`, `already_applied`; 429 |
| DELETE | `/listings/{listing_id}/like` | `current_seeker` | — | 204 (always; reveals nothing) | 401; 403 |
| GET | `/me/likes` | `current_seeker` | — | 200 `MyLikesOut` | 401; 403 |
| GET | `/listings/{listing_id}` (changed) | public, as today | — | `ListingDetail.like` | as today |
| GET | `/me/profile`, PUT `/me/profile` (changed) | as today | `+people_visible`, `+about_me` | `+people_visible`, `+about_me` | 422 as today |
| GET | `/me/listings` (changed) | as today | — | `+liked_me_count` | as today |
| GET/PATCH | owner inbox, GET `/me/applications`, apply, withdraw (changed) | as today | — | `+source`, `message` nullable | as today |

`401`, `403` and `503` reuse `_OWNER_ONLY` / `_SEEKER_ONLY` (`routers/applications.py`). Moving them to a
shared module is allowed, but not required.

### Rules (`services/people.py`)
- **`list_people(db, owner, listing_id, offset)`** runs three statements and one commit:
  1. One SELECT of the listing with its public-ness: `Listing` left-joined to `_public_listings()`'s
     conditions, as a boolean column. Unknown, another owner's or an apartment gives `ListingNotFoundError`;
     not public gives `ListingNotLiveError`.
  2. Snapshot: `INSERT INTO room_pairs (listing_id, seeker_id, price_ils_seen) SELECT L.id, P.user_id,
     L.price_ils FROM seeker_profiles P WHERE <candidate by opt-in> ON CONFLICT DO NOTHING`. Every opted-in
     candidate gets its frozen price **before** anything is scored or ordered, so neither a score nor a
     position on the page ever depends on the live price. Candidates who only liked already have a row.
  3. The page: `RoomPair` joined to `SeekerProfile` (by `seeker_id`), `User.display_name` and the listing, with
     the candidate condition. It selects profile columns **by name** (`gender`, `birth_year`, `area_ids`,
     `move_in_date`, `move_in_flexible`, `lifestyle`, `about_me`), never the entity, so `budget_max_ils` is
     never loaded (NF2). It also selects
     `match_columns(Listing, SeekerProfile, price=RoomPair.price_ils_seen, listing_type=Listing.listing_type)`,
     `count(*) OVER ()` as the total, and both like columns. The order is `seeker_liked_at IS NULL`,
     `m_score DESC`, `RoomPair.created_at`, `RoomPair.id`, with `LIMIT 20 OFFSET :offset`. An offset past the
     end returns `items: []` and the true `total`. That needs one extra `count` only when the page is empty, so
     the statement count is 3, or 4 for an empty page.
- **Lister like `like_person(db, r, owner, listing_id, person_id)`** runs in this order:
  1. One ownership-and-live SELECT, as above.
  2. The limiter (`rl:like:user:{id}` hour, `rl:like:user:day:{id}` day). It counts only attempts that pass
     step 1.
  3. One conditional `UPDATE room_pairs SET lister_liked_at = coalesce(lister_liked_at, now()) WHERE id =
     :person_id AND listing_id = :listing_id AND <candidate> RETURNING *`.
  4. When nothing is returned, one SELECT tells `already_applied` (a non-withdrawn application exists) from
     `not_found`.
  5. When the returned row has `seeker_liked_at` set, **mutual** (below). Commits.
- **Seeker like `like_room(db, r, seeker, listing_id)`** runs in this order:
  1. The profile and its room section: no profile gives `ProfileRequiredError`; `gender` null gives
     `RoomSectionRequiredError`. Neither counts.
  2. `search.get_public_listing_with_match`. Not public, own or an apartment gives `ListingNotFoundError`.
     `fit is False` gives `RoomGenderMismatchError`. Neither counts. This is the same gate order as `apply`.
  3. The limiter.
  4. One `INSERT INTO room_pairs (listing_id, seeker_id, price_ils_seen, seeker_liked_at) SELECT :l, :s,
     :price, now() WHERE NOT EXISTS (<non-withdrawn application>) ON CONFLICT (uq) DO UPDATE SET
     seeker_liked_at = coalesce(room_pairs.seeker_liked_at, excluded.seeker_liked_at) RETURNING *`.
     `:price` is the listing's live price, frozen only if the row is new.
  5. When nothing is returned, it is `AlreadyAppliedError`.
  6. When the returned row has `lister_liked_at` set, **mutual**. Commits.
- **Mutual** happens in the same transaction as the second like:
  1. `INSERT INTO applications (listing_id, seeker_id, source, message, status, price_ils_at_apply,
     area_id_at_apply, listing_type_at_apply) VALUES (:l, :s, 'like', NULL, 'shortlisted',
     pair.price_ils_seen, L.area_id, L.listing_type) ON CONFLICT ON CONSTRAINT uq_applications_listing_seeker
     DO UPDATE SET status='shortlisted', source='like', message=NULL, <the three snapshots>,
     created_at=now(), updated_at=now() WHERE applications.status = 'withdrawn' RETURNING *`.
     Nothing returned (a racing apply) gives `AlreadyAppliedError`, and the whole transaction, like included,
     rolls back.
  2. `INSERT INTO conversations ... ON CONFLICT DO NOTHING`, as `set_applicant_status` does. The second
     liker's read marker is `now()`, the other's null. A conversation that already exists (a reopened row)
     keeps its markers and history, exactly as a re-shortlist does.
  3. `UPDATE room_pairs SET lister_liked_at = NULL, seeker_liked_at = NULL WHERE id = :pair`.
  4. The router, after the commit, calls `chat_events.publish(r, [owner_id, seeker_id], application.id,
     "status")`.

  Two concurrent second likes serialise on the pair row's lock. The later UPDATE re-reads the row and sees
  both timestamps, so exactly one transaction is mutual (AC8).
- **Unlike**: `UPDATE room_pairs SET lister_liked_at = NULL` (respectively `seeker_liked_at`) on the caller's
  side. The lister DELETE returns 404 for a pair outside the caller's listing. The seeker DELETE always
  returns 204. No limiter.
- **`liked_rooms(db, seeker_id)`** (`services/search.py`) is one statement: `_public_listings()` joined to
  `RoomPair` (`seeker_id = :me`) and to the seeker's profile (`_with_profile` / `_with_match`), where
  `room_fit IS NOT FALSE` and there is no non-withdrawn application for the pair. It returns the
  `lister_liked_at` / `seeker_liked_at` columns, newest like first. The router splits it:
  - `liked_me`: `lister_liked_at` set and `seeker_liked_at` null; `liked_at = lister_liked_at`.
  - `mine`: `seeker_liked_at` set; `liked_at = seeker_liked_at`.

  The owner is never named (PRODUCT.md "Applications": the owner's identity is hidden until chat).
- **`ListingDetail.like`** is null unless the caller is a seeker and the listing is a room. It is also null when
  the caller has a non-withdrawn application to it, because the page shows the application instead. Otherwise
  it is `{liked_by_me: seeker_liked_at set, liked_me: lister_liked_at set}`, `{false, false}` with no pair.
  That is one extra one-row SELECT, only in that case.

## Acceptance criteria
- [ ] AC1 Given room `R` (owner `O`) and four seekers with profiles in its area: `A` (room section,
  `people_visible`), `B` (room section, not visible), `C` (visible, but a man where `R` is women-only) and `D`
  (visible, with a submitted application to `R`). When `O` GETs `/listings/{R}/people`, Then the items are `[A]`
  with `total` 1. `A`'s card has exactly the `PersonOut` keys. `match` equals what `match_columns` gives for `R`
  and `A` at `R`'s price. When `B` then likes `R`, `O`'s page is `[B, A]` (`B` has `liked_me: true`, so it comes
  first). — `api/tests/test_people.py::test_ac1_candidates_and_order`
- [ ] AC2 (security, budget freeze) Given `A`'s budget 5000 and `R` at 4500, When `O` GETs the page, Then `A`'s
  `match` has `budget` in `agrees`. When `O` then PATCHes `R`'s price to 6000 and GETs again, Then `A`'s `match`
  is unchanged and `room_pairs.price_ils_seen` is 4500. When a new seeker `E` (budget 5000, visible) signs up
  afterwards, Then `E`'s pair holds 6000 and `E`'s card has `differs: budget`, capped at 59. — `test_people.py::test_ac2_price_frozen_per_pair`
- [ ] AC3 (security, NF2) Given AC1's data, Then `PersonOut`'s JSON for `A` contains no `budget_max_ils`,
  `household`, `has_pets`, `smoker`, `contract_months`, `parking_needed`, `flatmate_gender`, `seeker_id` or
  email (the keys are asserted exactly). The page's SQL, captured with a `before_cursor_execute` listener,
  never selects `seeker_profiles.budget_max_ils`. — `test_people.py::test_ac3_card_fields_only`
- [ ] AC4 Given AC1's data, Then a seeker GET gives 403 `owner_only`. Another owner, an apartment, or an
  unknown id gives 404 `not_found`. `R` paused gives 409 `listing_not_live`. `?offset=1001` gives 422.
  `?offset=40` gives `items: []` with `total` 1. — `test_people.py::test_ac4_people_errors`
- [ ] AC5 (perf) Given 30 visible candidates, When `O` GETs page 1 and then page 2, Then each request runs
  exactly 3 statements, plus 1 for an empty page. Page 1 has 20 items and page 2 has 10, with no overlap, and
  `total` is 30 on both. The second GET inserts no new `room_pairs` rows. — `test_people.py::test_ac5_statements_and_paging`
- [ ] AC6 Given `A` on `R`'s page, When `O` PUTs the like, Then it returns `{liked: true, application_id: null}`,
  `A`'s card shows `liked_by_me: true`, and `A`'s `GET /me/likes` has `R` in `liked_me` (not in `mine`). Then,
  in each case:
  - A second PUT changes nothing (the same `lister_liked_at`).
  - A DELETE gives 204, and `A`'s `liked_me` is empty.
  - The PUT on a pair of another listing gives 404.
  - The PUT after `A` turns `people_visible` off (and never liked `R`) gives 404.
  - The PUT after `A` applied gives 409 `already_applied`.

  — `test_people.py::test_ac6_lister_like_unlike`
- [ ] AC7 Given `O` liked `A` for `R`, When `A` PUTs `/listings/{R}/like`, Then it returns `{liked: true,
  application_id: X}` and the database holds:
  - one application `X` with `source='like'`, `message` null and `status='shortlisted'`;
  - `price_ils_at_apply` equal to the pair's `price_ils_seen`;
  - `listing_type_at_apply='room'`;
  - a conversation `X` with `seeker_read_at` set and `owner_read_at` null;
  - the pair's two like columns null.

  Then:
  - `O`'s inbox lists `X` with `source: "like"` and `message: null`, and `A`'s `/me/applications` lists `X`
    with the same.
  - `A`'s `GET /me/conversations` lists `X` with `can_send: true`, and `A` can POST a message to it.
  - `R` is in neither of `A`'s like lists, and `A` is not on `R`'s people page.
  - `chat_events.publish` was called once with `[O, A]`, `X`, `"status"` (monkeypatched).

  The mirror case (`A` likes first, `O` second) gives the same rows, with `owner_read_at` set and
  `seeker_read_at` null. — `test_people.py::test_ac7_mutual_becomes_shortlisted_application`
- [ ] AC8 (concurrency) Given `A` liked `R`, When `O`'s PUT and a second `A` PUT run at the same time on two
  connections (the pattern of `0004a`'s concurrent-apply test), Then there is exactly one application and one
  conversation, and exactly one of the responses carries `application_id`. — `test_people.py::test_ac8_concurrent_second_likes`
- [ ] AC9 Given a mutual application `X`:
  - When `O` un-shortlists it, Then it is `submitted` with `source: "like"` and sending is closed.
  - When `A` withdraws it, Then a later like by `A` alone does not reopen it (the pair's likes were cleared).
    A like by `O` after that reopens `X` as `shortlisted`, `source='like'`, a new `created_at`, the same
    conversation id.
  - When `O` declines it, Then `A` gets 409 `already_applied` on a like, `O` gets 404 on the pair, and `A`
    never shows on `R`'s page again.
  - When `A` withdraws a like-sourced application and then **applies** with a message, Then the row is
    `source='apply'` with the message.

  — `test_people.py::test_ac9_mutual_lifecycle`
- [ ] AC10 Seeker like gates. In each case nothing is counted by the limiter, and `room_pairs` is unchanged:
  - a seeker without a profile gets 409 `seeker_profile_required`;
  - one with a profile and no room section gets 409 `room_section_required`;
  - a man liking a women-only room gets 409 `room_gender_mismatch`;
  - an apartment, a paused room or an unknown id gets 404.

  The 31st counted like within an hour gets 429 with `Retry-After`. A DELETE on an unknown listing gives 204.
  — `test_people.py::test_ac10_seeker_like_gates_and_limit`
- [ ] AC11 Given `B` (not visible) liked `R`, Then `B` appears on `R`'s page with `liked_me: true` (PRODUCT.md:
  a like shares the card with that room's lister only). `B` is on no other room's page. When `B` unlikes, Then
  `B` is gone from `R`'s page. — `test_people.py::test_ac11_like_shares_card_with_that_room_only`
- [ ] AC12 `GET /listings/{R}` as `A` gives:
  - `like: {liked_by_me: false, liked_me: false}` before any like, then `{true, false}` after `A`'s like, and
    `{false, true}` when only `O` liked;
  - `like: null` for an anonymous caller, for `O`, on an apartment, and once `A` has a submitted application.

  `GET /me/listings` as `O` gives `liked_me_count` 1 for `R` after `A`'s like, and 0 after it turns mutual.
  — `test_people.py::test_ac12_listing_like_state_and_count`
- [ ] AC13 `PUT /me/profile`:
  - `people_visible: true` without a `gender` gives 422; so does an `about_me` without a `gender`;
  - an `about_me` of 301 characters, of only spaces, or with a private-use character gives 422;
  - a valid one is stored stripped, with `\r\n` turned into `\n`;
  - a `PUT` that omits both stores `false` / null.

  `GET` returns both. — `api/tests/test_profiles.py::test_ac13_people_fields`
- [ ] AC14 Migration: Given a database at `"0010"` with an application and a room-section profile inserted by
  SQL, When upgraded to `"0011"`, Then the application has `source='apply'` and the profile
  `people_visible=false`, `about_me` null. The new CHECKs refuse a `source='like'` row with a message, an
  `apply` row without one, and `people_visible` true with `gender` null. A `like` row inserted at `"0011"`
  survives a downgrade to `"0010"` with the placeholder message. Upgrading to head works again. — `api/tests/test_migrations.py::test_ac14_people_likes_upgrade_downgrade`
- [ ] AC15 Regression: existing inbox, apply, withdraw and listing tests pass with `source: "apply"` asserted
  where they compare the whole body. `0006c`'s inbox statement-count tests are unchanged, since `source` is a
  column of the same row. — `test_inbox.py`, `test_applications.py` (amended asserts only)

## Tests to write
Unit: `AboutMe` validation in `test_profiles.py`.
Integration: `test_people.py` AC1–AC12, `test_profiles.py` AC13, `test_migrations.py` AC14. AC5 uses the
statement counter `test_inbox.py` already uses. AC8 uses two `Session`s on `db_engine` with a barrier, as
`test_applications.py`'s concurrent-apply test does.
E2E: none (no web in this spec).

## Risks / open questions
Gilad's decisions (2026-11-11) are in PRODUCT.md "People & likes". The orchestrator made these assumptions,
not Gilad calls:
- **Assumptions:**
  - Likes are limited to 30 an hour and 100 a day per user, both sides together.
  - Neither side can hide a received like (FOLLOWUPS).
  - A like on a pair whose seeker already applied is refused (`already_applied`), because the inbox is where that
    pair lives.
  - A mutual application's budget snapshot is the pair's frozen price, not the live one.
  - Likes are consumed when they turn mutual, so after a withdraw both sides start over.
  - A seeker needs the room section to like, even on a לא משנה room.
- **Probe residue (security):** the freeze is per (listing, seeker). An owner who creates new room listings at
  new prices gets one budget bit per new listing per seeker. Today only the 3-live cap bounds this (paused rows
  are unlimited, Known Issues). The pre-launch "total listings per owner" follow-up closes it. The other score
  criteria (smoking, pets, household, contract, parking) are live. An owner toggling `smoking_allowed` learns
  whether an opted-in seeker smokes, which the inbox already shows outright once they apply. Accepted. The
  security reviewer should confirm.
- **Snapshot cost (perf):** statement 2 inserts a row for every opted-in candidate the first time a room's
  page is opened, and re-scans them on each later page (`ON CONFLICT DO NOTHING`). That is fine at MVP
  volume, where candidates are the opted-in room seekers whose gender fits. If browse passes a few hundred ms,
  insert only pairs not already present via an anti-join, or move the snapshot to the like and score unseen
  candidates without the budget term. Put a `shortcut:` comment at statement 2.
- **`liked_me_count` does not re-check fit or opt-in.** It can overcount when the liker has since changed
  gender or lost the room section. The page itself re-checks. Accepted as a `shortcut:`.
- **`message` turns nullable** in two response schemas the web already reads. Render-only for now (Out).
  `0008b` / `0008c` show the "התאמה הדדית" tag instead.

## Digest (filled by orchestrator after verification)
See `/digest`.
