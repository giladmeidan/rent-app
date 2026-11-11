"""Seeker housing profile API (spec 0006a): AC1-AC4 and AC10 (AC5, AC6 are in
`test_applications.py`, AC7, AC8 in `test_listings.py`, AC9 in `test_migrations.py`)."""

import datetime as dt
import uuid
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from scripts.seed import GUSH_DAN_WKT
from tests.conftest import Outbox, make_profile, make_seeker, signup

pytestmark = pytest.mark.usefixtures("redis_clean")

PROFILE_KEYS = {
    "budget_max_ils",
    "move_in_date",
    "move_in_flexible",
    "area_ids",
    "household",
    "has_pets",
    "smoker",
    "contract_months",
    "parking_needed",
    "gender",
    "birth_year",
    "flatmate_gender",
    "lifestyle",
    "updated_at",
}
# The room section of a profile without one (spec 0007a).
ROOM_OFF: dict[str, Any] = {
    "gender": None,
    "birth_year": None,
    "flatmate_gender": "any",
    "lifestyle": {},
}
NOT_FOUND = {"detail": "seeker_profile_not_found"}


def _today() -> dt.date:
    """Today in UTC, the API's move-in window (pytest runs on a Mac in Israel time)."""
    return dt.datetime.now(dt.UTC).date()


def _p(area_id: uuid.UUID, **overrides: Any) -> dict[str, Any]:
    """`P`: a valid profile body."""
    body: dict[str, Any] = {
        "budget_max_ils": 7500,
        "move_in_date": (_today() + dt.timedelta(days=30)).isoformat(),
        "move_in_flexible": False,
        "area_ids": [str(area_id)],
        "household": "couple",
        "has_pets": False,
        "smoker": False,
        "contract_months": 24,
        "parking_needed": 1,
    }
    body.update(overrides)
    return body


def _put(caller: TestClient, body: Any) -> httpx.Response:
    response: httpx.Response = caller.put("/me/profile", json=body)
    return response


def _profile_count(engine: Engine) -> int:
    with engine.connect() as conn:
        count: int = conn.execute(text("SELECT count(*) FROM seeker_profiles")).scalar_one()
    return count


@pytest.fixture
def seeker(client: TestClient, outbox: Outbox) -> TestClient:
    return signup(client, outbox, "s@example.com", "seeker")


def test_ac1_seeker_creates_and_reads_profile(seeker: TestClient, gush_dan: uuid.UUID) -> None:
    missing = seeker.get("/me/profile")
    assert missing.status_code == 404
    assert missing.json() == NOT_FOUND

    body = _p(gush_dan)
    response = _put(seeker, body)

    assert response.status_code == 200, response.text
    saved = response.json()
    assert set(saved) == PROFILE_KEYS
    assert {k: v for k, v in saved.items() if k != "updated_at"} == {**ROOM_OFF, **body}
    read = seeker.get("/me/profile")
    assert read.status_code == 200
    assert read.json() == saved


def test_ac2_put_replaces_profile(
    seeker: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    first = _put(seeker, _p(gush_dan))
    assert first.status_code == 200, first.text

    changed = _p(gush_dan, budget_max_ils=9000, household="family", has_pets=True)
    second = _put(seeker, changed)

    assert second.status_code == 200, second.text
    body = second.json()
    assert (body["budget_max_ils"], body["household"], body["has_pets"]) == (9000, "family", True)
    assert {k: v for k, v in body.items() if k != "updated_at"} == {**ROOM_OFF, **changed}
    seeker_id = uuid.UUID(seeker.get("/me").json()["id"])
    with db_engine.connect() as conn:
        rows = conn.execute(
            text("SELECT count(*) FROM seeker_profiles WHERE user_id = :id"), {"id": seeker_id}
        ).scalar_one()
    assert rows == 1
    assert dt.datetime.fromisoformat(body["updated_at"]) > dt.datetime.fromisoformat(
        first.json()["updated_at"]
    )
    assert seeker.get("/me/profile").json() == body


def test_ac3_profile_is_seeker_only(
    client: TestClient, outbox: Outbox, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    client.cookies.clear()
    for anonymous in (client.get("/me/profile"), _put(client, _p(gush_dan))):
        assert anonymous.status_code == 401
        assert anonymous.json() == {"detail": "unauthenticated"}

    owner = signup(client, outbox, "o@example.com", "owner")
    for forbidden in (owner.get("/me/profile"), _put(owner, _p(gush_dan))):
        assert forbidden.status_code == 403
        assert forbidden.json() == {"detail": "seeker_only"}
    assert _profile_count(db_engine) == 0


def _inactive_area(engine: Engine) -> uuid.UUID:
    with engine.begin() as conn:
        area_id: uuid.UUID = conn.execute(
            text(
                "INSERT INTO areas (slug, name_he, geom, is_active) "
                "VALUES ('closed-area', 'closed', ST_GeomFromText(:wkt, 4326), false) RETURNING id"
            ),
            {"wkt": GUSH_DAN_WKT},
        ).scalar_one()
    return area_id


def _without(body: dict[str, Any], key: str) -> dict[str, Any]:
    return {k: v for k, v in body.items() if k != key}


# (case id, how to turn `P` into the bad body). `a` is the seeded gush-dan, `e` the engine. `None`
# expects a list `detail` (malformed); a string expects `{"detail": <it>}`.
_CASES: list[tuple[str, Any, str | None]] = [
    ("budget_499", lambda p, a, e: {**p, "budget_max_ils": 499}, None),
    ("budget_100001", lambda p, a, e: {**p, "budget_max_ils": 100_001}, None),
    ("budget_fraction", lambda p, a, e: {**p, "budget_max_ils": 7500.5}, None),
    (
        "move_in_yesterday",
        lambda p, a, e: {**p, "move_in_date": (_today() - dt.timedelta(days=1)).isoformat()},
        None,
    ),
    (
        "move_in_366_days",
        lambda p, a, e: {**p, "move_in_date": (_today() + dt.timedelta(days=366)).isoformat()},
        None,
    ),
    ("area_ids_empty", lambda p, a, e: {**p, "area_ids": []}, None),
    ("area_ids_duplicate", lambda p, a, e: {**p, "area_ids": [str(a), str(a)]}, None),
    (
        "area_ids_21",
        lambda p, a, e: {**p, "area_ids": [str(uuid.uuid4()) for _ in range(21)]},
        None,
    ),
    ("household_group", lambda p, a, e: {**p, "household": "group"}, None),
    ("contract_18", lambda p, a, e: {**p, "contract_months": 18}, None),
    ("parking_3", lambda p, a, e: {**p, "parking_needed": 3}, None),
    ("parking_minus_1", lambda p, a, e: {**p, "parking_needed": -1}, None),
    ("no_has_pets", lambda p, a, e: _without(p, "has_pets"), None),
    ("no_smoker", lambda p, a, e: _without(p, "smoker"), None),
    ("no_household", lambda p, a, e: _without(p, "household"), None),
    ("area_random", lambda p, a, e: {**p, "area_ids": [str(uuid.uuid4())]}, "unknown_area"),
    (
        "area_inactive",
        lambda p, a, e: {**p, "area_ids": [str(_inactive_area(e))]},
        "unknown_area",
    ),
    (
        "area_one_unknown_among_valid",
        lambda p, a, e: {**p, "area_ids": [str(a), str(uuid.uuid4())]},
        "unknown_area",
    ),
]


@pytest.mark.parametrize(
    ("make_body", "detail"), [(m, d) for _, m, d in _CASES], ids=[i for i, _, _ in _CASES]
)
def test_ac4_profile_validation(
    seeker: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
    make_body: Any,
    detail: str | None,
) -> None:
    response = _put(seeker, make_body(_p(gush_dan), gush_dan, db_engine))

    assert response.status_code == 422, response.text
    if detail is None:
        assert isinstance(response.json()["detail"], list)
    else:
        assert response.json() == {"detail": detail}
    assert _profile_count(db_engine) == 0


def test_ac10_profile_is_private_to_its_seeker(
    client: TestClient, outbox: Outbox, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    s = signup(client, outbox, "s@example.com", "seeker")
    saved = _put(s, _p(gush_dan, budget_max_ils=8100))
    assert saved.status_code == 200, saved.text
    make_profile(db_engine, make_seeker(db_engine, "u@example.com"), gush_dan)
    t = signup(client, outbox, "t@example.com", "seeker")

    response = t.get("/me/profile")

    assert response.status_code == 404
    assert response.json() == NOT_FOUND
    assert "8100" not in response.text
    # T's own PUT writes T's row and leaves S's untouched.
    assert _put(t, _p(gush_dan, budget_max_ils=6000)).status_code == 200
    assert t.get("/me/profile").json()["budget_max_ils"] == 6000
    assert s.get("/me/profile").json() == saved.json()


# --- 0007a: the room section -----------------------------------------------------------------


def _year() -> int:
    """`Y`: the current UTC year, the API's age window."""
    return dt.datetime.now(dt.UTC).year


def _s() -> dict[str, Any]:
    """`S`: a full room section."""
    return {
        "gender": "woman",
        "birth_year": _year() - 30,
        "flatmate_gender": "women",
        "lifestyle": {
            "cleanliness": 3,
            "guests": 1,
            "night": 2,
            "social": 3,
            "kosher": 2,
            "shabbat": 1,
            "work_from_home": 3,
        },
    }


def _room_row(engine: Engine) -> tuple[Any, ...]:
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT gender, birth_year, flatmate_gender, lifestyle FROM seeker_profiles")
        ).one()
    return tuple(row)


def test_ac6_room_section_saved_read_and_cleared(
    seeker: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    room = _s()
    response = _put(seeker, {**_p(gush_dan), **room})
    assert response.status_code == 200, response.text
    saved = response.json()
    assert set(saved) == PROFILE_KEYS
    assert {k: saved[k] for k in ROOM_OFF} == room
    assert seeker.get("/me/profile").json() == saved

    # Gender alone is a room section.
    response = _put(seeker, {**_p(gush_dan), "gender": "other", "lifestyle": {"night": 3}})
    assert response.status_code == 200, response.text
    assert {k: response.json()[k] for k in ROOM_OFF} == {
        "gender": "other",
        "birth_year": None,
        "flatmate_gender": "any",
        "lifestyle": {"night": 3},
    }

    for birth_year in (_year() - 18, _year() - 99):  # age bounds inclusive
        response = _put(seeker, {**_p(gush_dan), "gender": "man", "birth_year": birth_year})
        assert response.status_code == 200, (birth_year, response.text)
        assert response.json()["birth_year"] == birth_year

    # PUT replaces: omitting the section clears it.
    response = _put(seeker, _p(gush_dan))
    assert response.status_code == 200, response.text
    assert {k: response.json()[k] for k in ROOM_OFF} == ROOM_OFF
    assert _room_row(db_engine) == (None, None, "any", {})
    assert _profile_count(db_engine) == 1


# (case id, the change to `P`, the sent value the response must not echo, if any)
_WOMAN = {"gender": "woman"}
_ROOM_CASES: list[tuple[str, Any, Any]] = [
    ("gender_female", lambda: {"gender": "female"}, "female"),
    ("gender_empty", lambda: {"gender": ""}, None),
    ("birth_year_age_17", lambda: {**_WOMAN, "birth_year": _year() - 17}, _year() - 17),
    ("birth_year_age_100", lambda: {**_WOMAN, "birth_year": _year() - 100}, _year() - 100),
    ("birth_year_fraction", lambda: {**_WOMAN, "birth_year": 1990.5}, None),
    ("flatmate_gender_mixed", lambda: {**_WOMAN, "flatmate_gender": "mixed"}, None),
    ("flatmate_gender_null", lambda: {**_WOMAN, "flatmate_gender": None}, None),
    ("lifestyle_unknown_key", lambda: {**_WOMAN, "lifestyle": {"pets": 2}}, None),
    ("lifestyle_0", lambda: {**_WOMAN, "lifestyle": {"night": 0}}, None),
    ("lifestyle_4", lambda: {**_WOMAN, "lifestyle": {"night": 4}}, None),
    ("lifestyle_string", lambda: {**_WOMAN, "lifestyle": {"night": "2"}}, None),
    ("lifestyle_list", lambda: {**_WOMAN, "lifestyle": []}, None),
    ("lifestyle_null", lambda: {**_WOMAN, "lifestyle": None}, None),
    ("no_gender_birth_year", lambda: {"birth_year": _year() - 30}, None),
    ("no_gender_flatmate_gender", lambda: {"flatmate_gender": "women"}, None),
    ("no_gender_lifestyle", lambda: {"lifestyle": {"night": 2}}, None),
    ("null_gender_birth_year", lambda: {"gender": None, "birth_year": _year() - 30}, None),
]


@pytest.mark.parametrize(
    ("change", "not_echoed"),
    [(c, e) for _, c, e in _ROOM_CASES],
    ids=[i for i, _, _ in _ROOM_CASES],
)
def test_ac7_room_section_validation(
    seeker: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
    change: Any,
    not_echoed: Any,
) -> None:
    response = _put(seeker, {**_p(gush_dan), **change()})

    assert response.status_code == 422, response.text
    assert isinstance(response.json()["detail"], list)
    if not_echoed is not None:
        assert str(not_echoed) not in response.text
    assert _profile_count(db_engine) == 0


def test_nf2_lifestyle_unknown_keys_one_error_no_echo(
    seeker: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    # Review round 1 (security): one error at the field, never one per key, never naming a key.
    many = {**{f"k{n}": 2 for n in range(19_999)}, "I am pregnant": 2}
    eight = {**_s()["lifestyle"], "I am pregnant": 1}
    for lifestyle in (many, eight):
        response = _put(seeker, {**_p(gush_dan), "gender": "woman", "lifestyle": lifestyle})

        assert response.status_code == 422, response.text[:500]
        detail = response.json()["detail"]
        assert [entry["loc"] for entry in detail] == [["body", "lifestyle"]]
        assert "I am pregnant" not in response.text
    assert _profile_count(db_engine) == 0
