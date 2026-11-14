"""Listing renewal (spec 0011a): `POST /listings/{id}/renew` and PATCH past expiry. AC1-AC8."""

import datetime as dt
import threading
import time
import uuid
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from app.db import get_sessionmaker
from app.models import User
from app.schemas.listing import ListingOut
from app.services import listings as listings_service
from tests.conftest import Outbox, signup
from tests.test_listings import _create, _create_room, _execute, _patch, _patched, _row, _scalar
from tests.test_price_signals import _closure, _mine, _prices, _put

pytestmark = pytest.mark.usefixtures("redis_clean")


@pytest.fixture
def owner(client: TestClient, outbox: Outbox) -> TestClient:
    return signup(client, outbox, "owner@example.com", "owner")


def _renew(caller: TestClient, listing_id: str) -> httpx.Response:
    response: httpx.Response = caller.post(f"/listings/{listing_id}/renew")
    return response


def _expires_in(engine: Engine, listing_id: str, span: str) -> None:
    """Move `expires_at` to `now() + span` (a Postgres interval, negative = past)."""
    _execute(
        engine,
        "UPDATE listings SET expires_at = now() + CAST(:span AS interval) WHERE id = :id",
        id=listing_id,
        span=span,
    )


def _live(engine: Engine, owner: TestClient) -> int:
    count: int = _scalar(
        engine,
        "SELECT count(*) FROM listings WHERE owner_id = :id"
        " AND status = 'active' AND expires_at > now()",
        id=owner.get("/me").json()["id"],
    )
    return count


def test_ac1_renew_in_window_restarts_90_days(
    owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    listing_id = _create(owner, gush_dan, price_ils=7000)["id"]
    _expires_in(db_engine, listing_id, "3 days")
    before = _row(db_engine, listing_id)

    response = _renew(owner, listing_id)
    assert response.status_code == 200, response.text
    renewed = response.json()
    assert set(renewed) == set(ListingOut.model_fields)
    assert renewed["photos"] == []
    assert renewed["status"] == "active"
    left: dt.timedelta = _scalar(
        db_engine, "SELECT expires_at - now() FROM listings WHERE id = :id", id=listing_id
    )
    assert dt.timedelta(days=89, hours=23) <= left <= dt.timedelta(days=90)
    after = _row(db_engine, listing_id)
    for name in ("price_ils", "created_at", "city", "street", "area_id"):
        assert after[name] == before[name], name
    assert after["updated_at"] > before["updated_at"]
    assert _prices(db_engine, listing_id) == [7000]


def test_ac2_window_opens_seven_days_before_expiry(
    owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    listing_id = _create(owner, gush_dan)["id"]
    _expires_in(db_engine, listing_id, "7 days 1 minute")
    before = _row(db_engine, listing_id)
    response = _renew(owner, listing_id)
    assert (response.status_code, response.json()) == (409, {"detail": "renewal_not_open"})
    assert _row(db_engine, listing_id) == before

    _expires_in(db_engine, listing_id, "7 days -1 minute")
    assert _renew(owner, listing_id).status_code == 200

    fresh = _create(owner, gush_dan)["id"]
    response = _renew(owner, fresh)
    assert (response.status_code, response.json()) == (409, {"detail": "renewal_not_open"})

    paused = _create(owner, gush_dan)["id"]
    _patched(owner, paused, {"status": "paused"})
    _expires_in(db_engine, paused, "30 days")
    before = _row(db_engine, paused)
    response = _renew(owner, paused)
    assert (response.status_code, response.json()) == (409, {"detail": "renewal_not_open"})
    assert _row(db_engine, paused) == before


@pytest.mark.parametrize("status", ["active", "paused"])
@pytest.mark.parametrize("past", ["1 day", "400 days"])
def test_ac3_expired_listing_renews_live_again(
    client: TestClient,
    owner: TestClient,
    gush_dan: uuid.UUID,
    db_engine: Engine,
    status: str,
    past: str,
) -> None:
    listing_id = _create(owner, gush_dan)["id"]
    if status == "paused":
        _patched(owner, listing_id, {"status": "paused"})
    _expires_in(db_engine, listing_id, f"-{past}")
    assert client.get(f"/listings/{listing_id}").status_code == 404

    response = _renew(owner, listing_id)
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "active"
    assert client.get(f"/listings/{listing_id}").status_code == 200
    assert _mine(owner, listing_id)["expires_at"] == response.json()["expires_at"]


def test_ac4_cap_shared_and_a_live_renewal_needs_no_slot(
    owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    expired_room = _create_room(owner, gush_dan)["id"]
    _expires_in(db_engine, expired_room, "-1 day")
    apartments = [_create(owner, gush_dan)["id"] for _ in range(2)]
    room = _create_room(owner, gush_dan)["id"]

    before = _row(db_engine, expired_room)
    response = _renew(owner, expired_room)
    assert (response.status_code, response.json()) == (409, {"detail": "listing_cap_reached"})
    assert _row(db_engine, expired_room) == before

    _patched(owner, apartments[0], {"status": "paused"})
    assert _renew(owner, expired_room).status_code == 200
    assert _live(db_engine, owner) == 3

    _expires_in(db_engine, room, "3 days")
    response = _renew(owner, room)
    assert response.status_code == 200, response.text
    assert _live(db_engine, owner) == 3


def test_ac5_renewal_clears_closure(
    owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    listing_id = _create(owner, gush_dan)["id"]
    _expires_in(db_engine, listing_id, "-1 day")
    answer = {"reason": "rented_elsewhere", "final_rent_ils": 6800}
    assert _put(owner, listing_id, answer).status_code == 204
    others = [_create(owner, gush_dan)["id"] for _ in range(3)]

    response = _renew(owner, listing_id)
    assert (response.status_code, response.json()) == (409, {"detail": "listing_cap_reached"})
    assert _closure(db_engine, listing_id) == ("rented_elsewhere", 6800, True)

    _patched(owner, others[0], {"status": "paused"})
    assert _renew(owner, listing_id).status_code == 200
    assert _closure(db_engine, listing_id) == (None, None, False)
    mine = _mine(owner, listing_id)
    assert (mine["close_reason"], mine["final_rent_ils"]) == (None, None)


def test_ac6_renew_auth_and_ownership(
    client: TestClient, outbox: Outbox, owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    listing_id = _create(owner, gush_dan)["id"]
    _expires_in(db_engine, listing_id, "3 days")
    before = _row(db_engine, listing_id)

    response = _renew(client, listing_id)
    assert (response.status_code, response.json()) == (401, {"detail": "unauthenticated"})

    other = signup(client, outbox, "other@example.com", "owner")
    foreign = _renew(other, listing_id)
    assert (foreign.status_code, foreign.json()) == (404, {"detail": "not_found"})
    assert _row(db_engine, listing_id) == before
    unknown = _renew(other, str(uuid.uuid4()))
    assert unknown.status_code == 404
    assert unknown.content == foreign.content

    malformed = _renew(owner, "not-a-uuid")
    assert malformed.status_code == 422
    assert isinstance(malformed.json()["detail"], list)

    seeker = signup(client, outbox, "seeker@example.com", "seeker")
    room = _create_room(seeker, gush_dan)["id"]
    _expires_in(db_engine, room, "-1 day")
    response = _renew(seeker, room)
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "active"


def test_ac7_concurrent_renewals_respect_cap(
    owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner_id = uuid.UUID(owner.get("/me").json()["id"])
    expired = [_create(owner, gush_dan)["id"] for _ in range(2)]
    for listing_id in expired:
        _expires_in(db_engine, listing_id, "-1 day")
    for _ in range(2):
        _create(owner, gush_dan)
    real_count = listings_service._count_live_listings

    def slow_count(db: Session, owner_id: uuid.UUID) -> int:
        count = real_count(db, owner_id)
        time.sleep(0.3)  # widen the count-then-update window so the two calls overlap
        return count

    monkeypatch.setattr(listings_service, "_count_live_listings", slow_count)
    start = threading.Barrier(2, timeout=10)
    outcomes: list[str] = []

    def renew(listing_id: str) -> None:
        with get_sessionmaker()() as db:
            user = db.get(User, owner_id)
            assert user is not None
            start.wait()
            try:
                listings_service.renew_listing(db, user, uuid.UUID(listing_id))
                outcomes.append("renewed")
            except listings_service.ListingCapReachedError:
                outcomes.append("cap_reached")
            except Exception as exc:  # pragma: no cover - reported by the assertion below
                outcomes.append(repr(exc))

    threads = [threading.Thread(target=renew, args=(listing_id,)) for listing_id in expired]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=15)

    assert sorted(outcomes) == ["cap_reached", "renewed"]
    assert _live(db_engine, owner) == 3


def test_ac8_patch_past_expiry_refused(
    client: TestClient, outbox: Outbox, owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    active = _create(owner, gush_dan, price_ils=7000)["id"]
    paused = _create(owner, gush_dan, price_ils=7000)["id"]
    _patched(owner, paused, {"status": "paused"})
    for listing_id in (active, paused):
        _expires_in(db_engine, listing_id, "-1 hour")

    refused: list[tuple[str, dict[str, Any]]] = [
        (active, {"price_ils": 7500}),
        (paused, {"price_ils": 7500}),
        (paused, {"status": "active"}),
        (active, {"status": "paused"}),
        (active, {"status": "active"}),
    ]
    for listing_id, body in refused:
        before = _row(db_engine, listing_id)
        response = _patch(owner, listing_id, body)
        assert (response.status_code, response.json()) == (
            409,
            {"detail": "listing_expired"},
        ), body
        assert _row(db_engine, listing_id) == before, body
        assert _prices(db_engine, listing_id) == [7000], body

    malformed = _patch(owner, active, {"price_ils": 1})
    assert malformed.status_code == 422
    assert isinstance(malformed.json()["detail"], list)

    other = signup(client, outbox, "other@example.com", "owner")
    foreign = _patch(other, active, {"price_ils": 7500})
    assert (foreign.status_code, foreign.json()) == (404, {"detail": "not_found"})

    assert _renew(owner, active).status_code == 200
    assert _patched(owner, active, {"price_ils": 7500})["price_ils"] == 7500
    assert _prices(db_engine, active) == [7000, 7500]
