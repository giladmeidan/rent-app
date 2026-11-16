"""Password sign-up, login and change (spec 0016a): AC1-AC9, NF1-NF3."""

import logging
from collections.abc import Callable
from typing import Any

import httpx
import pytest
from argon2 import PasswordHasher
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from app.services import passwords
from tests.conftest import Outbox, make_seeker, signup
from tests.test_account_deletion import _session
from tests.test_auth import CODE_LINE, _session_cookie

pytestmark = pytest.mark.usefixtures("redis_clean")

EMAIL = "noa@example.com"
PASSWORD = "correct horse battery"
PROFILE = {"display_name": "נועה", "role": "owner"}
HASH_PREFIX = "$argon2id$v=19$m=19456,t=2,p=1$"
INVALID = {"detail": "invalid_credentials"}
NET_A = "203.0.113.7"
NET_B = "198.51.100.9"


def _code(client: TestClient, outbox: Outbox, email: str = EMAIL) -> str:
    assert client.post("/auth/otp/request", json={"email": email}).status_code == 204
    match = CODE_LINE.search(outbox.messages[-1][2])
    assert match is not None
    return match.group()


def _verify(
    client: TestClient, outbox: Outbox, email: str = EMAIL, password: str | None = None
) -> httpx.Response:
    profile: dict[str, Any] = dict(PROFILE)
    if password is not None:
        profile["password"] = password
    body = {"email": email, "code": _code(client, outbox, email), "profile": profile}
    response: httpx.Response = client.post("/auth/otp/verify", json=body)
    return response


def _signup(
    client: TestClient, outbox: Outbox, email: str = EMAIL, password: str = PASSWORD
) -> None:
    assert _verify(client, outbox, email, password).status_code == 201
    client.cookies.clear()


def _login(
    client: TestClient, password: str, email: str = EMAIL, network: str | None = None
) -> httpx.Response:
    headers = {"Fly-Client-IP": network} if network else {}
    response: httpx.Response = client.post(
        "/auth/password/login", json={"email": email, "password": password}, headers=headers
    )
    client.cookies.clear()
    return response


def _scalar(engine: Engine, sql: str, **params: Any) -> Any:
    with engine.connect() as conn:
        return conn.execute(text(sql), params).scalar()


def _execute(engine: Engine, sql: str, **params: Any) -> None:
    with engine.begin() as conn:
        conn.execute(text(sql), params)


def _hash_of(engine: Engine, email: str = EMAIL) -> str | None:
    stored: str | None = _scalar(
        engine,
        "SELECT p.hash FROM user_passwords p JOIN users u ON u.id = p.user_id WHERE u.email = :e",
        e=email,
    )
    return stored


def _sessions(engine: Engine) -> int:
    return int(_scalar(engine, "SELECT count(*) FROM sessions"))


def _counting_verify(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Record the stored hash of every `verify_password` call (the real one still runs)."""
    calls: list[str] = []
    real = passwords.verify_password

    def counted(stored: str, raw: str) -> bool:
        calls.append(stored)
        return real(stored, raw)

    monkeypatch.setattr(passwords, "verify_password", counted)
    return calls


def test_ac1_signup_with_password_stores_argon2id_hash(
    client: TestClient, outbox: Outbox, db_engine: Engine
) -> None:
    response = _verify(client, outbox, password=PASSWORD)

    assert response.status_code == 201
    assert response.json()["has_password"] is True
    stored = _hash_of(db_engine)
    assert stored is not None and stored.startswith(HASH_PREFIX)
    assert PASSWORD not in stored
    assert client.get("/me").json()["has_password"] is True
    client.cookies.clear()

    other = "other@example.com"
    response = _verify(client, outbox, other)

    assert response.status_code == 201
    assert response.json()["has_password"] is False
    assert _hash_of(db_engine, other) is None
    assert client.get("/me").json()["has_password"] is False


def test_ac2_each_hash_has_its_own_salt(
    client: TestClient, outbox: Outbox, db_engine: Engine
) -> None:
    _signup(client, outbox, "a@example.com")
    _signup(client, outbox, "b@example.com")

    first, second = _hash_of(db_engine, "a@example.com"), _hash_of(db_engine, "b@example.com")
    assert first and second and first != second
    again = [passwords.hash_password(PASSWORD) for _ in range(2)]
    assert again[0] != again[1]
    assert all(passwords.verify_password(h, PASSWORD) for h in again)


def test_ac3_password_login_sets_session(
    client: TestClient, outbox: Outbox, db_engine: Engine
) -> None:
    verify = _verify(client, outbox, password=PASSWORD)
    client.cookies.clear()
    _execute(db_engine, "UPDATE users SET last_login_at = NULL")

    response = client.post(
        "/auth/password/login", json={"email": "  NOA@Example.com ", "password": PASSWORD}
    )

    assert response.status_code == 200
    assert response.json()["email"] == EMAIL
    assert response.json()["has_password"] is True
    cookie, at_verify = _session_cookie(response), _session_cookie(verify)
    for attribute in ("httponly", "samesite", "max-age", "path", "secure"):
        assert cookie[attribute] == at_verify[attribute], attribute
    client.cookies.clear()
    me = TestClient(client.app, cookies={"rent_session": cookie.value}).get("/me")
    assert (me.status_code, me.json()["email"]) == (200, EMAIL)
    assert _scalar(db_engine, "SELECT last_login_at FROM users") is not None


def test_ac4_one_answer_for_every_failure(
    client: TestClient, outbox: Outbox, db_engine: Engine
) -> None:
    _signup(client, outbox)
    make_seeker(db_engine, "nopass@example.com")
    gone = make_seeker(db_engine, "gone@example.com")
    _execute(
        db_engine,
        "INSERT INTO user_passwords (user_id, hash) VALUES (:u, :h)",
        u=gone,
        h=passwords.hash_password(PASSWORD),
    )
    _execute(
        db_engine,
        "UPDATE users SET deleted_at = now(), email = NULL, display_name = NULL WHERE id = :u",
        u=gone,
    )
    before = _sessions(db_engine)

    for email, password in (
        (EMAIL, "wrong password!"),
        ("nobody@example.com", PASSWORD),
        ("gone@example.com", PASSWORD),
        ("nopass@example.com", PASSWORD),
        (EMAIL, "x"),
    ):
        response = _login(client, password, email)
        assert (response.status_code, response.json()) == (401, INVALID), email
        assert "set-cookie" not in response.headers
    assert _sessions(db_engine) == before


def test_ac5_suspended_account(client: TestClient, outbox: Outbox, db_engine: Engine) -> None:
    _signup(client, outbox)
    _execute(db_engine, "UPDATE users SET suspended_at = now(), last_login_at = NULL")
    before = _sessions(db_engine)

    right = _login(client, PASSWORD)
    wrong = _login(client, "wrong password!")

    assert (right.status_code, right.json()) == (403, {"detail": "account_suspended"})
    assert "set-cookie" not in right.headers
    assert (wrong.status_code, wrong.json()) == (401, INVALID)
    assert _sessions(db_engine) == before
    assert _scalar(db_engine, "SELECT last_login_at FROM users") is None


def test_ac6_rate_limits(
    client: TestClient,
    outbox: Outbox,
    db_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
    set_env: Callable[..., None],
) -> None:
    set_env(TRUST_PROXY="fly")
    _signup(client, outbox)
    calls = _counting_verify(monkeypatch)
    for _ in range(10):
        assert _login(client, "wrong password!", network=NET_A).status_code == 401

    refused = _login(client, PASSWORD, network=NET_A)

    assert (refused.status_code, refused.json()) == (429, {"detail": "rate_limited"})
    assert int(refused.headers["retry-after"]) >= 1
    assert len(calls) == 10
    assert _login(client, "wrong password!", network=NET_B).status_code == 401
    # The per-email ceiling across networks: 100 a day (11 used so far, NET_A's refusal free).
    for i in range(89):
        network = f"192.0.2.{i // 9 + 1}"
        assert _login(client, "wrong password!", network=network).status_code == 401
    over = _login(client, PASSWORD, network="192.0.2.200")
    assert over.status_code == 429
    assert len(calls) == 100
    # The emailed code still logs in.
    code = _code(client, outbox)
    assert client.post("/auth/otp/verify", json={"email": EMAIL, "code": code}).status_code == 200


def test_ac7_set_password_needs_fresh_session_and_signs_out_others(
    client: TestClient, outbox: Outbox, db_engine: Engine
) -> None:
    me = signup(client, outbox, EMAIL, "owner")
    user_id = me.get("/me").json()["id"]
    assert me.get("/me").json()["has_password"] is False
    laptop = _session(client, db_engine, user_id)

    response = me.put("/me/password", json={"password": "first password"})

    assert response.status_code == 204
    assert me.get("/me").json()["has_password"] is True
    assert laptop.get("/me").status_code == 401
    assert me.put("/me/password", json={"password": "second password"}).status_code == 204
    assert _login(client, "first password").status_code == 401
    assert _login(client, "second password").status_code == 200

    stored = _hash_of(db_engine)
    old = _session(client, db_engine, user_id, age_s=16 * 60)
    refused = old.put("/me/password", json={"password": "third password"})
    assert (refused.status_code, refused.json()) == (403, {"detail": "reauth_required"})
    assert _hash_of(db_engine) == stored
    assert old.get("/me").status_code == 200  # nothing revoked


def test_ac8_length_and_no_stripping(client: TestClient, outbox: Outbox, db_engine: Engine) -> None:
    for bad in ("123456789", "x" * 129):
        response = _verify(client, outbox, password=bad)
        assert response.status_code == 422
        assert all("input" not in entry for entry in response.json()["detail"])
        assert bad not in response.text
    assert _scalar(db_engine, "SELECT count(*) FROM users") == 0

    spaced = "  spaced password  "
    _signup(client, outbox, password=spaced)
    assert _login(client, spaced.strip()).status_code == 401
    assert _login(client, spaced).status_code == 200

    me = signup(client, outbox, "other@example.com", "seeker")
    for bad in ("123456789", "x" * 129):
        response = me.put("/me/password", json={"password": bad})
        assert response.status_code == 422
        assert all("input" not in entry for entry in response.json()["detail"])
    assert _hash_of(db_engine, "other@example.com") is None


def test_ac9_login_ignores_profile_password(
    client: TestClient, outbox: Outbox, db_engine: Engine
) -> None:
    signup(client, outbox, EMAIL, "owner")

    response = _verify(client, outbox, password=PASSWORD)

    assert response.status_code == 200
    assert response.json()["has_password"] is False
    assert _hash_of(db_engine) is None


def test_nf1_every_failure_runs_one_verify(
    client: TestClient, outbox: Outbox, db_engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    make_seeker(db_engine, "nopass@example.com")
    gone = make_seeker(db_engine, "gone@example.com")
    _execute(
        db_engine,
        "UPDATE users SET deleted_at = now(), email = NULL, display_name = NULL WHERE id = :u",
        u=gone,
    )
    calls = _counting_verify(monkeypatch)

    for email in ("nobody@example.com", "gone@example.com", "nopass@example.com"):
        calls.clear()
        assert _login(client, PASSWORD, email).status_code == 401
        assert calls == [passwords.DUMMY_HASH], email


def test_nf2_password_never_logged(
    client: TestClient, outbox: Outbox, db_engine: Engine, caplog: pytest.LogCaptureFixture
) -> None:
    secret = "NF2-very-secret-password"
    caplog.set_level(logging.DEBUG)
    bodies = [
        _verify(client, outbox, password=secret).text,
        _login(client, secret).text,
        _login(client, secret + "!").text,
    ]
    me = signup(client, outbox, "other@example.com", "seeker")
    bodies += [
        me.put("/me/password", json={"password": secret}).text,
        me.put("/me/password", json={"password": secret[:9]}).text,
    ]

    assert not any(secret[:9] in body for body in bodies)
    assert not any(secret[:9] in record.getMessage() for record in caplog.records)


def test_nf3_rehash_on_login(client: TestClient, outbox: Outbox, db_engine: Engine) -> None:
    stored = passwords.hash_password(PASSWORD)
    assert passwords.verify_password(stored, PASSWORD)
    assert not passwords.verify_password(stored, PASSWORD + "x")
    assert not passwords.needs_rehash(stored)
    weaker = PasswordHasher(time_cost=1, memory_cost=8192, parallelism=1).hash(PASSWORD)
    assert passwords.needs_rehash(weaker)
    _signup(client, outbox)
    _execute(db_engine, "UPDATE user_passwords SET hash = :h", h=weaker)

    assert _login(client, PASSWORD).status_code == 200

    upgraded = _hash_of(db_engine)
    assert upgraded is not None and upgraded != weaker and upgraded.startswith(HASH_PREFIX)
    assert not passwords.needs_rehash(upgraded)
    assert _login(client, PASSWORD).status_code == 200
