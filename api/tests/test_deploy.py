"""The production deploy (spec 0013a): the Fly configs, the release step, the admin role on Fly
Managed Postgres, the `deploy-*` guard and the runbook. AC6 is `make check-images` in CI."""

import os
import re
import shlex
import shutil
import subprocess
import sys
import tomllib
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import httpx
import psycopg
import pytest
from sqlalchemy import Engine, create_engine, text

from admin.main import create_admin_app
from app.config import Settings, parse_smtp_url
from app.services import passwords, rent_reference
from app.services.rent_reference import NadlanFetcher
from scripts import import_areas as import_areas_script
from scripts.admin_role import (
    ROLE,
    AdminRightsError,
    _dsn,
    apply_admin_role,
    check_session,
    verify_admin_session,
)
from tests.conftest import API_DIR, REPO_ROOT, TEST_DATABASE_URL, make_owner
from tests.test_admin import SAME_ORIGIN, _check_role, _client, _login_admin, _settings

# Obviously fake, and no `user:pass@` URL: this repo is public and GitGuardian watches it.
FAKE_FLY_SECRETS = {
    "DATABASE_URL": "postgresql+psycopg://fake-db.invalid/homie",
    "REDIS_URL": "redis://fake-redis.invalid:6379/0",
    "SECRET_KEY": "x" * 32,
    "EMAIL_BLOCK_KEY": "y" * 32,
    "SMTP_URL": "smtp://fake-smtp.invalid:587",
    "EMAIL_FROM": "noreply@homie.example",
    "WEB_ORIGIN": "https://homie.example",
    "PHOTO_PUBLIC_BASE_URL": "https://media.homie.example",
    "NOMINATIM_USER_AGENT": "homie/1.0 (+https://homie.example)",
    "R2_ACCOUNT_ID": "fake-account",
    "R2_ACCESS_KEY_ID": "fake-key-id",
    "R2_SECRET_ACCESS_KEY": "fake-value",
    "R2_BUCKET": "fake-bucket",
    "CONTACT_EMAIL": "contact@homie.example",
}
OPTIONAL_FLY_VALUES = (
    "GOOGLE_VERIFIER",
    "GOOGLE_CLIENT_ID",
    "SENTRY_DSN",
    "POSTHOG_KEY",
    "POSTHOG_PERSONAL_API_KEY",
    "POSTHOG_PROJECT_ID",
)
OTHER_APP_SECRETS = ("REDIS_PASSWORD", "ADMIN_DATABASE_URL", "ADMIN_PASSWORD", "ADMIN_SECRET_KEY")
PROBE = "homie_probe_0013a"


def _fly(name: str) -> dict[str, Any]:
    return tomllib.loads((REPO_ROOT / "infra" / "fly" / f"{name}.toml").read_text())


def test_ac1_fly_configs() -> None:
    api, redis, admin = _fly("api"), _fly("redis"), _fly("admin")
    assert [config["app"] for config in (api, redis, admin)] == [
        "homie-api",
        "homie-redis",
        "homie-admin",
    ]
    for config in (api, redis, admin):
        assert config["primary_region"] == "fra"

    assert api["processes"] == {
        "app": "uvicorn app.main:app --host 0.0.0.0 --port 8000 --timeout-graceful-shutdown 5",
        "worker": "arq app.worker.WorkerSettings",
    }
    assert api["kill_timeout"] == 10
    assert api["deploy"]["release_command"] == "/opt/venv/bin/alembic upgrade head"
    assert "seed" not in api["deploy"]["release_command"]
    service = api["http_service"]
    assert service["processes"] == ["app"]
    assert service["internal_port"] == 8000
    assert service["force_https"] is True
    assert service["auto_stop_machines"] == "off"
    assert service["min_machines_running"] == 1
    assert service["concurrency"] == {"type": "connections", "soft_limit": 400, "hard_limit": 500}
    [check] = service["checks"]
    assert (check["method"], check["path"]) == ("GET", "/health")
    assert (check["interval"], check["timeout"], check["grace_period"]) == ("15s", "5s", "30s")
    assert {(vm["processes"][0], vm["memory"]) for vm in api["vm"]} == {
        ("app", "1gb"),
        ("worker", "512mb"),
    }

    for private in (redis, admin):
        assert "http_service" not in private
        assert "services" not in private
    assert redis["mounts"] == {"source": "redis_data", "destination": "/data"}
    assert redis["checks"]["redis"]["port"] == 6379
    assert redis["vm"][0]["memory"] == "256mb"
    assert "checks" not in admin
    assert admin["env"] == {
        "ADMIN_HTTPS_ONLY": "true",
        "ADMIN_ALLOWED_HOSTS": "localhost,127.0.0.1",
    }
    assert admin["vm"][0]["memory"] == "512mb"

    secrets = {*FAKE_FLY_SECRETS, *OTHER_APP_SECRETS}
    for config in (api, redis, admin):
        assert not secrets & set(config.get("env", {}))


def test_ac2_api_env_is_a_production_profile(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in (*Settings.model_fields, "contact_email"):
        monkeypatch.delenv(name.upper(), raising=False)
    for name, value in {
        **_fly("api")["env"],
        **FAKE_FLY_SECRETS,
        "FLY_APP_NAME": "homie-api",
    }.items():
        monkeypatch.setenv(name, value)

    settings = Settings()

    assert settings.rent_reference == "off"
    assert settings.cbs_rent == "off"
    assert settings.email_backend == "smtp"
    assert settings.geocoder == "nominatim"
    assert settings.photo_backend == "r2"
    assert settings.trust_proxy == "fly"
    assert settings.sentry_environment == "production"
    assert settings.google_verifier == "off"
    assert settings.cookie_secure is True


def _release(database_url: str) -> subprocess.CompletedProcess[str]:
    command = shlex.split(_fly("api")["deploy"]["release_command"])
    assert command[0] == "/opt/venv/bin/alembic"
    return subprocess.run(
        [str(Path(sys.executable).with_name("alembic")), *command[1:]],
        cwd=API_DIR,
        env={**os.environ, "DATABASE_URL": database_url},
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )


def test_ac4_release_command_only_migrates(migrated_db: Engine) -> None:
    for _ in range(2):
        result = _release(TEST_DATABASE_URL)
        assert result.returncode == 0, result.stderr
    current = subprocess.run(
        [str(Path(sys.executable).with_name("alembic")), "current"],
        cwd=API_DIR,
        env={**os.environ, "DATABASE_URL": TEST_DATABASE_URL},
        capture_output=True,
        text=True,
        timeout=30,
        check=True,
    )
    assert "(head)" in current.stdout

    assert _release("postgresql+psycopg://rent@localhost:1/rent").returncode != 0
    assert not (API_DIR / "scripts" / "release.sh").exists()


# --- AC5: the admin role on Fly Managed Postgres --------------------------------------------------


def _password() -> str:
    return os.environ.get("ADMIN_DB_PASSWORD") or "dev-only-admin-db-password"


def _run(engine: Engine, *statements: str) -> None:
    with engine.begin() as conn:
        for statement in statements:
            conn.execute(text(statement))


def _rls(engine: Engine, table: str) -> bool:
    with engine.connect() as conn:
        query = text("SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass(:t)")
        return bool(conn.execute(query, {"t": table}).scalar_one())


def _is_member(engine: Engine) -> bool:
    with engine.connect() as conn:
        return bool(
            conn.execute(
                text(
                    "SELECT 1 FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid"
                    " JOIN pg_roles u ON u.oid = m.member"
                    " WHERE g.rolname = :group AND u.rolname = :role"
                ),
                {"group": PROBE, "role": ROLE},
            ).first()
        )


def _reader_sees(admin_role: str, table: str) -> int:
    engine = create_engine(admin_role)
    try:
        with engine.connect() as conn:
            return int(conn.execute(text(f"SELECT count(*) FROM {table}")).scalar_one())
    finally:
        engine.dispose()


def _disable_rls(engine: Engine) -> None:
    _run(
        engine,
        "ALTER TABLE user_passwords DISABLE ROW LEVEL SECURITY",
        "ALTER TABLE tour_feeds DISABLE ROW LEVEL SECURITY",
    )


@pytest.fixture
def probe(admin_role: str, db_engine: Engine) -> Iterator[Engine]:
    """A group role to inherit from; everything a test does to the cluster-wide role is undone."""
    _run(db_engine, f"CREATE ROLE {PROBE} NOLOGIN")
    try:
        yield db_engine
    finally:
        _run(
            db_engine,
            f"ALTER ROLE {ROLE} RESET role",
            f"ALTER ROLE {ROLE} NOBYPASSRLS",
            "DROP POLICY IF EXISTS probe ON user_passwords",
            "DROP SEQUENCE IF EXISTS probe_sequence",
            "REVOKE ALL ON user_passwords FROM PUBLIC",
            f"REVOKE {PROBE} FROM {ROLE}",
            f"DROP OWNED BY {PROBE}",
            f"DROP ROLE {PROBE}",
        )
        _disable_rls(db_engine)
        apply_admin_role(TEST_DATABASE_URL, _password())


def test_ac5_admin_role_existing_role(admin_role: str, probe: Engine) -> None:
    owner = make_owner(probe, "owner@example.com")

    apply_admin_role(TEST_DATABASE_URL, None, existing_role=True)
    apply_admin_role(TEST_DATABASE_URL, None, existing_role=True)

    _check_role(admin_role, owner)  # 0012b's rights, and the password still logs in
    assert _rls(probe, "user_passwords") and _rls(probe, "tour_feeds")
    with probe.connect() as conn:
        policies = conn.execute(
            text(
                "SELECT count(*) FROM pg_policy"
                " WHERE polrelid IN ('user_passwords'::regclass, 'tour_feeds'::regclass)"
            )
        ).scalar_one()
    assert policies == 0


def test_ac5_admin_role_existing_role_refuses_an_inherited_write(probe: Engine) -> None:
    _run(probe, f"GRANT {PROBE} TO {ROLE}")
    for grant, named in (
        ("INSERT ON reports", "reports"),
        ("UPDATE (email) ON users", "users.email"),
        ("UPDATE ON users", "users"),
    ):
        _run(probe, f"GRANT {grant} TO {PROBE}")
        with pytest.raises(AdminRightsError, match=named):
            apply_admin_role(TEST_DATABASE_URL, None, existing_role=True)
        assert _is_member(probe)
        assert not _rls(probe, "user_passwords")  # rolled back: the call had turned it on
        _run(probe, f"REVOKE {grant} FROM {PROBE}")

    _run(probe, f"GRANT UPDATE ON users TO {PROBE}")
    apply_admin_role(TEST_DATABASE_URL, _password())  # the normal mode revokes the group
    assert not _is_member(probe)


def test_ac5_admin_role_existing_role_hides_inherited_hash_reads(
    admin_role: str, probe: Engine
) -> None:
    owner = make_owner(probe, "owner@example.com")
    _run(probe, f"GRANT SELECT ON user_passwords TO {PROBE}", f"GRANT {PROBE} TO {ROLE}")
    with probe.begin() as conn:
        conn.execute(
            text("INSERT INTO user_passwords (user_id, hash) VALUES (:u, :h)"),
            {"u": owner, "h": passwords.hash_password("a long test password")},
        )

    apply_admin_role(TEST_DATABASE_URL, None, existing_role=True)
    assert _rls(probe, "user_passwords") and _rls(probe, "tour_feeds")
    assert _reader_sees(admin_role, "user_passwords") == 0  # the grant works, RLS leaves no rows

    _disable_rls(probe)
    _run(probe, "CREATE POLICY probe ON user_passwords USING (true)")
    with pytest.raises(AdminRightsError, match="user_passwords"):
        apply_admin_role(TEST_DATABASE_URL, None, existing_role=True)
    assert not _rls(probe, "user_passwords")

    _run(probe, "DROP POLICY probe ON user_passwords", f"ALTER ROLE {ROLE} BYPASSRLS")
    with pytest.raises(AdminRightsError, match="user_passwords"):
        apply_admin_role(TEST_DATABASE_URL, None, existing_role=True)
    assert not _rls(probe, "user_passwords")
    _run(probe, f"ALTER ROLE {ROLE} NOBYPASSRLS", f"GRANT INSERT ON user_passwords TO {PROBE}")

    with pytest.raises(AdminRightsError, match="user_passwords"):  # a write is never tolerated
        apply_admin_role(TEST_DATABASE_URL, None, existing_role=True)

    # The normal mode tolerates nothing: it revokes the group, and refuses what it cannot revoke.
    apply_admin_role(TEST_DATABASE_URL, _password())
    assert not _is_member(probe)
    _run(probe, "GRANT SELECT ON user_passwords TO PUBLIC")
    with pytest.raises(AdminRightsError, match="user_passwords"):
        apply_admin_role(TEST_DATABASE_URL, _password())


def test_ac5_admin_role_existing_role_verify_needs_role_none(
    admin_role: str, probe: Engine
) -> None:
    _run(probe, f"GRANT {PROBE} TO {ROLE}", f"ALTER ROLE {ROLE} SET role = {PROBE}")
    apply_admin_role(TEST_DATABASE_URL, None, existing_role=True)

    with psycopg.connect(_dsn(admin_role)) as plain:
        row = plain.execute("SELECT current_user").fetchone()
        assert row == (PROBE,)
        with pytest.raises(AdminRightsError, match=PROBE):
            check_session(plain)
    with psycopg.connect(_dsn(admin_role), options="-c role=none") as session:
        assert session.execute("SELECT current_user").fetchone() == (ROLE,)

    verify = subprocess.run(
        [sys.executable, str(API_DIR / "scripts" / "admin_role.py"), "--verify"],
        env={**os.environ, "ADMIN_DATABASE_URL": admin_role},
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert verify.returncode == 0, verify.stderr

    # The dashboard's own engine: a login inserts into `admin_logins`, which only homie_admin may.
    with _client(create_admin_app(_settings(admin_role)), headers=SAME_ORIGIN) as admin:
        assert _login_admin(admin).status_code == 302


def test_ac5_admin_role_existing_role_refuses_a_reachable_bypassrls_role(
    admin_role: str, probe: Engine
) -> None:
    _run(
        probe,
        f"ALTER ROLE {PROBE} BYPASSRLS",
        f"GRANT pg_read_all_data TO {PROBE}",
        f"GRANT {PROBE} TO {ROLE}",
        f"ALTER ROLE {ROLE} SET role = {PROBE}",
    )

    with pytest.raises(AdminRightsError, match="user_passwords"):
        apply_admin_role(TEST_DATABASE_URL, None, existing_role=True)
    assert not _rls(probe, "user_passwords")

    # With row-level security really on, as in production, `--verify` still refuses the group.
    _run(
        probe,
        "ALTER TABLE user_passwords ENABLE ROW LEVEL SECURITY",
        "ALTER TABLE tour_feeds ENABLE ROW LEVEL SECURITY",
    )
    with pytest.raises(AdminRightsError, match=PROBE):
        verify_admin_session(admin_role)


@pytest.mark.parametrize(
    ("setup", "named"),
    [
        (  # no inherited right, but `SET ROLE` gets it
            (f"GRANT UPDATE ON users TO {PROBE}", f"GRANT {PROBE} TO {ROLE} WITH INHERIT FALSE"),
            "users",
        ),
        (
            (f"ALTER ROLE {PROBE} SUPERUSER", f"GRANT {PROBE} TO {ROLE} WITH INHERIT FALSE"),
            "superuser",
        ),
        (  # no SET and no INHERIT, but ADMIN lets the role grant itself both
            (
                f"GRANT UPDATE ON users TO {PROBE}",
                f"GRANT {PROBE} TO {ROLE} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE",
            ),
            "users",
        ),
        ((f"GRANT CREATE ON SCHEMA public TO {PROBE}", f"GRANT {PROBE} TO {ROLE}"), "public"),
        (
            (
                "CREATE SEQUENCE probe_sequence",
                f"GRANT UPDATE ON SEQUENCE probe_sequence TO {PROBE}",
                f"GRANT {PROBE} TO {ROLE}",
            ),
            "probe_sequence",
        ),
    ],
    ids=["set-role-write", "superuser-group", "admin-option", "schema-create", "sequence-update"],
)
def test_ac5_admin_role_existing_role_refuses_what_it_can_reach(
    probe: Engine, setup: tuple[str, ...], named: str
) -> None:
    _run(probe, *setup)

    with pytest.raises(AdminRightsError, match=named):
        apply_admin_role(TEST_DATABASE_URL, None, existing_role=True)
    assert not _rls(probe, "user_passwords")


def test_ac5_admin_role_existing_role_accepts_a_plain_reader(
    admin_role: str, probe: Engine
) -> None:
    owner = make_owner(probe, "owner@example.com")
    with probe.begin() as conn:
        conn.execute(
            text("INSERT INTO user_passwords (user_id, hash) VALUES (:u, :h)"),
            {"u": owner, "h": passwords.hash_password("a long test password")},
        )
    _run(
        probe,
        f"GRANT pg_read_all_data TO {PROBE}",
        f"GRANT {PROBE} TO {ROLE}",
        f"ALTER ROLE {ROLE} SET role = {PROBE}",
    )

    apply_admin_role(TEST_DATABASE_URL, None, existing_role=True)

    verify_admin_session(admin_role)
    assert _reader_sees(admin_role, "user_passwords") == 0


def test_ac5_admin_role_existing_role_needs_the_role(
    migrated_db: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("scripts.admin_role.ROLE", "homie_no_such_role")
    with pytest.raises(SystemExit, match="fly mpg users create"):
        apply_admin_role(TEST_DATABASE_URL, None, existing_role=True)


# --- AC8: the deploy guard ------------------------------------------------------------------------


class DeployRepo:
    """A clean clone-like repo at `origin/main`, a PATH built from symlinks, and a fake `fly`."""

    def __init__(self, root: Path) -> None:
        self.repo = root / "repo"
        self.marker = root / "fly-calls"
        self.marker.touch()
        tools = root / "bin"
        tools.mkdir()
        for tool in ("git", "make", "sh", "awk", "env"):
            found = shutil.which(tool)
            assert found is not None
            (tools / tool).symlink_to(found)
        fake = root / "fake"
        fake.mkdir()
        (fake / "fly").write_text(f'#!/bin/sh\nprintf \'%s\\n\' "$*" >> "{self.marker}"\n')
        (fake / "fly").chmod(0o755)
        # Built, never inherited: a developer's real flyctl often sits next to git and make.
        self.no_fly_path = str(tools)
        self.path = f"{fake}{os.pathsep}{tools}"
        self.env = {
            "HOME": str(root),
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_AUTHOR_NAME": "test",
            "GIT_AUTHOR_EMAIL": "test@example.com",
            "GIT_COMMITTER_NAME": "test",
            "GIT_COMMITTER_EMAIL": "test@example.com",
        }
        origin = root / "origin.git"
        (self.repo / "infra").mkdir(parents=True)
        shutil.copy(REPO_ROOT / "Makefile", self.repo / "Makefile")
        shutil.copy(REPO_ROOT / "infra" / "dotenv.awk", self.repo / "infra" / "dotenv.awk")
        self.git("init", "-q", "--bare", "-b", "main", str(origin))
        self.git("init", "-q", "-b", "main")
        self.git("add", ".")
        self.git("commit", "-q", "-m", "init")
        self.git("remote", "add", "origin", str(origin))
        self.git("push", "-q", "origin", "main")
        self.git("fetch", "-q", "origin", "main")

    def git(self, *args: str) -> str:
        result = subprocess.run(
            ["git", *args],
            cwd=self.repo,
            env={**self.env, "PATH": self.no_fly_path},
            capture_output=True,
            text=True,
            timeout=30,
            check=True,
        )
        return result.stdout.strip()

    def make(self, *args: str, path: str | None = None) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["make", *args],
            cwd=self.repo,
            env={**self.env, "PATH": path or self.path},
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )

    def refused(self, reason: str, *args: str, path: str | None = None) -> None:
        result = self.make(*args, path=path)
        assert result.returncode != 0, result.stdout
        assert reason in result.stderr
        assert self.marker.read_text() == ""


def test_ac8_deploy_guard(tmp_path: Path) -> None:
    repo = DeployRepo(tmp_path)

    assert shutil.which("fly", path=repo.no_fly_path) is None
    assert shutil.which("flyctl", path=repo.no_fly_path) is None
    repo.refused("fly is not on PATH", "deploy-api", path=repo.no_fly_path)

    (repo.repo / "stray.txt").write_text("not committed")
    repo.refused("not clean", "deploy-api")
    (repo.repo / "stray.txt").unlink()

    (repo.repo / "local.txt").write_text("committed here only")
    repo.git("add", ".")
    repo.git("commit", "-q", "-m", "local")
    repo.refused("not origin/main", "deploy-api")
    repo.git("reset", "-q", "--hard", "origin/main")

    usage = "usage: make deploy-web"
    repo.refused(usage, "deploy-web", "CONTACT_EMAIL=hello@homie.example")
    repo.refused(usage, "deploy-web", "DOMAIN=homie.example")
    repo.refused(usage, "deploy-web", "DOMAIN=homie.example", "CONTACT_EMAIL=contact@example.com")

    result = repo.make("deploy-api")
    assert result.returncode == 0, result.stderr
    sha = repo.git("rev-parse", "HEAD")
    assert repo.marker.read_text().splitlines() == [
        "deploy . --config infra/fly/api.toml --dockerfile infra/Dockerfile.api --remote-only"
        f" --ha=false --env SENTRY_RELEASE={sha}"
    ]

    repo.marker.write_text("")
    result = repo.make("import-areas-prod")
    assert result.returncode == 0, result.stderr
    assert repo.marker.read_text().splitlines() == [
        "ssh console --config infra/fly/api.toml --process-group worker"
        " -C /opt/venv/bin/python /app/scripts/import_areas.py"
    ]


# --- AC11: production never contacts nadlan.gov.il ------------------------------------------------


def test_ac11_area_import_off_makes_no_request(
    db_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
    set_env: Callable[..., None],
    capsys: pytest.CaptureFixture[str],
) -> None:
    def no_fetcher() -> NadlanFetcher:
        raise AssertionError("a fetcher was built with RENT_REFERENCE=off")

    monkeypatch.setattr(rent_reference, "get_rent_fetcher", no_fetcher)
    set_env(RENT_REFERENCE="off")

    import_areas_script.main()

    output = capsys.readouterr().out
    assert "'neighbourhoods': 0" in output and "'files_failed': 0" in output
    with db_engine.connect() as conn:
        kinds = dict(
            conn.execute(text("SELECT kind, count(*) FROM areas GROUP BY kind")).tuples().all()
        )
    assert kinds.keys() == {"settlement"} and kinds["settlement"] > 1000

    # The contrast: `nadlan` builds the fetcher and asks for the big cities (a 404-only mock).
    requests: list[httpx.Request] = []

    def not_found(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(404)

    nadlan = NadlanFetcher(
        httpx.Client(transport=httpx.MockTransport(not_found), base_url="https://n.test"),
        sleep=lambda _: None,
    )
    monkeypatch.setattr(rent_reference, "get_rent_fetcher", lambda: nadlan)
    set_env(RENT_REFERENCE="nadlan")

    import_areas_script.main()

    assert requests
    assert nadlan.client.is_closed


# --- AC9: the runbook -----------------------------------------------------------------------------


def test_ac9_runbook_names_every_secret_and_no_value() -> None:
    runbook = (REPO_ROOT / "infra" / "DEPLOY.md").read_text()
    names = {
        *FAKE_FLY_SECRETS,
        *OPTIONAL_FLY_VALUES,
        *OTHER_APP_SECRETS,
        "VITE_GOOGLE_CLIENT_ID",
    }
    for name in names:
        assert re.search(rf"\b{name}\b", runbook), name
    assert "import-areas-prod" in runbook

    assigned = re.findall(
        rf"(?<![A-Z0-9_])({'|'.join(sorted(names))})=(\"[^\"]*\"|\S*)", runbook, re.ASCII
    )
    assert assigned
    for name, value in assigned:
        if name != "GOOGLE_VERIFIER":
            assert "<" in value or value.startswith("$("), f"{name}={value}"


def test_ac9_runbook_smtp_url_is_one_the_sender_accepts() -> None:
    runbook = (REPO_ROOT / "infra" / "DEPLOY.md").read_text()
    match = re.search(r"^SMTP_URL=(\S*<\S+>\S*)$", runbook, re.M)
    assert match is not None
    target = parse_smtp_url(re.sub(r"<[^>]+>", "placeholder", match.group(1)))
    assert target.implicit_tls is True
    assert (target.host, target.port, target.username) == ("smtp.resend.com", 465, "resend")


def test_ac9_runbook_records_the_tool_versions() -> None:
    head = (REPO_ROOT / "infra" / "DEPLOY.md").read_text()[:2000]
    makefile = (REPO_ROOT / "Makefile").read_text()
    version = re.search(r"^WRANGLER_VERSION := (\S+)$", makefile, re.M)
    assert version is not None
    assert version.group(1) in head
    assert "flyctl" in head
