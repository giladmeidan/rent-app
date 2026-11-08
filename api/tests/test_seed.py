"""scripts/seed.py (AC5)."""

from sqlalchemy import Engine, text

from scripts.seed import seed_areas


def test_ac5_seed_is_idempotent(db_engine: Engine) -> None:
    first = seed_areas(db_engine)
    second = seed_areas(db_engine)

    with db_engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT name_he, is_active, ST_SRID(geom), GeometryType(geom)"
                " FROM areas WHERE slug = 'gush-dan'"
            )
        ).all()

    assert (first, second) == (1, 0)
    assert len(rows) == 1
    assert tuple(rows[0]) == ("גוש דן", True, 4326, "MULTIPOLYGON")
