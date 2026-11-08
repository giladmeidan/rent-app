"""The Makefile's `.env` loader (infra/dotenv.awk) parses values the way compose does."""

import os
import shutil
import subprocess
from pathlib import Path

from tests.conftest import REPO_ROOT

_KEYS = ("DB_PORT", "WEB_ORIGIN", "REDIS_PORT", "API_PORT", "DATABASE_URL")


def _make_show(tmp_path: Path, dotenv: bytes) -> subprocess.CompletedProcess[str]:
    """Run the real Makefile's top level against `dotenv` and print the loaded variables."""
    (tmp_path / "infra").mkdir()
    shutil.copy(REPO_ROOT / "Makefile", tmp_path / "Makefile")
    shutil.copy(REPO_ROOT / "infra" / "dotenv.awk", tmp_path / "infra" / "dotenv.awk")
    (tmp_path / ".env").write_bytes(dotenv)
    show = " ".join(f"{key}=[$({key})]" for key in _KEYS)
    (tmp_path / "show.mk").write_text(f"include Makefile\nshow:\n\t@echo '{show}'\n")
    env = {k: v for k, v in os.environ.items() if k not in _KEYS and not k.startswith("MAKE")}
    return subprocess.run(
        ["make", "-s", "-f", "show.mk", "show"],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
        check=True,
    )


def test_dotenv_strips_quotes_and_crlf_like_compose(tmp_path: Path) -> None:
    dotenv = b"# comment\r\n\r\nDB_PORT=5434\r\nWEB_ORIGIN=\"http://localhost:3000\"\r\nREDIS_PORT='6380'\r\n"

    result = _make_show(tmp_path, dotenv)

    assert "DB_PORT=[5434]" in result.stdout
    assert "WEB_ORIGIN=[http://localhost:3000]" in result.stdout
    assert "REDIS_PORT=[6380]" in result.stdout
    assert "DATABASE_URL=[postgresql+psycopg://rent:rent@localhost:5434/rent]" in result.stdout
    assert result.stderr == ""


def test_dotenv_warns_about_lines_it_cannot_parse(tmp_path: Path) -> None:
    dotenv = b'DB_PORT=5434\nWEB_ORIGIN="a b"\nexport API_PORT=9000\n'

    result = _make_show(tmp_path, dotenv)

    assert "DB_PORT=[5434]" in result.stdout
    assert "WEB_ORIGIN=[http://localhost:5173]" in result.stdout  # the default, not "a b"
    assert "API_PORT=[8000]" in result.stdout
    assert ".env line 2 ignored" in result.stderr
    assert ".env line 3 ignored" in result.stderr
