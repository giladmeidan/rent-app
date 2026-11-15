"""Rate limits and request hardening (spec 0011c): AC1-AC6 and AC12-AC14.

`LIMITED` is the hand-kept registry of the routes this spec limits (proved by AC2); `OWN` the write
routes with a limit of their own, proved by their own specs; `EXEMPT` the three that have none. AC1
fails for a new write route that is in none of them."""

import asyncio
import json
import os
import re
import uuid
from collections.abc import Iterator
from typing import Any

import httpx
import pytest
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text
from starlette.requests import Request

from app import limits
from app.config import get_settings
from app.main import MAX_BODY_BYTES, _request_invalid, create_app
from app.redis_client import get_redis
from app.services import chat as chat_service
from app.services import chat_events
from app.services.market_people import BROWSE_RATE_LIMIT_HOUR
from app.services.photo_store import FilePhotoStore
from tests.conftest import Outbox, make_application, make_listing, make_seeker, signup
from tests.test_flatmates import _api_routes
from tests.test_listings import _body, _room
from tests.test_profiles import _p

pytestmark = pytest.mark.usefixtures("redis_clean")

RATE_LIMITED = {"detail": "rate_limited"}
TOO_LARGE = {"detail": "body_too_large"}
_RANDOM_UUID = str(uuid.UUID(int=1))


def _apartment() -> dict[str, Any]:
    return _body(uuid.uuid4())


def _profile() -> dict[str, Any]:
    return _p(uuid.uuid4())


# (method, route path, `limits` bucket attribute, body or query). Path ids are random: the count
# comes first, so the route need not find anything.
LIMITED: list[tuple[str, str, str, Any]] = [
    ("POST", "/listings", "CREATE", _apartment),
    ("PATCH", "/listings/{listing_id}", "WRITE", {"price_ils": 7000}),
    ("PATCH", "/listings/{listing_id}", "ADDRESS", {"street": "הרצל"}),
    ("PUT", "/listings/{listing_id}/closure", "WRITE", {"reason": "not_renting"}),
    ("POST", "/listings/{listing_id}/renew", "WRITE", None),
    ("POST", "/me/applications/{application_id}/withdraw", "WRITE", None),
    (
        "PATCH",
        "/listings/{listing_id}/applications/{application_id}",
        "STATUS",
        {"status": "shortlisted"},
    ),
    ("PUT", "/me/profile", "WRITE", _profile),
    ("DELETE", "/listings/{listing_id}/people/{person_id}/like", "WRITE", None),
    ("DELETE", "/people/{card_id}/like", "WRITE", None),
    ("DELETE", "/me/matches/{conversation_id}", "WRITE", None),
    ("POST", "/listings/{listing_id}/flatmate-invite", "WRITE", None),
    ("DELETE", "/listings/{listing_id}/flatmate-invite", "WRITE", None),
    ("DELETE", "/listings/{listing_id}/flatmates/{flatmate_id}", "WRITE", None),
    ("PATCH", "/me/flats/{listing_id}", "WRITE", {"shown": True}),
    ("DELETE", "/me/flats/{listing_id}", "WRITE", None),
    ("DELETE", "/listings/{listing_id}/photos/{photo_id}", "WRITE", None),
    ("PUT", "/listings/{listing_id}/photos/order", "WRITE", {"photo_ids": [_RANDOM_UUID]}),
    ("DELETE", "/me/photo", "WRITE", None),
    ("GET", "/rent-estimate", "ESTIMATE", {"city": "תל אביב", "street": "תירוש", "rooms": "4"}),
]
# Write routes with their own limit, proved by their own specs.
OWN = {
    ("POST", "/auth/otp/request"),  # 0001a
    ("POST", "/listings/{listing_id}/applications"),  # 0004a
    ("POST", "/conversations/{conversation_id}/messages"),  # 0005a
    ("PUT", "/listings/{listing_id}/people/{person_id}/like"),  # 0008a
    ("PUT", "/people/{card_id}/like"),  # 0010h
    ("POST", "/flatmate-invites/preview"),  # 0008d
    ("POST", "/flatmate-invites/join"),  # 0008d
    ("POST", "/listings/{listing_id}/photos"),  # 0010d
    ("PUT", "/me/photo"),  # 0010j
    ("POST", "/reports"),  # 0011b
}
# Signing in (5 guesses per code) and signing out (always works).
# DELETE /me (spec 0013c): succeeds at most once per account, behind a sign-in of the last 15 min.
EXEMPT = {("POST", "/auth/otp/verify"), ("POST", "/auth/logout"), ("DELETE", "/me")}
WRITES = {"POST", "PUT", "PATCH", "DELETE"}


def _user_id(caller: TestClient) -> uuid.UUID:
    return uuid.UUID(caller.get("/me").json()["id"])


def _keys(bucket: limits.Bucket, user_id: uuid.UUID) -> tuple[str, str]:
    return f"rl:{bucket.name}:user:{user_id}", f"rl:{bucket.name}:user:day:{user_id}"


def _count(key: str) -> int | None:
    value = get_redis().get(key)
    return None if value is None else int(value)


def _send(caller: TestClient, method: str, path: str, payload: Any) -> httpx.Response:
    url = re.sub(r"\{[^}]+\}", lambda _: str(uuid.uuid4()), path)
    payload = payload() if callable(payload) else payload
    response: httpx.Response = (
        caller.get(url, params=payload)
        if method == "GET"
        else caller.request(method, url, json=payload)
    )
    return response


def _scalar(engine: Engine, sql: str, **params: Any) -> Any:
    with engine.connect() as conn:
        return conn.execute(text(sql), params).scalar()


@pytest.fixture
def owner(client: TestClient, outbox: Outbox) -> TestClient:
    return signup(client, outbox, "owner@example.com", "owner")


@pytest.fixture
def seeker(client: TestClient, outbox: Outbox) -> TestClient:
    return signup(client, outbox, "seeker@example.com", "seeker")


def test_ac1_every_write_route_has_a_limit() -> None:
    routes = {
        (method, route.path)
        for route in _api_routes(create_app().routes)
        for method in (route.methods or set()) & WRITES
    }
    limited = {(method, path) for method, path, _, _ in LIMITED if method in WRITES}
    assert len(limited) == 18
    assert not (limited & OWN) and not (limited & EXEMPT) and not (OWN & EXEMPT)
    assert routes == limited | OWN | EXEMPT


@pytest.mark.parametrize(
    ("method", "path", "bucket_name", "payload"),
    LIMITED,
    ids=[f"{m} {p}" for m, p, _, _ in LIMITED],
)
def test_ac2_limited_routes_refuse_at_the_limit(
    owner: TestClient, method: str, path: str, bucket_name: str, payload: Any
) -> None:
    bucket: limits.Bucket = getattr(limits, bucket_name)
    hour, day = _keys(bucket, _user_id(owner))
    r = get_redis()

    r.set(hour, bucket.per_hour, ex=3600)
    response = _send(owner, method, path, payload)
    assert (response.status_code, response.json()) == (429, RATE_LIMITED)
    assert 1 <= int(response.headers["retry-after"]) <= 3600
    assert (_count(hour), _count(day)) == (bucket.per_hour, None)

    r.delete(hour)
    r.set(day, bucket.per_day, ex=86_400)
    response = _send(owner, method, path, payload)
    assert (response.status_code, response.json()) == (429, RATE_LIMITED)
    assert 3600 < int(response.headers["retry-after"]) <= 86_400
    assert (_count(hour), _count(day)) == (None, bucket.per_day)


def test_ac3_what_counts(client: TestClient, seeker: TestClient, gush_dan: uuid.UUID) -> None:
    hour, day = _keys(limits.WRITE, _user_id(seeker))
    r = get_redis()

    assert seeker.put("/me/profile", json={**_p(gush_dan), "budget_max_ils": -1}).status_code == 422
    client.cookies.clear()
    assert client.put("/me/profile", json=_p(gush_dan)).status_code == 401
    assert list(r.scan_iter(match="rl:write:*")) == []

    assert seeker.put("/me/profile", json=_p(gush_dan)).status_code == 200
    assert (_count(hour), _count(day)) == (1, 1)
    assert 0 < r.ttl(hour) <= 3600
    assert 0 < r.ttl(day) <= 86_400

    assert seeker.patch(f"/listings/{uuid.uuid4()}", json={"price_ils": 7000}).status_code == 404
    assert (_count(hour), _count(day)) == (2, 2)


def test_ac4_address_changes_have_their_own_limit(
    owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    owner_id = _user_id(owner)
    write, _ = _keys(limits.WRITE, owner_id)
    address, _ = _keys(limits.ADDRESS, owner_id)
    created = owner.post("/listings", json=_body(gush_dan))
    assert created.status_code == 201, created.text
    url = f"/listings/{created.json()['id']}"

    assert owner.patch(url, json={"street": "ביאליק"}).status_code == 200
    assert (_count(write), _count(address)) == (1, 1)
    assert owner.patch(url, json={"price_ils": 7100}).status_code == 200
    assert (_count(write), _count(address)) == (2, 1)

    get_redis().set(address, limits.ADDRESS.per_hour, ex=3600)
    sql = "SELECT street, geocode_status, updated_at FROM listings WHERE id = :id"
    with db_engine.connect() as conn:
        before = conn.execute(text(sql), {"id": created.json()["id"]}).one()
    response = owner.patch(url, json={"street": "הרצל"})
    assert (response.status_code, response.json()) == (429, RATE_LIMITED)
    with db_engine.connect() as conn:
        assert conn.execute(text(sql), {"id": created.json()["id"]}).one() == before
    assert (_count(write), _count(address)) == (2, limits.ADDRESS.per_hour)
    assert owner.patch(url, json={"price_ils": 7200}).status_code == 200
    assert _count(write) == 3


def test_ac5_listing_create_limit(
    owner: TestClient, seeker: TestClient, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    hour, _ = _keys(limits.CREATE, _user_id(owner))
    for _ in range(3):
        assert owner.post("/listings", json=_body(gush_dan)).status_code == 201
    capped = owner.post("/listings", json=_body(gush_dan))
    assert (capped.status_code, capped.json()) == (409, {"detail": "listing_cap_reached"})
    assert _count(hour) == 4  # a 409 counts
    while (_count(hour) or 0) < limits.CREATE.per_hour:
        assert owner.post("/listings", json=_body(gush_dan)).status_code == 409

    response = owner.post("/listings", json=_body(gush_dan))
    assert (response.status_code, response.json()) == (429, RATE_LIMITED)
    assert _scalar(db_engine, "SELECT count(*) FROM listings") == 3

    refused = seeker.post("/listings", json=_body(gush_dan))
    assert (refused.status_code, refused.json()) == (403, {"detail": "owner_only"})
    assert list(get_redis().scan_iter(match=f"rl:create:user*:{_user_id(seeker)}")) == []


def test_ac6_status_noop_and_limit_publish_nothing(
    owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    published: list[tuple[Any, ...]] = []
    monkeypatch.setattr(chat_events, "publish", lambda *args: published.append(args))
    members: list[tuple[Any, ...]] = []
    real_members = chat_service.event_members

    def record_members(*args: Any) -> Any:
        members.append(args)
        return real_members(*args)

    monkeypatch.setattr(chat_service, "event_members", record_members)
    owner_id = _user_id(owner)
    listing = make_listing(db_engine, owner_id, gush_dan)
    shortlisted = make_application(
        db_engine, listing, make_seeker(db_engine, "a@example.com"), status="shortlisted"
    )
    declined = make_application(
        db_engine, listing, make_seeker(db_engine, "b@example.com"), status="declined"
    )
    sql = "SELECT status, updated_at FROM applications WHERE id = :id"

    def row(application: uuid.UUID) -> Any:
        with db_engine.connect() as conn:
            return conn.execute(text(sql), {"id": application}).one()

    def patch(application: uuid.UUID, status: str) -> httpx.Response:
        response: httpx.Response = owner.patch(
            f"/listings/{listing}/applications/{application}", json={"status": status}
        )
        return response

    for application, status in ((shortlisted, "shortlisted"), (declined, "declined")):
        before = row(application)
        response = patch(application, status)
        assert response.status_code == 200, response.text
        assert response.json()["status"] == status
        assert row(application) == before
    assert published == [] and members == []

    assert patch(shortlisted, "submitted").status_code == 200
    assert len(published) == 1 and len(members) == 1
    assert row(shortlisted).status == "submitted"

    published.clear()
    members.clear()
    hour, _ = _keys(limits.STATUS, owner_id)
    get_redis().set(hour, limits.STATUS.per_hour, ex=3600)
    response = patch(shortlisted, "shortlisted")
    assert (response.status_code, response.json()) == (429, RATE_LIMITED)
    assert row(shortlisted).status == "submitted"
    assert published == [] and members == []


def _padded(body: dict[str, Any], size: int) -> bytes:
    raw = json.dumps(body).encode()
    return raw + b" " * (size - len(raw))


def test_ac12_body_size_cap(
    owner: TestClient, gush_dan: uuid.UUID, db_engine: Engine, photo_store: FilePhotoStore
) -> None:
    origin = get_settings().web_origin
    headers = {"Content-Type": "application/json", "Origin": origin}

    over = _padded(_p(gush_dan), MAX_BODY_BYTES + 1)
    response = owner.put("/me/profile", content=over, headers=headers)
    assert (response.status_code, response.json()) == (413, TOO_LARGE)
    assert response.headers["access-control-allow-origin"] == origin

    def chunks() -> Iterator[bytes]:
        yield over[:40_000]
        yield over[40_000:]

    response = owner.put("/me/profile", content=chunks(), headers=headers)
    assert "content-length" not in response.request.headers
    assert (response.status_code, response.json()) == (413, TOO_LARGE)

    exact = _padded(_p(gush_dan), MAX_BODY_BYTES)
    assert len(exact) == MAX_BODY_BYTES
    assert owner.put("/me/profile", content=exact, headers=headers).status_code == 200

    lifestyle = {**{f"k{n}": 2 for n in range(19_999)}, "I am pregnant": 2}
    response = owner.post("/listings", json=_room(gush_dan, lifestyle=lifestyle))
    assert (response.status_code, response.json()) == (413, TOO_LARGE)
    assert _scalar(db_engine, "SELECT count(*) FROM listings") == 0

    listing = make_listing(db_engine, _user_id(owner), gush_dan)
    junk = {"content": os.urandom(100_000), "headers": {"Content-Type": "image/jpeg"}}
    for response in (
        owner.put("/me/photo", **junk),
        owner.post(f"/listings/{listing}/photos", **junk),
    ):
        assert (response.status_code, response.json()) == (415, {"detail": "unsupported_image"})


def test_ac13_validation_detail_capped() -> None:
    errors = [
        {"type": "missing", "loc": ("body", f"f{n}"), "msg": "Field required"} for n in range(60)
    ]
    response = asyncio.run(
        _request_invalid(Request({"type": "http"}), RequestValidationError(errors))
    )
    detail = json.loads(bytes(response.body))["detail"]
    assert [entry["loc"] for entry in detail] == [["body", f"f{n}"] for n in range(50)]


def test_ac14_people_likes_counts_browse(seeker: TestClient) -> None:
    user_id = _user_id(seeker)
    response = seeker.get("/me/people-likes")
    assert (response.status_code, response.json()) == (403, {"detail": "card_required"})
    assert _count(f"rl:browse:user:{user_id}") == 1

    get_redis().set(f"rl:browse:user:{user_id}", BROWSE_RATE_LIMIT_HOUR, ex=3600)
    response = seeker.get("/me/people-likes")
    assert (response.status_code, response.json()) == (429, RATE_LIMITED)
    assert 1 <= int(response.headers["retry-after"]) <= 3600
