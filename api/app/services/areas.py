"""Area queries and the area import (spec 0021a1).

`import_areas` (`make import-areas`, by hand) upserts every settlement of
`api/data/settlements.csv` and, through nadlan.gov.il's rent files (`rent_reference`'s fetcher and
parser), the neighbourhoods of `BIG_CITY_CODES`. Rows are never deleted: a settlement gone from the
CSV, or a neighbourhood no longer listed by a settlement file that was fetched and passed, becomes
inactive; a failed fetch deactivates nothing. An upsert never touches `is_active` of an existing
row (the admin's switch)."""

import csv
import functools
import logging
import uuid
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from sqlalchemy import ColumnElement, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models import Area
from app.services.geocoding import street_query
from app.services.rent_estimate import normalise_place, street_forms
from app.services.rent_reference import RentFetcher, parse_rent_file

log = logging.getLogger(__name__)

# The 18 "Big cities" of CBS Table 4.9 (spec 0014d); nadlan's settlement ids are CBS codes.
BIG_CITY_CODES: tuple[int, ...] = (
    70,  # Ashdod
    7100,  # Ashkelon
    9000,  # Be'er Sheva
    2610,  # Beit Shemesh
    6100,  # Bnei Brak
    6200,  # Bat Yam
    6400,  # Herzliya
    6500,  # Hadera
    6600,  # Holon
    4000,  # Haifa
    3000,  # Jerusalem
    6900,  # Kfar Saba
    7400,  # Netanya
    7900,  # Petah Tikva
    8300,  # Rishon LeZion
    8400,  # Rehovot
    8600,  # Ramat Gan
    5000,  # Tel Aviv-Yafo
)
CSV_PATH = Path(__file__).resolve().parents[2] / "data" / "settlements.csv"
# shortcut: a box around the centre, not the real boundary; upgrade if geocoded points land outside
# their city in practice.
SETTLEMENT_BOX_DEG = 0.1
NEIGHBOURHOOD_BOX_DEG = 0.01
# A CSV shorter than this is truncated or empty: importing it would deactivate most settlements.
MIN_SETTLEMENTS = 1000


def list_active_areas(session: Session) -> Sequence[Any]:
    """Active areas ordered by Hebrew display name, with the centre as `lng` / `lat`."""
    stmt = (
        select(
            Area.id,
            Area.slug,
            Area.name_he,
            Area.kind,
            Area.parent_id,
            func.ST_X(Area.centre).label("lng"),
            func.ST_Y(Area.centre).label("lat"),
        )
        .where(Area.is_active.is_(True))
        .order_by(Area.name_he)
    )
    return session.execute(stmt).all()


def neighbourhood_for_street(
    db: Session, settlement_id: uuid.UUID, street: str
) -> uuid.UUID | None:
    """The one active neighbourhood of `settlement_id` whose `streets` hold `street` (its house
    number dropped, `street_query`; `normalise_place` on both sides, the `רחוב ` / `רח ` prefix
    also tried, `rent_estimate.street_forms`), else None: unlisted, in several (city level), or no
    street name left. Spec 0021a2; the rule of `rent_estimate._neighbourhood`."""
    forms = street_forms(street_query(street))
    if "" in forms:  # an all-number street: never match an empty catalogue name
        return None
    rows = db.execute(
        select(Area.id, Area.streets).where(
            Area.kind == "neighbourhood",
            Area.parent_id == settlement_id,
            Area.is_active.is_(True),
        )
    ).all()
    matches = [
        area_id for area_id, streets in rows if forms & {normalise_place(s) for s in streets}
    ]
    return matches[0] if len(matches) == 1 else None


def _itm(x: float, y: float) -> ColumnElement[Any]:
    return func.ST_Transform(func.ST_SetSRID(func.ST_MakePoint(x, y), 2039), 4326)


def _upsert(
    db: Session, rows: list[dict[str, Any]], box: float
) -> dict[int, tuple[uuid.UUID, bool]]:
    """Insert or update `rows` (`kind`, `source_code`, `name_he`, `x`, `y`, `parent_id`, `streets`)
    by `(kind, source_code)`; `is_active` is set only on insert. Returns source_code → (id,
    is_active)."""
    if not rows:
        return {}
    values = [
        {
            "slug": f"{row['kind'][0]}-{row['source_code']}",
            "kind": row["kind"],
            "source_code": row["source_code"],
            "parent_id": row.get("parent_id"),
            "name_he": row["name_he"],
            "streets": row.get("streets", []),
            "centre": _itm(row["x"], row["y"]),
            "geom": func.ST_Multi(func.ST_Expand(_itm(row["x"], row["y"]), box)),
        }
        for row in rows
    ]
    insert = pg_insert(Area).values(values)
    result = db.execute(
        insert.on_conflict_do_update(
            constraint="uq_areas_kind_source",
            set_={
                name: insert.excluded[name]
                for name in ("parent_id", "name_he", "streets", "centre", "geom")
            },
        ).returning(Area.source_code, Area.id, Area.is_active)
    )
    return {code: (area_id, active) for code, area_id, active in result.tuples()}


def _deactivate(db: Session, *where: ColumnElement[bool]) -> int:
    result = db.execute(
        update(Area).where(Area.is_active.is_(True), *where).values(is_active=False)
    )
    return int(getattr(result, "rowcount", 0))


def _csv_rows(csv_path: Path) -> list[dict[str, str]]:
    """The CSV's rows by column name (the first line is a `#` comment)."""
    with csv_path.open(encoding="utf-8", newline="") as file:
        return list(csv.DictReader(line for line in file if not line.startswith("#")))


def read_settlements(csv_path: Path) -> list[dict[str, Any]]:
    """The CSV's rows as upsert rows."""
    return [
        {
            "kind": "settlement",
            "source_code": int(row["code"]),
            "name_he": row["name_he"],
            "x": int(row["itm_x"]),
            "y": int(row["itm_y"]),
        }
        for row in _csv_rows(csv_path)
    ]


@functools.cache
def settlement_districts() -> dict[int, int]:
    """Settlement code → CBS district (1-7) from the committed CSV (spec 0021c); a row whose
    district is empty or outside 1-7 is left out."""
    return {
        int(row["code"]): int(row["district"])
        for row in _csv_rows(CSV_PATH)
        if row["district"] in {"1", "2", "3", "4", "5", "6", "7"}
    }


def import_areas(db: Session, fetcher: RentFetcher, csv_path: Path = CSV_PATH) -> dict[str, int]:
    """Upsert the settlements, then each big city's neighbourhoods, committing after the
    settlements and after each city (no run-long row locks). Raises `ValueError` before any write
    when the CSV has fewer than `MIN_SETTLEMENTS` rows. Logs the counts only, never a URL."""
    rows = read_settlements(csv_path)
    if len(rows) < MIN_SETTLEMENTS:
        raise ValueError(f"settlements CSV has {len(rows)} rows, expected {MIN_SETTLEMENTS}+")
    counts = dict.fromkeys(
        ("settlements", "neighbourhoods", "deactivated", "files_failed", "kept_inactive"), 0
    )
    settlements = _upsert(db, rows, SETTLEMENT_BOX_DEG)
    counts["settlements"] = len(settlements)
    counts["deactivated"] += _deactivate(
        db, Area.kind == "settlement", Area.source_code.not_in(list(settlements))
    )
    db.commit()
    stored = list(settlements.values())
    for code in BIG_CITY_CODES:
        if code not in settlements:
            continue
        parent_id = settlements[code][0]
        try:
            city = parse_rent_file(
                fetcher.fetch(f"settlement/rent/{code}.json"), "settlement", code, code
            )
        except Exception:  # a failed file is counted and skipped; it deactivates nothing
            counts["files_failed"] += 1
            continue
        if not city.neighbourhood_ids:  # a big city listing none is a bad file, not a removal
            counts["files_failed"] += 1
            continue
        hood_rows = []
        for hood_id in city.neighbourhood_ids:
            try:
                hood = parse_rent_file(
                    fetcher.fetch(f"neighborhood/rent/{hood_id}.json"),
                    "neighbourhood",
                    hood_id,
                    code,
                )
            except Exception:
                counts["files_failed"] += 1
                continue
            hood_rows.append(
                {
                    "kind": "neighbourhood",
                    "source_code": hood_id,
                    "parent_id": parent_id,
                    "name_he": hood.name,
                    "x": hood.x,
                    "y": hood.y,
                    "streets": hood.streets,
                }
            )
        hoods = _upsert(db, hood_rows, NEIGHBOURHOOD_BOX_DEG)
        counts["neighbourhoods"] += len(hoods)
        stored += hoods.values()
        counts["deactivated"] += _deactivate(
            db,
            Area.kind == "neighbourhood",
            Area.parent_id == parent_id,
            Area.source_code.not_in(city.neighbourhood_ids),
        )
        db.commit()
    counts["kept_inactive"] = sum(1 for _id, active in stored if not active)
    log.info("area import: %s", counts)
    return counts
