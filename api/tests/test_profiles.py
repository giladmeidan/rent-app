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
    "updated_at",
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
    assert {k: v for k, v in saved.items() if k != "updated_at"} == body
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
    assert {k: v for k, v in body.items() if k != "updated_at"} == changed
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
