"""Moderation in the public app (spec 0012a): AC1-AC9, NF1, NF2 (AC9's migration round trip is in
`test_migrations.py`).

The admin dashboard (0012b) writes `users.suspended_at` and `listings.removed_at`; here they are
set with direct SQL. `World` is AC3's setup: a suspended-to-be user `U` ("Uri") with a live
apartment `A`, a live room `RU` with an invite token, a visible card, a shown flatmate place on
`O`'s live room `R2`, a mutual match with `P` ("Pia"), and a like for and an invite to the viewer
`S` ("Sam"). `O` also owns the room `R3`, whose people page `U` fits."""

import datetime as dt
import json
import logging
import uuid
from collections.abc import Iterator
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, event, text
from sqlalchemy.exc import IntegrityError

from app import limits
from app.services import chat_events
from app.services.photo_store import FilePhotoStore
from tests.conftest import (
    Outbox,
    jpeg,
    make_card,
    make_listing,
    make_owner,
    make_pair,
    make_photo,
    make_profile,
    make_seeker,
    set_location,
    signup,
)
from tests.test_flatmates import Published
from tests.test_listings import _body
from tests.test_map_search import BOX
from tests.test_market_people import _login
from tests.test_matching import _l0
from tests.test_photos import _read_spy, _upload

pytestmark = pytest.mark.usefixtures("redis_clean")

NOT_FOUND = {"detail": "not_found"}
REMOVED = {"detail": "listing_removed"}
U_EMAIL = "uri@example.com"


def _scalar(engine: Engine, sql: str, **params: Any) -> Any:
    with engine.connect() as conn:
        return conn.execute(text(sql), params).scalar()


def _execute(engine: Engine, sql: str, **params: Any) -> None:
    with engine.begin() as conn:
        conn.execute(text(sql), params)


def _ok(response: httpx.Response, code: int = 200) -> Any:
    assert response.status_code == code, response.text
    return response.json() if response.content else None


def _suspend(engine: Engine, user_id: uuid.UUID, on: bool = True) -> None:
    _execute(
        engine,
        "UPDATE users SET suspended_at = CASE WHEN :on THEN now() END WHERE id = :id",
        on=on,
        id=user_id,
    )


def _request_code(client: TestClient, outbox: Outbox, email: str) -> str:
    _ok(client.post("/auth/otp/request", json={"email": email}), 204)
    for line in outbox.messages[-1][2].splitlines():
        if line.strip().isdigit() and len(line.strip()) == 6:
            return line.strip()
    raise AssertionError("no code in the email")


def _verify(client: TestClient, email: str, code: str) -> httpx.Response:
    client.cookies.clear()
    response: httpx.Response = client.post("/auth/otp/verify", json={"email": email, "code": code})
    return response


def _room(engine: Engine, owner_id: uuid.UUID, area: uuid.UUID, **overrides: Any) -> str:
    """`L0` as a women's room for two flatmates."""
    values: dict[str, Any] = {
        "listing_type": "room",
        "flatmates_count": 2,
        "gender_preference": "women",
        **overrides,
    }
    return _l0(engine, owner_id, area, **values)


class World:
    def __init__(
        self, client: TestClient, engine: Engine, area: uuid.UUID, published: Published
    ) -> None:
        self.client = client
        self.engine = engine
        self.u_id = make_seeker(engine, U_EMAIL, "Uri")
        self.u_card = make_card(engine, self.u_id, area, gender="woman")
        self.u = _login(client, engine, self.u_id)
        self.apartment = _l0(engine, self.u_id, area)
        set_location(engine, uuid.UUID(self.apartment), 34.80, 32.08)
        self.u_room = _room(engine, self.u_id, area)
        self.token: str = _ok(self.u.post(f"/listings/{self.u_room}/flatmate-invite"), 201)["token"]

        self.o_id = make_owner(engine, "o@example.com")
        self.o = _login(client, engine, self.o_id)
        self.r2 = _room(engine, self.o_id, area)
        _execute(
            engine,
            "INSERT INTO listing_flatmates (listing_id, user_id, shown) VALUES (:l, :u, true)",
            l=self.r2,
            u=self.u_id,
        )
        self.r3 = _room(engine, self.o_id, area)

        self.s_id = make_seeker(engine, "sam@example.com", "Sam")
        self.s_card = make_card(engine, self.s_id, area, gender="woman")
        self.s = _login(client, engine, self.s_id)
        self.p_id = make_seeker(engine, "pia@example.com", "Pia")
        self.p_card = make_card(engine, self.p_id, area, gender="woman")
        self.p = _login(client, engine, self.p_id)

        # U and P match (a chat opens); U likes S (S's `liked_me`); U's room invites S.
        _ok(self.u.put(f"/people/{self.p_card}/like"))
        _ok(self.p.put(f"/people/{self.u_card}/like"))
        _ok(self.u.put(f"/people/{self.s_card}/like"))
        make_pair(engine, uuid.UUID(self.u_room), self.s_id, price_ils_seen=7000, lister_liked=True)

    def observe(self) -> dict[str, Any]:
        """Everything a read shows of U, from the other side (no writes)."""

        def ids(response: httpx.Response) -> set[str]:
            return {item["id"] for item in _ok(response)["items"]}

        def names(items: list[dict[str, Any]]) -> list[str]:
            return sorted(item["display_name"] for item in items)

        p_likes = _ok(self.p.get("/me/people-likes"))
        s_likes = _ok(self.s.get("/me/people-likes"))
        return {
            "search": ids(self.client.get("/listings?limit=50")),
            "bbox": ids(self.client.get(f"/listings?{BOX}&limit=50")),
            "market rooms": ids(self.s.get("/listings?listing_type=room&limit=50")),
            "apartment": self.s.get(f"/listings/{self.apartment}").status_code,
            "room": self.s.get(f"/listings/{self.u_room}").status_code,
            "R2 flatmates": names(_ok(self.s.get(f"/listings/{self.r2}"))["people"]),
            "people": names(_ok(self.s.get("/people"))["items"]),
            "S people-likes": {key: names(value) for key, value in s_likes.items()},
            "P matches": names(p_likes["matches"]),
            "S invites": [
                item["listing"]["id"] for item in _ok(self.s.get("/me/likes"))["liked_me"]
            ],
            "R3 people": names(_ok(self.o.get(f"/listings/{self.r3}/people"))["items"]),
            "preview": self.s.post(
                "/flatmate-invites/preview", json={"token": self.token}
            ).status_code,
        }


@pytest.fixture
def published(monkeypatch: pytest.MonkeyPatch) -> Published:
    """A mutual like opens a chat and publishes its event: recorded, not sent."""
    recorder = Published()
    monkeypatch.setattr(chat_events, "publish", recorder)
    return recorder


@pytest.fixture
def world(
    client: TestClient, db_engine: Engine, gush_dan: uuid.UUID, published: Published
) -> World:
    return World(client, db_engine, gush_dan, published)


def _hidden(world: World, before: dict[str, Any]) -> dict[str, Any]:
    """`before` with every trace of U taken out (the match row stays)."""
    gone = {world.apartment, world.u_room}
    return {
        **before,
        "search": before["search"] - gone,
        "bbox": before["bbox"] - gone,
        "market rooms": before["market rooms"] - gone,
        "apartment": 404,
        "room": 404,
        "R2 flatmates": [name for name in before["R2 flatmates"] if name != "Uri"],
        "people": [name for name in before["people"] if name != "Uri"],
        "S people-likes": {
            key: [name for name in value if name != "Uri"]
            for key, value in before["S people-likes"].items()
        },
        "S invites": [],
        "R3 people": [name for name in before["R3 people"] if name != "Uri"],
        "preview": 404,
    }


# --- AC1 ---------------------------------------------------------------------------------------


def test_ac1_suspended_session_stops_resolving(
    client: TestClient, db_engine: Engine, gush_dan: uuid.UUID
) -> None:
    user_id = make_seeker(db_engine, "x@example.com")
    make_profile(db_engine, user_id, gush_dan)
    other = make_owner(db_engine, "o@example.com")
    _l0(db_engine, other, gush_dan)
    caller = _login(client, db_engine, user_id)
    assert all(item["match"] is not None for item in _ok(caller.get("/listings"))["items"])

    _suspend(db_engine, user_id)
    for path in ("/me", "/me/listings"):
        response = caller.get(path)
        assert (response.status_code, response.json()) == (401, {"detail": "unauthenticated"})
    items = _ok(caller.get("/listings"))["items"]
    assert len(items) == 1
    assert all(item["match"] is None for item in items)


# --- AC2, NF2 ----------------------------------------------------------------------------------


def _sessions(engine: Engine, user_id: uuid.UUID) -> int:
    return int(_scalar(engine, "SELECT count(*) FROM sessions WHERE user_id = :id", id=user_id))


def test_ac2_suspended_account_cannot_sign_in(
    client: TestClient, outbox: Outbox, db_engine: Engine
) -> None:
    user_id = make_seeker(db_engine, U_EMAIL)
    _suspend(db_engine, user_id)

    code = _request_code(client, outbox, U_EMAIL)
    refused = _verify(client, U_EMAIL, code)
    assert (refused.status_code, refused.json()) == (403, {"detail": "account_suspended"})
    assert "set-cookie" not in refused.headers
    assert _sessions(db_engine, user_id) == 0
    assert _scalar(db_engine, "SELECT last_login_at FROM users WHERE id = :id", id=user_id) is None
    # The code was consumed: a right code would answer 403 again.
    again = _verify(client, U_EMAIL, code)
    assert (again.status_code, again.json()) == (401, {"detail": "invalid_code"})

    code = _request_code(client, outbox, U_EMAIL)
    wrong = _verify(client, U_EMAIL, "000000" if code != "000000" else "111111")
    assert (wrong.status_code, wrong.json()) == (401, {"detail": "invalid_code"})
    # A request answers as for any email (204), so suspension cannot be probed without the mailbox.
    assert client.post("/auth/otp/request", json={"email": U_EMAIL}).status_code == 204
    assert client.post("/auth/otp/request", json={"email": "new@example.com"}).status_code == 204


def test_nf2_no_email_in_logs(
    client: TestClient, outbox: Outbox, db_engine: Engine, caplog: pytest.LogCaptureFixture
) -> None:
    user_id = make_seeker(db_engine, U_EMAIL)
    _suspend(db_engine, user_id)
    caplog.set_level(logging.DEBUG)
    code = _request_code(client, outbox, U_EMAIL)
    assert _verify(client, U_EMAIL, code).status_code == 403
    assert _verify(client, U_EMAIL, code).status_code == 401
    for record in caplog.records:
        line = record.getMessage()
        assert U_EMAIL not in line, line
        assert str(user_id) not in line, line


# --- AC3, AC4 ----------------------------------------------------------------------------------


def _writes_refused(world: World) -> None:
    """Every write on U's listings, card and token answers 404, and nothing is written."""
    for response in (
        world.s.post(f"/listings/{world.apartment}/applications", json={"message": "Hello"}),
        world.s.post(
            "/reports",
            json={"target_type": "listing", "target_id": world.apartment, "reason": "broker"},
        ),
        world.s.put(f"/people/{world.u_card}/like"),
        world.s.post("/flatmate-invites/join", json={"token": world.token}),
    ):
        assert (response.status_code, response.json()) == (404, NOT_FOUND), response.request.url
    for table in ("applications", "reports"):
        assert _scalar(world.engine, f"SELECT count(*) FROM {table}") == 0, table
    assert (
        _scalar(
            world.engine,
            "SELECT count(*) FROM listing_flatmates WHERE user_id = :s",
            s=world.s_id,
        )
        == 0
    )


def test_ac3_suspended_user_hidden_everywhere(world: World) -> None:
    before = world.observe()
    # The setup shows U everywhere first, so each check below is a real disappearance.
    assert {world.apartment} <= before["search"] and {world.apartment} <= before["bbox"]
    assert {world.u_room, world.r2, world.r3} <= before["market rooms"]
    assert (before["apartment"], before["room"], before["preview"]) == (200, 200, 200)
    assert before["R2 flatmates"] == ["Uri"]
    assert "Uri" in before["people"] and "Uri" in before["R3 people"]
    assert before["S people-likes"]["liked_me"] == ["Uri"]
    assert before["P matches"] == ["Uri"]
    assert before["S invites"] == [world.u_room]

    _suspend(world.engine, world.u_id)
    after = world.observe()
    assert after == _hidden(world, before)
    assert after["P matches"] == ["Uri"]  # the match row stays: the chat's entry
    _writes_refused(world)


def test_ac4_lifting_suspension_restores_everything(
    world: World, outbox: Outbox, published: Published
) -> None:
    before = world.observe()
    _suspend(world.engine, world.u_id)
    _writes_refused(world)
    _suspend(world.engine, world.u_id, on=False)

    assert world.observe() == before
    code = _request_code(world.client, outbox, U_EMAIL)
    assert _verify(world.client, U_EMAIL, code).status_code == 200
    _ok(world.s.post(f"/listings/{world.apartment}/applications", json={"message": "Hello"}), 201)
    _ok(
        world.s.post(
            "/reports",
            json={"target_type": "listing", "target_id": world.apartment, "reason": "broker"},
        ),
        201,
    )
    _ok(world.s.put(f"/people/{world.u_card}/like"))
    _ok(world.s.post("/flatmate-invites/join", json={"token": world.token}))


# --- AC5, AC6, AC7 -----------------------------------------------------------------------------


def _removed_listing(engine: Engine, owner_id: uuid.UUID, area: uuid.UUID) -> uuid.UUID:
    return make_listing(engine, owner_id, area, status="paused", removed_at=dt.datetime.now(dt.UTC))


def _snapshot(engine: Engine, listing_id: uuid.UUID) -> tuple[Any, ...]:
    with engine.connect() as conn:
        row = conn.execute(text("SELECT * FROM listings WHERE id = :id"), {"id": listing_id}).one()
        photos = conn.execute(
            text("SELECT id, position FROM listing_photos WHERE listing_id = :id ORDER BY id"),
            {"id": listing_id},
        ).all()
    return tuple(row), tuple(photos)


def test_ac5_removed_listing_refuses_owner_writes(
    client: TestClient,
    outbox: Outbox,
    db_engine: Engine,
    gush_dan: uuid.UUID,
    photo_store: FilePhotoStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner = signup(client, outbox, "o@example.com", "owner")
    owner_id = uuid.UUID(owner.get("/me").json()["id"])
    # Past its expiry too: removed is checked first (before listing_expired, renewal_not_open).
    listing = make_listing(
        db_engine,
        owner_id,
        gush_dan,
        status="paused",
        removed_at=dt.datetime.now(dt.UTC),
        expires_at=dt.datetime.now(dt.UTC) - dt.timedelta(days=1),
    )
    photos = [make_photo(db_engine, listing, position=n) for n in range(2)]
    before = _snapshot(db_engine, listing)
    reads = _read_spy(monkeypatch)

    for response in (
        owner.patch(f"/listings/{listing}", json={"price_ils": 6000}),
        owner.patch(f"/listings/{listing}", json={"status": "active"}),
        owner.post(f"/listings/{listing}/renew"),
        _upload(owner, listing, jpeg()),
        owner.delete(f"/listings/{listing}/photos/{photos[0]}"),
        owner.put(
            f"/listings/{listing}/photos/order",
            json={"photo_ids": [str(photos[1]), str(photos[0])]},
        ),
    ):
        assert (response.status_code, response.json()) == (409, REMOVED), response.request.url
    assert reads == []  # the upload refused before reading its body
    assert _snapshot(db_engine, listing) == before

    _ok(owner.put(f"/listings/{listing}/closure", json={"reason": "not_renting"}), 204)
    _ok(owner.get(f"/listings/{listing}/applications"))


def test_ac6_removed_listing_frees_cap(
    client: TestClient, outbox: Outbox, db_engine: Engine, gush_dan: uuid.UUID
) -> None:
    owner = signup(client, outbox, "o@example.com", "owner")
    owner_id = uuid.UUID(owner.get("/me").json()["id"])
    removed = _removed_listing(db_engine, owner_id, gush_dan)
    for _ in range(3):  # the default cap
        _ok(owner.post("/listings", json=_body(gush_dan)), 201)
    rows = {row["id"]: row for row in _ok(owner.get("/me/listings"))}
    assert len(rows) == 4
    assert rows[str(removed)]["removed"] is True
    assert [row["removed"] for key, row in rows.items() if key != str(removed)] == [False] * 3


def test_ac7_removed_listing_never_active(db_engine: Engine, gush_dan: uuid.UUID) -> None:
    owner_id = make_owner(db_engine, "o@example.com")
    live = make_listing(db_engine, owner_id, gush_dan)
    removed = _removed_listing(db_engine, owner_id, gush_dan)
    for sql, listing in (
        ("UPDATE listings SET removed_at = now() WHERE id = :id", live),
        ("UPDATE listings SET status = 'active' WHERE id = :id", removed),
    ):
        with pytest.raises(IntegrityError, match="ck_listings_removed_paused"):
            _execute(db_engine, sql, id=listing)


# --- AC8 ---------------------------------------------------------------------------------------


def test_ac8_me_returns_listing_cap(
    client: TestClient,
    outbox: Outbox,
    db_engine: Engine,
    gush_dan: uuid.UUID,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(limits, "CREATE", limits.Bucket("create", 100, 100))
    owner = signup(client, outbox, "o@example.com", "owner")
    assert _ok(owner.get("/me"))["listing_cap"] == 3
    _execute(db_engine, "UPDATE users SET listing_cap = 10 WHERE email = 'o@example.com'")
    assert _ok(owner.get("/me"))["listing_cap"] == 10
    for _ in range(10):
        _ok(owner.post("/listings", json=_body(gush_dan)), 201)
    refused = owner.post("/listings", json=_body(gush_dan))
    assert (refused.status_code, refused.json()) == (409, {"detail": "listing_cap_reached"})


# --- AC9 ---------------------------------------------------------------------------------------


def test_ac9_admin_actions_checks(db_engine: Engine) -> None:
    insert = (
        "INSERT INTO admin_actions (action, target_type, target_id, detail)"
        " VALUES (:action, :type, gen_random_uuid(), :detail)"
    )
    good = {"action": "set_listing_cap", "type": "user", "detail": "3→10"}
    for constraint, bad in (
        ("ck_admin_actions_action", {"action": "delete_user"}),
        ("ck_admin_actions_target_type", {"type": "person"}),
        ("ck_admin_actions_detail_length", {"detail": ""}),
        ("ck_admin_actions_detail_length", {"detail": "x" * 201}),
    ):
        with pytest.raises(IntegrityError, match=constraint):
            _execute(db_engine, insert, **{**good, **bad})
    _execute(db_engine, insert, **good)
    _execute(db_engine, insert, **{**good, "detail": "x" * 200})
    _execute(db_engine, insert, **{**good, "action": "suspend", "detail": None})
    assert _scalar(db_engine, "SELECT count(*) FROM admin_actions") == 3


# --- NF1 ---------------------------------------------------------------------------------------


def _users_scans(node: dict[str, Any], parent: str = "") -> Iterator[tuple[str, dict[str, Any]]]:
    """Every `(parent node type, node)` of an `EXPLAIN (FORMAT JSON)` tree that reads `users`."""
    if node.get("Relation Name") == "users":
        yield parent, node
    for child in node.get("Plans", []):
        yield from _users_scans(child, node["Node Type"])


def test_nf1_owner_check_uses_pk(
    client: TestClient, db_engine: Engine, gush_dan: uuid.UUID
) -> None:
    """The search's "owner not suspended" check never reads `users` once per listing without an
    index: each read is a `users_pkey` probe (an Index Cond), or one pass over the few suspended
    rows built once (under a Materialize or a Hash). Planned at scale, with fresh statistics:
    2,000 owners with a live apartment each."""
    _execute(
        db_engine,
        "INSERT INTO users (email, display_name, role)"
        " SELECT 'owner' || g || '@example.com', 'name', 'owner' FROM generate_series(1, 2000) g",
    )
    _execute(
        db_engine,
        "INSERT INTO listings (owner_id, area_id, listing_type, city, street, rooms, floor,"
        " size_sqm, price_ils, available_from, entry_flexible, elevator, parking_spots, furnished,"
        " pets_allowed, expires_at) SELECT id, :area, 'apartment', 'גבעתיים', 'כצנלסון', 3, 1, 80,"
        " 7000, current_date + 30, true, true, 0, 'none', true, now() + interval '90 days'"
        " FROM users",
        area=gush_dan,
    )
    suspended = make_owner(db_engine, "suspended@example.com")
    _l0(db_engine, suspended, gush_dan)
    _suspend(db_engine, suspended)
    seeker_id = make_seeker(db_engine, "s@example.com")
    make_profile(db_engine, seeker_id, gush_dan)
    _execute(db_engine, "ANALYZE users, listings")
    seeker = _login(client, db_engine, seeker_id)
    seeker.get("/me")  # warm-up: a first connect sends its own setup statements

    seen: list[tuple[str, Any]] = []

    def record(_conn: Any, _cursor: Any, statement: str, parameters: Any, *_: Any) -> None:
        if "FROM listings" in statement:
            seen.append((statement, parameters))

    event.listen(db_engine, "before_cursor_execute", record)
    try:
        for caller in (client, seeker):  # a visitor's search, and a seeker's (with the match)
            assert _ok(caller.get("/listings"))["total"] == 2000
    finally:
        event.remove(db_engine, "before_cursor_execute", record)
    assert len(seen) == 4  # the count and the page, twice

    for statement, parameters in seen:
        with db_engine.connect() as conn:
            conn.exec_driver_sql("SET LOCAL enable_seqscan = off")
            (plan,) = conn.exec_driver_sql(
                "EXPLAIN (FORMAT JSON) " + statement, parameters
            ).scalar_one()
            conn.rollback()
        scans = list(_users_scans(plan["Plan"]))
        assert scans, plan
        for parent, scan in scans:
            assert scan["Node Type"] in ("Index Scan", "Index Only Scan"), json.dumps(plan)
            assert scan["Index Name"] == "users_pkey", json.dumps(plan)
            probe = "Index Cond" in scan
            once = parent in ("Materialize", "Hash") and "suspended_at IS NOT NULL" in scan.get(
                "Filter", ""
            )
            assert probe or once, json.dumps(plan)
