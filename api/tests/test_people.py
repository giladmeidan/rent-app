"""People browse and likes (spec 0008a): AC1-AC12 (AC13 is in `test_profiles.py`, AC14 in
`test_migrations.py`, AC15 the amended asserts in `test_inbox.py`, `test_applications.py` and
`test_listings.py`).

`R` is `test_matching`'s `L0` as a women-only room for two flatmates, owned by the signed-up owner
`O`. A seeker profile is `make_profile`'s `P0` (which scores 100 against `L0`) plus a room section
(`gender`) and, unless a test says otherwise, `people_visible`. Every date is UTC, as the
database's `current_date` is."""

import datetime as dt
import threading
import time
import uuid
from collections.abc import Callable, Iterator
from functools import partial
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, event, select, text
from sqlalchemy.orm import Session

from app.db import get_sessionmaker
from app.matching.score import explain_row, match_columns
from app.models import Listing, SeekerProfile, User
from app.redis_client import get_redis
from app.schemas.people import PersonOut
from app.services import applications as applications_service
from app.services import chat_events
from app.services import people as people_service
from app.services.applications import AlreadyAppliedError
from tests.conftest import (
    Outbox,
    make_application,
    make_owner,
    make_pair,
    make_profile,
    make_seeker,
    signup,
)
from tests.test_matching import _area, _l0, _user_id

pytestmark = pytest.mark.usefixtures("redis_clean")

NOT_FOUND = {"detail": "not_found"}
ALREADY_APPLIED = {"detail": "already_applied"}
PERSON_KEYS = {
    "id",
    "display_name",
    "photo_url",  # 0010j
    "gender",
    "age",
    "area_ids",
    "move_in_date",
    "move_in_flexible",
    "lifestyle",
    "about_me",
    "match",
    "liked_by_me",
    "liked_me",
}
NO_LIKE = {"liked_by_me": False, "liked_me": False}


def _scalar(engine: Engine, sql: str, **params: Any) -> Any:
    with engine.connect() as conn:
        return conn.execute(text(sql), params).scalar()


def _execute(engine: Engine, sql: str, **params: Any) -> None:
    with engine.begin() as conn:
        conn.execute(text(sql), params)


def _room(engine: Engine, owner_id: uuid.UUID, area: uuid.UUID, **overrides: Any) -> str:
    """`R`: `L0` as a room for two flatmates, women only unless overridden."""
    values: dict[str, Any] = {
        "listing_type": "room",
        "flatmates_count": 2,
        "gender_preference": "women",
        **overrides,
    }
    return _l0(engine, owner_id, area, **values)


def _visible(engine: Engine, user_id: uuid.UUID, area: uuid.UUID, **overrides: Any) -> None:
    """`P0` with a woman's room section, opted in to people browse unless overridden."""
    values: dict[str, Any] = {"gender": "woman", "people_visible": True, **overrides}
    make_profile(engine, user_id, area, **values)


def _set_visible(engine: Engine, user_id: uuid.UUID, visible: bool) -> None:
    _execute(
        engine,
        "UPDATE seeker_profiles SET people_visible = :v WHERE user_id = :id",
        v=visible,
        id=user_id,
    )


def _seeker(
    client: TestClient,
    outbox: Outbox,
    engine: Engine,
    area: uuid.UUID,
    email: str,
    name: str = "Avi",
    **profile: Any,
) -> TestClient:
    """A signed-up seeker named `name` with `_visible`'s profile (`profile` overrides)."""
    caller = signup(client, outbox, email, "seeker", display_name=name)
    _visible(engine, _user_id(caller), area, **profile)
    return caller


def _people(caller: TestClient, listing_id: Any, offset: int | None = None) -> httpx.Response:
    params = {} if offset is None else {"offset": offset}
    response: httpx.Response = caller.get(f"/listings/{listing_id}/people", params=params)
    return response


def _page(caller: TestClient, listing_id: Any, offset: int | None = None) -> dict[str, Any]:
    response = _people(caller, listing_id, offset)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def _names(body: dict[str, Any]) -> list[str]:
    return [item["display_name"] for item in body["items"]]


def _card(caller: TestClient, listing_id: Any, name: str) -> dict[str, Any]:
    cards = [item for item in _page(caller, listing_id)["items"] if item["display_name"] == name]
    assert len(cards) == 1, name
    card: dict[str, Any] = cards[0]
    return card


def _like_person(caller: TestClient, listing_id: Any, person_id: Any) -> httpx.Response:
    response: httpx.Response = caller.put(f"/listings/{listing_id}/people/{person_id}/like")
    return response


def _unlike_person(caller: TestClient, listing_id: Any, person_id: Any) -> httpx.Response:
    response: httpx.Response = caller.delete(f"/listings/{listing_id}/people/{person_id}/like")
    return response


def _like_room(caller: TestClient, listing_id: Any) -> httpx.Response:
    response: httpx.Response = caller.put(f"/listings/{listing_id}/like")
    return response


def _ok(response: httpx.Response) -> Any:
    assert response.status_code == 200, response.text
    return response.json()


def _likes(caller: TestClient) -> dict[str, list[str]]:
    """`GET /me/likes` as listing ids per list."""
    body = _ok(caller.get("/me/likes"))
    assert set(body) == {"liked_me", "mine"}
    return {key: [item["listing"]["id"] for item in body[key]] for key in body}


def _pair(engine: Engine, listing_id: Any, seeker_id: uuid.UUID) -> Any:
    with engine.connect() as conn:
        return conn.execute(
            text(
                "SELECT id, price_ils_seen, lister_liked_at, seeker_liked_at FROM room_pairs"
                " WHERE listing_id = :l AND seeker_id = :s"
            ),
            {"l": str(listing_id), "s": seeker_id},
        ).one_or_none()


def _pair_count(engine: Engine) -> int:
    count: int = _scalar(engine, "SELECT count(*) FROM room_pairs")
    return count


def _application(engine: Engine, application_id: Any) -> Any:
    with engine.connect() as conn:
        return conn.execute(
            text(
                "SELECT id, listing_id, seeker_id, source, message, status, price_ils_at_apply,"
                " listing_type_at_apply, created_at FROM applications WHERE id = :id"
            ),
            {"id": str(application_id)},
        ).one()


def _conversation(engine: Engine, application_id: Any) -> Any:
    with engine.connect() as conn:
        return conn.execute(
            text(
                "SELECT application_id, owner_id, seeker_id, owner_read_at, seeker_read_at"
                " FROM conversations WHERE application_id = :id"
            ),
            {"id": str(application_id)},
        ).one_or_none()


def _expected_match(engine: Engine, listing_id: Any, seeker_id: uuid.UUID) -> dict[str, Any]:
    """`match_columns` for the listing (at its live price) and the seeker's profile."""
    with Session(engine) as db:
        row = db.execute(
            select(*match_columns(Listing, SeekerProfile))
            .select_from(Listing)
            .join(SeekerProfile, SeekerProfile.user_id == seeker_id)
            .where(Listing.id == uuid.UUID(str(listing_id)))
        ).one()
    return explain_row(row).model_dump()


@pytest.fixture
def owner(client: TestClient, outbox: Outbox) -> TestClient:
    return signup(client, outbox, "o@example.com", "owner", display_name="Owner")


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
def published(monkeypatch: pytest.MonkeyPatch) -> list[tuple[list[uuid.UUID], uuid.UUID, str]]:
    """Every `chat_events.publish` call, as (user ids, conversation id, kind); nothing is sent."""
    calls: list[tuple[list[uuid.UUID], uuid.UUID, str]] = []

    def record(_r: Any, user_ids: Any, conversation_id: uuid.UUID, kind: str) -> None:
        calls.append((list(user_ids), conversation_id, kind))

    monkeypatch.setattr(chat_events, "publish", record)
    return calls


def test_ac1_candidates_and_order(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    room = _room(db_engine, _user_id(owner), gush_dan)
    a = make_seeker(db_engine, "a@example.com", "Avi")
    _visible(db_engine, a, gush_dan)
    b = _seeker(client, outbox, db_engine, gush_dan, "b@example.com", "Bat", people_visible=False)
    c = make_seeker(db_engine, "c@example.com", "Cam")
    _visible(db_engine, c, gush_dan, gender="man")  # R is women-only
    d = make_seeker(db_engine, "d@example.com", "Dan")
    _visible(db_engine, d, gush_dan)
    make_application(db_engine, uuid.UUID(room), d)
    # No room section (no gender) cannot opt in at all (`ck_seeker_profiles_room_section`).

    body = _page(owner, room)

    assert _names(body) == ["Avi"]
    assert body["total"] == 1
    card = body["items"][0]
    assert set(card) == PERSON_KEYS
    assert card["id"] == str(_pair(db_engine, room, a).id)
    assert card["match"] == _expected_match(db_engine, room, a)
    assert card["match"] == {"score": 100, "agrees": ["budget", "move_in", "area"], "differs": None}
    assert (card["liked_by_me"], card["liked_me"]) == (False, False)

    assert _ok(_like_room(b, room)) == {"liked": True, "application_id": None}
    body = _page(owner, room)
    assert _names(body) == ["Bat", "Avi"]
    assert body["total"] == 2
    assert [(item["liked_me"], item["liked_by_me"]) for item in body["items"]] == [
        (True, False),
        (False, False),
    ]

    north = _area(db_engine, "north", active=True)
    g = make_seeker(db_engine, "g@example.com", "Gal")
    _visible(db_engine, g, gush_dan, area_ids=[north])  # wants only another area
    body = _page(owner, room)
    assert _names(body) == ["Bat", "Avi", "Gal"]
    assert body["items"][2]["match"]["differs"] == "area"
    assert body["items"][2]["match"]["score"] <= 59


def test_ac2_price_frozen_per_pair(
    owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    room = _room(db_engine, _user_id(owner), gush_dan, price_ils=4500)
    a = make_seeker(db_engine, "a@example.com", "Avi")
    _visible(db_engine, a, gush_dan, budget_max_ils=5000)

    first = _card(owner, room, "Avi")["match"]
    assert "budget" in first["agrees"]

    patched = owner.patch(f"/listings/{room}", json={"price_ils": 6000})
    assert patched.status_code == 200, patched.text
    assert _card(owner, room, "Avi")["match"] == first
    assert _pair(db_engine, room, a).price_ils_seen == 4500

    e = make_seeker(db_engine, "e@example.com", "Eden")
    _visible(db_engine, e, gush_dan, budget_max_ils=5000)
    late = _card(owner, room, "Eden")["match"]
    assert _pair(db_engine, room, e).price_ils_seen == 6000
    assert late["differs"] == "budget"
    assert late["score"] <= 59
    assert _card(owner, room, "Avi")["match"] == first  # still frozen


def test_ac3_card_fields_only(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    room = _room(db_engine, _user_id(owner), gush_dan)
    a = make_seeker(db_engine, "a@example.com", "Avi")
    _visible(
        db_engine,
        a,
        gush_dan,
        birth_year=dt.datetime.now(dt.UTC).year - 30,
        flatmate_gender="women",
        lifestyle={"night": 3, "kosher": 2},
        about_me="Quiet, tidy, loves plants",
        has_pets=True,
        smoker=True,
    )
    descriptions: list[list[str]] = []
    sql: list[str] = []

    def record(_conn: Any, cursor: Any, statement: str, *_: Any) -> None:
        sql.append(statement)
        if cursor.description is not None:
            descriptions.append([column.name for column in cursor.description])

    owner.get("/me")  # warm-up
    event.listen(db_engine, "after_cursor_execute", record)
    try:
        response = _people(owner, room)
    finally:
        event.remove(db_engine, "after_cursor_execute", record)

    assert response.status_code == 200, response.text
    card = response.json()["items"][0]
    assert set(card) == PERSON_KEYS == set(PersonOut.model_fields)
    for hidden in (
        "budget_max_ils",
        "household",
        "has_pets",
        "smoker",
        "contract_months",
        "parking_needed",
        "flatmate_gender",
        "seeker_id",
        "user_id",
        "email",
    ):
        assert hidden not in card
    assert "a@example.com" not in response.text
    assert str(a) not in response.text
    assert card["age"] == 30
    assert card["gender"] == "woman"
    assert card["lifestyle"] == {"night": 3, "kosher": 2}
    assert card["about_me"] == "Quiet, tidy, loves plants"
    assert card["area_ids"] == [str(gush_dan)]
    assert descriptions, sql
    for columns in descriptions:
        assert "budget_max_ils" not in columns
        assert "flatmate_gender" not in columns
        assert "household" not in columns
    # The entity's own column list, as `select(..., SeekerProfile)` compiles it (its first two
    # columns, in model order). The match reads the budget inside its expressions
    # (`... > seeker_profiles.budget_max_ils AS f_budget`), as expected.
    assert any("seeker_profiles.about_me" in statement for statement in sql), sql
    for statement in sql:
        assert "seeker_profiles.user_id, seeker_profiles.budget_max_ils" not in statement


def test_ac4_people_errors(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    owner_id = _user_id(owner)
    room = _room(db_engine, owner_id, gush_dan)
    a = make_seeker(db_engine, "a@example.com", "Avi")
    _visible(db_engine, a, gush_dan)
    apartment = _l0(db_engine, owner_id, gush_dan)
    other_room = _room(db_engine, make_owner(db_engine, "o2@example.com"), gush_dan)
    seeker = signup(client, outbox, "s@example.com", "seeker")

    anonymous = _people(client, room)
    assert anonymous.status_code == 401
    assert anonymous.json() == {"detail": "unauthenticated"}
    unknown = _people(owner, uuid.uuid4())
    # Spec 0010b: no role gate; a seeker on another's room is the unknown id's 404.
    not_theirs = _people(seeker, room)
    assert not_theirs.status_code == 404
    assert not_theirs.content == unknown.content
    for listing_id in (other_room, apartment):
        response = _people(owner, listing_id)
        assert response.status_code == 404, listing_id
        assert response.content == unknown.content
    assert unknown.json() == NOT_FOUND

    _execute(db_engine, "UPDATE listings SET status = 'paused' WHERE id = :id", id=room)
    paused = _people(owner, room)
    assert paused.status_code == 409
    assert paused.json() == {"detail": "listing_not_live"}
    _execute(
        db_engine,
        "UPDATE listings SET status = 'active', expires_at = now() - interval '1 hour'"
        " WHERE id = :id",
        id=room,
    )
    assert _people(owner, room).json() == {"detail": "listing_not_live"}
    _execute(
        db_engine,
        "UPDATE listings SET expires_at = now() + interval '1 day' WHERE id = :id",
        id=room,
    )
    assert _pair_count(db_engine) == 0  # a refused browse snapshots nothing

    assert _people(owner, room, 1001).status_code == 422
    assert _people(owner, room, -1).status_code == 422
    assert _people(owner, "not-a-uuid").status_code == 422
    assert _page(owner, room, 1000)["items"] == []
    assert _page(owner, room, 40) == {"items": [], "total": 1}
    assert _page(owner, room)["total"] == 1


def test_ac5_statements_and_paging(
    owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine, statements: list[str]
) -> None:
    room = _room(db_engine, _user_id(owner), gush_dan)
    for n in range(30):
        seeker_id = make_seeker(db_engine, f"s{n}@example.com", f"S{n:02d}")
        # Different move-in dates give different scores, so the order is by score, not by row.
        _visible(
            db_engine,
            seeker_id,
            gush_dan,
            move_in_date=dt.datetime.now(dt.UTC).date() + dt.timedelta(days=30 + n),
        )

    owner.get("/me")  # warm-up: a first connect sends its own setup statements
    pages: list[dict[str, Any]] = []
    for offset in (0, 20):
        before = _pair_count(db_engine)
        statements.clear()
        pages.append(_page(owner, room, offset))
        sent = list(statements)
        assert len(sent) == 4, sent  # session, listing, snapshot, page
        assert sent[2].startswith("INSERT INTO room_pairs"), sent[2]
        assert "count(*) OVER ()" in sent[3]
        assert _pair_count(db_engine) == 30
        if offset == 20:
            assert before == 30  # the second GET inserted no new pairs

    first, second = pages
    assert (len(first["items"]), len(second["items"])) == (20, 10)
    assert first["total"] == second["total"] == 30
    ids = [item["id"] for item in (*first["items"], *second["items"])]
    assert len(set(ids)) == 30
    scores = [item["match"]["score"] for item in (*first["items"], *second["items"])]
    assert scores == sorted(scores, reverse=True)
    assert _names(first)[0] == "S00"

    statements.clear()
    empty = _page(owner, room, 40)
    sent = list(statements)
    assert empty == {"items": [], "total": 30}
    assert len(sent) == 5, sent  # plus the count


def test_ac6_lister_like_unlike(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
    published: list[Any],
) -> None:
    owner_id = _user_id(owner)
    room = _room(db_engine, owner_id, gush_dan)
    other = _room(db_engine, owner_id, gush_dan)
    a = _seeker(client, outbox, db_engine, gush_dan, "a@example.com", "Avi")
    a_id = _user_id(a)
    person = _card(owner, room, "Avi")["id"]

    assert _ok(_like_person(owner, room, person)) == {"liked": True, "application_id": None}
    assert _card(owner, room, "Avi")["liked_by_me"] is True
    assert _likes(a) == {"liked_me": [room], "mine": []}
    # spec 0010d: every liked room carries its cover photo, null without photos.
    assert _ok(a.get("/me/likes"))["liked_me"][0]["listing"]["cover"] is None
    liked_at = _pair(db_engine, room, a_id).lister_liked_at
    assert liked_at is not None

    assert _ok(_like_person(owner, room, person)) == {"liked": True, "application_id": None}
    assert _pair(db_engine, room, a_id).lister_liked_at == liked_at  # a second PUT changes nothing

    unliked = _unlike_person(owner, room, person)
    assert unliked.status_code == 204
    assert _likes(a) == {"liked_me": [], "mine": []}
    assert _card(owner, room, "Avi")["liked_by_me"] is False

    other_person = _card(owner, other, "Avi")["id"]
    for listing_id, person_id in ((room, other_person), (other, person), (room, uuid.uuid4())):
        response = _like_person(owner, listing_id, person_id)
        assert response.status_code == 404, (listing_id, person_id)
        assert response.json() == NOT_FOUND
        assert _unlike_person(owner, listing_id, person_id).status_code == 404
    stranger = signup(client, outbox, "o2@example.com", "owner")
    assert _like_person(stranger, room, person).json() == NOT_FOUND
    assert _unlike_person(stranger, room, person).status_code == 404
    assert _like_person(a, room, person).json() == NOT_FOUND  # spec 0010b: no role gate

    _set_visible(db_engine, a_id, False)
    hidden = _like_person(owner, room, person)
    assert hidden.status_code == 404
    assert hidden.json() == NOT_FOUND
    assert _pair(db_engine, room, a_id).lister_liked_at is None

    _set_visible(db_engine, a_id, True)
    applied = a.post(f"/listings/{room}/applications", json={"message": "Hello there"})
    assert applied.status_code == 201, applied.text
    refused = _like_person(owner, room, person)
    assert refused.status_code == 409
    assert refused.json() == ALREADY_APPLIED
    assert _pair(db_engine, room, a_id).lister_liked_at is None  # rolled back
    assert published == []  # a plain like notifies no one


def _assert_mutual(
    engine: Engine,
    application_id: str,
    room: str,
    seeker_id: uuid.UUID,
    owner_id: uuid.UUID,
    *,
    lister_second: bool,
) -> None:
    """AC7's rows for a mutual like of `seeker_id` and `room`."""
    application = _application(engine, application_id)
    assert (application.source, application.message, application.status) == (
        "like",
        None,
        "shortlisted",
    )
    assert (str(application.listing_id), application.seeker_id) == (room, seeker_id)
    pair = _pair(engine, room, seeker_id)
    assert application.price_ils_at_apply == pair.price_ils_seen
    assert application.listing_type_at_apply == "room"
    conversation = _conversation(engine, application_id)
    assert conversation is not None
    assert (conversation.owner_id, conversation.seeker_id) == (owner_id, seeker_id)
    if lister_second:
        assert (conversation.owner_read_at is not None, conversation.seeker_read_at) == (True, None)
    else:
        assert (conversation.seeker_read_at is not None, conversation.owner_read_at) == (True, None)
    assert (pair.lister_liked_at, pair.seeker_liked_at) == (None, None)


def test_ac7_mutual_becomes_shortlisted_application(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
    published: list[Any],
) -> None:
    owner_id = _user_id(owner)
    room = _room(db_engine, owner_id, gush_dan)
    a = _seeker(client, outbox, db_engine, gush_dan, "a@example.com", "Avi")
    a_id = _user_id(a)
    assert _ok(_like_person(owner, room, _card(owner, room, "Avi")["id"]))["application_id"] is None
    # The pair's frozen price differs from the live one: the application takes the frozen price.
    _execute(db_engine, "UPDATE listings SET price_ils = 6500 WHERE id = :id", id=room)

    liked = _ok(_like_room(a, room))

    assert liked["liked"] is True
    x = liked["application_id"]
    assert x is not None
    _assert_mutual(db_engine, x, room, a_id, owner_id, lister_second=False)
    assert _application(db_engine, x).price_ils_at_apply == 7000
    assert _scalar(db_engine, "SELECT count(*) FROM applications") == 1

    inbox = _ok(owner.get(f"/listings/{room}/applications"))
    assert [(item["id"], item["source"], item["message"]) for item in inbox] == [(x, "like", None)]
    assert inbox[0]["status"] == "shortlisted"
    mine = _ok(a.get("/me/applications"))
    assert [(item["id"], item["source"], item["message"]) for item in mine] == [(x, "like", None)]

    conversations = _ok(a.get("/me/conversations"))
    assert [(item["id"], item["can_send"]) for item in conversations] == [(x, True)]
    sent = a.post(f"/conversations/{x}/messages", json={"body": "Hi!"})
    assert sent.status_code == 201, sent.text

    assert _likes(a) == {"liked_me": [], "mine": []}
    assert _page(owner, room) == {"items": [], "total": 0}
    status_events = [call for call in published if call[2] == "status"]
    assert status_events == [([owner_id, a_id], uuid.UUID(x), "status")]

    # The mirror case: the seeker likes first, the lister second.
    published.clear()
    a2 = _seeker(client, outbox, db_engine, gush_dan, "a2@example.com", "Avi2")
    a2_id = _user_id(a2)
    assert _ok(_like_room(a2, room)) == {"liked": True, "application_id": None}
    assert _likes(a2) == {"liked_me": [], "mine": [room]}
    card = _card(owner, room, "Avi2")
    assert card["liked_me"] is True
    y = _ok(_like_person(owner, room, card["id"]))["application_id"]
    assert y is not None
    _assert_mutual(db_engine, y, room, a2_id, owner_id, lister_second=True)
    assert published == [([owner_id, a2_id], uuid.UUID(y), "status")]
    assert _likes(a2) == {"liked_me": [], "mine": []}


def _in_threads(*calls: Callable[[], str]) -> list[str]:
    """Run each call in its own thread and return their outcomes, in call order."""
    outcomes: list[str] = ["" for _ in calls]

    def run(index: int, call: Callable[[], str]) -> None:
        try:
            outcomes[index] = call()
        except AlreadyAppliedError:
            outcomes[index] = "409"
        except Exception as exc:  # pragma: no cover - reported by the assertions
            outcomes[index] = repr(exc)

    threads = [threading.Thread(target=run, args=(i, call)) for i, call in enumerate(calls)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=15)
    return outcomes


def test_ac8_concurrent_second_likes(
    owner: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner_id = _user_id(owner)
    real_has_application = people_service._has_application

    def slow_has_application(db: Session, listing_id: uuid.UUID, seeker_id: uuid.UUID) -> bool:
        # Runs after the pair's lock is taken: hold it so the other side's write waits on it.
        time.sleep(0.3)
        return real_has_application(db, listing_id, seeker_id)

    monkeypatch.setattr(people_service, "_has_application", slow_has_application)

    def lister(room: str, person: uuid.UUID, start: threading.Barrier) -> Callable[[], str]:
        def call() -> str:
            with get_sessionmaker()() as db:
                user = db.get(User, owner_id)
                assert user is not None
                start.wait()
                application, _ = people_service.like_person(
                    db, get_redis(), user, uuid.UUID(room), person
                )
                return "mutual" if application is not None else "liked"

        return call

    def seeker(
        room: str, seeker_id: uuid.UUID, start: threading.Barrier, delay: float = 0
    ) -> Callable[[], str]:
        def call() -> str:
            with get_sessionmaker()() as db:
                user = db.get(User, seeker_id)
                assert user is not None
                start.wait()
                time.sleep(delay)
                application, _ = people_service.like_room(db, get_redis(), user, uuid.UUID(room))
                return "mutual" if application is not None else "liked"

        return call

    def counts(room: str) -> tuple[int, int]:
        return (
            _scalar(db_engine, "SELECT count(*) FROM applications WHERE listing_id = :l", l=room),
            _scalar(
                db_engine,
                "SELECT count(*) FROM conversations c JOIN applications a"
                " ON a.id = c.application_id WHERE a.listing_id = :l",
                l=room,
            ),
        )

    # The seeker liked first; the lister's like and the seeker's second like run at once.
    for n in range(2):
        room = _room(db_engine, owner_id, gush_dan)
        a = make_seeker(db_engine, f"a{n}@example.com", "Avi")
        _visible(db_engine, a, gush_dan)
        person = make_pair(db_engine, uuid.UUID(room), a, price_ils_seen=7000, seeker_liked=True)
        start = threading.Barrier(2, timeout=10)
        outcomes = _in_threads(lister(room, person, start), seeker(room, a, start))
        assert outcomes.count("mutual") == 1, outcomes
        assert set(outcomes) <= {"mutual", "liked", "409"}, outcomes
        assert counts(room) == (1, 1)
        pair = _pair(db_engine, room, a)
        assert (pair.lister_liked_at, pair.seeker_liked_at) == (None, None)

    # Both first likes at once: exactly one of them is mutual.
    room = _room(db_engine, owner_id, gush_dan)
    b = make_seeker(db_engine, "b@example.com", "Bat")
    _visible(db_engine, b, gush_dan)
    person = make_pair(db_engine, uuid.UUID(room), b, price_ils_seen=7000)
    start = threading.Barrier(2, timeout=10)
    outcomes = _in_threads(lister(room, person, start), seeker(room, b, start))
    assert sorted(outcomes) == ["liked", "mutual"], outcomes
    assert counts(room) == (1, 1)

    # The lister's mutual commits while the seeker's second like waits on the pair's lock.
    room = _room(db_engine, owner_id, gush_dan)
    c = make_seeker(db_engine, "c@example.com", "Cam")
    _visible(db_engine, c, gush_dan)
    person = make_pair(db_engine, uuid.UUID(room), c, price_ils_seen=7000, seeker_liked=True)
    start = threading.Barrier(2, timeout=10)
    outcomes = _in_threads(lister(room, person, start), seeker(room, c, start, delay=0.1))
    assert outcomes == ["mutual", "409"], outcomes
    assert counts(room) == (1, 1)
    pair = _pair(db_engine, room, c)
    assert (pair.lister_liked_at, pair.seeker_liked_at) == (None, None)


def test_ac9_mutual_lifecycle(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
    published: list[Any],
) -> None:
    owner_id = _user_id(owner)
    room = _room(db_engine, owner_id, gush_dan)
    a = _seeker(client, outbox, db_engine, gush_dan, "a@example.com", "Avi")
    a_id = _user_id(a)
    person = _card(owner, room, "Avi")["id"]
    _ok(_like_person(owner, room, person))
    x = _ok(_like_room(a, room))["application_id"]
    created_at = _application(db_engine, x).created_at

    # Un-shortlist: submitted, still a like, sending closed.
    unlisted = _ok(owner.patch(f"/listings/{room}/applications/{x}", json={"status": "submitted"}))
    assert (unlisted["status"], unlisted["source"], unlisted["message"]) == (
        "submitted",
        "like",
        None,
    )
    closed = a.post(f"/conversations/{x}/messages", json={"body": "Hello?"})
    assert closed.status_code == 409
    assert closed.json() == {"detail": "chat_closed"}

    # Withdraw: a like by the seeker alone does not reopen it (the likes were cleared) ...
    withdrawn = _ok(a.post(f"/me/applications/{x}/withdraw"))
    assert (withdrawn["status"], withdrawn["source"]) == ("withdrawn", "like")
    assert _ok(_like_room(a, room)) == {"liked": True, "application_id": None}
    assert _application(db_engine, x).status == "withdrawn"
    card = _card(owner, room, "Avi")
    assert (card["id"], card["liked_me"]) == (person, True)
    # ... the lister's like back does, as new, with the same conversation.
    reopened = _ok(_like_person(owner, room, person))
    assert reopened == {"liked": True, "application_id": x}
    row = _application(db_engine, x)
    assert (row.status, row.source, row.message) == ("shortlisted", "like", None)
    assert row.created_at > created_at
    assert _scalar(db_engine, "SELECT count(*) FROM conversations") == 1
    assert _conversation(db_engine, x) is not None

    # Decline: final; neither side can like the pair again, and the seeker is off the page.
    declined = owner.patch(f"/listings/{room}/applications/{x}", json={"status": "declined"})
    assert declined.status_code == 200, declined.text
    assert _like_room(a, room).json() == ALREADY_APPLIED
    assert _like_person(owner, room, person).json() == ALREADY_APPLIED
    pair = _pair(db_engine, room, a_id)
    assert (pair.lister_liked_at, pair.seeker_liked_at) == (None, None)
    assert "Avi" not in _names(_page(owner, room))
    assert _likes(a) == {"liked_me": [], "mine": []}
    # A seeker who is not opted in, whose like the match used up: after a decline the pair is no
    # longer shown, so the lister's like is a 404 (the opted-in `A` above gets 409).
    c = _seeker(client, outbox, db_engine, gush_dan, "c@example.com", "Cam", people_visible=False)
    _ok(_like_room(c, room))
    c_person = _card(owner, room, "Cam")["id"]
    z = _ok(_like_person(owner, room, c_person))["application_id"]
    assert z is not None
    declined = owner.patch(f"/listings/{room}/applications/{z}", json={"status": "declined"})
    assert declined.status_code == 200, declined.text
    hidden = _like_person(owner, room, c_person)
    assert hidden.status_code == 404
    assert hidden.json() == NOT_FOUND

    # A like-sourced application withdrawn, then applied to with a message: an applied one.
    b = _seeker(client, outbox, db_engine, gush_dan, "b@example.com", "Bat")
    _ok(_like_room(b, room))
    y = _ok(_like_person(owner, room, _card(owner, room, "Bat")["id"]))["application_id"]
    assert y is not None
    _ok(b.post(f"/me/applications/{y}/withdraw"))
    applied = b.post(f"/listings/{room}/applications", json={"message": "Still keen"})
    assert applied.status_code == 201, applied.text
    assert (applied.json()["id"], applied.json()["source"], applied.json()["message"]) == (
        y,
        "apply",
        "Still keen",
    )
    row = _application(db_engine, y)
    assert (row.source, row.message, row.status) == ("apply", "Still keen", "submitted")


def test_ac9_apply_consumes_pending_likes(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    owner_id = _user_id(owner)
    room = _room(db_engine, owner_id, gush_dan)
    a = _seeker(client, outbox, db_engine, gush_dan, "a@example.com", "Avi")
    a_id = _user_id(a)
    person = _card(owner, room, "Avi")["id"]
    _ok(_like_person(owner, room, person))
    assert _likes(a) == {"liked_me": [room], "mine": []}

    applied = a.post(f"/listings/{room}/applications", json={"message": "Hi there"})
    assert applied.status_code == 201, applied.text
    x = applied.json()["id"]
    pair = _pair(db_engine, room, a_id)
    assert (pair.lister_liked_at, pair.seeker_liked_at) == (None, None)
    for status in ("shortlisted", "submitted"):
        changed = owner.patch(f"/listings/{room}/applications/{x}", json={"status": status})
        assert changed.status_code == 200, changed.text
    _ok(a.post(f"/me/applications/{x}/withdraw"))

    # The lister's like did not survive the application: both sides start over.
    pair = _pair(db_engine, room, a_id)
    assert (pair.lister_liked_at, pair.seeker_liked_at) == (None, None)
    assert _likes(a) == {"liked_me": [], "mine": []}
    assert _card(owner, room, "Avi")["liked_by_me"] is False
    assert _ok(_like_room(a, room)) == {"liked": True, "application_id": None}
    row = _application(db_engine, x)
    assert (row.status, row.source) == ("withdrawn", "apply")
    assert _likes(a) == {"liked_me": [], "mine": [room]}


def test_ac8_apply_racing_a_lister_like(
    owner: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An apply and the lister's (mutual) like on an existing pair at once, in both lock orders:
    no deadlock, one application, and no like left on the pair."""
    owner_id = _user_id(owner)
    real_has_application = people_service._has_application
    real_consume_likes = people_service.consume_likes

    def slow_has_application(db: Session, listing_id: uuid.UUID, seeker_id: uuid.UUID) -> bool:
        time.sleep(0.3)  # the lister holds the pair's lock
        return real_has_application(db, listing_id, seeker_id)

    def slow_consume_likes(db: Session, listing_id: uuid.UUID, seeker_id: uuid.UUID) -> None:
        real_consume_likes(db, listing_id, seeker_id)
        time.sleep(0.3)  # the apply holds the pair's lock, before its application row

    monkeypatch.setattr(people_service, "_has_application", slow_has_application)
    monkeypatch.setattr(people_service, "consume_likes", slow_consume_likes)

    def lister(room: str, person: uuid.UUID, start: threading.Barrier, delay: float) -> str:
        with get_sessionmaker()() as db:
            user = db.get(User, owner_id)
            assert user is not None
            start.wait()
            time.sleep(delay)
            application, _ = people_service.like_person(
                db, get_redis(), user, uuid.UUID(room), person
            )
            return "mutual" if application is not None else "liked"

    def applier(room: str, seeker_id: uuid.UUID, start: threading.Barrier, delay: float) -> str:
        with get_sessionmaker()() as db:
            user = db.get(User, seeker_id)
            assert user is not None
            start.wait()
            time.sleep(delay)
            applications_service.apply(db, get_redis(), user, uuid.UUID(room), "Hi there")
            return "applied"

    # (lister delay, apply delay) -> outcomes: the first to take the pair's lock wins.
    for n, (lister_delay, apply_delay, expected) in enumerate(
        ((0.0, 0.1, ["mutual", "409"]), (0.1, 0.0, ["409", "applied"]))
    ):
        room = _room(db_engine, owner_id, gush_dan)
        a = make_seeker(db_engine, f"a{n}@example.com", "Avi")
        _visible(db_engine, a, gush_dan)
        person = make_pair(db_engine, uuid.UUID(room), a, price_ils_seen=7000, seeker_liked=True)
        start = threading.Barrier(2, timeout=10)
        outcomes = _in_threads(
            partial(lister, room, person, start, lister_delay),
            partial(applier, room, a, start, apply_delay),
        )
        assert outcomes == expected, outcomes
        applications = "SELECT count(*) FROM applications WHERE listing_id = :l"
        assert _scalar(db_engine, applications, l=room) == 1
        pair = _pair(db_engine, room, a)
        assert (pair.lister_liked_at, pair.seeker_liked_at) == (None, None)


def test_ac10_seeker_like_gates_and_limit(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    owner_id = _user_id(owner)
    room = _room(db_engine, owner_id, gush_dan)
    apartment = _l0(db_engine, owner_id, gush_dan)
    paused = _room(db_engine, owner_id, gush_dan, status="paused")
    r = get_redis()

    def counted(caller: TestClient) -> int:
        return int(r.get(f"rl:like:user:{_user_id(caller)}") or 0)

    no_profile = signup(client, outbox, "n@example.com", "seeker")
    no_section = signup(client, outbox, "p@example.com", "seeker")
    make_profile(db_engine, _user_id(no_section), gush_dan)
    man = _seeker(client, outbox, db_engine, gush_dan, "m@example.com", "Moshe", gender="man")
    woman = _seeker(client, outbox, db_engine, gush_dan, "w@example.com", "Wendy")

    cases: list[tuple[TestClient, Any, int, dict[str, str]]] = [
        (no_profile, room, 409, {"detail": "seeker_profile_required"}),
        (no_section, room, 409, {"detail": "room_section_required"}),
        (man, room, 409, {"detail": "room_gender_mismatch"}),
        (woman, apartment, 404, NOT_FOUND),
        (woman, paused, 404, NOT_FOUND),
        (woman, uuid.uuid4(), 404, NOT_FOUND),
    ]
    for caller, listing_id, code, body in cases:
        response = _like_room(caller, listing_id)
        assert response.status_code == code, (listing_id, response.text)
        assert response.json() == body
        assert counted(caller) == 0, body
    assert _pair_count(db_engine) == 0

    assert _like_room(client, room).status_code == 401
    # Spec 0010b: no role gate; the owner's own room, and they have no profile (checked first).
    assert _like_room(owner, room).json() == {"detail": "seeker_profile_required"}
    assert _like_room(woman, "not-a-uuid").status_code == 422

    for n in range(people_service.LIKE_RATE_LIMIT_HOUR):
        assert _like_room(woman, room).status_code == 200, n
    limited = _like_room(woman, room)
    assert limited.status_code == 429
    assert limited.json() == {"detail": "rate_limited"}
    assert int(limited.headers["Retry-After"]) > 0
    # Shared with the lister side: the lister is limited per their own id.
    assert counted(woman) == people_service.LIKE_RATE_LIMIT_HOUR

    gone = woman.delete(f"/listings/{uuid.uuid4()}/like")
    assert gone.status_code == 204
    assert gone.content == b""
    assert woman.delete(f"/listings/{apartment}/like").status_code == 204
    assert client.delete(f"/listings/{room}/like").status_code == 401
    assert owner.delete(f"/listings/{room}/like").status_code == 204  # spec 0010b: any account


def test_ac4_room_likes_and_browse_for_any_account(
    client: TestClient, outbox: Outbox, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    """Spec 0010b AC4: a seeker lists a room, browses its people and likes one; an owner with a
    room section likes someone else's room and sees it in `/me/likes`; an account that is not the
    room's lister gets the unknown id's 404; nobody likes their own room."""
    lister = signup(client, outbox, "lister@example.com", "seeker")
    room = _room(db_engine, _user_id(lister), gush_dan)
    _seeker(client, outbox, db_engine, gush_dan, "a@example.com", "Avi")

    page = _page(lister, room)
    assert _names(page) == ["Avi"]
    person = page["items"][0]["id"]
    assert _ok(_like_person(lister, room, person)) == {"liked": True, "application_id": None}

    owner = signup(client, outbox, "owner@example.com", "owner")
    stranger = signup(client, outbox, "stranger@example.com", "seeker")
    unknown = _people(owner, uuid.uuid4())
    for caller in (owner, stranger):
        for response in (
            _people(caller, room),
            _like_person(caller, room, person),
            _unlike_person(caller, room, person),
        ):
            assert response.status_code == 404
            assert response.content == unknown.content
    assert _card(lister, room, "Avi")["liked_by_me"] is True

    # An owner likes someone else's room once their profile has a room section.
    assert _like_room(owner, room).json() == {"detail": "seeker_profile_required"}
    _visible(db_engine, _user_id(owner), gush_dan, people_visible=False)
    assert _ok(_like_room(owner, room)) == {"liked": True, "application_id": None}
    assert _likes(owner) == {"liked_me": [], "mine": [room]}
    assert _ok(lister.get(f"/listings/{room}"))["like"] is None  # their own room

    # Their own room is the unknown id's 404 (the profile is checked first).
    own_room = _room(db_engine, _user_id(owner), gush_dan)
    own = _like_room(owner, own_room)
    assert own.status_code == 404
    assert own.json() == NOT_FOUND
    no_profile = signup(client, outbox, "bare@example.com", "owner")
    bare_room = _room(db_engine, _user_id(no_profile), gush_dan)
    assert _like_room(no_profile, bare_room).json() == {"detail": "seeker_profile_required"}
    assert _pair(db_engine, own_room, _user_id(owner)) is None


def test_ac11_like_shares_card_with_that_room_only(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    owner_id = _user_id(owner)
    room = _room(db_engine, owner_id, gush_dan)
    other = _room(db_engine, owner_id, gush_dan)
    b = _seeker(client, outbox, db_engine, gush_dan, "b@example.com", "Bat", people_visible=False)
    assert _page(owner, room) == {"items": [], "total": 0}

    _ok(_like_room(b, room))

    card = _card(owner, room, "Bat")
    assert (card["liked_me"], card["liked_by_me"]) == (True, False)
    assert _page(owner, other) == {"items": [], "total": 0}
    assert _likes(b) == {"liked_me": [], "mine": [room]}

    unliked = b.delete(f"/listings/{room}/like")
    assert unliked.status_code == 204
    assert _page(owner, room) == {"items": [], "total": 0}
    assert _likes(b) == {"liked_me": [], "mine": []}


def test_ac12_listing_like_state_and_count(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    owner_id = _user_id(owner)
    room = _room(db_engine, owner_id, gush_dan)
    apartment = _l0(db_engine, owner_id, gush_dan)
    a = _seeker(client, outbox, db_engine, gush_dan, "a@example.com", "Avi")

    def like(caller: TestClient, listing_id: str) -> Any:
        return _ok(caller.get(f"/listings/{listing_id}"))["like"]

    def liked_me_count() -> int:
        items = {item["id"]: item for item in _ok(owner.get("/me/listings"))}
        assert items[apartment]["liked_me_count"] == 0
        count: int = items[room]["liked_me_count"]
        return count

    assert like(a, room) == NO_LIKE
    assert liked_me_count() == 0
    _ok(_like_room(a, room))
    assert like(a, room) == {"liked_by_me": True, "liked_me": False}
    assert liked_me_count() == 1

    assert a.delete(f"/listings/{room}/like").status_code == 204
    assert liked_me_count() == 0
    person = _card(owner, room, "Avi")["id"]
    _ok(_like_person(owner, room, person))
    assert like(a, room) == {"liked_by_me": False, "liked_me": True}
    assert liked_me_count() == 0  # the lister's own likes do not count

    for caller in (client, owner):
        assert like(caller, room) is None
    assert like(a, apartment) is None

    _ok(_like_room(a, room))  # mutual
    assert liked_me_count() == 0
    assert like(a, room) is None  # the page shows the application

    b = _seeker(client, outbox, db_engine, gush_dan, "b@example.com", "Bat")
    _ok(_like_room(b, room))
    assert liked_me_count() == 1
    make_application(db_engine, uuid.UUID(room), _user_id(b))  # a submitted one
    assert like(b, room) is None
    assert liked_me_count() == 0


def test_ac12_withdrawn_applicant_like_not_revived(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    owner_id = _user_id(owner)
    room = _room(db_engine, owner_id, gush_dan)
    a = _seeker(client, outbox, db_engine, gush_dan, "a@example.com", "Avi")
    b = _seeker(client, outbox, db_engine, gush_dan, "b@example.com", "Bat", people_visible=False)

    def liked_me_count() -> int:
        items = {item["id"]: item for item in _ok(owner.get("/me/listings"))}
        count: int = items[room]["liked_me_count"]
        return count

    for seeker in (a, b):
        _ok(_like_room(seeker, room))
    assert liked_me_count() == 2
    for seeker in (a, b):
        applied = seeker.post(f"/listings/{room}/applications", json={"message": "Hi there"})
        assert applied.status_code == 201, applied.text
        _ok(seeker.post(f"/me/applications/{applied.json()['id']}/withdraw"))

    assert liked_me_count() == 0
    # `A` (opted in) is back on the page without the like; `B` (not opted in) is gone with it.
    page = _page(owner, room)
    assert _names(page) == ["Avi"]
    assert page["items"][0]["liked_me"] is False
    for seeker in (a, b):
        assert _ok(seeker.get(f"/listings/{room}"))["like"] == NO_LIKE
        assert _likes(seeker) == {"liked_me": [], "mine": []}
