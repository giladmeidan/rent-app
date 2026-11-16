"""iCalendar (RFC 5545) text for tours (spec 0018c; shared with the calendar feed, spec 0018d).
Pure functions, stdlib only. Times are UTC (`...Z`), so no `VTIMEZONE` is needed; calendars show
them in local time. `vcalendar` folds every line at 75 octets and joins them with CRLF."""

import datetime as dt
import unicodedata
import uuid
from collections.abc import Iterable
from typing import Literal

CRLF = "\r\n"
_LINE_OCTETS = 75


def escape_text(value: str) -> str:
    """A TEXT value: `\\`, `;` and `,` escaped, a newline as `\\n`, other control characters and
    the Unicode line/paragraph separators dropped, so user text can never start a new property."""
    out = []
    for ch in value.replace("\r\n", "\n"):
        if ch == "\n":
            out.append("\\n")
        elif ch in "\\;,":
            out.append("\\" + ch)
        elif unicodedata.category(ch) not in ("Cc", "Zl", "Zp"):  # U+2028/2029 break lines too
            out.append(ch)
    return "".join(out)


def fold(line: str) -> str:
    """`line` folded at 75 octets (UTF-8) with CRLF + one space, never inside a character."""
    parts, current, size, limit = [], "", 0, _LINE_OCTETS
    for ch in line:
        octets = len(ch.encode())
        if size + octets > limit:
            parts.append(current)
            current, size, limit = "", 0, _LINE_OCTETS - 1  # the leading space is one octet
        current += ch
        size += octets
    parts.append(current)
    return (CRLF + " ").join(parts)


def fmt_utc(t: dt.datetime) -> str:
    """An aware datetime as `YYYYMMDDTHHMMSSZ`."""
    if t.tzinfo is None:
        raise ValueError("naive datetime")
    return t.astimezone(dt.UTC).strftime("%Y%m%dT%H%M%SZ")


def tour_uid(tour_id: uuid.UUID) -> str:
    """The one UID rule (TOURS-PLAN.md "Shared contract"): every `.ics` of a tour shares it."""
    return f"{tour_id}@homie"


def vevent(
    *,
    uid: str,
    start: dt.datetime,
    end: dt.datetime,
    summary: str,
    location: str,
    description: str,
    url: str,
    stamp: dt.datetime,
    sequence: int | None = None,
    status: Literal["CONFIRMED", "CANCELLED"] = "CONFIRMED",
    organizer: str | None = None,
) -> list[str]:
    """One VEVENT as unfolded property lines."""
    lines = ["BEGIN:VEVENT", f"UID:{uid}", f"DTSTAMP:{fmt_utc(stamp)}"]
    if sequence is not None:
        lines.append(f"SEQUENCE:{sequence}")
    lines += [
        f"DTSTART:{fmt_utc(start)}",
        f"DTEND:{fmt_utc(end)}",
        f"SUMMARY:{escape_text(summary)}",
        f"LOCATION:{escape_text(location)}",
        f"DESCRIPTION:{escape_text(description)}",
        f"URL:{url}",
    ]
    if organizer is not None:
        lines.append(f"ORGANIZER;CN=homie:mailto:{organizer}")
    lines += [f"STATUS:{status}", "TRANSP:OPAQUE", "END:VEVENT"]
    return lines


def _duration(span: dt.timedelta) -> str:
    """A positive span as an RFC 5545 DURATION in its largest whole unit: `PT1H`, `PT90M`."""
    seconds = int(span.total_seconds())
    for unit, size in (("H", 3600), ("M", 60)):
        if seconds % size == 0:
            return f"PT{seconds // size}{unit}"
    return f"PT{seconds}S"


def vcalendar(
    events: Iterable[list[str]],
    *,
    name: str | None = None,
    method: str = "PUBLISH",
    refresh: dt.timedelta | None = None,
) -> str:
    """A VCALENDAR around `events`, every line folded, CRLF-terminated. `name` and `refresh` are
    the calendar feed's options (spec 0018d)."""
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//homie//tours//HE",
        "CALSCALE:GREGORIAN",
        f"METHOD:{method}",
    ]
    if name is not None:
        lines.append(f"X-WR-CALNAME:{escape_text(name)}")
    lines.append("X-WR-TIMEZONE:Asia/Jerusalem")
    if refresh is not None:
        ttl = _duration(refresh)
        lines += [f"REFRESH-INTERVAL;VALUE=DURATION:{ttl}", f"X-PUBLISHED-TTL:{ttl}"]
    for event in events:
        lines += event
    lines.append("END:VCALENDAR")
    return CRLF.join(fold(line) for line in lines) + CRLF
