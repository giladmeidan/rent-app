"""Person photo API (spec 0010j): AC1-AC4 (AC5 is the unchanged statement-count tests in
`test_chat.py`, `test_inbox.py`, `test_flatmates.py` and `test_people.py`).

Uploads go to 0010d's `photo_store` fixture (a `FilePhotoStore` in `tmp_path`) through the same
pipeline as a listing photo; only the small address is ever exposed (`photo_url`)."""

import threading
import uuid
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import Engine, event, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.redis_client import get_redis
from app.services import photos as photos_service
from app.services.photo_store import FilePhotoStore, get_photo_store
from tests.conftest import Outbox, jpeg, make_application, make_flatmate, make_listing, signup
from tests.test_matching import _user_id
from tests.test_people import _room, _seeker
from tests.test_photos import (
    KEY,
    _app,
    _FailingPut,
    _files,
    _key_of,
    _provide,
    _read_spy,
    _save,
    _slot_taken,
    _upload,
)

pytestmark = pytest.mark.usefixtures("redis_clean")

UNAUTHENTICATED = {"detail": "unauthenticated"}


# --- helpers -----------------------------------------------------------------------------------


def _put(caller: TestClient, data: Any, content_type: str = "image/jpeg") -> httpx.Response:
    response: httpx.Response = caller.put(
        "/me/photo", content=data, headers={"Content-Type": content_type}
    )
    return response


def _set(caller: TestClient, data: bytes | None = None) -> dict[str, Any]:
    """`PUT /me/photo` that must succeed; the `UserOut` body."""
    response = _put(caller, jpeg() if data is None else data)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def _url(key: str) -> str:
    return f"{get_settings().photo_public_base_url}/{key}-s.webp"


def _pair(key: str) -> set[str]:
    return {f"{key}-s.webp", f"{key}-l.webp"}


def _stored_key(engine: Engine, user_id: uuid.UUID) -> str | None:
    with engine.connect() as conn:
        key: str | None = conn.execute(
            text("SELECT photo_key FROM users WHERE id = :id"), {"id": user_id}
        ).scalar_one()
    return key


def _ok(response: httpx.Response, code: int = 200) -> Any:
    assert response.status_code == code, response.text
    return response.json() if response.content else None


# --- AC1 ---------------------------------------------------------------------------------------


def test_ac1_set_replace_clear(
    client: TestClient, outbox: Outbox, db_engine: Engine, photo_store: FilePhotoStore
) -> None:
    owner = signup(client, outbox, "o@example.com", "owner")
    seeker = signup(client, outbox, "s@example.com", "seeker")
    for caller in (owner, seeker):
        user_id = _user_id(caller)
        assert _ok(caller.get("/me"))["photo_url"] is None

        first = _set(caller, jpeg(3000, 2000))
        assert first["id"] == str(user_id)
        first_key = _key_of(first["photo_url"])
        assert KEY.match(first_key)
        assert first["photo_url"] == _url(first_key)
        assert str(user_id) not in first["photo_url"]
        assert user_id.hex not in first["photo_url"]
        assert _stored_key(db_engine, user_id) == first_key
        assert _pair(first_key) <= _files(photo_store)
        small = Image.open(photo_store.photo_dir / f"{first_key}-s.webp")
        assert (small.format, max(small.size)) == ("WEBP", 480)

        second = _set(caller)
        second_key = _key_of(second["photo_url"])
        assert second_key != first_key
        assert second["photo_url"] == _url(second_key)
        assert _stored_key(db_engine, user_id) == second_key
        assert _pair(second_key) <= _files(photo_store)
        assert not _pair(first_key) & _files(photo_store)  # the old photo's objects are gone
        assert _ok(caller.get("/me")) == second

        assert _ok(caller.delete("/me/photo"), 204) is None
        assert _ok(caller.get("/me"))["photo_url"] is None
        assert _stored_key(db_engine, user_id) is None
        assert not _pair(second_key) & _files(photo_store)
        assert _ok(caller.delete("/me/photo"), 204) is None  # idempotent
        assert _ok(caller.get("/me"))["photo_url"] is None
    assert _files(photo_store) == set()

    assert client.cookies.get("rent_session") is None
    for response in (_put(client, jpeg()), client.delete("/me/photo")):
        assert (response.status_code, response.json()) == (401, UNAUTHENTICATED)
    assert _files(photo_store) == set()


# --- AC2 ---------------------------------------------------------------------------------------


def test_ac2_failures_and_concurrency(
    client: TestClient,
    outbox: Outbox,
    db_engine: Engine,
    photo_store: FilePhotoStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seeker = signup(client, outbox, "s@example.com", "seeker")
    user_id = _user_id(seeker)
    old_key = _key_of(_set(seeker)["photo_url"])

    def unchanged() -> None:
        assert _stored_key(db_engine, user_id) == old_key
        assert _files(photo_store) == _pair(old_key)
        assert _ok(seeker.get("/me"))["photo_url"] == _url(old_key)

    # Bad input: refused, nothing changes and nothing is left behind.
    oversized = _put(seeker, b"\xff" * (photos_service.MAX_PHOTO_BYTES + 1))
    assert (oversized.status_code, oversized.json()) == (413, {"detail": "photo_too_large"})
    gif = _put(seeker, _save(Image.new("RGB", (64, 48), (200, 30, 30)), "GIF"), "image/gif")
    assert (gif.status_code, gif.json()) == (415, {"detail": "unsupported_image"})
    unchanged()

    # The database write fails after both puts: both new objects are deleted, the old photo stays.
    def broken_write(db: Session, user_id: uuid.UUID, key: str | None) -> None:
        raise OperationalError("UPDATE users", {}, Exception("connection lost"))

    with monkeypatch.context() as patch:
        patch.setattr(photos_service, "_set_photo_key", broken_write)
        failed = _put(seeker, jpeg())
    assert (failed.status_code, failed.json()) == (503, {"detail": "database unavailable"})
    unchanged()

    # The store fails on the first put, then on the second: 503, nothing new is left.
    for fail_on in (1, 2):
        _app(client).dependency_overrides[get_photo_store] = _provide(
            _FailingPut(photo_store.photo_dir, fail_on)
        )
        response = _put(seeker, jpeg())
        assert (response.status_code, response.json()) == (
            503,
            {"detail": "photo_storage_unavailable"},
        ), fail_on
        unchanged()
    _app(client).dependency_overrides[get_photo_store] = _provide(photo_store)

    # Two concurrent PUTs reach the row lock together (after their encodes and puts): they
    # serialise on it, each reads the key the other committed, and exactly one key survives with
    # only its objects in the store (the first winner's and the old photo's are deleted).
    barrier = threading.Barrier(2, timeout=20)
    real_lock = photos_service._lock_photo_key

    def lock_together(db: Session, locked_id: uuid.UUID) -> str | None:
        barrier.wait()
        return real_lock(db, locked_id)

    monkeypatch.setattr(photos_service, "_lock_photo_key", lock_together)
    # One user has one upload in flight (`take_upload_slot`); the row lock is the line behind it
    # (an expired slot), so this test turns the slot off to reach the lock with two uploads.
    monkeypatch.setattr(photos_service, "take_upload_slot", lambda r, user_id: "token")
    monkeypatch.setattr(photos_service, "release_upload_slot", lambda r, user_id, token: None)
    statements: list[str] = []

    def record(_conn: Any, _cursor: Any, statement: str, *_: Any) -> None:
        statements.append(statement)

    second = TestClient(seeker.app, cookies=dict(seeker.cookies))
    results: list[httpx.Response] = []

    def upload(caller: TestClient) -> None:
        results.append(_put(caller, jpeg()))

    event.listen(db_engine, "before_cursor_execute", record)
    try:
        threads = [threading.Thread(target=upload, args=(caller,)) for caller in (seeker, second)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=60)
    finally:
        event.remove(db_engine, "before_cursor_execute", record)

    assert [response.status_code for response in results] == [200, 200], [
        response.text for response in results
    ]
    locks = [s for s in statements if "FOR NO KEY UPDATE" in s]
    assert len(locks) == 2 and all("FROM users" in s for s in locks), locks
    keys = {_key_of(response.json()["photo_url"]) for response in results}
    assert len(keys) == 2 and old_key not in keys
    final = _stored_key(db_engine, user_id)
    assert final in keys
    assert final is not None
    assert _files(photo_store) == _pair(final)
    assert _ok(seeker.get("/me"))["photo_url"] == _url(final)


# --- AC3 ---------------------------------------------------------------------------------------


def test_ac3_shared_rate_limit(
    client: TestClient,
    outbox: Outbox,
    db_engine: Engine,
    gush_dan: uuid.UUID,
    photo_store: FilePhotoStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner = signup(client, outbox, "o@example.com", "owner")
    owner_id = _user_id(owner)
    listing = make_listing(db_engine, owner_id, gush_dan)
    hour_key = f"rl:photo:user:{owner_id}"

    # One upload slot for both kinds: a person upload while a listing upload is in flight is a 429
    # (`Retry-After: 5`) that never reads its body. Both attempts count.
    entered, go = threading.Event(), threading.Event()
    real_encode = photos_service.encode

    def held(data: bytes) -> photos_service.Encoded:
        entered.set()
        assert go.wait(20)
        return real_encode(data)

    first: list[httpx.Response] = []
    with monkeypatch.context() as patch:
        patch.setattr(photos_service, "encode", held)
        reads = _read_spy(patch)
        thread = threading.Thread(target=lambda: first.append(_upload(owner, listing, jpeg())))
        thread.start()
        try:
            assert entered.wait(20)
            assert _slot_taken(owner_id)
            refused = _put(TestClient(owner.app, cookies=dict(owner.cookies)), jpeg())
            assert (refused.status_code, refused.json()) == (429, {"detail": "rate_limited"})
            assert refused.headers["Retry-After"] == "5"
            assert len(reads) == 1  # the listing upload's only
        finally:
            go.set()
            thread.join(timeout=30)
    assert first[0].status_code == 201, first[0].text
    assert not _slot_taken(owner_id)
    person_key = _key_of(_set(owner)["photo_url"])
    assert int(get_redis().get(hour_key) or 0) == 3

    # Refused uploads of either kind count too: empty bodies (415) bring the hour to 60.
    for attempt in range(photos_service.PHOTO_RATE_LIMIT_HOUR - 3):
        response = _upload(owner, listing, b"") if attempt % 2 else _put(owner, b"")
        assert response.status_code == 415, attempt
    assert int(get_redis().get(hour_key) or 0) == 60
    assert int(get_redis().get(f"{hour_key}:day") or 0) == 60

    reads = _read_spy(monkeypatch)
    limited = _put(owner, jpeg())
    assert (limited.status_code, limited.json()) == (429, {"detail": "rate_limited"})
    assert 0 < int(limited.headers["Retry-After"]) <= 3600
    assert reads == []  # refused before the body is read
    assert _upload(owner, listing, jpeg()).status_code == 429  # the listing upload too
    assert reads == []
    assert int(get_redis().get(hour_key) or 0) == 60  # a refusal counts nothing
    assert _stored_key(db_engine, owner_id) == person_key

    # DELETE is not limited and counts nothing.
    for _ in range(3):
        assert _ok(owner.delete("/me/photo"), 204) is None
    assert _stored_key(db_engine, owner_id) is None
    assert not _pair(person_key) & _files(photo_store)
    assert int(get_redis().get(hour_key) or 0) == 60


# --- AC4 ---------------------------------------------------------------------------------------


def _assert_no_person_key(body: str, keys: dict[str, str], surface: str) -> None:
    for who, key in keys.items():
        assert key not in body, (surface, who)


def test_ac4_photo_only_where_person_is_shown(
    client: TestClient,
    outbox: Outbox,
    db_engine: Engine,
    gush_dan: uuid.UUID,
    photo_store: FilePhotoStore,
) -> None:
    owner = signup(client, outbox, "o@example.com", "owner", display_name="Noa")
    owner_id = _user_id(owner)
    seeker = _seeker(client, outbox, db_engine, gush_dan, "s@example.com", "Dana")
    seeker_id = _user_id(seeker)
    mate = signup(client, outbox, "f@example.com", "seeker", display_name="Fay")
    mate_id = _user_id(mate)
    keys = {
        name: _key_of(_set(caller)["photo_url"])
        for name, caller in (("O", owner), ("S", seeker), ("F", mate))
    }
    url = {name: _url(key) for name, key in keys.items()}

    room = uuid.UUID(_room(db_engine, owner_id, gush_dan))
    other_room = uuid.UUID(_room(db_engine, owner_id, gush_dan))
    make_flatmate(db_engine, room, mate_id)
    application = make_application(db_engine, room, seeker_id)

    # O's applicants list and the status PATCH response.
    (applicant,) = _ok(owner.get(f"/listings/{room}/applications"))
    assert (applicant["applicant_name"], applicant["photo_url"]) == ("Dana", url["S"])
    patched = _ok(
        owner.patch(f"/listings/{room}/applications/{application}", json={"status": "shortlisted"})
    )
    assert patched["photo_url"] == url["S"]

    # O's people page: S opted in, on O's other room (and invited there: spec 0010l).
    page = _ok(owner.get(f"/listings/{other_room}/people"))
    (card,) = [item for item in page["items"] if item["display_name"] == "Dana"]
    assert card["photo_url"] == url["S"]
    assert _ok(owner.put(f"/listings/{other_room}/people/{card['id']}/like")) == {"liked": True}

    # The chat: O, S and F each see the other party and every member with their photo.
    members = [
        {"name": "Noa", "photo_url": url["O"], "role": "owner"},
        {"name": "Fay", "photo_url": url["F"], "role": "flatmate"},
        {"name": "Dana", "photo_url": url["S"], "role": "seeker"},
    ]
    for caller, me, other in ((owner, "Noa", "S"), (seeker, "Dana", "O"), (mate, "Fay", "S")):
        (item,) = _ok(caller.get("/me/conversations"))
        assert (item["id"], item["other_photo_url"]) == (str(application), url[other]), me
        thread = _ok(caller.get(f"/conversations/{application}"))
        assert thread["other_photo_url"] == url[other], me
        assert thread["members"] == [{**m, "is_me": m["name"] == me} for m in members], me

    # O's flatmates list.
    (flatmate,) = _ok(owner.get(f"/listings/{room}/flatmates"))
    assert (flatmate["display_name"], flatmate["photo_url"]) == ("Fay", url["F"])

    # No person address anywhere else, including the surfaces that name the owner.
    invite = _ok(owner.post(f"/listings/{room}/flatmate-invite"), 201)["token"]
    forbidden: list[tuple[str, httpx.Response]] = [
        ("S /me/applications", seeker.get("/me/applications")),
        ("S /me/flats", seeker.get("/me/flats")),
        ("F /me/flats", mate.get("/me/flats")),
        ("public listing", client.get(f"/listings/{room}")),
        ("search", client.get("/listings?listing_type=room")),
        ("S /me/likes", seeker.get("/me/likes")),
        ("invite preview", seeker.post("/flatmate-invites/preview", json={"token": invite})),
        ("O /me/listings", owner.get("/me/listings")),
    ]
    for surface, response in forbidden:
        assert response.status_code == 200, (surface, response.text)
        _assert_no_person_key(response.text, keys, surface)
    assert _ok(mate.get("/me/flats"))[0]["owner_name"] == "Noa"  # the owner is shown, unpictured
    assert _ok(seeker.get("/me/likes"))["liked_me"]  # the room that invited them is listed
    search_ids = {item["id"] for item in _ok(client.get("/listings?listing_type=room"))["items"]}
    assert {str(room), str(other_room)} <= search_ids
