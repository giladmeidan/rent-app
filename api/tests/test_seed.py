"""scripts/seed.py (AC5; spec 0021a1: the areas from the CSV and the rent fixtures, no network)."""

import copy

from sqlalchemy import Engine, text

from app.db import get_sessionmaker
from app.services.areas import import_areas
from scripts.seed import seed_areas
from tests.test_rent_reference import REVIVIM, TEL_AVIV, FakeRentFetcher, _files


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

    assert second == {"skipped": 1}  # a neighbourhood is stored
    assert first["settlements"] > 1000
    assert first["neighbourhoods"] == 1  # the fixtures hold one of Tel Aviv's two
    assert {kind: (active, total) for kind, active, total in rows} == {
        "settlement": (first["settlements"], first["settlements"]),
        "neighbourhood": (1, 1),
    }
    assert tuple(tel_aviv) == ("תל אביב-יפו", 4326, "MULTIPOLYGON", "POINT")


def test_seed_after_real_import_keeps_neighbourhoods(db_engine: Engine) -> None:
    """Review 0021a1: the fixtures list fewer Tel Aviv neighbourhoods than a real import stores;
    seeding afterwards (every `make dev`) must not deactivate the rest."""
    files = _files()
    third = {**copy.deepcopy(files[REVIVIM]), "neighborhoodId": 65210099, "neighborhoodName": "ג"}
    files["neighborhood/rent/65210099.json"] = third
    for key in ("otherNeighborhoods", "neighborhoodsPrices"):
        files[TEL_AVIV][key].append({"id": 65210099})
    with get_sessionmaker()() as db:
        assert import_areas(db, FakeRentFetcher(files))["neighbourhoods"] == 3

    assert seed_areas(db_engine) == {"skipped": 1}

    with db_engine.connect() as conn:
        active = conn.execute(
            text("SELECT count(*) FROM areas WHERE kind = 'neighbourhood' AND is_active")
        ).scalar_one()
    assert active == 3
