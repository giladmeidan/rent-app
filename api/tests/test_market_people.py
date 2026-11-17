"""People browse in שוק השותפים (spec 0010h): AC1-AC11, AC12b and AC13 (AC2's SQL table is in
`test_person_fit.py`, AC12 in `test_people.py`, AC14 in `test_migrations.py`).

People are made directly (`make_seeker` + `make_card`) and signed in with a session row
(`_login`), so a test can hold many of them without the OTP limits. `A` ("Avi") and `B` ("Bat")
show a woman's card wanting anyone, unless a test says otherwise."""

import datetime as dt
import secrets
import threading
import time
import uuid
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import Any

import httpx
import pytest
import redis.exceptions
from fastapi.testclient import TestClient
from sqlalchemy import Engine, event, text
from sqlalchemy.orm import Session

from app.db import get_sessionmaker
from app.models import User
from app.redis_client import get_redis
from app.services import auth as auth_service
from app.services import chat_events
from app.services import market_people as market_service
from app.services import people as people_service
from app.services.photos import person_photo_url
from tests.conftest import (
    make_application,
    make_card,
    make_direct_chat,
    make_flatmate,
    make_listing,
    make_owner,
    make_pair,
    make_person_like,
    make_profile,
    make_seeker,
)
from tests.test_flatmates import Published
from tests.test_matching import _area
from tests.test_person_fit import NINE, _expected
from tests.test_profiles import _p

pytestmark = pytest.mark.usefixtures("redis_clean")

CARD_REQUIRED = {"detail": "card_required"}
NOT_FOUND = {"detail": "not_found"}
CHAT_CLOSED = {"detail": "chat_closed"}
CARD_KEYS = {
    "card_id",
    "display_name",
    "gender",
    "age",
    "area_ids",
    "move_in_date",
    "move_in_flexible",
    "lifestyle",
    "about_me",
    "photo_url",
    "liked_by_me",
    "liked_me",
}
YEAR = dt.datetime.now(dt.UTC).year
PAIR_INDEXES = ("person_pairs_pkey", "ix_person_pairs_user_high")


@dataclass(frozen=True)
class Person:
    caller: TestClient
    id: uuid.UUID
    card: uuid.UUID  # `users.card_id`, whether or not the card is shown


def _scalar(engine: Engine, sql: str, **params: Any) -> Any:
    with engine.connect() as conn:
        return conn.execute(text(sql), params).scalar()


def _execute(engine: Engine, sql: str, **params: Any) -> None:
    with engine.begin() as conn:
        conn.execute(text(sql), params)


def _ok(response: httpx.Response, code: int = 200) -> Any:
    assert response.status_code == code, response.text
    return response.json() if response.content else None


def _login(client: TestClient, engine: Engine, user_id: uuid.UUID) -> TestClient:
    """A `TestClient` holding a fresh session of `user_id` (`auth.create_session`, no OTP)."""
    with Session(engine) as db:
        user = db.get(User, user_id)
        assert user is not None
        token = auth_service.create_session(db, user)
    return TestClient(client.app, cookies={"rent_session": token})


def _person(
    client: TestClient,
    engine: Engine,
    area: uuid.UUID,
    name: str,
    *,
    card: bool = True,
    gender: str = "woman",
    pref: str = "any",
    **profile: Any,
) -> Person:
    """A signed-in person named `name`; with `card`, showing `make_card`'s card."""
    user_id = make_seeker(engine, f"{name.lower()}-{secrets.token_hex(4)}@example.com", name)
    if card:
        make_card(engine, user_id, area, gender=gender, flatmate_gender=pref, **profile)
    card_id: uuid.UUID = _scalar(engine, "SELECT card_id FROM users WHERE id = :id", id=user_id)
    return Person(_login(client, engine, user_id), user_id, card_id)


def _browse(caller: TestClient, offset: int | None = None) -> httpx.Response:
    params = {} if offset is None else {"offset": offset}
    response: httpx.Response = caller.get("/people", params=params)
    return response


def _page(caller: TestClient, offset: int | None = None) -> dict[str, Any]:
    body: dict[str, Any] = _ok(_browse(caller, offset))
    return body


def _names(caller: TestClient) -> list[str]:
    return [item["display_name"] for item in _page(caller)["items"]]


def _like(caller: TestClient, card: Any) -> httpx.Response:
    response: httpx.Response = caller.put(f"/people/{card}/like")
    return response


def _unlike(caller: TestClient, card: Any) -> httpx.Response:
    response: httpx.Response = caller.delete(f"/people/{card}/like")
    return response


def _remove(caller: TestClient, conversation_id: Any) -> httpx.Response:
    response: httpx.Response = caller.delete(f"/me/matches/{conversation_id}")
    return response


def _likes(caller: TestClient) -> dict[str, Any]:
    body: dict[str, Any] = _ok(caller.get("/me/people-likes"))
    assert set(body) == {"liked_me", "mine", "matches"}
    return body


def _like_names(caller: TestClient) -> dict[str, list[str]]:
    body = _likes(caller)
    return {key: [item["display_name"] for item in body[key]] for key in body}


def _send(caller: TestClient, conversation_id: Any, body: str = "Hello") -> httpx.Response:
    response: httpx.Response = caller.post(
        f"/conversations/{conversation_id}/messages", json={"body": body}
    )
    return response


def _pair(engine: Engine, a: uuid.UUID, b: uuid.UUID) -> Any:
    """The pair of `a` and `b` as (a's like, b's like), or None without a row."""
    with engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT user_low, low_liked_at, high_liked_at FROM person_pairs"
                " WHERE user_low = least(CAST(:a AS uuid), CAST(:b AS uuid))"
                " AND user_high = greatest(CAST(:a AS uuid), CAST(:b AS uuid))"
            ),
            {"a": a, "b": b},
        ).one_or_none()
    if row is None:
        return None
    if row.user_low == a:
        return (row.low_liked_at, row.high_liked_at)
    return (row.high_liked_at, row.low_liked_at)


def _direct_chats(engine: Engine) -> list[Any]:
    with engine.connect() as conn:
        return list(
            conn.execute(
                text("SELECT id, closed_at FROM conversations WHERE application_id IS NULL")
            ).all()
        )


def _live_room(engine: Engine, owner_id: uuid.UUID, area: uuid.UUID, **overrides: Any) -> uuid.UUID:
    values: dict[str, Any] = {"listing_type": "room", "flatmates_count": 2, **overrides}
    return make_listing(engine, owner_id, area, **values)


def _hide(engine: Engine, user_id: uuid.UUID) -> None:
    _execute(
        engine, "UPDATE seeker_profiles SET people_visible = false WHERE user_id = :id", id=user_id
    )


def _browse_count(user_id: uuid.UUID) -> int:
    return int(get_redis().get(f"rl:browse:user:{user_id}") or 0)


def _like_count(user_id: uuid.UUID) -> int:
    return int(get_redis().get(f"rl:like:user:{user_id}") or 0)


@pytest.fixture
def statements(db_engine: Engine) -> Iterator[list[str]]:
    """Every SQL statement the app engine sends while the test records (`.clear()` to start)."""
    seen: list[str] = []

    def record(_conn: Any, _cursor: Any, statement: str, *_: Any) -> None:
        seen.append(statement)

    event.listen(db_engine, "before_cursor_execute", record)
    yield seen
    event.remove(db_engine, "before_cursor_execute", record)


@pytest.fixture
def published(monkeypatch: pytest.MonkeyPatch) -> Published:
    recorder = Published()
    monkeypatch.setattr(chat_events, "publish", recorder)
    return recorder


# --- AC1 ---------------------------------------------------------------------------------------


def test_ac1_entry_ticket(client: TestClient, db_engine: Engine, gush_dan: uuid.UUID) -> None:
    a = _person(client, db_engine, gush_dan, "Avi", card=False)
    _person(client, db_engine, gush_dan, "Bat")  # a woman wanting anyone
    _person(client, db_engine, gush_dan, "Cam", gender="man", pref="women")
    _person(client, db_engine, gush_dan, "Dor", pref="men")

    assert client.get("/people").status_code == 401
    assert client.get("/me/people-likes").status_code == 401
    for path in ("/people", "/me/people-likes"):
        response = a.caller.get(path)
        assert response.status_code == 403, path
        assert response.json() == CARD_REQUIRED

    # A live room is not a ticket (spec 0010m): still 403 on both paths.
    _live_room(db_engine, a.id, gush_dan)
    for path in ("/people", "/me/people-likes"):
        response = a.caller.get(path)
        assert response.status_code == 403, path
        assert response.json() == CARD_REQUIRED

    # A man's card: Dor (wants men) shows now, Cam (wants women) does not.
    make_card(db_engine, a.id, gush_dan, gender="man")
    assert sorted(_names(a.caller)) == ["Bat", "Dor"]
    _likes(a.caller)

    _hide(db_engine, a.id)
    assert _browse(a.caller).json() == CARD_REQUIRED
    assert a.caller.get("/me/people-likes").json() == CARD_REQUIRED


# --- AC2 ---------------------------------------------------------------------------------------


def test_ac2_browse_applies_gender_rule(
    client: TestClient, db_engine: Engine, gush_dan: uuid.UUID
) -> None:
    people: dict[str, tuple[str, str]] = {}
    for gender, pref in NINE:
        name = f"P-{gender}-{pref}"
        user_id = make_seeker(db_engine, f"{name.lower()}@example.com", name)
        make_card(db_engine, user_id, gush_dan, gender=gender, flatmate_gender=pref)
        people[name] = (gender, pref)
    viewers: list[tuple[tuple[str | None, str], Person]] = [
        ((gender, pref), _person(client, db_engine, gush_dan, f"V{n}", gender=gender, pref=pref))
        for n, (gender, pref) in enumerate(NINE)
    ]

    for viewer, person in viewers:
        shown = {name for name in _names(person.caller) if name in people}
        assert shown == {name for name, p in people.items() if _expected(viewer, p)}, viewer
    # The bullets of AC2 through the endpoint.
    by_gender = dict(viewers)
    assert "P-man-any" not in _names(by_gender[("woman", "women")].caller)
    assert "P-woman-women" not in _names(by_gender[("man", "any")].caller)
    assert "P-woman-women" not in _names(by_gender[("other", "any")].caller)


# --- AC3 ---------------------------------------------------------------------------------------


def test_ac3_card_fields_and_privacy(
    client: TestClient, db_engine: Engine, gush_dan: uuid.UUID, statements: list[str]
) -> None:
    a = _person(client, db_engine, gush_dan, "Avi")
    b = _person(
        client,
        db_engine,
        gush_dan,
        "Bat",
        budget_max_ils=98765,
        birth_year=YEAR - 31,
        about_me="Bat likes plants",
        lifestyle={"cleanliness": 3, "night": 1},
        move_in_flexible=True,
    )
    photo = secrets.token_urlsafe(32)
    _execute(db_engine, "UPDATE users SET photo_key = :k WHERE id = :id", k=photo, id=b.id)
    c = _person(client, db_engine, gush_dan, "Cam")
    hidden = _person(client, db_engine, gush_dan, "Hid")
    _hide(db_engine, hidden.id)
    matched = _person(client, db_engine, gush_dan, "Mat")
    make_person_like(db_engine, a.id, matched.id)
    make_person_like(db_engine, matched.id, a.id)
    make_direct_chat(db_engine, a.id, matched.id)

    a.caller.get("/me")  # warm-up
    statements.clear()
    response = _browse(a.caller)
    sent = list(statements)
    body = _ok(response)
    assert body["total"] == 2
    cards = {item["display_name"]: item for item in body["items"]}
    assert set(cards) == {"Bat", "Cam"}  # not the caller, the hidden card or the match
    assert all(set(card) == CARD_KEYS for card in body["items"])
    move_in = _scalar(
        db_engine, "SELECT move_in_date FROM seeker_profiles WHERE user_id = :id", id=b.id
    )
    assert cards["Bat"] == {
        "card_id": str(b.card),
        "display_name": "Bat",
        "gender": "woman",
        "age": 31,
        "area_ids": [str(gush_dan)],
        "move_in_date": move_in.isoformat(),
        "move_in_flexible": True,
        "lifestyle": {"cleanliness": 3, "night": 1},
        "about_me": "Bat likes plants",
        "photo_url": person_photo_url(photo),
        "liked_by_me": False,
        "liked_me": False,
    }
    assert cards["Cam"]["photo_url"] is None
    assert cards["Cam"]["age"] is None
    raw = response.text
    for secret in (
        "98765",
        "budget",
        "flatmate_gender",
        "household",
        "@example.com",
        *(str(person.id) for person in (a, b, c, hidden, matched)),
    ):
        assert secret not in raw, secret
    (page,) = (statement for statement in sent if "count(*) OVER ()" in statement)
    assert "budget_max_ils" not in page
    assert not any("budget_max_ils" in statement for statement in sent)


# --- AC4 ---------------------------------------------------------------------------------------


def test_ac4_order_and_paging(client: TestClient, db_engine: Engine, gush_dan: uuid.UUID) -> None:
    north = _area(db_engine, 6300, active=True)
    viewer = _person(client, db_engine, north, "Viewer")
    now = dt.datetime.now(dt.UTC)
    ids: dict[str, uuid.UUID] = {}
    for n in range(25):
        name = f"P{n:02d}"
        ids[name] = make_seeker(db_engine, f"p{n}@example.com", name)
        # P05-P09 share the viewer's area; the rest (P00, P01 the likers too) do not.
        areas = [gush_dan, north] if 5 <= n < 10 else [gush_dan]
        make_card(
            db_engine,
            ids[name],
            gush_dan,
            gender="woman",
            area_ids=areas,
            updated_at=now - dt.timedelta(minutes=n),
        )
    for liker in ("P03", "P20"):
        make_person_like(db_engine, ids[liker], viewer.id)

    first = _page(viewer.caller)
    second = _page(viewer.caller, 20)
    assert first["total"] == second["total"] == 25
    names = [item["display_name"] for item in (*first["items"], *second["items"])]
    rest = [f"P{n:02d}" for n in range(25) if n not in (3, 20) and not 5 <= n < 10]
    assert names == ["P03", "P20", "P05", "P06", "P07", "P08", "P09", *rest]
    assert (len(first["items"]), len(second["items"])) == (20, 5)
    assert [item["liked_me"] for item in first["items"][:3]] == [True, True, False]
    assert _browse(viewer.caller, 1001).status_code == 422
    assert _browse(viewer.caller, -1).status_code == 422
    assert _page(viewer.caller, 1000) == {"items": [], "total": 25}


# --- AC5 ---------------------------------------------------------------------------------------


def test_ac5_one_sided_like(
    client: TestClient, db_engine: Engine, gush_dan: uuid.UUID, published: Published
) -> None:
    a = _person(client, db_engine, gush_dan, "Avi")
    b = _person(client, db_engine, gush_dan, "Bat")
    # Two newer cards, so without the like Avi would not come first in Bat's browse.
    for name in ("Cam", "Dor"):
        _person(client, db_engine, gush_dan, name)
    assert _names(b.caller)[-1] == "Avi"

    assert _ok(_like(a.caller, b.card)) == {"liked": True, "conversation_id": None}
    first_like = _pair(db_engine, a.id, b.id)
    assert first_like[0] is not None and first_like[1] is None

    items = _page(b.caller)["items"]
    assert items[0]["display_name"] == "Avi"
    assert (items[0]["liked_me"], items[0]["liked_by_me"]) == (True, False)
    b_likes = _likes(b.caller)
    assert [card["card_id"] for card in b_likes["liked_me"]] == [str(a.card)]
    assert (b_likes["liked_me"][0]["liked_me"], b_likes["liked_me"][0]["liked_by_me"]) == (
        True,
        False,
    )
    assert (b_likes["mine"], b_likes["matches"]) == ([], [])
    a_likes = _likes(a.caller)
    assert [card["card_id"] for card in a_likes["mine"]] == [str(b.card)]
    assert set(a_likes["mine"][0]) == CARD_KEYS
    assert a_likes["mine"][0]["liked_by_me"] is True
    assert (a_likes["liked_me"], a_likes["matches"]) == ([], [])
    (bat,) = (item for item in _page(a.caller)["items"] if item["display_name"] == "Bat")
    assert (bat["liked_by_me"], bat["liked_me"]) == (True, False)

    assert _ok(_like(a.caller, b.card)) == {"liked": True, "conversation_id": None}
    assert _pair(db_engine, a.id, b.id) == first_like  # the first like kept
    assert published.calls == []
    assert _direct_chats(db_engine) == []


# --- AC6 ---------------------------------------------------------------------------------------


def test_ac6_mutual_opens_direct_chat(
    client: TestClient,
    db_engine: Engine,
    gush_dan: uuid.UUID,
    published: Published,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    a = _person(client, db_engine, gush_dan, "Avi")
    b = _person(client, db_engine, gush_dan, "Bat")
    photo = secrets.token_urlsafe(32)
    _execute(db_engine, "UPDATE users SET photo_key = :k WHERE id = :id", k=photo, id=b.id)

    _ok(_like(a.caller, b.card))
    liked = _ok(_like(b.caller, a.card))
    assert liked["liked"] is True
    conversation_id = liked["conversation_id"]
    assert conversation_id is not None
    chats = _direct_chats(db_engine)
    assert [(str(chat.id), chat.closed_at) for chat in chats] == [(conversation_id, None)]
    assert published.calls == [({a.id, b.id}, uuid.UUID(conversation_id), "status")]

    a_like, b_like = _pair(db_engine, a.id, b.id)
    for person, other_name, other_photo in ((a, "Bat", person_photo_url(photo)), (b, "Avi", None)):
        likes = _likes(person.caller)
        assert (likes["liked_me"], likes["mine"]) == ([], [])
        (match,) = likes["matches"]
        assert set(match) == {"conversation_id", "display_name", "photo_url", "matched_at"}
        assert (match["conversation_id"], match["display_name"], match["photo_url"]) == (
            conversation_id,
            other_name,
            other_photo,
        )
        assert dt.datetime.fromisoformat(match["matched_at"]) == max(a_like, b_like)
    assert "Bat" not in _names(a.caller)
    assert "Avi" not in _names(b.caller)
    _ok(_send(a.caller, conversation_id, "hi"), 201)
    _ok(_send(b.caller, conversation_id, "hello"), 201)

    # Two crossing likes on two connections: each upsert holds the pair's lock a moment before
    # it commits, so the second waits for the first.
    c = _person(client, db_engine, gush_dan, "Cam")
    d = _person(client, db_engine, gush_dan, "Dor")
    published.calls.clear()

    def hold_lock(_conn: Any, _cursor: Any, statement: str, *_: Any) -> None:
        if statement.startswith("INSERT INTO person_pairs"):
            time.sleep(0.3)

    event.listen(db_engine, "after_cursor_execute", hold_lock)
    start = threading.Barrier(2, timeout=10)
    outcomes: list[Any] = [None, None]

    def liker(index: int, me: uuid.UUID, card: uuid.UUID) -> Callable[[], None]:
        def run() -> None:
            with get_sessionmaker()() as db:
                user = db.get(User, me)
                assert user is not None
                start.wait()
                try:
                    outcomes[index] = market_service.like(db, get_redis(), user, card)
                except Exception as exc:  # pragma: no cover - reported by the assertions
                    outcomes[index] = repr(exc)

        return run

    threads = [
        threading.Thread(target=liker(0, c.id, d.card)),
        threading.Thread(target=liker(1, d.id, c.card)),
    ]
    try:
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=15)
    finally:
        event.remove(db_engine, "after_cursor_execute", hold_lock)
    opened = [outcome for outcome in outcomes if outcome is not None]
    assert len(opened) == 1, outcomes
    assert isinstance(opened[0], uuid.UUID), outcomes
    assert len(published.calls) == 1
    assert published.calls[0] == ({c.id, d.id}, opened[0], "status")
    assert len(_direct_chats(db_engine)) == 2
    assert None not in _pair(db_engine, c.id, d.id)


# --- AC7 ---------------------------------------------------------------------------------------


def test_ac7_unlike(client: TestClient, db_engine: Engine, gush_dan: uuid.UUID) -> None:
    a = _person(client, db_engine, gush_dan, "Avi")
    b = _person(client, db_engine, gush_dan, "Bat")
    _ok(_like(a.caller, b.card))
    assert _like_names(b.caller)["liked_me"] == ["Avi"]

    response = _unlike(a.caller, b.card)
    assert response.status_code == 204
    assert response.content == b""
    assert _like_names(b.caller) == {"liked_me": [], "mine": [], "matches": []}
    (avi,) = (item for item in _page(b.caller)["items"] if item["display_name"] == "Avi")
    assert avi["liked_me"] is False
    assert _pair(db_engine, a.id, b.id) == (None, None)
    assert _unlike(a.caller, b.card).status_code == 204  # again: nothing to clear
    assert _unlike(a.caller, uuid.uuid4()).status_code == 204
    assert _unlike(a.caller, a.card).status_code == 204
    assert _unlike(a.caller, "not-a-uuid").status_code == 422
    assert client.delete(f"/people/{b.card}/like").status_code == 401

    # A one-sided like of the other person stays theirs: B liked A, A's unlike clears only A's.
    _ok(_like(b.caller, a.card))
    assert _unlike(a.caller, b.card).status_code == 204
    assert _pair(db_engine, a.id, b.id)[1] is not None

    c = _person(client, db_engine, gush_dan, "Cam")
    d = _person(client, db_engine, gush_dan, "Dor")
    _ok(_like(c.caller, d.card))
    conversation_id = _ok(_like(d.caller, c.card))["conversation_id"]
    before = _pair(db_engine, c.id, d.id)
    response = _unlike(d.caller, c.card)
    assert response.status_code == 409
    assert response.json() == {"detail": "mutual_match"}
    assert _pair(db_engine, c.id, d.id) == before
    assert [(str(chat.id), chat.closed_at) for chat in _direct_chats(db_engine)] == [
        (conversation_id, None)
    ]


# --- AC8 ---------------------------------------------------------------------------------------


def test_ac8_remove_match_and_rematch(
    client: TestClient, db_engine: Engine, gush_dan: uuid.UUID, published: Published
) -> None:
    a = _person(client, db_engine, gush_dan, "Avi")
    b = _person(client, db_engine, gush_dan, "Bat")
    _ok(_like(a.caller, b.card))
    conversation_id = _ok(_like(b.caller, a.card))["conversation_id"]
    _ok(_send(a.caller, conversation_id, "before"), 201)
    published.calls.clear()

    response = _remove(b.caller, conversation_id)
    assert response.status_code == 204
    assert response.content == b""
    assert _pair(db_engine, a.id, b.id) == (None, None)
    (chat,) = _direct_chats(db_engine)
    assert chat.closed_at is not None
    for person in (a, b):
        thread = _ok(person.caller.get(f"/conversations/{conversation_id}"))
        assert thread["can_send"] is False
        assert [message["body"] for message in thread["messages"]] == ["before"]
        closed = _send(person.caller, conversation_id)
        assert closed.status_code == 409
        assert closed.json() == CHAT_CLOSED
    assert published.calls == [({a.id, b.id}, uuid.UUID(conversation_id), "status")]
    assert "Bat" in _names(a.caller)
    assert "Avi" in _names(b.caller)
    assert _like_names(a.caller) == {"liked_me": [], "mine": [], "matches": []}
    published.calls.clear()
    assert _remove(b.caller, conversation_id).status_code == 204  # again
    assert published.calls == []  # nothing was removed, nothing published

    # A one-sided re-like never reopens the chat.
    assert _ok(_like(a.caller, b.card)) == {"liked": True, "conversation_id": None}
    (chat,) = _direct_chats(db_engine)
    assert chat.closed_at is not None
    assert _send(a.caller, conversation_id).json() == CHAT_CLOSED
    # A repeated removal keeps that newer like.
    assert _remove(b.caller, conversation_id).status_code == 204
    a_like, b_like = _pair(db_engine, a.id, b.id)
    assert (a_like is not None, b_like) == (True, None)
    assert _like_names(b.caller)["liked_me"] == ["Avi"]

    # Both like again: the same chat comes back, with its history, and sending works.
    rematch = _ok(_like(b.caller, a.card))
    assert rematch == {"liked": True, "conversation_id": conversation_id}
    (chat,) = _direct_chats(db_engine)
    assert chat.closed_at is None
    _ok(_send(b.caller, conversation_id, "again"), 201)
    assert [
        m["body"] for m in _ok(a.caller.get(f"/conversations/{conversation_id}"))["messages"]
    ] == [
        "before",
        "again",
    ]

    c = _person(client, db_engine, gush_dan, "Cam")
    owner_id = make_seeker(db_engine, "owner@example.com", "Owner")
    room = _live_room(db_engine, owner_id, gush_dan)
    application_id = make_application(db_engine, room, a.id, status="shortlisted")
    _execute(
        db_engine,
        "INSERT INTO conversations (id, application_id, owner_id, seeker_id)"
        " VALUES (:a, :a, :o, :s)",
        a=application_id,
        o=owner_id,
        s=a.id,
    )
    for caller, target in (
        (c.caller, conversation_id),
        (a.caller, uuid.uuid4()),
        (a.caller, application_id),
    ):
        response = _remove(caller, target)
        assert response.status_code == 404, target
        assert response.json() == NOT_FOUND
    assert _remove(a.caller, "not-a-uuid").status_code == 422
    assert client.delete(f"/me/matches/{conversation_id}").status_code == 401
    (chat,) = _direct_chats(db_engine)
    assert chat.closed_at is None


# --- AC9 ---------------------------------------------------------------------------------------


def test_ac9_like_guards(client: TestClient, db_engine: Engine, gush_dan: uuid.UUID) -> None:
    b = _person(client, db_engine, gush_dan, "Bat")
    lister = _person(client, db_engine, gush_dan, "Lis", card=False)
    _live_room(db_engine, lister.id, gush_dan)
    assert _browse(lister.caller).json() == CARD_REQUIRED  # a live room is no ticket
    response = _like(lister.caller, b.card)
    assert response.status_code == 403
    assert response.json() == CARD_REQUIRED
    assert _like_count(lister.id) == 1
    assert _pair(db_engine, lister.id, b.id) is None
    assert client.put(f"/people/{b.card}/like").status_code == 401

    v = _person(client, db_engine, gush_dan, "Vic")
    hidden = _person(client, db_engine, gush_dan, "Hid")
    _hide(db_engine, hidden.id)
    misfit = _person(client, db_engine, gush_dan, "Mis", gender="man", pref="men")
    for n, card in enumerate((hidden.card, misfit.card, v.card, uuid.uuid4()), start=1):
        response = _like(v.caller, card)
        assert response.status_code == 404, card
        assert response.json() == NOT_FOUND
        assert _like_count(v.id) == n
    assert _scalar(db_engine, "SELECT count(*) FROM person_pairs") == 0
    assert _like(v.caller, "not-a-uuid").status_code == 422

    # Shared with the lister's like in a room's people browse (`rl:like:user:*`; spec 0010l: the
    # seeker's room-like is gone).
    room = _live_room(db_engine, v.id, gush_dan)
    person = make_pair(db_engine, room, b.id, price_ils_seen=7200)
    assert _ok(v.caller.put(f"/listings/{room}/people/{person}/like")) == {"liked": True}
    assert _like_count(v.id) == 5
    while _like_count(v.id) < people_service.LIKE_RATE_LIMIT_HOUR:
        _ok(_like(v.caller, b.card))
    limited = _like(v.caller, b.card)
    assert limited.status_code == 429
    assert limited.json() == {"detail": "rate_limited"}
    assert int(limited.headers["Retry-After"]) > 0
    assert _like_count(v.id) == people_service.LIKE_RATE_LIMIT_HOUR


# --- AC10 --------------------------------------------------------------------------------------


def test_ac10_hidden_card(
    client: TestClient, db_engine: Engine, gush_dan: uuid.UUID, published: Published
) -> None:
    a = _person(client, db_engine, gush_dan, "Avi")
    b = _person(client, db_engine, gush_dan, "Bat")
    e = _person(client, db_engine, gush_dan, "Eli")
    m = _person(client, db_engine, gush_dan, "Mat")
    _ok(_like(b.caller, a.card))  # B in A's liked_me
    _ok(_like(a.caller, e.card))  # E in A's mine
    _ok(_like(a.caller, m.card))
    conversation_id = _ok(_like(m.caller, a.card))["conversation_id"]
    assert _like_names(a.caller) == {"liked_me": ["Bat"], "mine": ["Eli"], "matches": ["Mat"]}

    for person in (b, e, m):
        _ok(
            person.caller.put(
                "/me/profile", json=_p(gush_dan, gender="woman", people_visible=False)
            )
        )
    assert _names(a.caller) == []
    assert _like_names(a.caller) == {"liked_me": [], "mine": [], "matches": ["Mat"]}
    response = _like(a.caller, b.card)
    assert response.status_code == 404
    assert response.json() == NOT_FOUND
    assert _browse(b.caller).json() == CARD_REQUIRED
    assert b.caller.get("/me/people-likes").json() == CARD_REQUIRED
    # The match and its chat stay.
    (chat,) = _direct_chats(db_engine)
    assert chat.closed_at is None
    _ok(_send(a.caller, conversation_id), 201)
    _ok(_send(m.caller, conversation_id), 201)
    # A live room does not give B the ticket back (spec 0010m): no browse, no like.
    _live_room(db_engine, b.id, gush_dan)
    assert _browse(b.caller).json() == CARD_REQUIRED
    assert _like(b.caller, a.card).json() == CARD_REQUIRED


# --- AC11 --------------------------------------------------------------------------------------


def test_ac11_browse_rate_limit(client: TestClient, db_engine: Engine, gush_dan: uuid.UUID) -> None:
    a = _person(client, db_engine, gush_dan, "Avi", card=False)
    refused = 10
    for _ in range(refused):
        assert _browse(a.caller).status_code == 403
    assert _browse_count(a.id) == refused
    make_card(db_engine, a.id, gush_dan, gender="woman")
    for n in range(market_service.BROWSE_RATE_LIMIT_HOUR - refused):
        assert _browse(a.caller).status_code == 200, n
    limited = _browse(a.caller)
    assert limited.status_code == 429
    assert limited.json() == {"detail": "rate_limited"}
    assert int(limited.headers["Retry-After"]) > 0
    assert _browse_count(a.id) == market_service.BROWSE_RATE_LIMIT_HOUR
    day = int(get_redis().get(f"rl:browse:user:day:{a.id}") or 0)
    assert day == market_service.BROWSE_RATE_LIMIT_HOUR
    assert a.caller.get("/people", params={"offset": 20}).status_code == 429


# --- AC12b (orchestrator, 2026-11-14): the listing page's people share the browse limit ---------


def test_ac12b_listing_page_people_share_browse_limit(
    client: TestClient, db_engine: Engine, gush_dan: uuid.UUID
) -> None:
    owner_id = make_owner(db_engine, "owner@example.com")  # the owner role: not a seeker
    owner = _login(client, db_engine, owner_id)
    room = _live_room(db_engine, owner_id, gush_dan, gender_preference="any")
    apartment = make_listing(db_engine, owner_id, gush_dan)
    mate = make_seeker(db_engine, "mate@example.com", "Fay")
    make_profile(db_engine, mate, gush_dan, gender="woman")
    make_flatmate(db_engine, room, mate, shown=True)
    seeker = _person(client, db_engine, gush_dan, "Sek", card=False)  # the seeker role

    def browse_keys() -> int:
        return len(list(get_redis().scan_iter(match="rl:browse:*")))

    body = _ok(seeker.caller.get(f"/listings/{room}"))
    assert [person["display_name"] for person in body["people"]] == ["Fay"]
    assert _browse_count(seeker.id) == 1
    keys = browse_keys()

    # Nothing else counts: a visitor, the owner, an apartment.
    assert _ok(client.get(f"/listings/{room}"))["people"] == []
    assert _ok(owner.get(f"/listings/{room}"))["people"] == []
    assert _ok(seeker.caller.get(f"/listings/{apartment}"))["people"] == []
    assert browse_keys() == keys
    assert _browse_count(seeker.id) == 1
    assert _browse_count(owner_id) == 0

    get_redis().set(f"rl:browse:user:{seeker.id}", market_service.BROWSE_RATE_LIMIT_HOUR, ex=3600)
    limited = _ok(seeker.caller.get(f"/listings/{room}"))
    assert limited["people"] == []
    assert {k: v for k, v in limited.items() if k != "people"} == {
        k: v for k, v in body.items() if k != "people"
    }
    assert _browse(seeker.caller).status_code == 429  # the same counter


def test_ac12b_listing_page_people_fail_closed_without_redis(
    client: TestClient,
    db_engine: Engine,
    gush_dan: uuid.UUID,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner_id = make_owner(db_engine, "owner@example.com")
    room = _live_room(db_engine, owner_id, gush_dan, gender_preference="any")
    mate = make_seeker(db_engine, "mate@example.com", "Fay")
    make_profile(db_engine, mate, gush_dan, gender="woman")
    make_flatmate(db_engine, room, mate, shown=True)
    seeker = _person(client, db_engine, gush_dan, "Sek", card=False)

    def down(*_: Any, **__: Any) -> None:
        raise redis.exceptions.ConnectionError("redis is down")

    monkeypatch.setattr(market_service, "count_browse", down)
    assert _ok(seeker.caller.get(f"/listings/{room}"))["people"] == []


# --- AC13 --------------------------------------------------------------------------------------


def _pair_scans(
    plan: dict[str, Any], parent: str | None = None
) -> Iterator[tuple[str | None, dict[str, Any]]]:
    """Every scan of `person_pairs` (under any alias) in an `EXPLAIN (FORMAT JSON)` tree, with its
    parent's node type."""
    if plan.get("Relation Name") == "person_pairs":
        yield parent, plan
    for child in plan.get("Plans", []):
        yield from _pair_scans(child, plan["Node Type"])


def _explain(engine: Engine, statement: Any) -> dict[str, Any]:
    compiled = statement.compile(dialect=engine.dialect)
    with engine.connect() as conn:
        conn.exec_driver_sql("SET LOCAL enable_seqscan = off")
        (plan,) = conn.exec_driver_sql(
            "EXPLAIN (FORMAT JSON) " + str(compiled), compiled.params
        ).scalar_one()
        conn.rollback()
    result: dict[str, Any] = plan["Plan"]
    return result


def test_ac13_statement_counts_and_plan(
    client: TestClient,
    db_engine: Engine,
    gush_dan: uuid.UUID,
    statements: list[str],
    published: Published,
) -> None:
    a = _person(client, db_engine, gush_dan, "Avi")
    b = _person(client, db_engine, gush_dan, "Bat")
    for n in range(30):
        other = make_seeker(db_engine, f"p{n}@example.com", f"P{n:02d}")
        make_card(db_engine, other, gush_dan, gender="woman")
        if n % 3 == 0:
            make_person_like(db_engine, other, a.id)
    a.caller.get("/me")  # warm-up: a first connect sends its own setup statements
    b.caller.get("/me")

    def measure(call: Callable[[], httpx.Response]) -> list[str]:
        statements.clear()
        _ok(call())
        return list(statements)

    assert len(measure(lambda: _browse(a.caller))) == 3  # session, viewer, page
    assert len(measure(lambda: a.caller.get("/me/people-likes"))) == 3  # session, viewer, list
    liked = measure(lambda: _like(a.caller, b.card))
    # session, the live-account lock (spec 0013c), viewer, the checking upsert
    assert len(liked) == 4, liked
    assert "FOR KEY SHARE" in liked[1], liked
    assert liked[3].startswith("INSERT INTO person_pairs")
    mutual = measure(lambda: _like(b.caller, a.card))
    assert len(mutual) == 5, mutual  # plus `open_direct`
    assert mutual[4].startswith("INSERT INTO conversations")

    # Plan on production-shaped statistics: most pairs are other people's (here every pair among
    # the others, hundreds of rows beside the viewer's eleven), then ANALYZE, so the plan does not
    # hang on when autovacuum last ran. On a table holding only the viewer's pairs, reading it
    # whole is the planner's cheapest plan, which flipped this test in CI (PR #111).
    with db_engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO person_pairs (user_low, user_high, low_liked_at)"
                " SELECT l.user_id, h.user_id, now() FROM seeker_profiles l"
                " JOIN seeker_profiles h ON l.user_id < h.user_id"
                " WHERE NOT (l.user_id = ANY(:people) OR h.user_id = ANY(:people))"
            ),
            {"people": [a.id, b.id]},
        )
        conn.execute(text("ANALYZE person_pairs"))
    with Session(db_engine) as db:
        user = db.get(User, a.id)
        assert user is not None
        viewer = market_service._viewer(db, user)
    for statement in (
        market_service.browse_statement(viewer, 0),
        market_service.likes_statement(viewer),
    ):
        scans = list(_pair_scans(_explain(db_engine, statement)))
        assert scans
        for parent, scan in scans:
            # With sequential scans priced out, every read of `person_pairs` must be bounded by
            # an index: an index scan with a condition on its own indexes, or a bitmap scan. A
            # seq scan may only build a hash join, never sit inside a nested loop.
            if scan["Node Type"] == "Seq Scan":
                assert parent == "Hash", scan
            elif scan["Node Type"] in ("Index Scan", "Index Only Scan"):
                assert scan["Index Name"] in PAIR_INDEXES, scan
                assert "Index Cond" in scan, scan
            else:
                assert scan["Node Type"] == "Bitmap Heap Scan", scan
