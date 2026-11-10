"""Approximate listing locations (spec 0003c): the address-change reset (AC2), the worker sweep
(AC3-AC6), the Nominatim client (AC7), `approximate_point` / `street_query` / `FakeGeocoder` (AC8)
and the no-network guard (NF1).

Sweeps run against the test database and the dev Redis with `key_prefix="test-geo:"` (`geo_clean`),
so they never touch or wait on the keys of a running worker."""

import datetime as dt
import hashlib
import json
import logging
import math
import random
import uuid
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.redis_client import get_redis
from app.schemas.listing import ListingOut
from app.services.geocoding import (
    Envelope,
    FakeGeocoder,
    GeocoderUnavailable,
    NominatimGeocoder,
    Point,
    approximate_point,
    geocode_pending,
    get_geocoder,
    street_query,
)
from scripts.seed import GUSH_DAN_WKT
from tests.conftest import Outbox, make_listing, make_owner, set_location, signup

KATZ = "\u05db\u05e6\u05e0\u05dc\u05e1\u05d5\u05df"  # make_listing's default street
GIV = "\u05d2\u05d1\u05e2\u05ea\u05d9\u05d9\u05dd"  # make_listing's default city
WEIZ = "\u05d5\u05d9\u05e6\u05de\u05df"
BIALIK = "\u05d1\u05d9\u05d0\u05dc\u05d9\u05e7"
HERZL = "\u05d4\u05e8\u05e6\u05dc"
RAMAT_GAN = "\u05e8\u05de\u05ea \u05d2\u05df"

SECRET = "test-secret-for-approximate-points-0123"
PREFIX = "test-geo:"
LOCK = f"{PREFIX}sweep-lock"
PAUSE = f"{PREFIX}pause"
GUSH_DAN_ENVELOPE: Envelope = (34.74, 31.95, 34.95, 32.17)
POINT: Point = (34.8123, 32.0712)


@dataclass
class FakeClock:
    """`now` advances by every `sleep` and by whatever a stub adds."""

    now: float = 0.0
    sleeps: list[float] = field(default_factory=list)

    def clock(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


Answer = Point | None | GeocoderUnavailable


@dataclass
class Stub:
    """Records `(city, street, envelope)` per call and returns (or raises) the answer for the
    street, `default` otherwise; `cost_s` is added to the clock per call."""

    clock: FakeClock
    min_interval_s: float = 0.0
    cost_s: float = 0.0
    default: Answer = POINT
    answers: dict[str, Answer] = field(default_factory=dict)
    on_call: Callable[[], None] | None = None
    calls: list[tuple[str, str, Envelope]] = field(default_factory=list)

    def geocode(self, city: str, street: str, envelope: Envelope) -> Point | None:
        self.calls.append((city, street, envelope))
        self.clock.now += self.cost_s
        if self.on_call is not None:
            self.on_call()
        answer = self.answers.get(street, self.default)
        if isinstance(answer, GeocoderUnavailable):
            raise answer
        return answer


def _sweep(engine: Engine, stub: Stub) -> dict[str, int]:
    with Session(engine) as db:
        return geocode_pending(
            db,
            get_redis(),
            stub,
            secret=SECRET,
            key_prefix=PREFIX,
            clock=stub.clock.clock,
            sleep=stub.clock.sleep,
        )


def _counts(**nonzero: int) -> dict[str, int]:
    return {"located": 0, "not_found": 0, "retry": 0, "failed": 0, "cached": 0, **nonzero}


@dataclass(frozen=True)
class Geo:
    status: str
    attempts: int
    lng: float | None
    lat: float | None


def _geo(engine: Engine, listing_id: uuid.UUID | str) -> Geo:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT geocode_status, geocode_attempts,"
                " ST_X(location::geometry), ST_Y(location::geometry)"
                " FROM listings WHERE id = :id"
            ),
            {"id": listing_id},
        ).one()
    return Geo(*row)


PENDING = Geo("pending", 0, None, None)


def _cache_key(area_id: uuid.UUID, city: str, street: str) -> str:
    digest = hashlib.sha256(f"{area_id}|{city}|{street}".encode()).hexdigest()
    return f"{PREFIX}v1:{digest}"


# --- AC2 ---------------------------------------------------------------------------------------


def _listing_body(area_id: uuid.UUID) -> dict[str, Any]:
    return {
        "listing_type": "apartment",
        "area_id": str(area_id),
        "city": GIV,
        "street": KATZ,
        "rooms": 3.5,
        "floor": 3,
        "size_sqm": 95,
        "price_ils": 7200,
        "available_from": (dt.date.today() + dt.timedelta(days=30)).isoformat(),
        "elevator": True,
        "furnished": "partial",
        "pets_allowed": True,
    }


@pytest.mark.usefixtures("redis_clean")
def test_ac2_create_and_address_change_mark_pending(
    client: TestClient, outbox: Outbox, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    with db_engine.begin() as conn:
        second_area: uuid.UUID = conn.execute(
            text(
                "INSERT INTO areas (slug, name_he, geom) "
                "VALUES ('second-area', 'b', ST_GeomFromText(:wkt, 4326)) RETURNING id"
            ),
            {"wkt": GUSH_DAN_WKT},
        ).scalar_one()
    owner = signup(client, outbox, "owner@example.com", "owner")
    created = owner.post("/listings", json=_listing_body(gush_dan))
    assert created.status_code == 201, created.text
    listing_id = created.json()["id"]
    assert _geo(db_engine, listing_id) == PENDING
    out_keys = set(ListingOut.model_fields)
    assert set(created.json()) == out_keys

    def patch(body: dict[str, Any]) -> None:
        response = owner.patch(f"/listings/{listing_id}", json=body)
        assert response.status_code == 200, response.text
        assert set(response.json()) == out_keys

    def locate() -> Geo:
        set_location(db_engine, listing_id, 34.8, 32.08)
        located = _geo(db_engine, listing_id)
        assert located == Geo("ok", 0, 34.8, 32.08)
        return located

    located = locate()
    patch({"price_ils": 7500})
    assert _geo(db_engine, listing_id) == located
    patch({"street": KATZ})  # the current value
    assert _geo(db_engine, listing_id) == located
    patch({"street": WEIZ})
    assert _geo(db_engine, listing_id) == PENDING

    locate()
    patch({"city": RAMAT_GAN})
    assert _geo(db_engine, listing_id) == PENDING

    locate()
    patch({"area_id": str(second_area)})
    assert _geo(db_engine, listing_id) == PENDING


# --- AC3-AC6: the sweep -------------------------------------------------------------------------


@pytest.fixture
def owner_id(db_engine: Engine) -> uuid.UUID:
    return make_owner(db_engine, "owner@example.com")


@pytest.mark.usefixtures("geo_clean")
def test_ac3_sweep_locates_live_pending_listings_with_cache(
    caplog: pytest.LogCaptureFixture, gush_dan: uuid.UUID, db_engine: Engine, owner_id: uuid.UUID
) -> None:
    caplog.set_level(logging.INFO)
    an_hour_ago = dt.datetime.now(dt.UTC) - dt.timedelta(hours=1)
    katz_1 = make_listing(db_engine, owner_id, gush_dan)
    katz_2 = make_listing(db_engine, owner_id, gush_dan)
    weiz = make_listing(db_engine, owner_id, gush_dan, street=f"{WEIZ} 12")
    paused = make_listing(db_engine, owner_id, gush_dan, status="paused")
    expired = make_listing(db_engine, owner_id, gush_dan, expires_at=an_hour_ago)
    stub = Stub(FakeClock())

    counts = _sweep(db_engine, stub)

    assert stub.calls == [(GIV, KATZ, GUSH_DAN_ENVELOPE), (GIV, WEIZ, GUSH_DAN_ENVELOPE)]
    for listing_id in (katz_1, katz_2, weiz):
        geo = _geo(db_engine, listing_id)
        assert geo.status == "ok"
        assert geo.lng is not None and geo.lat is not None
        expected_lng, expected_lat = approximate_point(listing_id, POINT, SECRET)
        assert geo.lng == pytest.approx(expected_lng, abs=1e-9)
        assert geo.lat == pytest.approx(expected_lat, abs=1e-9)
    assert _geo(db_engine, katz_1) != _geo(db_engine, katz_2)
    assert _geo(db_engine, paused) == PENDING
    assert _geo(db_engine, expired) == PENDING
    assert counts == _counts(located=3, cached=1)
    assert not get_redis().exists(LOCK)

    katz_3 = make_listing(db_engine, owner_id, gush_dan)
    assert _sweep(db_engine, stub) == _counts(located=1, cached=1)
    assert len(stub.calls) == 2  # a cache hit
    assert _geo(db_engine, katz_3).status == "ok"

    for secret_text in (KATZ, GIV, "34.81"):
        assert secret_text not in caplog.text


def _reset_rows_and_cache(engine: Engine) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE listings SET location = NULL, geocode_status = 'pending',"
                " geocode_attempts = 0"
            )
        )
    redis = get_redis()
    for key in redis.scan_iter(match=f"{PREFIX}*"):
        redis.delete(key)


@pytest.mark.usefixtures("geo_clean")
def test_ac4_sweep_paces_requests_holds_lock_and_stops_on_budget(
    gush_dan: uuid.UUID, db_engine: Engine, owner_id: uuid.UUID
) -> None:
    ids = [make_listing(db_engine, owner_id, gush_dan, street=s) for s in (KATZ, WEIZ, BIALIK)]
    paced = Stub(FakeClock(), min_interval_s=1.1, cost_s=0.5)

    assert _sweep(db_engine, paced) == _counts(located=3)
    assert paced.clock.sleeps == [1.1, 1.1, 1.1]
    assert len(paced.calls) == 3
    assert not get_redis().exists(LOCK)

    _reset_rows_and_cache(db_engine)
    slow = Stub(FakeClock(), cost_s=3.0)
    assert _sweep(db_engine, slow) == _counts(located=2)
    assert [street for _, street, _ in slow.calls] == [KATZ, WEIZ]
    assert [_geo(db_engine, i).status for i in ids[:2]] == ["ok", "ok"]
    assert _geo(db_engine, ids[2]) == PENDING
    assert not get_redis().exists(LOCK)

    _reset_rows_and_cache(db_engine)
    redis = get_redis()
    redis.set(LOCK, 1, ex=60)
    try:
        locked = Stub(FakeClock())
        assert _sweep(db_engine, locked) == {"skipped": 1}
        assert locked.calls == []
        assert redis.exists(LOCK)  # another sweep's lock is not released
        assert all(_geo(db_engine, i) == PENDING for i in ids)
    finally:
        redis.delete(LOCK)


@pytest.mark.usefixtures("geo_clean")
def test_ac5_failures_keep_listing_live_and_off_the_map(
    client: TestClient, gush_dan: uuid.UUID, db_engine: Engine, owner_id: uuid.UUID
) -> None:
    redis = get_redis()
    # Not found: off the map, still listed; negatively cached.
    street_a = KATZ
    stub = Stub(FakeClock(), answers={street_a: None})
    a_1 = make_listing(db_engine, owner_id, gush_dan, street=street_a)
    assert _sweep(db_engine, stub) == _counts(not_found=1)
    assert _geo(db_engine, a_1) == Geo("not_found", 0, None, None)
    a_2 = make_listing(db_engine, owner_id, gush_dan, street=street_a)
    assert _sweep(db_engine, stub) == _counts(not_found=1, cached=1)
    assert len(stub.calls) == 1
    assert _geo(db_engine, a_2).status == "not_found"
    listed = client.get("/listings").json()
    assert {item["id"]: (item["lat"], item["lng"]) for item in listed["items"]} == {
        str(a_1): (None, None),
        str(a_2): (None, None),
    }
    boxed = client.get("/listings?west=34.74&south=31.95&east=34.95&north=32.17").json()
    assert boxed == {"items": [], "total": 0}

    # Only a house number: not found without a call.
    number_only = make_listing(db_engine, owner_id, gush_dan, street="12")
    assert _sweep(db_engine, stub) == _counts(not_found=1)
    assert len(stub.calls) == 1
    assert _geo(db_engine, number_only).status == "not_found"

    # An outage: an attempt is spent, geocoding pauses, nothing is cached.
    street_b = WEIZ
    failing = Stub(FakeClock(), answers={street_b: GeocoderUnavailable(stop_sweep=False)})
    b = make_listing(db_engine, owner_id, gush_dan, street=street_b)
    assert _sweep(db_engine, failing) == _counts(retry=1)
    assert _geo(db_engine, b) == Geo("pending", 1, None, None)
    assert redis.exists(PAUSE)
    assert 0 < redis.ttl(PAUSE) <= 300
    assert _sweep(db_engine, failing) == {"skipped": 1}
    assert len(failing.calls) == 1
    assert _geo(db_engine, b) == Geo("pending", 1, None, None)
    for attempt in range(2, 6):
        redis.delete(PAUSE)
        expected = _counts(failed=1) if attempt == 5 else _counts(retry=1)
        assert _sweep(db_engine, failing) == expected
        assert _geo(db_engine, b).attempts == attempt
    assert _geo(db_engine, b) == Geo("failed", 5, None, None)
    assert len(failing.calls) == 5
    assert not redis.exists(_cache_key(gush_dan, GIV, street_b))
    redis.delete(PAUSE)

    # Any outage ends the sweep: the second row is untouched.
    for stop_sweep, max_ttl, min_ttl in ((False, 300, 0), (True, 3600, 300)):
        first = make_listing(db_engine, owner_id, gush_dan, street=BIALIK)
        second = make_listing(db_engine, owner_id, gush_dan, street=HERZL)
        outage = Stub(FakeClock(), default=GeocoderUnavailable(stop_sweep=stop_sweep))
        assert _sweep(db_engine, outage) == _counts(retry=1)
        assert len(outage.calls) == 1
        assert _geo(db_engine, first) == Geo("pending", 1, None, None)
        assert _geo(db_engine, second) == PENDING
        assert min_ttl < redis.ttl(PAUSE) <= max_ttl
        redis.delete(PAUSE)
        with db_engine.begin() as conn:
            conn.execute(
                text("DELETE FROM listings WHERE id IN (:a, :b)"), {"a": first, "b": second}
            )


@pytest.mark.usefixtures("geo_clean")
def test_ac5_a_failed_row_goes_behind_fresh_ones(
    gush_dan: uuid.UUID, db_engine: Engine, owner_id: uuid.UUID
) -> None:
    an_hour_ago = dt.datetime.now(dt.UTC) - dt.timedelta(hours=1)
    failed_once = make_listing(
        db_engine, owner_id, gush_dan, street=WEIZ, geocode_attempts=1, updated_at=an_hour_ago
    )
    fresh = make_listing(db_engine, owner_id, gush_dan, street=BIALIK)
    outage = Stub(FakeClock(), default=GeocoderUnavailable(stop_sweep=False))

    assert _sweep(db_engine, outage) == _counts(retry=1)
    assert [street for _, street, _ in outage.calls] == [BIALIK]
    assert _geo(db_engine, fresh) == Geo("pending", 1, None, None)
    assert _geo(db_engine, failed_once) == Geo("pending", 1, None, None)
    get_redis().delete(PAUSE)

    healthy = Stub(FakeClock())
    assert _sweep(db_engine, healthy) == _counts(located=2)
    assert [street for _, street, _ in healthy.calls] == [WEIZ, BIALIK]  # then by updated_at


@pytest.mark.usefixtures("geo_clean")
def test_ac6_result_for_a_changed_address_is_dropped(
    gush_dan: uuid.UUID, db_engine: Engine, owner_id: uuid.UUID
) -> None:
    listing_id = make_listing(db_engine, owner_id, gush_dan)

    def owner_changes_street() -> None:
        with db_engine.begin() as conn:
            conn.execute(
                text("UPDATE listings SET street = :street WHERE id = :id"),
                {"street": WEIZ, "id": listing_id},
            )

    stub = Stub(FakeClock(), on_call=owner_changes_street)
    _sweep(db_engine, stub)
    assert [street for _, street, _ in stub.calls] == [KATZ]
    assert _geo(db_engine, listing_id) == PENDING

    stub.on_call = None
    _sweep(db_engine, stub)
    assert [street for _, street, _ in stub.calls] == [KATZ, WEIZ]
    assert _geo(db_engine, listing_id).status == "ok"


# --- AC7: Nominatim -----------------------------------------------------------------------------


@pytest.fixture
def nominatim_settings(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("GEOCODER", "nominatim")
    monkeypatch.setenv("NOMINATIM_URL", "https://nominatim.test")
    monkeypatch.setenv("NOMINATIM_USER_AGENT", "rent-app-test/1.0")
    get_settings.cache_clear()
    get_geocoder.cache_clear()
    yield
    geocoder = get_geocoder()
    if isinstance(geocoder, NominatimGeocoder):
        geocoder.client.close()
    # Lazily re-read once the environment is restored.
    get_settings.cache_clear()
    get_geocoder.cache_clear()


@dataclass
class Nominatim:
    """A `MockTransport` handler answering every request with `respond()`."""

    respond: Callable[[httpx.Request], httpx.Response]
    requests: list[httpx.Request] = field(default_factory=list)

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self.respond(request)

    def geocode(self, street: str = f"{KATZ} 12\u05d0") -> Point | None:
        client = httpx.Client(
            transport=httpx.MockTransport(self.handler),
            base_url="https://nominatim.test",
            headers={"User-Agent": "rent-app-test/1.0"},
        )
        with client:
            return NominatimGeocoder(client).geocode(GIV, street, GUSH_DAN_ENVELOPE)


def _answer(status: int = 200, payload: Any = None, content: bytes | None = None) -> Nominatim:
    body = content if content is not None else json.dumps(payload).encode()
    return Nominatim(lambda _request: httpx.Response(status, content=body))


def _unavailable(nominatim: Nominatim) -> GeocoderUnavailable:
    with pytest.raises(GeocoderUnavailable) as excinfo:
        nominatim.geocode()
    assert len(nominatim.requests) == 1
    return excinfo.value


@pytest.mark.usefixtures("nominatim_settings")
def test_ac7_nominatim_request_and_response_handling() -> None:
    configured = get_geocoder()
    assert isinstance(configured, NominatimGeocoder)
    assert str(configured.client.base_url).rstrip("/") == "https://nominatim.test"
    assert configured.client.headers["User-Agent"] == "rent-app-test/1.0"
    assert configured.client.timeout == httpx.Timeout(3.0)

    found = _answer(payload=[{"lat": "32.0712345", "lon": "34.8123456"}])
    assert found.geocode() == (34.8123456, 32.0712345)
    (request,) = found.requests
    assert request.method == "GET"
    assert request.url.path == "/search"
    assert len(request.url.params.multi_items()) == 8
    assert dict(request.url.params) == {
        "street": KATZ,
        "city": GIV,
        "countrycodes": "il",
        "format": "jsonv2",
        "limit": "1",
        "accept-language": "he",
        "viewbox": "34.74,32.17,34.95,31.95",
        "bounded": "1",
    }
    assert request.headers["User-Agent"] == "rent-app-test/1.0"
    assert "From" not in request.headers
    assert all("@" not in f"{name}: {value}" for name, value in request.headers.items())

    assert _answer(payload=[]).geocode() is None
    assert _answer(payload=[{"lat": "31.5", "lon": "34.8"}]).geocode() is None  # outside the box
    number_only = _answer(payload=[{"lat": "32.07", "lon": "34.81"}])
    assert number_only.geocode("12") is None
    assert number_only.requests == []

    for status in (429, 403):
        assert _unavailable(_answer(status=status, payload=[])).stop_sweep is True

    def timeout(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out", request=request)

    transient = (
        _answer(status=500, payload=[]),
        Nominatim(timeout),
        _answer(content=b"<html>not json</html>"),
        _answer(payload={}),
        _answer(payload=[{"lat": "x"}]),
        _answer(payload=[{"lat": "nan", "lon": "34.8"}]),
    )
    for nominatim in transient:
        assert _unavailable(nominatim).stop_sweep is False


# --- AC8 ----------------------------------------------------------------------------------------


def test_ac8_approximate_point_street_query_and_fake_geocoder() -> None:
    fixed = uuid.UUID("00000000-0000-4000-8000-000000000001")
    rng = random.Random(3)
    ids = [fixed, *(uuid.UUID(int=rng.getrandbits(128)) for _ in range(20))]
    for listing_id in ids:
        result = approximate_point(listing_id, POINT, SECRET)
        assert approximate_point(listing_id, POINT, SECRET) == result
        for value, original in zip(result, POINT, strict=True):
            assert round(value, 4) == value
            assert 0.0001 - 5e-5 <= abs(value - original) <= 0.002 + 5e-5
    other_id = uuid.UUID("00000000-0000-4000-8000-000000000002")
    assert approximate_point(other_id, POINT, SECRET) != approximate_point(fixed, POINT, SECRET)
    assert approximate_point(fixed, POINT, SECRET + "x") != approximate_point(fixed, POINT, SECRET)

    house_numbers = (
        f"{KATZ} 12",
        f"{KATZ}  12\u05d0 ",
        f"12 {KATZ}",
        f"{KATZ} 12,",
        f"{KATZ} 12/3",
        f"{KATZ} 12-14",
        f"{KATZ} 12A",
        f"{KATZ} #12",
        f"{KATZ} 12\u05d0\u05f3",
        f"{KATZ} 12\u05d0'",
    )
    for street in house_numbers:
        assert street_query(street) == KATZ, street
    assert street_query(f"{KATZ}12") == f"{KATZ}12"  # space-less: out of scope (FOLLOWUPS)
    assert street_query("12") == ""
    assert street_query("\u05d4-12") == "\u05d4-12"
    assert street_query(f"\u05d4-12  {KATZ}") == f"\u05d4-12 {KATZ}"

    fake = FakeGeocoder()
    point = fake.geocode(GIV, KATZ, GUSH_DAN_ENVELOPE)
    assert point is not None
    assert fake.geocode(GIV, f"{KATZ} 12", GUSH_DAN_ENVELOPE) == point
    west, south, east, north = GUSH_DAN_ENVELOPE
    lng, lat = point
    assert west + (east - west) / 4 <= lng <= east - (east - west) / 4
    assert south + (north - south) / 4 <= lat <= north - (north - south) / 4
    assert all(math.isfinite(v) for v in point)
    assert fake.geocode(GIV, WEIZ, GUSH_DAN_ENVELOPE) != point
    assert fake.min_interval_s == 0


# --- NF1 ----------------------------------------------------------------------------------------


def test_nf1_tests_cannot_reach_the_network() -> None:
    with pytest.raises(RuntimeError, match="network disabled in tests"):
        httpx.get("https://nominatim.openstreetmap.org/status")
