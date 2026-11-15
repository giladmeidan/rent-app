"""Application settings. Every value comes from the environment (see `.env.example`)."""

from functools import lru_cache
from pathlib import Path
from typing import Literal, NamedTuple, Self
from urllib.parse import unquote, urlsplit

from pydantic import SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# The public dev value from the Makefile, compose and .env.example; refused when serving https.
DEV_SECRET_KEY = "dev-only-secret-change-me-0123456789abcdef"
# The dev User-Agent for Nominatim; refused with `GEOCODER=nominatim` when serving https.
DEV_NOMINATIM_USER_AGENT = "rent-app-dev/0.0.1"


class SmtpTarget(NamedTuple):
    implicit_tls: bool
    host: str
    port: int
    username: str | None
    password: str | None


def parse_smtp_url(url: str) -> SmtpTarget:
    """`smtp://` = STARTTLS (default port 587), `smtps://` = implicit TLS (default port 465),
    optional percent-encoded `user:pass@`. The error never includes any part of the URL."""
    try:
        parts = urlsplit(url)
        port = parts.port
        if parts.scheme not in {"smtp", "smtps"} or not parts.hostname:
            raise ValueError
    except ValueError:
        raise ValueError("SMTP_URL must be smtp[s]://[user:pass@]host[:port]") from None
    implicit_tls = parts.scheme == "smtps"
    return SmtpTarget(
        implicit_tls=implicit_tls,
        host=parts.hostname,
        port=port or (465 if implicit_tls else 587),
        username=unquote(parts.username) if parts.username else None,
        password=unquote(parts.password) if parts.password else None,
    )


class DatabaseSettings(BaseSettings):
    """What database-only tools (Alembic, `scripts/seed.py`) need: just `DATABASE_URL`."""

    # hide_input_in_errors: a ValidationError would otherwise echo every input, DSNs included.
    model_config = SettingsConfigDict(env_file=None, extra="ignore", hide_input_in_errors=True)

    # DSNs carry credentials: SecretStr keeps them out of reprs, logs and tracebacks.
    database_url: SecretStr


class Settings(DatabaseSettings):
    """Runtime configuration of the API and the worker, read once from environment variables."""

    test_database_url: SecretStr | None = None
    redis_url: SecretStr
    web_origin: str = "http://localhost:5173"
    # HMAC key for OTP codes (spec 0001a). Required: there is no safe default in code.
    secret_key: SecretStr
    email_backend: Literal["file", "smtp"] = "file"
    email_outbox_dir: Path = Path("./.outbox")
    smtp_url: SecretStr | None = None
    email_from: str = "noreply@localhost"
    cookie_secure: bool = False
    # Spec 0013b: `fly` reads the client address from `Fly-Client-IP` (only behind Fly's proxy);
    # `none` uses the socket peer (`app/client_ip.py`).
    trust_proxy: Literal["none", "fly"] = "none"
    # Geocoding (spec 0003c), worker only. `fake` = deterministic points, no network (dev, CI, e2e);
    # `nominatim` = NOMINATIM_URL, which wants an identifying User-Agent (never an email in it).
    geocoder: Literal["fake", "nominatim"] = "fake"
    nominatim_url: str = "https://nominatim.openstreetmap.org"
    nominatim_user_agent: str = DEV_NOMINATIM_USER_AGENT
    # Photos (spec 0010d). `file` = `photo_dir` on local disk, served by the api at `/media` (dev,
    # CI, e2e); `r2` = the Cloudflare R2 bucket `r2_bucket`. `photo_public_base_url` is where the
    # objects are read from (`{base}/{key}-s.webp`), never with a trailing `/`.
    photo_backend: Literal["file", "r2"] = "file"
    photo_dir: Path = Path("./.media")
    photo_public_base_url: str = "http://localhost:8000/media"
    r2_account_id: str | None = None
    r2_access_key_id: SecretStr | None = None
    r2_secret_access_key: SecretStr | None = None
    r2_bucket: str | None = None
    # Official rent figures (spec 0014a), worker only. `off` = no request (dev, tests, CI);
    # `nadlan` = the monthly import from `nadlan_rent_url` (https, never with a trailing `/`).
    rent_reference: Literal["off", "nadlan"] = "off"
    nadlan_rent_url: str = "https://data.nadlan.gov.il/api/pages"
    # CBS small-flat rent figures (spec 0014d), worker only. `off` = no request (dev, tests, CI);
    # `cbs` = the monthly import of Table 4.9 from cbs.gov.il.
    cbs_rent: Literal["off", "cbs"] = "off"

    @field_validator("photo_public_base_url")
    @classmethod
    def _photo_base_url_is_a_plain_url(cls, value: str) -> str:
        """Trimmed, an http(s) URL with a host and no query or fragment, without a trailing `/`.
        The message names the rule only, never the value."""
        value = value.strip().rstrip("/")
        try:
            parts = urlsplit(value)
            parts.port  # noqa: B018  (raises ValueError on a malformed port)
        except ValueError:
            raise ValueError("PHOTO_PUBLIC_BASE_URL must be an http(s) URL") from None
        if (
            parts.scheme not in {"http", "https"}
            or not parts.hostname
            or parts.query
            or parts.fragment
            or "?" in value
            or "#" in value
        ):
            raise ValueError(
                "PHOTO_PUBLIC_BASE_URL must be an http(s) URL with a host and no query or fragment"
            )
        return value

    @field_validator("nadlan_rent_url")
    @classmethod
    def _nadlan_url_is_a_plain_https_url(cls, value: str) -> str:
        """Trimmed, an https URL with a host and no credentials, query or fragment, without a
        trailing `/`. The message names the rule only, never the value."""
        rule = (
            "NADLAN_RENT_URL must be an https URL with a host and no credentials, query or fragment"
        )
        value = value.strip().rstrip("/")
        try:
            parts = urlsplit(value)
            parts.port  # noqa: B018  (raises ValueError on a malformed port)
        except ValueError:
            raise ValueError(rule) from None
        if (
            parts.scheme != "https"
            or not parts.hostname
            or parts.username is not None
            or parts.password is not None
            or parts.query
            or parts.fragment
            or "?" in value
            or "#" in value
        ):
            raise ValueError(rule)
        return value

    @field_validator("nominatim_user_agent")
    @classmethod
    def _user_agent_identifies_without_email(cls, value: str) -> str:
        # The messages name the rule only, never the value.
        value = value.strip()
        if not 3 <= len(value) <= 200:
            raise ValueError("NOMINATIM_USER_AGENT must be 3 to 200 characters")
        if "@" in value:
            raise ValueError("NOMINATIM_USER_AGENT must not contain an email address ('@')")
        return value

    @field_validator("secret_key")
    @classmethod
    def _secret_key_is_long_enough(cls, value: SecretStr) -> SecretStr:
        # The message names the rule only, never the value.
        if len(value.get_secret_value()) < 32:
            raise ValueError("SECRET_KEY must be at least 32 characters")
        return value

    @model_validator(mode="after")
    def _email_and_production_rules(self) -> Self:
        if self.smtp_url is not None:
            parse_smtp_url(self.smtp_url.get_secret_value())
        if self.email_backend == "smtp" and self.smtp_url is None:
            raise ValueError("SMTP_URL is required when EMAIL_BACKEND=smtp")
        if self.photo_backend == "r2" and not all(
            value is not None
            and (value.get_secret_value() if isinstance(value, SecretStr) else value).strip()
            for value in (
                self.r2_account_id,
                self.r2_access_key_id,
                self.r2_secret_access_key,
                self.r2_bucket,
            )
        ):
            raise ValueError(
                "R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET are all"
                " required when PHOTO_BACKEND=r2"
            )
        # An https web origin means a real deployment: refuse the dev defaults there.
        if self.web_origin.startswith("https://"):
            if self.secret_key.get_secret_value() == DEV_SECRET_KEY:
                raise ValueError("SECRET_KEY must not be the dev value when WEB_ORIGIN is https")
            if not self.cookie_secure:
                raise ValueError("COOKIE_SECURE must be true when WEB_ORIGIN is https")
            if "email_backend" not in self.model_fields_set:
                raise ValueError("EMAIL_BACKEND must be set explicitly when WEB_ORIGIN is https")
            if "geocoder" not in self.model_fields_set:
                raise ValueError("GEOCODER must be set explicitly when WEB_ORIGIN is https")
            if self.geocoder == "nominatim" and self.nominatim_user_agent.startswith(
                "rent-app-dev"
            ):
                raise ValueError(
                    "NOMINATIM_USER_AGENT must not be the dev value when GEOCODER=nominatim and "
                    "WEB_ORIGIN is https"
                )
            # Local disk is not durable on the deploy target: photos go to R2 there.
            if "photo_backend" not in self.model_fields_set:
                raise ValueError("PHOTO_BACKEND must be set explicitly when WEB_ORIGIN is https")
            if self.photo_backend != "r2":
                raise ValueError("PHOTO_BACKEND must be r2 when WEB_ORIGIN is https")
            base = urlsplit(self.photo_public_base_url)
            if base.scheme != "https" or base.hostname in {"localhost", "127.0.0.1"}:
                raise ValueError(
                    "PHOTO_PUBLIC_BASE_URL must be https and not localhost when WEB_ORIGIN is https"
                )
        return self

    @field_validator("web_origin")
    @classmethod
    def _web_origin_is_one_exact_origin(cls, value: str) -> str:
        """CORS allows exactly this origin: it must be `scheme://host[:port]` and nothing else.
        Returned trimmed with scheme and host lowercased, the form browsers send in `Origin`."""
        parts = urlsplit(value.strip())
        try:
            parts.port  # noqa: B018  (raises ValueError on a malformed port)
        except ValueError as exc:
            raise ValueError(f"WEB_ORIGIN has an invalid port: {value!r}") from exc
        if (
            parts.scheme not in {"http", "https"}
            or not parts.hostname
            or "*" in parts.hostname
            or parts.username is not None
            or parts.path
            or parts.query
            or parts.fragment
        ):
            raise ValueError(
                f"WEB_ORIGIN must be one origin like https://host[:port] (no '*', path or "
                f"trailing slash), got {value!r}"
            )
        return f"{parts.scheme}://{parts.netloc.lower()}"


@lru_cache(maxsize=1)
def get_database_settings() -> DatabaseSettings:
    """Database-only settings (cached after first read); does not require `REDIS_URL`."""
    return DatabaseSettings()


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide settings instance (cached after first read)."""
    return Settings()
