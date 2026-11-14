"""People browse and invites (spec 0008a): AC1-AC12 (AC13 is in `test_profiles.py`, AC14 in
`test_migrations.py`, AC15 the amended asserts in `test_inbox.py`, `test_applications.py` and
`test_listings.py`). Spec 0010h AC12 (the room side's browse limit) is here too. Spec 0010l
removed the seeker's room-like: its AC6-AC8 are here, the invite answered by an application
(AC3-AC5) is in `test_applications.py`.

`R` is `test_matching`'s `L0` as a women-only room for two flatmates, owned by the signed-up owner
`O`. A seeker profile is `make_profile`'s `P0` (which scores 100 against `L0`) plus a room section
(`gender`) and, unless a test says otherwise, `people_visible`. Every date is UTC, as the
database's `current_date` is."""

import datetime as dt
import threading
import uuid
from collections.abc import Callable, Iterator
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, event, select, text
from sqlalchemy.orm import Session

from app.matching.score import explain_row, match_columns
from app.models import Listing, SeekerProfile
from app.redis_client import get_redis
from app.schemas.people import PersonOut
from app.services import chat_events
from app.services import market_people as market_people_service
from app.services.applications import AlreadyAppliedError
from tests.conftest import (
    Outbox,
    make_application,
    make_flatmate,
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
}
NO_LIKE = {"liked_me": False}


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


def _ok(response: httpx.Response) -> Any:
    assert response.status_code == 200, response.text
    return response.json()


def _likes(caller: TestClient) -> list[str]:
    """`GET /me/likes` (its one list, `liked_me`: the caller's invites) as listing ids."""
    body = _ok(caller.get("/me/likes"))
    assert set(body) == {"liked_me"}
    return [item["listing"]["id"] for item in body["liked_me"]]


def _apply(caller: TestClient, listing_id: Any, message: str | None = None) -> Any:
    """`POST /listings/{id}/applications` (no message unless given), asserted 201."""
    body = {} if message is None else {"message": message}
    response = caller.post(f"/listings/{listing_id}/applications", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def _pair(engine: Engine, listing_id: Any, seeker_id: uuid.UUID) -> Any:
    with engine.connect() as conn:
        return conn.execute(
            text(
                "SELECT id, price_ils_seen, lister_liked_at FROM room_pairs"
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
    assert card["liked_by_me"] is False
    assert _pair(db_engine, room, _user_id(b)) is None  # not opted in: no pair, never a card

    north = _area(db_engine, "north", active=True)
    g = make_seeker(db_engine, "g@example.com", "Gal")
    _visible(db_engine, g, gush_dan, area_ids=[north])  # wants only another area
    # Spec 0010l: score, then the pair's age, then its id (no "liked the room" first).
    _ok(_like_person(owner, room, _card(owner, room, "Gal")["id"]))
    body = _page(owner, room)
    assert _names(body) == ["Avi", "Gal"]
    assert [item["liked_by_me"] for item in body["items"]] == [False, True]
    assert body["items"][1]["match"]["differs"] == "area"
    assert body["items"][1]["match"]["score"] <= 59


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

    assert _ok(_like_person(owner, room, person)) == {"liked": True}
    assert _card(owner, room, "Avi")["liked_by_me"] is True
    assert _likes(a) == [room]
    # spec 0010d: every liked room carries its cover photo, null without photos.
    assert _ok(a.get("/me/likes"))["liked_me"][0]["listing"]["cover"] is None
    liked_at = _pair(db_engine, room, a_id).lister_liked_at
    assert liked_at is not None

    assert _ok(_like_person(owner, room, person)) == {"liked": True}
    assert _pair(db_engine, room, a_id).lister_liked_at == liked_at  # a second PUT changes nothing

    unliked = _unlike_person(owner, room, person)
    assert unliked.status_code == 204
    assert _likes(a) == []
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
    assert published == []  # a like (an invite) notifies no one, nor does a plain apply


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


def test_ac9_mutual_lifecycle(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    """Spec 0010l: invite -> apply (a mutual match) -> un-shortlist -> withdraw -> invite again
    and apply (reopened as new, the same chat) -> decline (final)."""
    owner_id = _user_id(owner)
    room = _room(db_engine, owner_id, gush_dan)
    a = _seeker(client, outbox, db_engine, gush_dan, "a@example.com", "Avi")
    a_id = _user_id(a)
    person = _card(owner, room, "Avi")["id"]
    _ok(_like_person(owner, room, person))
    x = _apply(a, room)["id"]
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

    # Withdraw: the invite was consumed, so the card is back without the lister's like ...
    withdrawn = _ok(a.post(f"/me/applications/{x}/withdraw"))
    assert (withdrawn["status"], withdrawn["source"]) == ("withdrawn", "like")
    card = _card(owner, room, "Avi")
    assert (card["id"], card["liked_by_me"]) == (person, False)
    assert _likes(a) == []
    # ... a new invite answered reopens it as new, with the seeker's message and the same chat.
    _ok(_like_person(owner, room, person))
    reopened = _apply(a, room, "Back again")
    assert (reopened["id"], reopened["status"], reopened["source"]) == (x, "shortlisted", "like")
    row = _application(db_engine, x)
    assert (row.status, row.source, row.message) == ("shortlisted", "like", "Back again")
    assert row.created_at > created_at
    assert _scalar(db_engine, "SELECT count(*) FROM conversations") == 1
    assert _conversation(db_engine, x) is not None

    # Decline: final; neither side can act on the pair again, and the seeker is off the page.
    declined = owner.patch(f"/listings/{room}/applications/{x}", json={"status": "declined"})
    assert declined.status_code == 200, declined.text
    again = a.post(f"/listings/{room}/applications", json={})
    assert again.status_code == 409
    assert again.json() == ALREADY_APPLIED
    assert _like_person(owner, room, person).json() == ALREADY_APPLIED
    assert _pair(db_engine, room, a_id).lister_liked_at is None
    assert "Avi" not in _names(_page(owner, room))
    assert _likes(a) == []


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
    assert _likes(a) == [room]

    x = _apply(a, room, "Hi there")["id"]
    assert _pair(db_engine, room, a_id).lister_liked_at is None
    for status in ("shortlisted", "submitted"):
        changed = owner.patch(f"/listings/{room}/applications/{x}", json={"status": status})
        assert changed.status_code == 200, changed.text
    _ok(a.post(f"/me/applications/{x}/withdraw"))

    # The lister's like did not survive the application: the lister starts over.
    assert _pair(db_engine, room, a_id).lister_liked_at is None
    assert _likes(a) == []
    assert _card(owner, room, "Avi")["liked_by_me"] is False
    row = _application(db_engine, x)
    assert (row.status, row.source) == ("withdrawn", "like")


def test_ac4_room_likes_and_browse_for_any_account(
    client: TestClient, outbox: Outbox, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    """Spec 0010b AC4 (0010l: invites only): a seeker lists a room, browses its people and likes
    one; an owner with a room section who opted in is invited to someone else's room and sees it
    in `/me/likes`; an account that is not the room's lister gets the unknown id's 404; the
    lister's own room has no `like` state."""
    lister = signup(client, outbox, "lister@example.com", "seeker")
    room = _room(db_engine, _user_id(lister), gush_dan)
    _seeker(client, outbox, db_engine, gush_dan, "a@example.com", "Avi")

    page = _page(lister, room)
    assert _names(page) == ["Avi"]
    person = page["items"][0]["id"]
    assert _ok(_like_person(lister, room, person)) == {"liked": True}

    owner = signup(client, outbox, "owner@example.com", "owner", display_name="Ora")
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

    # An owner-role account with a room section, opted in, is a candidate and can be invited.
    _visible(db_engine, _user_id(owner), gush_dan)
    _ok(_like_person(lister, room, _card(lister, room, "Ora")["id"]))
    assert _likes(owner) == [room]
    assert _ok(owner.get(f"/listings/{room}"))["like"] == {"liked_me": True}
    assert _ok(lister.get(f"/listings/{room}"))["like"] is None  # their own room


def test_ac12_listing_like_state_and_count(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    """Spec 0010l: `like` is `{liked_me}` (the lister's invite) and `/me/listings` has no
    liked-me count."""
    owner_id = _user_id(owner)
    room = _room(db_engine, owner_id, gush_dan)
    apartment = _l0(db_engine, owner_id, gush_dan)
    a = _seeker(client, outbox, db_engine, gush_dan, "a@example.com", "Avi")

    def like(caller: TestClient, listing_id: str) -> Any:
        return _ok(caller.get(f"/listings/{listing_id}"))["like"]

    assert like(a, room) == NO_LIKE
    person = _card(owner, room, "Avi")["id"]
    _ok(_like_person(owner, room, person))
    assert like(a, room) == {"liked_me": True}
    assert _unlike_person(owner, room, person).status_code == 204
    assert like(a, room) == NO_LIKE
    _ok(_like_person(owner, room, person))

    for caller in (client, owner):
        assert like(caller, room) is None
    assert like(a, apartment) is None

    _apply(a, room)  # answers the invite
    assert like(a, room) is None  # the page shows the application

    b = _seeker(client, outbox, db_engine, gush_dan, "b@example.com", "Bat")
    make_application(db_engine, uuid.UUID(room), _user_id(b))  # a submitted one
    assert like(b, room) is None
    for item in _ok(owner.get("/me/listings")):
        assert "liked_me_count" not in item


def test_ac12_withdrawn_applicant_like_not_revived(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    """An invited applicant who withdraws comes back to people browse without the lister's like
    (the application consumed it); one who never opted in does not appear at all."""
    owner_id = _user_id(owner)
    room = _room(db_engine, owner_id, gush_dan)
    a = _seeker(client, outbox, db_engine, gush_dan, "a@example.com", "Avi")
    b = _seeker(client, outbox, db_engine, gush_dan, "b@example.com", "Bat", people_visible=False)

    _ok(_like_person(owner, room, _card(owner, room, "Avi")["id"]))
    for seeker in (a, b):
        applied = _apply(seeker, room, "Hi there")
        _ok(seeker.post(f"/me/applications/{applied['id']}/withdraw"))

    # `A` (opted in) is back on the page without the like; `B` (not opted in) never shows.
    page = _page(owner, room)
    assert _names(page) == ["Avi"]
    assert page["items"][0]["liked_by_me"] is False
    for seeker in (a, b):
        assert _ok(seeker.get(f"/listings/{room}"))["like"] == NO_LIKE
        assert _likes(seeker) == []


# --- 0010c: the personal part and the looking part -----------------------------------------


def _personal_only(caller: TestClient) -> None:
    """`caller` PUTs only the personal part (spec 0010c): the looking part clears."""
    _ok(caller.put("/me/profile", json={"gender": "woman", "about_me": "Quiet and tidy"}))


def test_ac6_no_looking_part_leaves_people_browse(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    room = _room(db_engine, _user_id(owner), gush_dan)
    s = _seeker(client, outbox, db_engine, gush_dan, "s@example.com", "Sara")
    _seeker(client, outbox, db_engine, gush_dan, "v@example.com", "Vered")
    _ok(_like_person(owner, room, _card(owner, room, "Sara")["id"]))
    before = _page(owner, room)
    assert sorted(_names(before)) == ["Sara", "Vered"]
    assert before["total"] == 2

    _personal_only(s)

    after = _page(owner, room)
    assert _names(after) == ["Vered"]
    assert after["total"] == 1
    assert (
        _scalar(
            db_engine,
            "SELECT people_visible FROM seeker_profiles WHERE user_id = :id",
            id=_user_id(s),
        )
        is False
    )
    # The pair (and the lister's like) stays; only the card is gone.
    assert _pair(db_engine, room, _user_id(s)).lister_liked_at is not None


def test_ac6b_my_likes_without_looking_part(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    """`GET /me/likes` without the looking part is 200 with an empty list (no NULL score
    reaches `explain`), so a personal-only caller never sees flatmate ages or answers there; with
    both parts, an owner-role account is a seeker by decision 13 and sees them."""
    ages, answers = [27, 30], {"night": 3}
    owner_id = _user_id(owner)
    liked_me = _room(db_engine, owner_id, gush_dan, flatmate_ages=ages, lifestyle=answers)
    s = _seeker(client, outbox, db_engine, gush_dan, "s@example.com", "Sara")
    s_id = _user_id(s)
    make_pair(db_engine, uuid.UUID(liked_me), s_id, price_ils_seen=7000, lister_liked=True)
    assert _likes(s) == [liked_me]

    _personal_only(s)

    response = s.get("/me/likes")
    assert response.status_code == 200, response.text
    assert response.json() == {"liked_me": []}

    # The seeker rule on `/me/likes` (decision 13): an owner-role account with the looking part.
    flat_owner = signup(client, outbox, "o2@example.com", "owner", display_name="Other")
    flat_owner_id = _user_id(flat_owner)
    _visible(db_engine, flat_owner_id, gush_dan, people_visible=False)
    make_pair(db_engine, uuid.UUID(liked_me), flat_owner_id, price_ils_seen=7000, lister_liked=True)
    [item] = _ok(flat_owner.get("/me/likes"))["liked_me"]
    assert (item["listing"]["flatmate_ages"], item["listing"]["lifestyle"]) == (ages, answers)
    assert item["listing"]["match"] is not None


def test_ac12_room_people_browse_rate_limited(
    owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    """Spec 0010h AC12: the room page's people share the people-browse counter with `GET /people`
    (`rl:browse:user:*`); every attempt counts, a 404 included."""
    room = _room(db_engine, _user_id(owner), gush_dan)
    a = make_seeker(db_engine, "a@example.com", "Avi")
    _visible(db_engine, a, gush_dan)
    limit = market_people_service.BROWSE_RATE_LIMIT_HOUR
    assert _people(owner, uuid.uuid4()).status_code == 404
    for n in range(limit // 2 - 1):
        assert _names(_page(owner, room)) == ["Avi"], n
    for n in range(limit - limit // 2):
        assert owner.get("/people").status_code == 403, n  # no card; the limiter counts first
    assert int(get_redis().get(f"rl:browse:user:{_user_id(owner)}") or 0) == limit
    limited = _people(owner, room)
    assert limited.status_code == 429
    assert limited.json() == {"detail": "rate_limited"}
    assert int(limited.headers["Retry-After"]) > 0
    assert owner.get("/people").status_code == 429


# --- 0010l: one way to say "I'm interested" on a room ------------------------------------------


def test_ac6_room_like_removed(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    """Spec 0010l AC6: `PUT` and `DELETE /listings/{id}/like` are gone: 404, not in the schema."""
    room = _room(db_engine, _user_id(owner), gush_dan)
    a = _seeker(client, outbox, db_engine, gush_dan, "a@example.com", "Avi")
    for caller in (a, client):
        for method in ("PUT", "DELETE"):
            response = caller.request(method, f"/listings/{room}/like")
            assert response.status_code == 404, (method, response.text)
    assert _pair_count(db_engine) == 0
    paths = _ok(client.get("/openapi.json"))["paths"]
    assert "/listings/{listing_id}/like" not in paths
    assert "/listings/{listing_id}/people/{person_id}/like" in paths  # the lister's like stays


def test_ac7_browse_opted_in_only(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    """Spec 0010l AC7: people browse lists opted-in candidates only, a card has no `liked_me`, and
    the lister's like answers `{liked: true}` (an invite: no application)."""
    room = _room(db_engine, _user_id(owner), gush_dan)
    _seeker(client, outbox, db_engine, gush_dan, "a@example.com", "Avi")
    hidden = _seeker(
        client, outbox, db_engine, gush_dan, "b@example.com", "Bat", people_visible=False
    )
    # A pair left from before 0010l (a seeker like) does not show a hidden person either.
    make_pair(db_engine, uuid.UUID(room), _user_id(hidden), price_ils_seen=7000)

    body = _page(owner, room)
    assert _names(body) == ["Avi"]
    assert body["total"] == 1
    [card] = body["items"]
    assert "liked_me" not in card
    assert set(card) == PERSON_KEYS == set(PersonOut.model_fields)

    assert _ok(_like_person(owner, room, card["id"])) == {"liked": True}
    hidden_card = _pair(db_engine, room, _user_id(hidden)).id
    refused = _like_person(owner, room, hidden_card)
    assert refused.status_code == 404
    assert refused.json() == NOT_FOUND
    assert _scalar(db_engine, "SELECT count(*) FROM applications") == 0


def test_ac8_my_likes_invites_only(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    """Spec 0010l AC8: `GET /me/likes` has no `mine`; `liked_me` lists the rooms whose lister
    invited the caller, newest first, until the caller applies."""
    owner_id = _user_id(owner)
    first = _room(db_engine, owner_id, gush_dan)
    second = _room(db_engine, owner_id, gush_dan)
    a = _seeker(client, outbox, db_engine, gush_dan, "a@example.com", "Avi")
    assert _ok(a.get("/me/likes")) == {"liked_me": []}

    for room in (first, second):
        _ok(_like_person(owner, room, _card(owner, room, "Avi")["id"]))
    body = _ok(a.get("/me/likes"))
    assert set(body) == {"liked_me"}
    assert [item["listing"]["id"] for item in body["liked_me"]] == [second, first]
    assert set(body["liked_me"][0]) == {"listing", "liked_at"}

    _apply(a, second)
    assert _likes(a) == [first]


def test_ac8_my_likes_hides_a_flatmates_invite(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    """Spec 0010l AC8 (review): an invite that predates the seeker joining the room's flat is not
    listed on `/me/likes`, and the room's page has no `like` for them (a flatmate cannot apply,
    0008d); leaving the flat brings the invite back."""
    room = _room(db_engine, _user_id(owner), gush_dan)
    a = _seeker(client, outbox, db_engine, gush_dan, "a@example.com", "Avi")
    a_id = _user_id(a)
    make_pair(db_engine, uuid.UUID(room), a_id, price_ils_seen=7000, lister_liked=True)
    assert _likes(a) == [room]
    assert _ok(a.get(f"/listings/{room}"))["like"] == {"liked_me": True}

    make_flatmate(db_engine, uuid.UUID(room), a_id)

    assert _likes(a) == []
    assert _ok(a.get(f"/listings/{room}"))["like"] is None
    _execute(db_engine, "DELETE FROM listing_flatmates WHERE user_id = :u", u=a_id)
    assert _likes(a) == [room]
