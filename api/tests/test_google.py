"""Google sign-in (spec 0016b): POST /auth/google with the fake verifier, and the `google` backend
against a key generated here (its certs served by a monkeypatched fetch: nothing reaches Google)."""

import logging
import threading
import time
from collections.abc import Callable
from http.cookies import Morsel, SimpleCookie
from typing import Any

import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from google.auth import crypt, jwt
from sqlalchemy import Engine, text

from app.db import get_sessionmaker
from app.models import User
from app.redis_client import get_redis
from app.schemas.auth import GoogleProfileIn
from app.services import accounts
from app.services import auth as auth_service
from app.services import google as google_service
from app.services.photo_store import FilePhotoStore
from tests.conftest import Outbox, signup

pytestmark = pytest.mark.usefixtures("redis_clean", "fake_verifier")

EMAIL = "noa@example.com"
PROFILE = {"display_name": "נועה", "role": "owner"}
CLIENT_ID = "test-client"
INVALID = {"detail": "invalid_google_token"}


@pytest.fixture
def fake_verifier(set_env: Callable[..., None]) -> None:
    set_env(GOOGLE_VERIFIER="fake")
    google_service._reset_cache()


def _fake(sub: str = "g1", email: str = EMAIL) -> str:
    return f"fake:{sub}:{email}"


def _google(
    client: TestClient, credential: str, profile: dict[str, str] | None = None
) -> httpx.Response:
    body: dict[str, Any] = {"credential": credential}
    if profile is not None:
        body["profile"] = profile
    response: httpx.Response = client.post("/auth/google", json=body)
    return response


def _session_cookie(response: httpx.Response) -> "Morsel[str]":
    jar: SimpleCookie = SimpleCookie()
    for header in response.headers.get_list("set-cookie"):
        jar.load(header)
    return jar["rent_session"]


def _scalar(engine: Engine, sql: str, **params: Any) -> Any:
    with engine.connect() as conn:
        return conn.execute(text(sql), params).scalar()


def _execute(engine: Engine, sql: str, **params: Any) -> None:
    with engine.begin() as conn:
        conn.execute(text(sql), params)


def _count(engine: Engine, table: str) -> int:
    return int(_scalar(engine, f"SELECT count(*) FROM {table}"))


def _make_user(engine: Engine, email: str, google_sub: str | None = None) -> str:
    with engine.begin() as conn:
        return str(
            conn.execute(
                text(
                    "INSERT INTO users (email, display_name, role, google_sub)"
                    " VALUES (:e, 'דנה', 'seeker', :s) RETURNING id"
                ),
                {"e": email, "s": google_sub},
            ).scalar_one()
        )


def test_ac1_new_account(client: TestClient, db_engine: Engine) -> None:
    response = _google(client, _fake(), PROFILE)

    assert response.status_code == 201, response.text
    cookie = _session_cookie(response)
    assert cookie.value
    assert cookie["httponly"] is True
    assert cookie["samesite"].lower() == "lax"
    assert cookie["max-age"] == "2592000"
    assert cookie["path"] == "/"
    assert not cookie["secure"]
    with db_engine.connect() as conn:
        row = conn.execute(
            text("SELECT id, email, display_name, role, google_sub, last_login_at FROM users")
        ).one()
    assert (row.email, row.display_name, row.role, row.google_sub) == (EMAIL, "נועה", "owner", "g1")
    assert row.last_login_at is not None
    body = response.json()
    assert body["id"] == str(row.id)
    assert (body["email"], body["has_password"]) == (EMAIL, False)
    assert client.get("/me").json() == body


def test_ac2_profile_required_then_created(client: TestClient, db_engine: Engine) -> None:
    response = _google(client, _fake())

    assert (response.status_code, response.json()) == (422, {"detail": "profile_required"})
    assert "set-cookie" not in response.headers
    assert _count(db_engine, "users") == 0

    response = _google(client, _fake(), PROFILE)
    assert response.status_code == 201
    assert _count(db_engine, "users") == 1


def test_ac3_links_existing_account(client: TestClient, outbox: Outbox, db_engine: Engine) -> None:
    signup(client, outbox, EMAIL, "seeker")
    user_id = str(_scalar(db_engine, "SELECT id FROM users"))

    first = _google(client, _fake("g1", "Noa@Example.com"), PROFILE)

    assert first.status_code == 200, first.text
    assert first.json()["id"] == user_id
    assert first.json()["role"] == "seeker"  # the profile is ignored for an existing account
    assert _scalar(db_engine, "SELECT google_sub FROM users") == "g1"

    again = _google(client, _fake("g1", "renamed@example.com"))
    assert again.status_code == 200
    assert again.json()["id"] == user_id
    assert _scalar(db_engine, "SELECT email FROM users") == EMAIL
    assert _count(db_engine, "users") == 1


def test_ac4_sub_wins_over_email(client: TestClient, db_engine: Engine) -> None:
    linked = _make_user(db_engine, EMAIL, "g1")
    other = _make_user(db_engine, "dan@example.com")

    for email in ("new@example.com", "dan@example.com"):
        response = _google(client, _fake("g1", email))
        assert response.status_code == 200, response.text
        assert response.json()["id"] == linked

    assert _scalar(db_engine, "SELECT email FROM users WHERE id = :i", i=linked) == EMAIL
    with db_engine.connect() as conn:
        row = conn.execute(
            text("SELECT email, google_sub FROM users WHERE id = :i"), {"i": other}
        ).one()
    assert (row.email, row.google_sub) == ("dan@example.com", None)


def test_ac5_conflicting_sub(client: TestClient, db_engine: Engine) -> None:
    _make_user(db_engine, EMAIL, "g1")

    response = _google(client, _fake("g2", EMAIL), PROFILE)

    assert (response.status_code, response.json()) == (409, {"detail": "google_account_conflict"})
    assert "set-cookie" not in response.headers
    assert _scalar(db_engine, "SELECT google_sub FROM users") == "g1"
    assert _count(db_engine, "sessions") == 0
    assert _count(db_engine, "users") == 1


# --- The `google` backend -------------------------------------------------------------------


def _rsa_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _public_pem(key: rsa.RSAPrivateKey) -> str:
    return (
        key.public_key()
        .public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.PKCS1)
        .decode()
    )


def _private_pem(key: rsa.RSAPrivateKey) -> str:
    return key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.TraditionalOpenSSL,
        serialization.NoEncryption(),
    ).decode()


KEY = _rsa_key()
OTHER_KEY = _rsa_key()


def _claims(**overrides: Any) -> dict[str, Any]:
    now = int(time.time())
    claims: dict[str, Any] = {
        "iss": "https://accounts.google.com",
        "aud": CLIENT_ID,
        "sub": "g-real",
        "email": EMAIL,
        "email_verified": True,
        "name": "נועה כהן",
        "iat": now,
        "exp": now + 3600,
    }
    claims.update(overrides)
    return {k: v for k, v in claims.items() if v is not None}


def _token(
    claims: dict[str, Any] | None = None, key: rsa.RSAPrivateKey = KEY, kid: str = "k1"
) -> str:
    # google-auth is unannotated
    signer = crypt.RSASigner.from_string(_private_pem(key), key_id=kid)  # type: ignore[no-untyped-call]
    token: bytes = jwt.encode(signer, claims if claims is not None else _claims())  # type: ignore[no-untyped-call]
    return token.decode()


@pytest.fixture
def google_backend(
    fake_verifier: None, set_env: Callable[..., None], monkeypatch: pytest.MonkeyPatch
) -> None:
    """After `fake_verifier` (the module's default), so this one wins."""
    set_env(GOOGLE_VERIFIER="google", GOOGLE_CLIENT_ID=CLIENT_ID)
    monkeypatch.setattr(google_service, "_google_certs", lambda: {"k1": _public_pem(KEY)})


@pytest.mark.usefixtures("google_backend")
def test_ac6_valid_google_token(client: TestClient, db_engine: Engine) -> None:
    response = _google(client, _token(), PROFILE)

    assert response.status_code == 201, response.text
    assert _scalar(db_engine, "SELECT google_sub FROM users") == "g-real"
    assert _google(client, _token(_claims(iss="accounts.google.com"))).status_code == 200


@pytest.mark.usefixtures("google_backend")
@pytest.mark.parametrize(
    "credential",
    [
        pytest.param(lambda: _token(_claims(email_verified=False)), id="email-not-verified"),
        pytest.param(lambda: _token(_claims(email_verified=None)), id="email-verified-missing"),
        pytest.param(lambda: _token(_claims(email_verified="true")), id="email-verified-string"),
        pytest.param(lambda: _token(key=OTHER_KEY), id="other-key"),
        pytest.param(lambda: _token(kid="k2"), id="unknown-kid"),
        pytest.param(lambda: _token(_claims(aud="other-client")), id="other-aud"),
        pytest.param(lambda: _token(_claims(iss="https://evil.example")), id="other-iss"),
        pytest.param(
            lambda: _token(_claims(iat=int(time.time()) - 3700, exp=int(time.time()) - 60)),
            id="expired",
        ),
        pytest.param(lambda: _token(_claims(iat=None)), id="no-iat"),
        pytest.param(lambda: _token(_claims(sub="")), id="empty-sub"),
        pytest.param(lambda: _fake(), id="fake-string"),
        pytest.param(lambda: "garbage", id="garbage"),
        pytest.param(lambda: "a.b.c", id="three-garbage-segments"),
    ],
)
def test_ac6_rejects_bad_tokens(
    client: TestClient, db_engine: Engine, credential: Callable[[], str]
) -> None:
    response = _google(client, credential(), PROFILE)

    assert (response.status_code, response.json()) == (401, INVALID)
    assert "set-cookie" not in response.headers
    assert _count(db_engine, "users") == 0


def test_ac7_suspended_and_blocked(client: TestClient, db_engine: Engine) -> None:
    by_sub = _make_user(db_engine, "sub@example.com", "g1")
    by_email = _make_user(db_engine, EMAIL)
    _execute(db_engine, "UPDATE users SET suspended_at = now()")

    for credential in (_fake("g1", "sub@example.com"), _fake("g9", EMAIL)):
        response = _google(client, credential, PROFILE)
        assert (response.status_code, response.json()) == (403, {"detail": "account_suspended"})
        assert "set-cookie" not in response.headers
    assert _scalar(db_engine, "SELECT google_sub FROM users WHERE id = :i", i=by_email) is None
    assert _scalar(db_engine, "SELECT google_sub FROM users WHERE id = :i", i=by_sub) == "g1"
    assert _scalar(db_engine, "SELECT count(*) FROM users WHERE last_login_at IS NOT NULL") == 0
    assert _count(db_engine, "sessions") == 0

    blocked = "blocked@example.com"
    _execute(
        db_engine,
        "INSERT INTO blocked_emails (email_hmac) VALUES (:h)",
        h=accounts.email_hmac(blocked),
    )
    for profile in (PROFILE, None):
        response = _google(client, _fake("g3", "Blocked@Example.com"), profile)
        assert (response.status_code, response.json()) == (403, {"detail": "signup_blocked"})
    assert _count(db_engine, "users") == 2


def test_ac8_deleted_account(
    client: TestClient, db_engine: Engine, photo_store: FilePhotoStore
) -> None:
    first = _google(client, _fake(), PROFILE)
    assert first.status_code == 201
    assert client.delete("/me").status_code == 204

    assert _google(client, _fake()).json() == {"detail": "profile_required"}
    again = _google(client, _fake(), PROFILE)

    assert again.status_code == 201
    assert again.json()["id"] != first.json()["id"]
    with db_engine.connect() as conn:
        tomb = conn.execute(
            text("SELECT email, google_sub, deleted_at FROM users WHERE id = :i"),
            {"i": first.json()["id"]},
        ).one()
    assert (tomb.email, tomb.google_sub) == (None, None)
    assert tomb.deleted_at is not None

    # Deleted again, now with the email blocked: no third account.
    assert client.delete("/me").status_code == 204
    _execute(
        db_engine,
        "INSERT INTO blocked_emails (email_hmac) VALUES (:h)",
        h=accounts.email_hmac(EMAIL),
    )
    response = _google(client, _fake(), PROFILE)
    assert (response.status_code, response.json()) == (403, {"detail": "signup_blocked"})
    assert _count(db_engine, "users") == 2


def test_ac9_race(db_engine: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    both_checked = threading.Barrier(2, timeout=10)
    waited: set[int] = set()
    real_find_user = auth_service._find_user

    def find_user_in_step(db: Any, email: str) -> User | None:
        user = real_find_user(db, email)
        if threading.get_ident() not in waited:  # only the first lookup of each sign-in
            waited.add(threading.get_ident())
            both_checked.wait()
        return user

    monkeypatch.setattr(auth_service, "_find_user", find_user_in_step)
    profile = GoogleProfileIn(display_name="נועה", role="owner")
    created: list[bool] = []

    def sign_in() -> None:
        with get_sessionmaker()() as db:
            _user, was_created = auth_service.google_login(
                db, get_redis(), _fake(), profile, "203.0.113.9"
            )
            created.append(was_created)

    threads = [threading.Thread(target=sign_in) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=15)

    assert sorted(created) == [False, True]
    assert _count(db_engine, "users") == 1


def test_ac11_rate_limit(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []
    real_verify = google_service.verify_credential

    def spy(credential: str) -> google_service.GoogleIdentity:
        calls.append(credential)
        return real_verify(credential)

    monkeypatch.setattr(google_service, "verify_credential", spy)

    for _ in range(auth_service.GOOGLE_RATE_LIMIT_IP):
        assert _google(client, "not-a-token").status_code == 401

    refused = _google(client, _fake(), PROFILE)
    assert (refused.status_code, refused.json()) == (429, {"detail": "rate_limited"})
    assert 0 < int(refused.headers["retry-after"]) <= auth_service.OTP_RATE_WINDOW_S
    assert len(calls) == auth_service.GOOGLE_RATE_LIMIT_IP


def test_ac15_keys_cached_and_fetch_failure_is_503(
    client: TestClient,
    db_engine: Engine,
    set_env: Callable[..., None],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    set_env(GOOGLE_VERIFIER="off")
    response = _google(client, _fake(), PROFILE)
    assert (response.status_code, response.json()) == (503, {"detail": "google_unavailable"})

    set_env(GOOGLE_VERIFIER="google", GOOGLE_CLIENT_ID=CLIENT_ID)
    fetches: list[str] = []

    def timing_out(url: str, timeout: float) -> httpx.Response:
        fetches.append(url)
        raise httpx.ConnectTimeout("timed out")

    def failing(url: str, timeout: float) -> httpx.Response:
        fetches.append(url)
        return httpx.Response(500, text="oops")

    def serving(url: str, timeout: float) -> httpx.Response:
        assert timeout == 5.0
        fetches.append(url)
        return httpx.Response(
            200,
            json={"k1": _public_pem(KEY)},
            headers={"cache-control": "public, max-age=600, must-revalidate"},
        )

    for fetch in (timing_out, failing):
        monkeypatch.setattr(httpx, "get", fetch)
        response = _google(client, _token(), PROFILE)
        assert (response.status_code, response.json()) == (503, {"detail": "google_unavailable"})
    assert _count(db_engine, "users") == 0
    assert fetches == [google_service.CERTS_URL] * 2  # a failure caches nothing

    fetches.clear()
    monkeypatch.setattr(httpx, "get", serving)
    assert _google(client, _token(), PROFILE).status_code == 201
    assert _google(client, _token()).status_code == 200
    assert len(fetches) == 1
    assert 590 < google_service._certs_expire_at - time.monotonic() <= 600

    monkeypatch.setattr(google_service, "_certs_expire_at", time.monotonic() - 1)  # max-age over
    assert _google(client, _token()).status_code == 200
    assert len(fetches) == 2


def test_nf1_credential_not_logged(
    client: TestClient,
    db_engine: Engine,
    caplog: pytest.LogCaptureFixture,
    set_env: Callable[..., None],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _make_user(db_engine, "linked@example.com", "g-other")
    credentials: list[str] = []
    responses: list[httpx.Response] = []

    def call(credential: str, profile: dict[str, str] | None = None) -> int:
        credentials.append(credential)
        responses.append(_google(client, credential, profile))
        return responses[-1].status_code

    with caplog.at_level(logging.DEBUG):
        assert call(_fake("nf1", "nf1@example.com")) == 422
        assert call(_fake("nf1", "nf1@example.com"), PROFILE) == 201
        assert call(_fake("nf1", "nf1@example.com")) == 200
        assert call(_fake("nf1-b", "linked@example.com")) == 409
        assert call("x" * 4097) == 422
        set_env(GOOGLE_VERIFIER="google", GOOGLE_CLIENT_ID=CLIENT_ID)
        monkeypatch.setattr(google_service, "_google_certs", lambda: {"k1": _public_pem(KEY)})
        assert call(_token(key=OTHER_KEY)) == 401
        assert call(_token(_claims(aud="other-client"))) == 401
        set_env(GOOGLE_VERIFIER="off")
        assert call(_token()) == 503

    assert caplog.records  # logging was captured at all
    for credential in credentials:
        assert credential not in caplog.text
        for response in responses:
            assert credential not in response.text
    for token in credentials[5:]:  # nor any segment of a real token
        for segment in token.split("."):
            assert segment not in caplog.text
