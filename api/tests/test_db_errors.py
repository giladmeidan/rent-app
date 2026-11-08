"""Database errors never carry bound parameters (user data) into messages or logs."""

import logging

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text
from sqlalchemy.exc import OperationalError

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
