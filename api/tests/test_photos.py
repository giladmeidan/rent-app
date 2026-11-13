"""Listing photos API (spec 0010d): AC1, AC3-AC12 (AC2 and AC3's pixel cap are in
`test_photo_encode.py`, AC13 in `test_config.py`, AC14 in `test_migrations.py`).

`O` is a signed-up owner with listing `L` (`make_listing`); uploads go to the `photo_store` fixture
(a `FilePhotoStore` in `tmp_path`)."""

import asyncio
import logging
import os
import re
import threading
import uuid
from collections.abc import Callable, Iterator, Sequence
from io import BytesIO
from pathlib import Path
from typing import Any, cast
from urllib.parse import urlsplit

import httpx
import pytest
from botocore.stub import Stubber
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import Engine, event, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session
from starlette.requests import Request

from app.config import get_settings
from app.main import create_app
from app.redis_client import get_redis
from app.routers import photos as photos_router
from app.services import photos as photos_service
from app.services.photo_store import (
    CACHE_CONTROL,
    FilePhotoStore,
    PhotoStoreUnavailable,
    R2PhotoStore,
    get_photo_store,
)
from tests.conftest import (
    Outbox,
    jpeg,
    make_listing,
    make_pair,
    make_photo,
    make_profile,
    set_location,
    signup,
)
from tests.test_listings import _body

pytestmark = pytest.mark.usefixtures("redis_clean")

KEY = re.compile(r"^[A-Za-z0-9_-]{43}$")
NOT_FOUND = {"detail": "not_found"}
MISMATCH = {"detail": "photo_order_mismatch"}


# --- helpers -----------------------------------------------------------------------------------


def _user_id(engine: Engine, email: str) -> uuid.UUID:
    with engine.connect() as conn:
        user_id: uuid.UUID = conn.execute(
            text("SELECT id FROM users WHERE email = :email"), {"email": email}
        ).scalar_one()
    return user_id


def _upload(
    caller: TestClient, listing_id: Any, data: Any, content_type: str = "image/jpeg"
) -> httpx.Response:
    response: httpx.Response = caller.post(
        f"/listings/{listing_id}/photos", content=data, headers={"Content-Type": content_type}
    )
    return response


def _created(caller: TestClient, listing_id: Any, data: bytes | None = None) -> dict[str, Any]:
    response = _upload(caller, listing_id, jpeg() if data is None else data)
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


def _files(store: FilePhotoStore) -> set[str]:
    """Every file in the store, dotfiles (temp files) included."""
    return set(os.listdir(store.photo_dir)) if store.photo_dir.exists() else set()


def _rows(engine: Engine, listing_id: Any) -> list[tuple[str, int]]:
    """`(id, position)` of the listing's photos, in position order."""
    with engine.connect() as conn:
        return [
            (str(photo_id), position)
            for photo_id, position in conn.execute(
                text(
                    "SELECT id, position FROM listing_photos WHERE listing_id = :id"
                    " ORDER BY position"
                ),
                {"id": listing_id},
            ).tuples()
        ]


def _count_rows(engine: Engine) -> int:
    with engine.connect() as conn:
        count: int = conn.execute(text("SELECT count(*) FROM listing_photos")).scalar_one()
    return count


def _key_of(url: str) -> str:
    name = urlsplit(url).path.rsplit("/", 1)[1]
    return name.removesuffix("-s.webp").removesuffix("-l.webp")


def _image(data: bytes) -> Image.Image:
    image = Image.open(BytesIO(data))
    image.load()
    return image


def _save(image: Image.Image, image_format: str, **params: Any) -> bytes:
    out = BytesIO()
    image.save(out, format=image_format, **params)
    return out.getvalue()


@pytest.fixture
def owner(client: TestClient, outbox: Outbox) -> TestClient:
    return signup(client, outbox, "o@example.com", "owner")


@pytest.fixture
def owner_id(owner: TestClient, db_engine: Engine) -> uuid.UUID:
    return _user_id(db_engine, "o@example.com")


@pytest.fixture
def listing(owner_id: uuid.UUID, gush_dan: uuid.UUID, db_engine: Engine) -> uuid.UUID:
    return make_listing(db_engine, owner_id, gush_dan)


@pytest.fixture
def statements(db_engine: Engine) -> Iterator[list[str]]:
    """Every SQL statement the app engine sends while the test records (`.clear()` to start)."""
    seen: list[str] = []

    def record(_conn: Any, _cursor: Any, statement: str, *_: Any) -> None:
        seen.append(statement)

    event.listen(db_engine, "before_cursor_execute", record)
    yield seen
    event.remove(db_engine, "before_cursor_execute", record)


def _app(client: TestClient) -> FastAPI:
    return cast(FastAPI, client.app)


def _provide(store: FilePhotoStore) -> Callable[[], FilePhotoStore]:
    """A dependency override returning `store` (a parameterless function: FastAPI would read a
    lambda's default argument as a query parameter)."""

    def provide() -> FilePhotoStore:
        return store

    return provide


# --- AC1 ---------------------------------------------------------------------------------------


def test_ac1_upload_listing_photo(
    owner: TestClient,
    owner_id: uuid.UUID,
    listing: uuid.UUID,
    db_engine: Engine,
    photo_store: FilePhotoStore,
) -> None:
    body = _created(owner, listing, jpeg(3000, 2000))

    assert set(body) == {"id", "small_url", "large_url"}
    base = get_settings().photo_public_base_url
    key = _key_of(body["small_url"])
    assert KEY.match(key)
    assert body["small_url"] == f"{base}/{key}-s.webp"
    assert body["large_url"] == f"{base}/{key}-l.webp"
    for url in (body["small_url"], body["large_url"]):
        for forbidden in (listing, owner_id, uuid.UUID(body["id"])):
            assert str(forbidden) not in url
            assert forbidden.hex not in url
    assert _files(photo_store) == {f"{key}-s.webp", f"{key}-l.webp"}
    small = _image((photo_store.photo_dir / f"{key}-s.webp").read_bytes())
    large = _image((photo_store.photo_dir / f"{key}-l.webp").read_bytes())
    assert (small.format, large.format) == ("WEBP", "WEBP")
    assert (max(small.size), max(large.size)) == (480, 1600)
    with db_engine.connect() as conn:
        row = conn.execute(
            text("SELECT key, position, width, height FROM listing_photos WHERE id = :id"),
            {"id": body["id"]},
        ).one()
    assert (row.key, row.position, row.width) == (key, 0, 1600)
    assert row.height in (1066, 1067)

    # A PNG (sent as `image/jpeg`: the header is not trusted), a WebP and an MPO.
    rgb = Image.new("RGB", (900, 600), (10, 120, 200))
    mpo = _save(rgb, "MPO", save_all=True, append_images=[Image.new("RGB", (900, 600))])
    assert _image(mpo).format == "MPO"
    for data, content_type in (
        (_save(rgb, "PNG"), "image/jpeg"),
        (_save(rgb, "WEBP"), "image/webp"),
        (mpo, "image/jpeg"),
    ):
        response = _upload(owner, listing, data, content_type)
        assert response.status_code == 201, response.text
    assert [position for _, position in _rows(db_engine, listing)] == [0, 1, 2, 3]
    assert len(_files(photo_store)) == 8


# --- AC3 ---------------------------------------------------------------------------------------


@pytest.mark.filterwarnings("ignore::PIL.Image.DecompressionBombWarning")
def test_ac3_rejects_bad_input(
    owner: TestClient, listing: uuid.UUID, db_engine: Engine, photo_store: FilePhotoStore
) -> None:
    over = photos_service.MAX_PHOTO_BYTES + 1
    too_large = _upload(owner, listing, b"\xff" * over)
    assert (too_large.status_code, too_large.json()) == (413, {"detail": "photo_too_large"})

    def chunked() -> Iterator[bytes]:  # no Content-Length: httpx sends it chunked
        for _ in range(over // (1024 * 1024)):
            yield b"\xff" * (1024 * 1024)
        yield b"\xff" * (over % (1024 * 1024))

    streamed = _upload(owner, listing, chunked())
    assert (streamed.status_code, streamed.json()) == (413, {"detail": "photo_too_large"})

    fifty_mp = _save(Image.new("1", (10_000, 5_000)), "PNG")
    assert len(fifty_mp) < 100_000
    pixels = _upload(owner, listing, fifty_mp, "image/png")
    assert (pixels.status_code, pixels.json()) == (413, {"detail": "photo_too_large"})

    rgb = Image.new("RGB", (64, 48), (200, 30, 30))
    whole = jpeg()
    for data in (
        _save(rgb, "GIF"),
        _save(rgb, "PDF"),
        os.urandom(4096),
        whole[: len(whole) // 2],
        b"",
    ):
        response = _upload(owner, listing, data)
        assert (response.status_code, response.json()) == (415, {"detail": "unsupported_image"})

    assert _files(photo_store) == set()
    assert _count_rows(db_engine) == 0


class _Receive:
    """An ASGI `receive` sending `chunks` 1 MB chunks, counting how many were read."""

    def __init__(self, chunks: int) -> None:
        self.chunks = chunks
        self.read = 0

    async def __call__(self) -> dict[str, Any]:
        self.read += 1
        return {
            "type": "http.request",
            "body": b"\0" * (1024 * 1024),
            "more_body": self.read < self.chunks,
        }


def _request(receive: _Receive, headers: Sequence[tuple[bytes, bytes]] = ()) -> Request:
    scope = {"type": "http", "method": "POST", "path": "/", "headers": list(headers)}
    return Request(scope, receive)


def test_ac3_read_capped_stops_at_cap() -> None:
    cap = photos_service.MAX_PHOTO_BYTES  # 8 MB = 8 chunks

    # A chunked stream of 20 MB with no Content-Length: stops after the 9th chunk.
    receive = _Receive(chunks=20)
    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(photos_router.read_capped(_request(receive), cap))
    assert (excinfo.value.status_code, excinfo.value.detail) == (413, "photo_too_large")
    assert receive.read == 9

    # A declared length over the cap: refused without reading anything.
    receive = _Receive(chunks=20)
    declared = [(b"content-length", str(20 * 1024 * 1024).encode())]
    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(photos_router.read_capped(_request(receive, declared), cap))
    assert excinfo.value.status_code == 413
    assert receive.read == 0

    # Exactly the cap is read whole.
    receive = _Receive(chunks=8)
    data = asyncio.run(photos_router.read_capped(_request(receive), cap))
    assert len(data) == cap
    assert receive.read == 8


# --- AC4 ---------------------------------------------------------------------------------------


def test_ac4_limit_of_ten_under_concurrency(
    owner: TestClient,
    listing: uuid.UUID,
    db_engine: Engine,
    photo_store: FilePhotoStore,
    monkeypatch: pytest.MonkeyPatch,
    statements: list[str],
) -> None:
    for position in range(9):
        make_photo(db_engine, listing, position=position)
    # Both uploads reach the listing lock together (after their encode and puts); without the lock
    # both would count 9 and insert position 9.
    barrier = threading.Barrier(2, timeout=20)
    real_lock = photos_service._lock_own_listing

    def lock_together(db: Session, owner_id: uuid.UUID, listing_id: uuid.UUID) -> None:
        barrier.wait()
        real_lock(db, owner_id, listing_id)

    monkeypatch.setattr(photos_service, "_lock_own_listing", lock_together)
    # One user has one upload in flight (`take_upload_slot`); the lock is the line behind it (an
    # expired slot), so this test turns the slot off to reach the lock with two uploads.
    monkeypatch.setattr(photos_service, "take_upload_slot", lambda r, user_id: "token")
    monkeypatch.setattr(photos_service, "release_upload_slot", lambda r, user_id, token: None)
    second = TestClient(owner.app, cookies=dict(owner.cookies))
    results: list[httpx.Response] = []

    def upload(caller: TestClient) -> None:
        results.append(_upload(caller, listing, jpeg()))

    threads = [threading.Thread(target=upload, args=(caller,)) for caller in (owner, second)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=60)

    assert sorted(response.status_code for response in results) == [201, 409]
    # The lock that serialises them and lets apply's and like's `FOR KEY SHARE` through.
    assert sum("FOR NO KEY UPDATE" in statement for statement in statements) == 2
    refused = next(response for response in results if response.status_code == 409)
    assert refused.json() == {"detail": "photo_limit"}
    accepted = next(response for response in results if response.status_code == 201).json()
    assert [position for _, position in _rows(db_engine, listing)] == list(range(10))
    key = _key_of(accepted["small_url"])
    assert _files(photo_store) == {f"{key}-s.webp", f"{key}-l.webp"}  # the refused ones are gone

    monkeypatch.setattr(photos_service, "_lock_own_listing", real_lock)
    eleventh = _upload(owner, listing, jpeg())
    assert (eleventh.status_code, eleventh.json()) == (409, {"detail": "photo_limit"})
    assert _count_rows(db_engine) == 10
    assert _files(photo_store) == {f"{key}-s.webp", f"{key}-l.webp"}


# --- AC5 ---------------------------------------------------------------------------------------


def test_ac5_owner_only(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    listing: uuid.UUID,
    gush_dan: uuid.UUID,
    db_engine: Engine,
    photo_store: FilePhotoStore,
) -> None:
    p0 = _created(owner, listing)
    p1 = _created(owner, listing)
    before = (_rows(db_engine, listing), _files(photo_store))
    o2 = signup(client, outbox, "o2@example.com", "owner")
    o2_listing = make_listing(db_engine, _user_id(db_engine, "o2@example.com"), gush_dan)
    o2_photo = make_photo(db_engine, o2_listing, position=0)
    order = {"photo_ids": [p1["id"], p0["id"]]}
    anonymous = TestClient(client.app)

    for caller, status in ((o2, 404), (anonymous, 401)):
        upload = _upload(caller, listing, jpeg())
        delete = caller.delete(f"/listings/{listing}/photos/{p0['id']}")
        reorder = caller.put(f"/listings/{listing}/photos/order", json=order)
        for response in (upload, delete, reorder):
            assert response.status_code == status, response.text
            assert response.json() == (
                NOT_FOUND if status == 404 else {"detail": "unauthenticated"}
            )
    unknown = _upload(owner, uuid.uuid4(), jpeg())
    assert (unknown.status_code, unknown.json()) == (404, NOT_FOUND)
    # Another listing's photo through `L`'s path, and `L`'s photo through another's listing.
    for path in (
        f"/listings/{listing}/photos/{o2_photo}",
        f"/listings/{o2_listing}/photos/{p0['id']}",
        f"/listings/{listing}/photos/{uuid.uuid4()}",
    ):
        response = owner.delete(path)
        assert (response.status_code, response.json()) == (404, NOT_FOUND)
    assert (_rows(db_engine, listing), _files(photo_store)) == before
    assert len(_rows(db_engine, o2_listing)) == 1

    # Any role may add photos to a listing of their own.
    seeker = signup(client, outbox, "s@example.com", "seeker")
    seeker_listing = make_listing(
        db_engine,
        _user_id(db_engine, "s@example.com"),
        gush_dan,
        listing_type="room",
        flatmates_count=2,
    )
    assert _upload(seeker, seeker_listing, jpeg()).status_code == 201
    paused = make_listing(
        db_engine, _user_id(db_engine, "o@example.com"), gush_dan, status="paused"
    )
    assert _upload(owner, paused, jpeg()).status_code == 201


# --- AC6 ---------------------------------------------------------------------------------------


class _FailingDelete(FilePhotoStore):
    def delete(self, names: Sequence[str]) -> None:
        raise PhotoStoreUnavailable


def test_ac6_delete_shifts_and_cleans_up(
    client: TestClient,
    owner: TestClient,
    listing: uuid.UUID,
    db_engine: Engine,
    photo_store: FilePhotoStore,
    caplog: pytest.LogCaptureFixture,
) -> None:
    p0, p1, p2 = (_created(owner, listing) for _ in range(3))
    p0_key = _key_of(p0["small_url"])

    deleted = owner.delete(f"/listings/{listing}/photos/{p0['id']}")

    assert deleted.status_code == 204
    assert _rows(db_engine, listing) == [(p1["id"], 0), (p2["id"], 1)]
    assert not {f"{p0_key}-s.webp", f"{p0_key}-l.webp"} & _files(photo_store)
    assert len(_files(photo_store)) == 4
    page = client.get(f"/listings/{listing}").json()
    assert page["photos"] == [p1, p2]
    assert page["cover"] == p1
    again = owner.delete(f"/listings/{listing}/photos/{p0['id']}")
    assert (again.status_code, again.json()) == (404, NOT_FOUND)

    # The store fails after the commit: still a 204, the row is gone, the failure is logged.
    _app(client).dependency_overrides[get_photo_store] = lambda: _FailingDelete(
        photo_store.photo_dir
    )
    with caplog.at_level(logging.WARNING, logger="app.services.photos"):
        failed = owner.delete(f"/listings/{listing}/photos/{p1['id']}")
    assert failed.status_code == 204
    assert _rows(db_engine, listing) == [(p2["id"], 0)]
    assert "photo cleanup failed" in caplog.text
    assert _key_of(p1["small_url"]) not in caplog.text


# --- AC7 ---------------------------------------------------------------------------------------


def test_ac7_reorder(
    client: TestClient,
    owner: TestClient,
    owner_id: uuid.UUID,
    listing: uuid.UUID,
    gush_dan: uuid.UUID,
    db_engine: Engine,
    photo_store: FilePhotoStore,
) -> None:
    p0, p1, p2 = (_created(owner, listing) for _ in range(3))
    other = make_listing(db_engine, owner_id, gush_dan)
    other_photo = str(make_photo(db_engine, other, position=0))

    response = owner.put(
        f"/listings/{listing}/photos/order", json={"photo_ids": [p2["id"], p0["id"], p1["id"]]}
    )

    assert response.status_code == 200, response.text
    assert response.json() == [p2, p0, p1]
    assert _rows(db_engine, listing) == [(p2["id"], 0), (p0["id"], 1), (p1["id"], 2)]
    search = {item["id"]: item for item in client.get("/listings").json()["items"]}
    assert search[str(listing)]["cover"] == p2

    before = _rows(db_engine, listing)
    for photo_ids in (
        [p2["id"], p0["id"]],  # missing one
        [p2["id"], p0["id"], p1["id"], str(uuid.uuid4())],  # an extra id
        [p2["id"], p0["id"], p0["id"]],  # a repeat
        [p2["id"], p0["id"], p1["id"], p1["id"]],  # a repeat on top of all three
        [p2["id"], p0["id"], other_photo],  # another listing's photo
    ):
        refused = owner.put(f"/listings/{listing}/photos/order", json={"photo_ids": photo_ids})
        assert (refused.status_code, refused.json()) == (422, MISMATCH), photo_ids
    malformed_bodies: list[dict[str, Any]] = [
        {"photo_ids": []},
        {"photo_ids": ["x"]},
        {"photo_ids": [p0["id"]] * 11},
        {"photo_ids": [p2["id"], p0["id"], p1["id"]], "x": 1},
        {},
    ]
    for malformed in malformed_bodies:
        refused = owner.put(f"/listings/{listing}/photos/order", json=malformed)
        assert refused.status_code == 422
        assert isinstance(refused.json()["detail"], list)
    assert _rows(db_engine, listing) == before
    assert _rows(db_engine, other) == [(other_photo, 0)]


# --- AC8 ---------------------------------------------------------------------------------------


class _FailingPut(FilePhotoStore):
    """Fails the `fail_on`-th `put` (1-based) with `PhotoStoreUnavailable`."""

    def __init__(self, photo_dir: Path, fail_on: int) -> None:
        super().__init__(photo_dir)
        self.fail_on = fail_on
        self.puts = 0

    def put(self, name: str, data: bytes) -> None:
        self.puts += 1
        if self.puts == self.fail_on:
            raise PhotoStoreUnavailable
        super().put(name, data)


def test_ac8_store_and_db_failures_leave_nothing(
    client: TestClient,
    owner: TestClient,
    listing: uuid.UUID,
    db_engine: Engine,
    photo_store: FilePhotoStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The database fails after both puts: the locked count (the second; the first is the
    # pre-body check's).
    real_count = photos_service._photo_count
    counts: list[uuid.UUID] = []

    def broken_count(db: Session, listing_id: uuid.UUID) -> int:
        counts.append(listing_id)
        if len(counts) == 1:
            return real_count(db, listing_id)
        raise OperationalError("SELECT count(*)", {}, Exception("connection lost"))

    with monkeypatch.context() as patch:
        patch.setattr(photos_service, "_photo_count", broken_count)
        response = _upload(owner, listing, jpeg())
    assert response.status_code == 503
    assert response.json() == {"detail": "database unavailable"}
    assert len(counts) == 2
    assert _files(photo_store) == set()
    assert _count_rows(db_engine) == 0

    # The first put fails, then the second: 503, no row, no object.
    for fail_on in (1, 2):
        failing = _FailingPut(photo_store.photo_dir, fail_on)
        _app(client).dependency_overrides[get_photo_store] = _provide(failing)
        response = _upload(owner, listing, jpeg())
        assert response.status_code == 503, fail_on
        assert response.json() == {"detail": "photo_storage_unavailable"}
        assert failing.puts == fail_on
        assert _files(photo_store) == set(), fail_on
        assert _count_rows(db_engine) == 0


# --- AC9 ---------------------------------------------------------------------------------------


def test_ac9_upload_rate_limit(
    owner: TestClient,
    owner_id: uuid.UUID,
    listing: uuid.UUID,
    db_engine: Engine,
    photo_store: FilePhotoStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    p0 = _created(owner, listing)
    p1 = _created(owner, listing)
    # Refused uploads count too: 58 empty bodies (415) bring the hour to 60.
    for _ in range(photos_service.PHOTO_RATE_LIMIT_HOUR - 2):
        assert _upload(owner, listing, b"").status_code == 415
    assert int(get_redis().get(f"rl:photo:user:{owner_id}") or 0) == 60
    assert int(get_redis().get(f"rl:photo:user:{owner_id}:day") or 0) == 60

    reads: list[Request] = []
    real_read = photos_router.read_capped

    async def spy(request: Request, cap: int) -> bytes:
        reads.append(request)
        return await real_read(request, cap)

    monkeypatch.setattr(photos_router, "read_capped", spy)
    limited = _upload(owner, listing, jpeg())

    assert (limited.status_code, limited.json()) == (429, {"detail": "rate_limited"})
    assert 0 < int(limited.headers["Retry-After"]) <= 3600
    assert reads == []
    assert int(get_redis().get(f"rl:photo:user:{owner_id}") or 0) == 60  # a refusal counts nothing

    # Delete and reorder are not limited.
    reorder = owner.put(
        f"/listings/{listing}/photos/order", json={"photo_ids": [p1["id"], p0["id"]]}
    )
    assert reorder.status_code == 200
    assert owner.delete(f"/listings/{listing}/photos/{p0['id']}").status_code == 204
    assert _rows(db_engine, listing) == [(p1["id"], 0)]


# --- AC10 --------------------------------------------------------------------------------------


def test_ac10_listing_read_surfaces(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    owner_id: uuid.UUID,
    listing: uuid.UUID,
    gush_dan: uuid.UUID,
    db_engine: Engine,
    photo_store: FilePhotoStore,
    statements: list[str],
) -> None:
    p0, p1 = _created(owner, listing), _created(owner, listing)
    bare = make_listing(db_engine, owner_id, gush_dan)
    for listing_id, lng in ((listing, 34.78), (bare, 34.79)):
        set_location(db_engine, listing_id, lng, 32.07)

    client.get("/listings")  # warm the connection
    for query in ("", "?west=34.7&south=32.0&east=34.9&north=32.1"):  # search, then the map
        statements.clear()
        response = client.get(f"/listings{query}")
        sent = list(statements)
        assert response.status_code == 200
        covers = {item["id"]: item["cover"] for item in response.json()["items"]}
        assert covers == {str(listing): p0, str(bare): None}, query
        assert len(sent) == 2, sent

    statements.clear()
    page = client.get(f"/listings/{listing}").json()
    sent = list(statements)
    assert (page["photos"], page["cover"]) == ([p0, p1], p0)
    assert len(sent) == 4, sent
    assert "FROM listing_photos" in sent[3]
    assert client.get(f"/listings/{bare}").json()["photos"] == []

    owner.get("/me/listings")  # warm-up
    statements.clear()
    mine = owner.get("/me/listings").json()
    sent = list(statements)
    assert {item["id"]: item["photos"] for item in mine} == {str(listing): [p0, p1], str(bare): []}
    assert len(sent) == 3, sent
    patched = owner.patch(f"/listings/{listing}", json={"price_ils": 7300})
    assert patched.status_code == 200
    assert patched.json()["photos"] == [p0, p1]
    created = owner.post("/listings", json=_body(gush_dan))
    assert created.status_code == 201
    assert created.json()["photos"] == []

    # `/me/likes`: a seeker who liked a room with photos, and one without.
    seeker = signup(client, outbox, "s@example.com", "seeker")
    seeker_id = _user_id(db_engine, "s@example.com")
    make_profile(db_engine, seeker_id, gush_dan)
    room = make_listing(db_engine, owner_id, gush_dan, listing_type="room", flatmates_count=2)
    bare_room = make_listing(db_engine, owner_id, gush_dan, listing_type="room", flatmates_count=2)
    room_photo = make_photo(db_engine, room, position=0)
    make_photo(db_engine, room, position=1)
    for room_id in (room, bare_room):
        make_pair(db_engine, room_id, seeker_id, price_ils_seen=7200, seeker_liked=True)
    likes = seeker.get("/me/likes").json()
    covers = {item["listing"]["id"]: item["listing"]["cover"] for item in likes["mine"]}
    assert covers[str(bare_room)] is None
    assert covers[str(room)] is not None and covers[str(room)]["id"] == str(room_photo)


# --- AC11 --------------------------------------------------------------------------------------


def test_ac11_media_mount_file_backend_only(
    owner: TestClient,
    listing: uuid.UUID,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    media = tmp_path / "missing" / "media"
    try:
        monkeypatch.setenv("PHOTO_BACKEND", "file")
        monkeypatch.setenv("PHOTO_DIR", str(media))
        get_settings.cache_clear()
        assert not media.exists()
        with TestClient(create_app(), cookies=dict(owner.cookies)) as file_client:
            assert media.is_dir()
            uploaded = _upload(file_client, listing, jpeg())
            assert uploaded.status_code == 201, uploaded.text
            for url in (uploaded.json()["small_url"], uploaded.json()["large_url"]):
                path = urlsplit(url).path
                assert path.startswith("/media/")
                served = file_client.get(path)
                assert served.status_code == 200
                assert served.headers["content-type"] == "image/webp"
                assert _image(served.content).format == "WEBP"
            # A path out of PHOTO_DIR (percent-encoded, so the client does not normalise it away)
            # never reaches a file beside it.
            (media.parent / ".env").write_text("SECRET_KEY=fake-not-served")
            escaped = file_client.get("/media/%2e%2e/.env")
            assert escaped.status_code == 404
            assert b"fake-not-served" not in escaped.content

        monkeypatch.setenv("PHOTO_BACKEND", "r2")
        for name, value in (
            ("R2_ACCOUNT_ID", "fake-account"),
            ("R2_ACCESS_KEY_ID", "fake-key-id"),
            ("R2_SECRET_ACCESS_KEY", "fake-secret"),
            ("R2_BUCKET", "fake-bucket"),
        ):
            monkeypatch.setenv(name, value)
        get_settings.cache_clear()
        assert isinstance(get_photo_store(), R2PhotoStore)
        r2_app = create_app()
        stub = FilePhotoStore(tmp_path / "stub")
        r2_app.dependency_overrides[get_photo_store] = lambda: stub
        with TestClient(r2_app) as r2_client:
            assert r2_client.get(urlsplit(uploaded.json()["small_url"]).path).status_code == 404
    finally:
        monkeypatch.undo()
        get_settings.cache_clear()


# --- AC12 --------------------------------------------------------------------------------------


def test_ac12_r2_store(caplog: pytest.LogCaptureFixture) -> None:
    store = R2PhotoStore("fake-account", "fake-key-id", "fake-secret", "fake-bucket")
    client = store.client
    assert client.meta.endpoint_url == "https://fake-account.r2.cloudflarestorage.com"
    assert client.meta.region_name == "auto"
    # The stubs do not type `Config`'s options; read them by name. `max_attempts: 2` (retries) is
    # normalised by botocore to 3 attempts in all.
    names = (
        "connect_timeout",
        "read_timeout",
        "retries",
        "request_checksum_calculation",
        "response_checksum_validation",
    )
    options = {name: getattr(client.meta.config, name) for name in names}
    assert options == {
        "connect_timeout": 5,
        "read_timeout": 10,
        "retries": {"total_max_attempts": 3, "mode": "standard"},
        "request_checksum_calculation": "when_required",
        "response_checksum_validation": "when_required",
    }
    # One client per process for the same credentials.
    assert R2PhotoStore("fake-account", "fake-key-id", "fake-secret", "other").client is client

    key = photos_service.new_key()
    small, large = photos_service.object_names(key)
    with Stubber(client) as stubber:
        stubber.add_response(
            "put_object",
            {},
            {
                "Bucket": "fake-bucket",
                "Key": small,
                "Body": b"webp-bytes",
                "ContentType": "image/webp",
                "CacheControl": "public, max-age=31536000, immutable",
            },
        )
        stubber.add_response(
            "delete_objects",
            {},
            {
                "Bucket": "fake-bucket",
                "Delete": {"Objects": [{"Key": small}, {"Key": large}], "Quiet": True},
            },
        )
        store.put(small, b"webp-bytes")
        store.delete([small, large])
        stubber.assert_no_pending_responses()
    assert CACHE_CONTROL == "public, max-age=31536000, immutable"

    with Stubber(client) as stubber, caplog.at_level(logging.ERROR):
        stubber.add_client_error(
            "put_object", service_error_code="AccessDenied", http_status_code=403
        )
        stubber.add_client_error(
            "delete_objects", service_error_code="InternalError", http_status_code=500
        )
        with pytest.raises(PhotoStoreUnavailable):
            store.put(small, b"webp-bytes")
        with pytest.raises(PhotoStoreUnavailable):
            store.delete([small, large])
    assert "AccessDenied" in caplog.text
    assert "InternalError" in caplog.text
    for secret in (key, "fake-secret", "fake-key-id"):
        assert secret not in caplog.text


# --- review fixes: the encode pool, one upload in flight, refusals before the body ---------------


class _CountingStore(FilePhotoStore):
    def __init__(self, photo_dir: Path) -> None:
        super().__init__(photo_dir)
        self.puts = 0

    def put(self, name: str, data: bytes) -> None:
        self.puts += 1
        super().put(name, data)


def _read_spy(monkeypatch: pytest.MonkeyPatch) -> list[Request]:
    """Every `read_capped` call the upload routes make."""
    reads: list[Request] = []
    real_read = photos_router.read_capped

    async def spy(request: Request, cap: int) -> bytes:
        reads.append(request)
        return await real_read(request, cap)

    monkeypatch.setattr(photos_router, "read_capped", spy)
    return reads


def _slot_taken(owner_id: uuid.UUID) -> bool:
    return bool(get_redis().exists(photos_service.upload_slot_key(owner_id)))


def test_nf1_encode_runs_on_the_photo_pool(
    owner: TestClient,
    listing: uuid.UUID,
    photo_store: FilePhotoStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    threads: list[str] = []
    real_encode = photos_service.encode

    def spy(data: bytes) -> photos_service.Encoded:
        threads.append(threading.current_thread().name)
        return real_encode(data)

    monkeypatch.setattr(photos_service, "encode", spy)
    for _ in range(3):
        assert _upload(owner, listing, jpeg()).status_code == 201

    assert len(threads) == 3
    assert all(name.startswith("photo-encode") for name in threads), threads


def test_ac9_one_upload_in_flight_per_user(
    owner: TestClient,
    owner_id: uuid.UUID,
    listing: uuid.UUID,
    db_engine: Engine,
    photo_store: FilePhotoStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    entered, go = threading.Event(), threading.Event()
    real_encode = photos_service.encode

    def held(data: bytes) -> photos_service.Encoded:
        entered.set()
        assert go.wait(20)
        return real_encode(data)

    monkeypatch.setattr(photos_service, "encode", held)
    reads = _read_spy(monkeypatch)
    first: list[httpx.Response] = []
    thread = threading.Thread(target=lambda: first.append(_upload(owner, listing, jpeg())))
    thread.start()
    try:
        assert entered.wait(20)
        assert _slot_taken(owner_id)
        second = TestClient(owner.app, cookies=dict(owner.cookies))

        refused = _upload(second, listing, jpeg())

        assert (refused.status_code, refused.json()) == (429, {"detail": "rate_limited"})
        assert refused.headers["Retry-After"] == "5"
        assert len(reads) == 1  # the first upload's only: the second never read its body
    finally:
        go.set()
        thread.join(timeout=30)
    assert first[0].status_code == 201, first[0].text
    assert not _slot_taken(owner_id)
    assert _upload(owner, listing, jpeg()).status_code == 201
    assert len(_rows(db_engine, listing)) == 2


@pytest.mark.filterwarnings("ignore::PIL.Image.DecompressionBombWarning")
def test_ac9_upload_slot_freed_after_failures(
    client: TestClient,
    owner: TestClient,
    owner_id: uuid.UUID,
    listing: uuid.UUID,
    db_engine: Engine,
    photo_store: FilePhotoStore,
) -> None:
    failures: list[tuple[Any, bytes, int]] = [
        (listing, b"", 415),
        (listing, _save(Image.new("1", (10_000, 5_000)), "PNG"), 413),
        (uuid.uuid4(), jpeg(), 404),
    ]
    for listing_id, data, status in failures:
        assert _upload(owner, listing_id, data).status_code == status
        assert not _slot_taken(owner_id), status

    _app(client).dependency_overrides[get_photo_store] = _provide(
        _FailingPut(photo_store.photo_dir, fail_on=1)
    )
    assert _upload(owner, listing, jpeg()).status_code == 503
    assert not _slot_taken(owner_id)

    _app(client).dependency_overrides[get_photo_store] = _provide(photo_store)
    assert _upload(owner, listing, jpeg()).status_code == 201
    assert not _slot_taken(owner_id)
    assert len(_rows(db_engine, listing)) == 1


def test_ac5_refused_uploads_never_read_decode_or_store(
    client: TestClient,
    outbox: Outbox,
    owner: TestClient,
    owner_id: uuid.UUID,
    listing: uuid.UUID,
    gush_dan: uuid.UUID,
    db_engine: Engine,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    store = _CountingStore(tmp_path / "counted")
    _app(client).dependency_overrides[get_photo_store] = _provide(store)
    reads = _read_spy(monkeypatch)
    encodes: list[bytes] = []
    real_encode = photos_service.encode

    def spy(data: bytes) -> photos_service.Encoded:
        encodes.append(data)
        return real_encode(data)

    monkeypatch.setattr(photos_service, "encode", spy)
    full = make_listing(db_engine, owner_id, gush_dan)
    for position in range(10):
        make_photo(db_engine, full, position=position)
    o2 = signup(client, outbox, "o2@example.com", "owner")

    try:
        for caller, listing_id, expected in (
            (o2, listing, (404, NOT_FOUND)),
            (owner, uuid.uuid4(), (404, NOT_FOUND)),
            (owner, full, (409, {"detail": "photo_limit"})),
        ):
            response = _upload(caller, listing_id, jpeg())
            assert (response.status_code, response.json()) == expected
        assert (reads, encodes, store.puts) == ([], [], 0)
        assert _count_rows(db_engine) == 10

        assert _upload(owner, listing, jpeg()).status_code == 201  # the spies do see a real one
        assert (len(reads), len(encodes), store.puts) == (1, 1, 2)
    finally:
        _app(client).dependency_overrides.pop(get_photo_store, None)
