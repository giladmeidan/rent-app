"""GET /areas (AC3 of 0001) and the national area catalogue (spec 0021a1): `settlement_row`,
`import_areas` with fixture fetchers (no network) and the response's fields and cache header."""

import csv
import math
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session

from app.db import get_session, get_sessionmaker, make_engine
from app.main import create_app
from app.services import areas
from app.services.areas import CSV_PATH, import_areas
from app.services.rent_reference import RentSourceError
from scripts.build_settlements import settlement_row
from scripts.seed import FixtureFetcher
from tests.conftest import insert_settlement
from tests.test_rent_reference import (
    RAMAT_HAHAYAL,
    REVIVIM,
    TEL_AVIV,
    FakeRentFetcher,
    _files,
)

# WGS84 (lng, lat) of the EPSG:2039 points: Tel Aviv-Yafo's CBS coordinate (180263, 664864) and
# Revivim's nadlan centre (184078.5627, 669293.0305), from PostGIS on 2026-11-17.
TEL_AVIV_CENTRE = (34.789396764, 32.076450276)
REVIVIM_CENTRE = (34.829645169, 32.116516258)
# Judea and Samaria (CBS district 7): Ariel, Ma'ale Adumim, Beitar Illit, Modi'in Illit.
JUDEA_AND_SAMARIA = {3570, 3616, 3780, 3797}
KATZRIN = 4100  # the Golan stays


def _csv_codes() -> list[int]:
    with CSV_PATH.open(encoding="utf-8") as file:
        return [int(row["code"]) for row in csv.DictReader(r for r in file if r[0] != "#")]


def _metres(a: tuple[float, float], b: tuple[float, float]) -> float:
    dx = (a[0] - b[0]) * 111_320 * math.cos(math.radians(b[1]))
    dy = (a[1] - b[1]) * 110_574
    return math.hypot(dx, dy)


@pytest.fixture
def db(db_engine: Engine) -> Iterator[Session]:
    with get_sessionmaker()() as session:
        yield session


def _write_csv(path: Path, rows: list[tuple[int, str]]) -> Path:
    lines = ["# test", "code,name_he,district,itm_x,itm_y"]
    lines += [f"{code},{name},5,180263,664864" for code, name in rows]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def _snapshot(engine: Engine) -> list[Any]:
    with engine.connect() as conn:
        return list(
            conn.execute(
                text(
                    "SELECT id, slug, kind, source_code, parent_id, name_he, streets, is_active,"
                    " ST_AsText(centre), ST_AsText(geom) FROM areas ORDER BY kind, source_code"
                )
            ).tuples()
        )


def _active(engine: Engine, kind: str, code: int) -> bool:
    with engine.connect() as conn:
        active: bool = conn.execute(
            text("SELECT is_active FROM areas WHERE kind = :k AND source_code = :c"),
            {"k": kind, "c": code},
        ).scalar_one()
    return active


def _set_active(engine: Engine, kind: str, code: int, active: bool) -> None:
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE areas SET is_active = :a WHERE kind = :k AND source_code = :c"),
            {"a": active, "k": kind, "c": code},
        )


def test_ac1_catalogue(client: TestClient, db: Session, db_engine: Engine) -> None:
    import_areas(db, FakeRentFetcher(_files()))
    _set_active(db_engine, "settlement", 565, False)  # the admin closes Azor

    response = client.get("/areas")

    assert response.status_code == 200
    body = response.json()
    settlements = {a["slug"]: a for a in body if a["kind"] == "settlement"}
    hoods = {a["slug"]: a for a in body if a["kind"] == "neighbourhood"}
    assert set(settlements) == {f"s-{code}" for code in _csv_codes()} - {"s-565"}
    assert set(hoods) == {"n-65210029", "n-65210036"}
    assert len(body) == len(settlements) + len(hoods)
    assert all(set(a) == {"id", "slug", "name_he", "kind", "parent_id", "centre"} for a in body)
    tel_aviv = settlements["s-5000"]
    assert tel_aviv["name_he"] == "תל אביב-יפו"
    assert tel_aviv["parent_id"] is None
    assert {a["parent_id"] for a in hoods.values()} == {tel_aviv["id"]}
    assert hoods["n-65210029"]["name_he"] == "רביבים"
    assert _metres(tuple(tel_aviv["centre"]), TEL_AVIV_CENTRE) < 1
    assert _metres(tuple(hoods["n-65210029"]["centre"]), REVIVIM_CENTRE) < 1


def test_ac2_import_idempotent_and_soft(
    db: Session, db_engine: Engine, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(areas, "MIN_SETTLEMENTS", 1)  # two-row CSVs below
    csv_path = _write_csv(tmp_path / "s.csv", [(5000, "תל אביב-יפו"), (565, "אזור")])
    files = _files()
    first = import_areas(db, FakeRentFetcher(files), csv_path)
    before = _snapshot(db_engine)

    second = import_areas(db, FakeRentFetcher(files), csv_path)

    assert first == second
    assert second["settlements"] == 2 and second["neighbourhoods"] == 2
    assert second["deactivated"] == 0
    assert _snapshot(db_engine) == before

    # Ramat HaHayal is no longer listed by Tel Aviv's file, which passes: inactive, not deleted.
    tel_aviv = files[TEL_AVIV]
    for key in ("otherNeighborhoods", "neighborhoodsPrices"):
        tel_aviv[key] = [e for e in tel_aviv[key] if int(e["id"]) != 65210036]
    del files[RAMAT_HAHAYAL]
    counts = import_areas(db, FakeRentFetcher(files), csv_path)
    assert counts["deactivated"] == 1
    assert _active(db_engine, "neighbourhood", 65210036) is False
    assert len(_snapshot(db_engine)) == len(before)

    # Revivim's own file fails under a passing Tel Aviv file: it stays active, counted failed.
    failed_before = counts["files_failed"]
    revivim = files.pop(REVIVIM)
    counts = import_areas(db, FakeRentFetcher(files), csv_path)
    assert counts["files_failed"] == failed_before + 1 and counts["deactivated"] == 0
    assert _active(db_engine, "neighbourhood", 65210029) is True
    files[REVIVIM] = revivim

    # Tel Aviv's file passes but lists no neighbourhood: a failed file, nothing deactivated.
    empty = {**tel_aviv, "otherNeighborhoods": [], "neighborhoodsPrices": []}
    counts = import_areas(db, FakeRentFetcher({**files, TEL_AVIV: empty}), csv_path)
    assert counts["files_failed"] == failed_before + 1 and counts["deactivated"] == 0
    assert _active(db_engine, "neighbourhood", 65210029) is True

    # Tel Aviv's file fails: none of its neighbourhoods is deactivated.
    files[TEL_AVIV] = RentSourceError("status 503")
    counts = import_areas(db, FakeRentFetcher(files), csv_path)
    assert counts["files_failed"] >= 1 and counts["deactivated"] == 0
    assert _active(db_engine, "neighbourhood", 65210029) is True

    # A settlement gone from the CSV becomes inactive; an admin-inactive row stays inactive.
    _set_active(db_engine, "neighbourhood", 65210029, False)
    files = _files()
    counts = import_areas(
        db, FakeRentFetcher(files), _write_csv(tmp_path / "t.csv", [(5000, "תל אביב-יפו")])
    )
    assert counts["deactivated"] == 1
    # Revivim (the admin's) and Ramat HaHayal (listed again) are in the source and stay off.
    assert counts["kept_inactive"] == 2
    assert _active(db_engine, "neighbourhood", 65210036) is False
    assert _active(db_engine, "settlement", 565) is False
    assert _active(db_engine, "neighbourhood", 65210029) is False
    assert len(_snapshot(db_engine)) == len(before)


def test_short_csv_is_refused(db: Session, db_engine: Engine, tmp_path: Path) -> None:
    insert_settlement(db_engine, 5000, "תל אביב-יפו")
    short = _write_csv(tmp_path / "s.csv", [(5000, "תל אביב-יפו")])

    with pytest.raises(ValueError, match="1 rows"):
        import_areas(db, FakeRentFetcher(_files()), short)

    assert _active(db_engine, "settlement", 5000) is True


def test_ac3_settlement_row() -> None:
    record = {"סמל יישוב": 5000, "שם יישוב": " תל אביב -יפו ", "סמל מחוז": 5}

    assert settlement_row({**record, "קואורדינטות": 180263664864}) == (
        5000,
        "תל אביב-יפו",
        5,
        180263,
        664864,
    )
    for bad in (None, "180263664864", 18026366486, 1802636648640, 990000664864, 180263064864):
        assert settlement_row({**record, "קואורדינטות": bad}) is None
    kadima = settlement_row({**record, "שם יישוב": "קדימה-צורן", "קואורדינטות": 190000690000})
    assert kadima is not None and kadima[1] == "קדימה-צורן"


def test_ac_no_judea_samaria(db: Session, db_engine: Engine) -> None:
    ariel = {"סמל יישוב": 3570, "שם יישוב": "אריאל", "סמל מחוז": 7, "קואורדינטות": 217856667882}
    assert settlement_row(ariel) is None
    with CSV_PATH.open(encoding="utf-8") as file:
        districts = {row["district"] for row in csv.DictReader(r for r in file if r[0] != "#")}
    assert "7" not in districts
    assert not JUDEA_AND_SAMARIA & set(_csv_codes())
    assert KATZRIN in _csv_codes()

    import_areas(db, FixtureFetcher())

    with db_engine.connect() as conn:
        codes = set(
            conn.execute(text("SELECT source_code FROM areas WHERE kind = 'settlement'")).scalars()
        )
    assert not JUDEA_AND_SAMARIA & codes
    assert KATZRIN in codes


def test_ac6_cache_header(client: TestClient, gush_dan: uuid.UUID) -> None:
    response = client.get("/areas")

    assert response.status_code == 200
    assert response.headers["cache-control"] == "public, max-age=86400"


def test_ac3_lists_only_active_areas_without_geom(client: TestClient, db_engine: Engine) -> None:
    insert_settlement(db_engine, 1, "פעיל")
    insert_settlement(db_engine, 2, "כבוי", active=False)

    response = client.get("/areas")

    assert response.status_code == 200
    body = response.json()
    assert [area["slug"] for area in body] == ["s-1"]
    assert set(body[0]) == {"id", "slug", "name_he", "kind", "parent_id", "centre"}
    assert "geom" not in body[0]
    assert body[0]["name_he"] == "פעיל"


def test_ac3_areas_ordered_by_name_he(client: TestClient, db_engine: Engine) -> None:
    for code, name in ((2, "ב"), (1, "א"), (3, "ג")):
        insert_settlement(db_engine, code, name)

    response = client.get("/areas")

    assert [area["name_he"] for area in response.json()] == ["א", "ב", "ג"]


def test_areas_returns_json_503_when_db_unreachable() -> None:
    # Port 1 on loopback refuses the connection immediately.
    engine = make_engine("postgresql+psycopg://rent:rent@127.0.0.1:1/rent")

    def unreachable_session() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    app = create_app()
    app.dependency_overrides[get_session] = unreachable_session
    with TestClient(app) as client:
        response = client.get("/areas")
    engine.dispose()

    assert response.status_code == 503
    assert response.headers["content-type"] == "application/json"
    assert response.json() == {"detail": "database unavailable"}
