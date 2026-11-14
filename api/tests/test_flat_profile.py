"""Flat profile (spec 0010f): AC1-AC5 (AC6, the migration, is in `test_migrations.py`).

`O` ("Noa") owns room `R` and says they live there (`poster: lives_here`). `F1` ("Fay") joins `R`'s
flat with `shown: true` and a full personal part (a woman, a birth year, about me, two answers, a
photo); `F2` ("Gal") joins without `shown`. A **seeker** is decision 13's: the seeker role, or any
account with the looking part filled."""

import datetime as dt
import secrets
import uuid
from collections.abc import Iterator
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, event, text

from app.services.photos import person_photo_url
from tests.conftest import (
    NO_LOOKING,
    Outbox,
    make_flatmate,
    make_listing,
    make_profile,
    make_seeker,
    set_location,
    signup,
)
from tests.test_listings import _body, _room
from tests.test_matching import _user_id

pytestmark = pytest.mark.usefixtures("redis_clean")

NOT_FOUND = {"detail": "not_found"}
FACTS = ("room_size_sqm", "private_bathroom", "balcony", "bills_included", "poster")
SET_FACTS: dict[str, Any] = {
    "room_size_sqm": 12,
    "private_bathroom": True,
    "balcony": False,
    "bills_included": True,
    "poster": "lives_here",
}
YEAR = dt.datetime.now(dt.UTC).year
F1_ANSWERS = {"cleanliness": 3, "night": 1}
F1_ABOUT = "Fay likes plants"


def _ok(response: httpx.Response, code: int = 200) -> Any:
    assert response.status_code == code, response.text
    return response.json() if response.content else None


def _scalar(engine: Engine, sql: str, **params: Any) -> Any:
    with engine.connect() as conn:
        return conn.execute(text(sql), params).scalar()


def _execute(engine: Engine, sql: str, **params: Any) -> None:
    with engine.begin() as conn:
        conn.execute(text(sql), params)


def _execute_all(engine: Engine, sql: str, **params: Any) -> list[Any]:
    with engine.connect() as conn:
        return list(conn.execute(text(sql), params).scalars())


def _facts(item: dict[str, Any]) -> dict[str, Any]:
    return {name: item[name] for name in FACTS}


def _detail(caller: TestClient, listing_id: Any) -> dict[str, Any]:
    body: dict[str, Any] = _ok(caller.get(f"/listings/{listing_id}"))
    return body


def _people(caller: TestClient, listing_id: Any) -> list[dict[str, Any]]:
    people: list[dict[str, Any]] = _detail(caller, listing_id)["people"]
    return people


def _names(caller: TestClient, listing_id: Any) -> list[str]:
    return [person["display_name"] for person in _people(caller, listing_id)]


def _invite(owner: TestClient, listing_id: Any) -> str:
    token: str = _ok(owner.post(f"/listings/{listing_id}/flatmate-invite"), 201)["token"]
    return token


def _join(caller: TestClient, body: dict[str, Any]) -> httpx.Response:
    response: httpx.Response = caller.post("/flatmate-invites/join", json=body)
    return response


def _shown(engine: Engine, listing_id: Any, user_id: uuid.UUID) -> bool:
    shown: bool = _scalar(
        engine,
        "SELECT shown FROM listing_flatmates WHERE listing_id = :l AND user_id = :u",
        l=str(listing_id),
        u=user_id,
    )
    return shown


def _set_photo(engine: Engine, user_id: uuid.UUID) -> str:
    key = secrets.token_urlsafe(32)
    _execute(engine, "UPDATE users SET photo_key = :key WHERE id = :id", key=key, id=user_id)
    return key


@pytest.fixture
def statements(db_engine: Engine) -> Iterator[list[str]]:
    """Every SQL statement the app engine sends while the test records (`.clear()` to start)."""
    seen: list[str] = []

    def record(_conn: Any, _cursor: Any, statement: str, *_: Any) -> None:
        seen.append(statement)

    event.listen(db_engine, "before_cursor_execute", record)
    yield seen
    event.remove(db_engine, "before_cursor_execute", record)


class Flat:
    """`O`'s room `R` (for anyone, lives-here), `F1` shown and `F2` not, both joined by link."""

    def __init__(self, client: TestClient, outbox: Outbox, engine: Engine, area: uuid.UUID) -> None:
        self.owner = signup(client, outbox, "o@example.com", "owner", display_name="Noa")
        self.owner_id = _user_id(self.owner)
        # `O`'s personal part only: an owner who is not a seeker by decision 13.
        make_profile(engine, self.owner_id, area, gender="man", birth_year=YEAR - 40, **NO_LOOKING)
        created = _ok(
            self.owner.post(
                "/listings", json=_room(area, gender_preference="any", size_sqm=60, **SET_FACTS)
            ),
            201,
        )
        self.room: str = created["id"]
        token = _invite(self.owner, self.room)

        self.f1 = signup(client, outbox, "f1@example.com", "seeker", display_name="Fay")
        self.f1_id = _user_id(self.f1)
        make_profile(
            engine,
            self.f1_id,
            area,
            gender="woman",
            birth_year=YEAR - 29,
            about_me=F1_ABOUT,
            lifestyle=F1_ANSWERS,
        )
        self.f1_photo = _set_photo(engine, self.f1_id)
        _ok(_join(self.f1, {"token": token, "shown": True}))

        self.f2 = signup(client, outbox, "f2@example.com", "seeker", display_name="Gal")
        self.f2_id = _user_id(self.f2)
        _ok(_join(self.f2, {"token": token}))

        self.lister_out: dict[str, Any] = {
            "display_name": "Noa",
            "photo_url": None,
            "age": 40,
            "gender": "man",
            "about_me": None,
            "lifestyle": {},
            "lister": True,
        }
        self.f1_out: dict[str, Any] = {
            "display_name": "Fay",
            "photo_url": person_photo_url(self.f1_photo),
            "age": 29,
            "gender": "woman",
            "about_me": F1_ABOUT,
            "lifestyle": F1_ANSWERS,
            "lister": False,
        }


@pytest.fixture
def flat(client: TestClient, outbox: Outbox, db_engine: Engine, gush_dan: uuid.UUID) -> Flat:
    return Flat(client, outbox, db_engine, gush_dan)


# --- AC1 ---------------------------------------------------------------------------------------


def test_ac1_room_facts_roundtrip_and_public(
    client: TestClient, outbox: Outbox, db_engine: Engine, gush_dan: uuid.UUID
) -> None:
    owner = signup(client, outbox, "o@example.com", "owner")
    created = _ok(owner.post("/listings", json=_room(gush_dan, size_sqm=60, **SET_FACTS)), 201)
    assert _facts(created) == SET_FACTS
    set_location(db_engine, uuid.UUID(created["id"]), 34.8, 32.05)
    plain = _ok(owner.post("/listings", json=_room(gush_dan)), 201)
    assert _facts(plain) == dict.fromkeys(FACTS)
    with db_engine.connect() as conn:
        stored = conn.execute(
            text(f"SELECT {', '.join(FACTS)} FROM listings WHERE id = :id"), {"id": plain["id"]}
        ).one()
    assert tuple(stored) == (None,) * 5

    mine = {item["id"]: item for item in _ok(owner.get("/me/listings"))}
    assert _facts(mine[created["id"]]) == SET_FACTS
    assert _facts(mine[plain["id"]]) == dict.fromkeys(FACTS)

    # An anonymous caller: search, the map and the listing page.
    search = {item["id"]: item for item in _ok(client.get("/listings?listing_type=room"))["items"]}
    assert _facts(search[created["id"]]) == SET_FACTS
    assert _facts(search[plain["id"]]) == dict.fromkeys(FACTS)
    box = "west=34.74&south=31.95&east=34.95&north=32.17"
    mapped = _ok(client.get(f"/listings?listing_type=room&{box}"))["items"]
    assert [_facts(item) for item in mapped] == [SET_FACTS]
    page = _detail(client, created["id"])
    assert _facts(page) == SET_FACTS
    assert page["people"] == []


# --- AC2 ---------------------------------------------------------------------------------------


def test_ac2_room_fact_rules(
    client: TestClient, outbox: Outbox, db_engine: Engine, gush_dan: uuid.UUID
) -> None:
    owner = signup(client, outbox, "o@example.com", "owner")

    def count() -> int:
        value: int = _scalar(db_engine, "SELECT count(*) FROM listings")
        return value

    def refused(body: dict[str, Any]) -> None:
        response = owner.post("/listings", json=body)
        assert response.status_code == 422, (body, response.text)
        assert isinstance(response.json()["detail"], list)

    for name, value in SET_FACTS.items():
        if name != "balcony":  # a fact of any listing since spec 0014b
            refused(_body(gush_dan, **{name: value}))
    apartment = owner.post("/listings", json=_body(gush_dan, bills_included=True))
    assert "room_size_sqm, private_bathroom, bills_included, poster" in apartment.text
    refused(_room(gush_dan, room_size_sqm=3))
    refused(_room(gush_dan, room_size_sqm=101))
    refused(_room(gush_dan, size_sqm=60, room_size_sqm=61))
    refused(_room(gush_dan, poster="agent"))
    assert count() == 0
    # The bounds themselves pass.
    room = _ok(
        owner.post(
            "/listings", json=_room(gush_dan, size_sqm=100, room_size_sqm=100, balcony=True)
        ),
        201,
    )
    _ok(owner.post("/listings", json=_room(gush_dan, room_size_sqm=4)), 201)

    path = f"/listings/{room['id']}"
    cleared = _ok(owner.patch(path, json={"balcony": None}))
    assert cleared["balcony"] is None
    assert _scalar(db_engine, "SELECT balcony FROM listings WHERE id = :id", id=room["id"]) is None
    _ok(owner.patch(path, json={"size_sqm": 50, "room_size_sqm": 20}))
    for patch in ({"room_size_sqm": 51}, {"size_sqm": 19}, {"poster": "agent"}):
        response = owner.patch(path, json=patch)
        assert response.status_code == 422, (patch, response.text)
        assert isinstance(response.json()["detail"], list)
    stored = _scalar(db_engine, "SELECT room_size_sqm FROM listings WHERE id = :id", id=room["id"])
    assert stored == 20


# --- AC3 ---------------------------------------------------------------------------------------


def test_ac3_people_seekers_only_by_choice(
    client: TestClient, outbox: Outbox, db_engine: Engine, gush_dan: uuid.UUID, flat: Flat
) -> None:
    seeker = signup(client, outbox, "s@example.com", "seeker", display_name="Sam")
    response = seeker.get(f"/listings/{flat.room}")
    body = _ok(response)
    assert body["people"] == [flat.lister_out, flat.f1_out]
    seeker_id = _user_id(seeker)
    memberships = [
        str(value) for value in _execute_all(db_engine, "SELECT id FROM listing_flatmates")
    ]
    assert len(memberships) == 2
    for secret in (
        str(flat.owner_id),
        str(flat.f1_id),
        str(flat.f2_id),
        str(seeker_id),
        *memberships,
        "o@example.com",
        "f1@example.com",
        "f2@example.com",
        "s@example.com",
        "Gal",
    ):
        assert secret not in response.text, secret

    # An owner-role account with the looking part is a seeker by decision 13.
    owner_seeker = signup(client, outbox, "os@example.com", "owner")
    make_profile(db_engine, _user_id(owner_seeker), gush_dan)
    assert _names(owner_seeker, flat.room) == ["Noa", "Fay"]

    not_seekers = {
        "visitor": client,
        "owner without the looking part": signup(client, outbox, "o2@example.com", "owner"),
        "the lister": flat.owner,
    }
    make_profile(
        db_engine,
        _user_id(not_seekers["owner without the looking part"]),
        gush_dan,
        gender="woman",
        **NO_LOOKING,
    )
    for name, caller in not_seekers.items():
        page = _detail(caller, flat.room)
        assert page["people"] == [], name
        assert page["poster"] == "lives_here", name  # the facts stay public


def test_ac3b_people_follow_the_gender_rule(
    client: TestClient, outbox: Outbox, db_engine: Engine, gush_dan: uuid.UUID, flat: Flat
) -> None:
    _execute(
        db_engine,
        "UPDATE seeker_profiles SET flatmate_gender = 'women' WHERE user_id = :id",
        id=flat.f1_id,
    )
    man = signup(client, outbox, "man@example.com", "seeker", display_name="Avi")
    make_profile(db_engine, _user_id(man), gush_dan, gender="man")
    no_gender = signup(client, outbox, "nog@example.com", "seeker", display_name="Kim")
    other = signup(client, outbox, "other@example.com", "seeker", display_name="Lee")
    make_profile(db_engine, _user_id(other), gush_dan, gender="other")
    woman = signup(client, outbox, "woman@example.com", "seeker", display_name="Dana")
    make_profile(db_engine, _user_id(woman), gush_dan, gender="woman")

    assert _names(man, flat.room) == ["Noa"]
    assert _names(no_gender, flat.room) == ["Noa"]
    assert _names(other, flat.room) == ["Noa"]
    assert _people(woman, flat.room) == [flat.lister_out, flat.f1_out]

    # The rule also hides the lister: `O` now prefers men (with the looking part).
    _execute(
        db_engine,
        "UPDATE seeker_profiles SET budget_max_ils = 7500, move_in_date = current_date,"
        " area_ids = ARRAY[CAST(:area AS uuid)], household = 'single', has_pets = false,"
        " smoker = false, contract_months = 12, flatmate_gender = 'men' WHERE user_id = :id",
        area=str(gush_dan),
        id=flat.owner_id,
    )
    assert _names(woman, flat.room) == ["Fay"]
    assert _names(man, flat.room) == ["Noa"]
    _execute(
        db_engine,
        "UPDATE seeker_profiles SET flatmate_gender = 'any' WHERE user_id = :id",
        id=flat.owner_id,
    )

    # A women-only room is hidden from the man by the fit rule, and so are its people.
    _ok(flat.owner.patch(f"/listings/{flat.room}", json={"gender_preference": "women"}))
    page = _detail(man, flat.room)
    assert page["room_fit"] is False
    assert page["people"] == []
    assert _names(woman, flat.room) == ["Noa", "Fay"]


def test_ac3c_room_gender_gates_people_without_looking_part(
    client: TestClient, outbox: Outbox, db_engine: Engine, gush_dan: uuid.UUID, flat: Flat
) -> None:
    # A women-only room whose lister (lives here) and shown flatmate are both women.
    _execute(
        db_engine,
        "UPDATE seeker_profiles SET gender = 'woman' WHERE user_id = :id",
        id=flat.owner_id,
    )
    _ok(flat.owner.patch(f"/listings/{flat.room}", json={"gender_preference": "women"}))

    man = signup(client, outbox, "man@example.com", "seeker", display_name="Avi")
    make_profile(db_engine, _user_id(man), gush_dan, gender="man", **NO_LOOKING)
    no_profile = signup(client, outbox, "nop@example.com", "seeker", display_name="Kim")
    owner_seeker = signup(client, outbox, "os@example.com", "owner", display_name="Ori")
    make_profile(db_engine, _user_id(owner_seeker), gush_dan, gender=None)
    woman = signup(client, outbox, "woman@example.com", "seeker", display_name="Dana")
    make_profile(db_engine, _user_id(woman), gush_dan, gender="woman", **NO_LOOKING)

    for name, caller in (
        ("a man without the looking part", man),
        ("a seeker with no profile row", no_profile),
        ("an owner-role seeker with no gender", owner_seeker),
    ):
        page = _detail(caller, flat.room)
        assert page["people"] == [], name
        assert page["poster"] == "lives_here", name  # the room itself stays visible
    assert _people(woman, flat.room) == [{**flat.lister_out, "gender": "woman"}, flat.f1_out]

    # And the same on a men-only room: the woman now sees nobody.
    _ok(flat.owner.patch(f"/listings/{flat.room}", json={"gender_preference": "men"}))
    assert _people(woman, flat.room) == []


# --- AC4---------------------------------------------------------------------------------------


def test_ac4_people_edge_cases_and_statement_count(
    client: TestClient,
    outbox: Outbox,
    db_engine: Engine,
    gush_dan: uuid.UUID,
    statements: list[str],
) -> None:
    owner = signup(client, outbox, "o@example.com", "owner", display_name="Noa")
    owner_id = _user_id(owner)
    room = make_listing(
        db_engine, owner_id, gush_dan, listing_type="room", flatmates_count=3, poster="leaving"
    )
    apartment = make_listing(db_engine, owner_id, gush_dan)
    # No profile row at all, joined first.
    bare = make_seeker(db_engine, "bare@example.com", display_name="Bare")
    make_flatmate(
        db_engine, room, bare, shown=True, joined_at=dt.datetime(2026, 1, 1, tzinfo=dt.UTC)
    )
    seeker = signup(client, outbox, "s@example.com", "seeker")

    assert _people(seeker, room) == [
        {
            "display_name": "Bare",
            "photo_url": None,
            "age": None,
            "gender": None,
            "about_me": None,
            "lifestyle": {},
            "lister": False,
        }
    ]

    def recorded(caller: TestClient, listing_id: Any) -> tuple[int, int]:
        statements.clear()
        _detail(caller, listing_id)
        return len(statements), sum("listing_flatmates" in s for s in statements)

    one_total, one_flatmates = recorded(seeker, room)
    # The flat's people, and `like_state`'s flatmate check (spec 0010l: a flatmate has no invite).
    assert one_flatmates == 2
    assert recorded(client, room)[1] == 0
    assert recorded(owner, room)[1] == 0
    assert recorded(seeker, apartment)[1] == 0

    _execute(db_engine, "UPDATE listings SET poster = 'lives_here' WHERE id = :id", id=room)
    for n in (2, 3):
        mate = make_seeker(db_engine, f"m{n}@example.com", display_name=f"Mate{n}")
        make_flatmate(db_engine, room, mate, shown=True)
    assert _names(seeker, room) == ["Noa", "Bare", "Mate2", "Mate3"]
    assert recorded(seeker, room) == (one_total, 2)


# --- AC5 ---------------------------------------------------------------------------------------


def test_ac5_join_shown_and_toggle(
    client: TestClient, outbox: Outbox, db_engine: Engine, flat: Flat
) -> None:
    assert _shown(db_engine, flat.room, flat.f1_id) is True
    assert _shown(db_engine, flat.room, flat.f2_id) is False
    token = _invite(flat.owner, flat.room)
    # A member's second join keeps the stored choice (and `joined_at`).
    joined_at = _scalar(
        db_engine, "SELECT joined_at FROM listing_flatmates WHERE user_id = :u", u=flat.f1_id
    )
    assert _ok(_join(flat.f1, {"token": token, "shown": False})) == {"listing_id": flat.room}
    assert _shown(db_engine, flat.room, flat.f1_id) is True
    assert (
        _scalar(
            db_engine, "SELECT joined_at FROM listing_flatmates WHERE user_id = :u", u=flat.f1_id
        )
        == joined_at
    )

    [mine] = _ok(flat.f1.get("/me/flats"))
    assert mine["shown"] is True
    assert _ok(flat.f2.get("/me/flats"))[0]["shown"] is False

    seeker = signup(client, outbox, "s@example.com", "seeker")
    assert _names(seeker, flat.room) == ["Noa", "Fay"]
    path = f"/me/flats/{flat.room}"
    response = flat.f1.patch(path, json={"shown": False})
    assert response.status_code == 204, response.text
    assert response.content == b""
    assert _ok(flat.f1.get("/me/flats"))[0]["shown"] is False
    assert _names(seeker, flat.room) == ["Noa"]
    assert flat.f2.patch(f"/me/flats/{flat.room}", json={"shown": True}).status_code == 204
    assert _names(seeker, flat.room) == ["Noa", "Gal"]

    for caller, url in (
        (seeker, path),  # not a member
        (flat.owner, path),  # the lister is not a flatmate
        (flat.f1, f"/me/flats/{uuid.uuid4()}"),  # unknown listing
    ):
        refused = caller.patch(url, json={"shown": True})
        assert refused.status_code == 404, refused.text
        assert refused.json() == NOT_FOUND
    assert _shown(db_engine, flat.room, flat.f1_id) is False
    anonymous = client.patch(path, json={"shown": True})
    assert anonymous.status_code == 401
    for bad in (
        {},
        {"shown": True, "extra": 1},
        {"shown": "maybe"},
        {"shown": "yes"},
        {"shown": "true"},
        {"shown": 1},
        {"shown": 0},
    ):
        response = flat.f1.patch(path, json=bad)
        assert response.status_code == 422, (bad, response.text)
    assert _shown(db_engine, flat.room, flat.f1_id) is False

    # The join's consent is a JSON boolean too: nothing is coerced, and nobody joins.
    for shown in ("yes", "true", 1, 0):
        response = _join(seeker, {"token": token, "shown": shown})
        assert response.status_code == 422, (shown, response.text)
    assert (
        _execute_all(
            db_engine, "SELECT 1 FROM listing_flatmates WHERE user_id = :u", u=_user_id(seeker)
        )
        == []
    )
