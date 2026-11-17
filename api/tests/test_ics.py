"""iCalendar text (spec 0018c, `services/ics.py`; shared with spec 0018d's feed)."""

import datetime as dt
import uuid

import pytest

from app.services import ics

START = dt.datetime(2026, 11, 20, 15, 20, tzinfo=dt.UTC)
TOUR_ID = uuid.UUID("12345678-1234-5678-1234-567812345678")


def _event(**overrides: object) -> list[str]:
    fields: dict[str, object] = {
        "uid": ics.tour_uid(TOUR_ID),
        "start": START.astimezone(dt.timezone(dt.timedelta(hours=2))),  # any aware zone
        "end": START + dt.timedelta(minutes=30),
        "summary": "סיור: רחוב הרצל, תל אביב",
        "location": "רחוב הרצל, תל אביב",
        "description": "http://localhost:5173/chat/x",
        "url": "http://localhost:5173/chat/x",
        "stamp": START,
    }
    fields.update(overrides)
    return ics.vevent(**fields)  # type: ignore[arg-type]


def _unfold(text: str) -> list[str]:
    return text.replace("\r\n ", "").split("\r\n")


def test_ac11_fold_escape_utc() -> None:
    hostile = "דנה; X,\\ y\nDTSTART:19700101T000000Z\r\nSTATUS:CANCELLED\x07\u2028UID:x\u2029"
    long_name = "א" * 40
    calendar = ics.vcalendar(
        [_event(summary=hostile, location=long_name * 3, sequence=7)], method="PUBLISH"
    )

    # CRLF line endings only, CRLF at the end, every physical line at most 75 octets, and each
    # one valid UTF-8 on its own (a fold never splits a Hebrew letter's two bytes).
    assert calendar.endswith("\r\n")
    physical = calendar.split("\r\n")[:-1]
    assert "\n" not in calendar.replace("\r\n", "")
    for line in physical:
        assert len(line.encode()) <= 75
        line.encode().decode("utf-8")
    assert any(line.startswith(" ") for line in physical)  # the long location was folded

    lines = _unfold(calendar)
    assert lines[:5] == [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//homie//tours//HE",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
    ]
    assert "X-WR-TIMEZONE:Asia/Jerusalem" in lines
    assert f"LOCATION:{long_name * 3}" in lines  # unfolds back to the original
    # Escaped: no injected property line, the control character dropped.
    # U+2028/2029 (line and paragraph separators) are dropped too.
    assert "SUMMARY:דנה\\; X\\,\\\\ y\\nDTSTART:19700101T000000Z\\nSTATUS:CANCELLEDUID:x" in lines
    assert [line for line in lines if line.startswith("DTSTART")] == ["DTSTART:20261120T152000Z"]
    assert [line for line in lines if line.startswith("STATUS")] == ["STATUS:CONFIRMED"]
    assert "DTEND:20261120T155000Z" in lines
    assert f"UID:{TOUR_ID}@homie" in lines and ics.tour_uid(TOUR_ID) == f"{TOUR_ID}@homie"
    assert "SEQUENCE:7" in lines and "TRANSP:OPAQUE" in lines
    assert not any(line.startswith("ORGANIZER") for line in lines)
    assert not any(line.startswith(("X-WR-CALNAME", "REFRESH-INTERVAL")) for line in lines)
    assert lines[-2:] == ["END:VCALENDAR", ""]

    # CANCEL carries ORGANIZER and STATUS:CANCELLED; no SEQUENCE unless given.
    cancel = _unfold(
        ics.vcalendar(
            [_event(status="CANCELLED", organizer="noreply@homie.example")], method="CANCEL"
        )
    )
    assert "METHOD:CANCEL" in cancel and "STATUS:CANCELLED" in cancel
    assert "ORGANIZER;CN=homie:mailto:noreply@homie.example" in cancel
    assert not any(line.startswith("SEQUENCE") for line in cancel)

    # The feed's options (spec 0018d).
    feed = _unfold(ics.vcalendar([], name="הסיורים שלי", refresh=dt.timedelta(hours=1)))
    assert "X-WR-CALNAME:הסיורים שלי" in feed
    assert "REFRESH-INTERVAL;VALUE=DURATION:PT1H" in feed and "X-PUBLISHED-TTL:PT1H" in feed

    with pytest.raises(ValueError):
        ics.fmt_utc(dt.datetime(2026, 11, 20, 15, 20))  # naive


def test_ac11_fold_boundaries() -> None:
    assert ics.fold("a" * 75) == "a" * 75
    assert ics.fold("a" * 76) == "a" * 75 + "\r\n a"
    # 74 ASCII octets + a 2-octet letter would be 76: the letter moves whole to the next line.
    assert ics.fold("a" * 74 + "א") == "a" * 74 + "\r\n א"


def test_0018d_ac13_feed_calendar() -> None:
    name = "ש" * 60  # 120 octets: must fold, never inside a letter
    hostile = "רחוב; הרצל,\\ 1\nDTSTART:19700101T000000Z"
    calendar = ics.feed_calendar(
        [_event(description=f"סיור עם {name}", summary=hostile, location=hostile)],
        name="סיורים בהומי",
    )

    assert calendar.endswith("\r\n") and "\n" not in calendar.replace("\r\n", "")
    for line in calendar.split("\r\n")[:-1]:
        assert len(line.encode()) <= 75
        line.encode().decode("utf-8")
    lines = _unfold(calendar)
    assert f"DESCRIPTION:סיור עם {name}" in lines  # round-trips after unfolding
    escaped = r"רחוב\; הרצל\,\\ 1\nDTSTART:19700101T000000Z"
    assert f"SUMMARY:{escaped}" in lines and f"LOCATION:{escaped}" in lines
    assert [line for line in lines if line.startswith("DTSTART")] == ["DTSTART:20261120T152000Z"]
    assert "METHOD:PUBLISH" in lines and "X-WR-CALNAME:סיורים בהומי" in lines
    assert "REFRESH-INTERVAL;VALUE=DURATION:PT1H" in lines

    empty = _unfold(ics.feed_calendar([], name="סיורים בהומי"))
    assert empty[0] == "BEGIN:VCALENDAR" and empty[-2:] == ["END:VCALENDAR", ""]
    assert not any(line.startswith(("BEGIN:VEVENT", "DTSTAMP")) for line in empty)
