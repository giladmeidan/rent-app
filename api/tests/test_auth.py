"""Email-OTP auth and sessions (spec 0001a): AC1-AC11, AC14-AC17, NF1."""

import json
import logging
import re
import threading
import time
from collections.abc import Callable, Iterator
from http.cookies import Morsel, SimpleCookie
from pathlib import Path
from typing import Any

import httpx
import pytest
import redis
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text
from sqlalchemy.exc import OperationalError

from app.config import get_settings
from app.db import get_sessionmaker
from app.models import User
from app.redis_client import get_redis
from app.schemas.auth import ProfileIn
from app.services import auth as auth_service
from app.services.email import EmailUnavailable, get_email_sender
from tests.conftest import Outbox

pytestmark = pytest.mark.usefixtures("redis_clean")

EMAIL = "noa@example.com"
PROFILE = {"display_name": "נועה", "role": "owner"}
CODE_LINE = re.compile(r"^[0-9]{6}$", re.M)


def _session_cookie(response: httpx.Response) -> "Morsel[str]":
    jar: SimpleCookie = SimpleCookie()
    for header in response.headers.get_list("set-cookie"):
        jar.load(header)
    return jar["rent_session"]


def _request_code(client: TestClient, outbox: Outbox, email: str = EMAIL) -> str:
    response = client.post("/auth/otp/request", json={"email": email})
    assert response.status_code == 204
    match = CODE_LINE.search(outbox.messages[-1][2])
    assert match is not None
    return match.group()


def _verify(
    client: TestClient, email: str, code: str, profile: dict[str, str] | None = None
) -> httpx.Response:
    body = {"email": email, "code": code, "profile": profile}
    response: httpx.Response = client.post("/auth/otp/verify", json=body)
    return response


def _signup(client: TestClient, outbox: Outbox, email: str = EMAIL) -> httpx.Response:
    response = _verify(client, email, _request_code(client, outbox, email), PROFILE)
    assert response.status_code == 201
    return response


def _wrong(code: str) -> str:
    return f"{(int(code) + 1) % 10**6:06d}"


def _scalar(engine: Engine, sql: str, **params: Any) -> Any:
    with engine.connect() as conn:
        return conn.execute(text(sql), params).scalar()


def _redis_keys() -> list[bytes]:
    r = get_redis()
    return [*r.scan_iter(match="otp:*"), *r.scan_iter(match="rl:*")]


@pytest.fixture
def set_env(monkeypatch: pytest.MonkeyPatch) -> Iterator[Callable[..., None]]:
    """Set environment variables and re-read the settings; restored after the test."""

    def _set(**values: str) -> None:
        for name, value in values.items():
            monkeypatch.setenv(name, value)
        get_settings.cache_clear()

    yield _set
    get_settings.cache_clear()


def test_ac1_request_sends_code_and_stores_hmac(client: TestClient, outbox: Outbox) -> None:
    response = client.post("/auth/otp/request", json={"email": EMAIL})

    assert response.status_code == 204
    assert response.content == b""
    assert len(outbox.messages) == 1
    to, subject, body = outbox.messages[0]
    assert to == EMAIL
    assert subject == "קוד הכניסה שלך"
    code = CODE_LINE.search(body)
    assert code is not None
    r = get_redis()
    stored = r.hget(f"otp:{EMAIL}", "code_hmac")
    assert stored is not None and code.group().encode() not in stored
    assert 0 < r.ttl(f"otp:{EMAIL}") <= 600


def test_ac2_signup_requires_profile_then_creates_user(
    client: TestClient, outbox: Outbox, db_engine: Engine
) -> None:
    code = _request_code(client, outbox)

    response = _verify(client, EMAIL, code)
    assert response.status_code == 422
    assert response.json() == {"detail": "profile_required"}
    assert get_redis().hget(f"otp:{EMAIL}", "attempts") == b"0"

    response = _verify(client, EMAIL, code, {"display_name": "  נועה ", "role": "owner"})

    assert response.status_code == 201
    cookie = _session_cookie(response)
    assert cookie.value
    assert cookie["httponly"] is True
    assert cookie["samesite"].lower() == "lax"
    assert cookie["max-age"] == "2592000"
    assert cookie["path"] == "/"
    assert not cookie["secure"]
    with db_engine.connect() as conn:
        row = conn.execute(
            text("SELECT id, display_name, role, account_type FROM users WHERE email = :e"),
            {"e": EMAIL},
        ).one()
    assert (row.display_name, row.role, row.account_type) == ("נועה", "owner", "individual")
    assert response.json()["id"] == str(row.id)
    me = client.get("/me")
    assert me.status_code == 200
    assert me.json()["id"] == str(row.id)


def test_ac3_login_ignores_profile_and_sets_last_login(
    client: TestClient, outbox: Outbox, db_engine: Engine
) -> None:
    _signup(client, outbox)
    with db_engine.begin() as conn:
        conn.execute(text("UPDATE users SET last_login_at = NULL"))

    code = _request_code(client, outbox)
    response = _verify(client, EMAIL, code, {"display_name": "Someone Else", "role": "seeker"})

    assert response.status_code == 200
    assert (response.json()["display_name"], response.json()["role"]) == ("נועה", "owner")
    with db_engine.connect() as conn:
        row = conn.execute(text("SELECT display_name, role, last_login_at FROM users")).one()
    assert (row.display_name, row.role) == ("נועה", "owner")
    assert row.last_login_at is not None
    assert get_redis().exists(f"otp:{EMAIL}") == 0


def test_ac4_five_wrong_attempts_invalidate_code(client: TestClient, outbox: Outbox) -> None:
    code = _request_code(client, outbox)

    for _ in range(5):
        response = _verify(client, EMAIL, _wrong(code), PROFILE)
        assert response.status_code == 401
        assert response.json() == {"detail": "invalid_code"}

    assert get_redis().exists(f"otp:{EMAIL}") == 0
    response = _verify(client, EMAIL, code, PROFILE)
    assert response.status_code == 401
    assert response.json() == {"detail": "invalid_code"}


def test_ac4_correct_code_after_four_wrong_attempts_still_works(
    client: TestClient, outbox: Outbox
) -> None:
    code = _request_code(client, outbox)
    for _ in range(4):
        assert _verify(client, EMAIL, _wrong(code), PROFILE).status_code == 401

    assert _verify(client, EMAIL, code, PROFILE).status_code == 201


def test_ac4_never_requested_code_is_invalid(client: TestClient, outbox: Outbox) -> None:
    response = _verify(client, EMAIL, "123456", PROFILE)

    assert response.status_code == 401
    assert response.json() == {"detail": "invalid_code"}
    assert _redis_keys() == []  # a failed verify never creates a key (one without a TTL)


def test_ac5_expired_code_rejected(
    client: TestClient, outbox: Outbox, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(auth_service, "OTP_TTL_S", 1)
    code = _request_code(client, outbox)

    time.sleep(1.2)
    response = _verify(client, EMAIL, code, PROFILE)

    assert response.status_code == 401
    assert response.json() == {"detail": "invalid_code"}


def test_ac6_email_rate_limit(client: TestClient, outbox: Outbox) -> None:
    for _ in range(3):
        assert client.post("/auth/otp/request", json={"email": EMAIL}).status_code == 204

    response = client.post("/auth/otp/request", json={"email": EMAIL})

    assert response.status_code == 429
    assert response.json() == {"detail": "rate_limited"}
    assert 1 <= int(response.headers["retry-after"]) <= 900
    assert len(outbox.messages) == 3
    assert client.post("/auth/otp/request", json={"email": "dan@example.com"}).status_code == 204
    r = get_redis()
    rl_keys = list(r.scan_iter(match="rl:*"))
    assert rl_keys
    assert all(r.ttl(key) > 0 for key in rl_keys)


def test_ac7_ip_rate_limit(client: TestClient, outbox: Outbox) -> None:
    for i in range(10):
        response = client.post("/auth/otp/request", json={"email": f"user{i}@example.com"})
        assert response.status_code == 204

    response = client.post("/auth/otp/request", json={"email": "user10@example.com"})

    assert response.status_code == 429
    assert response.json() == {"detail": "rate_limited"}
    assert len(outbox.messages) == 10


def test_ac8_logout_revokes_and_is_idempotent(
    client: TestClient, outbox: Outbox, db_engine: Engine
) -> None:
    token = _session_cookie(_signup(client, outbox)).value

    response = client.post("/auth/logout")

    assert response.status_code == 204
    cookie = _session_cookie(response)
    assert cookie.value == ""
    assert cookie["max-age"] == "0"
    assert cookie["path"] == "/"
    assert cookie["httponly"] is True
    assert cookie["samesite"].lower() == "lax"
    assert _scalar(db_engine, "SELECT revoked_at FROM sessions") is not None
    client.cookies.set("rent_session", token)
    me = client.get("/me")
    assert me.status_code == 401
    assert me.json() == {"detail": "unauthenticated"}
    client.cookies.clear()
    assert client.post("/auth/logout").status_code == 204


def test_ac9_expired_session_rejected(
    client: TestClient, outbox: Outbox, db_engine: Engine
) -> None:
    _signup(client, outbox)
    assert client.get("/me").status_code == 200
    with db_engine.begin() as conn:
        conn.execute(text("UPDATE sessions SET expires_at = now() - interval '1 second'"))

    response = client.get("/me")

    assert response.status_code == 401
    assert response.json() == {"detail": "unauthenticated"}


def test_me_rejects_missing_and_unknown_cookie(client: TestClient) -> None:
    assert client.get("/me").json() == {"detail": "unauthenticated"}
    client.cookies.set("rent_session", "not-a-session")
    response = client.get("/me")
    assert response.status_code == 401
    assert response.json() == {"detail": "unauthenticated"}


def test_ac10_no_account_enumeration(client: TestClient, outbox: Outbox) -> None:
    _signup(client, outbox)

    known = client.post("/auth/otp/request", json={"email": EMAIL})
    unknown = client.post("/auth/otp/request", json={"email": "nobody@example.com"})

    assert known.status_code == unknown.status_code == 204
    assert known.content == unknown.content == b""

    def headers(response: httpx.Response) -> list[tuple[str, str]]:
        return [(k, v) for k, v in response.headers.multi_items() if k.lower() != "date"]

    assert headers(known) == headers(unknown)


_GOOD_VERIFY = {"email": EMAIL, "code": "123456"}


@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("/auth/otp/verify", {**_GOOD_VERIFY, "profile": {"display_name": "א", "role": "owner"}}),
        (
            "/auth/otp/verify",
            {**_GOOD_VERIFY, "profile": {"display_name": "א" * 41, "role": "owner"}},
        ),
        ("/auth/otp/verify", {**_GOOD_VERIFY, "profile": {"display_name": " א ", "role": "owner"}}),
        (
            "/auth/otp/verify",
            {**_GOOD_VERIFY, "profile": {"display_name": "נועה", "role": "admin"}},
        ),
        ("/auth/otp/verify", {**_GOOD_VERIFY, "code": "12345"}),
        ("/auth/otp/verify", {**_GOOD_VERIFY, "code": "٠١٢٣٤٥"}),
        ("/auth/otp/verify", {**_GOOD_VERIFY, "email": "x"}),
        ("/auth/otp/request", {"email": "x"}),
        (
            "/auth/otp/verify",
            {**_GOOD_VERIFY, "profile": {"display_name": "\u0000\u0000", "role": "owner"}},
        ),
        (
            "/auth/otp/verify",
            {**_GOOD_VERIFY, "profile": {"display_name": "\u200b\u200b", "role": "owner"}},
        ),
        (
            "/auth/otp/verify",
            {**_GOOD_VERIFY, "profile": {"display_name": "a\nb", "role": "owner"}},
        ),
    ],
    ids=[
        "name-1-char",
        "name-41-code-points",
        "name-2-chars-before-strip",
        "role-admin",
        "code-5-digits",
        "code-arabic-indic-digits",
        "verify-email-x",
        "request-email-x",
        "name-nul",
        "name-zero-width-space",
        "name-newline",
    ],
)
def test_ac11_validation_rejects_bad_input(
    client: TestClient, outbox: Outbox, db_engine: Engine, path: str, body: dict[str, Any]
) -> None:
    response = client.post(path, json=body)

    assert response.status_code == 422
    assert isinstance(response.json()["detail"], list)
    assert _scalar(db_engine, "SELECT count(*) FROM users") == 0
    assert _redis_keys() == []
    assert outbox.messages == []


def test_ac14_file_backend_writes_outbox(
    client: TestClient, tmp_path: Path, set_env: Callable[..., None]
) -> None:
    outbox_dir = tmp_path / "outbox" / "nested"
    set_env(EMAIL_BACKEND="file", EMAIL_OUTBOX_DIR=str(outbox_dir))

    for _ in range(2):
        assert client.post("/auth/otp/request", json={"email": EMAIL}).status_code == 204

    files = sorted(outbox_dir.glob("*.json"))
    assert len(files) == 2
    for path in files:
        message = json.loads(path.read_text(encoding="utf-8"))
        assert set(message) == {"to", "subject", "body", "sent_at"}
        assert message["to"] == EMAIL
        assert CODE_LINE.search(message["body"])


def test_ac15_cors_allows_credentials_for_web_origin_only(client: TestClient) -> None:
    web_origin = get_settings().web_origin

    allowed = client.get("/me", headers={"Origin": web_origin})
    evil = client.get("/me", headers={"Origin": "http://evil.example"})

    assert allowed.headers["access-control-allow-origin"] == web_origin
    assert allowed.headers["access-control-allow-credentials"] == "true"
    assert "access-control-allow-origin" not in evil.headers


def test_ac16_daily_email_rate_limit(client: TestClient, outbox: Outbox) -> None:
    r = get_redis()

    def reset_15_min_counters() -> None:
        # Both 15-min counters (email and this client's IP), so only the daily one accumulates.
        r.delete(f"rl:otp:email:{EMAIL}", "rl:otp:ip:testclient")

    for _ in range(10):
        reset_15_min_counters()
        assert client.post("/auth/otp/request", json={"email": EMAIL}).status_code == 204
    reset_15_min_counters()

    response = client.post("/auth/otp/request", json={"email": EMAIL})

    assert response.status_code == 429
    assert response.json() == {"detail": "rate_limited"}
    assert int(response.headers["retry-after"]) > 900  # the daily window tripped
    assert len(outbox.messages) == 10


def test_ac17_email_failure_is_503_and_counted(client: TestClient, outbox: Outbox) -> None:
    class FailingSender:
        def send(self, to: str, subject: str, body: str) -> None:
            raise EmailUnavailable

    client.app.dependency_overrides[get_email_sender] = FailingSender  # type: ignore[attr-defined]

    response = client.post("/auth/otp/request", json={"email": EMAIL})

    assert response.status_code == 503
    assert response.json() == {"detail": "email_unavailable"}
    r = get_redis()
    assert r.exists(f"otp:{EMAIL}") == 0
    assert r.get(f"rl:otp:email:{EMAIL}") == b"1"
    assert r.get(f"rl:otp:email:day:{EMAIL}") == b"1"
    assert r.get("rl:otp:ip:testclient") == b"1"


def test_nf1_code_never_logged(
    client: TestClient, outbox: Outbox, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.DEBUG):
        request = client.post("/auth/otp/request", json={"email": EMAIL})
        code = CODE_LINE.search(outbox.messages[-1][2])
        assert code is not None
        verify = _verify(client, EMAIL, code.group(), PROFILE)
        me = client.get("/me")

    assert verify.status_code == 201
    assert caplog.records  # logging was captured at all
    assert code.group() not in caplog.text
    for response in (request, verify, me):
        assert code.group() not in response.text


def test_email_is_normalised_to_one_account(client: TestClient, outbox: Outbox) -> None:
    _signup(client, outbox, "Noa@Example.com")

    response = _verify(client, EMAIL, _request_code(client, outbox, EMAIL))

    assert response.status_code == 200
    assert response.json()["email"] == EMAIL


def test_concurrent_first_verify_logs_in_the_winner(
    client: TestClient, outbox: Outbox, db_engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    code = _request_code(client, outbox)
    # The other request's INSERT committed after this one looked the email up and found nothing.
    with db_engine.begin() as conn:
        conn.execute(
            text("INSERT INTO users (email, display_name, role) VALUES (:e, 'Winner', 'seeker')"),
            {"e": EMAIL},
        )
    calls: list[str] = []
    real_find_user = auth_service._find_user

    def find_user_racing(db: Any, email: str) -> User | None:
        calls.append(email)
        return None if len(calls) == 1 else real_find_user(db, email)

    monkeypatch.setattr(auth_service, "_find_user", find_user_racing)

    response = _verify(client, EMAIL, code, PROFILE)

    assert response.status_code == 200
    assert (response.json()["display_name"], response.json()["role"]) == ("Winner", "seeker")
    assert _scalar(db_engine, "SELECT count(*) FROM users") == 1
    assert len(calls) == 2  # the INSERT conflicted and the winner's row was loaded


def test_cookie_secure_when_configured(
    client: TestClient, outbox: Outbox, set_env: Callable[..., None]
) -> None:
    set_env(COOKIE_SECURE="true")

    login = _signup(client, outbox)
    client.cookies.set("rent_session", _session_cookie(login).value)
    logout = client.post("/auth/logout")

    assert _session_cookie(login)["secure"] is True
    assert _session_cookie(logout)["secure"] is True


def test_ac11_invalid_name_keeps_code_valid(client: TestClient, outbox: Outbox) -> None:
    code = _request_code(client, outbox)

    response = _verify(client, EMAIL, code, {"display_name": "\u0000\u0000", "role": "owner"})

    assert response.status_code == 422
    assert get_redis().hget(f"otp:{EMAIL}", "attempts") == b"0"
    assert _verify(client, EMAIL, code, PROFILE).status_code == 201


@pytest.mark.parametrize("name", ["ab\u3164", "\ue000\ue000"], ids=["hangul-filler", "private-use"])
def test_ac7_display_name_rejects_blank_letters_and_private_use(
    client: TestClient, outbox: Outbox, db_engine: Engine, name: str
) -> None:
    code = _request_code(client, outbox)

    response = _verify(client, EMAIL, code, {"display_name": name, "role": "owner"})

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail[0]["type"] == "value_error"
    assert detail[0]["loc"] == ["body", "profile", "display_name"]
    assert detail[0]["msg"] == "Value error, display_name contains control or invisible characters"
    assert _scalar(db_engine, "SELECT count(*) FROM users") == 0
    assert get_redis().hget(f"otp:{EMAIL}", "attempts") == b"0"
    # The code stays valid, and a plain Hebrew name still signs up.
    response = _verify(client, EMAIL, code, {"display_name": "\u05d3\u05e0\u05d4", "role": "owner"})
    assert response.status_code == 201
    assert response.json()["display_name"] == "\u05d3\u05e0\u05d4"


def test_display_name_keeps_joiners() -> None:
    assert ProfileIn(display_name="👩\u200d💻 נועה", role="owner").display_name == "👩\u200d💻 נועה"


def test_ac16_burst_of_429s_does_not_consume_daily_budget(
    client: TestClient, outbox: Outbox
) -> None:
    statuses = [
        client.post("/auth/otp/request", json={"email": EMAIL}).status_code for _ in range(10)
    ]

    assert statuses == [204] * 3 + [429] * 7
    r = get_redis()
    assert r.get(f"rl:otp:email:day:{EMAIL}") == b"3"
    assert r.get("rl:otp:ip:testclient") == b"3"
    r.delete(f"rl:otp:email:{EMAIL}", "rl:otp:ip:testclient")  # the 15-min window has passed
    assert client.post("/auth/otp/request", json={"email": EMAIL}).status_code == 204


def test_ac7_ip_limited_requests_do_not_count_against_email(
    client: TestClient, outbox: Outbox
) -> None:
    for i in range(10):
        assert (
            client.post("/auth/otp/request", json={"email": f"u{i}@example.com"}).status_code == 204
        )

    response = client.post("/auth/otp/request", json={"email": EMAIL})

    assert response.status_code == 429
    r = get_redis()
    assert r.exists(f"rl:otp:email:{EMAIL}", f"rl:otp:email:day:{EMAIL}") == 0
    assert r.get("rl:otp:ip:testclient") == b"10"


def test_otp_single_use_under_concurrency(
    client: TestClient, outbox: Outbox, db_engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    with db_engine.begin() as conn:
        conn.execute(
            text("INSERT INTO users (email, display_name, role) VALUES (:e, 'נועה', 'owner')"),
            {"e": EMAIL},
        )
    code = _request_code(client, outbox)
    # Both verifies pass the code comparison and the user lookup before either claims the code.
    both_checked = threading.Barrier(2, timeout=10)
    real_find_user = auth_service._find_user

    def find_user_in_step(db: Any, email: str) -> User | None:
        user = real_find_user(db, email)
        both_checked.wait()
        return user

    monkeypatch.setattr(auth_service, "_find_user", find_user_in_step)
    outcomes: list[str] = []

    def verify() -> None:
        with get_sessionmaker()() as db:
            try:
                auth_service.verify_otp(db, get_redis(), EMAIL, code, None)
                outcomes.append("login")
            except auth_service.InvalidCodeError:
                outcomes.append("invalid_code")

    threads = [threading.Thread(target=verify) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=15)

    assert sorted(outcomes) == ["invalid_code", "login"]
    assert get_redis().exists(f"otp:{EMAIL}") == 0


def test_settling_a_code_never_touches_a_newer_one(client: TestClient, outbox: Outbox) -> None:
    r = get_redis()
    _request_code(client, outbox)
    old_hmac = r.hget(f"otp:{EMAIL}", "code_hmac")
    assert old_hmac is not None
    _request_code(client, outbox)
    new_hmac = r.hget(f"otp:{EMAIL}", "code_hmac")
    assert new_hmac != old_hmac

    for op in (b"del", b"refund"):
        assert auth_service._eval(r, auth_service._SETTLE_CODE, [f"otp:{EMAIL}"], old_hmac, op) == 0

    assert r.hgetall(f"otp:{EMAIL}") == {b"code_hmac": new_hmac, b"attempts": b"0"}


def test_code_survives_database_failure_at_login(
    client: TestClient, outbox: Outbox, db_engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    _signup(client, outbox)
    code = _request_code(client, outbox)

    def commit_fails() -> None:
        raise OperationalError("COMMIT", {}, Exception("connection lost"))

    with get_sessionmaker()() as db:
        monkeypatch.setattr(db, "commit", commit_fails)
        with pytest.raises(OperationalError):
            auth_service.verify_otp(db, get_redis(), EMAIL, code, None)

    r = get_redis()
    assert r.hget(f"otp:{EMAIL}", "attempts") == b"1"
    assert 0 < r.pttl(f"otp:{EMAIL}") <= 600_000
    assert _verify(client, EMAIL, code).status_code == 200


def test_redis_down_is_json_503(client: TestClient, outbox: Outbox) -> None:
    unreachable = redis.Redis.from_url("redis://127.0.0.1:1/0", socket_connect_timeout=0.5)
    client.app.dependency_overrides[get_redis] = lambda: unreachable  # type: ignore[attr-defined]

    for path, body in (
        ("/auth/otp/request", {"email": EMAIL}),
        ("/auth/otp/verify", {"email": EMAIL, "code": "123456"}),
    ):
        response = client.post(path, json=body)
        assert response.status_code == 503
        assert response.json() == {"detail": "redis unavailable"}
    assert outbox.messages == []


# --- spec 0010b: no role gates -----------------------------------------------------------------

_ROLE_READ = re.compile(r"\b(user|seeker|owner|me)\.role\b")
# (file under `app/`, stripped line): the only role reads left. Apartments keep the roles (POST
# /listings, apply); the room-privacy rule reads it beside the profile (decision 13).
_ROLE_READS_ALLOWED = {
    ("routers/listings.py", 'if body.listing_type == "apartment" and user.role != "owner":'),
    (
        "services/applications.py",
        'if gate.listing_type == "apartment" and seeker.role != "seeker":',
    ),
    (
        "routers/search.py",
        'return user is not None and (user.role == "seeker" or profile_user_id is not None)',
    ),
}


def _dependency_names(dependant: Any) -> Iterator[str]:
    for dependency in dependant.dependencies:
        if dependency.call is not None:
            yield getattr(dependency.call, "__name__", repr(dependency.call))
        yield from _dependency_names(dependency)


def test_ac9_role_read_only_for_apartments() -> None:
    from fastapi.routing import APIRoute

    import app.auth
    from app.main import create_app
    from tests.test_flatmates import _api_routes

    assert not hasattr(app.auth, "current_owner")
    assert not hasattr(app.auth, "current_seeker")
    routes: list[APIRoute] = list(_api_routes(create_app().routes))
    assert len(routes) > 30
    gated = {
        route.path: names
        for route in routes
        if (names := set(_dependency_names(route.dependant))) & {"current_owner", "current_seeker"}
    }
    assert gated == {}
    assert any("current_user" in set(_dependency_names(r.dependant)) for r in routes)

    app_dir = Path(app.auth.__file__).resolve().parent
    reads = {
        (path.relative_to(app_dir).as_posix(), line.strip())
        for path in sorted(app_dir.rglob("*.py"))
        if path.relative_to(app_dir).as_posix() != "services/auth.py"
        for line in path.read_text(encoding="utf-8").splitlines()
        if _ROLE_READ.search(line)
    }
    assert reads == _ROLE_READS_ALLOWED
