"""`GET /rent-estimate` (spec 0014c): auth, validation and the answer's shape."""

import pytest
from fastapi.testclient import TestClient

from tests.conftest import Outbox, signup

pytestmark = pytest.mark.usefixtures("redis_clean")

VALID = {"city": "תל אביב", "street": "תירוש", "rooms": "4"}


def test_ac8_auth_and_validation(client: TestClient, outbox: Outbox) -> None:
    assert client.get("/rent-estimate", params=VALID).status_code == 401

    owner = signup(client, outbox, "o@example.com", "owner")
    for params in (
        {**VALID, "rooms": "0.3"},
        {"street": "תירוש", "rooms": "4"},
        {**VALID, "listing_id": "x"},  # unknown parameter
    ):
        response = owner.get("/rent-estimate", params=params)
        assert response.status_code == 422, params
        assert "0.3" not in response.text  # not echoed

    response = owner.get("/rent-estimate", params=VALID)
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"estimate", "reason"}
    assert (body["estimate"] is None) != (body["reason"] is None)
