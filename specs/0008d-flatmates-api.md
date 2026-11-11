---
id: 0008d
title: A room's lister shares an invite link; whoever opens it joins the flat, and from then on every chat about that room is a group chat of the lister, the flatmates and the candidate, each flatmate seeing messages from the moment they joined
status: verified
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
- `api/app/services/chat.py`, generalised from two participants to members (verifier finding 1):
  - Membership is one LEFT JOIN, `listing_flatmates F ON F.listing_id = Application.listing_id AND F.user_id =
    :me AND Application.listing_type_at_apply = 'room'`. It is unique on (listing, user), so rows never
    multiply. `_is_member(me)` becomes `owner_id = me OR seeker_id = me OR F.id IS NOT NULL`. **Every**
    statement that uses it joins `Application` and `F`. That includes the fallback membership SELECT in
    `send_message` (`chat.py:251-255`, today `Conversation` only), so a non-member always gets 404, never 409.
    An **apartment** application never gains flatmates, even when its listing is later switched to a room. The
    type snapshot is `0007b`'s.
  - `my_role` resolves in order: owner (`owner_id = me`), then seeker (`seeker_id = me`), then flatmate. A
    withdrawn seeker who later joined, or a join racing an apply, is never both.
  - `_is_other(me)` becomes `case((Conversation.seeker_id == me.id, Conversation.owner_id),
    else_=Conversation.seeker_id)`. The owner and a flatmate get the seeker's name; the seeker gets the owner's.
  - `send_message`'s marker CASEs test `owner_id = me` and `seeker_id = me` separately. A flatmate's send
    leaves both columns alone and upserts `conversation_reads` instead (today the else-branch would move
    `seeker_read_at`).
  - **Visible-from**: for a flatmate, `F.joined_at`; for the owner and the seeker, `-infinity`. The thread,
    the list's newest-message lateral and the unread count all add `Message.created_at >= visible_from`.
  - **Read marker**: the owner and the seeker keep `owner_read_at` / `seeker_read_at`. A flatmate's marker is
    `conversation_reads.read_at`, through an outer join on (`conversation_id`, `me`). `is_new` for a flatmate
    is "no `conversation_reads` row". The unread count's `since` is `greatest(coalesce(my_read_at,
    '-infinity'), visible_from)`.
  - `get_thread` writes the flatmate marker with `INSERT ... ON CONFLICT (conversation_id, user_id) DO UPDATE
    SET read_at = now()`, under the same "only when something is new" rule (NF3).
  - `send_message`: a flatmate may send while the application is `shortlisted`. The sender's marker moves
    forward as above. It returns the message and the member ids in place of the `(owner_id, seeker_id)`
    pair. They come from its existing UPDATE: `RETURNING owner_id, seeker_id, ARRAY(SELECT user_id FROM
    listing_flatmates WHERE listing_id = <the application's listing> AND <application is room> AND user_id
    <> seeker_id)`. So a send adds **no** statement (verifier finding 2).
  - New `member_ids(db, application_id) -> list[UUID]`: the owner, the seeker and the flatmates. It is one
    statement, run **only for a room application** (`listing_type_at_apply = 'room'`). For an apartment
    application, the routers publish `[owner_id, seeker_id]` from rows they already hold, with no query. So
    every existing statement-count test stays as it is, because all of them use apartment fixtures
    (`conftest.make_listing`'s default): `test_chat.py:251,264,277` (shortlist 4/3/3), `test_inbox.py:356`
    (set_status 4), and `test_chat_events.py:545-597` (`{o, s}`).
  - `members` in the thread excludes a flatmate row whose `user_id = Conversation.seeker_id` (verifier
    finding 4).
  - `my_role` (`'owner' | 'seeker' | 'flatmate'`) is one CASE, selected in the list and in the header.
- `api/app/schemas/chat.py`:
  - `MemberRole = Literal["owner", "seeker", "flatmate"]`.
  - `MemberOut {name: str, role: MemberRole, is_me: bool}`. `is_me` lets the web render the caller as
    "את/ה" even with two flatmates of the same name (`0008e` verifier finding 2).
  - `MessageOut` gains `sender_name: str`.
  - `ConversationOut` gains `my_role` and `member_count: int`.
  - `ThreadOut` gains `my_role`, `members: list[MemberOut]` (owner first, then flatmates by `joined_at`, then
    the seeker; the caller included) and `visible_from: datetime | None` (the flatmate's `joined_at`, else
    null).
  - `other_name` stays. For the owner and for a flatmate it is the seeker's name; for the seeker, the owner's.
  - The module docstring's "two participants" paragraph is rewritten to say members.
- Routers that publish chat events (`routers/applications.py::withdraw` / `set_applicant_status`,
  `routers/people.py`'s mutual like) publish to `chat.member_ids(...)` for a room application, and to the
  pair otherwise. `routers/chat.py::send_message` publishes to the ids `send_message` returned. A flatmate's
  open tab hears every message and status change.
- `api/app/services/applications.py::apply` and `services/people.py::like_room`: a caller who is a flatmate of
  the listing is treated like its owner, which is `ListingNotFoundError` (404). `services/people.py`'s
  **candidate** condition (`0008a`) gains `NOT EXISTS (listing_flatmates F WHERE F.listing_id = L.id AND
  F.user_id = P.user_id)`. So a lister's like can never make their own flatmate mutual on the flat (verifier
  finding 5). A flatmate cannot apply to, like, or be liked for their own flat.
- `api/app/services/listings.py::update_listing`: a switch to `apartment` also sets `flatmate_invite_hash =
  NULL`. Memberships stay; they reach room applications only.
- `api/app/schemas/listing.py`: `MyListingOut` gains `flatmate_count: int` and `flatmate_invite_active: bool`.
  `list_own_listings` adds one correlated count, so its return type becomes `tuple[Listing, int, int, int,
  int]` after `0008a`. `routers/listings.py::my_listings` sets `flatmate_invite_active =
  listing.flatmate_invite_hash is not None`. The hash never enters `ListingOut` or any other response.
- Join locks the listing: it selects the listing by hash `FOR UPDATE`, then counts the members and inserts. Two
  concurrent joins at 6 members therefore cannot both pass `FLATMATES_MAX` (verifier finding 7).
- The owner's DELETE of a membership also sets `flatmate_invite_hash = NULL` in the same transaction, so a
  removed flatmate cannot re-join with the link they still hold. The owner makes a new link for the others.
  Leaving does not touch the link (verifier finding 3).
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
| POST | `/flatmate-invites/preview` | `current_user` (any role) | `{token: str}` (`InviteTokenIn`, 1–100 chars) | 200 `InvitePreviewOut` | 401; 404 `not_found` (unknown or rotated token, the listing is an apartment); 409 `own_listing`; 422; 429 |
| POST | `/flatmate-invites/join` | `current_user` | `{token: str}` | 200 `JoinOut` (idempotent: a member gets 200 and keeps the original `joined_at`) | 401; 404; 409 `own_listing`, `already_applied` (the caller has a non-withdrawn application to it), `flatmates_full` (`FLATMATES_MAX`); 422; 429 |
| GET | `/listings/{listing_id}/flatmates` | `current_owner`, own listing | — | 200 `list[FlatmateOut]`, oldest first | 401; 403; 404 |
| DELETE | `/listings/{listing_id}/flatmates/{flatmate_id}` | `current_owner`, own listing | — | 204 | 401; 403; 404 (unknown, or another listing's membership) |
| GET | `/me/flats` | `current_user` | — | 200 `list[MyFlatOut]`, newest join first | 401 |
| DELETE | `/me/flats/{listing_id}` | `current_user` | — | 204 (always) | 401 |
| GET | `/me/conversations`, `/conversations/{conversation_id}`; POST `/conversations/{conversation_id}/messages` (changed) | `current_user`, a **member** | as today | `+my_role`, `+member_count`; thread `+members`, `+visible_from`, messages `+sender_name` | as today (404 for a non-member) |
| GET | `/me/listings` (changed) | as today | — | `+flatmate_count`, `+flatmate_invite_active` | as today |

**The API never takes the token in a URL** (verifier finding 3). Uvicorn's access log records full paths
(`infra/Dockerfile.api:23`, `infra/docker-compose.yml:39`), and `main.py` logs `request.url.path` on 503s. So
both token calls are POSTs with the token in the body. The web route `/flatmates/join/:token` (`0008e`) reads
it from the browser URL and sends it in the body. The preview names the owner, because the person invited
knows them.

## Acceptance criteria
- [ ] AC1 Given owner `O` with room `R`, When `O` POSTs the invite, Then a 43-character token comes back and the
  row's `flatmate_invite_hash` is its sha256 (the token itself is in no column). A second POST returns a new
  token, and the first then gives 404 on preview. DELETE turns the link off (both give 404), and `GET /me/listings`
  shows `flatmate_invite_active` false. An apartment gives 404, and a seeker gets 403. —
  `api/tests/test_flatmates.py::test_ac1_invite_create_rotate_disable`
- [ ] AC2 Given a live token, When user `F` (any role) POSTs it to `/flatmate-invites/preview`, Then the
  preview has the listing summary, `owner_name` and `member: false`. After the join POST, `member` is true. A
  second join returns 200 with the same `joined_at`. `O` previewing gets 409 `own_listing`. A seeker with a
  submitted application to `R` gets 409 `already_applied`. The 8th joiner gets 409 `flatmates_full`, including
  when the 7th and 8th join concurrently on two connections. The 21st preview or join in an hour gets 429. No
  route has the token in its path: a test walks `app.routes` and asserts it. — `test_flatmates.py::test_ac2_preview_and_join`
- [ ] AC3 (security: history from joining on) Given a shortlisted application of seeker `S` to `R` whose
  conversation has messages m1 and m2, When `F` joins and then `S` sends m3, Then:
  - `F`'s `GET /me/conversations` lists it with `my_role: "flatmate"`, `other_name` = `S`'s name,
    `member_count` 3, `unread_count` 1 and `last_message` m3;
  - `F`'s thread holds m3 only, with `visible_from` = `F`'s `joined_at`;
  - `members` is `[O owner, F flatmate, S seeker]`, with `is_me` true on `F` only;
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
  `GET /listings/{R}/flatmates` no longer lists `F`. The listing's invite link is turned off, so `F`'s old
  token gives 404 on preview and join. When `F` re-joins via a fresh link, Then `F`'s
  `visible_from` is the new `joined_at` and older messages stay hidden. DELETE of another listing's membership
  id gives 404. — `test_flatmates.py::test_ac6_remove_and_rejoin`
- [ ] AC7 When `F` DELETEs `/me/flats/{R}`, Then it is as AC6 for `F`. `GET /me/flats` lists `F`'s other flats
  only. DELETE of an unknown listing returns 204. — `test_flatmates.py::test_ac7_leave`
- [ ] AC8 Given `F` is a flatmate of `R`, When `F` (a seeker with a profile) applies to `R` or likes `R`, Then
  both give 404 `not_found`. Given `F` liked `R` before joining and is `people_visible`, Then `F` is not on
  `R`'s people page, and `O`'s like on `F`'s old pair gives 404. — `test_flatmates.py::test_ac8_flatmate_cannot_apply_or_like_own_flat`
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
  SELECT). A send adds none, for an apartment or a room. A room status change adds one (`member_ids`). Every
  existing count test (`test_chat.py:251,264,277`, `test_inbox.py:356`, 0005a's
  `test_ac4_list_is_two_statements`) passes **unchanged**, because they use apartment fixtures.
  `test_flatmates.py` pins the room counts. — `test_flatmates.py::test_ac12_statement_counts`
- [ ] AC13 Regression: the whole of `test_chat.py`, `test_inbox.py` and `test_chat_events.py` passes, with
  only the added response fields asserted. A one-to-one conversation reports `member_count` 2, `members`
  [owner, seeker] with `is_me` on the caller, and `sender_name` = the other's name or the caller's own. A
  non-member POSTing a message to an existing room conversation, while being a flatmate of some other room,
  gets 404 (not 409). — `test_chat.py` (amended), `test_flatmates.py::test_ac13_non_member_send_is_404`

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
- **Applicants must withdraw before joining.** The likeliest joiner is the tenant who just moved in, and while
  their application is still `shortlisted` the join gets 409 `already_applied` until they withdraw. `0008e`'s
  copy says so (`flatmates.join.applied`). This is listed for Gilad's digest.
- **Membership LEFT JOIN on every chat statement (perf):** an OR across `conversations` columns and a joined
  `listing_flatmates` row defeats Postgres's BitmapOr, so the list may seq-scan `conversations` for every
  caller. That is fine at MVP volume. Put a `shortcut:` comment on it. The fallback is one statement whose
  member-ids CTE is a UNION ALL of the owner/seeker branch and the flatmate branch (`listing_flatmates(user_id)`
  → `applications(listing_id)` → `conversations`). The perf reviewer checks the plan with a flatmate, an owner
  and a seeker caller.
- **`member_ids` before publish** is one extra SELECT after a room status change. It is cheap, and publishing
  stays best-effort (`0005c`). A send never needs it.
- If the coder run overflows, the verifier's cut line is after the migration, `services/flatmates.py`, the
  endpoints, the apply/like guards and the listings fields (AC1, AC2, AC7, AC8, AC11). The chat parts move to a
  follow-up spec.

Spec-verifier round 1 rejected with 3 majors and 6 minors. All are applied, and so are `0008e`'s findings 2
(`is_me`) and 13 (paths). The second round is waived (one verifier round, Gilad).
- **The seeker's chat changes shape mid-conversation:** when a flatmate joins, the seeker's thread gains a
  member. `0008e` shows the member list in the header, so the seeker is never unaware who reads. Messages sent
  before the join stay hidden from the flatmate (Gilad).

## Digest (filled by orchestrator after verification)
    Spec 0008d - Flatmates & group chat API   (verified, Slice 8; depends on 0008a)
    What a user can do after this: a room lister makes an invite link; whoever joins becomes a flatmate and is
             in every chat about that room from then on (sees messages from joining on, can write while the
             candidate is shortlisted); the lister lists and removes flatmates, a flatmate can leave.
    Decisions I need from you: none new. Assumptions you can overrule: at most 7 flatmates; one link per room,
             rotate to revoke, and removing a flatmate also kills the link; any role may join; someone with an
             open application to the room must withdraw before joining; a flatmate cannot apply to their own flat.
    KPIs this slice moves: share of room chats with at least one flatmate.
    Acceptance targets: chat list stays one statement for every role; existing chat/inbox statement counts
             unchanged; the token never appears in a URL or a log (POST body only, sha256 stored).
    Risks: anyone holding a forwarded link can join - mitigation: the owner sees and removes flatmates, the
             seeker sees every member, approval-per-joiner is the fallback.
    Reviewers: code, qa, security, perf   Estimated: 1 coder run (Opus/high), cut line named if it overflows
    Links: specs/0008d-flatmates-api.md - PRODUCT.md "Flatmates", "Chat" - no artboard
