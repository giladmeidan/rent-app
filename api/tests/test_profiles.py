"""Seeker housing profile API (spec 0006a): AC1-AC4 and AC10 (AC5, AC6 are in
`test_applications.py`, AC7, AC8 in `test_listings.py`, AC9 in `test_migrations.py`). Spec 0008a's
AC13 (`people_visible`, `about_me`) and the `AboutMe` unit tests are at the end."""

import datetime as dt
import uuid
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import TypeAdapter, ValidationError
from sqlalchemy import Engine, text

from app.schemas.profile import ABOUT_ME_MAX_LENGTH, AboutMe
from tests.conftest import Outbox, insert_settlement, make_profile, make_seeker, signup

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
    "shelter_needed",  # 0015b
    "gender",
    "birth_year",
    "flatmate_gender",
    "lifestyle",
    "people_visible",  # 0008a
    "about_me",
    "updated_at",
}
# The room section of a profile without one (spec 0007a).
ROOM_OFF: dict[str, Any] = {
    "gender": None,
    "birth_year": None,
    "flatmate_gender": "any",
    "lifestyle": {},
}
# People browse off (spec 0008a), as a profile without the two fields stores it.
PEOPLE_OFF: dict[str, Any] = {"people_visible": False, "about_me": None}
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
        "shelter_needed": "any",  # 0015b
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
    assert {k: v for k, v in saved.items() if k != "updated_at"} == {
        **ROOM_OFF,
        **PEOPLE_OFF,
        **body,
    }
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
    assert {k: v for k, v in body.items() if k != "updated_at"} == {
        **ROOM_OFF,
        **PEOPLE_OFF,
        **changed,
    }
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


def test_ac3_profile_for_any_account(
    client: TestClient, outbox: Outbox, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    """Spec 0010b AC6: the profile ("a person looking") is open to every account."""
    client.cookies.clear()
    for anonymous in (client.get("/me/profile"), _put(client, _p(gush_dan))):
        assert anonymous.status_code == 401
        assert anonymous.json() == {"detail": "unauthenticated"}
    assert _profile_count(db_engine) == 0

    owner = signup(client, outbox, "o@example.com", "owner")
    missing = owner.get("/me/profile")
    assert missing.status_code == 404
    assert missing.json() == NOT_FOUND
    body = _p(gush_dan)
    saved = _put(owner, body)
    assert saved.status_code == 200, saved.text
    assert {k: v for k, v in saved.json().items() if k != "updated_at"} == {
        **ROOM_OFF,
        **PEOPLE_OFF,
        **body,
    }
    read = owner.get("/me/profile")
    assert read.status_code == 200
    assert read.json() == saved.json()
    assert _profile_count(db_engine) == 1


def _inactive_area(engine: Engine) -> uuid.UUID:
    return insert_settlement(engine, 6300, "closed", active=False)


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
    # 4,000 keys: 20,000 is now a 413 `body_too_large` (spec 0011c, test_hardening.py AC12).
    many = {**{f"k{n}": 2 for n in range(3_999)}, "I am pregnant": 2}
    eight = {**_s()["lifestyle"], "I am pregnant": 1}
    for lifestyle in (many, eight):
        response = _put(seeker, {**_p(gush_dan), "gender": "woman", "lifestyle": lifestyle})

        assert response.status_code == 422, response.text[:500]
        detail = response.json()["detail"]
        assert [entry["loc"] for entry in detail] == [["body", "lifestyle"]]
        assert "I am pregnant" not in response.text
    assert _profile_count(db_engine) == 0


# --- 0008a: people browse fields (`people_visible`, `about_me`), the room section's too

_ABOUT_ME_BAD = [
    ("too_long", "x" * 301),
    ("spaces", "   "),
    ("empty", ""),
    ("private_use", "hi  there"),
    ("no_letter_or_digit", "..."),
    ("bidi_override", "hi‮there"),
    ("lone_cr", "line\rline"),
]


@pytest.mark.parametrize(
    ("value"), [v for _, v in _ABOUT_ME_BAD], ids=[i for i, _ in _ABOUT_ME_BAD]
)
def test_about_me_type_rejects(value: str) -> None:
    with pytest.raises(ValidationError):
        TypeAdapter(AboutMe).validate_python(value)


def test_about_me_type_strips_and_normalises_newlines() -> None:
    adapter = TypeAdapter(AboutMe)
    assert adapter.validate_python("  Quiet\r\ntidy  ") == "Quiet\ntidy"
    assert adapter.validate_python("x" * ABOUT_ME_MAX_LENGTH) == "x" * ABOUT_ME_MAX_LENGTH
    # 300 after the strip: surrounding spaces do not count.
    assert adapter.validate_python(f"  {'x' * ABOUT_ME_MAX_LENGTH}  ") == "x" * ABOUT_ME_MAX_LENGTH


def _people_row(engine: Engine) -> tuple[Any, ...]:
    with engine.connect() as conn:
        row = conn.execute(text("SELECT people_visible, about_me FROM seeker_profiles")).one()
    return tuple(row)


def test_ac13_people_fields(seeker: TestClient, gush_dan: uuid.UUID, db_engine: Engine) -> None:
    for change in ({"people_visible": True}, {"about_me": "Hello there"}):
        response = _put(seeker, {**_p(gush_dan), **change})
        assert response.status_code == 422, (change, response.text)
        assert isinstance(response.json()["detail"], list)
    for _, bad in _ABOUT_ME_BAD:
        response = _put(seeker, {**_p(gush_dan), **_WOMAN, "about_me": bad})
        assert response.status_code == 422, (bad, response.text)
        assert [entry["loc"] for entry in response.json()["detail"]] == [["body", "about_me"]]
        assert "input" not in response.text
    assert _profile_count(db_engine) == 0

    body = {**_p(gush_dan), **_WOMAN, "people_visible": True, "about_me": "  Quiet\r\ntidy  "}
    response = _put(seeker, body)
    assert response.status_code == 200, response.text
    saved = response.json()
    assert (saved["people_visible"], saved["about_me"]) == (True, "Quiet\ntidy")
    assert _people_row(db_engine) == (True, "Quiet\ntidy")
    assert seeker.get("/me/profile").json() == saved

    longest = _put(seeker, {**_p(gush_dan), **_WOMAN, "about_me": "x" * 300})
    assert longest.status_code == 200, longest.text
    assert longest.json()["about_me"] == "x" * 300

    # PUT replaces: omitting both turns people browse off and clears the text.
    response = _put(seeker, {**_p(gush_dan), **_WOMAN})
    assert response.status_code == 200, response.text
    assert {k: response.json()[k] for k in PEOPLE_OFF} == PEOPLE_OFF
    assert _people_row(db_engine) == (False, None)
    assert seeker.get("/me/profile").json() == response.json()
    explicit = _put(seeker, {**_p(gush_dan), "people_visible": False, "about_me": None})
    assert explicit.status_code == 200, explicit.text  # off and empty need no room section


# --- 0010c: the personal part and the looking part ----------------------------------------------

# The looking part of a profile without one (spec 0010c): the 7 NULL, the defaults restored.
LOOKING_OFF: dict[str, Any] = {
    "budget_max_ils": None,
    "move_in_date": None,
    "move_in_flexible": False,
    "area_ids": None,
    "household": None,
    "has_pets": None,
    "smoker": None,
    "contract_months": None,
    "parking_needed": 0,
    "shelter_needed": "any",
    "flatmate_gender": "any",
    "people_visible": False,
}
_LOOKING_KEYS = (
    "budget_max_ils",
    "move_in_date",
    "area_ids",
    "household",
    "has_pets",
    "smoker",
    "contract_months",
)


def _personal() -> dict[str, Any]:
    """The personal part alone: gender, birth year, about me, answers."""
    return {
        "gender": "man",
        "birth_year": _year() - 30,
        "about_me": "Quiet and tidy",
        "lifestyle": {"night": 2, "guests": 1},
    }


def _row(engine: Engine) -> dict[str, Any]:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT budget_max_ils, move_in_date, move_in_flexible, area_ids, household,"
                " has_pets, smoker, contract_months, parking_needed, shelter_needed, gender,"
                " birth_year,"
                " flatmate_gender, lifestyle, people_visible, about_me FROM seeker_profiles"
            )
        ).one()
    return dict(row._mapping)


def test_ac1_either_part_alone(client: TestClient, outbox: Outbox, gush_dan: uuid.UUID) -> None:
    personal = signup(client, outbox, "p@example.com", "seeker")
    assert personal.get("/me/profile").status_code == 404
    response = _put(personal, _personal())
    assert response.status_code == 200, response.text
    saved = response.json()
    assert set(saved) == PROFILE_KEYS
    assert {k: v for k, v in saved.items() if k != "updated_at"} == {**LOOKING_OFF, **_personal()}
    assert personal.get("/me/profile").json() == saved

    # Today's body: the whole looking part, no gender.
    looking = signup(client, outbox, "l@example.com", "seeker")
    body = _p(gush_dan)
    response = _put(looking, body)
    assert response.status_code == 200, response.text
    assert {k: v for k, v in response.json().items() if k != "updated_at"} == {
        **ROOM_OFF,
        **PEOPLE_OFF,
        **body,
    }


# (case id, the body from `P` (`p`) and the area id (`a`), a sent value the response must not echo)
_PART_CASES: list[tuple[str, Any, Any]] = [
    *(
        (f"six_of_seven_without_{key}", lambda p, a, key=key: {**_without(p, key), **_WOMAN}, None)
        for key in _LOOKING_KEYS
    ),
    (
        "looking_null_budget",
        lambda p, a: {**p, **_WOMAN, "budget_max_ils": None},
        None,
    ),
    ("parking_without_looking", lambda p, a: {**_WOMAN, "parking_needed": 1}, None),
    ("flexible_without_looking", lambda p, a: {**_WOMAN, "move_in_flexible": True}, None),
    ("people_visible_looking_only", lambda p, a: {**p, "people_visible": True}, None),
    ("people_visible_personal_only", lambda p, a: {**_personal(), "people_visible": True}, None),
    ("about_me_without_gender", lambda p, a: {**p, "about_me": "Secret words"}, "Secret words"),
    ("flatmate_gender_without_gender", lambda p, a: {**p, "flatmate_gender": "women"}, None),
    (
        "flatmate_gender_without_looking",
        lambda p, a: {"gender": "woman", "flatmate_gender": "women"},
        None,
    ),
    ("empty_body", lambda p, a: {}, None),
    ("only_defaults", lambda p, a: {"move_in_flexible": False, "parking_needed": 0}, None),
]


@pytest.mark.parametrize(
    ("make_body", "not_echoed"),
    [(m, e) for _, m, e in _PART_CASES],
    ids=[i for i, _, _ in _PART_CASES],
)
def test_ac2_part_rules(
    seeker: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
    make_body: Any,
    not_echoed: Any,
) -> None:
    response = _put(seeker, make_body(_p(gush_dan), gush_dan))

    assert response.status_code == 422, response.text
    detail = response.json()["detail"]
    assert isinstance(detail, list)
    assert "input" not in response.text
    if not_echoed is not None:
        assert str(not_echoed) not in response.text
    assert _profile_count(db_engine) == 0


def test_ac2_part_rules_messages(seeker: TestClient, gush_dan: uuid.UUID) -> None:
    """Each rule names its part, in `_parts`' order."""

    def message(body: dict[str, Any]) -> str:
        response = _put(seeker, body)
        assert response.status_code == 422, response.text
        [entry] = response.json()["detail"]
        msg: str = entry["msg"]
        return msg

    assert "sent together (the looking part)" in message(
        {**_without(_p(gush_dan), "smoker"), **_WOMAN}
    )
    assert "need the looking part" in message({"gender": "woman", "flatmate_gender": "women"})
    assert "need gender (the personal part)" in message({**_p(gush_dan), "about_me": "Hi"})
    assert "the personal part, the looking part or both" in message({})


def test_ac3_put_replaces_each_part(
    seeker: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    full = {
        **_p(gush_dan, move_in_flexible=True, parking_needed=2),
        **_s(),
        "people_visible": True,
        "about_me": "Hello there",
    }
    response = _put(seeker, full)
    assert response.status_code == 200, response.text

    # Drop the looking part: it clears, its defaults return, the card switch turns off.
    personal = {k: full[k] for k in ("gender", "birth_year", "lifestyle", "about_me")}
    response = _put(seeker, personal)
    assert response.status_code == 200, response.text
    saved = response.json()
    assert {k: v for k, v in saved.items() if k != "updated_at"} == {**LOOKING_OFF, **personal}
    assert _row(db_engine) == {**LOOKING_OFF, **personal}
    assert seeker.get("/me/profile").json() == saved

    # Only the looking part: the personal part clears.
    looking = _p(gush_dan)
    response = _put(seeker, looking)
    assert response.status_code == 200, response.text
    assert {k: v for k, v in response.json().items() if k != "updated_at"} == {
        **ROOM_OFF,
        **PEOPLE_OFF,
        **looking,
    }
    row = _row(db_engine)
    assert (row["gender"], row["birth_year"], row["lifestyle"], row["about_me"]) == (
        None,
        None,
        {},
        None,
    )
    assert row["budget_max_ils"] == 7500
    assert _profile_count(db_engine) == 1

    # `unknown_area` is checked only when `area_ids` is sent: with the only area inactive, the
    # personal part alone saves and the looking part is refused.
    with db_engine.begin() as conn:
        conn.execute(text("UPDATE areas SET is_active = false WHERE id = :id"), {"id": gush_dan})
    assert _put(seeker, looking).json() == {"detail": "unknown_area"}
    response = _put(seeker, personal)
    assert response.status_code == 200, response.text
    assert response.json()["budget_max_ils"] is None


def test_ac8_any_account(
    client: TestClient, outbox: Outbox, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    client.cookies.clear()
    for anonymous in (client.get("/me/profile"), _put(client, _personal())):
        assert anonymous.status_code == 401
        assert anonymous.json() == {"detail": "unauthenticated"}
    assert _profile_count(db_engine) == 0

    owner = signup(client, outbox, "o@example.com", "owner")
    assert owner.get("/me/profile").json() == NOT_FOUND
    saved = _put(owner, _personal())
    assert saved.status_code == 200, saved.text
    assert saved.json()["gender"] == "man"
    assert saved.json()["budget_max_ils"] is None
    assert owner.get("/me/profile").json() == saved.json()
    both = _put(owner, {**_p(gush_dan), **_personal(), "people_visible": True})
    assert both.status_code == 200, both.text
    assert both.json()["people_visible"] is True
    assert _profile_count(db_engine) == 1


# --- 0015b: the protected-space preference -------------------------------------------------------


def test_ac1_shelter_needed_round_trip(
    seeker: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    response = _put(seeker, _p(gush_dan, shelter_needed="mamad"))
    assert response.status_code == 200, response.text
    assert response.json()["shelter_needed"] == "mamad"
    assert seeker.get("/me/profile").json()["shelter_needed"] == "mamad"

    # Without the field (today's clients): `any`.
    response = _put(seeker, _without(_p(gush_dan), "shelter_needed"))
    assert response.status_code == 200, response.text
    assert seeker.get("/me/profile").json()["shelter_needed"] == "any"

    response = _put(seeker, _p(gush_dan, shelter_needed="bunker"))
    assert response.status_code == 422, response.text
    assert [entry["loc"] for entry in response.json()["detail"]] == [["body", "shelter_needed"]]
    assert _row(db_engine)["shelter_needed"] == "any"


def test_ac2_shelter_needed_needs_looking_part(
    seeker: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    response = _put(seeker, {**_personal(), "shelter_needed": "protected"})
    assert response.status_code == 422, response.text
    [entry] = response.json()["detail"]
    assert "need the looking part" in entry["msg"]
    assert _profile_count(db_engine) == 0

    response = _put(seeker, {**_p(gush_dan, shelter_needed="protected"), **_personal()})
    assert response.status_code == 200, response.text
    assert _row(db_engine)["shelter_needed"] == "protected"
    # Clearing the looking part writes `any`.
    response = _put(seeker, _personal())
    assert response.status_code == 200, response.text
    assert response.json()["shelter_needed"] == "any"
    assert _row(db_engine)["shelter_needed"] == "any"


def test_ac7_area_kinds(seeker: TestClient, gush_dan: uuid.UUID, db_engine: Engine) -> None:
    """Spec 0021a1: preferred areas may be settlements and neighbourhoods; inactive ones are not."""
    with db_engine.begin() as conn:
        hood = conn.execute(
            text(
                "INSERT INTO areas (slug, name_he, kind, source_code, parent_id, centre, geom)"
                " SELECT 'n-1', 'רביבים', 'neighbourhood', 1, id, centre, geom FROM areas"
                " WHERE id = :tel_aviv RETURNING id"
            ),
            {"tel_aviv": gush_dan},
        ).scalar_one()

    body = {**_p(gush_dan), "area_ids": [str(gush_dan), str(hood)]}
    response = _put(seeker, body)
    assert response.status_code == 200, response.text
    assert response.json()["area_ids"] == [str(gush_dan), str(hood)]

    closed = _inactive_area(db_engine)
    response = _put(seeker, {**body, "area_ids": [str(hood), str(closed)]})
    assert response.status_code == 422
    assert response.json() == {"detail": "unknown_area"}
