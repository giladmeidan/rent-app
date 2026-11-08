"""Shared fixtures.

Integration tests run against Postgres at `TEST_DATABASE_URL` (locally the compose `db`, in CI the
service container) and Redis at `REDIS_URL`. The app under test is pointed at the test database by
overriding `DATABASE_URL` before any app module is imported, so no dependency overrides are needed.
"""

import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import make_url

API_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = API_DIR.parent


def _required_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} must be set (see .env.example / Makefile)")
    return value


TEST_DATABASE_URL: str = _required_env("TEST_DATABASE_URL")
_required_env("REDIS_URL")

os.environ["DATABASE_URL"] = TEST_DATABASE_URL

from fastapi.testclient import TestClient  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.db import get_engine, get_ping_engine, get_sessionmaker  # noqa: E402
from app.main import create_app  # noqa: E402

get_settings.cache_clear()
get_engine.cache_clear()
get_ping_engine.cache_clear()
get_sessionmaker.cache_clear()


def alembic_config(database_url: str) -> Config:
    cfg = Config(str(API_DIR / "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
    return cfg


def _admin_engine(database_url: str) -> Engine:
    """Engine on the `postgres` maintenance database of the same server, in AUTOCOMMIT mode."""
    admin_url = make_url(database_url).set(database="postgres")
    return create_engine(admin_url, isolation_level="AUTOCOMMIT")


def ensure_database(database_url: str) -> None:
    name = make_url(database_url).database
    admin = _admin_engine(database_url)
    try:
        with admin.connect() as conn:
            exists = conn.execute(
                text("SELECT 1 FROM pg_database WHERE datname = :n"), {"n": name}
            ).scalar()
            if not exists:
                conn.execute(text(f'CREATE DATABASE "{name}"'))
    finally:
        admin.dispose()


def drop_database(database_url: str) -> None:
    name = make_url(database_url).database
    admin = _admin_engine(database_url)
    try:
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
    finally:
        admin.dispose()


@pytest.fixture(scope="session")
def migrated_db() -> Iterator[Engine]:
    """Test database created if missing and migrated to head once per session."""
    ensure_database(TEST_DATABASE_URL)
    command.upgrade(alembic_config(TEST_DATABASE_URL), "head")
    engine = get_engine()
    yield engine
    engine.dispose()


@pytest.fixture
def db_engine(migrated_db: Engine) -> Iterator[Engine]:
    """Per-test engine on a clean `areas` table."""
    with migrated_db.begin() as conn:
        conn.execute(text("TRUNCATE TABLE areas"))
    yield migrated_db


@pytest.fixture
def client(db_engine: Engine) -> Iterator[TestClient]:
    with TestClient(create_app()) as test_client:
        yield test_client
