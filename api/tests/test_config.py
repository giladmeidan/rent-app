"""Settings hardening (review round 1 minors): WEB_ORIGIN validation, secret DSNs, and the
database-only settings used by Alembic and `scripts/seed.py`."""

from typing import Any

import pytest
from pydantic import ValidationError

from app.config import DEV_EMAIL_BLOCK_KEY, DEV_SECRET_KEY, DatabaseSettings, Settings

_DSN = "postgresql+psycopg://rent:s3cret@localhost:5432/rent"
_REDIS = "redis://:r3dis@localhost:6379/0"
# What an https WEB_ORIGIN requires since 0001a (round 1, minor 6); unrelated to the origin rules.
_HTTPS_READY: dict[str, Any] = {
    "secret_key": "p" * 32,
    "email_block_key": "b" * 32,  # spec 0013c
    "cookie_secure": True,
    "email_backend": "file",
    "geocoder": "fake",
    # spec 0010d: photos on R2 (obviously fake values)
    "photo_backend": "r2",
    "photo_public_base_url": "https://photos.rent.example",
    "r2_account_id": "fake-account",
    "r2_access_key_id": "fake-key-id",
    "r2_secret_access_key": "fake-secret",
    "r2_bucket": "fake-bucket",
}
_PHOTO_ENV = {k: v for k, v in _HTTPS_READY.items() if k.startswith(("photo_", "r2_"))}


@pytest.mark.parametrize(
    "origin",
    ["http://localhost:5173", "https://rent.example", "https://app.rent.example:8443"],
)
def test_web_origin_accepts_a_single_origin(origin: str) -> None:
    settings = Settings(database_url=_DSN, redis_url=_REDIS, web_origin=origin, **_HTTPS_READY)

    assert settings.web_origin == origin


def test_web_origin_is_trimmed_and_lowercased() -> None:
    settings = Settings(
        database_url=_DSN,
        redis_url=_REDIS,
        web_origin=" HTTPS://App.Rent.Example:8443\n",
        **_HTTPS_READY,
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
    settings = Settings(
        database_url=_DSN,
        redis_url=_REDIS,
        test_database_url=_DSN,
        sentry_dsn="https://sentrykey@o0.ingest.de.sentry.io/1",
    )

    assert "s3cret" not in repr(settings)
    assert "r3dis" not in repr(settings)
    assert "sentrykey" not in repr(settings)
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
    for bad_url in ("smtp://u:pa/ss@host:587", "http://x"):
        with pytest.raises(ValidationError, match="SMTP_URL must be") as excinfo:
            Settings(
                database_url=_DSN,
                redis_url=_REDIS,
                secret_key=_SECRET,
                email_backend="smtp",
                smtp_url=bad_url,
            )
        assert "pa/ss" not in str(excinfo.value)
        assert "u:pa" not in str(excinfo.value)
        # `from None`: the urllib error (which quotes the bad port, i.e. part of the password)
        # is not chained into the traceback.
        assert excinfo.value.errors()[0]["ctx"]["error"].__cause__ is None
        assert excinfo.value.errors()[0]["ctx"]["error"].__suppress_context__ is True

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


def test_https_web_origin_refuses_dev_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in (
        "EMAIL_BACKEND",
        "COOKIE_SECURE",
        "SECRET_KEY",
        "SMTP_URL",
        "GEOCODER",
        "NOMINATIM_URL",
        "NOMINATIM_USER_AGENT",
    ):
        monkeypatch.delenv(name, raising=False)
    https: dict[str, Any] = {
        "database_url": _DSN,
        "redis_url": _REDIS,
        "web_origin": "https://rent.example",
    }

    with pytest.raises(ValidationError, match="SECRET_KEY must not be the dev value") as excinfo:
        Settings(**https, secret_key=DEV_SECRET_KEY, cookie_secure=True, email_backend="file")
    assert DEV_SECRET_KEY not in str(excinfo.value)
    with pytest.raises(ValidationError, match="COOKIE_SECURE must be true"):
        Settings(**https, secret_key=_SECRET, email_backend="file")
    with pytest.raises(ValidationError, match="EMAIL_BACKEND must be set explicitly"):
        Settings(**https, secret_key=_SECRET, cookie_secure=True)

    monkeypatch.setenv("EMAIL_BACKEND", "file")  # from the environment counts as explicit
    monkeypatch.setenv("GEOCODER", "fake")
    assert Settings(
        **https, **_PHOTO_ENV, secret_key=_SECRET, email_block_key="b" * 32, cookie_secure=True
    ).cookie_secure
    # Plain http (local dev) keeps the dev defaults working.
    assert Settings(database_url=_DSN, redis_url=_REDIS, secret_key=DEV_SECRET_KEY).secret_key


def test_ac12_geocoder_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("GEOCODER", "NOMINATIM_URL", "NOMINATIM_USER_AGENT"):
        monkeypatch.delenv(name, raising=False)
    required: dict[str, Any] = {"database_url": _DSN, "redis_url": _REDIS, "secret_key": _SECRET}

    settings = Settings(**required)
    assert settings.geocoder == "fake"
    assert settings.nominatim_user_agent == "rent-app-dev/0.0.1"
    assert settings.nominatim_url == "https://nominatim.openstreetmap.org"

    for bad_agent in ("rent-app (ops@example.com)", ""):
        with pytest.raises(ValidationError, match="NOMINATIM_USER_AGENT") as excinfo:
            Settings(**required, nominatim_user_agent=bad_agent)
        if bad_agent:
            assert bad_agent not in str(excinfo.value)
            assert "ops@example.com" not in str(excinfo.value)

    https: dict[str, Any] = {
        "database_url": _DSN,
        "redis_url": _REDIS,
        "web_origin": "https://rent.example",
    }
    without_geocoder = {k: v for k, v in _HTTPS_READY.items() if k != "geocoder"}
    with pytest.raises(ValidationError, match="GEOCODER must be set explicitly"):
        Settings(**https, **without_geocoder)
    with pytest.raises(ValidationError, match="NOMINATIM_USER_AGENT must not be the dev value"):
        Settings(**https, **without_geocoder, geocoder="nominatim")
    production = Settings(
        **https,
        **without_geocoder,
        geocoder="nominatim",
        nominatim_user_agent="rent-app/1.0 (+https://rent.example)",
    )
    assert production.geocoder == "nominatim"
    assert production.nominatim_user_agent == "rent-app/1.0 (+https://rent.example)"


def test_ac13_photo_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in (
        "PHOTO_BACKEND",
        "PHOTO_DIR",
        "PHOTO_PUBLIC_BASE_URL",
        "R2_ACCOUNT_ID",
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
        "R2_BUCKET",
    ):
        monkeypatch.delenv(name, raising=False)
    required: dict[str, Any] = {"database_url": _DSN, "redis_url": _REDIS, "secret_key": _SECRET}

    dev = Settings(**required)
    assert (dev.photo_backend, str(dev.photo_dir)) == ("file", ".media")
    assert dev.photo_public_base_url == "http://localhost:8000/media"
    trimmed = Settings(**required, photo_public_base_url=" https://photos.rent.example/media/ ")
    assert trimmed.photo_public_base_url == "https://photos.rent.example/media"
    for bad_url in ("ftp://photos.example", "https://", "https://p.example/?a=1", "x/#f"):
        with pytest.raises(ValidationError, match="PHOTO_PUBLIC_BASE_URL") as excinfo:
            Settings(**required, photo_public_base_url=bad_url)
        assert "p.example" not in str(excinfo.value)

    # r2 needs every R2_* value, non-empty (an empty commented `# R2_BUCKET=` counts as unset).
    r2 = {k: v for k, v in _PHOTO_ENV.items() if k.startswith("r2_")}
    assert Settings(**required, photo_backend="r2", **r2).r2_bucket == "fake-bucket"
    for missing in r2:
        for value in (None, "", "  "):
            with pytest.raises(ValidationError, match="R2_BUCKET are all required") as excinfo:
                Settings(**required, photo_backend="r2", **{**r2, missing: value})
            for secret in r2.values():
                assert secret not in str(excinfo.value)
    configured = Settings(**required, photo_backend="r2", **r2)
    assert "fake-secret" not in repr(configured)
    assert "fake-key-id" not in repr(configured)

    # An https web origin: PHOTO_BACKEND explicit, r2, and an https, non-local base URL.
    https: dict[str, Any] = {
        "database_url": _DSN,
        "redis_url": _REDIS,
        "web_origin": "https://rent.example",
        **{k: v for k, v in _HTTPS_READY.items() if k not in _PHOTO_ENV},
    }
    with pytest.raises(ValidationError, match="PHOTO_BACKEND must be set explicitly"):
        Settings(**https)
    with pytest.raises(ValidationError, match="PHOTO_BACKEND must be r2"):
        Settings(**https, photo_backend="file")
    for base_url in (
        "http://photos.rent.example",
        "https://localhost/media",
        "https://127.0.0.1:8000/media",
    ):
        with pytest.raises(ValidationError, match="PHOTO_PUBLIC_BASE_URL must be https") as excinfo:
            Settings(**https, **{**_PHOTO_ENV, "photo_public_base_url": base_url})
        assert base_url not in str(excinfo.value)
        assert "fake-secret" not in str(excinfo.value)
    monkeypatch.setenv("PHOTO_BACKEND", "r2")  # from the environment counts as explicit
    production = Settings(**https, **{k: v for k, v in _PHOTO_ENV.items() if k != "photo_backend"})
    assert production.photo_backend == "r2"
    assert production.photo_public_base_url == "https://photos.rent.example"


def test_ac13_rent_reference_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("RENT_REFERENCE", "NADLAN_RENT_URL"):
        monkeypatch.delenv(name, raising=False)
    required: dict[str, Any] = {"database_url": _DSN, "redis_url": _REDIS, "secret_key": _SECRET}

    settings = Settings(**required)
    assert settings.rent_reference == "off"
    assert settings.nadlan_rent_url == "https://data.nadlan.gov.il/api/pages"
    assert Settings(**required, rent_reference="nadlan").rent_reference == "nadlan"
    trimmed = Settings(**required, nadlan_rent_url=" https://rent.example/api/pages/ ")
    assert trimmed.nadlan_rent_url == "https://rent.example/api/pages"
    for bad_url in (
        "http://rent.example/api/pages",
        "https://rent.example/api/pages?a=1",
        "https://rent.example/api/pages#f",
        "https://",
        "ftp://rent.example",
        "https://u:secret@rent.example/api/pages",
    ):
        with pytest.raises(
            ValidationError, match="NADLAN_RENT_URL must be an https URL"
        ) as excinfo:
            Settings(**required, nadlan_rent_url=bad_url)
        assert "rent.example" not in str(excinfo.value)
        assert "secret" not in str(excinfo.value)
    with pytest.raises(ValidationError, match="rent_reference"):
        Settings(**required, rent_reference="on")


def test_ac1_trust_proxy_setting(monkeypatch: pytest.MonkeyPatch) -> None:
    """Spec 0013b: `TRUST_PROXY` defaults to `none` and accepts only `none` or `fly`."""
    monkeypatch.delenv("TRUST_PROXY", raising=False)
    assert Settings(database_url=_DSN, redis_url=_REDIS, secret_key=_SECRET).trust_proxy == "none"

    monkeypatch.setenv("TRUST_PROXY", "fly")
    assert Settings(database_url=_DSN, redis_url=_REDIS, secret_key=_SECRET).trust_proxy == "fly"

    monkeypatch.setenv("TRUST_PROXY", "evil")
    with pytest.raises(ValidationError):
        Settings(database_url=_DSN, redis_url=_REDIS, secret_key=_SECRET)


def test_ac9_email_block_key_rules(monkeypatch: pytest.MonkeyPatch) -> None:
    """Spec 0013c AC9: EMAIL_BLOCK_KEY is required, at least 32 characters, and never the dev
    value on https (the last https check); no error echoes the value."""
    monkeypatch.delenv("EMAIL_BLOCK_KEY", raising=False)
    required: dict[str, Any] = {"database_url": _DSN, "redis_url": _REDIS, "secret_key": _SECRET}

    with pytest.raises(ValidationError, match="email_block_key"):
        Settings(**required)
    with pytest.raises(ValidationError, match="EMAIL_BLOCK_KEY must be at least 32") as excinfo:
        Settings(**required, email_block_key="short-block-canary")
    assert "short-block-canary" not in str(excinfo.value)
    # Plain http (local dev) accepts the dev value.
    assert Settings(**required, email_block_key=DEV_EMAIL_BLOCK_KEY).email_block_key

    https: dict[str, Any] = {
        "database_url": _DSN,
        "redis_url": _REDIS,
        "web_origin": "https://rent.example",
        **_HTTPS_READY,
    }
    with pytest.raises(ValidationError, match="EMAIL_BLOCK_KEY must not be the dev value") as exc:
        Settings(**{**https, "email_block_key": DEV_EMAIL_BLOCK_KEY})
    assert DEV_EMAIL_BLOCK_KEY not in str(exc.value)
    configured = Settings(**https)
    assert "b" * 32 not in repr(configured)


def test_ac10_google_verifier_guard() -> None:
    """Spec 0016b AC10: `google` needs GOOGLE_CLIENT_ID everywhere; `fake` is refused on https;
    the default `off` needs nothing."""
    http: dict[str, Any] = {
        "database_url": _DSN,
        "redis_url": _REDIS,
        "secret_key": _SECRET,
        "email_block_key": "b" * 32,
    }
    https: dict[str, Any] = {
        "database_url": _DSN,
        "redis_url": _REDIS,
        "web_origin": "https://rent.example",
        **_HTTPS_READY,
    }
    for base in (http, https):
        for client_id in ("", "   "):
            with pytest.raises(ValidationError, match="GOOGLE_CLIENT_ID is required"):
                Settings(**base, google_verifier="google", google_client_id=client_id)
    with pytest.raises(ValidationError, match="GOOGLE_VERIFIER must not be fake"):
        Settings(**https, google_verifier="fake")

    assert Settings(**http, google_verifier="fake").google_verifier == "fake"
    assert Settings(**https).google_verifier == "off"
    configured = Settings(**https, google_verifier="google", google_client_id=" id.example ")
    assert (configured.google_verifier, configured.google_client_id) == ("google", "id.example")


def test_0019a_sentry_settings() -> None:
    settings = Settings(database_url=_DSN, redis_url=_REDIS)
    assert settings.sentry_dsn is None
    assert settings.sentry_environment == "development"
    assert settings.sentry_release is None
    assert settings.sentry_traces_sample_rate == 0.0
    assert (
        Settings(
            database_url=_DSN, redis_url=_REDIS, sentry_traces_sample_rate=1
        ).sentry_traces_sample_rate
        == 1
    )
    for rate in (-0.1, 1.1):
        with pytest.raises(ValidationError, match="sentry_traces_sample_rate"):
            Settings(database_url=_DSN, redis_url=_REDIS, sentry_traces_sample_rate=rate)
