---
id: 0010h
title: The API for שוק השותפים people browse - people page through other people's cards, like them, a mutual like opens a direct chat that either side can end, and browsing people (also on the room side) is rate limited
status: done
depends_on: [0010c, 0010g, 0010f]   # 0010c: personal + looking parts, people_visible needs both; 0010g: open_direct / close_direct, nullable chat listing; 0010f: migration chain 0016 -> 0017
reviewers: [code, qa, security, perf]   # security: personal data shown to other users, the two-way gender rule, a new write path into conversations, ids in URLs; perf: the browse statement and its rate limit; qa: like/unlike/mutual/remove state machine
estimate: 1 coder run   # coder Opus/high (PII, migration, chat writes; Speed rule 6); the web half is 0010i
---

## Goal
After this ships, the API lets a signed-in person in שוק השותפים page through other people looking for a flat
(`GET /people`). The screens are `0010i-people-browse-web`. Each person card shows:
- display name, photo, age, gender, preferred areas, move-in date and "about me";
- their questionnaire answers compared with the viewer's own;
- **no score** and **no budget**.

The person likes or unlikes a card. When both people have liked each other, a **direct chat** opens, with no room
and no application. `GET /me/people-likes` lists the people who liked them, the people they liked and their matches.
Either side can **remove a match** (`DELETE /me/matches/{id}`). Both likes are cleared, the chat stays
readable, and sending closes.

The rules come from PRODUCT.md "שוק השותפים" and MARKET-PLAN.md decisions 4–7 and Q13–Q15:
- **Entry ticket.** People browse needs the caller's own visible card or a live room.
- **Gender both ways.** The gender rule hides a person from anyone whose gender contradicts the person's
  flatmates preference, in both directions.

`GET /people` and the room side's `GET /listings/{id}/people` get a browse rate limit (FOLLOWUPS:167). This is
Slice 10, Step 5, part two.

## Scope
**In:**
- Migration `api/alembic/versions/0017_person_likes.py` (revision `"0017"`, down `"0016"`), see Data.
- Models:
  - `User.card_id`;
  - `api/app/models/person_pair.py` (new) `PersonPair`, exported from `models/__init__.py`.
- `api/app/matching/fit.py` gains `person_fit(viewer_gender: str | None, viewer_pref: str, other:
  type[SeekerProfile] | AliasedClass[SeekerProfile]) -> ColumnElement[bool]`. It is the two-way gender rule,
  written once, as SQL with the viewer's values bound. `other` is hidden (false) when any of these holds:
  - `other.flatmate_gender = 'women'` and the viewer's gender IS DISTINCT FROM `'woman'`;
  - `other.flatmate_gender = 'men'` and the viewer's gender IS DISTINCT FROM `'man'`;
  - `viewer_pref = 'women'` and `other.gender <> 'woman'`;
  - `viewer_pref = 'men'` and `other.gender <> 'man'`.

  A viewer with no profile (or no gender) passes `None` and `'any'`, so they see only people whose
  `flatmate_gender = 'any'` (section 7). `other.gender` is NOT NULL for a visible card (0010c), so the rule is
  never NULL there. The docstring states the rule in words, as `room_fit`'s does.
- `api/app/services/market_people.py` (new) holds the rules (see Rules). It is the only writer of
  `person_pairs` and the only caller of `chat.open_direct` / `chat.close_direct`. It defines:
  - `CardRequiredError` (code `card_required`, new) and `MutualMatchError` (code `mutual_match`, new);
  - the constants `BROWSE_RATE_LIMIT_HOUR = 300` and `BROWSE_RATE_LIMIT_DAY = 1500`. The limit counts
    pages, not visits: an infinite query refetches every loaded page, and the room side invalidates its
    people query after each like (`useLikePerson.ts:20,29`), so a lower limit would break today's lister
    flow (verifier finding 2);
  - `count_browse(r, user)`, using `rl:browse:user:{id}` and `rl:browse:user:day:{id}` (`count_or_raise`).

  Likes reuse `services/people.py::_count_like` (`rl:like:user:*`, :191-198). It is renamed `count_like`
  (public) so the new module does not import a private name.
- `api/app/schemas/market_people.py` (new). Every field is listed explicitly (NF2):
  - `PersonCardOut {card_id: UUID, display_name: str, gender: SeekerGender, age: int | None, area_ids:
    list[UUID], move_in_date: date, move_in_flexible: bool, lifestyle: Lifestyle, about_me: str | None,
    photo_url: str | None, liked_by_me: bool, liked_me: bool}`.
    - It has no budget, `household`, pets, smoker, contract, parking, `flatmate_gender`, user id, email or
      score.
    - `age` uses `services/people.py::age`.
    - `photo_url` is the small photo URL from `users.photo_key` (0010d's helper), which the card rule lets the
      viewer see (decision 15).
  - `PeopleBrowseOut {items: list[PersonCardOut], total: int}`.
  - `PeopleBrowseParams {offset: int = 0 (0..PEOPLE_OFFSET_MAX)}`. The page size is `PEOPLE_LIMIT` (20), reused
    from `schemas/people.py`.
  - `PersonLikeOut {liked: bool, conversation_id: UUID | None}`. `conversation_id` is set exactly when the pair
    is mutual after this PUT.
  - `PersonMatchOut {conversation_id: UUID, display_name: str, photo_url: str | None, matched_at: datetime}`.
  - `MyPeopleLikesOut {liked_me: list[PersonCardOut], mine: list[PersonCardOut], matches: list[PersonMatchOut]}`.
- `api/app/routers/market_people.py` (new), registered in `create_app`, holds the five endpoints (API). The
  routers stay thin.
- `api/app/routers/people.py::list_people` (:108) calls `market_people.count_browse(r, owner)` first. It gains
  `r: RedisDep` and a 429 `rate_limited` response with `Retry-After`, as `_rate_limited` does (:73).
- Tests:
  - `api/tests/test_market_people.py` (new);
  - `api/tests/test_person_fit.py` (new, the gender matrix);
  - amendments in `test_migrations.py` (AC14) and `test_people.py` (AC12, the room-side limit).

  `conftest.py` gains `make_card(engine, user_id, area_id, *, gender, flatmate_gender="any", **overrides)`.
  It writes a profile with both parts and `people_visible=true` through `make_profile` and returns the user's
  `card_id`. It also gains `make_person_like(engine, liker, liked) -> None`.
**Out:**
- All web screens, the room-side `PeoplePage` 429 state and the e2e test (`0010i`).
- A person-to-person match score or rating (MARKET-PLAN.md decision 11; Q15: no score yet).
- Filters and sort options on people browse. The only order is in Rules.
- A nav badge for people who liked you (`LikesNavLink` keeps counting rooms only). This is a follow-up.
- Hiding or blocking a person, and the report button (trust slices, decision 10).
- Moderating contact details in `about_me` (FOLLOWUPS:162 stays open; see Risks).
- Snapshot pruning for `room_pairs` (FOLLOWUPS:158-159). Person likes write a pair row only on a like.
- Paging `/me/people-likes`: each list is capped (Rules), as a `shortcut:`.

**New dependencies:** none.

## Data
Migration `0017_person_likes` (down `0016`):
1. `users.card_id uuid NOT NULL DEFAULT gen_random_uuid()` with `uq_users_card_id UNIQUE`. It is backfilled by
   the default (one table rewrite, fine at MVP volume). It is the **only** person id in market cards and likes
   (section 7). It never changes and never appears beside a user id in any response.
2. `person_pairs` (new). One row per pair of people, written **only on a like** (no browse snapshot: there is
   no price to freeze):
   - `user_low uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE`;
   - `user_high uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE`;
   - `low_liked_at timestamptz NULL`, `high_liked_at timestamptz NULL`. Null = not liked. **Mutual = both set**
     (unlike `room_pairs`, the likes stay set while matched; the chat is `conversations`, 0010g);
   - `created_at timestamptz NOT NULL DEFAULT now()`;
   - `PRIMARY KEY (user_low, user_high)`, `ck_person_pairs_order CHECK (user_low < user_high)`, and
     `ix_person_pairs_user_high (user_high)`, so a user's pairs are found from either side.

   The pair is always written with `least` / `greatest` in SQL, as 0010g's `open_direct`.

Downgrade: drop `person_pairs` (**all person likes are lost**), then `uq_users_card_id` and `card_id`. Direct
chats are 0010g's and stay.

## API
| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | `/people` | `current_user` + **entry ticket** (own visible card, or own live room) | `?offset=` | 200 `PeopleBrowseOut` | 401; 403 `card_required`; 422; 429 `rate_limited` (`Retry-After`) |
| PUT | `/people/{card_id}/like` | `current_user` + **own visible card** | — | 200 `PersonLikeOut` (idempotent) | 401; 403 `card_required`; 404 `not_found` (unknown card, the caller's own, or not a candidate for the caller); 429 |
| DELETE | `/people/{card_id}/like` | `current_user` | — | 204 (also for an unknown card: reveals nothing) | 401; 409 `mutual_match` (use remove match) |
| DELETE | `/me/matches/{conversation_id}` | `current_user`, one of the two people of that **direct** chat | — | 204 (idempotent: an already closed match too) | 401; 404 `not_found` (unknown, an application chat, or not the caller's) |
| GET | `/me/people-likes` | `current_user` + entry ticket | — | 200 `MyPeopleLikesOut` | 401; 403 `card_required` |
| GET | `/listings/{listing_id}/people` (changed) | as today | as today | as today | `+429 rate_limited` |

`card_id` and `conversation_id` are path UUIDs (FastAPI 422 on a malformed one). Neither is a user id, so a URL
in a log or a shared link reveals nobody's account.

### Rules (`services/market_people.py`)
- **Viewer.** One SELECT returns the caller's `gender`, `flatmate_gender`, `people_visible` and `area_ids`
  (an outer join from `users` to `seeker_profiles`; NULL / `'any'` / false / `{}` without a row), and
  `has_live_room`. `has_live_room` is `EXISTS` over `search._public_listings()` with `owner_id = me` and
  `listing_type = 'room'`; the one visibility rule is never restated.
  - **Ticket** = `people_visible OR has_live_room`.
  - **Card** = `people_visible`. Since 0010c it implies both parts, so `gender` is set.
- **Candidate** of viewer `V`, written once as `_candidate(V)`: a `seeker_profiles` row `P` joined to its
  `users` row with:
  - `P.people_visible`;
  - `P.user_id <> V`;
  - `person_fit(V.gender, V.flatmate_gender, P)`;
  - no **mutual** pair of (`V`, `P.user_id`): matches live in "matches" and the chat.

  Hiding one's card hides one from browse, from other people's "liked me" / "mine" lists and from new likes,
  at once. Stored likes stay.
- **`browse(db, r, me, offset)`**:
  - `count_browse` first, so every authenticated attempt counts, a 403 included. That stops scraping by
    callers without a ticket.
  - Then the viewer SELECT (`CardRequiredError` without a ticket), then **one** page statement: candidates
    LEFT JOIN `person_pairs` on the ordered pair, `count(*) OVER ()` as the total, `LIMIT PEOPLE_LIMIT OFFSET
    offset`.
  - The page selects the card columns **by name** (as `services/people.py::_CARD_COLUMNS`), never the entity,
    so `budget_max_ils` is never loaded.
  - Order:
    1. those who liked the viewer first;
    2. then those sharing an area with the viewer (`P.area_ids && :viewer_areas`);
    3. then `P.updated_at DESC`;
    4. then `users.card_id`.
  - Two statements after the session lookup. A read only, so no commit.
- **`like(db, r, me, card_id)`**:
  - `count_like` first, then the viewer SELECT: without a **card** (`people_visible`), `CardRequiredError`.
    A live room alone lets you browse but not like, since the other person could never see your card to like
    back.
  - Then **one write that also checks the target** (verifier finding 4: no gap between the check and the
    write): `INSERT INTO person_pairs (user_low, user_high, low_liked_at, high_liked_at) SELECT least(:me,
    u.id), greatest(:me, u.id), <now() on my side, NULL on the other> FROM users u JOIN seeker_profiles p ON
    p.user_id = u.id WHERE u.card_id = :card AND <_candidate(V)> ON CONFLICT (user_low, user_high) DO UPDATE
    SET <my side>_liked_at = coalesce(person_pairs.<my side>_liked_at, now()) RETURNING other_id,
    low_liked_at, high_liked_at`.
    - "My side" is computed in SQL (`:me < u.id`).
    - No row returned gives `NotFoundError` (unknown, own, hidden, gender misfit, already mutual).
    - The candidate rule is evaluated in the INSERT's own snapshot. A card hidden at the same instant can
      still let one like land, which is harmless: the lists re-check it.
  - When both are set, `chat.open_direct(db, me, other)` in the same transaction, then one commit, then
    `chat_events.publish(r, [me, other], conversation_id, "status")`.
  - **Concurrency:** the upsert takes the pair's row lock (an INSERT race resolves on the PK), so of two
    crossing likes the later one sees both timestamps and exactly one opens the chat. `open_direct` is
    idempotent anyway.
  - A repeated PUT on an already-mutual pair cannot happen (not a candidate, so 404). A PUT that only adds my
    like returns `{liked: true, conversation_id: null}`.
- **`unlike(db, me, card_id)`**:
  - One UPDATE sets my side's `liked_at` to NULL where the pair exists **and is not mutual**, then a commit.
  - If that hit nothing and the pair is mutual (one EXISTS, run only then), `MutualMatchError`.
  - An unknown card is a no-op (204).
- **`remove_match(db, r, me, conversation_id)`**:
  - One SELECT of the conversation where `id = :id AND application_id IS NULL AND me IN (owner_id,
    seeker_id)`, else `NotFoundError`.
  - Then `chat.close_direct(db, owner_id, seeker_id)` and one UPDATE of the pair, setting both `liked_at` to
    NULL **where both are set**, then one commit and a `status` event to both. A repeated DELETE on the
    closed chat must not wipe a newer one-sided like (verifier finding 3).
  - Both people reappear in each other's browse as fresh candidates. A new mutual like reopens the same chat
    with its history (0010g AC5).
- **`my_people_likes(db, me)`**:
  - The viewer SELECT (`CardRequiredError` without a ticket), then one statement over the caller's pairs (both
    sides, via the PK and `ix_person_pairs_user_high`).
  - `liked_me`: the other liked me, I did not, and the other is a `_candidate(V)` now.
  - `mine`: I liked, the other did not, and the other is a candidate now.
  - `matches`: both liked. Joined to the direct conversation by the ordered pair (`uq_conversations_direct_pair`),
    with the name and photo of the other person, whatever their card's visibility now (the chat-member rule,
    decision 15). `matched_at = greatest(low_liked_at, high_liked_at)`.
  - Newest first in each list.
  - `# shortcut: each list capped at 100 rows (the like limit is 100 a day); page it with /me/likes (FOLLOWUPS:160)`.
- **Room side.** `routers/people.py::list_people` calls `count_browse` before the service, so one counter covers
  both browse surfaces (FOLLOWUPS:167 closed).

## UI
None. The screens are `0010i-people-browse-web`. `make client` regenerates the web types, which the web
only reads in `0010i`, so web `make lint` stays green here.

## Acceptance criteria
- [ ] AC1 (ticket) Given `A` with no profile and no room, When `A` GETs `/people` and `/me/people-likes`, Then
  403 `card_required`. Given `A` gets a live room (no card), Then `/people` is 200, and `A` sees only people with
  `flatmate_gender = 'any'`. Given `A` instead shows a card, Then 200. Pausing the room or hiding the card takes
  the ticket away on the next call. — `api/tests/test_market_people.py::test_ac1_entry_ticket`
- [ ] AC2 (gender both ways) The cases below use a table of viewers (woman / man / other, each with flatmate
  preference any / women / men) and people (the same nine). In every case `/people` shows the person exactly
  when `person_fit` holds both ways:
  - a man is hidden from a woman whose preference is women, **and** she is hidden from him;
  - a person who wants women is hidden from a man and from "other";
  - an `'any'` pair always shows;
  - a viewer with no profile (`None`, `'any'`) sees only people whose preference is `'any'`.

  `person_fit`'s SQL is checked against the same table. — `test_person_fit.py::test_ac2_two_way_matrix`,
  `test_market_people.py::test_ac2_browse_applies_gender_rule`
- [ ] AC3 (card contents, privacy) A `PersonCardOut` holds exactly the listed keys. The response JSON contains
  no `budget_max_ils` value, no user id (neither the viewer's nor the person's), no email and no
  `flatmate_gender`. A statement recorder shows the page SELECT never names `budget_max_ils`. The caller, hidden
  cards and already-matched people are absent. `photo_url` is the small URL for a person with a photo, else
  null. — `test_market_people.py::test_ac3_card_fields_and_privacy`
- [ ] AC4 (order and paging) Given 25 candidates, two of whom liked the viewer (and share no area with the viewer) and five of whom
  share an area,
  Then page 1 starts with the two likers, then the five sharers, then the rest by `updated_at` desc. `total` is
  25. `offset=20` returns 5. `offset=1001` gives 422. — `test_market_people.py::test_ac4_order_and_paging`
- [ ] AC5 (like, one side) When `A` (with a card) PUTs `B`'s like, Then 200 `{liked: true, conversation_id:
  null}`:
  - `B`'s browse shows `A` with `liked_me` true, first;
  - `B`'s `/me/people-likes` has `A` in `liked_me`;
  - `A`'s has `B` in `mine`.

  A second PUT keeps the first `liked_at`. — `test_market_people.py::test_ac5_one_sided_like`
- [ ] AC6 (mutual opens a direct chat) When `B` then likes `A`, Then:
  - 200 with a `conversation_id`;
  - one direct conversation exists for the pair;
  - `chat_events.publish` got `{A, B}` with `"status"`;
  - both see the pair under `matches` (name, photo, `matched_at`) and no longer in browse or in
    `liked_me` / `mine`;
  - both can send in `/conversations/{id}`.

  Two crossing PUTs on two connections open exactly one chat: exactly one of the two responses carries a
  `conversation_id`, and `publish` is called once. — `test_market_people.py::test_ac6_mutual_opens_direct_chat`
- [ ] AC7 (unlike) `A` DELETEs a one-sided like: 204, and `B` no longer sees `A` as liked-me. A DELETE of an
  unknown card is 204. A DELETE on a mutual pair is 409 `mutual_match`, and nothing changes. —
  `test_market_people.py::test_ac7_unlike`
- [ ] AC8 (remove match, Q14) When `B` DELETEs `/me/matches/{conversation_id}`, Then:
  - 204, and both likes are NULL;
  - the chat is readable by both, and sending gets 409 `chat_closed`;
  - a `status` event reached `{A, B}`;
  - both reappear in each other's browse;
  - a second DELETE is 204;
  - after `A` re-likes `B` (one-sided), a repeated DELETE by `B` keeps `A`'s like.

  When both like again, Then the **same** conversation id comes back and sending works. A third user, an
  unknown id and an application chat's id all get 404. — `test_market_people.py::test_ac8_remove_match_and_rematch`
- [ ] AC9 (like guards) The like PUT refuses these cases, and refused attempts still count toward the like
  limit:
  - `A` without a card (a live room only) gets 403 `card_required`;
  - a like of a hidden card, of a gender misfit, or of oneself gets 404 `not_found`;
  - the 31st like in an hour (shared with room likes, `rl:like:user:*`) gets 429 with `Retry-After`.

  — `test_market_people.py::test_ac9_like_guards`
- [ ] AC10 (hidden card) When `B` hides the card (`people_visible` false via `PUT /me/profile`), Then `B`
  disappears from `A`'s browse, from `A`'s `liked_me` / `mine`, and from new likes (404). `B`'s browse is now
  403 (no ticket, unless `B` has a live room). An existing match and its chat stay. —
  `test_market_people.py::test_ac10_hidden_card`
- [ ] AC11 (browse limit) The 301st `GET /people` in an hour gets 429 with `Retry-After`. Calls refused with 403
  count too. — `test_market_people.py::test_ac11_browse_rate_limit`
- [ ] AC12 (room side limit) `GET /listings/{id}/people` shares the browse counter: after 300 browses split
  across `/people` and the room page, the next room-page call gets 429. Every other 0008a assertion passes
  unchanged. — `api/tests/test_people.py::test_ac12_room_people_browse_rate_limited`
- [ ] AC13 (perf) `GET /people` is two statements after the session lookup (viewer, page), and
  `/me/people-likes` is two. A non-mutual like is two statements (viewer, the checking upsert), and a mutual
  one is three (plus `open_direct`). `EXPLAIN` of the page statement reaches `person_pairs` only through
  `person_pairs_pkey` or a hash join, never a Seq Scan on `person_pairs` inside a Nested Loop. Timing (p95
  under 50 ms with 5,000 visible cards) is a perf-review measurement, not a test. —
  `test_market_people.py::test_ac13_statement_counts_and_plan`
- [ ] AC14 Migration: upgrade `"0016"` → `"0017"` → downgrade → upgrade on a database with users and a direct
  chat. Every user gets a distinct `card_id`. `person_pairs`, its CHECK, PK and index appear and disappear,
  and the direct chat survives. — `api/tests/test_migrations.py::test_ac14_person_likes_upgrade_downgrade`
## Tests to write
Integration:
- `test_market_people.py`: AC1–AC11, AC13.
- `test_person_fit.py`: AC2's SQL table.
- `test_people.py`: AC12.
- `test_migrations.py`: AC14.

Unit (web): none. The web is `0010i`.

E2E: none here. `0010i` adds `people-market.spec.ts`. One existing e2e test could be affected:
`people.spec.ts` (room side) calls `/listings/{id}/people` a few times per run, far under 300 an hour. e2e
runs only in CI.

## Risks / open questions
- **depends_on adds `0010e`** beyond section 7's `0010c, 0010g, 0010f`. The card uses 0010e's shared `Avatar`,
  and the wave order (`e ∥ f` → `h`) already puts `0010e` before this spec. If the orchestrator prefers the
  section 7 list, the card renders `photo_url` in a plain `<img>` with the initial-letter fallback instead.
- **Decided (Gilad, 2026-11-13):**
  - (Q-A) after a match is removed, the two reappear in each other's browse. Either can like again, and a new
    mutual like reopens the same chat. There is no `removed_at` column, so `person_pairs` keeps section 7's
    columns.
  - (Q-B) a lister with a live room but no visible card may browse people (Q13) but cannot like anyone: the
    like returns 403 `card_required`, and the web shows the nudge to show the card.
- **About me carries contact details (FOLLOWUPS:162).** Wider browse makes it matter more: anyone with a card
  now reads every visible card's text, not only room listers. It stays open as a trust-slice item. The browse
  rate limit bounds bulk harvesting.
- **Gender rule on stale state:** a pair's likes stay stored after either side changes gender or preference. The
  lists and likes re-check `_candidate` live, so a misfit is never shown or matched. An existing match stays
  (its chat was already open).
- **Browse is a read** (no snapshot), so the 0008a snapshot growth does not repeat here.
- **One counter for both browse surfaces**, sized in pages (300 an hour), with the web never invalidating
  browse on a like. Raise the constant if logs show real users hitting it.
- **Split (verifier finding 1; orchestrator, 2026-11-13).** One coder run could not hold both halves, so the
  web is `0010i-people-browse-web`. This spec is the API only, and its depends_on is exactly section 7's.
- Spec-verifier round 1 (Opus, high): 15 findings (3 majors, 9 minors, 3 nits), all applied across this spec
  and `0010i`. Applied here:
  - the browse limit sized in pages;
  - a removed match no longer wipes a later like;
  - the like's target check folded into its write;
  - AC13 without timing, a stronger AC6, the no-gender viewer row in AC2, AC4's data;
  - the split itself.

  The second round is waived (one verifier round, Gilad). round 1: 15 findings applied.

## Digest (filled by orchestrator after verification)
See `/digest`.
