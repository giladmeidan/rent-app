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
from tests.conftest import Outbox, make_application, make_listing, make_owner, make_seeker


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


@pytest.mark.asyncio
@pytest.mark.usefixtures("httpx_log_level")
async def test_ac11_purge_cron_registered(
    db_engine: Engine, caplog: pytest.LogCaptureFixture
) -> None:
    # Spec 0013h: the nightly retention purge, its counts logged and nothing else.
    from app import worker

    importlib.reload(worker)
    (job,) = (j for j in worker.WorkerSettings.cron_jobs if j.coroutine is worker.purge_expired_job)
    assert (job.hour, job.minute) == (3, 25)
    assert job.unique is True

    with caplog.at_level(logging.INFO, logger="app.worker"):
        counts = await worker.purge_expired_job({})

    assert set(counts.values()) == {0}
    assert [r.getMessage() for r in caplog.records if r.name == "app.worker"] == [
        f"retention purge: {counts}"
    ]


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


@pytest.mark.asyncio
@pytest.mark.usefixtures("httpx_log_level")
async def test_ac13_tour_mail_crons_registered_and_log_counts(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    gush_dan: uuid.UUID,
    db_engine: Engine,
) -> None:
    # Spec 0018c: the mail drain every 10 s and the reminder sweep every 15 min, counts-only logs.
    from app import worker

    importlib.reload(worker)
    jobs = {j.coroutine: j for j in worker.WorkerSettings.cron_jobs}
    mail, reminders = jobs[worker.send_tour_mail_job], jobs[worker.tour_reminders_job]
    assert mail.second == {5, 15, 25, 35, 45, 55} and mail.minute is None
    assert reminders.minute == {0, 15, 30, 45} and reminders.second == 0
    assert mail.unique is True and reminders.unique is True

    outbox = Outbox()
    monkeypatch.setattr(worker, "get_email_sender", lambda: outbox)
    owner_id = make_owner(db_engine, "owner@example.com")
    seeker_id = make_seeker(db_engine, "seeker@example.com", "Dana")
    listing_id = make_listing(db_engine, owner_id, gush_dan)
    application_id = make_application(db_engine, listing_id, seeker_id, status="shortlisted")
    with db_engine.begin() as conn:
        tour_id = conn.execute(
            text(
                "INSERT INTO tours (listing_id, application_id, seeker_id, starts_at, ends_at,"
                " updated_at) VALUES (:l, :a, :s, now() + interval '23 hours',"
                " now() + interval '23 hours 30 minutes', now() - interval '3 days') RETURNING id"
            ),
            {"l": listing_id, "a": application_id, "s": seeker_id},
        ).scalar_one()

    with caplog.at_level(logging.INFO, logger="app"):
        assert await worker.send_tour_mail_job({}) == {
            "sent": 0,
            "skipped": 0,
            "retried": 0,
            "dropped": 0,
        }
        assert await worker.tour_reminders_job({}) == 1
        assert await worker.tour_reminders_job({}) == 0
        counts = await worker.send_tour_mail_job({})

    assert counts["sent"] == 2 and len(outbox.messages) == 2
    # One line per job run that did something, counts only.
    assert [r.getMessage() for r in caplog.records if r.name == "app.worker"] == [
        "tour reminders: 1",
        f"tour mail: {counts}",
    ]
    for leaked in ("owner@example.com", "seeker@example.com", "Dana", str(tour_id)):
        assert leaked not in caplog.text
    assert "כצנלסון" not in caplog.text  # the street
