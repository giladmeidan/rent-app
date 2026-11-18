"""Gzip on the API (spec 0013a, AC10): `/areas` is compressed, the SSE stream never is."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine

from app.config import get_settings
from app.main import create_app
from app.services import chat_events
from tests.conftest import Outbox, insert_settlement
from tests.test_chat_events import Stream, _publish, _subscribed, _token, _two_users, _user_id


def test_ac10_areas_gzip(client: TestClient, db_engine: Engine) -> None:
    for code in range(40):
        insert_settlement(db_engine, 9000 + code, f"יישוב {code}")
    origin = {"origin": get_settings().web_origin}

    plain = client.get("/areas", headers={**origin, "accept-encoding": "identity"})
    assert plain.status_code == 200
    assert "content-encoding" not in plain.headers
    assert len(plain.content) > 1024

    zipped = client.get("/areas", headers={**origin, "accept-encoding": "gzip"})
    assert zipped.status_code == 200
    assert zipped.headers["content-encoding"] == "gzip"
    assert "accept-encoding" in zipped.headers["vary"].lower()
    assert zipped.json() == plain.json()  # httpx has decompressed it
    assert zipped.headers["cache-control"] == "public, max-age=86400"
    assert zipped.headers["access-control-allow-origin"] == origin["origin"]
    assert zipped.headers["access-control-allow-credentials"] == "true"


@pytest.mark.asyncio
async def test_ac10_stream_not_compressed(client: TestClient, outbox: Outbox) -> None:
    a, b = _two_users(client, outbox)
    a_id = _user_id(a)
    stream = Stream(create_app(), _token(a), extra_headers=((b"accept-encoding", b"gzip"),))
    try:
        await stream.started()
        assert stream.status == 200
        assert stream.headers["content-type"].startswith("text/event-stream")
        assert "content-encoding" not in stream.headers
        await _subscribed(a_id)

        conversation = uuid.uuid4()
        _publish([a_id], conversation)
        await stream.wait(lambda s: len(s.chat_events()) == 1)
        assert stream.chat_events() == [{"conversation_id": str(conversation), "kind": "message"}]
        assert not stream.complete  # delivered while the stream is still open
    finally:
        await stream.disconnect()
        await chat_events.close_hub()
