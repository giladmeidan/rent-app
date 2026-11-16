"""The public app never loads the admin dashboard (spec 0012b NF1). Checked in a fresh
interpreter: pytest has already imported `admin` and `sqladmin` while collecting tests. And the
admin role's rights on the tour tables (spec 0018a AC13)."""

import datetime as dt
import os
import subprocess
import sys
import uuid

import pytest
from psycopg.errors import InsufficientPrivilege
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.exc import ProgrammingError

from tests import test_tours as tours_tests
from tests.conftest import API_DIR, make_listing, make_owner, make_seeker

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


def test_ac13_tour_grants(admin_role: str, db_engine: Engine, gush_dan: uuid.UUID) -> None:
    # Spec 0018a AC13: `homie_admin` may UPDATE only `tours`' status, cancelled_by, cancelled_at
    # and updated_at, and may not read `tour_feeds` at all.
    owner, seeker = make_owner(db_engine, "o@example.com"), make_seeker(db_engine, "s@example.com")
    listing = make_listing(db_engine, owner, gush_dan)
    application = tours_tests.shortlisted(db_engine, listing, seeker, owner)
    now = tours_tests.db_now(db_engine)
    tour = tours_tests.make_tour(
        db_engine, listing, application, seeker, now + dt.timedelta(hours=3)
    )
    engine = create_engine(admin_role)
    try:
        for statement in (
            "SELECT * FROM tour_feeds",
            "UPDATE tours SET starts_at = now()",
            "UPDATE tours SET reminder_sent_at = now()",
            "UPDATE tours SET seeker_id = listing_id",
            "INSERT INTO tours (listing_id, application_id, seeker_id, starts_at, ends_at)"
            " SELECT listing_id, application_id, seeker_id, starts_at, ends_at FROM tours",
            "DELETE FROM tours",
            "DELETE FROM tour_windows",
            "UPDATE tour_windows SET slot_minutes = 15",
            "INSERT INTO messages (conversation_id, sender_id, body)"
            " SELECT id, owner_id, 'x' FROM conversations",
        ):
            with engine.connect() as conn, pytest.raises(ProgrammingError) as error:
                conn.execute(text(statement))
            assert isinstance(error.value.orig, InsufficientPrivilege), statement
        with engine.begin() as conn:
            cancelled = conn.execute(
                text(
                    "UPDATE tours SET status = 'cancelled', cancelled_by = 'system',"
                    " cancelled_at = now(), updated_at = now() WHERE id = :id"
                ),
                {"id": tour},
            )
            assert cancelled.rowcount == 1
    finally:
        engine.dispose()
