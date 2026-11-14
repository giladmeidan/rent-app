"""Shared fixtures.

Integration tests run against Postgres at `TEST_DATABASE_URL` (locally the compose `db`, in CI the
service container) and Redis at `REDIS_URL`. The app under test is pointed at the test database by
overriding `DATABASE_URL` before any app module is imported, so no dependency overrides are needed.
"""

import datetime as dt
import os
import re
import secrets
import uuid
from collections.abc import Iterator
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from typing import Any, cast

import httpx
import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from PIL import Image
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
from app.services import listing_views  # noqa: E402
from app.services.email import get_email_sender  # noqa: E402
from app.services.photo_store import FilePhotoStore, get_photo_store  # noqa: E402
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
    """Per-test engine on clean `reports`, `listing_price_changes`, `listing_photos`,
    `conversation_reads`, `listing_flatmates`, `room_pairs`, `person_pairs`, `seeker_profiles`,
    `messages`, `conversations`, `applications`, `listings`, `sessions`, `users` and `areas`
    tables."""
    with migrated_db.begin() as conn:
        conn.execute(
            text(
                "TRUNCATE TABLE reports, listing_price_changes, listing_photos, conversation_reads,"
                " listing_flatmates, room_pairs,"
                " person_pairs, seeker_profiles, messages, conversations, applications, listings,"
                " sessions, users, areas"
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


@pytest.fixture(autouse=True)
def views_prefix(monkeypatch: pytest.MonkeyPatch) -> None:
    """Listing views use `test-views:` (spec 0011e): the spec stack's own worker drains
    `views:pending` on the same Redis every minute."""
    monkeypatch.setattr(listing_views, "KEY_PREFIX", "test-views:")


@pytest.fixture
def geo_clean() -> None:
    """Delete the test sweeps' Redis keys (`test-geo:*`) before the test. The spec stack's worker
    uses `geo:*` on the same Redis; those are never touched."""
    r = get_redis()
    for key in r.scan_iter(match="test-geo:*"):
        r.delete(key)


@pytest.fixture
def redis_clean() -> None:
    """Delete the OTP, rate-limit and test listing-view keys before the test. Tests share the dev
    Redis, so only these key families are touched, never FLUSHDB."""
    r = get_redis()
    for pattern in ("otp:*", "rl:*", "test-views:*"):
        for key in r.scan_iter(match=pattern):
            r.delete(key)


# Official rent figures (specs 0014a, 0014c, 0014d), shared by the engine, API and import tests.
# Six quarters, newest last; the default window (4) is the last four.
QUARTERS = [
    dt.date(2025, 3, 1),
    dt.date(2025, 6, 1),
    dt.date(2025, 9, 1),
    dt.date(2025, 12, 1),
    dt.date(2026, 3, 1),
    dt.date(2026, 6, 1),
]
TEL_AVIV = "תל אביב -יפו"  # the source's spelling
HOOD_A = "הצפון הישן"
HOOD_B = "לב העיר"
# rooms → the first quarter's figure; each later quarter adds 100.
CITY_BASE = {3: 5000, 4: 6600, 5: 8200}
HOOD_A_BASE = {3: 4000, 4: 6000, 5: 7600}
SETTLEMENTS = {
    5000: TEL_AVIV,
    6400: "הרצליה",
    7900: "פתח תקווה",
    8300: "ראשון לציון",
    2620: "קריית אונו",
    9400: "יהוד-מונוסון",
    229: "גני תקווה",
    8600: "רמת גן",
}


@pytest.fixture
def rent_clean(migrated_db: Engine) -> Engine:
    with migrated_db.begin() as conn:
        conn.execute(text("TRUNCATE rent_prices, rent_areas"))
    return migrated_db


def _rent_area(
    conn: Any, kind: str, source_id: int, code: int, name: str, streets: list[str]
) -> Any:
    return conn.execute(
        text(
            "INSERT INTO rent_areas (kind, source_id, settlement_code, name_he, centre, streets,"
            " source_version) VALUES (:kind, :source, :code, :name,"
            " ST_SetSRID(ST_MakePoint(34.78, 32.08), 4326), :streets, '20-08-2026') RETURNING id"
        ),
        {"kind": kind, "source": source_id, "code": code, "name": name, "streets": streets},
    ).scalar_one()


def _rent_price(conn: Any, area_id: uuid.UUID, rooms: int, period: dt.date, price: int) -> None:
    conn.execute(
        text("INSERT INTO rent_prices (area_id, rooms, period, price_ils) VALUES (:a, :r, :p, :v)"),
        {"a": area_id, "r": rooms, "p": period, "v": price},
    )


@pytest.fixture
def rent_figures(rent_clean: Engine) -> Engine:
    """Settlement rows for the eight alias codes, figures on 5000 only: the city and
    neighbourhood A (rooms 3-5, six quarters), neighbourhood B one 4-room figure (thin)."""
    with rent_clean.begin() as conn:
        ids = {
            code: _rent_area(conn, "settlement", code, code, name, [])
            for code, name in SETTLEMENTS.items()
        }
        hood_a = _rent_area(
            conn, "neighbourhood", 101, 5000, HOOD_A, ["תירוש", "דיזנגוף", "רחוב הירקון"]
        )
        hood_b = _rent_area(conn, "neighbourhood", 102, 5000, HOOD_B, ["דיזנגוף", "בלפור"])
        for i, period in enumerate(QUARTERS):
            for rooms in (3, 4, 5):
                _rent_price(conn, ids[5000], rooms, period, CITY_BASE[rooms] + 100 * i)
                _rent_price(conn, hood_a, rooms, period, HOOD_A_BASE[rooms] + 100 * i)
        _rent_price(conn, hood_b, 4, QUARTERS[-1], 9000)
    return rent_clean


@pytest.fixture
def cbs_clean(migrated_db: Engine) -> Engine:
    with migrated_db.begin() as conn:
        conn.execute(text("TRUNCATE cbs_rent_prices"))
    return migrated_db


def insert_cbs(
    engine: Engine, kind: str, code: int, ratio: Decimal, periods: list[dt.date]
) -> None:
    """CBS rows for one geography: 2.5-3 rooms at 7,000 and 1-2 rooms at 7,000 × `ratio` in each
    period (bulletin 7/2026)."""
    with engine.begin() as conn:
        for period in periods:
            for group, price in (("2.5-3", Decimal(7000)), ("1-2", 7000 * ratio)):
                conn.execute(
                    text(
                        "INSERT INTO cbs_rent_prices (geo_kind, geo_code, room_group, period,"
                        " price_ils, bulletin) VALUES (:k, :c, :g, :p, :v, '2026-07-01')"
                    ),
                    {"k": kind, "c": code, "g": group, "p": period, "v": price},
                )


@pytest.fixture
def cbs_figures(cbs_clean: Engine) -> Engine:
    """CBS ratios over the last four of `QUARTERS`: city 5000 at 0.8, district 5 at 0.85."""
    insert_cbs(cbs_clean, "city", 5000, Decimal("0.8"), QUARTERS[-4:])
    insert_cbs(cbs_clean, "district", 5, Decimal("0.85"), QUARTERS[-4:])
    return cbs_clean


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
def photo_store(client: TestClient, tmp_path: Path) -> Iterator[FilePhotoStore]:
    """A `FilePhotoStore` in `tmp_path / "media"`, installed as the app's photo store (spec
    0010d). AC11 builds its own app instead."""
    app = cast(FastAPI, client.app)
    store = FilePhotoStore(tmp_path / "media")
    app.dependency_overrides[get_photo_store] = lambda: store
    yield store
    app.dependency_overrides.pop(get_photo_store, None)


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

# `make_profile(..., gender=..., **NO_LOOKING)` writes a personal-only row (spec 0010c): the 7
# looking columns NULL, and `parking_needed` back to its default (`make_profile` sets 1, which
# `ck_seeker_profiles_looking_defaults` refuses without the looking part).
NO_LOOKING: dict[str, Any] = {
    "budget_max_ils": None,
    "move_in_date": None,
    "area_ids": None,
    "household": None,
    "has_pets": None,
    "smoker": None,
    "contract_months": None,
    "parking_needed": 0,
}


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


def make_card(
    engine: Engine,
    user_id: uuid.UUID,
    area_id: uuid.UUID,
    *,
    gender: str,
    flatmate_gender: str = "any",
    **overrides: Any,
) -> uuid.UUID:
    """Show `user_id`'s card in שוק השותפים (spec 0010h): `make_profile` with both parts (`P0`'s
    looking part, the personal part's `gender`), `flatmate_gender` and `people_visible`. Returns
    the user's `card_id`. `overrides` may set any other profile column."""
    make_profile(
        engine,
        user_id,
        area_id,
        gender=gender,
        flatmate_gender=flatmate_gender,
        people_visible=True,
        **overrides,
    )
    with engine.connect() as conn:
        card_id: uuid.UUID = conn.execute(
            text("SELECT card_id FROM users WHERE id = :id"), {"id": user_id}
        ).scalar_one()
    return card_id


def make_person_like(engine: Engine, liker: uuid.UUID, liked: uuid.UUID) -> None:
    """`liker` likes `liked` (spec 0010h): the ordered `person_pairs` row, written or updated
    directly with the liker's side set to now() (an earlier like kept). Bypasses the service, its
    candidate rule, its limiter and the chat a mutual like opens."""
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO person_pairs (user_low, user_high, low_liked_at, high_liked_at)"
                " VALUES (least(CAST(:a AS uuid), CAST(:b AS uuid)),"
                " greatest(CAST(:a AS uuid), CAST(:b AS uuid)),"
                " CASE WHEN CAST(:a AS uuid) < CAST(:b AS uuid) THEN now() END,"
                " CASE WHEN CAST(:a AS uuid) > CAST(:b AS uuid) THEN now() END)"
                " ON CONFLICT (user_low, user_high) DO UPDATE SET"
                " low_liked_at = coalesce(person_pairs.low_liked_at, excluded.low_liked_at),"
                " high_liked_at = coalesce(person_pairs.high_liked_at, excluded.high_liked_at)"
            ),
            {"a": liker, "b": liked},
        )


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
) -> uuid.UUID:
    """Insert a `room_pairs` row directly (spec 0008a) and return its id (the person card's id).
    `lister_liked` sets `lister_liked_at` to now() (an invite, spec 0010l). Bypasses the service
    and its candidate rules."""
    with engine.begin() as conn:
        pair_id: uuid.UUID = conn.execute(
            text(
                "INSERT INTO room_pairs (listing_id, seeker_id, price_ils_seen, lister_liked_at)"
                " VALUES (:listing_id, :seeker_id, :price, CASE WHEN :lister THEN now() END)"
                " RETURNING id"
            ),
            {
                "listing_id": listing_id,
                "seeker_id": seeker_id,
                "price": price_ils_seen,
                "lister": lister_liked,
            },
        ).scalar_one()
    return pair_id


def make_flatmate(
    engine: Engine,
    listing_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    joined_at: dt.datetime | None = None,
    shown: bool = False,
) -> uuid.UUID:
    """Insert a `listing_flatmates` row directly (spec 0008d) and return its id (the membership's
    id). `joined_at` defaults to now(); `shown` (spec 0010f) to false. Bypasses the invite link,
    the limiter and the join rules."""
    with engine.begin() as conn:
        flatmate_id: uuid.UUID = conn.execute(
            text(
                "INSERT INTO listing_flatmates (listing_id, user_id, joined_at, shown)"
                " VALUES (:listing_id, :user_id, coalesce(:joined_at, now()), :shown) RETURNING id"
            ),
            {"listing_id": listing_id, "user_id": user_id, "joined_at": joined_at, "shown": shown},
        ).scalar_one()
    return flatmate_id


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


def make_direct_chat(
    engine: Engine, a: uuid.UUID, b: uuid.UUID, *, closed: bool = False
) -> uuid.UUID:
    """Insert a direct chat between `a` and `b` (spec 0010g) directly and return its id. The pair
    is ordered in SQL (`least` / `greatest`), as `chat.open_direct` does; `closed` sets
    `closed_at` to now(). Bypasses the service."""
    with engine.begin() as conn:
        conversation_id: uuid.UUID = conn.execute(
            text(
                "INSERT INTO conversations (owner_id, seeker_id, closed_at)"
                " VALUES (least(CAST(:a AS uuid), CAST(:b AS uuid)),"
                " greatest(CAST(:a AS uuid), CAST(:b AS uuid)),"
                " CASE WHEN :closed THEN now() END) RETURNING id"
            ),
            {"a": a, "b": b, "closed": closed},
        ).scalar_one()
    return conversation_id


def make_photo(
    engine: Engine, listing_id: uuid.UUID, *, position: int, key: str | None = None
) -> uuid.UUID:
    """Insert a `listing_photos` row directly (spec 0010d) and return its id. `key` defaults to a
    fresh random key; no object is stored. Bypasses the service, its cap and its lock."""
    with engine.begin() as conn:
        photo_id: uuid.UUID = conn.execute(
            text(
                "INSERT INTO listing_photos (listing_id, key, position, width, height)"
                " VALUES (:listing_id, :key, :position, 1600, 1067) RETURNING id"
            ),
            {
                "listing_id": listing_id,
                "key": key or secrets.token_urlsafe(32),
                "position": position,
            },
        ).scalar_one()
    return photo_id


def jpeg(
    width: int = 800, height: int = 600, *, exif_gps: bool = False, orientation: int = 1
) -> bytes:
    """A JPEG built in memory (spec 0010d): a horizontal gradient, so a rotation is visible.
    `exif_gps` adds an EXIF GPS block (a point in Tel Aviv); `orientation` sets EXIF Orientation
    (274) when it is not 1."""
    image = Image.linear_gradient("L").resize((width, height)).convert("RGB")
    exif = Image.Exif()
    if orientation != 1:
        exif[0x0112] = orientation
    if exif_gps:
        exif[0x010F] = "FakeCam"  # Make, so IFD0 is not empty either
        exif.get_ifd(0x8825).update({1: "N", 2: (32.0, 4.0, 48.0), 3: "E", 4: (34.0, 46.0, 56.0)})
    out = BytesIO()
    image.save(out, format="JPEG", quality=85, exif=exif.tobytes() if len(exif) else b"")
    return out.getvalue()
