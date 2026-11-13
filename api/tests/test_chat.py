"""Chat API (spec 0005a): shortlisting opens a conversation; list, read and send. AC1-AC11 (AC12 is
in `test_migrations.py`)."""

import datetime as dt
import uuid
from collections.abc import Iterator
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, event, text

from app.redis_client import get_redis
from app.schemas.application import ApplicationListingOut
from tests.conftest import (
    Outbox,
    make_application,
    make_listing,
    make_profile,
    make_seeker,
    signup,
)

pytestmark = pytest.mark.usefixtures("redis_clean")

CONVERSATION_KEYS = {
    "id",
    "listing",
    "other_name",
    "my_role",  # 0008d
    "member_count",  # 0008d
    "can_send",
    "is_new",
    "unread_count",
    "last_message",
    "created_at",
}
THREAD_KEYS = {
    "id",
    "listing",
    "other_name",
    "my_role",  # 0008d
    "members",  # 0008d
    "visible_from",  # 0008d
    "can_send",
    "messages",
    "truncated",
}
MESSAGE_KEYS = {"id", "body", "mine", "sender_name", "created_at"}  # sender_name: 0008d
APPLICANT_KEYS = {
    "id",
    "status",
    "message",
    "applicant_name",
    "created_at",
    "updated_at",
    "match",
    "profile",
    "room",  # 0007c
    "source",  # 0008a
}
LISTING_SUMMARY_KEYS = set(ApplicationListingOut.model_fields)
USER_KEYS = {"owner_id", "seeker_id", "sender_id", "user_id", "email"}
NOT_FOUND = {"detail": "not_found"}
CHAT_CLOSED = {"detail": "chat_closed"}
O_EMAIL = "o@example.com"
S_EMAIL = "s@example.com"


def _scalar(engine: Engine, sql: str, **params: Any) -> Any:
    with engine.connect() as conn:
        return conn.execute(text(sql), params).scalar()


def _execute(engine: Engine, sql: str, **params: Any) -> None:
    with engine.begin() as conn:
        conn.execute(text(sql), params)


def _user_id(caller: TestClient) -> uuid.UUID:
    return uuid.UUID(caller.get("/me").json()["id"])


def _keys(value: Any) -> set[str]:
    """Every key in a JSON value, at any depth."""
    if isinstance(value, dict):
        return set(value).union(*(_keys(v) for v in value.values()))
    if isinstance(value, list):
        return set().union(*(_keys(v) for v in value))
    return set()


def _message_count(engine: Engine) -> int:
    count: int = _scalar(engine, "SELECT count(*) FROM messages")
    return count


def _apply(caller: TestClient, listing_id: Any) -> uuid.UUID:
    response = caller.post(f"/listings/{listing_id}/applications", json={"message": "Hello there"})
    assert response.status_code == 201, response.text
    return uuid.UUID(response.json()["id"])


def _set_status(
    owner: TestClient, listing_id: Any, application_id: Any, status: str
) -> httpx.Response:
    response: httpx.Response = owner.patch(
        f"/listings/{listing_id}/applications/{application_id}", json={"status": status}
    )
    return response


def _list(caller: TestClient) -> list[dict[str, Any]]:
    response = caller.get("/me/conversations")
    assert response.status_code == 200, response.text
    body: list[dict[str, Any]] = response.json()
    return body


def _item(caller: TestClient, conversation_id: Any) -> dict[str, Any]:
    (item,) = (c for c in _list(caller) if c["id"] == str(conversation_id))
    return item


def _thread(caller: TestClient, conversation_id: Any) -> httpx.Response:
    response: httpx.Response = caller.get(f"/conversations/{conversation_id}")
    return response


def _send(caller: TestClient, conversation_id: Any, body: Any = "Hello") -> httpx.Response:
    response: httpx.Response = caller.post(
        f"/conversations/{conversation_id}/messages", json={"body": body}
    )
    return response


def _conversation(
    engine: Engine,
    application_id: uuid.UUID,
    owner_id: uuid.UUID,
    seeker_id: uuid.UUID,
    created_ago_s: float = 0,
) -> None:
    """Insert a conversation by SQL (owner's read marker set, as on open; its id is the
    application's, spec 0010g)."""
    _execute(
        engine,
        "INSERT INTO conversations (id, application_id, owner_id, seeker_id, owner_read_at,"
        " created_at) VALUES (:a, :a, :o, :s, now() - make_interval(secs => :ago),"
        " now() - make_interval(secs => :ago))",
        a=application_id,
        o=owner_id,
        s=seeker_id,
        ago=created_ago_s,
    )


def _message(
    engine: Engine, conversation_id: Any, sender_id: uuid.UUID, body: str, ago_s: float
) -> None:
    """Insert a message `ago_s` seconds old by SQL and move `last_message_at` up to it."""
    with engine.begin() as conn:
        created_at = conn.execute(
            text(
                "INSERT INTO messages (conversation_id, sender_id, body, created_at)"
                " VALUES (:c, :s, :b, now() - make_interval(secs => :ago)) RETURNING created_at"
            ),
            {"c": conversation_id, "s": sender_id, "b": body, "ago": ago_s},
        ).scalar_one()
        conn.execute(
            text(
                "UPDATE conversations SET last_message_at = greatest(last_message_at, :t)"
                " WHERE application_id = :c"
            ),
            {"c": conversation_id, "t": created_at},
        )


@pytest.fixture
def owner(client: TestClient, outbox: Outbox) -> TestClient:
    return signup(client, outbox, O_EMAIL, "owner", display_name="Noa")


@pytest.fixture
def seeker(
    client: TestClient, outbox: Outbox, gush_dan: uuid.UUID, db_engine: Engine
) -> TestClient:
    """S, with a housing profile so that applying passes the 0006a gate."""
    caller = signup(client, outbox, S_EMAIL, "seeker", display_name="Dana")
    make_profile(db_engine, _user_id(caller), gush_dan)
    return caller


@pytest.fixture
def owner_id(owner: TestClient) -> uuid.UUID:
    return _user_id(owner)


@pytest.fixture
def seeker_id(seeker: TestClient) -> uuid.UUID:
    return _user_id(seeker)


@pytest.fixture
def listing_a(owner_id: uuid.UUID, gush_dan: uuid.UUID, db_engine: Engine) -> uuid.UUID:
    return make_listing(db_engine, owner_id, gush_dan)


@pytest.fixture
def submitted(seeker: TestClient, listing_a: uuid.UUID) -> uuid.UUID:
    """S's submitted application P to O's listing A, through `0004a`'s endpoint."""
    return _apply(seeker, listing_a)


@pytest.fixture
def chat(owner: TestClient, listing_a: uuid.UUID, submitted: uuid.UUID) -> uuid.UUID:
    """P, shortlisted by O through `0004c`'s PATCH: the conversation's id."""
    assert _set_status(owner, listing_a, submitted, "shortlisted").status_code == 200
    return submitted


@pytest.fixture
def statements(db_engine: Engine) -> Iterator[list[str]]:
    """Every SQL statement the app engine sends while the test records (`.clear()` to start)."""
    seen: list[str] = []

    def record(_conn: Any, _cursor: Any, statement: str, *_: Any) -> None:
        seen.append(statement)

    event.listen(db_engine, "before_cursor_execute", record)
    yield seen
    event.remove(db_engine, "before_cursor_execute", record)


def _conversation_row(engine: Engine, application_id: Any) -> tuple[Any, ...] | None:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT owner_id, seeker_id, owner_read_at IS NOT NULL, seeker_read_at,"
                " last_message_at, created_at FROM conversations WHERE application_id = :a"
            ),
            {"a": application_id},
        ).one_or_none()
    return None if row is None else tuple(row)


def test_ac1_shortlist_opens_one_conversation(
    owner: TestClient,
    owner_id: uuid.UUID,
    seeker_id: uuid.UUID,
    listing_a: uuid.UUID,
    submitted: uuid.UUID,
    db_engine: Engine,
    statements: list[str],
) -> None:
    other_seeker = make_seeker(db_engine, "q@example.com", "Omer")
    declined = make_application(db_engine, listing_a, other_seeker)
    owner.get("/me")  # warm-up: a first connect sends its own setup statements

    statements.clear()
    response = _set_status(owner, listing_a, submitted, "shortlisted")
    sent = list(statements)
    assert response.status_code == 200, response.text
    assert set(response.json()) == APPLICANT_KEYS
    assert len(sent) == 4, sent  # the session lookup, the UPDATE, the INSERT, the response row
    assert "UPDATE applications" in sent[1]
    assert "INSERT INTO conversations" in sent[2]
    assert _scalar(db_engine, "SELECT count(*) FROM conversations") == 1
    opened = _conversation_row(db_engine, submitted)
    assert opened is not None
    assert opened[:5] == (owner_id, seeker_id, True, None, None)

    statements.clear()
    response = _set_status(owner, listing_a, submitted, "submitted")
    sent = list(statements)
    assert response.status_code == 200, response.text
    assert set(response.json()) == APPLICANT_KEYS
    assert len(sent) == 3, sent  # an un-shortlist inserts nothing
    for status in ("shortlisted", "shortlisted"):  # a re-shortlist, then the same status again
        response = _set_status(owner, listing_a, submitted, status)
        assert response.status_code == 200, response.text
        assert set(response.json()) == APPLICANT_KEYS
    assert _scalar(db_engine, "SELECT count(*) FROM conversations") == 1
    assert _conversation_row(db_engine, submitted) == opened

    statements.clear()
    response = _set_status(owner, listing_a, declined, "declined")
    sent = list(statements)
    assert response.status_code == 200, response.text
    assert set(response.json()) == APPLICANT_KEYS
    assert len(sent) == 3, sent
    assert _conversation_row(db_engine, declined) is None
    assert _scalar(db_engine, "SELECT count(*) FROM conversations") == 1


def test_ac2_list_conversations(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    seeker: TestClient,
    owner_id: uuid.UUID,
    seeker_id: uuid.UUID,
    chat: uuid.UUID,
) -> None:
    seeker_response = seeker.get("/me/conversations")
    assert seeker_response.status_code == 200, seeker_response.text
    (item,) = seeker_response.json()
    assert set(item) == CONVERSATION_KEYS
    assert item["id"] == str(chat)
    assert item["other_name"] == "Noa"
    assert item["my_role"] == "seeker"
    assert item["member_count"] == 2
    assert item["can_send"] is True
    assert item["is_new"] is True
    assert item["unread_count"] == 0
    assert item["last_message"] is None
    assert set(item["listing"]) == LISTING_SUMMARY_KEYS

    owner_response = owner.get("/me/conversations")
    assert owner_response.status_code == 200, owner_response.text
    (owner_item,) = owner_response.json()
    assert owner_item == {**item, "other_name": "Dana", "my_role": "owner", "is_new": False}

    for response in (seeker_response, owner_response):
        assert not _keys(response.json()) & USER_KEYS
        for secret in (O_EMAIL, S_EMAIL, str(owner_id), str(seeker_id)):
            assert secret not in response.text

    third = signup(client, outbox, "t@example.com", "seeker", display_name="Tal")
    assert _list(third) == []


def test_ac3_order_preview_unread_can_send(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    owner_id: uuid.UUID,
    listing_a: uuid.UUID,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    conversations: dict[str, uuid.UUID] = {}
    seekers: dict[str, uuid.UUID] = {}
    for name in ("three", "one", "two", "empty"):
        seekers[name] = make_seeker(db_engine, f"{name}@example.com", name)
        conversations[name] = make_application(
            db_engine, listing_a, seekers[name], status="shortlisted"
        )
        _conversation(
            db_engine,
            conversations[name],
            owner_id,
            seekers[name],
            created_ago_s=5 if name == "empty" else 10,
        )
    long_body = "".join(chr(ord("a") + i % 26) for i in range(300))
    _message(db_engine, conversations["three"], seekers["three"], "earlier", 20)
    _message(db_engine, conversations["three"], seekers["three"], "from three", 3)
    _message(db_engine, conversations["one"], owner_id, long_body, 1)
    _message(db_engine, conversations["two"], seekers["two"], "from two", 2)

    listed = _list(owner)
    assert [c["id"] for c in listed] == [
        str(conversations[name]) for name in ("one", "two", "three", "empty")
    ]
    by_name = dict(zip(("one", "two", "three", "empty"), listed, strict=True))
    assert by_name["one"]["last_message"]["body"] == long_body[:120]
    assert by_name["one"]["last_message"]["mine"] is True
    assert by_name["two"]["last_message"] == {
        "body": "from two",
        "mine": False,
        "created_at": by_name["two"]["last_message"]["created_at"],
    }
    assert by_name["three"]["last_message"]["body"] == "from three"
    assert by_name["empty"]["last_message"] is None
    # O's marker is 10 s old: S's messages after it are unread, the 20 s old one and O's own not.
    assert [by_name[name]["unread_count"] for name in ("one", "two", "three", "empty")] == [
        0,
        1,
        1,
        0,
    ]

    seeker = signup(client, outbox, S_EMAIL, "seeker", display_name="Dana")
    seeker_id = _user_id(seeker)
    make_profile(db_engine, seeker_id, gush_dan)
    application = _apply(seeker, listing_a)
    assert _set_status(owner, listing_a, application, "shortlisted").status_code == 200
    _execute(
        db_engine,
        "UPDATE conversations SET owner_read_at = now() - interval '30 seconds'"
        " WHERE application_id = :a",
        a=application,
    )
    _message(db_engine, application, seeker_id, "before", 40)
    for ago in (20, 19, 18):
        _message(db_engine, application, seeker_id, f"after {ago}", ago)
    assert _item(owner, application)["unread_count"] == 3
    assert _item(seeker, application)["unread_count"] == 0
    assert _item(seeker, application)["last_message"]["mine"] is True

    for status in ("submitted", "declined", "withdrawn"):
        _execute(
            db_engine, "UPDATE applications SET status = :s WHERE id = :a", s=status, a=application
        )
        assert _item(owner, application)["can_send"] is False
        assert _item(seeker, application)["can_send"] is False
    assert _item(owner, conversations["one"])["can_send"] is True


def test_ac4_list_is_two_statements(
    owner: TestClient,
    owner_id: uuid.UUID,
    listing_a: uuid.UUID,
    db_engine: Engine,
    statements: list[str],
) -> None:
    def add_conversation(index: int) -> None:
        seeker_id = make_seeker(db_engine, f"seeker-{index}@example.com", f"seeker {index}")
        application_id = make_application(db_engine, listing_a, seeker_id, status="shortlisted")
        _conversation(db_engine, application_id, owner_id, seeker_id)
        _message(db_engine, application_id, seeker_id, f"hi {index}", 2)
        _message(db_engine, application_id, owner_id, f"reply {index}", 1)

    for expected, new in ((1, range(1)), (6, range(1, 6))):
        for index in new:
            add_conversation(index)
        owner.get("/me/conversations")  # warm-up
        statements.clear()
        listed = _list(owner)
        sent = list(statements)
        assert len(listed) == expected
        assert len(sent) == 2, sent  # the session lookup, then the list
        assert "FROM conversations" in sent[1]


def test_ac5_thread_reads_and_marks_read(
    owner: TestClient,
    seeker: TestClient,
    owner_id: uuid.UUID,
    seeker_id: uuid.UUID,
    chat: uuid.UUID,
    db_engine: Engine,
    statements: list[str],
) -> None:
    _execute(
        db_engine,
        "UPDATE conversations SET owner_read_at = now() - interval '10 seconds'"
        " WHERE application_id = :a",
        a=chat,
    )
    _message(db_engine, chat, seeker_id, "m1", 3)
    _message(db_engine, chat, owner_id, "m2", 2)
    _message(db_engine, chat, seeker_id, "m3", 1)
    assert _item(owner, chat)["unread_count"] == 2
    seeker_item = _item(seeker, chat)
    assert seeker_item["is_new"] is True
    assert seeker_item["unread_count"] == 1  # a null marker: every message of O's is unread

    seeker.get("/me")  # warm-up
    statements.clear()
    response = _thread(seeker, chat)
    first = list(statements)
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == THREAD_KEYS
    assert body["id"] == str(chat)
    assert body["other_name"] == "Noa"
    assert body["my_role"] == "seeker"
    assert body["members"] == [
        {"name": "Noa", "role": "owner", "is_me": False},
        {"name": "Dana", "role": "seeker", "is_me": True},
    ]
    assert body["visible_from"] is None
    assert body["can_send"] is True
    assert body["truncated"] is False
    assert set(body["listing"]) == LISTING_SUMMARY_KEYS
    assert [m["body"] for m in body["messages"]] == ["m1", "m2", "m3"]
    assert all(set(m) == MESSAGE_KEYS for m in body["messages"])
    # m1 and m3 are S's own.
    assert [m["mine"] for m in body["messages"]] == [True, False, True]
    assert [m["sender_name"] for m in body["messages"]] == ["Dana", "Noa", "Dana"]
    assert len(first) == 4, first  # session, header, messages, the read marker
    assert "FROM conversations" in first[1]
    assert "FROM messages" in first[2]
    assert "UPDATE conversations" in first[3]

    statements.clear()
    repeat = _thread(seeker, chat)
    again = list(statements)
    assert repeat.status_code == 200, repeat.text
    assert repeat.json() == body
    assert len(again) == 3, again  # nothing new: no UPDATE
    assert not any("UPDATE" in statement for statement in again)

    seeker_item = _item(seeker, chat)
    assert seeker_item["is_new"] is False
    assert seeker_item["unread_count"] == 0
    assert _item(owner, chat)["unread_count"] == 2

    owner_thread = _thread(owner, chat)
    assert owner_thread.status_code == 200, owner_thread.text
    assert owner_thread.json()["other_name"] == "Dana"
    assert owner_thread.json()["my_role"] == "owner"
    assert owner_thread.json()["members"] == [
        {"name": "Noa", "role": "owner", "is_me": True},
        {"name": "Dana", "role": "seeker", "is_me": False},
    ]
    assert [m["mine"] for m in owner_thread.json()["messages"]] == [False, True, False]
    assert _item(owner, chat)["unread_count"] == 0

    assert _send(owner, chat, "m4").status_code == 201
    assert _item(seeker, chat)["unread_count"] == 1
    statements.clear()
    assert _thread(seeker, chat).status_code == 200
    after_new = list(statements)
    assert len(after_new) == 4, after_new
    assert "UPDATE conversations" in after_new[3]
    assert _item(seeker, chat)["unread_count"] == 0


def test_ac6_thread_is_capped_at_200(
    seeker: TestClient, seeker_id: uuid.UUID, chat: uuid.UUID, db_engine: Engine
) -> None:
    _execute(
        db_engine,
        "INSERT INTO messages (conversation_id, sender_id, body, created_at)"
        " SELECT :c, :s, 'm' || g, now() - (205 - g) * interval '1 millisecond'"
        " FROM generate_series(1, 205) g",
        c=chat,
        s=seeker_id,
    )
    _execute(
        db_engine,
        "UPDATE conversations SET last_message_at = now() WHERE application_id = :c",
        c=chat,
    )

    response = _thread(seeker, chat)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["truncated"] is True
    assert [m["body"] for m in body["messages"]] == [f"m{i}" for i in range(6, 206)]

    _execute(
        db_engine,
        "DELETE FROM messages WHERE body IN ('m1', 'm2', 'm3', 'm4', 'm5')",
    )
    response = _thread(seeker, chat)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["truncated"] is False
    assert [m["body"] for m in body["messages"]] == [f"m{i}" for i in range(6, 206)]


def test_ac7_participants_only(
    client: TestClient,
    outbox: Outbox,
    owner_id: uuid.UUID,
    seeker: TestClient,
    gush_dan: uuid.UUID,
    chat: uuid.UUID,
    db_engine: Engine,
) -> None:
    assert _thread(client, chat).status_code == 401
    assert _thread(client, chat).json() == {"detail": "unauthenticated"}
    assert _send(client, chat).status_code == 401

    third = signup(client, outbox, "t@example.com", "seeker", display_name="Tal")
    other_owner = signup(client, outbox, "o2@example.com", "owner", display_name="Avi")
    unknown = uuid.uuid4()
    for caller in (third, other_owner):
        for conversation_id in (chat, unknown):
            thread = _thread(caller, conversation_id)
            assert thread.status_code == 404
            assert thread.json() == NOT_FOUND
            sent = _send(caller, conversation_id)
            assert sent.status_code == 404
            assert sent.json() == NOT_FOUND
    assert _thread(seeker, unknown).json() == NOT_FOUND
    assert _message_count(db_engine) == 0

    listing_b = make_listing(db_engine, owner_id, gush_dan)
    never_shortlisted = _apply(seeker, listing_b)
    assert _thread(seeker, never_shortlisted).status_code == 404
    assert _send(seeker, never_shortlisted).status_code == 404
    assert _message_count(db_engine) == 0

    assert _thread(seeker, "not-a-uuid").status_code == 422
    assert _send(seeker, "not-a-uuid").status_code == 422


def test_ac8_send_message(
    owner: TestClient,
    seeker: TestClient,
    owner_id: uuid.UUID,
    listing_a: uuid.UUID,
    chat: uuid.UUID,
    db_engine: Engine,
) -> None:
    older_seeker = make_seeker(db_engine, "older@example.com", "Older")
    older = make_application(db_engine, listing_a, older_seeker, status="shortlisted")
    _conversation(db_engine, older, owner_id, older_seeker, created_ago_s=10)
    _message(db_engine, older, older_seeker, "a while ago", 1)
    _execute(
        db_engine,
        "UPDATE conversations SET created_at = now() - interval '5 seconds'"
        " WHERE application_id = :a",
        a=chat,
    )
    assert _list(owner)[0]["id"] == str(older)

    response = _send(seeker, chat, "  \u05e9\u05dc\u05d5\u05dd  ")
    assert response.status_code == 201, response.text
    body = response.json()
    assert set(body) == MESSAGE_KEYS
    assert body["body"] == "\u05e9\u05dc\u05d5\u05dd"
    assert body["mine"] is True
    assert body["sender_name"] == "Dana"
    last_message_at = _scalar(
        db_engine, "SELECT last_message_at FROM conversations WHERE application_id = :a", a=chat
    )
    assert last_message_at == dt.datetime.fromisoformat(body["created_at"])

    owner_list = _list(owner)
    assert owner_list[0]["id"] == str(chat)
    assert owner_list[0]["unread_count"] == 1
    assert owner_list[0]["last_message"]["mine"] is False
    assert owner_list[0]["last_message"]["body"] == "\u05e9\u05dc\u05d5\u05dd"
    assert _item(seeker, chat)["unread_count"] == 0
    assert _item(seeker, chat)["last_message"]["mine"] is True

    reply = _send(owner, chat, "Hi Dana")
    assert reply.status_code == 201, reply.text
    assert reply.json()["mine"] is True
    assert reply.json()["sender_name"] == "Noa"
    assert _item(seeker, chat)["unread_count"] == 1
    assert _item(owner, chat)["unread_count"] == 0
    assert _message_count(db_engine) == 3


def test_ac9_closed_after_unshortlist_decline_withdraw(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    seeker: TestClient,
    listing_a: uuid.UUID,
    chat: uuid.UUID,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    assert _send(seeker, chat, "before").status_code == 201
    assert _set_status(owner, listing_a, chat, "submitted").status_code == 200
    for caller in (seeker, owner):
        response = _send(caller, chat)
        assert response.status_code == 409
        assert response.json() == CHAT_CLOSED
    assert _message_count(db_engine) == 1
    for caller in (seeker, owner):
        thread = _thread(caller, chat)
        assert thread.status_code == 200, thread.text
        assert thread.json()["can_send"] is False
        assert [m["body"] for m in thread.json()["messages"]] == ["before"]

    assert _set_status(owner, listing_a, chat, "shortlisted").status_code == 200
    assert _send(seeker, chat, "again").status_code == 201
    assert _thread(owner, chat).json()["can_send"] is True

    assert _set_status(owner, listing_a, chat, "declined").status_code == 200
    for caller in (seeker, owner):
        response = _send(caller, chat)
        assert response.status_code == 409
        assert response.json() == CHAT_CLOSED
    assert _message_count(db_engine) == 2

    withdrawer = signup(client, outbox, "w@example.com", "seeker", display_name="Wren")
    make_profile(db_engine, _user_id(withdrawer), gush_dan)
    withdrawn = _apply(withdrawer, listing_a)
    assert _set_status(owner, listing_a, withdrawn, "shortlisted").status_code == 200
    assert _send(withdrawer, withdrawn, "hello").status_code == 201
    response = withdrawer.post(f"/me/applications/{withdrawn}/withdraw")
    assert response.status_code == 200, response.text
    for caller in (withdrawer, owner):
        response = _send(caller, withdrawn)
        assert response.status_code == 409
        assert response.json() == CHAT_CLOSED
        assert _thread(caller, withdrawn).json()["can_send"] is False
    assert _message_count(db_engine) == 3


def test_ac10_body_validation(seeker: TestClient, chat: uuid.UUID, db_engine: Engine) -> None:
    for invalid in (
        "",
        "   ",
        "x" * 2001,
        "hi\u202ethere",
        "\u200b\u200b",
        "a\u3164b",
        "\u05d0" + "\u05b8" * 5,
        # Only joiners, marks or variation selectors: nothing renders (review M1).
        "\u200d",
        "\u200c" * 5,
        "\u034f",
        "\ufe0f",
        "\u180b",
        "\u0300\u0301\u0302\u0303",
    ):
        assert _send(seeker, chat, invalid).status_code == 422, repr(invalid)
    missing = seeker.post(f"/conversations/{chat}/messages", json={})
    assert missing.status_code == 422
    assert _message_count(db_engine) == 0

    for valid in ("\U0001f44d", "\u2764\ufe0f", "?"):
        response = _send(seeker, chat, valid)
        assert response.status_code == 201, (valid, response.text)
        assert response.json()["body"] == valid
    crlf = _send(seeker, chat, "a\r\nb")
    assert crlf.status_code == 201, crlf.text
    assert crlf.json()["body"] == "a\nb"
    assert (
        _scalar(db_engine, "SELECT body FROM messages WHERE id = :id", id=crlf.json()["id"])
        == "a\nb"
    )
    extra = seeker.post(
        f"/conversations/{chat}/messages", json={"body": "ok", "sender_id": str(uuid.uuid4())}
    )
    assert extra.status_code == 201, extra.text
    assert extra.json()["mine"] is True
    assert _message_count(db_engine) == 5


def test_ac11_send_rate_limits(
    owner: TestClient,
    seeker: TestClient,
    seeker_id: uuid.UUID,
    chat: uuid.UUID,
    db_engine: Engine,
) -> None:
    for index in range(20):
        response = _send(seeker, chat, f"message {index}")
        assert response.status_code == 201, (index, response.text)

    limited = _send(seeker, chat, "one too many")
    assert limited.status_code == 429
    assert limited.json() == {"detail": "rate_limited"}
    assert 1 <= int(limited.headers["Retry-After"]) <= 60
    assert _message_count(db_engine) == 20

    assert _send(owner, chat, "the owner still can").status_code == 201

    r = get_redis()
    r.delete(f"rl:chat:user:{seeker_id}")
    r.set(f"rl:chat:user:day:{seeker_id}", 300, ex=86_400)
    day_limited = _send(seeker, chat, "tomorrow")
    assert day_limited.status_code == 429
    assert day_limited.json() == {"detail": "rate_limited"}
    assert 1 <= int(day_limited.headers["Retry-After"]) <= 86_400
    assert _message_count(db_engine) == 21
