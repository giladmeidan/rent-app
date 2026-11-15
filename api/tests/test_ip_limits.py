"""Per-network limits (spec 0013b): the public read budget (AC7, AC8), browse (AC9) and reports
(AC10). Other networks come from `Fly-Client-IP` with `TRUST_PROXY=fly` and documentation
addresses; `redis_clean` drops their counters."""

import uuid
from collections.abc import Callable
from typing import Any

import pytest
import redis
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from app import client_ip, limits, redis_client
from app.redis_client import get_redis
from app.services import market_people as market_service
from app.services import reports as reports_service
from tests.conftest import make_flatmate, make_listing, make_owner, make_profile, make_seeker
from tests.test_market_people import _browse_count, _live_room, _login, _person

pytestmark = pytest.mark.usefixtures("redis_clean")

NET_A = "203.0.113.7"
NET_B = "198.51.100.9"


@pytest.fixture
def fly(set_env: Callable[..., None]) -> None:
    set_env(TRUST_PROXY="fly")


def _from(network: str) -> dict[str, str]:
    return {"Fly-Client-IP": network}


def _rl_keys(pattern: str) -> list[str]:
    return [k.decode() for k in get_redis().scan_iter(match=pattern)]


def _assert_429(response: Any) -> int:
    assert response.status_code == 429, response.text
    assert response.json() == {"detail": "rate_limited"}
    retry_after = int(response.headers["Retry-After"])
    assert retry_after >= 1
    return retry_after


@pytest.mark.usefixtures("fly")
def test_ac7_public_read_limit(
    client: TestClient, db_engine: Engine, gush_dan: uuid.UUID, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(limits, "READ", limits.IpBucket("read", 3, 5))
    listing = make_listing(db_engine, make_owner(db_engine, "owner@example.com"), gush_dan)

    assert client.get("/listings", headers=_from(NET_A)).status_code == 200
    assert client.get(f"/listings/{listing}", headers=_from(NET_A)).status_code == 200
    assert client.get(f"/listings/{uuid.uuid4()}", headers=_from(NET_A)).status_code == 404
    _assert_429(client.get("/listings", headers=_from(NET_A)))
    assert client.get("/listings", headers=_from(NET_B)).status_code == 200

    get_redis().delete(f"rl:read:ip:{NET_A}")  # the minute has passed
    for _ in range(2):
        assert client.get("/listings", headers=_from(NET_A)).status_code == 200
    assert _assert_429(client.get(f"/listings/{listing}", headers=_from(NET_A))) > 60
    assert _rl_keys("rl:read:ip:day:*") == []


@pytest.mark.usefixtures("fly")
def test_ac7_read_limit_per_48(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(limits, "READ", limits.IpBucket("read", 3, 5))
    monkeypatch.setattr(client_ip, "PREFIX48_FACTOR", 2)
    for address in ("2001:db8:1:2::a", "2001:db8:1:3::a"):
        for _ in range(3):
            assert client.get("/listings", headers=_from(address)).status_code == 200

    _assert_429(client.get("/listings", headers=_from("2001:db8:1:4::a")))
    assert [k for k in _rl_keys("rl:read:*") if "2001:db8:1:4::/64" in k] == []
    assert client.get("/listings", headers=_from("2001:db8:2:1::a")).status_code == 200


def test_ac8_read_limit_fails_open_and_skips(
    client: TestClient, db_engine: Engine, gush_dan: uuid.UUID, monkeypatch: pytest.MonkeyPatch
) -> None:
    listing = make_listing(db_engine, make_owner(db_engine, "owner@example.com"), gush_dan)
    calls: list[int] = []

    def down(*_: Any, **__: Any) -> None:
        calls.append(1)
        raise redis.exceptions.ConnectionError("redis is down")

    monkeypatch.setattr(limits, "count_or_raise", down)

    assert client.get("/listings").status_code == 200
    assert client.get(f"/listings/{listing}").status_code == 200
    assert len(calls) == 1  # the second call fell in the skip window

    redis_client._soft_skip_until = 0.0  # the window has passed
    assert client.get("/listings").status_code == 200
    assert len(calls) == 2


@pytest.mark.usefixtures("fly")
def test_ac9_browse_per_network(
    client: TestClient, db_engine: Engine, gush_dan: uuid.UUID, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(market_service, "BROWSE_RATE_LIMIT_IP_HOUR", 3)
    a = _person(client, db_engine, gush_dan, "Ada")
    b = _person(client, db_engine, gush_dan, "Bea")
    c = _person(client, db_engine, gush_dan, "Cai")
    for person in (a, b):
        person.caller.headers.update(_from(NET_A))
    c.caller.headers.update(_from(NET_B))

    for caller in (a.caller, a.caller, b.caller):
        assert caller.get("/people").status_code == 200
    counts = (_browse_count(a.id), _browse_count(b.id))
    _assert_429(a.caller.get("/people"))
    _assert_429(b.caller.get("/people"))
    assert (_browse_count(a.id), _browse_count(b.id)) == counts
    assert c.caller.get("/people").status_code == 200

    # The lister's people list, the likes list and the listing page's people share the counter.
    owner_id = make_owner(db_engine, "owner@example.com")
    owner = _login(client, db_engine, owner_id)
    owner.headers.update(_from(NET_A))
    room = _live_room(db_engine, owner_id, gush_dan, gender_preference="any")
    mate = make_seeker(db_engine, "mate@example.com", "Fay")
    make_profile(db_engine, mate, gush_dan, gender="woman")
    make_flatmate(db_engine, room, mate, shown=True)
    viewer = _person(client, db_engine, gush_dan, "Sek", card=False)
    viewer.caller.headers.update(_from(NET_A))

    get_redis().delete(f"rl:browse:ip:{NET_A}")  # the hour has passed
    assert a.caller.get("/me/people-likes").status_code == 200
    assert owner.get(f"/listings/{room}/people").status_code == 200
    page = viewer.caller.get(f"/listings/{room}")
    assert [p["display_name"] for p in page.json()["people"]] == ["Fay"]

    _assert_429(owner.get(f"/listings/{room}/people"))
    _assert_429(a.caller.get("/me/people-likes"))
    limited = viewer.caller.get(f"/listings/{room}")
    assert limited.status_code == 200
    assert limited.json()["people"] == []


@pytest.mark.usefixtures("fly")
def test_ac10_reports_per_network(
    client: TestClient, db_engine: Engine, gush_dan: uuid.UUID, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(reports_service, "REPORT_RATE_LIMIT_IP_HOUR", 2)
    owner_id = make_owner(db_engine, "owner@example.com")
    targets = [make_listing(db_engine, owner_id, gush_dan) for _ in range(4)]
    a = _person(client, db_engine, gush_dan, "Ada", card=False)
    b = _person(client, db_engine, gush_dan, "Bea", card=False)
    c = _person(client, db_engine, gush_dan, "Cai", card=False)

    def report(person: Any, target: uuid.UUID, network: str) -> Any:
        body = {"target_type": "listing", "target_id": str(target), "reason": "broker"}
        return person.caller.post("/reports", json=body, headers=_from(network))

    def stored() -> int:
        with db_engine.connect() as conn:
            return int(conn.execute(text("SELECT count(*) FROM reports")).scalar_one())

    assert report(a, targets[0], NET_A).status_code == 201
    assert report(b, targets[1], NET_A).status_code == 201
    _assert_429(report(a, targets[2], NET_A))
    _assert_429(report(b, targets[2], NET_A))
    assert stored() == 2
    assert report(c, targets[2], NET_B).status_code == 201
    assert stored() == 3
