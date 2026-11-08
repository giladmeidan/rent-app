"""scripts/export_openapi.py runs without a server, with only `.env.example` set (AC6)."""

import json
import os
import subprocess
import sys

from tests.conftest import REPO_ROOT


def _env_example() -> dict[str, str]:
    env: dict[str, str] = {}
    for line in (REPO_ROOT / ".env.example").read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            key, _, value = line.partition("=")
            env[key] = value
    return env


def test_ac6_openapi_export_without_server() -> None:
    env = _env_example()
    assert {"DATABASE_URL", "TEST_DATABASE_URL", "REDIS_URL", "WEB_ORIGIN"} <= set(env)
    # PATH/HOME are interpreter plumbing, not application configuration.
    env.update({k: os.environ[k] for k in ("PATH", "HOME") if k in os.environ})

    result = subprocess.run(
        [sys.executable, str(REPO_ROOT / "api" / "scripts" / "export_openapi.py")],
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    schema = json.loads(result.stdout)
    assert {"/health", "/areas"} <= set(schema["paths"])
    assert "geom" not in schema["components"]["schemas"]["AreaOut"]["properties"]
