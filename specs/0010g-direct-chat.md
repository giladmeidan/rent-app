---
id: 0010g
title: A conversation gets its own id, so two people can share a chat with no room and no application (the plumbing 0010h's mutual person like opens), and the chat screens show such a chat without a listing line
status: verified
depends_on: [0010d]   # migration chain only (0013 -> 0014). 0005a/0005c/0008d (done): conversations, messages, read markers, SSE, flatmate members
reviewers: [code, qa, security, perf]   # security: membership on every chat statement after the joins become outer joins (a chat must never leak or vanish); perf: the chat list's one statement and its index use; qa: existing application chats unchanged end to end
estimate: 1 coder run   # coder Opus/high (chat access control, a primary-key migration; Speed rule 6)
---

## Goal
After this ships, a conversation is its own thing rather than a property of an application. It has its own `id`
and may have **no application**: a **direct chat** between two people (PRODUCT.md "שוק השותפים": "a mutual like
between two people opens a direct chat (no room, no application)"). Either side can close it; it then stays
readable and sending closes (Q14).

Every existing chat keeps working exactly as today, with the same id, links, members, flatmates and statement
counts. The chat list and thread show a direct chat with a "match in the market" line instead of the listing.

No endpoint creates a direct chat here. `0010h` calls the two service functions `open_direct` and `close_direct`
(MARKET-PLAN.md section 7, "Direct chat"). This spec's tests create direct chats through the service. This is
Slice 10, Step 5, part one (MARKET-PLAN.md section 3, Step 5).

## Scope
**In:**
- Migration `api/alembic/versions/0014_direct_chat.py` (revision `"0014"`, down `"0013"`), see Data.
- `api/app/models/conversation.py`:
  - `Conversation.id` is the new primary key (`server_default gen_random_uuid()`).
  - `application_id` becomes `Mapped[uuid.UUID | None]`, keeps its FK (cascade) and gains
    `UniqueConstraint(name="uq_conversations_application_id")`.
  - New `closed_at: Mapped[dt.datetime | None]`.
  - `__table_args__` gains `ck_conversations_direct` and the partial unique index
    `uq_conversations_direct_pair` (Data).
  - `Message.conversation_id` points at `conversations.id`.
  - The docstring's "its primary key **is** the application's id" is rewritten: an application chat's `id`
    equals its application's id (kept for links), and a direct chat's is random.
  - `api/app/models/flatmate.py`: `ConversationRead.conversation_id` points at `conversations.id`.
- The two application-chat writers set `id` explicitly to the application's id, so **every new application
  chat keeps `id = application_id`** too, not only the migrated rows. Links built from an application id
  (`ApplicantCard.tsx`, `MyApplicationsPage.tsx`, `PeoplePage.tsx`, `MutualBanner.tsx`, `LikeOut.application_id`)
  stay correct with no change. Their conflict target stays `application_id`, which is now the unique
  constraint rather than the PK. The two writers are:
  - `services/applications.py:448` (shortlist);
  - `services/people.py:348` (room mutual like).
- `api/app/services/chat.py` (line numbers as of `498030b`, spot-checked):
  - **Ids.** Every place that uses `Conversation.application_id` as the conversation's id uses
    `Conversation.id`:
    - the list's `id` label (:299) and its tie-break order (:322);
    - the newest-message lateral (:264) and the unread count (:277), both `Message.conversation_id == ...`;
    - `_read_join` (:150);
    - `get_thread`'s WHERE (:362) and its marker UPDATE (:425);
    - `send_message`'s source SELECT (:465, :472), its fallback (:484, :487), its flatmate-read CTE (:497,
      :501) and its UPDATE (:515).

    `_indexed_member` (:186) stays on `application_id`. It matches application ids, and the unique index
    serves it. A direct chat never matches there; its two people match through `owner_id` / `seeker_id`.
  - **Outer joins.** `Application` and `Listing` become LEFT JOINs:
    - `list_statement` :313-314;
    - `get_thread` :356-357;
    - `send_message`'s source :469 and fallback :485.

    `member_ids` (:565) stays INNER: it is called with an application id only. `_flatmate_join` already
    needs `Application.listing_id` to match, so a direct chat (NULL application) never gains a flatmate.
    `_flatmate_ids` returns NULL for it.
  - **Can send.** New `_can_send() = case((Conversation.application_id.is_(None),
    Conversation.closed_at.is_(None)), else_=Application.status == "shortlisted")`. It is used by:
    - the list's `can_send` (:305);
    - `send_message`'s source filter (:474), in place of `Application.status == "shortlisted"`;
    - `get_thread`'s header, as a new `can_send` column. `routers/chat.py:107` reads `header.can_send` in
      place of `header.status == "shortlisted"`.
  - **Role.** `_my_role` (:190) gains a first branch: `Conversation.application_id IS NULL` → `'person'`. In
    a direct chat both people are `person`. `Role` gains `"person"`. `get_thread`'s members for a direct chat
    are the two people, both with role `person`, in `owner_id`, `seeker_id` order, `is_me` on the caller.
  - **Unchanged.** `_is_other`, `_is_party`, `_visible_from`, `_my_read_at` and `send_message`'s marker CASEs
    (which test ids) work unchanged for a direct chat. Its two people sit in `owner_id` / `seeker_id`, so they
    keep the owner/seeker read-marker columns, and `visible_from` is `-infinity`.
  - **`get_thread`'s marker write and members go by id, not by role** (verifier finding 1). Today they pick by
    role (:389, :404, :419-421), which would always write `seeker_read_at` for a `person`.
    - The marker: a `role == "flatmate"` caller keeps the upsert. Otherwise `column =
      Conversation.seeker_read_at if header.seeker_id == me.id else Conversation.owner_read_at`.
    - The members of a direct chat: `Member(owner_name, "person", is_me=header.seeker_id != me.id)`, then
      `Member(seeker_name, "person", is_me=header.seeker_id == me.id)`.
  - Docstrings that say "application" or "primary key" gain the direct-chat case: `ConversationNotFoundError`
    (:104), `ChatClosedError` (:109), `_indexed_member` (:167-171; the index it uses is now
    `uq_conversations_application_id`), and `routers/chat.py`'s module docstring (:1-8) and 404 description
    (:47).
  - **`open_direct(db, a, b) -> uuid.UUID`** (new). It raises `ValueError` when `a == b`. It is one statement:
    `INSERT INTO conversations (owner_id, seeker_id) VALUES (least(a, b), greatest(a, b)) ON CONFLICT
    (owner_id, seeker_id) WHERE application_id IS NULL DO UPDATE SET closed_at = NULL RETURNING id`. The
    `least` / `greatest` run in SQL, so the order is Postgres's uuid order and matches the CHECK.
    - A closed chat **reopens with its history and markers** (Q14 and section 7: "reopens a closed one").
    - It does not commit. The caller (`0010h`'s mutual like) owns the transaction.
    - Both read markers start null, so the chat is `is_new` for both until opened.
  - **`close_direct(db, a, b) -> uuid.UUID | None`** (new). It is one statement: `UPDATE conversations SET
    closed_at = coalesce(closed_at, now()) WHERE owner_id = least(a, b) AND seeker_id = greatest(a, b) AND
    application_id IS NULL RETURNING id`. It returns `None` when there is no such chat. It is idempotent (a
    second close keeps the first `closed_at`) and does not commit.
  - Module docstring: rule 1 ("its id is the application's id") and rule 4 ("Sending is open … while the
    application is `shortlisted`") gain the direct-chat case.
- `api/app/services/flatmates.py::_delete_reads` (:215-227): the query stays as it is, since
  `ck_conversations_application_id` guarantees the ids are equal. Its docstring says so ("an application
  chat's id is its application's, by CHECK").
- `api/app/schemas/chat.py`:
  - `MemberRole` gains `"person"`.
  - `ConversationOut.listing` and `ThreadOut.listing` become `ApplicationListingOut | None` (null exactly for a
    direct chat).
  - `ConversationOut.id`'s comment: "the application's id for an application chat".
  - The `can_send` comment: "an application chat: the application is `shortlisted`; a direct chat: not
    closed".
  - The module docstring's id sentence is rewritten to match.
- `api/app/routers/chat.py`:
  - `_listing(row)` returns `None` when `row.listing_id is None`.
  - `get_thread` uses `header.can_send`.
  - The 404 and 409 descriptions also name a direct chat ("closed: the match was removed").
- Tests: `api/tests/test_direct_chat.py` (new), plus these amendments:
  - `test_migrations.py` (AC9);
  - `test_chat.py`: its helper at :148 inserts `id` = the application id as well;
  - `test_inbox.py:373`, `:817` and `test_chat.py:267`: these statement-text asserts stay as they are, since
    the statement is still an `INSERT INTO conversations`.

  `conftest.py` gains `make_direct_chat(engine, a, b, *, closed=False) -> uuid.UUID`, a direct SQL insert with
  `least`/`greatest`.
- **Web** (`web/src/features/chat/`), because the regenerated types make `listing` nullable and tsc would fail:
  - `ConversationsPane.tsx:98`: the caption under the name is `cardTitle(t, listing)` when `listing` is set,
    else `t('chat.list.direct')`.
  - `ChatThreadPage.tsx:192-203`: the listing line (title, price, and the "to the listing" / "to applicants"
    button) renders only when `thread.listing` is set. A direct chat shows one caption line
    `t('chat.thread.direct')` in the same `text-caption text-ink-muted` paragraph, with no button.
    `ChatThreadPage.tsx:123` destructures `messages` only; `listing` is read where it is used.
  - The closed note (`chat.thread.closed`) reads `t('chat.thread.closedDirect')` when `thread.listing` is null.
  - `ChatThreadPage.tsx:178`'s `owner` check is unchanged (a `person` is not an owner).
  - `MemberLine` renders only for more than two members, so `chat.roles.person` is never needed and not added.
  - `api.ts:5` comment: "its `id` is the application's id for an application chat, its own for a direct chat".
  - `__tests__/fixtures.ts` (verifier finding 2). These existing tests dereference `listing` and would stop
    compiling once it is nullable: `ChatThreadPage.test.tsx:97,125,616,646,667` and
    `ChatListPage.test.tsx:46-49,227`. The fixtures keep them compiling unchanged:
    - `type ListingSummary = NonNullable<ConversationOut['listing']>`;
    - `listingSummary(): ListingSummary`;
    - `conversation(overrides: Partial<ConversationOut & { listing: ListingSummary }>): ConversationOut &
      { listing: ListingSummary }`, and the same for `thread()`.

    New `directConversation()` / `directThread()` builders return plain `ConversationOut` / `ThreadOut`
    (`listing: null`, `my_role: 'person'`, two `person` members). `e2e/screens/fixtures-chat.ts` only assigns
    `listing`, so it needs no change.
  - New i18n keys in `web/src/locales/he.json`, brand voice (no slash forms, never one gender):
    - `chat.list.direct`: "התאמה בשוק השותפים"
    - `chat.thread.direct`: "התאמה הדדית בשוק השותפים"
    - `chat.thread.closedDirect`: "ההתאמה הוסרה. השיחה נשארת לקריאה, ואי אפשר לשלוח בה הודעות חדשות."

**Out:**
- Any endpoint that opens or closes a direct chat, the "remove match" button and its confirm, and the person
  likes (`0010h`).
- The person photo in the chat list and thread (`0010e`'s `Avatar`; `0010d` puts `photo_url` on chat members).
  The initial-letter circle stays.
- Group direct chats (more than two people) and team-up groups (later, MARKET-PLAN.md decision 11).
- Paging `/me/conversations` (FOLLOWUPS:93, unchanged).
- Notifications (as every slice so far).

**New dependencies:** none.

## Data
Migration `0014_direct_chat` (down `0013`), in this order:
1. `ALTER TABLE conversations ADD COLUMN id uuid`, then `UPDATE conversations SET id = application_id`, then
   `SET NOT NULL` and `SET DEFAULT gen_random_uuid()`. **Every existing row keeps id = application id.**
2. Drop the two FKs that point at `conversations(application_id)`, by their Postgres default names, with
   `op.drop_constraint`: `messages_conversation_id_fkey` and `conversation_reads_conversation_id_fkey`. 0006
   and 0012 left them unnamed, and `Base` has no `naming_convention`. `test_migrations.py:1550` already
   asserts the second name.
3. Drop `conversations_pkey` and recreate it as `PRIMARY KEY (id)` with the same name.
4. `application_id`:
   - `DROP NOT NULL`;
   - add `uq_conversations_application_id UNIQUE (application_id)`.

   The FK to `applications(id) ON DELETE CASCADE` stays. NULLs never collide in a unique constraint.
5. Recreate both FKs onto `conversations(id) ON DELETE CASCADE`, named `fk_messages_conversation_id` and
   `fk_conversation_reads_conversation_id`. The models name them the same way, so autogenerate sees no diff.
6. `closed_at timestamptz NULL`.
7. `ck_conversations_direct CHECK (application_id IS NOT NULL OR owner_id < seeker_id)` and
   `ck_conversations_closed_direct CHECK (closed_at IS NULL OR application_id IS NULL)`:
   - a direct chat stores its pair ordered;
   - only a direct chat closes (an application chat closes through its status).

   Also `ck_conversations_application_id CHECK (application_id IS NULL OR id = application_id)` (verifier
   finding 3). It enforces the compatibility rule below, so a writer or test helper that forgets `id` fails
   loudly instead of silently breaking links. The model's `__table_args__` carries all three CHECKs.
   `ck_conversations_two_people` stays.
8. `CREATE UNIQUE INDEX uq_conversations_direct_pair ON conversations (owner_id, seeker_id) WHERE
   application_id IS NULL`: one direct chat per pair, ever. It is `open_direct`'s conflict target and serves
   `close_direct`.

Backwards compatibility: no application chat changes id, and `ck_conversations_application_id` keeps it that
way for new ones. These keep working:
- every stored link;
- the e2e assertions (`inbox.spec.ts:84/106`, `flatmates.spec.ts:220/268/278`);
- `LikeOut.application_id`;
- the status events that publish `application.id` as the conversation id (`routers/applications.py:162,260`,
  `routers/people.py:161,223`).

Downgrade, in reverse:
- `DELETE FROM conversations WHERE application_id IS NULL`. **Direct chats and their messages and read markers
  are lost** (cascade).
- Drop the index, the CHECKs and `closed_at`.
- Drop the two FKs.
- Drop the PK, set `application_id NOT NULL`, drop the unique constraint, and recreate the PK on
  `application_id`.
- Recreate the two FKs onto `conversations(application_id)` with the default names.
- Drop `id`.

## API
No new endpoint. Changed shapes only:

| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| GET | `/me/conversations` (changed) | `current_user`, any member | — | `ConversationOut.listing` nullable; `my_role` may be `"person"`; a direct chat has `member_count` 2 and `can_send` = not closed | 401 |
| GET | `/conversations/{conversation_id}` (changed) | `current_user`, a member (one of the two people for a direct chat) | — | `ThreadOut.listing` nullable; `members` = the two people with role `"person"` | 401; 404 `not_found` (unknown, or not a member) |
| POST | `/conversations/{conversation_id}/messages` (changed) | `current_user`, a member | `MessageIn` | 201 `MessageOut`; the event goes to both people | 401; 404; 409 `chat_closed` (a closed direct chat, or an application not shortlisted); 422; 429 |

Service functions for `0010h` (binding names, MARKET-PLAN.md section 7):
- `chat.open_direct(db: Session, a: uuid.UUID, b: uuid.UUID) -> uuid.UUID`
- `chat.close_direct(db: Session, a: uuid.UUID, b: uuid.UUID) -> uuid.UUID | None`

Neither commits. `0010h` publishes the `status` chat event (`chat_events.publish(r, [a, b], id, "status")`)
after its own commit. A direct chat's members are always the pair, so it needs no `member_ids` call.

## UI
Screens touched: the chat list (`ConversationsPane`) and the thread (`ChatThreadPage`); no new screen, no
artboard (PRODUCT.md "Brand": no new artboards; `design/screens-v1/Chat.dc.html` keeps its anatomy).
- **List row, direct chat:** name, unread/new badge and closed tag as today. The caption line under the name
  reads "התאמה בשוק השותפים" in place of the listing title.
- **Thread header, direct chat:** the other person's name as the title. The caption paragraph reads "התאמה
  הדדית בשוק השותפים", with no listing button. The deposit warning stays: it is about money before meeting, and
  it applies to people too.
- **Closed direct chat:** the composer is replaced by the closed note "ההתאמה הוסרה. השיחה נשארת לקריאה, ואי
  אפשר לשלוח בה הודעות חדשות.", with the same focus behaviour as today's closed note (0009t).
- Loading, empty and error states are unchanged. RTL: no new layout, only text in existing slots.

## Acceptance criteria
- [ ] AC1 Given users `A` and `B`, When `open_direct(db, A, B)` runs and commits, Then:
  - one `conversations` row exists with `application_id` NULL, `owner_id` = the smaller id and `seeker_id` =
    the larger, and `closed_at` NULL;
  - `open_direct(db, B, A)` returns the **same** id;
  - `open_direct(db, A, A)` raises `ValueError`.

  — `api/tests/test_direct_chat.py::test_ac1_open_direct_is_one_per_pair`
- [ ] AC2 Given that chat, When `A` GETs `/me/conversations`, Then the row has:
  - `listing: null`, `my_role: "person"`, `other_name` = `B`'s name;
  - `member_count` 2, `can_send` true, `is_new` true.

  When `A` GETs the thread, Then `members` is the two people (role `person`, `is_me` on `A`), `visible_from`
  is null and `listing` is null. — `test_direct_chat.py::test_ac2_direct_chat_in_list_and_thread`
- [ ] AC3 When `A` POSTs a message, Then it is 201, `chat_events.publish` (monkeypatched) gets `{A, B}`, and
  `B`'s list shows `unread_count` 1. The test runs once with `A` < `B` and once with `A` > `B`: after `B`'s
  thread GET, `B`'s own marker column is set and `A`'s is unchanged, so `B`'s `unread_count` is 0 and `is_new`
  is false. The thread's members carry `is_me` on `B` only. — `test_direct_chat.py::test_ac3_send_and_read`
- [ ] AC4 (security: membership) A third user `C` (an owner, a seeker and a flatmate of some room, in turn):
  - gets 404 on the direct chat's thread and on a send, never 409;
  - never sees it in their list.

  — `test_direct_chat.py::test_ac4_outsider_gets_404`
- [ ] AC5 (Q14) When `close_direct(db, A, B)` runs and commits, Then:
  - it returns the chat's id;
  - both people still read the thread with every message, and see `can_send` false;
  - a send gets 409 `chat_closed`;
  - a second `close_direct` keeps the first `closed_at`;
  - `close_direct` on a pair with no chat returns `None`.

  When `open_direct(db, B, A)` then runs, Then the same id comes back with `closed_at` NULL, the old messages
  and markers are kept, and sending works. — `test_direct_chat.py::test_ac5_close_and_reopen`
- [ ] AC6 (no regression) Given an application chat created by a shortlist and one created by a room mutual
  like, Then each conversation's `id` equals its application id. The whole of `test_chat.py`,
  `test_chat_events.py`, `test_inbox.py`, `test_people.py` and `test_flatmates.py` passes, with only the
  `test_chat.py:148` helper amended. Every statement-count test passes **unchanged**:
  - 0005a's `test_ac4_list_is_two_statements`;
  - `test_chat.py:251,264,277`;
  - `test_inbox.py:356`;
  - `test_flatmates.py::test_ac12_statement_counts`.

  — existing files, plus `test_direct_chat.py::test_ac6_application_chat_ids_unchanged`
- [ ] AC7 (perf) The direct chat's list is one statement, its thread two (no members SELECT), and its send two,
  as for an apartment chat. `EXPLAIN (FORMAT JSON)` of `list_statement` for `A` is run under `SET LOCAL
  enable_seqscan = off` and checked as `test_flatmates.py::test_ac12_list_uses_indexes_for_every_role` does
  (reuse its `_scans_of`): every read of `conversations` is a Bitmap Heap Scan or an index scan with an
  `Index Cond`. — `test_direct_chat.py::test_ac7_statement_counts_and_plan`
- [ ] AC8 (constraints) An insert that breaks a rule is refused:
  - a direct row with `owner_id > seeker_id` fails `ck_conversations_direct`;
  - `closed_at` set on an application chat fails `ck_conversations_closed_direct`;
  - a second direct row for the same pair fails `uq_conversations_direct_pair`;
  - a second chat for one application fails `uq_conversations_application_id`;
  - an application chat inserted without `id` (a random id) fails `ck_conversations_application_id`.

  Deleting a user cascades their direct chats and messages. — `test_direct_chat.py::test_ac8_constraints`
- [ ] AC9 Migration: upgrade `"0013"` → `"0014"` on a database with a shortlisted application chat holding a
  message and a flatmate read marker. Then:
  - `id = application_id` on the row, and the message and marker still join;
  - the PK is on `id`;
  - both FKs reference `conversations(id)` with their new names;
  - the CHECKs and the partial index exist.

  Then a direct chat is added, and downgrade → `"0013"` deletes it while the application chat, its message
  and its marker survive with the old PK and FKs. Upgrade again works. — `api/tests/test_migrations.py::test_ac9_direct_chat_upgrade_downgrade`
- [ ] AC10 (web) The chat list renders a direct conversation with "התאמה בשוק השותפים" and no listing title,
  and an application conversation as today. — `web/src/features/chat/__tests__/ChatListPage.test.tsx::ac10_direct_chat_row`
- [ ] AC11 (web) The thread renders a direct chat:
  - the caption "התאמה הדדית בשוק השותפים", no listing link, and the deposit warning;
  - closed, the note "ההתאמה הוסרה…" in place of the composer.

  An application thread still shows its listing line and button. — `web/src/features/chat/__tests__/ChatThreadPage.test.tsx::ac11_direct_chat_header_and_closed_note`

## Tests to write
Integration:
- `test_direct_chat.py`: AC1–AC8.
- `test_migrations.py`: AC9.
- `test_chat.py`: the helper amendment.

Unit (web): AC10 and AC11 in the two existing chat test files, using the new fixtures. E2E: none new, since no UI
can create a direct chat until `0010h`, whose e2e covers it. No existing e2e breaks: ids are unchanged, and
`inbox.spec.ts` and `flatmates.spec.ts` keep their `/chat/${applicationId}` assertions. e2e runs in CI only.

## Risks / open questions
- **Primary-key swap on a live table.** Steps 1–5 rewrite `conversations` and re-validate two FKs. That is
  fine at MVP volume (thousands of rows, in one transaction). Postgres DDL is transactional, so a failure rolls
  everything back. AC9 pins it.
- **Outer joins and membership (security).** With `Application` and `Listing` outer-joined, an application
  chat whose application row vanished would now show with `listing: null` instead of disappearing. That cannot
  happen, since `application_id` cascades on delete. Membership is still `_is_member` on every statement, and
  AC4 proves an outsider gets 404.
- **`'person'` role.** This is a fourth `MemberRole`. Web code that switches on the role is
  `ChatThreadPage.tsx:91-92`, and it only runs for more than two members, so it never sees `person`. The
  coder greps `my_role` / `.role` in `web/src` once more.
- **Pair order in SQL.** `least` / `greatest` / `<` on `uuid` compare bytes. The service never orders the pair
  in Python, so the CHECK and the conflict target always agree.
- Section 7 is followed as written. Two details are added: the two recreated FKs get explicit names, and
  `ck_conversations_application_id` pins `id = application_id` on application chats.
- Spec-verifier round 1 (Opus, high): 8 findings (1 blocker, 3 majors, 2 minors, 2 nits), all applied.
  - The blocker: `get_thread` picked the read-marker column by role, so in a direct chat one person's read would
    have marked the other's.
  - The majors: the web test fixtures, the CHECK on `id`, and AC7's plan test.

  The second round is waived (one verifier round, Gilad). round 1: 8 findings applied.
- If the coder run overflows, the cut line is after the migration, the model and the service (AC1–AC9), and
  the web half (AC10–AC11) moves into `0010h`.

## Digest (filled by orchestrator after verification)
See `/digest`.
