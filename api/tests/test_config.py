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


def test_web_origin_is_trimmed_and_lowercased() -> None:
    settings = Settings(
        database_url=_DSN, redis_url=_REDIS, web_origin=" HTTPS://App.Rent.Example:8443\n"
    )

    assert settings.web_origin == "https://app.rent.example:8443"


@pytest.mark.parametrize(
    "origin",
    [
        "*",
        "http://*",
        "https://*.rent.example",
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


def test_validation_errors_do_not_echo_dsns(monkeypatch: pytest.MonkeyPatch) -> None:
    # Only this short input, so pydantic would print it untruncated in `input_value=`.
    for name in ("REDIS_URL", "TEST_DATABASE_URL", "WEB_ORIGIN"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:pw-canary@db/x")

    with pytest.raises(ValidationError) as excinfo:
        Settings()

    assert "redis_url" in str(excinfo.value)
    assert "pw-canary" not in str(excinfo.value)


_SECRET = "s" * 32


def test_ac12_secret_key_and_smtp_url_required(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SECRET_KEY", raising=False)
    monkeypatch.delenv("SMTP_URL", raising=False)
    monkeypatch.delenv("EMAIL_BACKEND", raising=False)

    with pytest.raises(ValidationError, match="secret_key"):
        Settings(database_url=_DSN, redis_url=_REDIS)

    with pytest.raises(ValidationError, match="at least 32 characters") as excinfo:
        Settings(database_url=_DSN, redis_url=_REDIS, secret_key="short-key-canary")
    assert "short-key-canary" not in str(excinfo.value)

    with pytest.raises(ValidationError, match="SMTP_URL is required"):
        Settings(database_url=_DSN, redis_url=_REDIS, secret_key=_SECRET, email_backend="smtp")
    smtp = Settings(
        database_url=_DSN,
        redis_url=_REDIS,
        secret_key=_SECRET,
        email_backend="smtp",
        smtp_url="smtp://u:smtp-canary@mail.example.com",
    )
    assert "smtp-canary" not in repr(smtp)
    assert _SECRET not in repr(smtp)

    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.setenv("DATABASE_URL", _DSN)
    assert DatabaseSettings().database_url.get_secret_value() == _DSN


def test_ac12_settings_defaults_for_auth(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("EMAIL_BACKEND", "EMAIL_OUTBOX_DIR", "EMAIL_FROM", "COOKIE_SECURE", "SMTP_URL"):
        monkeypatch.delenv(name, raising=False)

    settings = Settings(database_url=_DSN, redis_url=_REDIS, secret_key=_SECRET)

    assert settings.email_backend == "file"
    assert str(settings.email_outbox_dir) == ".outbox"
    assert settings.email_from == "noreply@localhost"
    assert settings.cookie_secure is False
    assert settings.smtp_url is None
