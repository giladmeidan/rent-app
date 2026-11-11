"""Shared fixtures.

Integration tests run against Postgres at `TEST_DATABASE_URL` (locally the compose `db`, in CI the
service container) and Redis at `REDIS_URL`. The app under test is pointed at the test database by
overriding `DATABASE_URL` before any app module is imported, so no dependency overrides are needed.
"""

import datetime as dt
import os
import re
import uuid
from collections.abc import Iterator
from decimal import Decimal
from pathlib import Path
from typing import Any, cast

import httpx
import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from psycopg.types.json import Jsonb
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import make_url

API_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = API_DIR.parent


def _required_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} must be set (see .env.example / Makefile)")
    return value


TEST_DATABASE_URL: str = _required_env("TEST_DATABASE_URL")
_required_env("REDIS_URL")

os.environ["DATABASE_URL"] = TEST_DATABASE_URL

from fastapi.testclient import TestClient  # noqa: E402

from app.config import get_database_settings, get_settings  # noqa: E402
from app.db import get_engine, get_ping_engine, get_sessionmaker  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import Application, Listing, SeekerProfile  # noqa: E402
from app.redis_client import get_redis  # noqa: E402
from app.services.email import get_email_sender  # noqa: E402
from scripts.seed import seed_areas  # noqa: E402

get_settings.cache_clear()
get_database_settings.cache_clear()
get_engine.cache_clear()
get_ping_engine.cache_clear()
get_sessionmaker.cache_clear()
get_redis.cache_clear()


def alembic_config(database_url: str) -> Config:
    cfg = Config(str(API_DIR / "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
    return cfg


def _admin_engine(database_url: str) -> Engine:
    """Engine on the `postgres` maintenance database of the same server, in AUTOCOMMIT mode."""
    admin_url = make_url(database_url).set(database="postgres")
    return create_engine(admin_url, isolation_level="AUTOCOMMIT")


def ensure_database(database_url: str) -> None:
    name = make_url(database_url).database
    admin = _admin_engine(database_url)
    try:
        with admin.connect() as conn:
            exists = conn.execute(
                text("SELECT 1 FROM pg_database WHERE datname = :n"), {"n": name}
            ).scalar()
            if not exists:
                conn.execute(text(f'CREATE DATABASE "{name}"'))
    finally:
        admin.dispose()


def drop_database(database_url: str) -> None:
    name = make_url(database_url).database
    admin = _admin_engine(database_url)
    try:
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
    finally:
        admin.dispose()


@pytest.fixture(scope="session")
def migrated_db() -> Iterator[Engine]:
    """Test database created if missing and migrated to head once per session."""
    ensure_database(TEST_DATABASE_URL)
    command.upgrade(alembic_config(TEST_DATABASE_URL), "head")
    engine = get_engine()
    yield engine
    engine.dispose()


@pytest.fixture
def db_engine(migrated_db: Engine) -> Iterator[Engine]:
    """Per-test engine on clean `room_pairs`, `seeker_profiles`, `messages`, `conversations`,
    `applications`, `listings`, `sessions`, `users` and `areas` tables."""
    with migrated_db.begin() as conn:
        conn.execute(
            text(
                "TRUNCATE TABLE room_pairs, seeker_profiles, messages, conversations, applications,"
                " listings, sessions, users, areas"
            )
        )
    yield migrated_db


@pytest.fixture
def client(db_engine: Engine) -> Iterator[TestClient]:
    with TestClient(create_app()) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    """No test reaches the network (spec 0003c NF1): every real httpx transport raises. Starlette's
    `TestClient` and `httpx.MockTransport` use their own transports and are unaffected."""

    def refuse(self: httpx.HTTPTransport, request: httpx.Request) -> httpx.Response:
        raise RuntimeError("network disabled in tests")

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", refuse)


@pytest.fixture
def geo_clean() -> None:
    """Delete the test sweeps' Redis keys (`test-geo:*`) before the test. The spec stack's worker
    uses `geo:*` on the same Redis; those are never touched."""
    r = get_redis()
    for key in r.scan_iter(match="test-geo:*"):
        r.delete(key)


@pytest.fixture
def redis_clean() -> None:
    """Delete the OTP and rate-limit keys before the test. Tests share the dev Redis, so only these
    key families are touched, never FLUSHDB."""
    r = get_redis()
    for pattern in ("otp:*", "rl:*"):
        for key in r.scan_iter(match=pattern):
            r.delete(key)


class Outbox:
    """In-memory `EmailSender`: collects `(to, subject, body)`."""

    def __init__(self) -> None:
        self.messages: list[tuple[str, str, str]] = []

    def send(self, to: str, subject: str, body: str) -> None:
        self.messages.append((to, subject, body))


@pytest.fixture
def outbox(client: TestClient) -> Iterator[Outbox]:
    app = cast(FastAPI, client.app)
    box = Outbox()
    app.dependency_overrides[get_email_sender] = lambda: box
    yield box
    app.dependency_overrides.pop(get_email_sender, None)


@pytest.fixture
def gush_dan(db_engine: Engine) -> uuid.UUID:
    """The seeded launch area `gush-dan` (via `scripts/seed.py`), by id."""
    seed_areas(db_engine)
    with db_engine.connect() as conn:
        area_id: uuid.UUID = conn.execute(
            text("SELECT id FROM areas WHERE slug = 'gush-dan'")
        ).scalar_one()
    return area_id


_CODE_LINE = re.compile(r"^[0-9]{6}$", re.M)


def signup(
    client: TestClient, outbox: Outbox, email: str, role: str, display_name: str = "נועה"
) -> TestClient:
    """Sign `email` up as `role` (and `display_name`) through the OTP endpoints and return a new
    `TestClient` holding only that session cookie. `client.cookies` is cleared, so two users
    signed up in one test never share a cookie jar. Needs the `redis_clean` fixture (rate
    limits)."""
    response = client.post("/auth/otp/request", json={"email": email})
    assert response.status_code == 204
    match = _CODE_LINE.search(outbox.messages[-1][2])
    assert match is not None
    profile = {"display_name": display_name, "role": role}
    response = client.post(
        "/auth/otp/verify", json={"email": email, "code": match.group(), "profile": profile}
    )
    assert response.status_code == 201
    token = response.cookies["rent_session"]
    client.cookies.clear()
    return TestClient(client.app, cookies={"rent_session": token})


def make_owner(engine: Engine, email: str) -> uuid.UUID:
    """Insert an owner `users` row directly (no OTP, no session) and return its id."""
    with engine.begin() as conn:
        owner_id: uuid.UUID = conn.execute(
            text(
                "INSERT INTO users (email, display_name, role) "
                "VALUES (:email, 'בעלים', 'owner') RETURNING id"
            ),
            {"email": email},
        ).scalar_one()
    return owner_id


def make_seeker(
    engine: Engine, email: str, display_name: str = "\u05de\u05d9\u05db\u05dc"
) -> uuid.UUID:
    """Insert a seeker `users` row directly (no OTP, no session) and return its id."""
    with engine.begin() as conn:
        seeker_id: uuid.UUID = conn.execute(
            text(
                "INSERT INTO users (email, display_name, role) "
                "VALUES (:email, :display_name, 'seeker') RETURNING id"
            ),
            {"email": email, "display_name": display_name},
        ).scalar_one()
    return seeker_id


_LISTING_COLUMNS = frozenset(Listing.__table__.columns.keys())
_APPLICATION_COLUMNS = frozenset(Application.__table__.columns.keys())
_PROFILE_COLUMNS = frozenset(SeekerProfile.__table__.columns.keys())


def make_profile(engine: Engine, user_id: uuid.UUID, area_id: uuid.UUID, **overrides: Any) -> None:
    """Insert a housing profile for `user_id` directly (spec 0006a), bypassing the API's checks.
    Defaults are the specs' valid body `P`: budget 7500, move-in 30 days after today (UTC, as the
    API's window is), not flexible, `area_ids=[area_id]`, a couple, no pets, non-smoker, 24
    months, one parking spot. `overrides` may set any column (0008a: `people_visible`, `about_me`
    too)."""
    unknown = set(overrides) - _PROFILE_COLUMNS
    if unknown:
        raise ValueError(f"not seeker_profiles columns: {sorted(unknown)}")
    values: dict[str, Any] = {
        "user_id": user_id,
        "budget_max_ils": 7500,
        "move_in_date": dt.datetime.now(dt.UTC).date() + dt.timedelta(days=30),
        "move_in_flexible": False,
        "area_ids": [area_id],
        "household": "couple",
        "has_pets": False,
        "smoker": False,
        "contract_months": 24,
        "parking_needed": 1,
        **overrides,
    }
    values = {k: Jsonb(v) if isinstance(v, dict) else v for k, v in values.items()}  # `lifestyle`
    columns = ", ".join(values)
    params = ", ".join(
        "CAST(:area_ids AS uuid[])" if name == "area_ids" else f":{name}" for name in values
    )
    with engine.begin() as conn:
        conn.execute(text(f"INSERT INTO seeker_profiles ({columns}) VALUES ({params})"), values)


def make_application(
    engine: Engine, listing_id: uuid.UUID, seeker_id: uuid.UUID, **overrides: Any
) -> uuid.UUID:
    """Insert an application directly and return its id. Defaults: `message='Hello'`,
    `status='submitted'`, and the listing's current `price_ils` / `area_id` / `listing_type` as
    `price_ils_at_apply` / `area_id_at_apply` (0006c) / `listing_type_at_apply` (0007b), which is
    what applying snapshots; `overrides` may set any column (including `created_at` and a
    snapshot). Bypasses the service, its room gate and its rate limit."""
    unknown = set(overrides) - _APPLICATION_COLUMNS
    if unknown:
        raise ValueError(f"not applications columns: {sorted(unknown)}")
    values: dict[str, Any] = {
        "listing_id": listing_id,
        "seeker_id": seeker_id,
        "message": "Hello",
        "status": "submitted",
        **overrides,
    }
    snapshot = {
        column: f"(SELECT {source} FROM listings WHERE id = :listing_id)"
        for column, source in (
            ("price_ils_at_apply", "price_ils"),
            ("area_id_at_apply", "area_id"),
            ("listing_type_at_apply", "listing_type"),
        )
        if column not in values
    }
    columns = ", ".join([*values, *snapshot])
    params = ", ".join([*(f":{name}" for name in values), *snapshot.values()])
    with engine.begin() as conn:
        application_id: uuid.UUID = conn.execute(
            text(f"INSERT INTO applications ({columns}) VALUES ({params}) RETURNING id"), values
        ).scalar_one()
    return application_id


def make_pair(
    engine: Engine,
    listing_id: uuid.UUID,
    seeker_id: uuid.UUID,
    *,
    price_ils_seen: int,
    lister_liked: bool = False,
    seeker_liked: bool = False,
) -> uuid.UUID:
    """Insert a `room_pairs` row directly (spec 0008a) and return its id (the person card's id).
    A like flag sets that side's timestamp to now(). Bypasses the service and its candidate
    rules."""
    with engine.begin() as conn:
        pair_id: uuid.UUID = conn.execute(
            text(
                "INSERT INTO room_pairs (listing_id, seeker_id, price_ils_seen, lister_liked_at,"
                " seeker_liked_at) VALUES (:listing_id, :seeker_id, :price,"
                " CASE WHEN :lister THEN now() END, CASE WHEN :seeker THEN now() END) RETURNING id"
            ),
            {
                "listing_id": listing_id,
                "seeker_id": seeker_id,
                "price": price_ils_seen,
                "lister": lister_liked,
                "seeker": seeker_liked,
            },
        ).scalar_one()
    return pair_id


def make_listing(
    engine: Engine, owner_id: uuid.UUID, area_id: uuid.UUID, **overrides: Any
) -> uuid.UUID:
    """Insert a live apartment listing directly and return its id. `overrides` may set any column
    (including `created_at`). Bypasses the service and its owner cap on purpose: search tests need
    more than 3 rows per owner."""
    unknown = set(overrides) - _LISTING_COLUMNS
    if unknown:
        raise ValueError(f"not listings columns: {sorted(unknown)}")
    values: dict[str, Any] = {
        "owner_id": owner_id,
        "area_id": area_id,
        "listing_type": "apartment",
        "city": "גבעתיים",
        "street": "כצנלסון",
        "rooms": Decimal("3.5"),
        "floor": 3,
        "total_floors": 5,
        "size_sqm": 95,
        "price_ils": 7200,
        "available_from": dt.date.today() + dt.timedelta(days=30),
        "entry_flexible": True,
        "elevator": True,
        "parking_spots": 1,
        "furnished": "partial",
        "pets_allowed": True,
        "arnona_ils": 480,
        "vaad_ils": 150,
        "description": "דירה מוארת",
        "status": "active",
        "expires_at": dt.datetime.now(dt.UTC) + dt.timedelta(days=90),
        **overrides,
    }
    values = {k: Jsonb(v) if isinstance(v, dict) else v for k, v in values.items()}  # `lifestyle`
    columns = ", ".join(values)
    params = ", ".join(f":{name}" for name in values)
    with engine.begin() as conn:
        listing_id: uuid.UUID = conn.execute(
            text(f"INSERT INTO listings ({columns}) VALUES ({params}) RETURNING id"), values
        ).scalar_one()
    return listing_id


def set_location(engine: Engine, listing_id: uuid.UUID, lng: float, lat: float) -> None:
    """Mark a listing located at `(lng, lat)` (`geocode_status = 'ok'`), as the worker would."""
    with engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE listings SET geocode_status = 'ok',"
                " location = ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography"
                " WHERE id = :id"
            ),
            {"id": listing_id, "lng": lng, "lat": lat},
        )
