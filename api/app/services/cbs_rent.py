"""CBS small-flat rent figures (spec 0014d): Table 4.9 of the CBS Price Statistics Monthly, the
average rent for 1-2 and 2.5-3 rooms per big city and residential district, stored in
`cbs_rent_prices` for the rent estimate's small-flat ratio.

The worker runs `run_cbs_import` once a month (`make cbs-rent-import` once by hand,
`make cbs-rent-history` for the five xlsx bulletins). Each file is untrusted input: a file that
breaks a rule is rejected whole (`CbsFileError`, nothing stored), a bad cell alone is skipped.
Rows are upserted by bulletin, never deleted. Nothing here logs a URL or a file's content."""

import datetime as dt
import io
import logging
import re
import time
import zipfile
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal, NamedTuple

import httpx
import openpyxl
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_sessionmaker
from app.models import CbsRentPrice
from app.services.rent_reference import REQUEST_INTERVAL_S, USER_AGENT

log = logging.getLogger(__name__)

URL = "https://www.cbs.gov.il/he/publications/Madad/DocLib/{year}/price{month:02d}a/a4_9_e.xlsx"
# The xlsx bulletins, oldest first so a revision overwrites (earlier ones are .xls, out of scope).
HISTORY_BULLETINS: tuple[tuple[int, int], ...] = (
    (2025, 7),
    (2025, 10),
    (2026, 1),
    (2026, 4),
    (2026, 7),
)
LATEST_MONTHS_BACK = 5  # today's month and 5 before it: at most 6 requests
MAX_BODY_BYTES = 5 * 1024 * 1024
MAX_ZIP_ENTRIES = 100
MAX_UNZIPPED_BYTES = 20 * 1024 * 1024
MAX_READ_ROWS = 1000
MAX_READ_COLS = 60
MAX_STORED_ROWS = 2000
ZIP_MAGIC = b"PK\x03\x04"

GeoKind = Literal["city", "district"]
RoomGroup = Literal["1-2", "2.5-3"]
_GROUPS: dict[str, RoomGroup] = {"1-2": "1-2", "2.5-3": "2.5-3"}
_OTHER_GROUPS = {"3.5-4", "4.5+"}
_SECTIONS: dict[str, GeoKind] = {"residentialdistricts": "district", "bigcities": "city"}
_QUARTERS = {"I-III": 3, "IV-VI": 6, "VII-IX": 9, "X-XII": 12}
_BULLETIN = re.compile(r"No\. (\d{1,2})/(20\d{2})")
_HEADER = re.compile(r"^(.*[A-Za-z].*?)\s*-\s*(\d{1,5})\s*$")
_YEAR = re.compile(r"20\d{2}")


class CbsFileError(ValueError):
    """A file that breaks an import rule; the message is a fixed rule text, never the file."""


class CbsRow(NamedTuple):
    geo_kind: GeoKind
    geo_code: int
    room_group: RoomGroup
    period: dt.date
    price_ils: Decimal
    sampling_error: Decimal | None


class CbsTable(NamedTuple):
    bulletin: dt.date
    rows: list[CbsRow]


def bulletin_url(year: int, month: int) -> str:
    return URL.format(year=year, month=month)


def _squeeze(value: object) -> str:
    """A cell as text with all whitespace removed ('' for an empty cell)."""
    return "" if value is None else "".join(str(value).split())


def _number(value: object, low: float, high: float, places: str) -> Decimal | None:
    """An int / float (never a bool) within [low, high], rounded to `places`; else None. The range
    test comes first: NaN and infinities fail it, and a huge int compares exactly."""
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    if not low <= value <= high:
        return None
    return Decimal(str(value)).quantize(Decimal(places), rounding=ROUND_HALF_UP)


def _columns(row4: tuple[object, ...], row5: tuple[object, ...]) -> dict[int, dt.date]:
    """Rule 4: quarter column index → period. The first row-4 year anchors the sequence: over a
    quarter column it is that quarter's year; over an "Annual average" column (October layouts) the
    next quarter column must be I-III of the year after. Each next quarter column is the quarter
    right after the previous one, and every row-4 year must agree with the column it stands on."""
    labels = {i: _squeeze(row5[i]) for i in range(1, len(row5)) if _squeeze(row5[i])}
    if any(label not in _QUARTERS and label != "Annualaverage" for label in labels.values()):
        raise CbsFileError("an unknown quarter label in row 5")
    quarters = [i for i, label in labels.items() if label in _QUARTERS]
    if not quarters:
        raise CbsFileError("no quarter column")
    years: dict[int, int] = {}
    for i in range(1, len(row4)):
        text = _squeeze(row4[i])
        if text:
            if not _YEAR.fullmatch(text):
                raise CbsFileError("a row-4 cell is not a year")
            years[i] = int(text)
    first = quarters[0]
    anchor = min(years, default=None)
    if anchor == first:
        start = dt.date(years[first], _QUARTERS[labels[first]], 1)
    elif (
        anchor is not None
        and anchor < first
        and labels.get(anchor) == "Annualaverage"
        and labels[first] == "I-III"
    ):
        start = dt.date(years[anchor] + 1, 3, 1)
    else:
        raise CbsFileError("no year above the first quarter column")

    columns: dict[int, dt.date] = {}
    previous: dt.date | None = None
    for i in quarters:
        month = _QUARTERS[labels[i]]
        if previous is None:
            period = start
        else:
            period = dt.date(previous.year + (1 if month == 3 else 0), month, 1)
            if (period.year * 12 + period.month) - (previous.year * 12 + previous.month) != 3:
                raise CbsFileError("quarter columns out of sequence")
        columns[i] = previous = period

    for i, year in years.items():
        if i in columns:
            agrees = columns[i].year == year
        elif labels.get(i) == "Annualaverage":
            before = [q for q in quarters if q < i]
            agrees = year == (columns[before[-1]].year if before else start.year - 1)
        else:
            agrees = False
        if not agrees:
            raise CbsFileError("a row-4 year disagrees with its column")
    if start.year < 2015:
        raise CbsFileError("the first year is before 2015")
    return columns


def _read_rows(content: bytes) -> list[tuple[object, ...]]:
    """Rule 2: the zip checked before openpyxl sees it; then the one sheet's cells (rule 7)."""
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            entries = archive.infolist()
            if len(entries) > MAX_ZIP_ENTRIES:
                raise CbsFileError("too many zip entries")
            if sum(entry.file_size for entry in entries) > MAX_UNZIPPED_BYTES:
                raise CbsFileError("too large uncompressed")
        book = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        try:
            if len(book.worksheets) != 1:
                raise CbsFileError("not exactly one sheet")
            return list(
                book.worksheets[0].iter_rows(
                    max_row=MAX_READ_ROWS, max_col=MAX_READ_COLS, values_only=True
                )
            )
        finally:
            book.close()
    except CbsFileError:
        raise
    except Exception:  # BadZipFile or any openpyxl error: a rejection, never a crash
        raise CbsFileError("not a readable xlsx file") from None


def parse_table(content: bytes, *, today: dt.date) -> CbsTable:
    """Check a bulletin's Table 4.9 against the import rules (spec 0014d, rules 2-7) and return
    its 1-2 and 2.5-3 rows; raises `CbsFileError` for a file that is rejected whole."""
    try:
        return _parse_table(content, today=today)
    except CbsFileError:
        raise
    except (ValueError, OverflowError):  # a value the rules missed: a rejection, never a crash
        raise CbsFileError("a malformed value") from None


def _parse_table(content: bytes, *, today: dt.date) -> CbsTable:
    rows = _read_rows(content)
    if len(rows) < 6:
        raise CbsFileError("too few rows")
    match = _BULLETIN.search(str(rows[0][0] if rows[0] else ""))
    if match is None or not 1 <= int(match.group(1)) <= 12:
        raise CbsFileError("A1 does not name the bulletin")
    bulletin = dt.date(int(match.group(2)), int(match.group(1)), 1)
    if bulletin > today.replace(day=1):
        raise CbsFileError("the bulletin is after today's month")
    columns = _columns(rows[3], rows[4])
    if max(columns.values()) >= bulletin:
        raise CbsFileError("the newest quarter does not end before the bulletin")

    out: list[CbsRow] = []
    seen: set[tuple[GeoKind, int]] = set()
    seen_rows: set[tuple[GeoKind, int, RoomGroup]] = set()
    sections: set[GeoKind] = set()
    section: GeoKind | None = None
    block: tuple[GeoKind, int] | None = None
    for row in rows:
        first = row[0] if row else None
        label = _squeeze(first)
        if label in _GROUPS or label in _OTHER_GROUPS:
            group = _GROUPS.get(label)
            if group is None or block is None:
                continue
            if (*block, group) in seen_rows:
                raise CbsFileError("a room row appears twice in a block")
            seen_rows.add((*block, group))
            for i, period in columns.items():
                price = _number(row[i] if i < len(row) else None, 500, 100000, "0.1")
                if price is None:
                    continue
                error = _number(row[i + 1] if i + 1 < len(row) else None, 0, 999999.99, "0.01")
                out.append(CbsRow(*block, group, period, price, error))
            continue
        if label.lower() in _SECTIONS:
            section, block = _SECTIONS[label.lower()], None
            sections.add(section)
            continue
        header = _HEADER.match(str(first).strip()) if isinstance(first, str) else None
        if header is not None:
            if section is None:
                raise CbsFileError("a block header before any section row")
            block = (section, int(header.group(2)))
            if block in seen:
                raise CbsFileError("a block appears twice")
            seen.add(block)
            continue
        block = None
    if len(out) > MAX_STORED_ROWS:
        raise CbsFileError("too many rows")
    if sections != {"district", "city"}:
        raise CbsFileError("a section is missing")
    small = {(r.geo_kind, r.geo_code) for r in out if r.room_group == "1-2"}
    if not {("city", 5000), ("district", 4), ("district", 5)} <= small:
        raise CbsFileError("no 1-2 row for city 5000 or districts 4 and 5")
    return CbsTable(bulletin, out)


def get_cbs_client() -> httpx.Client:
    """Built as 0014a's fetcher: identity encoding, 30 s, redirects refused."""
    return httpx.Client(
        headers={"User-Agent": USER_AGENT, "Accept-Encoding": "identity"},
        timeout=30.0,
        follow_redirects=False,
    )


def _get(client: httpx.Client, url: str) -> bytes | None:
    """The body when the answer is 200, uncompressed, within `MAX_BODY_BYTES` and a zip; else
    None. Logs the reason only, never the URL or the body."""
    client.cookies.clear()
    body = bytearray()
    try:
        with client.stream("GET", url) as response:
            if response.status_code != 200:
                log.info("cbs rent: status %s", response.status_code)
                return None
            # httpx inflates a whole compressed chunk before the cap below could see it.
            if response.headers.get("content-encoding", "identity").lower() != "identity":
                log.info("cbs rent: compressed body")
                return None
            for chunk in response.iter_bytes():
                body += chunk
                if len(body) > MAX_BODY_BYTES:
                    log.info("cbs rent: body over MAX_BODY_BYTES")
                    return None
    except httpx.HTTPError as exc:
        log.info("cbs rent: %s", type(exc).__name__)
        return None
    if not body.startswith(ZIP_MAGIC):
        log.info("cbs rent: not a zip (%s bytes)", len(body))
        return None
    return bytes(body)


def _months_back(today: dt.date, back: int) -> tuple[int, int]:
    months = today.year * 12 + today.month - 1 - back
    return months // 12, months % 12 + 1


def fetch_latest(client: httpx.Client, *, today: dt.date) -> CbsTable | None:
    """The newest bulletin among `today`'s month and the 5 before it, newest first: the first
    good answer is parsed (a rejection raises `CbsFileError`); None when no month answered."""
    for back in range(LATEST_MONTHS_BACK + 1):
        if back:
            time.sleep(REQUEST_INTERVAL_S)
        body = _get(client, bulletin_url(*_months_back(today, back)))
        if body is not None:
            return parse_table(body, today=today)
    log.info("cbs rent: no bulletin in the last %s months", LATEST_MONTHS_BACK + 1)
    return None


def store(db: Session, table: CbsTable) -> dict[str, int]:
    """Upsert every row (one statement, committed by the caller): a newer or equal bulletin
    overwrites, an older one only fills periods that are absent."""
    if not table.rows:
        return {"written": 0}
    insert = pg_insert(CbsRentPrice).values(
        [{**row._asdict(), "bulletin": table.bulletin} for row in table.rows]
    )
    written = db.execute(
        insert.on_conflict_do_update(
            index_elements=["geo_kind", "geo_code", "room_group", "period"],
            set_={
                "price_ils": insert.excluded.price_ils,
                "sampling_error": insert.excluded.sampling_error,
                "bulletin": insert.excluded.bulletin,
                "imported_at": func.now(),
            },
            where=CbsRentPrice.bulletin <= insert.excluded.bulletin,
        ).returning(CbsRentPrice.geo_code)
    ).all()
    return {"written": len(written)}


def _store_body(db: Session, body: bytes, today: dt.date) -> dict[str, int]:
    try:
        counts = store(db, parse_table(body, today=today))
    except CbsFileError as exc:
        db.rollback()
        log.warning("cbs rent: file rejected (%s)", exc)
        return {"rejected": 1}
    db.commit()
    return counts


def import_cbs_rent(
    db: Session,
    client: httpx.Client,
    *,
    today: dt.date,
    history: bool = False,
) -> dict[str, int]:
    """The latest bulletin, or with `history` the five xlsx bulletins oldest first. Counts:
    `written` rows, `skipped` (no file), `rejected` (a file broke a rule)."""
    counts: dict[str, int] = {}
    if history:
        for n, (year, month) in enumerate(HISTORY_BULLETINS):
            if n:
                time.sleep(REQUEST_INTERVAL_S)
            body = _get(client, bulletin_url(year, month))
            result = {"skipped": 1} if body is None else _store_body(db, body, today)
            for key, value in result.items():
                counts[key] = counts.get(key, 0) + value
    else:
        try:
            table = fetch_latest(client, today=today)
        except CbsFileError as exc:
            log.warning("cbs rent: file rejected (%s)", exc)
            return {"rejected": 1}
        if table is None:
            return {"skipped": 1}
        counts = store(db, table)
        db.commit()
    log.info("cbs rent import: %s", counts)
    return counts


def run_cbs_import(*, history: bool = False) -> dict[str, int]:
    """The worker's and the script's entry point: `{"skipped": 1}` with `CBS_RENT=off`, before any
    client exists."""
    if get_settings().cbs_rent == "off":
        return {"skipped": 1}
    with get_cbs_client() as client, get_sessionmaker()() as db:
        return import_cbs_rent(db, client, today=dt.date.today(), history=history)
