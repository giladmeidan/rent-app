"""GET /health (AC1, AC2)."""

import pytest
from fastapi.testclient import TestClient

from app.routers import health as health_router


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
