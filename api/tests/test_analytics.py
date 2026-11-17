"""PostHog analytics (spec 0019b): AC1-AC7.

Tests never build a real `posthog.Posthog` client (its SDK sends with `requests`, which the
`no_network` guard does not cover): `fake_posthog` installs a recording fake through
`analytics.set_client`, and `conftest.analytics_reset` removes it after each test. The deletion
job runs against `httpx.MockTransport`."""

import datetime as dt
import functools
import importlib
import json
import logging
import re
import uuid
from collections.abc import Callable, Iterator
from secrets import token_hex
from typing import Any, cast

import httpx
import pytest
from fastapi.testclient import TestClient
from posthog import Posthog
from pydantic import SecretStr
from sqlalchemy import Engine, text

from app import analytics
from app.config import get_settings
from app.db import get_sessionmaker
from app.models import User
from app.services import accounts
from app.services import google as google_service
from app.services.photo_store import FilePhotoStore
from tests.conftest import Outbox, make_listing, make_owner, make_pair, make_profile, signup
from tests.test_listings import _body
from tests.test_tours import _book, _slots_of, db_now, make_window

pytestmark = pytest.mark.usefixtures("redis_clean")

MIN = dt.timedelta(minutes=1)
OWNER_EMAIL = "o@example.com"
SEEKER_EMAIL = "s@example.com"
OWNER_NAME = "נועה"
SEEKER_NAME = "דנה"
MESSAGE = "Hello from the funnel"
PASSWORD = "a long password 123"

Captured = tuple[str, str | None, dict[str, Any]]


class FakePosthog:
    """Stands in for `posthog.Posthog`: every `capture` as (event, distinct_id, properties)."""

    def __init__(self) -> None:
        self.events: list[Captured] = []
        self.fail = False

    def capture(
        self, event: str, *, distinct_id: str | None = None, properties: dict[str, Any]
    ) -> None:
        if self.fail:
            raise RuntimeError("posthog down")
        self.events.append((event, distinct_id, dict(properties)))

    def shutdown(self) -> None:
        pass


@pytest.fixture
def fake_posthog() -> Iterator[FakePosthog]:
    fake = FakePosthog()
    analytics.set_client(cast(Posthog, fake))
    yield fake
    analytics.set_client(None)


@pytest.fixture
def fake_google(set_env: Callable[..., None]) -> Iterator[None]:
    set_env(GOOGLE_VERIFIER="fake")
    google_service._reset_cache()
    yield
    google_service._reset_cache()


def _ok(response: httpx.Response, code: int = 200) -> Any:
    assert response.status_code == code, response.text
    return response.json() if response.content else None


def _code_login(client: TestClient, outbox: Outbox, email: str) -> httpx.Response:
    assert client.post("/auth/otp/request", json={"email": email}).status_code == 204
    code = re.search(r"^[0-9]{6}$", outbox.messages[-1][2], re.M)
    assert code is not None
    response: httpx.Response = client.post(
        "/auth/otp/verify", json={"email": email, "code": code.group()}
    )
    client.cookies.clear()
    return response


def _google(client: TestClient, email: str, profile: dict[str, str] | None) -> httpx.Response:
    body: dict[str, Any] = {"credential": f"fake:g1:{email}"}
    if profile is not None:
        body["profile"] = profile
    response: httpx.Response = client.post("/auth/google", json=body)
    client.cookies.clear()
    return response


class Funnel:
    """The ids and texts AC2's run used, for AC3's checks."""

    def __init__(self, owner_id: uuid.UUID, seeker_id: uuid.UUID, area_id: uuid.UUID) -> None:
        self.owner_id = owner_id
        self.seeker_id = seeker_id
        self.area_id = area_id


def _run_funnel(
    client: TestClient, outbox: Outbox, db_engine: Engine, area_id: uuid.UUID
) -> Funnel:
    """Sign up by code (owner) and Google (seeker); log in by code, password and Google; publish
    an apartment; apply; the owner shortlists; answer a room like by applying; book a tour."""
    owner = signup(client, outbox, OWNER_EMAIL, "owner", display_name=OWNER_NAME)
    owner_id = uuid.UUID(owner.get("/me").json()["id"])
    signed = _ok(
        _google(client, SEEKER_EMAIL, {"display_name": SEEKER_NAME, "role": "seeker"}), 201
    )
    seeker_id = uuid.UUID(signed["id"])
    _ok(_code_login(client, outbox, OWNER_EMAIL))
    _ok(owner.put("/me/password", json={"password": PASSWORD}), 204)
    password = client.post(
        "/auth/password/login", json={"email": OWNER_EMAIL, "password": PASSWORD}
    )
    _ok(password)
    owner = TestClient(client.app, cookies={"rent_session": password.cookies["rent_session"]})
    client.cookies.clear()
    seeker_login = _google(client, SEEKER_EMAIL, None)
    _ok(seeker_login)
    seeker = TestClient(client.app, cookies={"rent_session": seeker_login.cookies["rent_session"]})

    listing = _ok(owner.post("/listings", json=_body(area_id)), 201)["id"]
    make_profile(db_engine, seeker_id, area_id)
    application = _ok(
        seeker.post(f"/listings/{listing}/applications", json={"message": MESSAGE}), 201
    )["id"]
    _ok(
        owner.patch(
            f"/listings/{listing}/applications/{application}", json={"status": "shortlisted"}
        )
    )
    room = make_listing(
        db_engine,
        owner_id,
        area_id,
        listing_type="room",
        flatmates_count=2,
        gender_preference="any",
        price_ils=7000,
    )
    make_pair(db_engine, room, seeker_id, price_ils_seen=7000, lister_liked=True)
    liked = _ok(seeker.post(f"/listings/{room}/applications", json={}), 201)
    assert (liked["status"], liked["source"]) == ("shortlisted", "like")
    base = db_now(db_engine).replace(second=0, microsecond=0)
    make_window(db_engine, uuid.UUID(listing), base + 60 * MIN, base + 180 * MIN, 30)
    _ok(_book(seeker, application, _slots_of(seeker, application)[0]), 201)
    return Funnel(owner_id, seeker_id, area_id)


# --- AC1 ---------------------------------------------------------------------------------------


def test_ac1_off_without_key(
    client: TestClient,
    outbox: Outbox,
    db_engine: Engine,
    gush_dan: uuid.UUID,
    fake_google: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def no_client(*args: Any, **kwargs: Any) -> Posthog:
        raise AssertionError("a PostHog client was built without POSTHOG_KEY")

    monkeypatch.setattr(analytics, "Posthog", no_client)
    _run_funnel(client, outbox, db_engine, gush_dan)
    analytics.track(None, "account_deleted")

    assert analytics._client is None


def test_unit_client_config_and_allowlist(
    set_env: Callable[..., None], monkeypatch: pytest.MonkeyPatch
) -> None:
    """With a key: one lazily built client, EU host, no GeoIP, our failure logger; properties
    outside the event's allowlist are dropped; `shutdown` flushes and resets."""
    built: list[tuple[tuple[Any, ...], dict[str, Any]]] = []
    fake = FakePosthog()
    shut: list[bool] = []
    monkeypatch.setattr(fake, "shutdown", lambda: shut.append(True))

    def factory(*args: Any, **kwargs: Any) -> FakePosthog:
        built.append((args, kwargs))
        return fake

    monkeypatch.setattr(analytics, "Posthog", factory)
    set_env(POSTHOG_KEY="phc_test")
    user = uuid.uuid4()

    analytics.track(user, "logged_in", {"method": "code", "email": "x@example.com"})
    analytics.track(user, "account_deleted", {"role": "owner"})

    assert built == [
        (
            ("phc_test",),
            {
                "host": "https://eu.i.posthog.com",
                "disable_geoip": True,
                "on_error": analytics._log_failure,
                "max_retries": 3,
                "timeout": 5,
            },
        )
    ]
    assert fake.events == [
        ("logged_in", str(user), {"method": "code"}),
        ("account_deleted", str(user), {}),
    ]
    analytics.shutdown()
    assert shut == [True] and analytics._client is None
    assert logging.getLogger("posthog").level == logging.CRITICAL


# --- AC2, AC3 ----------------------------------------------------------------------------------


def test_ac2_funnel_events(
    client: TestClient,
    outbox: Outbox,
    db_engine: Engine,
    gush_dan: uuid.UUID,
    fake_google: None,
    fake_posthog: FakePosthog,
) -> None:
    run = _run_funnel(client, outbox, db_engine, gush_dan)
    owner, seeker = str(run.owner_id), str(run.seeker_id)

    assert fake_posthog.events == [
        ("signed_up", owner, {"role": "owner", "method": "code"}),
        ("signed_up", seeker, {"role": "seeker", "method": "google"}),
        ("logged_in", owner, {"method": "code"}),
        ("logged_in", owner, {"method": "password"}),
        ("logged_in", seeker, {"method": "google"}),
        ("listing_published", owner, {"listing_type": "apartment", "area_id": str(gush_dan)}),
        ("application_sent", seeker, {"listing_type": "apartment"}),
        ("application_shortlisted", seeker, {"listing_type": "apartment", "source": "apply"}),
        ("application_sent", seeker, {"listing_type": "room"}),
        ("application_shortlisted", seeker, {"listing_type": "room", "source": "like"}),
        ("tour_booked", seeker, {"listing_type": "apartment"}),
    ]
    for event, _, properties in fake_posthog.events:
        assert set(properties) <= analytics.ALLOWED[cast(analytics.Event, event)], event


def test_ac3_no_personal_data(
    client: TestClient,
    outbox: Outbox,
    db_engine: Engine,
    gush_dan: uuid.UUID,
    fake_google: None,
    fake_posthog: FakePosthog,
) -> None:
    _run_funnel(client, outbox, db_engine, gush_dan)

    assert fake_posthog.events
    text_of_events = repr(fake_posthog.events)
    for personal in (OWNER_EMAIL, SEEKER_EMAIL, OWNER_NAME, SEEKER_NAME, MESSAGE, PASSWORD):
        assert personal not in text_of_events
    for event, _, properties in fake_posthog.events:
        for key, value in properties.items():
            assert "price" not in key and "phone" not in key, (event, key)
            assert value not in (7000, 7200, "7000", "7200"), (event, key)
            assert not (isinstance(value, str) and ("?" in value or "@" in value)), (event, key)


# --- AC4, AC5 ----------------------------------------------------------------------------------


def test_ac4_no_event_on_rollback(
    client: TestClient,
    outbox: Outbox,
    db_engine: Engine,
    gush_dan: uuid.UUID,
    fake_posthog: FakePosthog,
) -> None:
    owner = signup(client, outbox, OWNER_EMAIL, "owner")
    seeker = signup(client, outbox, SEEKER_EMAIL, "seeker")
    seeker_id = uuid.UUID(seeker.get("/me").json()["id"])
    owner_id = uuid.UUID(owner.get("/me").json()["id"])
    make_profile(db_engine, owner_id, gush_dan)
    make_profile(db_engine, seeker_id, gush_dan)
    own = make_listing(db_engine, owner_id, gush_dan)
    own_room = make_listing(
        db_engine,
        owner_id,
        gush_dan,
        listing_type="room",
        flatmates_count=2,
        gender_preference="any",
    )
    make_listing(db_engine, owner_id, gush_dan)  # the third: the cap
    application = _ok(seeker.post(f"/listings/{own}/applications", json={"message": MESSAGE}), 201)[
        "id"
    ]
    url = f"/listings/{own}/applications/{application}"
    _ok(owner.patch(url, json={"status": "shortlisted"}))
    fake_posthog.events.clear()

    # Apply to own listing (a counted 404), the cap reached (409), a second shortlist (no-op).
    own_apply = owner.post(f"/listings/{own_room}/applications", json={"message": MESSAGE})
    assert own_apply.status_code == 404
    assert owner.post("/listings", json=_body(gush_dan)).status_code == 409
    _ok(owner.patch(url, json={"status": "shortlisted"}))

    assert fake_posthog.events == []


def test_ac5_posthog_failure_never_fails_request(
    client: TestClient,
    outbox: Outbox,
    gush_dan: uuid.UUID,
    fake_posthog: FakePosthog,
    caplog: pytest.LogCaptureFixture,
) -> None:
    fake_posthog.fail = True
    with caplog.at_level(logging.WARNING, logger="app.analytics"):
        owner = signup(client, outbox, OWNER_EMAIL, "owner")
        response = owner.post("/listings", json=_body(gush_dan))

    assert response.status_code == 201
    assert fake_posthog.events == []
    assert [r.getMessage() for r in caplog.records if r.name == "app.analytics"] == [
        "posthog capture failed: RuntimeError"
    ] * 2


# --- AC6 ---------------------------------------------------------------------------------------


def test_ac6_account_deleted_once(
    client: TestClient,
    outbox: Outbox,
    db_engine: Engine,
    photo_store: FilePhotoStore,
    fake_posthog: FakePosthog,
) -> None:
    seeker = signup(client, outbox, SEEKER_EMAIL, "seeker")
    seeker_id = uuid.UUID(seeker.get("/me").json()["id"])
    fake_posthog.events.clear()

    assert seeker.delete("/me").status_code == 204
    assert fake_posthog.events == [("account_deleted", None, {})]

    # The service again on the tombstone (a racing second DELETE /me): nothing is sent.
    with get_sessionmaker()() as db:
        tombstone = db.get(User, seeker_id)
        assert tombstone is not None
        assert accounts.delete_account(db, photo_store, tombstone) == []
    assert fake_posthog.events == [("account_deleted", None, {})]


# --- AC7 ---------------------------------------------------------------------------------------


def _deletion_settings(monkeypatch: pytest.MonkeyPatch, **update: Any) -> None:
    settings = get_settings().model_copy(update=update)
    monkeypatch.setattr(analytics, "get_settings", lambda: settings)


def _mock_client(
    monkeypatch: pytest.MonkeyPatch, answer: Callable[[httpx.Request], httpx.Response]
) -> list[httpx.Request]:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return answer(request)

    monkeypatch.setattr(
        httpx, "Client", functools.partial(httpx.Client, transport=httpx.MockTransport(handler))
    )
    return seen


def _tombstones(engine: Engine, count: int, age: str) -> set[str]:
    with engine.begin() as conn:
        rows = conn.execute(
            text(
                "INSERT INTO users (role, deleted_at)"
                " SELECT 'seeker', now() - CAST(:age AS interval) FROM generate_series(1, :n)"
                " RETURNING id"
            ),
            {"age": age, "n": count},
        ).scalars()
        return {str(i) for i in rows}


def test_ac7_forget_deleted_users(
    db_engine: Engine, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    recent = _tombstones(db_engine, 1001, "1 day")
    _tombstones(db_engine, 2, "8 days")
    make_owner(db_engine, "live@example.com")

    # Unset settings: no request.
    seen = _mock_client(monkeypatch, lambda _: httpx.Response(202, json={}))
    for update in (
        {},
        {"posthog_personal_api_key": SecretStr("phx_key")},
        {"posthog_project_id": "42"},
        {"posthog_personal_api_key": SecretStr(""), "posthog_project_id": "42"},
    ):
        _deletion_settings(monkeypatch, **update)
        assert analytics.forget_deleted_users() == 0
    assert seen == []

    key = f"phx_{token_hex(8)}"
    _deletion_settings(
        monkeypatch, posthog_personal_api_key=SecretStr(key), posthog_project_id="42"
    )
    seen = _mock_client(
        monkeypatch,
        lambda _: httpx.Response(
            202, json={"persons_queued_for_deletion": 1, "deletion_errors": [{"id": "x"}]}
        ),
    )
    with caplog.at_level(logging.INFO, logger="app.analytics"):
        assert analytics.forget_deleted_users() == 1001

    bodies = [json.loads(r.content) for r in seen]
    assert [len(b["distinct_ids"]) for b in bodies] == [1000, 1]
    assert {i for b in bodies for i in b["distinct_ids"]} == recent
    assert all(b["delete_events"] is True for b in bodies)
    for request in seen:
        assert request.method == "POST"
        assert str(request.url) == "https://eu.posthog.com/api/projects/42/persons/bulk_delete/"
        assert request.headers["Authorization"] == f"Bearer {key}"
    warnings = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    assert warnings == ["posthog forget: 1 deletion errors"] * 2
    assert key not in caplog.text

    # A 5xx raises (the job fails and Sentry reports it).
    _mock_client(monkeypatch, lambda _: httpx.Response(503))
    with pytest.raises(httpx.HTTPStatusError):
        analytics.forget_deleted_users()


def test_ac7_forget_cron_registered() -> None:
    httpx_logger = logging.getLogger("httpx")
    level = httpx_logger.level
    try:
        from app import worker

        importlib.reload(worker)
        (job,) = (
            j for j in worker.WorkerSettings.cron_jobs if j.coroutine is worker.posthog_forget_job
        )
        assert (job.hour, job.minute, job.unique) == (3, 55, True)
        assert worker.WorkerSettings.on_shutdown is worker.on_shutdown
    finally:
        httpx_logger.setLevel(level)
