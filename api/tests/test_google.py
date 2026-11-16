"""Google sign-in (spec 0016b): POST /auth/google with the fake verifier, and the `google` backend
against a key generated here (its certs served by a monkeypatched fetch: nothing reaches Google)."""

import base64
import datetime as dt
import hashlib
import hmac
import json
import logging
import threading
import time
from collections.abc import Callable
from http.cookies import Morsel, SimpleCookie
from typing import Any

import httpx
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from fastapi.testclient import TestClient
from google.auth import crypt, jwt
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session

from app import client_ip
from app.db import get_sessionmaker
from app.models import User
from app.redis_client import get_redis
from app.schemas.auth import GoogleProfileIn
from app.services import accounts
from app.services import auth as auth_service
from app.services import google as google_service
from app.services.photo_store import FilePhotoStore
from app.services.rate_limit import RateLimitedError
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


def _after_lookup(monkeypatch: pytest.MonkeyPatch, engine: Engine, sql: str, **params: Any) -> None:
    """Run `sql` in another transaction right after `_find_user` looked the email up: a
    concurrent request that committed between the lookup and the link."""
    real_find_user = auth_service._find_user

    def find_user_racing(db: Session, email: str) -> User | None:
        user = real_find_user(db, email)
        _execute(engine, sql, **params)
        return user

    monkeypatch.setattr(auth_service, "_find_user", find_user_racing)


def test_ac5_link_loses_to_another_account_taking_the_sub(
    client: TestClient, db_engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = _make_user(db_engine, EMAIL)
    other = _make_user(db_engine, "dan@example.com")
    _after_lookup(
        monkeypatch, db_engine, "UPDATE users SET google_sub = 'g1' WHERE id = :i", i=other
    )

    response = _google(client, _fake("g1", EMAIL))

    # The link's UPDATE hits `uq_users_google_sub`.
    assert (response.status_code, response.json()) == (409, {"detail": "google_account_conflict"})
    assert _scalar(db_engine, "SELECT google_sub FROM users WHERE id = :i", i=user) is None
    assert _count(db_engine, "sessions") == 0


def test_ac5_link_loses_to_a_concurrent_link_of_another_sub(
    client: TestClient, db_engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = _make_user(db_engine, EMAIL)
    _after_lookup(
        monkeypatch, db_engine, "UPDATE users SET google_sub = 'g2' WHERE id = :i", i=user
    )

    response = _google(client, _fake("g1", EMAIL))

    # The conditional UPDATE matches no row; the re-read shows the other sub.
    assert (response.status_code, response.json()) == (409, {"detail": "google_account_conflict"})
    assert _scalar(db_engine, "SELECT google_sub FROM users WHERE id = :i", i=user) == "g2"
    assert _count(db_engine, "sessions") == 0


# --- The `google` backend -------------------------------------------------------------------


def _rsa_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _cert_pem(key: rsa.RSAPrivateKey) -> str:
    """`key`'s public half as a self-signed X.509 certificate, the form Google publishes."""
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "test.googleapis.example")])
    now = dt.datetime.now(dt.UTC)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(days=1))
        .not_valid_after(now + dt.timedelta(days=1))
        .sign(key, hashes.SHA256())
    )
    return cert.public_bytes(serialization.Encoding.PEM).decode()


def _private_pem(key: rsa.RSAPrivateKey) -> str:
    return key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.TraditionalOpenSSL,
        serialization.NoEncryption(),
    ).decode()


KEY = _rsa_key()
OTHER_KEY = _rsa_key()
KEY_CERT = _cert_pem(KEY)


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
    claims: dict[str, Any] | None = None, key: rsa.RSAPrivateKey = KEY, kid: str | None = "k1"
) -> str:
    # google-auth is unannotated
    signer = crypt.RSASigner.from_string(_private_pem(key), key_id=kid)  # type: ignore[no-untyped-call]
    token: bytes = jwt.encode(signer, claims if claims is not None else _claims())  # type: ignore[no-untyped-call]
    return token.decode()


def _b64(data: dict[str, Any]) -> str:
    return base64.urlsafe_b64encode(json.dumps(data).encode()).rstrip(b"=").decode()


def _alg_none() -> str:
    return f"{_b64({'alg': 'none', 'typ': 'JWT', 'kid': 'k1'})}.{_b64(_claims())}."


def _hs256_with_the_cert_as_secret() -> str:
    """The algorithm-confusion attack: an HMAC keyed with the public certificate."""
    signed = f"{_b64({'alg': 'HS256', 'typ': 'JWT', 'kid': 'k1'})}.{_b64(_claims())}"
    mac = hmac.new(KEY_CERT.encode(), signed.encode(), hashlib.sha256).digest()
    return f"{signed}.{base64.urlsafe_b64encode(mac).rstrip(b'=').decode()}"


@pytest.fixture
def google_backend(
    fake_verifier: None, set_env: Callable[..., None], monkeypatch: pytest.MonkeyPatch
) -> None:
    """After `fake_verifier` (the module's default), so this one wins."""
    set_env(GOOGLE_VERIFIER="google", GOOGLE_CLIENT_ID=CLIENT_ID)
    monkeypatch.setattr(google_service, "_google_certs", lambda: {"k1": KEY_CERT})


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
        pytest.param(lambda: _token(kid=None), id="no-kid"),
        pytest.param(_alg_none, id="alg-none"),
        pytest.param(_hs256_with_the_cert_as_secret, id="hs256"),
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


def test_ac11_day_limit_and_ipv6_keys() -> None:
    r = get_redis()
    net, p48 = "2001:db8:1:2::/64", "2001:db8:1::/48"
    auth_service._count_google(r, net)

    ttls = {key.decode(): r.ttl(key) for key in r.scan_iter(match="rl:google:*")}
    assert set(ttls) == {
        f"rl:google:ip:{net}",
        f"rl:google:ip:day:{net}",
        f"rl:google:ip48:{p48}",
        f"rl:google:ip48:day:{p48}",
    }
    assert 0 < ttls[f"rl:google:ip:{net}"] <= auth_service.OTP_RATE_WINDOW_S
    assert ttls[f"rl:google:ip:day:{net}"] > auth_service.OTP_RATE_WINDOW_S

    # The daily cap, with the 15-minute window still open: the 301st of the day is refused.
    r.set(f"rl:google:ip:day:{net}", auth_service.GOOGLE_RATE_LIMIT_IP_DAY, keepttl=True)
    with pytest.raises(RateLimitedError) as refused:
        auth_service._count_google(r, net)
    assert refused.value.retry_after > auth_service.OTP_RATE_WINDOW_S

    # A /48 at its limit refuses another /64 inside it, and nothing else.
    limit48 = client_ip.PREFIX48_FACTOR * auth_service.GOOGLE_RATE_LIMIT_IP
    r.set(f"rl:google:ip48:{p48}", limit48, keepttl=True)
    with pytest.raises(RateLimitedError):
        auth_service._count_google(r, "2001:db8:1:3::/64")
    assert r.exists("rl:google:ip:2001:db8:1:3::/64") == 0
    auth_service._count_google(r, "2001:db8:2:1::/64")


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
            json={"k1": KEY_CERT},
            headers={"cache-control": "public, max-age=600, must-revalidate"},
        )

    unavailable = (503, {"detail": "google_unavailable"})
    for fetch in (timing_out, failing):
        google_service._reset_cache()  # each its own outage, no retry pause left over
        monkeypatch.setattr(httpx, "get", fetch)
        response = _google(client, _token(), PROFILE)
        assert (response.status_code, response.json()) == unavailable
    assert fetches == [google_service.CERTS_URL] * 2  # a failure caches no keys
    # Within the retry pause: 503 at once, no new fetch.
    response = _google(client, _token(), PROFILE)
    assert (response.status_code, response.json()) == unavailable
    assert len(fetches) == 2
    assert _count(db_engine, "users") == 0

    google_service._reset_cache()
    fetches.clear()
    monkeypatch.setattr(httpx, "get", serving)
    assert _google(client, _token(), PROFILE).status_code == 201
    assert _google(client, _token()).status_code == 200
    assert len(fetches) == 1
    assert 590 < google_service._certs_expire_at - time.monotonic() <= 600

    monkeypatch.setattr(google_service, "_certs_expire_at", time.monotonic() - 1)  # max-age over
    assert _google(client, _token()).status_code == 200
    assert len(fetches) == 2

    # Max-age over and Google down: the expired keys still serve, with one fetch per pause.
    monkeypatch.setattr(google_service, "_certs_expire_at", time.monotonic() - 1)
    monkeypatch.setattr(httpx, "get", timing_out)
    assert _google(client, _token()).status_code == 200
    assert _google(client, _token()).status_code == 200
    assert len(fetches) == 3
    # More than an hour past expiry: no stale keys any more.
    monkeypatch.setattr(google_service, "_certs_expire_at", time.monotonic() - 3601)
    monkeypatch.setattr(google_service, "_retry_at", 0.0)
    response = _google(client, _token())
    assert (response.status_code, response.json()) == unavailable
    assert len(fetches) == 4


def test_ac15_outage_fetches_once_for_concurrent_callers(
    set_env: Callable[..., None], monkeypatch: pytest.MonkeyPatch
) -> None:
    set_env(GOOGLE_VERIFIER="google", GOOGLE_CLIENT_ID=CLIENT_ID)
    fetches: list[str] = []

    def slow_failure(url: str, timeout: float) -> httpx.Response:
        fetches.append(url)
        time.sleep(0.5)
        raise httpx.ConnectTimeout("timed out")

    monkeypatch.setattr(httpx, "get", slow_failure)
    start = threading.Barrier(3, timeout=10)
    waits: list[float] = []

    def verify() -> None:
        start.wait()
        began = time.monotonic()
        with pytest.raises(google_service.GoogleUnavailable):
            google_service.verify_credential(_token())
        waits.append(time.monotonic() - began)

    threads = [threading.Thread(target=verify) for _ in range(3)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=15)

    assert len(waits) == 3
    assert fetches == [google_service.CERTS_URL]  # the waiters did not fetch again
    assert max(waits) < 1.0  # one 0.5 s fetch, not three in a row


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
        monkeypatch.setattr(google_service, "_google_certs", lambda: {"k1": KEY_CERT})
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
