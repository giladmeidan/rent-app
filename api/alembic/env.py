"""Alembic environment: uses the app's metadata and `DATABASE_URL` from the environment."""

from logging.config import fileConfig

from alembic import context

from app.db import make_engine
from app.models import Base

config = context.config
if config.config_file_name is not None:
    # Keep app loggers (e.g. `app.main`) enabled when migrations run in-process, as in the tests.
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def _database_url() -> str:
    url = config.get_main_option("sqlalchemy.url")
    if url:
        return url
    from app.config import get_database_settings

    return get_database_settings().database_url.get_secret_value()


def _include_object(obj: object, name: str | None, type_: str, *_: object) -> bool:
    # PostGIS owns `spatial_ref_sys` (in `public`); never let autogenerate try to drop it.
    return not (type_ == "table" and name == "spatial_ref_sys")


def run_migrations_offline() -> None:
    context.configure(
        url=_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_object=_include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    # The postgis image sets the database `search_path` to `"$user", public, topology, tiger`, which
    # makes the topology and tiger geocoder tables look like they live in the default schema. App
    # tables live in `public` only, so migrations (and autogenerate's reflection) use exactly that.
    engine = make_engine(_database_url(), connect_args={"options": "-c search_path=public"})
    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            include_object=_include_object,
        )
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
