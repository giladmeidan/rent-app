"""Map search (spec 0003c): the bounding-box filter on the approximate point (AC9), its validation
(AC10) and its statement count (AC11)."""

import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, event, text

from app.db import make_engine
from tests.conftest import TEST_DATABASE_URL, make_listing, make_owner, set_location

BOX = "west=34.75&south=32.00&east=34.85&north=32.10"
GUSH_DAN_BOX = "west=34.74&south=31.95&east=34.95&north=32.17"


def _search(client: TestClient, query: str) -> dict[str, Any]:
    response = client.get(f"/listings?{query}&limit=50")
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def _points(body: dict[str, Any]) -> dict[str, tuple[float | None, float | None]]:
    """id -> (lng, lat), checking `total` against the page."""
    assert body["total"] == len(body["items"])
    return {item["id"]: (item["lng"], item["lat"]) for item in body["items"]}


@pytest.fixture
def statements(db_engine: Engine) -> Iterator[list[str]]:
    """Every SQL statement the app engine sends while the test records (`.clear()` to start).
    Copied from test_search.py."""
    seen: list[str] = []

    def record(_conn: Any, _cursor: Any, statement: str, *_: Any) -> None:
        seen.append(statement)

    event.listen(db_engine, "before_cursor_execute", record)
    yield seen
    event.remove(db_engine, "before_cursor_execute", record)


def test_ac9_bbox_filters_on_the_approximate_point(
    client: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    owner = make_owner(db_engine, "owner@example.com")
    a = make_listing(db_engine, owner, gush_dan, price_ils=6000)
    set_location(db_engine, a, 34.80, 32.08)
    b = make_listing(db_engine, owner, gush_dan, price_ils=9000)
    set_location(db_engine, b, 34.90, 32.15)
    c = make_listing(db_engine, owner, gush_dan)  # pending
    d = make_listing(db_engine, owner, gush_dan)
    with db_engine.begin() as conn:
        conn.execute(
            text("UPDATE listings SET geocode_status = 'not_found' WHERE id = :id"), {"id": d}
        )
    e = make_listing(db_engine, owner, gush_dan, status="paused")
    set_location(db_engine, e, 34.80, 32.08)

    boxed = client.get(f"/listings?{BOX}")
    assert boxed.status_code == 200
    body = boxed.json()
    assert [item["id"] for item in body["items"]] == [str(a)]
    assert body["total"] == 1
    assert (body["items"][0]["lng"], body["items"][0]["lat"]) == (34.8, 32.08)

    assert _points(_search(client, GUSH_DAN_BOX)) == {
        str(a): (34.8, 32.08),
        str(b): (34.9, 32.15),
    }
    assert set(_points(_search(client, f"{GUSH_DAN_BOX}&price_max=7000"))) == {str(a)}
    assert _points(_search(client, "")) == {
        str(a): (34.8, 32.08),
        str(b): (34.9, 32.15),
        str(c): (None, None),
        str(d): (None, None),
    }

    one = client.get(f"/listings/{a}").json()
    assert (one["lat"], one["lng"]) == (32.08, 34.8)
    pending = client.get(f"/listings/{c}").json()
    assert (pending["lat"], pending["lng"]) == (None, None)


_WIDE_BOXES = (
    ("west=-180&south=-90&east=180&north=90", 1),  # the whole world
    ("west=-10&south=30&east=80&north=40", 1),
    ("west=-180&south=-85&east=180&north=85", 1),
    ("west=-90&south=-1&east=90&north=1", 0),  # a band around the equator, not 32 N
)


def test_ac9_wide_boxes_are_planar_lng_lat_rectangles(
    client: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    owner = make_owner(db_engine, "owner@example.com")
    listing_id = make_listing(db_engine, owner, gush_dan)
    set_location(db_engine, listing_id, 34.80, 32.08)

    for box, total in _WIDE_BOXES:
        response = client.get(f"/listings?{box}")
        assert response.status_code == 200, (box, response.text)
        body = response.json()
        assert body["total"] == total, box
        assert [item["id"] for item in body["items"]] == [str(listing_id)] * total, box


def test_nf2_app_connections_run_without_jit() -> None:
    for connect_args in (None, {"options": "-c search_path=public"}):
        engine = make_engine(TEST_DATABASE_URL, connect_args)
        try:
            with engine.connect() as conn:
                assert conn.execute(text("SHOW jit")).scalar_one() == "off"
                if connect_args:
                    assert conn.execute(text("SHOW search_path")).scalar_one() == "public"
        finally:
            engine.dispose()


_BAD_BOXES = (
    "west=34.7&south=32.0&east=34.9",  # no north
    "west=34.9&south=32.0&east=34.8&north=32.1",  # west > east
    "west=34.8&south=32.0&east=34.8&north=32.1",  # equal
    "west=34.7&south=32.1&east=34.9&north=32.0",  # south > north
    "west=34.7&south=32.0&east=34.9&north=90.5",
    "west=34.7&south=32.0&east=180.5&north=32.1",
    "west=nan&south=32.0&east=34.9&north=32.1",
    "west=inf&south=32.0&east=34.9&north=32.1",
    "west=abc&south=32.0&east=34.9&north=32.1",
)


def test_ac10_bbox_validation(client: TestClient, gush_dan: uuid.UUID, db_engine: Engine) -> None:
    owner = make_owner(db_engine, "owner@example.com")
    listing_id = make_listing(db_engine, owner, gush_dan, price_ils=6000)
    set_location(db_engine, listing_id, 34.80, 32.08)

    for query in _BAD_BOXES:
        response = client.get(f"/listings?{query}")
        assert response.status_code == 422, (query, response.text)
        detail = response.json()["detail"]
        assert isinstance(detail, list) and detail, (query, detail)

    filters = "price_min=1000&price_max=8000&rooms_min=3&pets=true&sort=price_asc&limit=5"
    response = client.get(f"/listings?{BOX}&{filters}")
    assert response.status_code == 200, response.text
    assert [item["id"] for item in response.json()["items"]] == [str(listing_id)]


@pytest.mark.parametrize("query", [f"{BOX}&price_min=1&sort=price_asc", BOX])
def test_ac11_bbox_search_is_two_statements(
    client: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
    statements: list[str],
    query: str,
) -> None:
    owner = make_owner(db_engine, "owner@example.com")
    for i in range(25):
        listing_id = make_listing(db_engine, owner, gush_dan)
        set_location(db_engine, listing_id, 34.76 + i * 0.003, 32.01 + i * 0.003)
    client.get("/listings")  # warm the connection: a first connect sends its own setup statements

    statements.clear()
    response = client.get(f"/listings?{query}")
    sent = list(statements)

    assert response.status_code == 200, response.text
    body = response.json()
    assert (len(body["items"]), body["total"]) == (20, 25)
    assert all(item["lat"] is not None and item["lng"] is not None for item in body["items"])
    assert len(sent) == 2, sent
    assert all("FROM listings" in statement for statement in sent), sent
