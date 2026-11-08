"""Application settings. Every value comes from the environment (see `.env.example`)."""

from functools import lru_cache
from pathlib import Path
from typing import Literal, Self
from urllib.parse import urlsplit

from pydantic import SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


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

    @field_validator("secret_key")
    @classmethod
    def _secret_key_is_long_enough(cls, value: SecretStr) -> SecretStr:
        # The message names the rule only, never the value.
        if len(value.get_secret_value()) < 32:
            raise ValueError("SECRET_KEY must be at least 32 characters")
        return value

    @model_validator(mode="after")
    def _smtp_url_required_for_smtp_backend(self) -> Self:
        if self.email_backend == "smtp" and self.smtp_url is None:
            raise ValueError("SMTP_URL is required when EMAIL_BACKEND=smtp")
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
