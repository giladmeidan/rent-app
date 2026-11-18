"""Security emails (spec 0022a): the password and deletion mails, their cap, and what they and the
logs must not hold. AC10 is in `test_config.py`, AC5's race in `test_account_deletion.py`."""

import datetime as dt
import logging
import re
import uuid
from collections.abc import Callable, Sequence
from typing import Any, cast

import pytest
import redis
from argon2 import PasswordHasher
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session

from app import limits
from app.config import get_settings
from app.i18n import he
from app.models import User
from app.redis_client import get_redis
from app.services import accounts, passwords, security_mail, tour_mail, tours
from app.services import auth as auth_service
from app.services import google as google_service
from app.services.email import Attachment, EmailSender, EmailUnavailable, get_email_sender
from app.services.photo_store import FilePhotoStore
from tests.conftest import Outbox, make_listing, make_owner, signup
from tests.test_account_deletion import _session
from tests.test_password import _execute, _login, _scalar, _signup
from tests.test_tours import db_now, make_tour, shortlisted

pytestmark = pytest.mark.usefixtures("redis_clean")

EMAIL = "noa@example.com"
PASSWORD = "correct horse battery"
OTHER_PASSWORD = "another long password"
SECURITY_SUBJECTS = {he.SECURITY_PASSWORD_SUBJECT, he.SECURITY_DELETED_SUBJECT}


@pytest.fixture
def contact(set_env: Callable[..., None]) -> str:
    """A real address: the Makefile's `export CONTACT_EMAIL` can leave the setting empty."""
    set_env(CONTACT_EMAIL="help@rent.example")
    return get_settings().contact_email


def _security(outbox: Outbox) -> list[tuple[str, str, str]]:
    return [message for message in outbox.messages if message[1] in SECURITY_SUBJECTS]


def _user_id(caller: TestClient) -> uuid.UUID:
    return uuid.UUID(caller.get("/me").json()["id"])


def _use_sender(client: TestClient, sender: EmailSender) -> None:
    """Replace the `outbox` fixture's sender (which removes the override afterwards)."""
    cast(FastAPI, client.app).dependency_overrides[get_email_sender] = lambda: sender


def _change_password(caller: TestClient, password: str = PASSWORD) -> None:
    assert caller.put("/me/password", json={"password": password}).status_code == 204


def _counter(kind: str) -> str:
    return f"rl:security_mail:{kind}:{accounts.email_hmac(EMAIL)}"


def _redis_down(*_: Any) -> None:
    raise redis.ConnectionError("redis down")


def _google_signup(client: TestClient) -> TestClient:
    """A new account of `EMAIL` with no code to request (the OTP limits would stop a loop)."""
    response = client.post(
        "/auth/google",
        json={
            "credential": f"fake:g1:{EMAIL}",
            "profile": {"display_name": "נועה", "role": "seeker"},
        },
    )
    assert response.status_code == 201, response.text
    client.cookies.clear()
    return TestClient(client.app, cookies={"rent_session": response.cookies["rent_session"]})


def test_ac1_password_set_and_change_mail_owner(
    client: TestClient, outbox: Outbox, contact: str
) -> None:
    me = signup(client, outbox, EMAIL, "seeker")

    _change_password(me)  # the first password
    assert len(_security(outbox)) == 1
    _change_password(me, OTHER_PASSWORD)  # replacing it

    mails = _security(outbox)
    assert len(mails) == 2
    for to, subject, body in mails:
        assert (to, subject) == (EMAIL, he.SECURITY_PASSWORD_SUBJECT)
        lines = body.splitlines()
        assert f"{get_settings().web_origin}/login" in lines  # alone on its line (bidi)
        assert contact in lines


def test_ac2_signup_and_rehash_send_nothing(
    client: TestClient, outbox: Outbox, db_engine: Engine
) -> None:
    _signup(client, outbox)
    weaker = PasswordHasher(time_cost=1, memory_cost=8192, parallelism=1).hash(PASSWORD)
    _execute(db_engine, "UPDATE user_passwords SET hash = :h", h=weaker)

    assert _login(client, PASSWORD).status_code == 200

    assert _scalar(db_engine, "SELECT hash FROM user_passwords") != weaker  # it did rehash
    assert _security(outbox) == []


def test_ac3_deletion_mail_goes_after_the_commit(
    client: TestClient, outbox: Outbox, db_engine: Engine, contact: str
) -> None:
    me = signup(client, outbox, EMAIL, "seeker")
    user_id = _user_id(me)
    rows_at_send: list[Any] = []

    class ReadsTheRow(Outbox):
        def send(
            self, to: str, subject: str, body: str, attachments: Sequence[Attachment] = ()
        ) -> None:
            with db_engine.connect() as conn:  # its own connection: committed data only
                rows_at_send.append(
                    conn.execute(
                        text("SELECT email, deleted_at FROM users WHERE id = :id"), {"id": user_id}
                    ).one()
                )
            super().send(to, subject, body, attachments)

    sender = ReadsTheRow()
    _use_sender(client, sender)

    assert me.delete("/me").status_code == 204

    assert [(to, subject) for to, subject, _ in sender.messages] == [
        (EMAIL, he.SECURITY_DELETED_SUBJECT)
    ]
    assert sender.messages[0][2].splitlines()[-1] == contact
    ((email, deleted_at),) = rows_at_send
    assert email is None and deleted_at is not None


@pytest.mark.parametrize("error", [EmailUnavailable, RuntimeError])
def test_ac4_mail_failure_changes_nothing(
    client: TestClient,
    outbox: Outbox,
    db_engine: Engine,
    caplog: pytest.LogCaptureFixture,
    error: type[Exception],
) -> None:
    me = signup(client, outbox, EMAIL, "seeker")
    user_id = _user_id(me)

    class Failing(Outbox):
        def send(
            self, to: str, subject: str, body: str, attachments: Sequence[Attachment] = ()
        ) -> None:
            raise error(f"DETAIL-MARK {to}")

    _use_sender(client, Failing())
    caplog.clear()

    _change_password(me)
    assert _scalar(db_engine, "SELECT count(*) FROM user_passwords") == 1
    assert me.delete("/me").status_code == 204
    assert (
        _scalar(db_engine, "SELECT deleted_at IS NOT NULL FROM users WHERE id = :i", i=user_id)
        is True
    )

    failures = [r.getMessage() for r in caplog.records if r.name == security_mail.__name__]
    assert failures == [f"security mail failed: {error.__name__}"] * 2
    assert "DETAIL-MARK" not in caplog.text


def test_ac5_tombstone_returns_none(
    client: TestClient, outbox: Outbox, db_engine: Engine, photo_store: FilePhotoStore
) -> None:
    me = signup(client, outbox, EMAIL, "seeker")
    user_id = _user_id(me)
    assert me.delete("/me").status_code == 204

    with Session(db_engine) as db:
        tombstone = db.get(User, user_id)
        assert tombstone is not None
        assert accounts.delete_account(db, photo_store, tombstone) is None
    assert len(_security(outbox)) == 1


def test_ac6_failed_change_sends_nothing(
    client: TestClient,
    outbox: Outbox,
    db_engine: Engine,
    photo_store: FilePhotoStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    me = signup(client, outbox, EMAIL, "seeker")
    user_id = _user_id(me)
    body = {"password": PASSWORD}

    old = _session(client, db_engine, user_id, age_s=16 * 60)
    assert old.put("/me/password", json=body).status_code == 403
    assert me.put("/me/password", json={"password": "short"}).status_code == 422
    hour_key = f"rl:{limits.WRITE.name}:user:{user_id}"
    get_redis().set(hour_key, limits.WRITE.per_hour, ex=3600)
    assert me.put("/me/password", json=body).status_code == 429
    get_redis().delete(hour_key)

    real_hash = passwords.hash_password

    def deleted_meanwhile(raw: str) -> str:  # `set_password` hashes before it takes the lock
        with Session(db_engine) as db:
            user = db.get(User, user_id)
            assert user is not None
            accounts.delete_account(db, photo_store, user)
        return real_hash(raw)

    monkeypatch.setattr(passwords, "hash_password", deleted_meanwhile)
    assert me.put("/me/password", json=body).status_code == 401

    assert _security(outbox) == []


def test_ac7_password_mail_cap(
    client: TestClient, outbox: Outbox, monkeypatch: pytest.MonkeyPatch
) -> None:
    me = signup(client, outbox, EMAIL, "seeker")
    limit = security_mail.PASSWORD_MAIL_LIMIT

    for sent in range(1, limit + 1):
        _change_password(me)
        assert len(_security(outbox)) == sent
    _change_password(me)  # over the cap: the change works, the mail stays home
    assert len(_security(outbox)) == limit
    ttl = get_redis().ttl(_counter("password"))
    assert 0 < ttl <= security_mail.PASSWORD_MAIL_WINDOW_S

    monkeypatch.setattr(security_mail, "count_or_raise", _redis_down)
    _change_password(me)
    assert len(_security(outbox)) == limit + 1  # a security notice outranks the cap


def test_ac8_no_secret_or_pii_in_mail_or_logs(
    client: TestClient, outbox: Outbox, caplog: pytest.LogCaptureFixture
) -> None:
    name = "NAME-MARK"
    me = signup(client, outbox, EMAIL, "seeker", display_name=name)
    token = me.cookies["rent_session"]
    caplog.clear()
    caplog.set_level(logging.DEBUG)

    _change_password(me)
    assert me.delete("/me").status_code == 204

    mails = _security(outbox)
    assert [subject for _, subject, _ in mails] == [
        he.SECURITY_PASSWORD_SUBJECT,
        he.SECURITY_DELETED_SUBJECT,
    ]
    for _, subject, body in mails:
        text_of_mail = f"{subject}\n{body}"
        for secret in (PASSWORD, token, name, EMAIL):
            assert secret not in text_of_mail
        assert re.search(r"\b\d{6}\b", text_of_mail) is None  # e2e would read it as a login code
    assert not any(EMAIL in record.getMessage() for record in caplog.records)
    assert EMAIL not in repr(accounts.DeletedAccount(email=EMAIL, changes=[]))


def test_ac9_no_address_left_behind(
    client: TestClient, outbox: Outbox, db_engine: Engine, gush_dan: uuid.UUID
) -> None:
    me = signup(client, outbox, EMAIL, "seeker")
    seeker_id = _user_id(me)
    owner_id = make_owner(db_engine, "owner@example.com")
    listing_id = make_listing(db_engine, owner_id, gush_dan)
    application_id = shortlisted(db_engine, listing_id, seeker_id, owner_id)
    starts_at = db_now(db_engine) + dt.timedelta(hours=3)
    make_tour(db_engine, listing_id, application_id, seeker_id, starts_at)  # deletion cancels it
    _change_password(me)
    r = get_redis()
    assert client.post("/auth/otp/request", json={"email": EMAIL}).status_code == 204
    assert r.exists(auth_service.otp_key(EMAIL))  # a login code still pending

    assert me.delete("/me").status_code == 204
    assert [to for to, _, _ in _security(outbox)] == [EMAIL, EMAIL]

    address = EMAIL.encode()
    assert _scalar(db_engine, "SELECT count(*) FROM users WHERE email = :e", e=EMAIL) == 0
    assert not [k for k in r.scan_iter() if address in k and not k.startswith(b"rl:")]
    queued = r.lrange(tour_mail.QUEUE_KEY, 0, -1)
    assert queued
    assert not [v for v in queued if address in v]
    counters = set(r.scan_iter(match="rl:security_mail:*"))
    assert counters == {_counter("password").encode(), _counter("deleted").encode()}
    assert not [k for k in counters if address in k or address in (r.get(k) or b"")]


def test_ac15_limits_survive_delete_and_signup_again(
    client: TestClient,
    outbox: Outbox,
    set_env: Callable[..., None],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    set_env(GOOGLE_VERIFIER="fake")
    google_service._reset_cache()
    announced: list[Any] = []
    real_announce = tours.announce

    def counting_announce(r: Any, changes: Any) -> None:
        announced.append(changes)
        real_announce(r, changes)

    monkeypatch.setattr(tours, "announce", counting_announce)
    cycles = security_mail.DELETED_MAIL_LIMIT + 1

    for cycle in range(cycles):
        me = _google_signup(client)
        _change_password(me, f"{PASSWORD} {cycle} a")
        _change_password(me, f"{PASSWORD} {cycle} b")
        assert me.delete("/me").status_code == 204

    mails = _security(outbox)
    assert {to for to, _, _ in mails} == {EMAIL}
    subjects = [subject for _, subject, _ in mails]
    assert subjects.count(he.SECURITY_PASSWORD_SUBJECT) == security_mail.PASSWORD_MAIL_LIMIT
    assert subjects.count(he.SECURITY_DELETED_SUBJECT) == security_mail.DELETED_MAIL_LIMIT
    r = get_redis()
    assert 0 < r.ttl(_counter("deleted")) <= security_mail.DELETED_MAIL_WINDOW_S

    # Over the cap only the mail stops: the pending code still goes and the tours are announced.
    me = _google_signup(client)
    assert client.post("/auth/otp/request", json={"email": EMAIL}).status_code == 204
    assert r.exists(auth_service.otp_key(EMAIL))
    assert me.delete("/me").status_code == 204
    assert not r.exists(auth_service.otp_key(EMAIL))
    assert len(announced) == cycles + 1
    assert len(_security(outbox)) == len(mails)


def test_ac15_deletion_limit_fails_open(
    client: TestClient, outbox: Outbox, monkeypatch: pytest.MonkeyPatch
) -> None:
    me = signup(client, outbox, EMAIL, "seeker")
    get_redis().set(_counter("deleted"), security_mail.DELETED_MAIL_LIMIT, ex=60)  # at the cap
    monkeypatch.setattr(security_mail, "count_or_raise", _redis_down)

    assert me.delete("/me").status_code == 204

    assert [subject for _, subject, _ in _security(outbox)] == [he.SECURITY_DELETED_SUBJECT]
