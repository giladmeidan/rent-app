"""Dependency pings used by `GET /health`. Each returns True when the dependency answers."""

import logging

import redis
from sqlalchemy import Engine, text

log = logging.getLogger(__name__)

PING_TIMEOUT_S = 1.0


def ping_db(engine: Engine) -> bool:
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception:  # noqa: BLE001  (any failure means "error" for the health report)
        log.exception("database ping failed")
        return False
    return True


def ping_redis(url: str) -> bool:
    client = redis.Redis.from_url(
        url, socket_connect_timeout=PING_TIMEOUT_S, socket_timeout=PING_TIMEOUT_S
    )
    try:
        return bool(client.ping())
    except Exception:  # noqa: BLE001
        log.exception("redis ping failed")
        return False
    finally:
        client.close()
