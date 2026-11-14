"""Listing price signals (spec 0014b): the price history, the closure answer and its privacy."""

import uuid
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from tests.conftest import Outbox, set_location, signup
from tests.test_listings import FACTS, _body, _create, _execute, _patch, _patched, _row, _scalar

pytestmark = pytest.mark.usefixtures("redis_clean")

PRIVATE_KEYS = {"close_reason", "final_rent_ils", "closed_at", "price_changes", "prices"}
MAP_BOX = "west=34.75&south=32.00&east=34.85&north=32.10"


@pytest.fixture
def owner(client: TestClient, outbox: Outbox) -> TestClient:
    return signup(client, outbox, "owner@example.com", "owner")


def _prices(engine: Engine, listing_id: str) -> list[int]:
    with engine.connect() as conn:
        return list(
            conn.execute(
                text(
                    "SELECT price_ils FROM listing_price_changes WHERE listing_id = :id"
                    " ORDER BY created_at, price_ils"
                ),
                {"id": listing_id},
            ).scalars()
        )


def _all_prices(engine: Engine) -> int:
    count: int = _scalar(engine, "SELECT count(*) FROM listing_price_changes")
    return count


def _closure(engine: Engine, listing_id: str) -> tuple[Any, Any, bool]:
    row = _row(engine, listing_id)
    return row["close_reason"], row["final_rent_ils"], row["closed_at"] is not None


def _put(caller: TestClient, listing_id: str, body: dict[str, Any]) -> httpx.Response:
    response: httpx.Response = caller.put(f"/listings/{listing_id}/closure", json=body)
    return response


def _paused(owner: TestClient, area_id: uuid.UUID, **overrides: Any) -> str:
    listing_id: str = _create(owner, area_id, **overrides)["id"]
    _patched(owner, listing_id, {"status": "paused"})
    return listing_id


def _expire(engine: Engine, listing_id: str) -> None:
    _execute(
        engine,
        "UPDATE listings SET expires_at = now() - interval '1 day' WHERE id = :id",
        id=listing_id,
    )


def _mine(owner: TestClient, listing_id: str) -> dict[str, Any]:
    item: dict[str, Any] = next(
        item for item in owner.get("/me/listings").json() if item["id"] == listing_id
    )
    return item


def test_ac1_create_writes_one_price_row(
    owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    created = _create(owner, gush_dan, price_ils=7000)
    assert _prices(db_engine, created["id"]) == [7000]
    created_at = _scalar(
        db_engine,
        "SELECT created_at FROM listing_price_changes WHERE listing_id = :id",
        id=created["id"],
    )
    assert created_at == _row(db_engine, created["id"])["created_at"]

    # A create that fails writes none: an unknown area, then the cap.
    response = owner.post("/listings", json=_body(uuid.uuid4()))
    assert response.status_code == 422, response.text
    assert _all_prices(db_engine) == 1
    _create(owner, gush_dan)
    _create(owner, gush_dan)
    assert _all_prices(db_engine) == 3
    response = owner.post("/listings", json=_body(gush_dan))
    assert response.status_code == 409, response.text
    assert _all_prices(db_engine) == 3


def test_ac2_price_change_adds_a_row(
    owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    listing_id = _create(owner, gush_dan, price_ils=7000)["id"]

    _patched(owner, listing_id, {"price_ils": 7500})
    assert _prices(db_engine, listing_id) == [7000, 7500]
    # The same price, or a PATCH without one (a pause and a resume included), adds none.
    _patched(owner, listing_id, {"price_ils": 7500})
    _patched(owner, listing_id, {"street": "ויצמן"})
    _patched(owner, listing_id, {"status": "paused"})
    _patched(owner, listing_id, {"status": "active"})
    assert _prices(db_engine, listing_id) == [7000, 7500]
    # A refused PATCH writes nothing.
    assert _patch(owner, listing_id, {"price_ils": 499}).status_code == 422
    assert _prices(db_engine, listing_id) == [7000, 7500]


def test_ac6_public_responses_carry_facts_never_closure(
    client: TestClient, owner: TestClient, outbox: Outbox, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    listing_id = _paused(owner, gush_dan, price_ils=7000, **FACTS)
    _patched(owner, listing_id, {"price_ils": 7200})
    response = _put(owner, listing_id, {"reason": "rented_here", "final_rent_ils": 7100})
    assert response.status_code == 204, response.text
    _patched(owner, listing_id, {"status": "active"})
    # The worst case: a stored answer on a live listing (the resume cleared the real one).
    _execute(
        db_engine,
        "UPDATE listings SET close_reason = 'rented_elsewhere', final_rent_ils = 6800,"
        " closed_at = now() WHERE id = :id",
        id=listing_id,
    )
    set_location(db_engine, uuid.UUID(listing_id), 34.80, 32.05)
    assert len(_prices(db_engine, listing_id)) == 2
    seeker = signup(client, outbox, "seeker@example.com", "seeker")

    def check(item: dict[str, Any], where: str) -> None:
        assert item["id"] == listing_id, where
        assert {name: item[name] for name in FACTS} == FACTS, where
        assert not PRIVATE_KEYS & set(item), where
        assert "6800" not in str(item) and "rented_elsewhere" not in str(item), where

    for name, caller in (("visitor", client), ("seeker", seeker), ("owner", owner)):
        for query in ("", MAP_BOX):
            response = caller.get(f"/listings?{query}")
            assert response.status_code == 200, (name, query, response.text)
            (item,) = response.json()["items"]
            check(item, f"{name} search {query}")
        response = caller.get(f"/listings/{listing_id}")
        assert response.status_code == 200, (name, response.text)
        check(response.json(), f"{name} page")
    # The owner's own write responses never carry it either.
    check(_patched(owner, listing_id, {"description": "x"}), "PATCH")


def test_ac7_closure_stored_and_replaced(
    owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    listing_id = _paused(owner, gush_dan)
    updated_at = _row(db_engine, listing_id)["updated_at"]
    assert _mine(owner, listing_id)["close_reason"] is None

    response = _put(owner, listing_id, {"reason": "rented_elsewhere", "final_rent_ils": 6800})
    assert response.status_code == 204, response.text
    assert response.content == b""
    mine = _mine(owner, listing_id)
    assert (mine["close_reason"], mine["final_rent_ils"]) == ("rented_elsewhere", 6800)
    assert _closure(db_engine, listing_id) == ("rented_elsewhere", 6800, True)
    assert _row(db_engine, listing_id)["updated_at"] == updated_at

    # A second answer replaces the first; the rent may be left out.
    assert _put(owner, listing_id, {"reason": "not_renting"}).status_code == 204
    mine = _mine(owner, listing_id)
    assert (mine["close_reason"], mine["final_rent_ils"]) == ("not_renting", None)
    assert _closure(db_engine, listing_id) == ("not_renting", None, True)
    response = _put(owner, listing_id, {"reason": "rented_here", "final_rent_ils": None})
    assert response.status_code == 204, response.text
    assert _closure(db_engine, listing_id) == ("rented_here", None, True)
    assert _row(db_engine, listing_id)["updated_at"] == updated_at


def test_ac8_closure_on_expired_listing(
    owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    listing_id = _create(owner, gush_dan)["id"]
    _expire(db_engine, listing_id)

    response = _put(owner, listing_id, {"reason": "rented_here", "final_rent_ils": 7000})
    assert response.status_code == 204, response.text
    assert _closure(db_engine, listing_id) == ("rented_here", 7000, True)
    assert _row(db_engine, listing_id)["status"] == "active"


def test_ac9_closure_auth_and_live(
    client: TestClient, owner: TestClient, outbox: Outbox, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    live = _create(owner, gush_dan)["id"]
    paused = _paused(owner, gush_dan)
    other = signup(client, outbox, "other@example.com", "owner")
    body = {"reason": "not_renting"}

    response = _put(owner, live, body)
    assert (response.status_code, response.json()) == (409, {"detail": "listing_live"})
    for caller, listing_id in ((other, paused), (owner, str(uuid.uuid4()))):
        response = _put(caller, listing_id, body)
        assert (response.status_code, response.json()) == (404, {"detail": "not_found"})
    response = _put(client, paused, body)
    assert (response.status_code, response.json()) == (401, {"detail": "unauthenticated"})
    for listing_id in (live, paused):
        assert _closure(db_engine, listing_id) == (None, None, False)


def test_ac10_closure_validation(owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine) -> None:
    listing_id = _paused(owner, gush_dan)
    for body in (
        {"reason": "sold"},
        {},
        {"reason": "rented_here", "final_rent_ils": 499},
        {"reason": "rented_here", "final_rent_ils": 100_001},
        {"reason": "not_renting", "final_rent_ils": 6000},
        {"reason": "rented_here", "closed_at": "2026-01-01T00:00:00Z"},
    ):
        response = _put(owner, listing_id, body)
        assert response.status_code == 422, (body, response.text)
        assert isinstance(response.json()["detail"], list), body
    assert _closure(db_engine, listing_id) == (None, None, False)
    # The bounds themselves pass.
    for rent in (500, 100_000):
        response = _put(owner, listing_id, {"reason": "rented_elsewhere", "final_rent_ils": rent})
        assert response.status_code == 204, response.text

    # The closure answer is not patchable.
    for patch in ({"close_reason": "not_renting"}, {"final_rent_ils": 6000}, {"closed_at": None}):
        response = _patch(owner, listing_id, patch)
        assert response.status_code == 422, (patch, response.text)
    assert _closure(db_engine, listing_id) == ("rented_elsewhere", 100_000, True)


def test_ac11_resume_clears_closure(
    owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    answer = {"reason": "rented_elsewhere", "final_rent_ils": 6800}
    listing_id = _paused(owner, gush_dan)
    assert _put(owner, listing_id, answer).status_code == 204

    # A PATCH of the paused listing without `status` keeps the answer.
    _patched(owner, listing_id, {"price_ils": 6900})
    assert _closure(db_engine, listing_id) == ("rented_elsewhere", 6800, True)

    # The cap rule is unchanged: with the cap full the resume is refused, and the answer stays.
    others = [_create(owner, gush_dan)["id"] for _ in range(3)]
    response = _patch(owner, listing_id, {"status": "active"})
    assert (response.status_code, response.json()) == (409, {"detail": "listing_cap_reached"})
    assert _closure(db_engine, listing_id) == ("rented_elsewhere", 6800, True)
    _patched(owner, others[0], {"status": "paused"})

    resumed = _patched(owner, listing_id, {"status": "active"})
    assert resumed["status"] == "active"
    assert _closure(db_engine, listing_id) == (None, None, False)
    mine = _mine(owner, listing_id)
    assert (mine["close_reason"], mine["final_rent_ils"]) == (None, None)

    # `{"status": "active"}` on an active listing past `expires_at` is refused (spec 0011a), and
    # the answer stays.
    _expire(db_engine, listing_id)
    assert _put(owner, listing_id, answer).status_code == 204
    response = _patch(owner, listing_id, {"status": "active"})
    assert (response.status_code, response.json()) == (409, {"detail": "listing_expired"})
    assert _closure(db_engine, listing_id) == ("rented_elsewhere", 6800, True)
