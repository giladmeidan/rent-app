"""The arq worker's geocoding cron (spec 0003c AC13).

`app.worker` is imported inside the test, not at collection: importing it sets the `httpx` logger to
WARNING for the whole process (NF3), which would hide the TestClient request logs that other tests
use to prove logging is captured at all. The `httpx_log_level` fixture restores the level after."""

import functools
import logging
import uuid
from collections.abc import Iterator

import pytest
from sqlalchemy import Engine, text

from app.services import geocoding
from app.services.geocoding import FakeGeocoder
from tests.conftest import make_listing, make_owner


@pytest.fixture
def httpx_log_level() -> Iterator[None]:
    httpx_logger = logging.getLogger("httpx")
    level = httpx_logger.level
    yield
    httpx_logger.setLevel(level)


@pytest.mark.asyncio
@pytest.mark.usefixtures("geo_clean", "httpx_log_level")
async def test_ac13_worker_sweeps_every_10_seconds(
    monkeypatch: pytest.MonkeyPatch, gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    from app import worker

    (job,) = worker.WorkerSettings.cron_jobs
    assert job.coroutine is worker.geocode_listings
    assert job.second == {0, 10, 20, 30, 40, 50}
    assert job.unique is True
    assert logging.getLogger("httpx").getEffectiveLevel() == logging.WARNING

    monkeypatch.setattr(worker, "get_geocoder", FakeGeocoder)
    # The test prefix: the spec stack's own worker shares this Redis and its `geo:` lock.
    monkeypatch.setattr(
        worker,
        "geocode_pending",
        functools.partial(geocoding.geocode_pending, key_prefix="test-geo:"),
    )
    listing_id = make_listing(db_engine, make_owner(db_engine, "owner@example.com"), gush_dan)

    counts = await worker.geocode_listings({})

    assert counts["located"] == 1
    with db_engine.connect() as conn:
        status = conn.execute(
            text("SELECT geocode_status FROM listings WHERE id = :id"), {"id": listing_id}
        ).scalar_one()
    assert status == "ok"
