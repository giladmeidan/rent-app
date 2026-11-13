"""Direct chat (spec 0010g): a conversation with its own id and no application, between two people,
opened and closed through `chat.open_direct` / `chat.close_direct`. AC1-AC8 (AC9 is in
`test_migrations.py`).

`A` ("Avi") and `B` ("Bat") are two signed-up people. No endpoint opens a direct chat yet (0010h),
so the tests open and close it through the service and commit, as 0010h's caller will."""

import uuid
from collections.abc import Callable, Iterator
from functools import partial
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, event, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import User
from app.services import chat as chat_service
from app.services import chat_events
from tests.conftest import (
    Outbox,
    make_application,
    make_direct_chat,
    make_flatmate,
    make_listing,
    make_profile,
    make_seeker,
    signup,
)
from tests.test_flatmates import Published, _scans_of
from tests.test_matching import _user_id
from tests.test_people import _like_person, _like_room, _page, _room, _seeker

pytestmark = pytest.mark.usefixtures("redis_clean")

NOT_FOUND = {"detail": "not_found"}
CHAT_CLOSED = {"detail": "chat_closed"}


def _scalar(engine: Engine, sql: str, **params: Any) -> Any:
    with engine.connect() as conn:
        return conn.execute(text(sql), params).scalar()


def _execute(engine: Engine, sql: str, **params: Any) -> None:
    with engine.begin() as conn:
        conn.execute(text(sql), params)


def _ok(response: httpx.Response, code: int = 200) -> Any:
    assert response.status_code == code, response.text
    return response.json()


def _list(caller: TestClient) -> list[dict[str, Any]]:
    body: list[dict[str, Any]] = _ok(caller.get("/me/conversations"))
    return body


def _item(caller: TestClient, conversation_id: Any) -> dict[str, Any]:
    (item,) = (c for c in _list(caller) if c["id"] == str(conversation_id))
    return item


def _thread(caller: TestClient, conversation_id: Any) -> httpx.Response:
    response: httpx.Response = caller.get(f"/conversations/{conversation_id}")
    return response


def _send(caller: TestClient, conversation_id: Any, body: str = "Hello") -> httpx.Response:
    response: httpx.Response = caller.post(
        f"/conversations/{conversation_id}/messages", json={"body": body}
    )
    return response


def _open(engine: Engine, a: uuid.UUID, b: uuid.UUID) -> uuid.UUID:
    """`chat.open_direct`, committed by the caller (as 0010h will)."""
    with Session(engine) as db:
        conversation_id = chat_service.open_direct(db, a, b)
        db.commit()
    return conversation_id


def _close(engine: Engine, a: uuid.UUID, b: uuid.UUID) -> uuid.UUID | None:
    """`chat.close_direct`, committed by the caller."""
    with Session(engine) as db:
        conversation_id = chat_service.close_direct(db, a, b)
        db.commit()
    return conversation_id


def _row(engine: Engine, conversation_id: uuid.UUID) -> dict[str, Any]:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT application_id, owner_id, seeker_id, owner_read_at, seeker_read_at,"
                " last_message_at, closed_at FROM conversations WHERE id = :id"
            ),
            {"id": conversation_id},
        ).one()
    return dict(row._mapping)


def _app_chat(
    engine: Engine, listing_id: uuid.UUID, owner_id: uuid.UUID, seeker_id: uuid.UUID
) -> uuid.UUID:
    """A shortlisted application of `seeker_id` to `listing_id` with its chat (id = the
    application's), by SQL."""
    application_id = make_application(engine, listing_id, seeker_id, status="shortlisted")
    _execute(
        engine,
        "INSERT INTO conversations (id, application_id, owner_id, seeker_id, owner_read_at)"
        " VALUES (:a, :a, :o, :s, now())",
        a=application_id,
        o=owner_id,
        s=seeker_id,
    )
    return application_id


@pytest.fixture
def person_a(client: TestClient, outbox: Outbox) -> TestClient:
    return signup(client, outbox, "a@example.com", "seeker", display_name="Avi")


@pytest.fixture
def person_b(client: TestClient, outbox: Outbox) -> TestClient:
    return signup(client, outbox, "b@example.com", "seeker", display_name="Bat")


@pytest.fixture
def a_id(person_a: TestClient) -> uuid.UUID:
    return _user_id(person_a)


@pytest.fixture
def b_id(person_b: TestClient) -> uuid.UUID:
    return _user_id(person_b)


@pytest.fixture
def published(monkeypatch: pytest.MonkeyPatch) -> Published:
    recorder = Published()
    monkeypatch.setattr(chat_events, "publish", recorder)
    return recorder


@pytest.fixture
def statements(db_engine: Engine) -> Iterator[list[str]]:
    """Every SQL statement the app engine sends while the test records (`.clear()` to start)."""
    seen: list[str] = []

    def record(_conn: Any, _cursor: Any, statement: str, *_: Any) -> None:
        seen.append(statement)

    event.listen(db_engine, "before_cursor_execute", record)
    yield seen
    event.remove(db_engine, "before_cursor_execute", record)


def test_ac1_open_direct_is_one_per_pair(
    a_id: uuid.UUID, b_id: uuid.UUID, db_engine: Engine
) -> None:
    conversation_id = _open(db_engine, a_id, b_id)
    assert _scalar(db_engine, "SELECT count(*) FROM conversations") == 1
    assert _row(db_engine, conversation_id) == {
        "application_id": None,
        "owner_id": min(a_id, b_id),  # Python's uuid order is Postgres's (big-endian bytes)
        "seeker_id": max(a_id, b_id),
        "owner_read_at": None,
        "seeker_read_at": None,
        "last_message_at": None,
        "closed_at": None,
    }
    assert conversation_id != a_id and conversation_id != b_id

    assert _open(db_engine, b_id, a_id) == conversation_id
    assert _open(db_engine, a_id, b_id) == conversation_id
    assert _scalar(db_engine, "SELECT count(*) FROM conversations") == 1

    with Session(db_engine) as db, pytest.raises(ValueError):
        chat_service.open_direct(db, a_id, a_id)

    # It does not commit: the caller owns the transaction.
    other = make_seeker(db_engine, "c@example.com", "Cai")
    with Session(db_engine) as db:
        chat_service.open_direct(db, a_id, other)
        db.rollback()
    assert _scalar(db_engine, "SELECT count(*) FROM conversations") == 1


def test_ac2_direct_chat_in_list_and_thread(
    person_a: TestClient,
    person_b: TestClient,
    a_id: uuid.UUID,
    b_id: uuid.UUID,
    db_engine: Engine,
) -> None:
    conversation_id = _open(db_engine, a_id, b_id)

    item = _item(person_a, conversation_id)
    assert item["listing"] is None
    assert item["my_role"] == "person"
    assert item["other_name"] == "Bat"
    assert item["member_count"] == 2
    assert item["can_send"] is True
    assert item["is_new"] is True
    assert item["unread_count"] == 0
    assert item["last_message"] is None
    assert _item(person_b, conversation_id)["other_name"] == "Avi"

    thread = _ok(_thread(person_a, conversation_id))
    assert thread["id"] == str(conversation_id)
    assert thread["listing"] is None
    assert thread["visible_from"] is None
    assert thread["my_role"] == "person"
    assert thread["other_name"] == "Bat"
    assert thread["can_send"] is True
    assert thread["messages"] == []
    # The owner_id slot (the lower id) first, then the seeker_id slot.
    names = {a_id: "Avi", b_id: "Bat"}
    low, high = min(a_id, b_id), max(a_id, b_id)
    assert thread["members"] == [
        {"name": names[low], "role": "person", "is_me": low == a_id},
        {"name": names[high], "role": "person", "is_me": high == a_id},
    ]
    assert _item(person_a, conversation_id)["is_new"] is False
    assert _item(person_b, conversation_id)["is_new"] is True


@pytest.mark.parametrize("a_is_lower", [True, False], ids=["a_lower", "a_higher"])
def test_ac3_send_and_read(
    a_is_lower: bool,
    person_a: TestClient,
    person_b: TestClient,
    a_id: uuid.UUID,
    b_id: uuid.UUID,
    db_engine: Engine,
    published: Published,
) -> None:
    # Name the two callers so that `A` is the lower (or the higher) id of the pair.
    if (a_id < b_id) != a_is_lower:
        person_a, person_b = person_b, person_a
        a_id, b_id = b_id, a_id
    a_column, b_column = (
        ("owner_read_at", "seeker_read_at") if a_is_lower else ("seeker_read_at", "owner_read_at")
    )
    conversation_id = _open(db_engine, a_id, b_id)

    sent = _ok(_send(person_a, conversation_id, "hi"), 201)
    assert sent["mine"] is True
    assert published.calls == [({a_id, b_id}, conversation_id, "message")]
    item = _item(person_b, conversation_id)
    assert (item["unread_count"], item["is_new"]) == (1, True)
    assert item["last_message"]["body"] == "hi"
    before = _row(db_engine, conversation_id)
    assert before[a_column] is not None  # the send moved the sender's own marker
    assert before[b_column] is None

    thread = _ok(_thread(person_b, conversation_id))
    assert [m["body"] for m in thread["messages"]] == ["hi"]
    # B's slot is the other one: `is_me` on B only.
    assert [m["is_me"] for m in thread["members"]] == [not a_is_lower, a_is_lower]
    assert {m["role"] for m in thread["members"]} == {"person"}
    after = _row(db_engine, conversation_id)
    assert after[b_column] is not None  # B's own marker
    assert after[a_column] == before[a_column]  # A's unchanged
    item = _item(person_b, conversation_id)
    assert (item["unread_count"], item["is_new"]) == (0, False)
    item = _item(person_a, conversation_id)
    assert (item["unread_count"], item["is_new"]) == (0, False)

    # B answers: A has one unread, A's read moves A's column only.
    _ok(_send(person_b, conversation_id, "hello back"), 201)
    assert _item(person_a, conversation_id)["unread_count"] == 1
    before = _row(db_engine, conversation_id)
    thread = _ok(_thread(person_a, conversation_id))
    assert [m["is_me"] for m in thread["members"]] == [a_is_lower, not a_is_lower]
    after = _row(db_engine, conversation_id)
    assert after[a_column] > before[a_column]
    assert after[b_column] == before[b_column]
    assert _item(person_a, conversation_id)["unread_count"] == 0


@pytest.mark.parametrize("role", ["owner", "seeker", "flatmate"])
def test_ac4_outsider_gets_404(
    role: str,
    client: TestClient,
    outbox: Outbox,
    person_a: TestClient,
    a_id: uuid.UUID,
    b_id: uuid.UUID,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    # `A` owns room R, where `B`'s application is shortlisted: the two also share an application
    # chat, so the outsider's joins and indexes see rows touching both.
    room = uuid.UUID(_room(db_engine, a_id, gush_dan))
    shared = _app_chat(db_engine, room, a_id, b_id)
    outsider = signup(
        client, outbox, "c@example.com", "owner" if role == "owner" else "seeker", "Cai"
    )
    c_id = _user_id(outsider)
    if role == "owner":  # C owns another room, where B's application is shortlisted
        other_room = uuid.UUID(_room(db_engine, c_id, gush_dan))
        own = _app_chat(db_engine, other_room, c_id, b_id)
    elif role == "seeker":  # C's own shortlisted application to A's room
        make_profile(db_engine, c_id, gush_dan)
        own = _app_chat(db_engine, room, a_id, c_id)
    else:  # C is a flatmate of A's room: a member of the A-B application chat
        make_flatmate(db_engine, room, c_id)
        own = shared
    conversation_id = _open(db_engine, a_id, b_id)
    _ok(_send(person_a, conversation_id, "private"), 201)

    ids = [item["id"] for item in _list(outsider)]
    assert str(own) in ids
    assert str(conversation_id) not in ids
    assert _thread(outsider, conversation_id).json() == NOT_FOUND
    assert _thread(outsider, conversation_id).status_code == 404
    response = _send(outsider, conversation_id, "intrude")
    assert (response.status_code, response.json()) == (404, NOT_FOUND)

    # Closed, it is still a 404 for C, never a 409.
    assert _close(db_engine, a_id, b_id) == conversation_id
    response = _send(outsider, conversation_id, "intrude")
    assert (response.status_code, response.json()) == (404, NOT_FOUND)
    assert _thread(outsider, conversation_id).status_code == 404
    assert str(conversation_id) not in [item["id"] for item in _list(outsider)]
    assert _scalar(db_engine, "SELECT count(*) FROM messages WHERE body = 'intrude'") == 0
    assert (
        _scalar(
            db_engine,
            "SELECT count(*) FROM conversation_reads WHERE conversation_id = :c",
            c=conversation_id,
        )
        == 0
    )


def test_ac5_close_and_reopen(
    person_a: TestClient,
    person_b: TestClient,
    a_id: uuid.UUID,
    b_id: uuid.UUID,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    conversation_id = _open(db_engine, a_id, b_id)
    _ok(_send(person_a, conversation_id, "one"), 201)
    _ok(_thread(person_b, conversation_id))

    assert _close(db_engine, a_id, b_id) == conversation_id
    closed_at = _row(db_engine, conversation_id)["closed_at"]
    assert closed_at is not None
    for caller in (person_a, person_b):
        thread = _ok(_thread(caller, conversation_id))
        assert [m["body"] for m in thread["messages"]] == ["one"]
        assert thread["can_send"] is False
        assert _item(caller, conversation_id)["can_send"] is False
        response = _send(caller, conversation_id, "two")
        assert (response.status_code, response.json()) == (409, CHAT_CLOSED)

    # Idempotent: a second close (either order) keeps the first `closed_at`.
    assert _close(db_engine, b_id, a_id) == conversation_id
    assert _row(db_engine, conversation_id)["closed_at"] == closed_at
    # No such chat: a pair with none, and a pair that shares only an application chat.
    stranger = make_seeker(db_engine, "c@example.com", "Cai")
    assert _close(db_engine, a_id, stranger) is None
    application_chat = _app_chat(
        db_engine, make_listing(db_engine, stranger, gush_dan), stranger, a_id
    )
    assert _close(db_engine, stranger, a_id) is None
    assert _close(db_engine, a_id, stranger) is None
    assert _row(db_engine, application_chat)["closed_at"] is None

    # Does not commit.
    with Session(db_engine) as db:
        assert chat_service.close_direct(db, a_id, b_id) == conversation_id
        db.rollback()
    assert _row(db_engine, conversation_id)["closed_at"] == closed_at

    markers = _row(db_engine, conversation_id)
    assert _open(db_engine, b_id, a_id) == conversation_id
    reopened = _row(db_engine, conversation_id)
    assert reopened["closed_at"] is None
    assert {k: v for k, v in reopened.items() if k != "closed_at"} == {
        k: v for k, v in markers.items() if k != "closed_at"
    }
    assert _scalar(db_engine, "SELECT count(*) FROM conversations") == 2
    thread = _ok(_thread(person_b, conversation_id))
    assert [m["body"] for m in thread["messages"]] == ["one"]
    assert thread["can_send"] is True
    _ok(_send(person_b, conversation_id, "two"), 201)
    assert [m["body"] for m in _ok(_thread(person_a, conversation_id))["messages"]] == [
        "one",
        "two",
    ]


def test_ac6_application_chat_ids_unchanged(
    client: TestClient, outbox: Outbox, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    owner = signup(client, outbox, "o@example.com", "owner", display_name="Noa")
    owner_id = _user_id(owner)

    # A shortlist (services/applications.py).
    seeker = signup(client, outbox, "s@example.com", "seeker", display_name="Dana")
    make_profile(db_engine, _user_id(seeker), gush_dan)
    apartment = make_listing(db_engine, owner_id, gush_dan)
    applied = _ok(
        seeker.post(f"/listings/{apartment}/applications", json={"message": "Hello there"}), 201
    )["id"]
    _ok(
        owner.patch(f"/listings/{apartment}/applications/{applied}", json={"status": "shortlisted"})
    )

    # A room mutual like (services/people.py).
    room = _room(db_engine, owner_id, gush_dan)
    liker = _seeker(client, outbox, db_engine, gush_dan, "l@example.com", "Lia")
    assert _ok(_like_room(liker, room)) == {"liked": True, "application_id": None}
    (card,) = _page(owner, room)["items"]
    liked = _ok(_like_person(owner, room, card["id"]))["application_id"]
    assert liked is not None

    with db_engine.connect() as conn:
        rows = conn.execute(text("SELECT id, application_id FROM conversations")).tuples().all()
    assert sorted(rows) == sorted(
        [(uuid.UUID(applied), uuid.UUID(applied)), (uuid.UUID(liked), uuid.UUID(liked))]
    )
    assert {item["id"] for item in _list(owner)} == {applied, liked}
    for caller, application_id in ((seeker, applied), (liker, liked)):
        assert [item["id"] for item in _list(caller)] == [application_id]
        thread = _ok(_thread(caller, application_id))
        assert thread["listing"] is not None
        assert thread["my_role"] == "seeker"
        assert [m["role"] for m in thread["members"]] == ["owner", "seeker"]
        _ok(_send(caller, application_id), 201)


def test_ac7_statement_counts_and_plan(
    person_a: TestClient,
    person_b: TestClient,
    a_id: uuid.UUID,
    b_id: uuid.UUID,
    gush_dan: uuid.UUID,
    db_engine: Engine,
    statements: list[str],
) -> None:
    conversation_id = _open(db_engine, a_id, b_id)
    # An application chat of A's too, so the list has more than the direct chat.
    room = uuid.UUID(_room(db_engine, a_id, gush_dan))
    _app_chat(db_engine, room, a_id, make_seeker(db_engine, "c@example.com", "Cai"))

    def measure(call: Callable[[], httpx.Response], code: int = 200) -> list[str]:
        statements.clear()
        response = call()
        sent = list(statements)
        assert response.status_code == code, response.text
        return sent

    person_a.get("/me")  # warm-up: a first connect sends its own setup statements
    person_b.get("/me")
    sent = measure(partial(person_a.get, "/me/conversations"))
    assert len(sent) == 2, sent  # the session lookup, then the list
    assert "FROM conversations" in sent[1]

    # The thread: session, header, messages (no members SELECT), the marker when new.
    _ok(_send(person_b, conversation_id, "new"), 201)
    first = measure(partial(_thread, person_a, conversation_id))
    assert len(first) == 4, first
    assert first[3].lstrip().startswith("UPDATE conversations")
    again = measure(partial(_thread, person_a, conversation_id))
    assert len(again) == 3, again

    # A send: session, the INSERT, the UPDATE.
    sent = measure(partial(_send, person_a, conversation_id), 201)
    assert len(sent) == 3, sent
    assert sent[1].lstrip().startswith("INSERT INTO messages")
    assert "UPDATE conversations" in sent[2]

    with Session(db_engine) as db:
        user = db.get(User, a_id)
        assert user is not None
        compiled = chat_service.list_statement(user).compile(dialect=db_engine.dialect)
    with db_engine.connect() as conn:
        conn.exec_driver_sql("SET LOCAL enable_seqscan = off")
        (plan,) = conn.exec_driver_sql(
            "EXPLAIN (FORMAT JSON) " + str(compiled), compiled.params
        ).scalar_one()
        conn.rollback()
    # With `enable_seqscan = off` this proves an index path exists for every read of
    # `conversations`, not which plan the planner would choose with real statistics.
    scans = list(_scans_of(plan["Plan"], "conversations"))
    assert scans, plan
    for scan in scans:
        assert scan["Node Type"] != "Seq Scan", scan
        if scan["Node Type"] in ("Index Scan", "Index Only Scan"):
            assert "Index Cond" in scan, scan
        else:
            assert scan["Node Type"] == "Bitmap Heap Scan", scan


def test_ac8_constraints(
    a_id: uuid.UUID, b_id: uuid.UUID, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    def refused(constraint: str, sql: str, **params: Any) -> None:
        with pytest.raises(IntegrityError, match=constraint), db_engine.begin() as conn:
            conn.execute(text(sql), params)

    pair = {"a": a_id, "b": b_id}
    refused(
        "ck_conversations_direct",
        "INSERT INTO conversations (owner_id, seeker_id)"
        " VALUES (greatest(CAST(:a AS uuid), CAST(:b AS uuid)),"
        " least(CAST(:a AS uuid), CAST(:b AS uuid)))",
        **pair,
    )
    direct = make_direct_chat(db_engine, b_id, a_id)
    assert _row(db_engine, direct)["owner_id"] == min(a_id, b_id)
    refused(
        "uq_conversations_direct_pair",
        "INSERT INTO conversations (owner_id, seeker_id)"
        " VALUES (least(CAST(:a AS uuid), CAST(:b AS uuid)),"
        " greatest(CAST(:a AS uuid), CAST(:b AS uuid)))",
        **pair,
    )
    # A direct chat closes; an application chat does not.
    _execute(db_engine, "UPDATE conversations SET closed_at = now() WHERE id = :id", id=direct)

    listing = make_listing(db_engine, a_id, gush_dan)
    application_chat = _app_chat(db_engine, listing, a_id, b_id)
    refused(
        "ck_conversations_closed_direct",
        "UPDATE conversations SET closed_at = now() WHERE id = :id",
        id=application_chat,
    )
    second = {"app": application_chat, "o": a_id, "s": b_id}
    # Without `id` (a random one): the compatibility CHECK.
    refused(
        "ck_conversations_application_id",
        "INSERT INTO conversations (application_id, owner_id, seeker_id) VALUES (:app, :o, :s)",
        **second,
    )
    # With `id` = the application's, the primary key refuses it first.
    refused(
        "conversations_pkey",
        "INSERT INTO conversations (id, application_id, owner_id, seeker_id)"
        " VALUES (:app, :app, :o, :s)",
        **second,
    )
    # The unique constraint on its own (the CHECK suspended inside a rolled-back transaction):
    # it is what `ON CONFLICT (application_id)` targets.
    with (
        pytest.raises(IntegrityError, match="uq_conversations_application_id"),
        db_engine.connect() as conn,
    ):
        try:
            conn.execute(
                text("ALTER TABLE conversations DROP CONSTRAINT ck_conversations_application_id")
            )
            conn.execute(
                text(
                    "INSERT INTO conversations (application_id, owner_id, seeker_id)"
                    " VALUES (:app, :o, :s)"
                ),
                second,
            )
        finally:
            conn.rollback()
    assert _scalar(
        db_engine,
        "SELECT count(*) FROM pg_constraint WHERE conname = 'ck_conversations_application_id'",
    )

    # Deleting a user cascades their direct chats and messages.
    _execute(
        db_engine,
        "INSERT INTO messages (conversation_id, sender_id, body) VALUES (:c, :s, 'hi')",
        c=direct,
        s=a_id,
    )
    keep = make_direct_chat(
        db_engine, b_id, make_seeker(db_engine, "c@example.com", "Cai"), closed=True
    )
    assert _row(db_engine, keep)["closed_at"] is not None
    _execute(db_engine, "DELETE FROM users WHERE id = :id", id=a_id)
    remaining = _scalar(db_engine, "SELECT array_agg(id) FROM conversations")
    assert remaining == [keep]
    assert _scalar(db_engine, "SELECT count(*) FROM messages") == 0
