"""Lifestyle in the match score (spec 0007g): AC1 (search and the listing page) and AC2 (`explain`).
AC3 and AC4 (the owner's inbox) are in `test_inbox.py`.

`R0` is 0006b's `L0` as a room for two flatmates, for anyone (`gender_preference` 'any'); the seeker
is 0006b's `P0` with a woman / any room section. Every date comes from one UTC `TODAY`
(`test_matching.py`), as the database's `current_date` is UTC."""

import uuid
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine

from app.matching.score import explain
from app.schemas.profile import LIFESTYLE_KEYS
from tests.conftest import Outbox, make_owner
from tests.test_matching import TOP3, _area, _day, _l0, _match, _search, _seeker, _values


@pytest.fixture
def owner(db_engine: Engine) -> uuid.UUID:
    return make_owner(db_engine, "owner@example.com")


@pytest.fixture
def north(db_engine: Engine, gush_dan: uuid.UUID) -> uuid.UUID:
    """A second active area, not in `P0`'s `area_ids`."""
    return _area(db_engine, "north", active=True)


ROOM: dict[str, Any] = {"listing_type": "room", "flatmates_count": 2}
FULL_AGREE = {"guests": 2, "social": 3}
ALL_ONE = dict.fromkeys(LIFESTYLE_KEYS, 1)
ALL_THREE = dict.fromkeys(LIFESTYLE_KEYS, 3)


def _room(**lifestyle: int) -> dict[str, Any]:
    return {**ROOM, "lifestyle": lifestyle}


def _woman(**lifestyle: int) -> dict[str, Any]:
    """`P0`'s room section: a woman, flatmates 'any', these answers."""
    return {"gender": "woman", "lifestyle": lifestyle}


# (listing overrides, profile overrides, expected match). "area": "north" = that area. The listing
# is `R0` unless its overrides say otherwise; answers are written as listing / seeker.
LIFESTYLE_ROWS: dict[str, tuple[dict[str, Any], dict[str, Any], dict[str, Any]]] = {
    # Shared terms: cleanliness 1, night 0 -> m 0.5: 80 + 10.
    "1_half_agreement": (
        _room(cleanliness=3, night=1, kosher=2),
        _woman(cleanliness=3, night=3, shabbat=1),
        _match(90, TOP3, "lifestyle"),
    ),
    # m 1: lifestyle (20) ties budget (25 * 0.8) and sorts after it by index.
    "2_full_agreement": (
        _room(**FULL_AGREE),
        _woman(**FULL_AGREE),
        _match(100, ["budget", "lifestyle", "move_in"], None),
    ),
    # No shared key: m NULL, the score and explanation are 0006b's.
    "3_no_shared_key": (_room(kosher=3), _woman(night=1), _match(100, TOP3, None)),
    # m 2.5 / 3: 80 + 16.67 = 96.67.
    "4_mean_over_shared_keys": (
        _room(cleanliness=3, guests=1, night=2),
        _woman(cleanliness=3, guests=1, night=3),
        _match(97, TOP3, "lifestyle"),
    ),
    # B 75: 60 + 20 = 80, capped at 59.
    "5_over_budget_capped": (
        {**_room(**FULL_AGREE), "price_ils": 7600},
        _woman(**FULL_AGREE),
        _match(59, ["lifestyle", "move_in", "area"], "budget"),
    ),
    # B 55: 44 + 0, below the cap. Budget and area both fail; budget comes first by index.
    "6_below_the_cap": (
        {**_room(night=1), "price_ils": 7600, "area": "north"},
        _woman(night=3),
        _match(44, ["move_in", "household", "contract"], "budget"),
    ),
    # B 90: 72 + 20 = 92, higher than the base score (Risks Q1).
    "7_raises_the_score": (
        {**_room(**FULL_AGREE), "accepted_households": ["family"]},
        _woman(**FULL_AGREE),
        _match(92, ["budget", "lifestyle", "move_in"], "household"),
    ),
    "8_apartment": ({}, _woman(night=1), _match(100, TOP3, None)),
    "9_no_room_section": (_room(night=1), {}, _match(100, TOP3, None)),
    # B 92.5 (move-in 7 days late: 15; parking 1 of 2: 2.5), m 2/3: 74 + 13.33 = 87.33 -> 87.
    # Rounding B first would give round(0.8 * 93 + 13.33) = 88.
    "10_one_round_only": (
        {**_room(cleanliness=3, guests=1, night=1), "available_from": _day(37)},
        {**_woman(cleanliness=3, guests=2, night=2), "parking_needed": 2},
        _match(87, ["budget", "area", "move_in"], "lifestyle"),
    ),
    # t 0, 0, 0, 0.5 -> m 0.125: 80 + 2.5 = 82.5 rounds half up to 83 (a float bind gives 82).
    "11_half_way_rounds_up": (
        _room(cleanliness=1, guests=1, night=1, social=1),
        _woman(cleanliness=3, guests=3, night=3, social=2),
        _match(83, TOP3, "lifestyle"),
    ),
    # The seeker's room section has no answers: m NULL.
    "12_seeker_has_no_answers": (_room(night=1), _woman(), _match(100, TOP3, None)),
    # The denominator counts shared keys only: 1 shared of 7, agreed -> m 1.
    "13_shared_keys_only": (
        _room(**ALL_ONE),
        _woman(night=1),
        _match(100, ["budget", "lifestyle", "move_in"], None),
    ),
    # All 7 shared, maximum disagreement: m 0 -> 80.
    "14_all_keys_max_disagreement": (
        _room(**ALL_ONE),
        _woman(**ALL_THREE),
        _match(80, TOP3, "lifestyle"),
    ),
    # All 7 shared: two agree, five at the far end: m 2/7 -> 80 + 5.71 = 85.71.
    "15_all_keys_mixed": (
        _room(**ALL_ONE),
        _woman(**{**ALL_THREE, "cleanliness": 1, "guests": 1}),
        _match(86, TOP3, "lifestyle"),
    ),
}


@pytest.mark.usefixtures("redis_clean")
@pytest.mark.parametrize("row", list(LIFESTYLE_ROWS))
def test_ac1_lifestyle_score_and_explanation(
    client: TestClient,
    outbox: Outbox,
    db_engine: Engine,
    gush_dan: uuid.UUID,
    north: uuid.UUID,
    owner: uuid.UUID,
    row: str,
) -> None:
    listing_overrides, profile_overrides, expected = LIFESTYLE_ROWS[row]
    listing_overrides = dict(listing_overrides)
    area = north if listing_overrides.pop("area", None) == "north" else gush_dan
    listing_id = _l0(db_engine, owner, area, **listing_overrides)
    seeker = _seeker(client, outbox, db_engine, gush_dan, **profile_overrides)

    page = seeker.get(f"/listings/{listing_id}")
    assert page.status_code == 200, page.text
    assert page.json()["match"] == expected

    body = _search(seeker)
    assert [item["id"] for item in body["items"]] == [listing_id]
    assert body["items"][0]["match"] == expected


@pytest.mark.parametrize(
    ("values", "agrees", "differs"),
    [
        pytest.param(
            _values(m_lifestyle=Decimal(1)),
            ["budget", "lifestyle", "move_in"],
            None,
            id="full_agreement_ties_budget",
        ),
        pytest.param(
            _values(m_lifestyle=Decimal("0.5"), m_score=90),
            TOP3,
            "lifestyle",
            id="half_agreement_differs",
        ),
        pytest.param(
            _values(m_lifestyle=Decimal(0), m_household=Decimal(0), m_score=72),
            TOP3,
            "lifestyle",
            id="gap_20_beats_household_8",
        ),
        pytest.param(
            _values(m_lifestyle=Decimal(0), m_pets=Decimal(0), f_pets=True, m_score=59),
            TOP3,
            "pets",
            id="failing_beats_lifestyle",
        ),
    ],
)
def test_ac2_lifestyle_explain_rules(
    values: dict[str, Any], agrees: list[str], differs: str | None
) -> None:
    match = explain(values)

    assert match.agrees == agrees
    assert match.differs == differs
    assert match.score == values["m_score"]
    if values["m_lifestyle"] == 0:
        assert "lifestyle" not in match.agrees
