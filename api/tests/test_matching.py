"""Match score on search and the listing page (spec 0006b): AC1-AC11 (AC9's 422 half is
`test_search.py::test_ac7_validation_rejects_bad_params`).

Every date comes from one UTC `TODAY`: the database's `current_date` is UTC, `make_listing`'s
default is the host's local date. Past dates are set by SQL relative to `current_date`."""

import datetime as dt
import uuid
from collections.abc import Iterator
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, event, text

from app.matching.score import CRITERIA, HARD, WEIGHTS, explain
from tests.conftest import (
    Outbox,
    insert_settlement,
    make_listing,
    make_owner,
    make_profile,
    set_location,
    signup,
)

TODAY = dt.datetime.now(dt.UTC).date()
NOT_FOUND = {"detail": "not_found"}


def _day(days: int) -> dt.date:
    return TODAY + dt.timedelta(days=days)


def _execute(engine: Engine, sql: str, **params: Any) -> None:
    with engine.begin() as conn:
        conn.execute(text(sql), params)


def _area(engine: Engine, code: int, active: bool) -> uuid.UUID:
    return insert_settlement(engine, code, "אזור", active=active)


@pytest.fixture
def north(db_engine: Engine, gush_dan: uuid.UUID) -> uuid.UUID:
    """A second active area, not in `P0`'s `area_ids`."""
    return _area(db_engine, 6300, active=True)


@pytest.fixture
def owner(db_engine: Engine) -> uuid.UUID:
    return make_owner(db_engine, "owner@example.com")


@pytest.fixture
def statements(db_engine: Engine) -> Iterator[list[str]]:
    """Every SQL statement the app engine sends while the test records (`.clear()` to start)."""
    seen: list[str] = []

    def record(_conn: Any, _cursor: Any, statement: str, *_: Any) -> None:
        seen.append(statement)

    event.listen(db_engine, "before_cursor_execute", record)
    yield seen
    event.remove(db_engine, "before_cursor_execute", record)


def _l0(engine: Engine, owner: uuid.UUID, area: uuid.UUID, **overrides: Any) -> str:
    """`L0`: 7000, available `TODAY` + 30, not flexible, all households, smoking allowed, no
    minimum contract, one parking spot, pets allowed; `overrides` win."""
    values: dict[str, Any] = {
        "price_ils": 7000,
        "available_from": _day(30),
        "entry_flexible": False,
        "smoking_allowed": True,
        "min_contract_months": None,
        "parking_spots": 1,
        "pets_allowed": True,
        **overrides,
    }
    return str(make_listing(engine, owner, area, **values))


def _user_id(caller: TestClient) -> uuid.UUID:
    return uuid.UUID(caller.get("/me").json()["id"])


def _seeker(
    client: TestClient,
    outbox: Outbox,
    engine: Engine,
    area: uuid.UUID,
    email: str = "seeker@example.com",
    **profile: Any,
) -> TestClient:
    """A signed-up seeker with `P0` (`make_profile`'s defaults; `profile` overrides)."""
    seeker = signup(client, outbox, email, "seeker")
    make_profile(engine, _user_id(seeker), area, **profile)
    return seeker


def _expire_sessions(engine: Engine, caller: TestClient) -> None:
    _execute(
        engine,
        "UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE user_id = :id",
        id=_user_id(caller),
    )


def _search(caller: TestClient, query: str = "") -> dict[str, Any]:
    response = caller.get(f"/listings?{query}" if query else "/listings")
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def _ids(body: dict[str, Any]) -> list[str]:
    return [item["id"] for item in body["items"]]


def _match(score: int, agrees: list[str], differs: str | None) -> dict[str, Any]:
    return {"score": score, "agrees": agrees, "differs": differs}


TOP3 = ["budget", "move_in", "area"]

# (listing overrides, profile overrides, SQL after insert, expected match). "north" = that area.
AC1_ROWS: dict[str, tuple[dict[str, Any], dict[str, Any], tuple[str, ...], dict[str, Any]]] = {
    "1_l0": ({}, {}, (), _match(100, TOP3, None)),
    "2_over_budget": (
        {"price_ils": 7600},
        {},
        (),
        _match(59, ["move_in", "area", "household"], "budget"),
    ),
    "3_move_in_outside_window": (
        {"available_from": _day(70)},
        {},
        (),
        _match(59, ["budget", "area", "household"], "move_in"),
    ),
    "4_both_flexible": (
        {"available_from": _day(70), "entry_flexible": True},
        {"move_in_flexible": True},
        (),
        _match(91, ["budget", "area", "household"], "move_in"),
    ),
    "5_other_area": (
        {"area": "north"},
        {},
        (),
        _match(59, ["budget", "move_in", "household"], "area"),
    ),
    "6_smoker": ({"smoking_allowed": False}, {"smoker": True}, (), _match(59, TOP3, "smoking")),
    "7_pets": ({"pets_allowed": False}, {"has_pets": True}, (), _match(59, TOP3, "pets")),
    "8_household": ({"accepted_households": ["family"]}, {}, (), _match(90, TOP3, "household")),
    "9_contract": (
        {"min_contract_months": 12},
        {"contract_months": 6},
        (),
        _match(90, TOP3, "contract"),
    ),
    "10_parking": ({}, {"parking_needed": 2}, (), _match(98, TOP3, "parking")),
    "11_budget_and_area": (
        {"price_ils": 7600, "area": "north"},
        {},
        (),
        # Budget 20 + area 15 lost (spec 0015b weights): 65, capped at 59.
        _match(59, ["move_in", "household", "contract"], "budget"),
    ),
    "12_past_dates_mean_now": (
        {},
        {},
        (
            "UPDATE listings SET available_from = current_date - 40",
            "UPDATE seeker_profiles SET move_in_date = current_date - 10",
        ),
        _match(100, TOP3, None),
    ),
    "13_numeric_rounding": (
        {"available_from": _day(37)},
        {"parking_needed": 2},
        (),
        _match(93, ["budget", "area", "household"], "move_in"),
    ),
    "14_failing_beats_soft_gap": (
        {"pets_allowed": False, "accepted_households": ["family"]},
        {"has_pets": True},
        (),
        _match(59, TOP3, "pets"),
    ),
}


@pytest.mark.usefixtures("redis_clean")
@pytest.mark.parametrize("row", list(AC1_ROWS))
def test_ac1_score_and_explanation(
    client: TestClient,
    outbox: Outbox,
    db_engine: Engine,
    gush_dan: uuid.UUID,
    north: uuid.UUID,
    owner: uuid.UUID,
    row: str,
) -> None:
    listing_overrides, profile_overrides, sql, expected = AC1_ROWS[row]
    listing_overrides = dict(listing_overrides)
    area = north if listing_overrides.pop("area", None) == "north" else gush_dan
    listing_id = _l0(db_engine, owner, area, **listing_overrides)
    seeker = _seeker(client, outbox, db_engine, gush_dan, **profile_overrides)
    for statement in sql:
        _execute(db_engine, statement)

    page = seeker.get(f"/listings/{listing_id}")
    assert page.status_code == 200, page.text
    assert page.json()["match"] == expected

    body = _search(seeker)
    assert _ids(body) == [listing_id]
    assert body["items"][0]["match"] == expected


def _ac2_listings(engine: Engine, owner: uuid.UUID, area: uuid.UUID) -> dict[str, str]:
    """AC2's four listings with explicit, distinct creation times, earliest first."""
    start = dt.datetime.now(dt.UTC) - dt.timedelta(hours=1)

    def at(seconds: int, **overrides: Any) -> str:
        created = start + dt.timedelta(seconds=seconds)
        return _l0(engine, owner, area, created_at=created, **overrides)

    return {
        "earliest_100": at(0),
        "capped_59": at(1, price_ils=7600),
        "newer_100": at(2),
        "score_91": at(3, available_from=_day(42)),
    }


@pytest.mark.usefixtures("redis_clean")
def test_ac2_search_defaults_to_match_order(
    client: TestClient, outbox: Outbox, db_engine: Engine, gush_dan: uuid.UUID, owner: uuid.UUID
) -> None:
    rows = _ac2_listings(db_engine, owner, gush_dan)
    seeker = _seeker(client, outbox, db_engine, gush_dan)

    body = _search(seeker)

    assert body["sort"] == "match"
    assert _ids(body) == [
        rows["newer_100"],
        rows["earliest_100"],
        rows["score_91"],
        rows["capped_59"],
    ]
    assert [item["match"]["score"] for item in body["items"]] == [100, 100, 91, 59]
    assert all(item["match"] is not None for item in body["items"])
    assert body["total"] == 4


@pytest.mark.usefixtures("redis_clean")
def test_ac3_no_profile_means_no_score(
    client: TestClient, outbox: Outbox, db_engine: Engine, gush_dan: uuid.UUID, owner: uuid.UUID
) -> None:
    rows = _ac2_listings(db_engine, owner, gush_dan)
    newest = [rows["score_91"], rows["newer_100"], rows["capped_59"], rows["earliest_100"]]
    owner_client = signup(client, outbox, "owner-b@example.com", "owner")
    no_profile = signup(client, outbox, "no-profile@example.com", "seeker")
    expired = _seeker(client, outbox, db_engine, gush_dan, email="expired@example.com")
    _expire_sessions(db_engine, expired)
    callers = {
        "visitor": client,
        "owner": owner_client,
        "no_profile": no_profile,
        "expired": expired,
    }

    for name, caller in callers.items():
        for query in ("", "sort=match"):
            body = _search(caller, query)
            assert body["sort"] == "newest", (name, query)
            assert _ids(body) == newest, (name, query)
            assert [item["match"] for item in body["items"]] == [None] * 4, (name, query)
            assert body["total"] == 4, (name, query)


@pytest.mark.usefixtures("redis_clean")
def test_ac4_explicit_sort_keeps_score(
    client: TestClient, outbox: Outbox, db_engine: Engine, gush_dan: uuid.UUID, owner: uuid.UUID
) -> None:
    for price in (6800, 7600, 5000, 7000):
        _l0(db_engine, owner, gush_dan, price_ils=price)
    seeker = _seeker(client, outbox, db_engine, gush_dan)

    body = _search(seeker, "sort=price_asc")

    assert body["sort"] == "price_asc"
    assert [item["price_ils"] for item in body["items"]] == [5000, 6800, 7000, 7600]
    assert [item["match"]["score"] for item in body["items"]] == [100, 100, 100, 59]


@pytest.mark.usefixtures("redis_clean")
def test_ac5_match_order_pages_stably(
    client: TestClient,
    outbox: Outbox,
    db_engine: Engine,
    gush_dan: uuid.UUID,
    north: uuid.UUID,
    owner: uuid.UUID,
) -> None:
    # Five creation times for 25 rows: ties on score and on created_at, so `id` decides.
    start = dt.datetime.now(dt.UTC) - dt.timedelta(hours=1)
    for i in range(25):
        _l0(
            db_engine,
            owner,
            north if i % 7 == 0 else gush_dan,
            price_ils=(6500, 7000, 7600)[i % 3],
            available_from=_day((30, 37, 44, 70)[i % 4]),
            created_at=start + dt.timedelta(seconds=i % 5),
        )
    seeker = _seeker(client, outbox, db_engine, gush_dan)

    whole = _search(seeker, "sort=match&limit=50")
    pages = [_search(seeker, f"sort=match&limit=10&offset={offset}") for offset in (0, 10, 20)]
    paged = [listing_id for page in pages for listing_id in _ids(page)]

    assert len(_ids(whole)) == 25
    assert paged == _ids(whole)
    assert len(set(paged)) == 25
    scores = [item["match"]["score"] for item in whole["items"]]
    assert scores == sorted(scores, reverse=True)
    assert len(set(scores)) < 25  # several equal scores


BOX = "west=34.75&south=32.00&east=34.85&north=32.10"


@pytest.mark.usefixtures("redis_clean")
def test_ac6_score_never_filters(
    client: TestClient,
    outbox: Outbox,
    db_engine: Engine,
    gush_dan: uuid.UUID,
    north: uuid.UUID,
    owner: uuid.UUID,
) -> None:
    inside = [_l0(db_engine, owner, gush_dan, price_ils=price) for price in (6000, 6500, 7000)]
    in_north = _l0(db_engine, owner, north, price_ils=6800)
    outside = _l0(db_engine, owner, gush_dan)
    over_price = _l0(db_engine, owner, gush_dan, price_ils=7600)
    for listing_id in (*inside, in_north, over_price):
        set_location(db_engine, uuid.UUID(listing_id), 34.80, 32.05)
    set_location(db_engine, uuid.UUID(outside), 34.90, 32.15)
    seeker = _seeker(client, outbox, db_engine, gush_dan)
    query = f"price_max=7000&available_by={_day(30).isoformat()}&pets=true&{BOX}"

    as_seeker = _search(seeker, query)
    as_visitor = _search(client, query)

    assert set(_ids(as_seeker)) == set(_ids(as_visitor)) == {*inside, in_north}
    assert as_seeker["total"] == as_visitor["total"] == 4
    scores = {item["id"]: item["match"]["score"] for item in as_seeker["items"]}
    assert scores[in_north] == 59


@pytest.mark.usefixtures("redis_clean")
def test_ac7_listing_page_match(
    client: TestClient, outbox: Outbox, db_engine: Engine, gush_dan: uuid.UUID, owner: uuid.UUID
) -> None:
    public = _l0(db_engine, owner, gush_dan)
    paused = _l0(db_engine, owner, gush_dan, status="paused")
    closed = _l0(db_engine, owner, _area(db_engine, 8600, active=False))
    seeker = _seeker(client, outbox, db_engine, gush_dan)

    page = seeker.get(f"/listings/{public}")
    assert page.status_code == 200
    assert page.json()["match"] == _match(100, TOP3, None)

    anonymous = client.get(f"/listings/{public}")
    assert anonymous.status_code == 200
    assert anonymous.json()["match"] is None

    for hidden in (paused, closed, str(uuid.uuid4())):
        response = seeker.get(f"/listings/{hidden}")
        assert response.status_code == 404
        assert response.json() == NOT_FOUND


@pytest.mark.usefixtures("redis_clean")
def test_ac8_match_adds_two_statements_not_per_row(
    client: TestClient,
    outbox: Outbox,
    db_engine: Engine,
    gush_dan: uuid.UUID,
    owner: uuid.UUID,
    statements: list[str],
) -> None:
    for _ in range(25):
        _l0(db_engine, owner, gush_dan)
    seeker = _seeker(client, outbox, db_engine, gush_dan)
    _search(client)  # warm the connection: a first connect sends its own setup statements
    _search(seeker)

    statements.clear()
    anonymous = _search(client)
    assert (len(anonymous["items"]), anonymous["total"]) == (20, 25)
    assert len(statements) == 2, statements

    for limit in (3, 20):
        statements.clear()
        body = _search(seeker, f"limit={limit}")
        assert (len(body["items"]), body["total"]) == (limit, 25)
        assert len(statements) == 4, (limit, statements)
        assert "seeker_profiles" in statements[1], statements  # the profile check
        assert "m_score" in statements[3], statements  # the page carries the score


@pytest.mark.usefixtures("redis_clean")
def test_ac9_sort_match_is_not_422(
    client: TestClient, db_engine: Engine, gush_dan: uuid.UUID, owner: uuid.UUID
) -> None:
    listing_id = _l0(db_engine, owner, gush_dan)

    body = _search(client, "sort=match")
    assert body["sort"] == "newest"
    assert _ids(body) == [listing_id]
    assert client.get("/listings?sort=foo").status_code == 422


@pytest.mark.usefixtures("redis_clean")
def test_ac10_cookie_responses_are_private(
    client: TestClient, outbox: Outbox, db_engine: Engine, gush_dan: uuid.UUID, owner: uuid.UUID
) -> None:
    listing_id = _l0(db_engine, owner, gush_dan)
    seeker = _seeker(client, outbox, db_engine, gush_dan)
    no_profile = signup(client, outbox, "no-profile@example.com", "seeker")
    expired = signup(client, outbox, "expired@example.com", "seeker")
    _expire_sessions(db_engine, expired)
    paths = ("/listings", f"/listings/{listing_id}")

    for caller in (seeker, no_profile, expired):
        for path in paths:
            response = caller.get(path)
            assert response.status_code == 200, path
            assert response.headers.get("cache-control") == "private", path
            assert "Cookie" in response.headers.get("vary", ""), path
    for path in paths:
        response = client.get(path)
        assert response.status_code == 200, path
        assert "cache-control" not in response.headers, path
        assert "Cookie" in response.headers.get("vary", ""), path


def _values(**overrides: Any) -> dict[str, Any]:
    """One result row's match values: every base `m_*` 1, `m_lifestyle` None (not scored, as on an
    apartment: spec 0007g), no `f_*`, `m_score` 100; `overrides` win."""
    values: dict[str, Any] = {
        **{f"m_{c}": Decimal(1) for c in CRITERIA},
        "m_lifestyle": None,
        **{f"f_{c}": False for c in HARD},
        "m_score": 100,
    }
    return {**values, **overrides}


@pytest.mark.parametrize(
    ("values", "agrees", "differs"),
    [
        pytest.param(_values(), TOP3, None, id="all_ones"),
        pytest.param(
            _values(m_pets=Decimal(0), f_pets=True, m_household=Decimal(0), m_score=59),
            TOP3,
            "pets",
            id="failing_pets_beats_household",
        ),
        pytest.param(
            _values(
                m_smoking=Decimal(0), f_smoking=True, m_pets=Decimal(0), f_pets=True, m_score=59
            ),
            TOP3,
            "smoking",
            id="two_failing_tie_breaks_by_order",
        ),
        pytest.param(
            _values(
                m_budget=Decimal(0),
                f_budget=True,
                m_move_in=Decimal("0.43"),
                m_household=Decimal(0),
                m_contract=Decimal(0),
                m_score=48,
            ),
            ["area", "shelter", "parking"],
            "budget",
            id="agrees_needs_half",
        ),
    ],
)
def test_ac11_explain_rules(values: dict[str, Any], agrees: list[str], differs: str | None) -> None:
    match = explain(values)

    assert match.agrees == agrees
    assert match.differs == differs
    assert match.score == values["m_score"]


# --- Spec 0015b: the protected-space criterion ---------------------------------------------------

SHELTERS: tuple[str | None, ...] = ("mamad", "mamak", "building", "none", None)
CAPPED = _match(59, TOP3, "shelter")


@pytest.mark.usefixtures("redis_clean")
def test_ac4_shelter_criterion(
    client: TestClient, outbox: Outbox, db_engine: Engine, gush_dan: uuid.UUID, owner: uuid.UUID
) -> None:
    # `L0` matches `P0` in full, so only the shelter can move a score; NULL = a pre-0015b listing.
    start = dt.datetime.now(dt.UTC) - dt.timedelta(hours=1)
    ids = {
        shelter: _l0(
            db_engine, owner, gush_dan, shelter=shelter, created_at=start + dt.timedelta(seconds=i)
        )
        for i, shelter in enumerate(SHELTERS)
    }
    seeker = _seeker(client, outbox, db_engine, gush_dan)
    full = _match(100, TOP3, None)
    expected: dict[str, dict[str | None, dict[str, Any]]] = {
        "any": dict.fromkeys(SHELTERS, full),
        "protected": {"mamad": full, "mamak": full, "building": full, "none": CAPPED, None: CAPPED},
        "mamad": {**dict.fromkeys(SHELTERS, CAPPED), "mamad": full},
    }
    for needed, matches in expected.items():
        _execute(db_engine, "UPDATE seeker_profiles SET shelter_needed = :v", v=needed)
        by_id = {item["id"]: item["match"] for item in _search(seeker)["items"]}
        assert by_id == {ids[shelter]: match for shelter, match in matches.items()}, needed
        # The listing page reads the same expression.
        page = seeker.get(f"/listings/{ids[None]}")
        assert page.json()["match"] == matches[None], needed


@pytest.mark.usefixtures("redis_clean")
def test_ac5_weights_with_shelter(
    client: TestClient, outbox: Outbox, db_engine: Engine, gush_dan: uuid.UUID, owner: uuid.UUID
) -> None:
    assert WEIGHTS == {
        "budget": 20,
        "move_in": 20,
        "area": 15,
        "household": 10,
        "contract": 10,
        "parking": 5,
        "smoking": 5,
        "pets": 5,
        "shelter": 10,
    }
    assert sum(WEIGHTS.values()) == 100
    assert "shelter" in HARD
    listing_id = _l0(db_engine, owner, gush_dan, accepted_households=["family"])
    seeker = _seeker(client, outbox, db_engine, gush_dan, shelter_needed="mamad")
    _execute(db_engine, "UPDATE listings SET shelter = 'mamad'")
    assert seeker.get(f"/listings/{listing_id}").json()["match"] == _match(90, TOP3, "household")
