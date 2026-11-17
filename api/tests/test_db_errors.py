"""Database errors never carry bound parameters (user data) into messages or logs."""

import logging
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.db import get_session, make_engine
from app.main import create_app

_CANARY = "param-canary"


def _cancelled_query(engine: Engine) -> None:
    """A query with a bound parameter that Postgres cancels (SQLSTATE 57014: OperationalError)."""
    with engine.connect() as conn:
        conn.execute(text("SET LOCAL statement_timeout = 1"))
        conn.execute(text("SELECT pg_sleep(1), :p"), {"p": _CANARY})


def test_operational_error_message_hides_bound_parameters(db_engine: Engine) -> None:
    with pytest.raises(OperationalError) as excinfo:
        _cancelled_query(db_engine)

    assert _CANARY not in str(excinfo.value)


def test_503_handler_logs_error_type_not_statement(
    db_engine: Engine, caplog: pytest.LogCaptureFixture
) -> None:
    app = create_app()
    app.add_api_route("/boom", lambda: _cancelled_query(db_engine))

    with caplog.at_level(logging.ERROR, logger="app.main"), TestClient(app) as client:
        response = client.get("/boom")

    assert response.status_code == 503
    assert "QueryCanceled (sqlstate 57014)" in caplog.text
    assert _CANARY not in caplog.text
    assert "pg_sleep" not in caplog.text


def test_0018d_ac12_503_log_redacts_feed_token(caplog: pytest.LogCaptureFixture) -> None:
    # Port 1 on loopback refuses the connection immediately (as test_areas.py's 503 test).
    engine = make_engine("postgresql+psycopg://rent:rent@127.0.0.1:1/rent")

    def unreachable_session() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    app = create_app()
    app.dependency_overrides[get_session] = unreachable_session
    token = "T" * 43
    with caplog.at_level(logging.ERROR, logger="app.main"), TestClient(app) as client:
        response = client.get(f"/tour-feed/{token}.ics")
    engine.dispose()

    assert response.status_code == 503
    assert "/tour-feed/[redacted]" in caplog.text
    assert token not in caplog.text
