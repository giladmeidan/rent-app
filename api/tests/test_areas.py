"""GET /areas (AC3)."""

from collections.abc import Iterator

from fastapi.testclient import TestClient
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session

from app.db import get_session, make_engine
from app.main import create_app

_INSERT = text(
    """
    INSERT INTO areas (slug, name_he, geom, is_active)
    VALUES (:slug, :name_he, ST_GeomFromText(:wkt, 4326), :is_active)
    """
)
_WKT = "MULTIPOLYGON(((34.7 31.9, 34.9 31.9, 34.9 32.1, 34.7 32.1, 34.7 31.9)))"


def test_ac3_lists_only_active_areas_without_geom(client: TestClient, db_engine: Engine) -> None:
    with db_engine.begin() as conn:
        conn.execute(_INSERT, {"slug": "active", "name_he": "פעיל", "wkt": _WKT, "is_active": True})
        conn.execute(
            _INSERT, {"slug": "inactive", "name_he": "כבוי", "wkt": _WKT, "is_active": False}
        )

    response = client.get("/areas")

    assert response.status_code == 200
    body = response.json()
    assert [area["slug"] for area in body] == ["active"]
    assert set(body[0]) == {"id", "slug", "name_he"}
    assert "geom" not in body[0]
    assert body[0]["name_he"] == "פעיל"


def test_ac3_areas_ordered_by_name_he(client: TestClient, db_engine: Engine) -> None:
    with db_engine.begin() as conn:
        for slug, name in (("b", "ב"), ("a", "א"), ("c", "ג")):
            conn.execute(_INSERT, {"slug": slug, "name_he": name, "wkt": _WKT, "is_active": True})

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
