---
id: 0008d
title: A room's lister shares an invite link; whoever opens it joins the flat, and from then on every chat about that room is a group chat of the lister, the flatmates and the candidate, each flatmate seeing messages from the moment they joined
status: draft
depends_on: [0008a]   # migration chain 0011 -> 0012; the mutual-like router publishes to every chat member (people.py, 0008a). 0005a/0005c (done): conversations, messages, read markers, SSE publish
reviewers: [code, qa, security, perf]   # security: a capability link that grants chat access, history cut at join, membership in every chat statement, apartment applications kept out; perf: the membership EXISTS on the chat list and unread count (0005a's one-statement list); qa: join/leave/remove/rotate against live chats and status changes
estimate: 1 coder run   # coder Opus/high (chat access control, migration; Speed rule 6)
---

## Goal
After this ships, the owner of a **room** listing creates an invite link. It can be rotated, and turned off.
A signed-in user who opens the link and confirms becomes a **flatmate** of that listing. From that moment:
- every conversation about the room (application chats, `0005a`, and mutual matches, `0008a`) includes them;
- they read the messages sent **after they joined**, send while the application is shortlisted, and have their
  own unread count;
- the thread lists every member;
- chat events reach them.

The owner lists and removes flatmates, and a flatmate can leave. Flatmates never see the applicant inbox, people
browse or any profile data (they chat only).

This serves PRODUCT.md "Flatmates" (Gilad, 2026-11-11: invite link, chat only, history from joining on, the
header lists every member) and "Chat" ("Slice 8 generalises it"). It is Dev Plan slice 8, part d. The web half
is `0008e`.

## Scope
**In:**
- Migration `api/alembic/versions/0012_flatmates.py` (revision `"0012"`, down `"0011"`), see Data. Models:
  `ListingFlatmate` and `ConversationRead` in `api/app/models/flatmate.py` (new, exported), and
  `Listing.flatmate_invite_hash`.
- `api/app/services/flatmates.py` (new): invite create/rotate/disable, lookup, join, list, remove, leave, and
  `FLATMATES_MAX = 7` (the `FlatmatesCount` bound, `0007a`). The invite token is
  `secrets.token_urlsafe(32)`. Only `sha256` hex reaches Postgres, as session tokens do
  (`services/auth.py::_token_hash`, reused).
- `api/app/routers/flatmates.py` (new), registered in `create_app`.
- `api/app/schemas/flatmates.py` (new):
  - `InviteOut {token: str}`. It is returned only by the create/rotate POST and can never be read again.
  - `InvitePreviewOut {listing: ApplicationListingOut, owner_name: str, member: bool}`.
  - `JoinOut {listing_id: UUID}`.
  - `FlatmateOut {id: UUID, display_name: str, joined_at: datetime}`. `id` is the membership row's id.
  - `MyFlatOut {listing: ApplicationListingOut, owner_name: str, joined_at: datetime}`.
- `api/app/services/chat.py`, generalised from two participants to members:
  - `_is_member(me)` becomes: `owner_id = me` OR `seeker_id = me` OR `EXISTS (listing_flatmates F WHERE
    F.listing_id = Application.listing_id AND F.user_id = me AND Application.listing_type_at_apply =
    'room')`. Every statement that uses it already joins `Application`. An **apartment** application never
    gains flatmates, even when its listing is later switched to a room. The type snapshot is `0007b`'s.
  - **Visible-from**: for a flatmate, `F.joined_at`; for the owner and the seeker, `-infinity`. The thread,
    the list's newest-message lateral and the unread count all add `Message.created_at >= visible_from`.
  - **Read marker**: the owner and the seeker keep `owner_read_at` / `seeker_read_at`. A flatmate's marker is
    `conversation_reads.read_at`, through an outer join on (`conversation_id`, `me`). `is_new` for a flatmate
    is "no `conversation_reads` row". The unread count's `since` is `greatest(coalesce(my_read_at,
    '-infinity'), visible_from)`.
  - `get_thread` writes the flatmate marker with `INSERT ... ON CONFLICT (conversation_id, user_id) DO UPDATE
    SET read_at = now()`, under the same "only when something is new" rule (NF3).
  - `send_message`: a flatmate may send while the application is `shortlisted`. The sender's marker moves
    forward as today, or by the upsert for a flatmate. It returns the message and `member_ids` (below) in
    place of the `(owner_id, seeker_id)` pair.
  - New `member_ids(db, application_id) -> list[UUID]`: the owner, the seeker and the flatmates (only when the
    application is a room one). It is one statement.
  - `my_role` (`'owner' | 'seeker' | 'flatmate'`) is one CASE, selected in the list and in the header.
- `api/app/schemas/chat.py`:
  - `MemberRole = Literal["owner", "seeker", "flatmate"]`.
  - `MemberOut {name: str, role: MemberRole}`.
  - `MessageOut` gains `sender_name: str`.
  - `ConversationOut` gains `my_role` and `member_count: int`.
  - `ThreadOut` gains `my_role`, `members: list[MemberOut]` (owner first, then flatmates by `joined_at`, then
    the seeker; the caller included) and `visible_from: datetime | None` (the flatmate's `joined_at`, else
    null).
  - `other_name` stays. For the owner and for a flatmate it is the seeker's name; for the seeker, the owner's.
  - The module docstring's "two participants" paragraph is rewritten to say members.
- Routers that publish chat events (`routers/chat.py::send_message`,
  `routers/applications.py::withdraw` / `set_applicant_status`, `routers/people.py`'s mutual like) publish to
  `chat.member_ids(...)`, not to the pair. A flatmate's open tab hears every message and status change.
- `api/app/services/applications.py::apply` and `services/people.py::like_room`: a caller who is a flatmate of
  the listing is treated like its owner, which is `ListingNotFoundError` (404). A flatmate cannot apply to or
  like their own flat.
- `api/app/services/listings.py::update_listing`: a switch to `apartment` also sets `flatmate_invite_hash =
  NULL`. Memberships stay; they reach room applications only.
- `api/app/schemas/listing.py`: `MyListingOut` gains `flatmate_count: int` and `flatmate_invite_active: bool`.
  `list_own_listings` adds one correlated count. The flag is read from the loaded row.
- The limiter `rl:flatmate:user:{id}`: 20 lookups or joins an hour per user. It counts every authenticated
  attempt, found or not, so tokens cannot be scanned cheaply.
- Tests: `api/tests/test_flatmates.py` (new), with amendments to `test_chat.py` (new fields asserted where whole
  bodies are compared, and the statement counts in AC12), `test_migrations.py`, `test_listings.py`.
  `conftest.py` gains `make_flatmate(engine, listing_id, user_id, *, joined_at=None) -> uuid.UUID`.

**Out:**
- Web (`0008e`).
- Flatmates seeing the inbox, people browse, the applicant's profile, or deciding on applicants (PRODUCT.md:
  chat only).
- Email invites, invite expiry dates, or several live links per listing. There is one link per listing, and
  rotating it kills the old one.
- Notifications (as every slice so far).
- Flatmates on apartment listings.

**New dependencies:** none (`secrets`, `hashlib` are stdlib).

## Data
Migration `0012_flatmates` (down `0011`):
- `listings.flatmate_invite_hash text NULL`, with `uq_listings_flatmate_invite_hash UNIQUE`. NULLs never
  collide. NULL means no live link.
- `listing_flatmates`:
  - `id uuid PK DEFAULT gen_random_uuid()`;
  - `listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE`;
  - `user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE`;
  - `joined_at timestamptz NOT NULL DEFAULT now()`;
  - `uq_listing_flatmates_listing_user UNIQUE (listing_id, user_id)` (it also serves the EXISTS) and
    `ix_listing_flatmates_user_id (user_id)` for `/me/flats`.
- `conversation_reads`:
  - `conversation_id uuid NOT NULL REFERENCES conversations(application_id) ON DELETE CASCADE`;
  - `user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE`;
  - `read_at timestamptz NOT NULL`;
  - `PRIMARY KEY (conversation_id, user_id)`.

  It is written for flatmates only. Owners and seekers keep their columns.

Downgrade drops the three in reverse. A re-join after leaving inserts a new membership row with a new
`joined_at`, so a flatmate who leaves and comes back sees only what was sent after the re-join. The old
`conversation_reads` rows are deleted on leave and on remove.

## API
| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| POST | `/listings/{listing_id}/flatmate-invite` | `current_owner`, own **room** listing (any status) | — | 201 `InviteOut` (rotates: the old link stops working) | 401; 403 `owner_only`; 404 `not_found` (unknown, another's, an apartment) |
| DELETE | `/listings/{listing_id}/flatmate-invite` | `current_owner`, own listing | — | 204 | 401; 403; 404 |
| GET | `/flatmate-invites/{token}` | `current_user` (any role) | — | 200 `InvitePreviewOut` | 401; 404 `not_found` (unknown or rotated token, the listing is an apartment); 409 `own_listing`; 429 |
| POST | `/flatmate-invites/{token}/join` | `current_user` | — | 200 `JoinOut` (idempotent: a member gets 200 and keeps the original `joined_at`) | 401; 404; 409 `own_listing`, `already_applied` (the caller has a non-withdrawn application to it), `flatmates_full` (`FLATMATES_MAX`); 429 |
| GET | `/listings/{listing_id}/flatmates` | `current_owner`, own listing | — | 200 `list[FlatmateOut]`, oldest first | 401; 403; 404 |
| DELETE | `/listings/{listing_id}/flatmates/{flatmate_id}` | `current_owner`, own listing | — | 204 | 401; 403; 404 (unknown, or another listing's membership) |
| GET | `/me/flats` | `current_user` | — | 200 `list[MyFlatOut]`, newest join first | 401 |
| DELETE | `/me/flats/{listing_id}` | `current_user` | — | 204 (always) | 401 |
| GET | `/me/conversations`, `/me/conversations/{id}`, POST `.../messages` (changed) | `current_user`, a **member** | as today | `+my_role`, `+member_count`; thread `+members`, `+visible_from`, messages `+sender_name` | as today (404 for a non-member) |
| GET | `/me/listings` (changed) | as today | — | `+flatmate_count`, `+flatmate_invite_active` | as today |

The token travels in the path. It is never logged: `access_log` is uvicorn's, and the spec asks the coder to
check that the app's own logging never prints request paths for these routes. The web keeps it out of
analytics, since there are none. The preview names the owner, because the person invited knows them.

## Acceptance criteria
- [ ] AC1 Given owner `O` with room `R`, When `O` POSTs the invite, Then a 43-character token comes back and the
  row's `flatmate_invite_hash` is its sha256 (the token itself is in no column). A second POST returns a new
  token, and the first then gives 404 on GET. DELETE turns the link off (both give 404), and `GET /me/listings`
  shows `flatmate_invite_active` false. An apartment gives 404, and a seeker gets 403. —
  `api/tests/test_flatmates.py::test_ac1_invite_create_rotate_disable`
- [ ] AC2 Given a live token, When user `F` (any role) GETs it, Then the preview has the listing summary,
  `owner_name` and `member: false`. After the join POST, `member` is true. A second join returns 200 with the
  same `joined_at`. `O` opening the link gets 409 `own_listing`. A seeker with a submitted application to `R`
  gets 409 `already_applied`. The 8th joiner gets 409 `flatmates_full`. The 21st lookup or join in an hour
  gets 429. — `test_flatmates.py::test_ac2_preview_and_join`
- [ ] AC3 (security: history from joining on) Given a shortlisted application of seeker `S` to `R` whose
  conversation has messages m1 and m2, When `F` joins and then `S` sends m3, Then:
  - `F`'s `GET /me/conversations` lists it with `my_role: "flatmate"`, `other_name` = `S`'s name,
    `member_count` 3, `unread_count` 1 and `last_message` m3;
  - `F`'s thread holds m3 only, with `visible_from` = `F`'s `joined_at`;
  - `members` is `[O owner, F flatmate, S seeker]`;
  - m3's `sender_name` is `S`'s name.

  `S`'s and `O`'s threads still hold m1–m3 and list the same three members. — `test_flatmates.py::test_ac3_history_from_join`
- [ ] AC4 Given AC3, When `F` POSTs m4, Then it is stored with `F` as sender, and `O`'s and `S`'s unread counts
  include it. `chat_events.publish` (monkeypatched) is called with the set `{O, F, S}`. After `O`
  un-shortlists, `F` gets 409 `chat_closed`, as the others do. An `O` re-shortlist reopens sending for all
  three, and the status events reached `{O, F, S}`. — `test_flatmates.py::test_ac4_flatmate_sends_and_hears_events`
- [ ] AC5 (security: apartment applications) Given listing `A`, an apartment with a shortlisted application
  chat, When `A` is switched to a room and `F` joins it, Then `F` does not see that conversation (404 on its id,
  absent from the list), because its `listing_type_at_apply` is `apartment`. A new room application to `A` that
  gets shortlisted is visible to `F`. Switching `A` back to an apartment sets `flatmate_invite_hash` to NULL.
  — `test_flatmates.py::test_ac5_apartment_applications_have_no_flatmates`
- [ ] AC6 (security: removal) When `O` DELETEs `F`'s membership, Then `F` immediately gets 404 on the thread
  and on a send, and the conversation is gone from `F`'s list. `F`'s `conversation_reads` rows are deleted.
  `GET /listings/{R}/flatmates` no longer lists `F`. When `F` re-joins via a fresh link, Then `F`'s
  `visible_from` is the new `joined_at` and older messages stay hidden. DELETE of another listing's membership
  id gives 404. — `test_flatmates.py::test_ac6_remove_and_rejoin`
- [ ] AC7 When `F` DELETEs `/me/flats/{R}`, Then it is as AC6 for `F`. `GET /me/flats` lists `F`'s other flats
  only. DELETE of an unknown listing returns 204. — `test_flatmates.py::test_ac7_leave`
- [ ] AC8 Given `F` is a flatmate of `R`, When `F` (a seeker with a profile) applies to `R` or likes `R`, Then
  both give 404 `not_found`. — `test_flatmates.py::test_ac8_flatmate_cannot_apply_or_like_own_flat`
- [ ] AC9 Read markers: `F`'s first thread GET marks it read. The list then shows `is_new: false` and
  `unread_count: 0`. A second GET with nothing new writes nothing (the statement counter sees no
  INSERT/UPDATE). `O`'s and `S`'s own markers are untouched by `F`'s reads. — `test_flatmates.py::test_ac9_flatmate_read_marker`
- [ ] AC10 A mutual like on `R` (`0008a`) opens a conversation that `F` sees, and the mutual router's publish
  includes `F`. — `test_flatmates.py::test_ac10_mutual_match_includes_flatmates`
- [ ] AC11 Migration: upgrade `"0011"` → `"0012"` → downgrade → upgrade on a database with a listing,
  application and conversation. The tables and column appear and disappear, the existing rows survive, and
  the unique and FK constraints exist with their names. — `api/tests/test_migrations.py::test_ac11_flatmates_upgrade_downgrade`
- [ ] AC12 (perf) `GET /me/conversations` stays one statement after the session lookup (0005a AC4's count),
  for an owner, a seeker and a flatmate. The thread GET is at most one statement more than today (the members
  SELECT). 0005a's `test_ac4_list_is_two_statements` passes unchanged, and the thread count assertion, if any,
  is raised by one with a comment. — `test_chat.py` (amended), `test_flatmates.py::test_ac12_statement_counts`
- [ ] AC13 Regression: the whole of `test_chat.py` and `test_chat_events.py` passes, with only the added
  response fields asserted. A one-to-one conversation reports `member_count` 2, `members` [owner, seeker], and
  `sender_name` = the other's name or the caller's own. — `test_chat.py` (amended)

## Tests to write
Integration: `test_flatmates.py` AC1–AC10 and AC12, `test_migrations.py` AC11, `test_chat.py` amendments.
Unit: none new (no pure functions).
E2E: none (`0008e`).

## Risks / open questions
Gilad's decisions are in PRODUCT.md "Flatmates". The orchestrator made these assumptions:
- one live link per listing, rotate to revoke;
- at most 7 flatmates;
- any role may join;
- a flatmate cannot apply to or like their own flat;
- removal and leaving cut access at once and drop read markers;
- re-joining restarts the history.
- **Capability link (security):** anyone holding the link (a forwarded WhatsApp message) can join. The owner
  sees every flatmate and can remove them or rotate the link, and the seeker sees every member in the header.
  Accepted for MVP. An approval step ("the owner confirms each joiner") is the fallback if abuse shows up.
- **Membership EXISTS on every chat statement (perf):** it is an index probe on
  `uq_listing_flatmates_listing_user` per conversation row, so the list stays one statement. The perf reviewer
  checks the plan with a flatmate, an owner and a seeker caller.
- **`member_ids` before publish** is one extra SELECT after each commit that publishes. It is cheap, and
  publishing stays best-effort (`0005c`).
- **The seeker's chat changes shape mid-conversation:** when a flatmate joins, the seeker's thread gains a
  member. `0008e` shows the member list in the header, so the seeker is never unaware who reads. Messages sent
  before the join stay hidden from the flatmate (Gilad).

## Digest (filled by orchestrator after verification)
See `/digest`.
