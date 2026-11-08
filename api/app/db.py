"""Synchronous SQLAlchemy 2.0 engine and session dependency."""

from collections.abc import Iterator
from functools import lru_cache
from typing import Any

from sqlalchemy import Engine, NullPool, create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_database_settings

# Bound how long a connection attempt waits for an unreachable Postgres (libpq's minimum is 2 s);
# without it a blackholed host hangs for the OS TCP timeout (~75 s) or longer. On Linux,
# `tcp_user_timeout` (ms) also drops a pooled connection whose writes go unacknowledged; libpq
# ignores it on other platforms.
CONNECT_TIMEOUT_S = 2
_CONNECT_ARGS = {"connect_timeout": CONNECT_TIMEOUT_S, "tcp_user_timeout": 5000}


def make_engine(database_url: str, **kwargs: Any) -> Engine:
    """Engine for a `postgresql+psycopg://` URL with the app connection settings (lazy connect).
    `hide_parameters` keeps bound values (user data) out of exception messages and logs."""
    return create_engine(
        database_url,
        pool_pre_ping=True,
        hide_parameters=True,
        connect_args=_CONNECT_ARGS,
        **kwargs,
    )


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    """Process-wide engine for `DATABASE_URL`."""
    return make_engine(get_database_settings().database_url.get_secret_value())


@lru_cache(maxsize=1)
def get_ping_engine() -> Engine:
    """Unpooled engine for `/health`: every ping opens a fresh connection, so an unreachable or hung
    server is reported within `CONNECT_TIMEOUT_S` instead of blocking on a pooled socket."""
    url = get_database_settings().database_url.get_secret_value()
    return make_engine(url, poolclass=NullPool)


@lru_cache(maxsize=1)
def get_sessionmaker() -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(), expire_on_commit=False)


def get_session() -> Iterator[Session]:
    """FastAPI dependency: one session per request, closed afterwards."""
    with get_sessionmaker()() as session:
        yield session
