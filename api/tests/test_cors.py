"""CORS exposes `Retry-After` to the web origin (spec 0009f): AC4."""

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from tests.conftest import Outbox

pytestmark = pytest.mark.usefixtures("redis_clean")

EMAIL = "cors@example.com"


def _post_until_limited(client: TestClient, origin: str) -> httpx.Response:
    for _ in range(30):
        response: httpx.Response = client.post(
            "/auth/otp/request", json={"email": EMAIL}, headers={"Origin": origin}
        )
        if response.status_code == 429:
            return response
        assert response.status_code == 204
    raise AssertionError("the OTP request never hit its rate limit")


def test_ac4_retry_after_is_exposed_to_the_web_origin(client: TestClient, outbox: Outbox) -> None:
    web_origin = get_settings().web_origin

    limited = _post_until_limited(client, web_origin)
    evil = client.post(
        "/auth/otp/request", json={"email": EMAIL}, headers={"Origin": "http://evil.example"}
    )

    assert limited.status_code == 429
    assert int(limited.headers["retry-after"]) >= 1
    assert limited.headers["access-control-allow-origin"] == web_origin
    exposed = [
        h.strip().lower() for h in limited.headers["access-control-expose-headers"].split(",")
    ]
    assert "retry-after" in exposed

    assert evil.status_code == 429
    assert "retry-after" in evil.headers
    assert "access-control-allow-origin" not in evil.headers
