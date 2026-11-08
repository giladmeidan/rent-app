"""Settings hardening (review round 1 minors): WEB_ORIGIN validation, secret DSNs, and the
database-only settings used by Alembic and `scripts/seed.py`."""

import pytest
from pydantic import ValidationError

from app.config import DatabaseSettings, Settings

_DSN = "postgresql+psycopg://rent:s3cret@localhost:5432/rent"
_REDIS = "redis://:r3dis@localhost:6379/0"


@pytest.mark.parametrize(
    "origin",
    ["http://localhost:5173", "https://rent.example", "https://app.rent.example:8443"],
)
def test_web_origin_accepts_a_single_origin(origin: str) -> None:
    settings = Settings(database_url=_DSN, redis_url=_REDIS, web_origin=origin)

    assert settings.web_origin == origin


@pytest.mark.parametrize(
    "origin",
    [
        "*",
        "localhost:5173",
        "ftp://localhost",
        "http://localhost:5173/",
        "http://localhost:5173/app",
        "http://localhost:99999",
        "http://user@localhost:5173",
        "http://localhost:5173?x=1",
        "",
    ],
)
def test_web_origin_rejects_anything_but_one_origin(origin: str) -> None:
    with pytest.raises(ValidationError, match="WEB_ORIGIN"):
        Settings(database_url=_DSN, redis_url=_REDIS, web_origin=origin)


def test_dsns_never_appear_in_repr() -> None:
    settings = Settings(database_url=_DSN, redis_url=_REDIS, test_database_url=_DSN)

    assert "s3cret" not in repr(settings)
    assert "r3dis" not in repr(settings)
    assert settings.database_url.get_secret_value() == _DSN


def test_database_settings_do_not_require_redis_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.setenv("DATABASE_URL", _DSN)

    assert DatabaseSettings().database_url.get_secret_value() == _DSN
    with pytest.raises(ValidationError, match="redis_url"):
        Settings()
