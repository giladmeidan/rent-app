"""Application settings. Every value comes from the environment (see `.env.example`)."""

from functools import lru_cache
from urllib.parse import urlsplit

from pydantic import SecretStr, field_validator
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

    @field_validator("web_origin")
    @classmethod
    def _web_origin_is_one_exact_origin(cls, value: str) -> str:
        """CORS allows exactly this origin: it must be `scheme://host[:port]` and nothing else."""
        parts = urlsplit(value)
        try:
            parts.port  # noqa: B018  (raises ValueError on a malformed port)
        except ValueError as exc:
            raise ValueError(f"WEB_ORIGIN has an invalid port: {value!r}") from exc
        if (
            parts.scheme not in {"http", "https"}
            or not parts.hostname
            or parts.username is not None
            or parts.path
            or parts.query
            or parts.fragment
        ):
            raise ValueError(
                f"WEB_ORIGIN must be one origin like https://host[:port] (no '*', path or "
                f"trailing slash), got {value!r}"
            )
        return value


@lru_cache(maxsize=1)
def get_database_settings() -> DatabaseSettings:
    """Database-only settings (cached after first read); does not require `REDIS_URL`."""
    return DatabaseSettings()


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide settings instance (cached after first read)."""
    return Settings()
