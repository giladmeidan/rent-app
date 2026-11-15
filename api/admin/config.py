"""Admin settings (spec 0012b). Every value comes from the environment; `main()` refuses to build
the app while a required one is missing, empty or too short."""

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class AdminSettings(BaseSettings):
    # hide_input_in_errors: a ValidationError would otherwise echo the password and the DSN.
    model_config = SettingsConfigDict(
        env_prefix="ADMIN_", env_file=None, extra="ignore", hide_input_in_errors=True
    )

    # As the `homie_admin` role (scripts/admin_role.py), never the migration role.
    database_url: SecretStr = Field(min_length=1)
    password: SecretStr = Field(min_length=16)
    # Signs the session cookie.
    secret_key: SecretStr = Field(min_length=32)
    # Comma-separated; any other Host header (DNS rebinding) answers 400.
    allowed_hosts: str = "localhost,127.0.0.1"
    # Off for localhost http; the Slice 13 deploy sets it.
    https_only: bool = False

    @property
    def hosts(self) -> list[str]:
        return [host.strip() for host in self.allowed_hosts.split(",") if host.strip()]
