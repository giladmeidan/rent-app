"""scripts/seed.py (AC5; spec 0021a1: the areas from the CSV and the rent fixtures, no network)."""

from sqlalchemy import Engine, text

from scripts.seed import seed_areas


def test_ac5_seed_is_idempotent(db_engine: Engine) -> None:
    first = seed_areas(db_engine)
    second = seed_areas(db_engine)

    with db_engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT kind, count(*) FILTER (WHERE is_active), count(*) FROM areas GROUP BY kind"
            )
        ).all()
        tel_aviv = conn.execute(
            text(
                "SELECT name_he, ST_SRID(geom), GeometryType(geom), GeometryType(centre)"
                " FROM areas WHERE slug = 's-5000'"
            )
        ).one()

    assert first == second
    assert first["settlements"] > 1000
    assert first["neighbourhoods"] == 1  # the fixtures hold one of Tel Aviv's two
    assert {kind: (active, total) for kind, active, total in rows} == {
        "settlement": (first["settlements"],) * 2,
        "neighbourhood": (1, 1),
    }
    assert tuple(tel_aviv) == ("תל אביב-יפו", 4326, "MULTIPOLYGON", "POINT")
