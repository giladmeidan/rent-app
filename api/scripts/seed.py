"""Seed the launch areas. Idempotent on `slug`; safe to run on every `make dev`.

Usage: `python api/scripts/seed.py` (reads DATABASE_URL from the environment).
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import Engine, create_engine, text  # noqa: E402

# Coarse bounding box for Gush Dan (lon 34.74–34.95, lat 31.95–32.17). Slice 3 replaces it
# with municipal boundaries.
GUSH_DAN_WKT = "MULTIPOLYGON(((34.74 31.95, 34.95 31.95, 34.95 32.17, 34.74 32.17, 34.74 31.95)))"

AREAS: tuple[tuple[str, str, str], ...] = (("gush-dan", "גוש דן", GUSH_DAN_WKT),)

_INSERT = text(
    """
    INSERT INTO areas (slug, name_he, geom)
    VALUES (:slug, :name_he, ST_GeomFromText(:wkt, 4326))
    ON CONFLICT (slug) DO NOTHING
    """
)


def seed_areas(engine: Engine) -> int:
    """Insert every missing launch area. Returns the number of rows inserted."""
    inserted = 0
    with engine.begin() as conn:
        for slug, name_he, wkt in AREAS:
            result = conn.execute(_INSERT, {"slug": slug, "name_he": name_he, "wkt": wkt})
            inserted += result.rowcount
    return inserted


def main() -> None:
    from app.config import get_settings

    engine = create_engine(get_settings().database_url)
    try:
        inserted = seed_areas(engine)
    finally:
        engine.dispose()
    print(f"seed: {inserted} area(s) inserted")


if __name__ == "__main__":
    main()
