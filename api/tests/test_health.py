"""GET /health (AC1, AC2)."""

import socket
import time
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.db import CONNECT_TIMEOUT_S, make_engine
from app.routers import health as health_router
from app.services.health import ping_redis


def test_ac1_health_ok_when_dependencies_up(client: TestClient) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "db": "ok", "redis": "ok"}


def test_ac2_health_degraded_when_redis_down(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(health_router, "ping_redis", lambda _url: False)

    response = client.get("/health")

    assert response.status_code == 503
    assert response.json() == {"status": "degraded", "db": "ok", "redis": "error"}


def test_ac2_ping_redis_is_false_when_nothing_listens() -> None:
    assert ping_redis("redis://127.0.0.1:1/0") is False


def test_ac2_health_degraded_when_db_down(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(health_router, "ping_db", lambda _engine: False)

    response = client.get("/health")

    assert response.status_code == 503
    assert response.json() == {"status": "degraded", "db": "error", "redis": "ok"}


@pytest.fixture
def blackholed_db_url() -> Iterator[str]:
    """A TCP port that completes the handshake but never answers, like a blackholed Postgres."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen(16)  # never accept(): the kernel queues the connection, nobody replies
        port = listener.getsockname()[1]
        yield f"postgresql+psycopg://rent:rent@127.0.0.1:{port}/rent"


def test_ac2_health_db_error_is_bounded_when_db_blackholed(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, blackholed_db_url: str
) -> None:
    engine = make_engine(blackholed_db_url)
    monkeypatch.setattr(health_router, "get_ping_engine", lambda: engine)

    started = time.monotonic()
    response = client.get("/health")
    elapsed = time.monotonic() - started
    engine.dispose()

    assert response.status_code == 503
    assert response.json() == {"status": "degraded", "db": "error", "redis": "ok"}
    assert elapsed < CONNECT_TIMEOUT_S + 1.5
