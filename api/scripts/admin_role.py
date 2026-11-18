"""Create or update the `homie_admin` Postgres role and apply its rights (spec 0012b): the one
statement of what the admin dashboard may do. Idempotent: it revokes everything, then grants, in
one transaction, so a re-run converges. Before committing it checks the role's effective rights,
inherited ones included (spec 0013a).

Run it as the role that runs `alembic upgrade` (DATABASE_URL): default privileges cover only the
tables that role creates. The role is cluster-wide, so the dev and test databases share its
password (`ADMIN_DB_PASSWORD`).

Usage: `python api/scripts/admin_role.py` (reads DATABASE_URL and ADMIN_DB_PASSWORD).
  --existing-role  Fly Managed Postgres: the role already exists (`fly mpg users create`) and may
                   inherit read access to everything. Reads DATABASE_URL only.
  --verify         From the admin machine: check the admin's own session, changing nothing. Reads
                   ADMIN_DATABASE_URL only.
"""

import os
import sys

import psycopg
from psycopg import sql
from psycopg.rows import TupleRow
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
# The only tables it may add rows to: its audit log and its logins.
_INSERT_GRANTS = ("admin_actions", "admin_logins")
# Tables it may not even read: password hashes (spec 0016a), calendar-feed token hashes (0018a).
_NO_ACCESS = ("user_passwords", "tour_feeds")

# (statement, new role only). The new-role-only ones would run as a system role on Fly Managed
# Postgres and may be refused, so `--existing-role` skips them; the runbook re-runs the script after
# migrations instead of using default privileges.
_STATEMENTS = (
    ("REVOKE ALL ON DATABASE {db} FROM {role}", True),
    ("REVOKE ALL ON SCHEMA public FROM {role}", False),
    ("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM {role}", False),
    ("REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM {role}", False),
    (
        "ALTER DEFAULT PRIVILEGES FOR ROLE current_user IN SCHEMA public"
        " REVOKE ALL ON TABLES FROM {role}",
        True,
    ),
    ("GRANT CONNECT ON DATABASE {db} TO {role}", True),
    ("GRANT USAGE ON SCHEMA public TO {role}", False),
    ("GRANT SELECT ON ALL TABLES IN SCHEMA public TO {role}", False),
    (
        "ALTER DEFAULT PRIVILEGES FOR ROLE current_user IN SCHEMA public"
        " GRANT SELECT ON TABLES TO {role}",
        True,
    ),
)

# Every role it belongs to, itself included. MEMBER, not SET: a membership with only ADMIN OPTION
# passes a SET check, yet lets the role grant itself SET.
_REACHABLE_ROLES = """
    SELECT r.rolname, r.rolsuper, r.rolbypassrls FROM pg_roles r
    WHERE pg_has_role(%(role)s::name, r.oid, 'MEMBER')
"""
_RELATIONS = """
    SELECT c.oid, c.relname, c.relrowsecurity,
           EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid),
           has_table_privilege(%(role)s::name, c.oid, 'SELECT')
             OR has_any_column_privilege(%(role)s::name, c.oid, 'SELECT'),
           has_table_privilege(
             %(role)s::name, c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
           ) OR has_any_column_privilege(%(role)s::name, c.oid, 'INSERT, UPDATE, REFERENCES'),
           has_table_privilege(%(role)s::name, c.oid, 'INSERT'),
           has_table_privilege(%(role)s::name, c.oid, 'UPDATE, DELETE, TRUNCATE')
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
"""
_UPDATABLE_COLUMNS = """
    SELECT a.attname FROM pg_attribute a
    WHERE a.attrelid = %(oid)s AND a.attnum > 0 AND NOT a.attisdropped
      AND has_column_privilege(%(role)s::name, a.attrelid, a.attnum, 'UPDATE')
"""
_CAN_CREATE_IN_PUBLIC = "SELECT has_schema_privilege(%(role)s::name, 'public', 'CREATE')"
_UPDATABLE_SEQUENCES = """
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      -- CASE: Postgres may run a WHERE function first, and this one fails on a non-sequence.
      AND CASE WHEN c.relkind = 'S' THEN has_sequence_privilege(%(role)s::name, c.oid, 'UPDATE') END
"""


class AdminRightsError(Exception):
    """The role holds a right outside the intended set. Names the table or column."""


def _dsn(database_url: str) -> str:
    """libpq form of a SQLAlchemy `postgresql+psycopg://` URL."""
    url = make_url(database_url).set(drivername="postgresql")
    return url.render_as_string(hide_password=False)


def _assert_role_rights(conn: psycopg.Connection[TupleRow], role: str, existing: bool) -> None:
    params = {"role": role}
    row = conn.execute(_CAN_CREATE_IN_PUBLIC, params).fetchone()
    if row is None or row[0]:
        raise AdminRightsError(f"{role} can create objects in schema public")
    for (sequence,) in conn.execute(_UPDATABLE_SEQUENCES, params).fetchall():
        raise AdminRightsError(f"{role} can update sequence {sequence}")
    columns = {table: set(names) for table, names in _COLUMN_GRANTS}
    for oid, table, rls, has_policy, reads, writes, inserts, changes in conn.execute(
        _RELATIONS, params
    ).fetchall():
        if table in _NO_ACCESS:
            hidden = existing and rls and not has_policy
            if writes or (reads and not hidden):
                raise AdminRightsError(f"{role} can access {table}")
            continue
        if changes or (inserts and table not in _INSERT_GRANTS):
            raise AdminRightsError(f"{role} can write to {table}")
        for (column,) in conn.execute(_UPDATABLE_COLUMNS, {"oid": oid, "role": role}).fetchall():
            if column not in columns.get(table, ()):
                raise AdminRightsError(f"{role} can update {table}.{column}")


def _assert_rights(conn: psycopg.Connection[TupleRow], role: str, existing: bool) -> None:
    """Raise unless `role` and every role it belongs to hold only the intended rights, inherited
    ones included: `SET ROLE` reaches what inheritance does not. Only with `existing` (a Fly role
    whose group cannot be removed), a SELECT on a hash table is tolerated while row-level security
    leaves it zero rows: on, no policy, and no reachable role that bypasses it."""
    for name, superuser, bypasses_rls in conn.execute(_REACHABLE_ROLES, {"role": role}).fetchall():
        if superuser:
            raise AdminRightsError(f"{role} can act as {name}, a superuser")
        if bypasses_rls:
            raise AdminRightsError(
                f"{role} can act as {name}, which bypasses row-level security on"
                f" {', '.join(_NO_ACCESS)}"
            )
        _assert_role_rights(conn, name, existing)


def apply_admin_role(
    database_url: str, password: str | None = None, existing_role: bool = False
) -> None:
    """`database_url` is a SQLAlchemy `postgresql+psycopg://` URL of the migration role. With
    `existing_role` the role is left as it is (no password needed) and the two hash tables get
    row-level security with no policy: their owner, the app, is unaffected, anyone else sees no
    rows."""
    if password is None and not existing_role:
        raise ValueError("a password is required unless existing_role is set")
    role = sql.Identifier(ROLE)
    with psycopg.connect(_dsn(database_url)) as conn:  # one transaction, committed on exit
        exists = conn.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (ROLE,)).fetchone()
        if existing_role:
            if not exists:
                sys.exit(f"{ROLE} does not exist: create it with `fly mpg users create` (Reader)")
            # ENABLE ROW LEVEL SECURITY must not queue logins behind it on a re-run.
            conn.execute("SET LOCAL lock_timeout = '5s'")
        else:
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
        for statement, new_role_only in _STATEMENTS:
            if not (existing_role and new_role_only):
                conn.execute(sql.SQL(statement).format(db=database, role=role))
        for table in _INSERT_GRANTS:
            conn.execute(sql.SQL("GRANT INSERT ON {} TO {}").format(sql.Identifier(table), role))
        for table in _NO_ACCESS:
            conn.execute(sql.SQL("REVOKE ALL ON {} FROM {}").format(sql.Identifier(table), role))
            if existing_role:
                conn.execute(
                    sql.SQL("ALTER TABLE {} ENABLE ROW LEVEL SECURITY").format(
                        sql.Identifier(table)
                    )
                )
        for table, columns in _COLUMN_GRANTS:
            conn.execute(
                sql.SQL("GRANT UPDATE ({}) ON {} TO {}").format(
                    sql.SQL(", ").join(map(sql.Identifier, columns)), sql.Identifier(table), role
                )
            )
        _assert_rights(conn, ROLE, existing_role)


def check_session(conn: psycopg.Connection[TupleRow]) -> None:
    """Raise unless this session runs as the admin role with only its rights."""
    row = conn.execute("SELECT current_user").fetchone()
    current = str(row[0]) if row else ""
    if current != ROLE:
        raise AdminRightsError(f"the session runs as {current}, not {ROLE}")
    _assert_rights(conn, current, existing=True)


def verify_admin_session(admin_database_url: str) -> None:
    """Connect the way the admin app does (`-c role=none`) and check that session, read-only."""
    with psycopg.connect(_dsn(admin_database_url), options="-c role=none") as conn:
        conn.read_only = True
        check_session(conn)


def main() -> None:
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from app.config import get_database_settings

    flags = sys.argv[1:]
    if flags not in ([], ["--existing-role"], ["--verify"]):
        sys.exit("usage: admin_role.py [--existing-role | --verify]")
    try:
        if flags == ["--verify"]:
            url = os.environ.get("ADMIN_DATABASE_URL", "")
            if not url:
                sys.exit("ADMIN_DATABASE_URL must be set")
            verify_admin_session(url)
            print(f"admin_role: {ROLE} verified")
            return
        database_url = get_database_settings().database_url.get_secret_value()
        if flags == ["--existing-role"]:
            apply_admin_role(database_url, existing_role=True)
        else:
            password = os.environ.get("ADMIN_DB_PASSWORD", "")
            if not password:
                sys.exit("ADMIN_DB_PASSWORD must be set (see .env.example / Makefile)")
            apply_admin_role(database_url, password)
    except AdminRightsError as error:
        sys.exit(f"admin_role: {error}")
    print(f"admin_role: {ROLE} applied")


if __name__ == "__main__":
    main()
