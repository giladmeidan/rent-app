"""Application settings. Every value comes from the environment (see `.env.example`)."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration, read once from environment variables."""

    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    database_url: str
    test_database_url: str | None = None
    redis_url: str
    web_origin: str = "http://localhost:5173"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide settings instance (cached after first read)."""
    return Settings()
