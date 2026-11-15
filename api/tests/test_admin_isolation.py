"""The public app never loads the admin dashboard (spec 0012b NF1). Checked in a fresh
interpreter: pytest has already imported `admin` and `sqladmin` while collecting tests."""

import os
import subprocess
import sys

from tests.conftest import API_DIR

_CHECK = """
import sys
from fastapi.testclient import TestClient
from app.main import create_app
app = create_app()
with TestClient(app) as client:
    client.get("/health")
loaded = [m for m in sys.modules if m.split(".")[0] in ("admin", "sqladmin")]
paths = [p for p in (getattr(r, "path", "") for r in app.routes) if p.startswith("/admin")]
print(loaded, paths)
assert not loaded and not paths
"""


def test_nf1_public_app_has_no_admin() -> None:
    result = subprocess.run(
        [sys.executable, "-c", _CHECK], cwd=API_DIR, env=dict(os.environ), capture_output=True
    )
    assert result.returncode == 0, result.stdout + result.stderr
