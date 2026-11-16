"""Create or update the `homie_admin` Postgres role and apply its rights (spec 0012b): the one
statement of what the admin dashboard may do. Idempotent: it revokes everything, then grants, in
one transaction, so a re-run converges.

Run it as the role that runs `alembic upgrade` (DATABASE_URL): default privileges cover only the
tables that role creates. The role is cluster-wide, so the dev and test databases share its
password (`ADMIN_DB_PASSWORD`).

Usage: `python api/scripts/admin_role.py` (reads DATABASE_URL and ADMIN_DB_PASSWORD).
"""

import os
import sys

import psycopg
from psycopg import sql
from sqlalchemy.engine import make_url

ROLE = "homie_admin"

# Column-level writes only: suspend / un-suspend / cap, ending sessions, hide / un-hide, resolve,
# logging in and out (`admin_logins`: INSERT below, then only `ended_at`), cancelling the tours a
# hide or a suspension ends (spec 0018a).
_COLUMN_GRANTS = (
    ("users", ("suspended_at", "listing_cap")),
    ("sessions", ("revoked_at",)),
    ("listings", ("status", "removed_at")),
    ("reports", ("resolved_at",)),
    ("admin_logins", ("ended_at",)),
    ("tours", ("status", "cancelled_by", "cancelled_at", "updated_at")),
)
# Tables it may not even read: password hashes (spec 0016a), calendar-feed token hashes (0018a).
_NO_ACCESS = ("user_passwords", "tour_feeds")


def apply_admin_role(database_url: str, password: str) -> None:
    """`database_url` is a SQLAlchemy `postgresql+psycopg://` URL of the migration role."""
    dsn = make_url(database_url).set(drivername="postgresql").render_as_string(hide_password=False)
    role = sql.Identifier(ROLE)
    with psycopg.connect(dsn) as conn:  # one transaction, committed on exit
        exists = conn.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (ROLE,)).fetchone()
        conn.execute(
            sql.SQL(
                "{} ROLE {} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS"
                " PASSWORD {}"
            ).format(sql.SQL("ALTER" if exists else "CREATE"), role, sql.Literal(password))
        )
        groups = conn.execute(
            "SELECT g.rolname FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid"
            " JOIN pg_roles u ON u.oid = m.member WHERE u.rolname = %s",
            (ROLE,),
        ).fetchall()
        for (group,) in groups:
            conn.execute(sql.SQL("REVOKE {} FROM {}").format(sql.Identifier(group), role))
        database = sql.Identifier(conn.info.dbname)
        for statement in (
            "REVOKE ALL ON DATABASE {db} FROM {role}",
            "REVOKE ALL ON SCHEMA public FROM {role}",
            "REVOKE ALL ON ALL TABLES IN SCHEMA public FROM {role}",
            "REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM {role}",
            "ALTER DEFAULT PRIVILEGES FOR ROLE current_user IN SCHEMA public"
            " REVOKE ALL ON TABLES FROM {role}",
            "GRANT CONNECT ON DATABASE {db} TO {role}",
            "GRANT USAGE ON SCHEMA public TO {role}",
            "GRANT SELECT ON ALL TABLES IN SCHEMA public TO {role}",
            "ALTER DEFAULT PRIVILEGES FOR ROLE current_user IN SCHEMA public"
            " GRANT SELECT ON TABLES TO {role}",
            "GRANT INSERT ON admin_actions TO {role}",
            "GRANT INSERT ON admin_logins TO {role}",
        ):
            conn.execute(sql.SQL(statement).format(db=database, role=role))
        for table in _NO_ACCESS:
            conn.execute(sql.SQL("REVOKE ALL ON {} FROM {}").format(sql.Identifier(table), role))
        for table, columns in _COLUMN_GRANTS:
            conn.execute(
                sql.SQL("GRANT UPDATE ({}) ON {} TO {}").format(
                    sql.SQL(", ").join(map(sql.Identifier, columns)), sql.Identifier(table), role
                )
            )


def main() -> None:
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from app.config import get_database_settings

    password = os.environ.get("ADMIN_DB_PASSWORD", "")
    if not password:
        sys.exit("ADMIN_DB_PASSWORD must be set (see .env.example / Makefile)")
    apply_admin_role(get_database_settings().database_url.get_secret_value(), password)
    print(f"admin_role: {ROLE} applied")


if __name__ == "__main__":
    main()
