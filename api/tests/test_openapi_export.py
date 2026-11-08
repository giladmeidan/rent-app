"""scripts/export_openapi.py runs without a server, with only `.env.example` set (AC6)."""

import json
import os
import re
import subprocess
import sys

from tests.conftest import REPO_ROOT


def _env_example() -> dict[str, str]:
    """Every variable `.env.example` lists, including the commented-out `# KEY=value` ones (the
    URLs, which the Makefile otherwise derives from the ports)."""
    pairs = re.findall(
        r"^(?:# )?([A-Z_][A-Z0-9_]*)=(\S*)$", (REPO_ROOT / ".env.example").read_text(), re.M
    )
    return dict(pairs)


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
