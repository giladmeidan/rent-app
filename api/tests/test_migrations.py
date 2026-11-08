"""Alembic round trip on a dedicated `_mig` database (AC4), so `downgrade base` never touches
the tables the other integration tests use."""

from collections.abc import Iterator

import pytest
from alembic import command
from sqlalchemy import create_engine, inspect
from sqlalchemy.engine import make_url

from tests.conftest import TEST_DATABASE_URL, alembic_config, drop_database, ensure_database


@pytest.fixture
def migration_db_url() -> Iterator[str]:
    url = make_url(TEST_DATABASE_URL)
    mig_url = url.set(database=f"{url.database}_mig").render_as_string(hide_password=False)
    drop_database(mig_url)
    ensure_database(mig_url)
    yield mig_url
    drop_database(mig_url)


def _table_names(url: str) -> set[str]:
    engine = create_engine(url)
    try:
        return set(inspect(engine).get_table_names())
    finally:
        engine.dispose()


def test_ac4_migration_roundtrip(migration_db_url: str) -> None:
    cfg = alembic_config(migration_db_url)

    command.upgrade(cfg, "head")
    assert "areas" in _table_names(migration_db_url)

    command.downgrade(cfg, "base")
    assert "areas" not in _table_names(migration_db_url)

    command.upgrade(cfg, "head")
    assert "areas" in _table_names(migration_db_url)
