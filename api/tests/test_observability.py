"""Sentry error reports (spec 0019a): off without a DSN, and nothing personal in what is sent.

Every test captures with an in-memory transport (no network) and closes the client afterwards,
so the rest of the suite runs with Sentry off."""

import asyncio
import importlib
import json
import logging
import uuid
from collections.abc import Callable, Iterator
from typing import Any

import arq.worker
import pytest
import redis
import sentry_sdk
from arq import cron
from arq.connections import RedisSettings
from fastapi import HTTPException, Request
from fastapi.testclient import TestClient
from pydantic import BaseModel
from sentry_sdk.envelope import Envelope
from sentry_sdk.transport import Transport
from sqlalchemy import Engine, text
from sqlalchemy.exc import OperationalError

from app.config import get_settings
from app.main import create_app
from app.observability import init_sentry, scrub_event
from app.services import health
from app.services import tour_feed as tour_feed_service

DSN = "https://public@o0.ingest.de.sentry.io/1"
EMAIL = "dana.levi@example.com"
NAME = "Dana Canary-Levi"
PHONE = "0527654321"
TOKEN = "FeedTokenCanary" + "x" * 28
# Kept out of the tests' bodies: a frame's source context would otherwise quote them.
COOKIE = "session-cookie-canary"
AUTHORIZATION = "Bearer auth-canary"
PASSWORD = "password-canary"
QUERY = "budget=5000&q=query-canary"
ITEM = "item-id-canary"


class _Capture(Transport):
    """Keeps every event in memory instead of sending it."""

    def __init__(self, events: list[dict[str, Any]]) -> None:
        super().__init__()
        self.events = events

    def capture_envelope(self, envelope: Envelope) -> None:
        for item in envelope.items:
            if item.type in ("event", "transaction") and item.payload.json is not None:
                self.events.append(item.payload.json)


@pytest.fixture
def sentry_events(
    monkeypatch: pytest.MonkeyPatch, set_env: Callable[..., None]
) -> Iterator[list[dict[str, Any]]]:
    """A DSN in the settings and `sentry_sdk.init` on a capturing transport; Sentry off after."""
    events: list[dict[str, Any]] = []
    real_init = sentry_sdk.init

    def init(**options: Any) -> Any:
        return real_init(transport=_Capture(events), **options)

    monkeypatch.setattr(sentry_sdk, "init", init)
    set_env(SENTRY_DSN=DSN, SENTRY_ENVIRONMENT="test")
    yield events
    sentry_sdk.get_client().close()
    sentry_sdk.get_global_scope().set_client(None)
    assert not sentry_sdk.get_client().is_active()


def _strings(value: Any) -> Iterator[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for key, item in value.items():
            yield str(key)
            yield from _strings(item)
    elif isinstance(value, list | tuple):
        for item in value:
            yield from _strings(item)


def _dump(event: dict[str, Any]) -> str:
    return json.dumps(event, ensure_ascii=False)


def _exception_values(event: dict[str, Any]) -> list[dict[str, Any]]:
    return list(event.get("exception", {}).get("values", []))


def test_ac1_off_without_dsn(set_env: Callable[..., None]) -> None:
    set_env(SENTRY_DSN="")
    assert not sentry_sdk.get_client().is_active()

    create_app()
    from app import worker

    importlib.reload(worker)  # runs the module-level init again, with these settings

    assert not sentry_sdk.get_client().is_active()


def test_ac2_unhandled_error_is_scrubbed(sentry_events: list[dict[str, Any]]) -> None:
    app = create_app()

    @app.post("/boom/{item}")
    async def boom(item: str, request: Request) -> None:
        payload = await request.json()
        logging.getLogger("app.test").warning("handling %s", payload["email"])  # a breadcrumb
        raise RuntimeError("boom")

    with TestClient(app, raise_server_exceptions=False) as client:
        client.cookies.set("session", COOKIE)
        response = client.post(
            f"/boom/{ITEM}?{QUERY}",
            json={"email": EMAIL, "password": PASSWORD},
            headers={"Authorization": AUTHORIZATION},
        )

    assert response.status_code == 500
    assert len(sentry_events) == 1
    event = sentry_events[0]
    assert event["request"] == {"method": "POST", "url": "/boom/{item}"}
    assert event["transaction"] == "/boom/{item}"
    assert "user" not in event
    assert "extra" not in event
    assert set(event.get("contexts", {})) <= {"runtime", "os", "trace"}
    assert _exception_values(event)[-1]["type"] == "RuntimeError"
    for exc in _exception_values(event):
        for frame in exc.get("stacktrace", {}).get("frames", []):
            assert "vars" not in frame
    for crumb in event.get("breadcrumbs", {}).get("values", []):
        assert "data" not in crumb
    dump = _dump(event)
    for canary in (EMAIL, COOKIE, AUTHORIZATION, PASSWORD, "query-canary", "budget", ITEM):
        assert canary not in dump
    assert any("[email]" in s for s in _strings(event))  # the breadcrumb was kept, redacted


def test_ac3_answered_errors_are_not_sent(
    sentry_events: list[dict[str, Any]], caplog: pytest.LogCaptureFixture
) -> None:
    app = create_app()

    class Body(BaseModel):
        n: int

    @app.get("/e/{status}")
    def http_error(status: int) -> None:
        raise HTTPException(status_code=status, detail="x")

    @app.post("/validate")
    def validate(body: Body) -> None:
        return None

    @app.get("/db-down")
    def db_down() -> None:
        raise OperationalError("SELECT 1", {}, Exception("connection refused"))

    @app.get("/redis-down")
    def redis_down() -> None:
        raise redis.exceptions.ConnectionError("connection refused")

    with (
        caplog.at_level(logging.ERROR),
        TestClient(app, raise_server_exceptions=False) as client,
    ):
        for status in (400, 401, 403, 404, 409, 429, 503):
            assert client.get(f"/e/{status}").status_code == status
        assert client.post("/validate", json={"n": "x"}).status_code == 422
        assert client.get("/db-down").status_code == 503
        assert client.get("/redis-down").status_code == 503
        # A /health ping during an outage (port 1 refuses at once).
        assert health.ping_redis("redis://127.0.0.1:1/0") is False

    # The handlers and the ping did log at ERROR; none of it became an event.
    assert "database unavailable" in caplog.text
    assert "redis unavailable" in caplog.text
    assert "redis ping failed" in caplog.text
    assert sentry_events == []


def test_ac4_feed_token_never_sent(
    db_engine: Engine, sentry_events: list[dict[str, Any]], monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken(db: Any, token: str, now: Any) -> None:
        logging.getLogger("app.test").warning("feed /tour-feed/%s.ics", token)
        raise RuntimeError(f"no calendar for /tour-feed/{token}.ics")

    monkeypatch.setattr(tour_feed_service, "feed_for_token", broken)
    with TestClient(create_app(), raise_server_exceptions=False) as client:
        assert client.get(f"/tour-feed/{TOKEN}.ics").status_code == 500

    assert len(sentry_events) == 1
    event = sentry_events[0]
    assert TOKEN not in _dump(event)
    assert event["transaction"] == "/tour-feed/[redacted]"
    assert event["request"]["url"] == "/tour-feed/[redacted]"
    assert "/tour-feed/[redacted]" in _exception_values(event)[-1]["value"]


def test_ac5_personal_data_redacted_in_messages(
    db_engine: Engine, sentry_events: list[dict[str, Any]]
) -> None:
    app = create_app()

    @app.get("/mail")
    def mail() -> None:
        raise ValueError(f"cannot send to {EMAIL}")

    @app.get("/duplicate")
    def duplicate() -> None:
        with db_engine.begin() as conn:
            conn.execute(text("CREATE TEMP TABLE people (name text, phone text UNIQUE)"))
            insert = text("INSERT INTO people (name, phone) VALUES (:name, :phone)")
            conn.execute(insert, {"name": NAME, "phone": PHONE})
            conn.execute(insert, {"name": NAME, "phone": PHONE})

    logging.getLogger("app.services.email").error("smtp refused %s", EMAIL)
    with TestClient(app, raise_server_exceptions=False) as client:
        assert client.get("/mail").status_code == 500
        assert client.get("/duplicate").status_code == 500

    assert len(sentry_events) == 3
    logged, mailed, integrity = sentry_events
    for event in (logged, mailed):
        assert EMAIL not in _dump(event)
        assert any("[email]" in s for s in _strings(event))
    assert logged["logentry"]["params"] == ["[email]"]
    assert _exception_values(mailed)[-1]["value"] == "cannot send to [email]"
    values = _exception_values(integrity)
    assert {v["type"] for v in values} >= {"IntegrityError", "UniqueViolation"}
    for value in values:
        assert value["value"] == ""
        assert value.get("stacktrace", {}).get("frames")  # type and stack kept
    dump = _dump(integrity)
    assert NAME not in dump
    assert PHONE not in dump


async def purge_canary_job(ctx: dict[str, Any]) -> None:
    raise RuntimeError(f"purge failed for {EMAIL}")


def test_ac6_failing_worker_job_is_reported(sentry_events: list[dict[str, Any]]) -> None:
    init_sentry(get_settings(), worker=True)  # as `app.worker` does at import, before create_worker

    queue = f"test-sentry:{uuid.uuid4().hex}"
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url.get_secret_value())

    async def run() -> None:
        # Built inside the loop (arq's Worker binds the running one), and looked up at call time
        # as arq's CLI does: the integration replaces `arq.worker.create_worker` at init.
        worker = arq.worker.create_worker(
            {"cron_jobs": [cron(purge_canary_job, run_at_startup=True, keep_result=0)]},
            redis_settings=redis_settings,
            queue_name=queue,
            burst=True,
            max_burst_jobs=1,
            poll_delay=0.01,
            handle_signals=False,
        )
        try:
            await worker.main()
        finally:
            await worker.pool.delete(queue)
            await worker.close()

    asyncio.run(run())

    assert len(sentry_events) == 1
    event = sentry_events[0]
    assert event["transaction"] == "cron:purge_canary_job"
    assert _exception_values(event)[-1]["value"] == "purge failed for [email]"
    assert "extra" not in event
    assert EMAIL not in _dump(event)


def test_scrub_event_on_a_hand_built_event() -> None:
    event: dict[str, Any] = {
        "transaction": "/tour-feed/{token}.ics",
        "message": f"hello {EMAIL}",
        "logentry": {"message": "to %s", "params": [EMAIL]},
        "request": {
            "method": "GET",
            "url": f"https://api.example/tour-feed/{TOKEN}.ics?x=1",
            "headers": {"Cookie": "c"},
            "cookies": {"session": "c"},
            "data": {"email": EMAIL},
            "query_string": "x=1",
            "env": {"REMOTE_ADDR": "1.2.3.4"},
        },
        "user": {"id": "u", "ip_address": "1.2.3.4"},
        "extra": {"sys.argv": ["x"]},
        "contexts": {"runtime": {"name": "CPython"}, "os": {}, "trace": {}, "response": {}},
        "breadcrumbs": {
            "values": [
                {
                    "type": "http",
                    "category": "httpx",
                    "level": "info",
                    "timestamp": "t",
                    "message": f"/tour-feed/{TOKEN}.ics",
                    "data": {"url": "https://nominatim.example/search?street=Herzl"},
                }
            ]
        },
        "exception": {
            "values": [
                {"type": "UniqueViolation", "module": "psycopg.errors", "value": PHONE},
                {"type": "ValidationError", "module": "pydantic_core", "value": NAME},
                {"type": "IntegrityError", "module": "sqlalchemy.exc", "value": PHONE},
                {"type": "ValueError", "value": f"bad {EMAIL}", "stacktrace": {"frames": []}},
            ]
        },
    }

    scrubbed = scrub_event(event, {})

    assert scrubbed["request"] == {"method": "GET", "url": "/tour-feed/[redacted]"}
    assert scrubbed["transaction"] == "/tour-feed/[redacted]"
    assert "user" not in scrubbed
    assert "extra" not in scrubbed
    assert set(scrubbed["contexts"]) == {"runtime", "os", "trace"}
    assert scrubbed["breadcrumbs"]["values"] == [
        {
            "type": "http",
            "category": "httpx",
            "level": "info",
            "timestamp": "t",
            "message": "/tour-feed/[redacted]",
        }
    ]
    assert [v["value"] for v in scrubbed["exception"]["values"]] == ["", "", "", "bad [email]"]
    assert scrubbed["message"] == "hello [email]"
    assert scrubbed["logentry"] == {"message": "to %s", "params": ["[email]"]}
    dump = _dump(scrubbed)
    for canary in (EMAIL, TOKEN, PHONE, NAME, "Herzl", "1.2.3.4"):
        assert canary not in dump
