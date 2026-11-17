"""Official rent figures (specs 0014a, 0021c): nadlan.gov.il's public rent files for every active
settlement of the area catalogue and their neighbourhoods, stored in `rent_areas` / `rent_prices`.

The worker runs `run_rent_import` once a month (`make rent-import` once by hand). Each file is
untrusted input: a file that breaks a rule is skipped whole, a bad price point alone. Rows are
upserted, never deleted. A failure is counted and logged (path and exception class only), never
raised to the worker. Nothing here logs a URL or a file's content."""

import datetime as dt
import json
import logging
import math
import re
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal, Protocol, TypeGuard

import httpx
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_sessionmaker
from app.models import Area, RentArea, RentPrice
from app.schemas._text import visible_characters_only

log = logging.getLogger(__name__)

MAX_BODY_BYTES = 2 * 1024 * 1024
REQUEST_INTERVAL_S = 0.25  # the CBS fetches (cbs_rent.py)
NADLAN_INTERVAL_S = 5.0  # nadlan.gov.il's robots.txt asks for Crawl-delay: 5 (spec 0021c)
USER_AGENT = "homie-rent-reference"
MAX_STREETS = 2000
MAX_NEIGHBOURHOODS = 500  # Tel Aviv, the largest, lists 72

Kind = Literal["settlement", "neighbourhood"]
_ROOMS: dict[object, int] = {3: 3, 4: 4, 5: 5, "all": 0}  # "all" sizes are stored as 0
_ID = re.compile(r"[0-9]{1,9}")


class RentSourceError(Exception):
    """A network error or timeout, a non-200 status, a body over `MAX_BODY_BYTES` or a body that is
    not UTF-8 JSON. The message never holds the body or the URL."""


class RentFileMissing(RentSourceError):  # noqa: N818 (the name spec 0021c gives it)
    """A 404: most small settlements publish no file."""


class RentFileError(ValueError):
    """A file that breaks an import rule; the message is a fixed rule text, never the file."""


class RentFetcher(Protocol):
    def fetch(self, path: str) -> object:
        """The parsed JSON at `path` (relative to `NADLAN_RENT_URL`)."""
        ...


class NadlanFetcher:
    """One request at a time, `NADLAN_INTERVAL_S` apart, no cookies kept, redirects refused (the
    client is built with `follow_redirects=False`), bodies capped at `MAX_BODY_BYTES` while
    streaming."""

    def __init__(
        self, client: httpx.Client, *, sleep: Callable[[float], None] = time.sleep
    ) -> None:
        self.client = client
        self._sleep = sleep
        self._first = True

    def fetch(self, path: str) -> object:
        if not self._first:
            self._sleep(NADLAN_INTERVAL_S)
        self._first = False
        self.client.cookies.clear()
        body = bytearray()
        # `from None` throughout: an httpx error's message and context may hold the URL.
        try:
            with self.client.stream("GET", path) as response:
                if response.status_code == 404:
                    raise RentFileMissing("status 404")
                if response.status_code != 200:
                    raise RentSourceError(f"status {response.status_code}")
                # httpx inflates a whole compressed chunk before the cap below could see it.
                if response.headers.get("content-encoding", "identity").lower() != "identity":
                    raise RentSourceError("compressed body")
                for chunk in response.iter_bytes():
                    body += chunk
                    if len(body) > MAX_BODY_BYTES:
                        raise RentSourceError("body over MAX_BODY_BYTES")
        except httpx.HTTPError as exc:
            raise RentSourceError(type(exc).__name__) from None
        try:
            return json.loads(body.decode("utf-8-sig"))
        except (ValueError, RecursionError):
            raise RentSourceError("body is not UTF-8 JSON") from None


def get_rent_fetcher() -> NadlanFetcher:
    return NadlanFetcher(
        httpx.Client(
            base_url=get_settings().nadlan_rent_url,
            headers={"User-Agent": USER_AGENT, "Accept-Encoding": "identity"},
            timeout=30.0,
            follow_redirects=False,
        )
    )


@dataclass(frozen=True)
class RentFile:
    """A file that passed the rules: what is stored, and a settlement's neighbourhood ids."""

    name: str
    x: float
    y: float
    version: str
    prices: dict[tuple[int, dt.date], int]
    streets: list[str]
    neighbourhood_ids: list[int]


def _is_int(value: object) -> TypeGuard[int]:
    return type(value) is int  # JSON true / false are bools, never accepted as integers


def _text(value: object) -> str | None:
    """Stripped, 1-80 characters and visible (`visible_characters_only`), else None."""
    if not isinstance(value, str):
        return None
    value = value.strip()
    if not 1 <= len(value) <= 80:
        return None
    try:
        visible_characters_only(value, require_visible=True)
    except ValueError:
        return None
    return value


def _coordinate(value: object, low: float, high: float) -> float:
    if (
        isinstance(value, bool)
        or not isinstance(value, int | float)
        or not math.isfinite(value)
        or not low <= value <= high
    ):
        raise RentFileError("x / y must be finite numbers inside the bounds")
    return float(value)


def _prices(rooms_list: list[object], price_key: str) -> dict[tuple[int, dt.date], int]:
    prices: dict[tuple[int, dt.date], int] = {}
    for entry in rooms_list:
        if not isinstance(entry, dict) or not isinstance(entry.get("graphData"), list):
            continue
        num_rooms = entry.get("numRooms")
        if not (num_rooms == "all" or (_is_int(num_rooms) and num_rooms in (3, 4, 5))):
            continue
        rooms = _ROOMS[num_rooms]
        for point in entry["graphData"]:
            if not isinstance(point, dict):
                continue
            year, month, price = point.get("year"), point.get("month"), point.get(price_key)
            if not (_is_int(year) and _is_int(month) and _is_int(price)):
                continue
            if 2000 <= year <= 2100 and month in (3, 6, 9, 12) and 500 <= price <= 100000:
                # A repeated (rooms, period) inside one file: the first in file order wins.
                prices.setdefault((rooms, dt.date(year, month, 1)), price)
    return prices


def _streets(entries: object) -> list[str]:
    streets: dict[str, None] = {}  # insertion-ordered set: de-duplication keeps the first
    for entry in entries if isinstance(entries, list) else []:
        title = _text(entry.get("title")) if isinstance(entry, dict) else None
        if title is not None:
            streets.setdefault(title)
    return list(streets)[:MAX_STREETS]


def _neighbourhood_ids(data: dict[str, object]) -> list[int]:
    """The union of `otherNeighborhoods` and `neighborhoodsPrices` ids, ascending; an id that is
    neither an integer nor a 1-9 digit string is ignored alone."""
    ids: set[int] = set()
    for key in ("otherNeighborhoods", "neighborhoodsPrices"):
        entries = data.get(key)
        for entry in entries if isinstance(entries, list) else []:
            raw = entry.get("id") if isinstance(entry, dict) else None
            if _is_int(raw) and 0 <= raw <= 999_999_999:
                ids.add(raw)
            elif isinstance(raw, str) and _ID.fullmatch(raw):
                ids.add(int(raw))
    return sorted(ids)


def parse_rent_file(data: object, kind: Kind, source_id: int, settlement_code: int) -> RentFile:
    """Check a file against the import rules (spec 0014a, rule 2 and Input types); raises
    `RentFileError` for a file that is skipped whole."""
    if not isinstance(data, dict):
        raise RentFileError("not a JSON object")
    settlement = kind == "settlement"
    own_id = data.get("settlementID" if settlement else "neighborhoodId")
    if not _is_int(own_id) or own_id != source_id:
        raise RentFileError("the file's id is not the one asked for")
    if not settlement and (
        not _is_int(data.get("settlementID")) or data.get("settlementID") != settlement_code
    ):
        raise RentFileError("the neighbourhood is not in the settlement it was listed under")
    name = _text(data.get("settlementName" if settlement else "neighborhoodName"))
    if name is None:
        raise RentFileError("the name must be 1-80 visible characters")
    x = _coordinate(data.get("x"), 100000, 300000)
    y = _coordinate(data.get("y"), 350000, 800000)
    trends = data.get("trends")
    rooms_list = trends.get("rooms") if isinstance(trends, dict) else None
    if not isinstance(rooms_list, list):
        raise RentFileError("trends.rooms must be a list")
    version = data.get("version")
    if not isinstance(version, str) or not 1 <= len(version) <= 20:
        raise RentFileError("version must be a string of 1-20 characters")
    try:
        visible_characters_only(version, require_visible=True)
    except ValueError:
        raise RentFileError("version must be visible characters") from None
    neighbourhood_ids = _neighbourhood_ids(data) if settlement else []
    if len(neighbourhood_ids) > MAX_NEIGHBOURHOODS:
        raise RentFileError("too many neighbourhoods")
    return RentFile(
        name=name,
        x=x,
        y=y,
        version=version,
        prices=_prices(rooms_list, "settlementPrice" if settlement else "neighborhoodPrice"),
        streets=[] if settlement else _streets(data.get("otherNeighborhoodStreets")),
        neighbourhood_ids=neighbourhood_ids,
    )


def _store(
    db: Session, kind: Kind, source_id: int, settlement_code: int, file: RentFile
) -> tuple[int, int]:
    """Upsert the area and its prices (one transaction, committed by the caller). Returns
    (prices new, prices changed)."""
    centre = func.ST_Transform(func.ST_SetSRID(func.ST_MakePoint(file.x, file.y), 2039), 4326)
    values = {
        "settlement_code": settlement_code,
        "name_he": file.name,
        "centre": centre,
        "streets": file.streets,
        "source_version": file.version,
    }
    upsert = pg_insert(RentArea).values(kind=kind, source_id=source_id, **values)
    area_id: uuid.UUID = db.execute(
        upsert.on_conflict_do_update(
            constraint="uq_rent_areas_kind_source", set_={**values, "updated_at": func.now()}
        ).returning(RentArea.id)
    ).scalar_one()
    stored = {
        (rooms, period): price
        for rooms, period, price in db.execute(
            select(RentPrice.rooms, RentPrice.period, RentPrice.price_ils).where(
                RentPrice.area_id == area_id
            )
        ).tuples()
    }
    rows = [
        {"area_id": area_id, "rooms": rooms, "period": period, "price_ils": price}
        for (rooms, period), price in file.prices.items()
        if stored.get((rooms, period)) != price
    ]
    if rows:
        insert = pg_insert(RentPrice).values(rows)
        db.execute(
            insert.on_conflict_do_update(
                index_elements=["area_id", "rooms", "period"],
                set_={"price_ils": insert.excluded.price_ils, "updated_at": func.now()},
            )
        )
    new = sum(1 for row in rows if (row["rooms"], row["period"]) not in stored)
    return new, len(rows) - new


def _fetch(
    fetcher: RentFetcher, counts: dict[str, int], kind: Kind, source_id: int, settlement_code: int
) -> RentFile | None:
    """Fetch and check one file; None on any error: a settlement's 404 counted `missing` and not
    logged (most small settlements have no file), anything else counted failed and logged."""
    path = (
        f"settlement/rent/{source_id}.json"
        if kind == "settlement"
        else f"neighborhood/rent/{source_id}.json"
    )
    try:
        return parse_rent_file(fetcher.fetch(path), kind, source_id, settlement_code)
    except Exception as exc:  # failures are soft: counted, logged, never raised
        if kind == "settlement" and isinstance(exc, RentFileMissing):
            counts["missing"] += 1
        else:
            counts["files_failed"] += 1
            log.warning("rent reference: %s skipped (%s)", path, type(exc).__name__)
        return None


def _save(
    db: Session,
    counts: dict[str, int],
    kind: Kind,
    source_id: int,
    settlement_code: int,
    file: RentFile,
) -> None:
    """Store one checked file in its own transaction; a failure is counted and logged."""
    try:
        new, changed = _store(db, kind, source_id, settlement_code, file)
        db.commit()
    except Exception as exc:
        db.rollback()
        counts["files_failed"] += 1
        log.warning("rent reference: %s %s not stored (%s)", kind, source_id, type(exc).__name__)
        return
    counts["files_ok"] += 1
    counts["areas"] += 1
    counts["prices_new"] += new
    counts["prices_changed"] += changed


def settlement_codes(db: Session) -> list[int]:
    """The source code of every active settlement of the area catalogue (nadlan's `settlementID`
    is the CBS code), ascending."""
    return list(
        db.scalars(
            select(Area.source_code)
            .where(Area.kind == "settlement", Area.is_active.is_(True))
            .order_by(Area.source_code)
        )
    )


def import_rent_reference(db: Session, fetcher: RentFetcher) -> dict[str, int]:
    """Every settlement of `settlement_codes`, then its listed neighbourhoods (none when the
    settlement file failed); the settlement row is stored after its neighbourhoods, so a row at
    the run's version (the first parsed file's) is a finished settlement: skipped with no request,
    which resumes an interrupted run. Logs one INFO line with the counts and the source version."""
    counts = dict.fromkeys(
        (
            "files_ok",
            "files_failed",
            "missing",
            "skipped",
            "areas",
            "prices_new",
            "prices_changed",
        ),
        0,
    )
    codes = settlement_codes(db)
    stored: dict[int, str] = dict(
        db.execute(
            select(RentArea.source_id, RentArea.source_version).where(RentArea.kind == "settlement")
        )
        .tuples()
        .all()
    )
    db.rollback()  # no transaction held open through hours of fetching
    version: str | None = None
    for code in codes:
        if version is not None and stored.get(code) == version:
            counts["skipped"] += 1
            continue
        settlement = _fetch(fetcher, counts, "settlement", code, code)
        if settlement is None:
            continue
        if version is None:
            version = settlement.version
            if stored.get(code) == version:
                counts["skipped"] += 1
                continue
        for hood_id in settlement.neighbourhood_ids:
            hood = _fetch(fetcher, counts, "neighbourhood", hood_id, code)
            if hood is not None:
                _save(db, counts, "neighbourhood", hood_id, code, hood)
        _save(db, counts, "settlement", code, code, settlement)
    log.info("rent reference import: %s, source version %s", counts, version)
    return counts


def run_rent_import() -> dict[str, int]:
    """The worker's and the script's entry point: `{"skipped": 1}` with `RENT_REFERENCE=off`,
    before any fetcher exists."""
    if get_settings().rent_reference == "off":
        return {"skipped": 1}
    fetcher = get_rent_fetcher()
    with fetcher.client, get_sessionmaker()() as db:
        return import_rent_reference(db, fetcher)
