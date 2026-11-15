"""The arq worker's geocoding cron (spec 0003c AC13) and what it logs (NF3).

`app.worker` is imported (and reloaded) inside each test, not at collection: importing it sets the
`httpx` logger to WARNING for the whole process (NF3), which would hide the TestClient request logs
that other tests use to prove logging is captured at all. `httpx_log_level` restores the level after
each test; the reload re-runs the import-time setup the next test checks."""

import functools
import importlib
import logging
import uuid
from collections.abc import Iterator

import httpx
import pytest
from sqlalchemy import Engine, text

from app.redis_client import get_redis
from app.services import geocoding
from app.services.geocoding import FakeGeocoder, NominatimGeocoder
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

    importlib.reload(worker)
    (job,) = (j for j in worker.WorkerSettings.cron_jobs if j.coroutine is worker.geocode_listings)
    assert job.second == {0, 10, 20, 30, 40, 50}
    assert job.unique is True
    assert logging.getLogger("httpx").level == logging.WARNING

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


@pytest.mark.usefixtures("httpx_log_level")
def test_ac12_rent_import_cron_registered() -> None:
    # Spec 0014a: the monthly import of the official rent figures, past arq's 300 s default.
    from app import worker

    importlib.reload(worker)
    (job,) = (
        j
        for j in worker.WorkerSettings.cron_jobs
        if j.coroutine is worker.import_rent_reference_job
    )
    assert (job.day, job.hour, job.minute) == (5, 3, 10)
    assert job.unique is True
    assert job.timeout_s == 1800


@pytest.fixture
def app_logger_restored() -> Iterator[None]:
    app_logger = logging.getLogger("app")
    level, handlers = app_logger.level, list(app_logger.handlers)
    yield
    app_logger.setLevel(level)
    app_logger.handlers[:] = handlers


@pytest.mark.asyncio
@pytest.mark.usefixtures("httpx_log_level", "app_logger_restored")
async def test_ac8_worker_logs_its_info_lines(monkeypatch: pytest.MonkeyPatch) -> None:
    # Spec 0013g: arq's CLI leaves the root at WARNING; the startup hook makes `app` log INFO.
    from app import worker

    importlib.reload(worker)
    logging.getLogger("app").setLevel(logging.NOTSET)
    await worker.WorkerSettings.on_startup({})
    await worker.WorkerSettings.on_startup({})  # idempotent: one handler
    app_logger = logging.getLogger("app")
    assert app_logger.getEffectiveLevel() == logging.INFO
    assert logging.getLogger("httpx").getEffectiveLevel() == logging.WARNING
    (handler,) = (h for h in app_logger.handlers if getattr(h, "_homie_worker", False))
    records: list[logging.LogRecord] = []
    monkeypatch.setattr(handler, "emit", records.append)
    logging.getLogger("app.worker").info("view flush: %d", 0)
    assert [r.getMessage() for r in records] == ["view flush: 0"]

    # A sweep with nothing to do logs no line; one with work logs its counts.
    for counts, lines in (({"located": 0, "failed": 0}, 0), ({"located": 1, "failed": 0}, 1)):
        monkeypatch.setattr(worker, "_sweep", lambda counts=counts: counts)
        records.clear()
        await worker.geocode_listings({})
        assert len(records) == lines


@pytest.mark.asyncio
@pytest.mark.usefixtures("geo_clean", "httpx_log_level")
async def test_nf3_worker_logs_no_address(
    caplog: pytest.LogCaptureFixture,
    monkeypatch: pytest.MonkeyPatch,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    from app import worker

    importlib.reload(worker)
    caplog.set_level(logging.INFO)
    katz = "\u05db\u05e6\u05e0\u05dc\u05e1\u05d5\u05df"  # make_listing's default street
    giv = "\u05d2\u05d1\u05e2\u05ea\u05d9\u05d9\u05dd"  # and city

    requests: list[httpx.Request] = []

    def nominatim(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json=[{"lat": "32.07", "lon": "34.81"}])

    with httpx.Client(
        transport=httpx.MockTransport(nominatim),
        base_url="https://nominatim.test",
        headers={"User-Agent": "rent-app-test/1.0"},
    ) as client:
        point = NominatimGeocoder(client).geocode(giv, katz, (34.74, 31.95, 34.95, 32.17))
    assert point == (34.81, 32.07)
    assert len(requests) == 1

    monkeypatch.setattr(worker, "get_geocoder", FakeGeocoder)
    monkeypatch.setattr(
        worker,
        "geocode_pending",
        functools.partial(geocoding.geocode_pending, key_prefix="test-geo:"),
    )
    make_listing(db_engine, make_owner(db_engine, "owner@example.com"), gush_dan)
    assert (await worker.geocode_listings({}))["located"] == 1

    assert any(record.name == "app.worker" for record in caplog.records)  # the counts line
    for leaked in (katz, giv, "/search?"):
        assert leaked not in caplog.text


@pytest.mark.asyncio
@pytest.mark.usefixtures("redis_clean", "httpx_log_level")
async def test_ac5_worker_flushes_views_every_minute(
    gush_dan: uuid.UUID, db_engine: Engine
) -> None:
    # Spec 0011e: the autouse `views_prefix` keeps these pending views out of the stack's worker.
    from app import worker

    importlib.reload(worker)
    (job,) = (
        j for j in worker.WorkerSettings.cron_jobs if j.coroutine is worker.flush_listing_views
    )
    assert job.second == {30}
    assert job.minute is None  # every minute
    assert job.unique is True

    listing_id = make_listing(db_engine, make_owner(db_engine, "owner@example.com"), gush_dan)
    get_redis().hincrby("test-views:pending", str(listing_id), 2)

    assert await worker.flush_listing_views({}) == 2

    with db_engine.connect() as conn:
        views = conn.execute(
            text("SELECT view_count FROM listings WHERE id = :id"), {"id": listing_id}
        ).scalar_one()
    assert views == 2
    assert not get_redis().exists("test-views:pending")
