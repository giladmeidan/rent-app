"""Tour emails (spec 0018c): the hook's queue items, delivery by change and recipient, retries,
reminders and the rendered text. Drives 0018a's real endpoints where a change is the subject;
pushes items directly where the delivery rules are.

`O` ("Noa", o@example.com) owns live apartment `L` (כצנלסון, גבעתיים); `S` ("Dana",
s@example.com) has a `shortlisted` application `A` to it. `W` is a window of `L` whose free
30-minute slots start at base +65 ... +155 minutes (see `test_tours.py`)."""

import datetime as dt
import json
import logging
import uuid
from collections.abc import Callable, Sequence
from typing import Any

import pytest
import redis
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from app import redis_client
from app.config import get_settings
from app.i18n import he
from app.redis_client import get_redis
from app.services import ics, tour_mail
from app.services.email import Attachment, EmailUnavailable
from tests.conftest import Outbox, make_listing, signup
from tests.test_tours import (
    MIN,
    _at,
    _book,
    _cancel,
    _execute,
    _ok,
    _reschedule,
    _scalar,
    _user_id,
    db_now,
    make_tour,
    make_window,
    shortlisted,
    tour_lines,
    tour_row,
)

pytestmark = pytest.mark.usefixtures("redis_clean")

O_EMAIL, S_EMAIL = "o@example.com", "s@example.com"
HOUR = dt.timedelta(hours=1)


# --- fixtures (as test_tours.py's) ------------------------------------------------------------


@pytest.fixture
def owner(client: TestClient, outbox: Outbox) -> TestClient:
    return signup(client, outbox, O_EMAIL, "owner", display_name="Noa")


@pytest.fixture
def owner_id(owner: TestClient) -> uuid.UUID:
    return _user_id(owner)


@pytest.fixture
def seeker(client: TestClient, outbox: Outbox) -> TestClient:
    return signup(client, outbox, S_EMAIL, "seeker", display_name="Dana")


@pytest.fixture
def seeker_id(seeker: TestClient) -> uuid.UUID:
    return _user_id(seeker)


@pytest.fixture
def listing(owner_id: uuid.UUID, gush_dan: uuid.UUID, db_engine: Engine) -> uuid.UUID:
    return make_listing(db_engine, owner_id, gush_dan)


@pytest.fixture
def application(
    listing: uuid.UUID, seeker_id: uuid.UUID, owner_id: uuid.UUID, db_engine: Engine
) -> uuid.UUID:
    return shortlisted(db_engine, listing, seeker_id, owner_id)


@pytest.fixture
def base(db_engine: Engine) -> dt.datetime:
    return db_now(db_engine).replace(second=0, microsecond=0)


@pytest.fixture
def window(listing: uuid.UUID, base: dt.datetime, db_engine: Engine) -> uuid.UUID:
    return make_window(db_engine, listing, base - 55 * MIN, base + 185 * MIN, 30)


# --- helpers -----------------------------------------------------------------------------------


def _queue() -> list[dict[str, Any]]:
    return [json.loads(raw) for raw in get_redis().lrange(tour_mail.QUEUE_KEY, 0, -1)]


def _push(*items: Any) -> None:
    get_redis().rpush(
        tour_mail.QUEUE_KEY,
        *(item if isinstance(item, bytes) else json.dumps(item) for item in items),
    )


def _item(tour_id: Any, change: str, **extra: Any) -> dict[str, Any]:
    return {"tour_id": str(tour_id), "change": change, "attempt": 0, **extra}


def _send(engine: Engine, sender: Any) -> dict[str, int]:
    with Session(engine) as db:
        return tour_mail.send_pending(db, get_redis(), sender)


def _reminders(engine: Engine) -> int:
    with Session(engine) as db:
        return tour_mail.queue_reminders(db, get_redis())


def _fresh(outbox: Outbox) -> Outbox:
    """The outbox without the signups' login codes."""
    outbox.messages.clear()
    outbox.attachments.clear()
    return outbox


def _ics(attachments: Sequence[Attachment]) -> dict[str, str]:
    """The one `tour.ics`'s properties (name → value; each name once in a tour's calendar)."""
    (attachment,) = attachments
    assert attachment.filename == "tour.ics"
    props: dict[str, str] = {}
    for line in attachment.content.replace("\r\n ", "").split("\r\n"):
        if ":" in line:
            name, value = line.split(":", 1)
            props.setdefault(name, value)
    assert attachment.content_type == (f"text/calendar; method={props['METHOD']}; charset=utf-8")
    return props


def _mail(outbox: Outbox) -> dict[str, tuple[str, str, dict[str, str] | None]]:
    """Each recipient's one message as (subject, body, ics properties or None)."""
    recipients = [to for to, _, _ in outbox.messages]
    assert len(recipients) == len(set(recipients)), recipients
    return {
        to: (subject, body, _ics(attachments) if attachments else None)
        for (to, subject, body), (_, attachments) in zip(
            outbox.messages, outbox.attachments, strict=True
        )
    }


def _claimed(engine: Engine, tour_id: Any) -> None:
    """Mark the tour's reminder claimed, as `queue_reminders` does before it pushes the item."""
    _execute(engine, "UPDATE tours SET reminder_sent_at = now() WHERE id = :t", t=tour_id)


def _backdate(engine: Engine, tour_id: Any) -> None:
    """`updated_at` one minute back, so the next change's SEQUENCE cannot tie within a second."""
    _execute(
        engine,
        "UPDATE tours SET updated_at = updated_at - interval '1 minute' WHERE id = :t",
        t=tour_id,
    )


def _counts(sent: int = 0, skipped: int = 0, retried: int = 0, dropped: int = 0) -> dict[str, int]:
    return {"sent": sent, "skipped": skipped, "retried": retried, "dropped": dropped}


def _booked_tour(client: TestClient, application_id: Any, starts_at: dt.datetime) -> Any:
    return _ok(_book(client, application_id, starts_at), 201)["id"]


# --- AC1-AC3: the changes ---------------------------------------------------------------------


@pytest.mark.usefixtures("window")
def test_ac1_booking_emails_both_with_ics(
    seeker: TestClient, application: uuid.UUID, base: dt.datetime, outbox: Outbox, db_engine: Engine
) -> None:
    starts_at = _at(base, 65)
    tour_id = _booked_tour(seeker, application, starts_at)
    assert _queue() == [_item(tour_id, "booked")]

    assert _send(db_engine, _fresh(outbox)) == _counts(sent=2)

    mail = _mail(outbox)
    assert set(mail) == {O_EMAIL, S_EMAIL}
    for to, (subject, body, props) in mail.items():
        assert subject == he.TOUR_BOOKED_SUBJECT
        assert (O_EMAIL if to == S_EMAIL else S_EMAIL) not in body
        assert props is not None
        assert props["METHOD"] == "PUBLISH" and props["STATUS"] == "CONFIRMED"
        assert props["UID"] == f"{tour_id}@homie"
        assert props["DTSTART"] == ics.fmt_utc(starts_at)
        assert props["DTEND"] == ics.fmt_utc(starts_at + 30 * MIN)
    assert mail[O_EMAIL][1].startswith("נקבע סיור עם Dana.")
    assert mail[S_EMAIL][1].startswith("הסיור נקבע.")
    assert _queue() == []


@pytest.mark.usefixtures("window")
def test_ac2_reschedule_same_uid_higher_sequence(
    seeker: TestClient, application: uuid.UUID, base: dt.datetime, outbox: Outbox, db_engine: Engine
) -> None:
    tour_id = _booked_tour(seeker, application, _at(base, 65))
    _send(db_engine, _fresh(outbox))
    booked_sequence = int(_mail(outbox)[O_EMAIL][2]["SEQUENCE"])  # type: ignore[index]
    _execute(
        db_engine,
        "UPDATE tours SET updated_at = updated_at - interval '1 minute' WHERE id = :t",
        t=tour_id,
    )
    booked_sequence -= 60  # what the backdated booking's SEQUENCE reads

    _ok(_reschedule(seeker, tour_id, _at(base, 125)))
    assert _queue() == [_item(tour_id, "rescheduled")]
    assert _send(db_engine, _fresh(outbox)) == _counts(sent=2)

    mail = _mail(outbox)
    assert set(mail) == {O_EMAIL, S_EMAIL}
    for subject, _body, props in mail.values():
        assert subject == he.TOUR_RESCHEDULED_SUBJECT
        assert props is not None
        assert props["UID"] == f"{tour_id}@homie" and props["METHOD"] == "PUBLISH"
        assert int(props["SEQUENCE"]) > booked_sequence
        assert props["DTSTART"] == ics.fmt_utc(_at(base, 125))


@pytest.mark.usefixtures("window")
def test_ac3_cancel_recipients_by_cancelled_by(
    owner: TestClient,
    seeker: TestClient,
    owner_id: uuid.UUID,
    seeker_id: uuid.UUID,
    listing: uuid.UUID,
    application: uuid.UUID,
    base: dt.datetime,
    gush_dan: uuid.UUID,
    outbox: Outbox,
    db_engine: Engine,
    set_env: Callable[..., None],
) -> None:
    set_env(EMAIL_FROM="homie <tours@homie.example>")

    def book_then_sequence(starts_at: dt.datetime) -> tuple[Any, int]:
        tour_id = _booked_tour(seeker, application, starts_at)
        _send(db_engine, _fresh(outbox))
        _backdate(db_engine, tour_id)
        # What the backdated booking's SEQUENCE reads.
        return tour_id, int(_mail(outbox)[O_EMAIL][2]["SEQUENCE"]) - 60  # type: ignore[index]

    def cancel_mail(tour_id: Any, sequence: int) -> dict[str, tuple[str, str]]:
        mail = _mail(outbox)
        for subject, _body, props in mail.values():
            assert subject == he.TOUR_CANCELLED_SUBJECT
            assert props is not None
            assert (props["METHOD"], props["STATUS"]) == ("CANCEL", "CANCELLED")
            assert props["UID"] == f"{tour_id}@homie"
            assert int(props["SEQUENCE"]) > sequence
            # The address alone, though EMAIL_FROM carries a display name.
            assert props["ORGANIZER;CN=homie"] == "mailto:tours@homie.example"
        return {to: (subject, body) for to, (subject, body, _) in mail.items()}

    # The seeker cancels: only the lister hears.
    tour_id, sequence = book_then_sequence(_at(base, 65))
    _ok(_cancel(seeker, tour_id))
    assert _queue() == [_item(tour_id, "cancelled_by_seeker")]
    assert _send(db_engine, _fresh(outbox)) == _counts(sent=1)
    mail = cancel_mail(tour_id, sequence)
    assert set(mail) == {O_EMAIL}
    assert mail[O_EMAIL][1].startswith("הסיור עם Dana בוטל.")

    # The lister cancels: only the seeker hears.
    tour_id, sequence = book_then_sequence(_at(base, 95))
    _ok(_cancel(owner, tour_id))
    assert _send(db_engine, _fresh(outbox)) == _counts(sent=1)
    mail = cancel_mail(tour_id, sequence)
    assert set(mail) == {S_EMAIL}
    assert mail[S_EMAIL][1].startswith("הסיור עם Noa בוטל.")

    # A system cancel (pausing the listing) reaches both, with the system text.
    tour_id, sequence = book_then_sequence(_at(base, 125))
    assert owner.patch(f"/listings/{listing}", json={"status": "paused"}).status_code == 200
    assert _queue() == [_item(tour_id, "cancelled_by_system")]
    assert _send(db_engine, _fresh(outbox)) == _counts(sent=2)
    mail = cancel_mail(tour_id, sequence)
    assert set(mail) == {O_EMAIL, S_EMAIL}
    system = he.TOUR_CANCELLED_SYSTEM_BODY.split("\n")[0]
    assert mail[O_EMAIL][1].startswith(system.format(name="Dana"))
    assert mail[S_EMAIL][1].startswith(system.format(name="Noa"))

    # So does the seeker's withdrawal.
    other = make_listing(db_engine, owner_id, gush_dan)
    other_application = shortlisted(db_engine, other, seeker_id, owner_id)
    other_tour = make_tour(db_engine, other, other_application, seeker_id, db_now(db_engine) + HOUR)
    _backdate(db_engine, other_tour)
    sequence = int(
        _scalar(
            db_engine,
            "SELECT extract(epoch FROM updated_at) FROM tours WHERE id = :t",
            t=other_tour,
        )
    )
    assert seeker.post(f"/me/applications/{other_application}/withdraw").status_code == 200
    assert _send(db_engine, _fresh(outbox)) == _counts(sent=2)
    mail = cancel_mail(other_tour, sequence)
    assert mail[O_EMAIL][1].startswith(system.format(name="Dana"))
    assert mail[S_EMAIL][1].startswith(system.format(name="Noa"))


# --- AC4-AC6: delivery rules ------------------------------------------------------------------


def test_ac4_skips_deleted_and_suspended(
    owner_id: uuid.UUID,
    seeker_id: uuid.UUID,
    listing: uuid.UUID,
    application: uuid.UUID,
    outbox: Outbox,
    db_engine: Engine,
) -> None:
    tour_id = make_tour(db_engine, listing, application, seeker_id, db_now(db_engine) + 3 * HOUR)
    _claimed(db_engine, tour_id)

    # A suspended seeker gets nothing; the lister still does.
    _execute(db_engine, "UPDATE users SET suspended_at = now() WHERE id = :u", u=seeker_id)
    _push(_item(tour_id, "reminder"))
    assert _send(db_engine, _fresh(outbox)) == _counts(sent=1, skipped=1)
    assert [to for to, _, _ in outbox.messages] == [O_EMAIL]

    # A deleted lister (scrubbed) gets nothing; the seeker reads the deleted name.
    _execute(db_engine, "UPDATE users SET suspended_at = NULL WHERE id = :u", u=seeker_id)
    _execute(
        db_engine,
        "UPDATE users SET deleted_at = now(), email = NULL, display_name = NULL, photo_key = NULL"
        " WHERE id = :u",
        u=owner_id,
    )
    _push(_item(tour_id, "reminder"))
    assert _send(db_engine, _fresh(outbox)) == _counts(sent=1, skipped=1)
    ((to, subject, body),) = outbox.messages
    assert (to, subject) == (S_EMAIL, he.TOUR_REMINDER_SUBJECT)
    assert body.startswith(f"תזכורת: מחר יש סיור עם {he.TOUR_DELETED_NAME}.")


def test_ac5_stale_items_skipped(
    seeker_id: uuid.UUID,
    listing: uuid.UUID,
    application: uuid.UUID,
    outbox: Outbox,
    db_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    now = db_now(db_engine)
    cancelled = make_tour(db_engine, listing, application, seeker_id, now + 2 * HOUR)
    _execute(
        db_engine,
        "UPDATE tours SET status = 'cancelled', cancelled_by = 'seeker', cancelled_at = now()"
        " WHERE id = :t",
        t=cancelled,
    )
    booked = make_tour(db_engine, listing, application, seeker_id, now + 3 * HOUR)
    broken = make_tour(db_engine, listing, application, seeker_id, now + 4 * HOUR)
    load = tour_mail._load

    def flaky(db: Session, tour_id: uuid.UUID) -> Any:
        if tour_id == broken:
            raise RuntimeError("boom o@example.com")
        return load(db, tour_id)

    monkeypatch.setattr(tour_mail, "_load", flaky)
    _push(
        _item(cancelled, "booked"),  # the tour is cancelled now
        _item(booked, "cancelled_by_lister"),  # the tour is still booked
        _item(uuid.uuid4(), "booked"),  # the tour is gone
        b"not json",
        b"[1, 2]",
        {"tour_id": "nope", "change": "booked", "attempt": 0},
        {"tour_id": str(booked), "change": "booked"},  # no attempt
        _item(booked, "booked", to="flatmate"),
        _item(booked, "exploded"),  # unknown change
        _item(broken, "booked"),  # its load raises: dropped, the next is still sent
        _item(booked, "booked"),
    )

    with caplog.at_level(logging.WARNING, logger=tour_mail.__name__):
        assert _send(db_engine, _fresh(outbox)) == _counts(sent=2, skipped=3, dropped=7)

    assert sorted(to for to, _, _ in outbox.messages) == [O_EMAIL, S_EMAIL]
    assert _queue() == []
    assert "tour mail item failed: RuntimeError" in caplog.text
    for leaked in ("o@example.com", str(broken), str(booked), "boom"):
        assert leaked not in caplog.text


def test_ac6_retry_per_recipient_then_drop(
    seeker_id: uuid.UUID,
    listing: uuid.UUID,
    application: uuid.UUID,
    outbox: Outbox,
    db_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class SeekerDown(Outbox):
        def send(
            self, to: str, subject: str, body: str, attachments: Sequence[Attachment] = ()
        ) -> None:
            if to == S_EMAIL:
                raise EmailUnavailable
            super().send(to, subject, body, attachments)

    sender = SeekerDown()
    tour_id = make_tour(db_engine, listing, application, seeker_id, db_now(db_engine) + 3 * HOUR)
    _push(_item(tour_id, "booked"))

    assert _send(db_engine, sender) == _counts(sent=1, retried=1)
    assert _queue() == [_item(tour_id, "booked", to="seeker") | {"attempt": 1}]
    assert _send(db_engine, sender) == _counts(retried=1)
    assert _queue() == [_item(tour_id, "booked", to="seeker") | {"attempt": 2}]
    assert _send(db_engine, sender) == _counts(dropped=1)
    assert _queue() == []
    assert [to for to, _, _ in sender.messages] == [O_EMAIL]  # the lister once

    # Redis refuses the lister's retry: only that side is dropped, the seeker's is still queued.
    class BothDown(Outbox):
        def send(
            self, to: str, subject: str, body: str, attachments: Sequence[Attachment] = ()
        ) -> None:
            raise EmailUnavailable

    _push(_item(tour_id, "booked"))
    rpush = get_redis().rpush
    refused: list[Any] = []

    def first_refused(*args: Any) -> Any:
        if not refused:
            refused.append(args)
            raise redis.ConnectionError("redis down")
        return rpush(*args)

    monkeypatch.setattr(get_redis(), "rpush", first_refused)
    assert _send(db_engine, BothDown()) == _counts(retried=1, dropped=1)
    assert _queue() == [_item(tour_id, "booked", to="seeker") | {"attempt": 1}]


# --- AC7: the hook ----------------------------------------------------------------------------


@pytest.mark.usefixtures("window")
def test_ac7_hook_enqueues_and_survives_redis_down(
    owner: TestClient,
    seeker: TestClient,
    owner_id: uuid.UUID,
    seeker_id: uuid.UUID,
    listing: uuid.UUID,
    application: uuid.UUID,
    base: dt.datetime,
    gush_dan: uuid.UUID,
    db_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def drained() -> list[dict[str, Any]]:
        items = _queue()
        get_redis().delete(tour_mail.QUEUE_KEY)
        return items

    tour_id = _booked_tour(seeker, application, _at(base, 65))
    assert drained() == [_item(tour_id, "booked")]
    _ok(_reschedule(seeker, tour_id, _at(base, 95)))
    assert drained() == [_item(tour_id, "rescheduled")]
    _ok(_cancel(seeker, tour_id))
    assert drained() == [_item(tour_id, "cancelled_by_seeker")]
    tour_id = _booked_tour(seeker, application, _at(base, 65))
    drained()
    _ok(_cancel(owner, tour_id))
    assert drained() == [_item(tour_id, "cancelled_by_lister")]

    # The system cancels, each on its own listing: pause, un-shortlist, withdraw, DELETE /me.
    def tour_on_new_listing() -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
        new_listing = make_listing(db_engine, owner_id, gush_dan)
        new_application = shortlisted(db_engine, new_listing, seeker_id, owner_id)
        new_tour = make_tour(
            db_engine, new_listing, new_application, seeker_id, db_now(db_engine) + 3 * HOUR
        )
        return new_listing, new_application, new_tour

    paused, _, tour_id = tour_on_new_listing()
    assert owner.patch(f"/listings/{paused}", json={"status": "paused"}).status_code == 200
    assert drained() == [_item(tour_id, "cancelled_by_system")]
    unlisted, unlisted_application, tour_id = tour_on_new_listing()
    response = owner.patch(
        f"/listings/{unlisted}/applications/{unlisted_application}", json={"status": "submitted"}
    )
    assert response.status_code == 200, response.text
    assert drained() == [_item(tour_id, "cancelled_by_system")]
    _, withdrawn_application, tour_id = tour_on_new_listing()
    assert seeker.post(f"/me/applications/{withdrawn_application}/withdraw").status_code == 200
    assert drained() == [_item(tour_id, "cancelled_by_system")]

    # Redis down at the enqueue: the booking still succeeds with its chat line; the item is lost.
    def refuse(*_args: Any, **_kwargs: Any) -> int:
        raise redis.ConnectionError("redis down")

    with monkeypatch.context() as patched:
        patched.setattr(get_redis(), "rpush", refuse)
        response = _book(seeker, application, _at(base, 125))
    assert response.status_code == 201, response.text
    down_tour = response.json()["id"]
    assert tour_row(db_engine, down_tour).status == "booked"
    assert tour_lines(seeker, application)[-1][0] == "booked"
    assert drained() == []
    redis_client._soft_skip_until = 0.0  # the outage's skip window has passed

    # DELETE /me cancels both remaining tours (A's and the last new listing's).
    _, _, tour_id = tour_on_new_listing()
    assert seeker.delete("/me").status_code == 204
    assert sorted(drained(), key=lambda i: i["tour_id"]) == sorted(
        [_item(down_tour, "cancelled_by_system"), _item(tour_id, "cancelled_by_system")],
        key=lambda i: i["tour_id"],
    )


# --- AC8-AC9: reminders -----------------------------------------------------------------------


def _at_db(engine: Engine, tour_id: uuid.UUID, starts_in: str, updated: str) -> None:
    """Set the tour's time to `now() + starts_in` (30 minutes long) and `updated_at` to the SQL
    expression `updated` (over the new `starts_at`)."""
    _execute(
        engine,
        "UPDATE tours SET starts_at = now() + CAST(:s AS interval),"
        " ends_at = now() + CAST(:s AS interval) + interval '30 minutes' WHERE id = :t",
        s=starts_in,
        t=tour_id,
    )
    _execute(engine, f"UPDATE tours SET updated_at = {updated} WHERE id = :t", t=tour_id)


def test_ac8_reminder_window(
    seeker_id: uuid.UUID,
    listing: uuid.UUID,
    application: uuid.UUID,
    outbox: Outbox,
    db_engine: Engine,
) -> None:
    now = db_now(db_engine)
    tours = {
        name: make_tour(db_engine, listing, application, seeker_id, now + (i + 1) * HOUR)
        for i, name in enumerate(("due", "far", "fresh", "cancelled", "past"))
    }
    _at_db(db_engine, tours["due"], "23 hours", "now() - interval '3 days'")
    _at_db(db_engine, tours["far"], "25 hours", "now() - interval '3 days'")
    _at_db(db_engine, tours["fresh"], "22 hours", "starts_at - interval '10 hours'")
    _at_db(db_engine, tours["cancelled"], "21 hours", "now() - interval '3 days'")
    _execute(
        db_engine,
        "UPDATE tours SET status = 'cancelled', cancelled_by = 'lister', cancelled_at = now()"
        " WHERE id = :t",
        t=tours["cancelled"],
    )
    _at_db(db_engine, tours["past"], "-1 hour", "now() - interval '3 days'")

    assert _reminders(db_engine) == 1
    assert _queue() == [_item(tours["due"], "reminder")]
    claimed = _scalar(
        db_engine, "SELECT array_agg(id) FROM tours WHERE reminder_sent_at IS NOT NULL"
    )
    assert claimed == [tours["due"]]

    assert _send(db_engine, _fresh(outbox)) == _counts(sent=2)
    mail = _mail(outbox)
    assert set(mail) == {O_EMAIL, S_EMAIL}
    for subject, _body, props in mail.values():
        assert subject == he.TOUR_REMINDER_SUBJECT
        assert props is None  # a reminder carries no .ics


def test_ac9_reminder_idempotent_and_rearmed(
    seeker: TestClient,
    seeker_id: uuid.UUID,
    listing: uuid.UUID,
    application: uuid.UUID,
    base: dt.datetime,
    outbox: Outbox,
    db_engine: Engine,
) -> None:
    tour_id = make_tour(db_engine, listing, application, seeker_id, base + HOUR)
    _at_db(db_engine, tour_id, "23 hours", "now() - interval '3 days'")
    assert _reminders(db_engine) == 1
    assert _reminders(db_engine) == 0  # claimed once

    # A reschedule to a day and a half ahead re-arms it (0018a clears reminder_sent_at) ...
    make_window(db_engine, listing, base + 36 * HOUR, base + 38 * HOUR, 30)
    _ok(_reschedule(seeker, tour_id, base + 36 * HOUR))
    assert tour_row(db_engine, tour_id).reminder_sent_at is None
    # The claimed reminder still queued before the reschedule now tells the old "tomorrow":
    # skipped; the reschedule's mail goes.
    assert [i["change"] for i in _queue()] == ["reminder", "rescheduled"]
    assert _send(db_engine, _fresh(outbox)) == _counts(sent=2, skipped=1)
    assert {subject for _, subject, _ in outbox.messages} == {he.TOUR_RESCHEDULED_SUBJECT}
    assert _reminders(db_engine) == 0  # not inside the lead yet
    # ... and once the clock reaches the new time's lead (moved 14 hours on), it is claimed again.
    _execute(
        db_engine,
        "UPDATE tours SET starts_at = starts_at - interval '14 hours',"
        " ends_at = ends_at - interval '14 hours', updated_at = updated_at - interval '14 hours'"
        " WHERE id = :t",
        t=tour_id,
    )
    get_redis().delete(tour_mail.QUEUE_KEY)
    assert _reminders(db_engine) == 1
    assert _queue() == [_item(tour_id, "reminder")]


# --- AC10: the text ---------------------------------------------------------------------------


def test_ac10_body_local_time_and_fields(
    seeker_id: uuid.UUID,
    listing: uuid.UUID,
    application: uuid.UUID,
    outbox: Outbox,
    db_engine: Engine,
) -> None:
    november = dt.datetime(2027, 11, 18, 15, 20, tzinfo=dt.UTC)  # a Thursday, UTC+2
    july = dt.datetime(2027, 7, 12, 15, 20, tzinfo=dt.UTC)  # a Monday, UTC+3
    footer = he.TOUR_FOOTER.format(url=f"{get_settings().web_origin}/chat/{application}")
    where = "רחוב כצנלסון, גבעתיים"
    for starts_at, when in (
        (november, "יום חמישי, 18.11.2027, 17:20–17:50"),
        (july, "יום שני, 12.07.2027, 18:20–18:50"),
    ):
        tour_id = make_tour(db_engine, listing, application, seeker_id, starts_at)
        _claimed(db_engine, tour_id)
        _push(_item(tour_id, "reminder"))
        assert _send(db_engine, _fresh(outbox)) == _counts(sent=2)
        bodies = {to: body for to, _, body in outbox.messages}
        assert bodies == {
            O_EMAIL: he.TOUR_REMINDER_BODY.format(
                name="Dana", when=when, where=where, footer=footer
            ),
            S_EMAIL: he.TOUR_REMINDER_BODY.format(
                name="Noa", when=when, where=where, footer=footer
            ),
        }
        assert O_EMAIL not in bodies[S_EMAIL] and S_EMAIL not in bodies[O_EMAIL]
