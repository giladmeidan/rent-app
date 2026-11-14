"""Listing views off the request path (spec 0011e): counted in Redis once per viewer per listing per
hour, flushed into `listings.view_count` by the worker. Every key uses the `test-views:` prefix (the
autouse `views_prefix`), so the spec stack's own worker never drains these tests' pending views."""

import logging
import re
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
import redis
from fastapi.testclient import TestClient
from sqlalchemy import Engine, event, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.db import get_sessionmaker
from app.redis_client import get_redis
from app.services import listing_views
from tests.conftest import Outbox, make_listing, make_owner, signup

pytestmark = pytest.mark.usefixtures("redis_clean")

PENDING = "test-views:pending"


@pytest.fixture
def statements(db_engine: Engine) -> Iterator[list[str]]:
    """Every SQL statement the app engine sends while the test records (`.clear()` to start)."""
    seen: list[str] = []

    def record(_conn: Any, _cursor: Any, statement: str, *_: Any) -> None:
        seen.append(statement)

    event.listen(db_engine, "before_cursor_execute", record)
    yield seen
    event.remove(db_engine, "before_cursor_execute", record)


@pytest.fixture
def owner_id(db_engine: Engine) -> uuid.UUID:
    return make_owner(db_engine, "owner@example.com")


def _pending(listing_id: uuid.UUID) -> int | None:
    value = get_redis().hget(PENDING, str(listing_id))
    return None if value is None else int(value)


def _row(engine: Engine, listing_id: uuid.UUID) -> tuple[int, Any]:
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT view_count, updated_at FROM listings WHERE id = :id"), {"id": listing_id}
        ).one()
    return row.view_count, row.updated_at


def test_ac1_listing_view_counted_once_per_viewer_hour(
    client: TestClient,
    outbox: Outbox,
    owner_id: uuid.UUID,
    gush_dan: uuid.UUID,
    db_engine: Engine,
    statements: list[str],
) -> None:
    listing = make_listing(db_engine, owner_id, gush_dan)
    paused = make_listing(db_engine, owner_id, gush_dan, status="paused")

    assert client.get(f"/listings/{listing}").status_code == 200
    statements.clear()
    assert client.get(f"/listings/{listing}").status_code == 200
    sent = list(statements)
    assert _pending(listing) == 1

    assert len(sent) == 3, sent
    assert "FROM listings" in sent[0]
    assert "FROM applications" in sent[1]
    assert "FROM listing_photos" in sent[2]
    assert not [s for s in sent if s.lstrip().upper().startswith(("UPDATE", "INSERT"))]

    user = signup(client, outbox, "viewer@example.com", "seeker")
    assert user.get(f"/listings/{listing}").status_code == 200
    assert _pending(listing) == 2
    assert user.get(f"/listings/{listing}").status_code == 200
    assert _pending(listing) == 2

    assert client.get(f"/listings/{paused}").status_code == 404
    assert _pending(paused) is None
    assert _pending(listing) == 2


def test_ac2_view_keys_reveal_nothing(
    client: TestClient, outbox: Outbox, owner_id: uuid.UUID, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    listing = make_listing(db_engine, owner_id, gush_dan)
    user = signup(client, outbox, "viewer@example.com", "seeker")
    user_id = user.get("/me").json()["id"]

    assert client.get(f"/listings/{listing}").status_code == 200
    assert user.get(f"/listings/{listing}").status_code == 200

    r = get_redis()
    keys = [key.decode() for key in r.scan_iter(match="test-views:seen:*")]
    assert len(keys) == 2
    for key in keys:
        assert re.fullmatch(r"test-views:seen:[0-9a-f]{32}", key), key
        assert str(listing) not in key and listing.hex not in key
        assert user_id not in key and uuid.UUID(user_id).hex not in key
        assert "testclient" not in key
        assert 0 < r.ttl(key) <= 3600


def test_ac3_flush_views(
    owner_id: uuid.UUID,
    gush_dan: uuid.UUID,
    db_engine: Engine,
    statements: list[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    a = make_listing(db_engine, owner_id, gush_dan)
    b = make_listing(db_engine, owner_id, gush_dan)
    before_a, updated_a = _row(db_engine, a)
    before_b, updated_b = _row(db_engine, b)
    r = get_redis()
    r.hincrby(PENDING, str(a), 2)
    r.hincrby(PENDING, str(b), 1)

    with get_sessionmaker()() as db:
        assert listing_views.flush_views(db, r) == 3
        assert _row(db_engine, a) == (before_a + 2, updated_a)
        assert _row(db_engine, b) == (before_b + 1, updated_b)
        assert not r.exists(PENDING)

        statements.clear()
        assert listing_views.flush_views(db, r) == 0
        assert statements == []

    r.hincrby(PENDING, str(a), 2)
    r.hincrby(PENDING, str(b), 1)

    def broken(self: Session, *args: Any, **kwargs: Any) -> Any:
        raise OperationalError("UPDATE listings", {}, Exception("db down"))

    monkeypatch.setattr(Session, "execute", broken)
    with get_sessionmaker()() as db, pytest.raises(OperationalError):
        listing_views.flush_views(db, r)
    monkeypatch.undo()

    assert (_pending(a), _pending(b)) == (2, 1)
    assert _row(db_engine, a) == (before_a + 2, updated_a)


def test_ac4_view_count_never_fails_the_page(
    client: TestClient,
    owner_id: uuid.UUID,
    gush_dan: uuid.UUID,
    db_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    listing = make_listing(db_engine, owner_id, gush_dan)
    usual = client.get(f"/listings/{listing}").json()

    def down(*args: Any, **kwargs: Any) -> Any:
        raise redis.ConnectionError("Error connecting to redis")

    monkeypatch.setattr(redis.Redis, "set", down)
    with caplog.at_level(logging.WARNING, logger="app.services.listing_views"):
        response = client.get(f"/listings/{listing}")

    assert response.status_code == 200
    assert response.json() == usual
    (record,) = [rec for rec in caplog.records if rec.name == "app.services.listing_views"]
    assert record.levelno == logging.WARNING
    assert "ConnectionError" in record.getMessage()
    assert "testclient" not in caplog.text
