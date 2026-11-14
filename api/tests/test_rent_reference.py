"""The official rent figures import (spec 0014a): parser rules, upserts, soft failures, the
polite `NadlanFetcher` and the `off` switch. No test reaches nadlan.gov.il: the import reads the
trimmed fixtures through `FakeRentFetcher`, the fetcher talks to an `httpx.MockTransport`."""

import copy
import datetime as dt
import functools
import json
import logging
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_sessionmaker
from app.services import rent_reference
from app.services.rent_reference import (
    MAX_BODY_BYTES,
    RENT_SETTLEMENT_CODES,
    NadlanFetcher,
    RentSourceError,
    get_rent_fetcher,
    import_rent_reference,
)

FIXTURES = Path(__file__).parent / "fixtures" / "rent_reference"
TEL_AVIV = "settlement/rent/5000.json"
AZOR = "settlement/rent/565.json"
REVIVIM = "neighborhood/rent/65210029.json"
RAMAT_HAHAYAL = "neighborhood/rent/65210036.json"
Q2_2026 = dt.date(2026, 6, 1)


class FakeRentFetcher:
    """Serves parsed files by path; a missing path answers like a 404."""

    def __init__(self, files: dict[str, object | RentSourceError]) -> None:
        self.files = files
        self.requests: list[str] = []

    def fetch(self, path: str) -> object:
        self.requests.append(path)
        value = self.files.get(path, RentSourceError("status 404"))
        if isinstance(value, RentSourceError):
            raise value
        return copy.deepcopy(value)


def _load(name: str) -> Any:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def _files() -> dict[str, Any]:
    """Tel Aviv with its two neighbourhoods (the second one a renamed copy of the first) and
    Azor, which lists none."""
    revivim = _load("neighborhood_65210029.json")
    ramat_hahayal = {**copy.deepcopy(revivim), "neighborhoodId": 65210036}
    ramat_hahayal["neighborhoodName"] = "רמת החייל"
    return {
        TEL_AVIV: _load("settlement_5000.json"),
        AZOR: _load("settlement_565.json"),
        REVIVIM: revivim,
        RAMAT_HAHAYAL: ramat_hahayal,
    }


def _expected(data: dict[str, Any], price_key: str) -> dict[tuple[int, dt.date], int]:
    """Every non-null (rooms, quarter) of a fixture, `"all"` as 0."""
    return {
        (
            0 if entry["numRooms"] == "all" else entry["numRooms"],
            dt.date(p["year"], p["month"], 1),
        ): p[price_key]
        for entry in data["trends"]["rooms"]
        for p in entry["graphData"]
        if p[price_key] is not None
    }


@pytest.fixture
def db(rent_clean: Engine) -> Iterator[Session]:
    with get_sessionmaker()() as session:
        yield session


@pytest.fixture
def two_settlements(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(rent_reference, "RENT_SETTLEMENT_CODES", (5000, 565))


def _prices(engine: Engine, kind: str, source_id: int) -> dict[tuple[int, dt.date], int]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT p.rooms, p.period, p.price_ils FROM rent_prices p"
                " JOIN rent_areas a ON a.id = p.area_id"
                " WHERE a.kind = :kind AND a.source_id = :source"
            ),
            {"kind": kind, "source": source_id},
        ).tuples()
        return {(rooms, period): price for rooms, period, price in rows}


def _area(engine: Engine, kind: str, source_id: int) -> Any:
    with engine.connect() as conn:
        return conn.execute(
            text(
                "SELECT settlement_code, name_he, streets, source_version,"
                " ST_X(centre) AS lng, ST_Y(centre) AS lat, ST_SRID(centre) AS srid"
                " FROM rent_areas WHERE kind = :kind AND source_id = :source"
            ),
            {"kind": kind, "source": source_id},
        ).one_or_none()


@pytest.mark.usefixtures("two_settlements")
def test_ac2_settlement_file_stored(db: Session, rent_clean: Engine) -> None:
    files = _files()
    counts = import_rent_reference(db, FakeRentFetcher(files))

    assert counts == {
        "files_ok": 4,
        "files_failed": 0,
        "areas": 4,
        "prices_new": counts["prices_new"],
        "prices_changed": 0,
    }
    area = _area(rent_clean, "settlement", 5000)
    assert (area.settlement_code, area.name_he, area.streets, area.source_version) == (
        5000,
        "תל אביב -יפו",
        [],
        "20-08-2026",
    )
    prices = _prices(rent_clean, "settlement", 5000)
    assert prices == _expected(files[TEL_AVIV], "settlementPrice")
    assert prices[(0, Q2_2026)] == 8300  # "all"
    assert prices[(3, Q2_2026)] == 8250
    assert {rooms for rooms, _ in prices} == {0, 3, 4, 5}
    # Azor's null quarters have no row.
    azor = _expected(files[AZOR], "settlementPrice")
    assert (5, Q2_2026) not in azor
    assert _prices(rent_clean, "settlement", 565) == azor
    assert counts["prices_new"] == sum(
        len(_prices(rent_clean, kind, source))
        for kind, source in (
            ("settlement", 5000),
            ("settlement", 565),
            ("neighbourhood", 65210029),
            ("neighbourhood", 65210036),
        )
    )


@pytest.mark.usefixtures("two_settlements")
def test_ac3_neighbourhood_file_stored(db: Session, rent_clean: Engine) -> None:
    files = _files()
    import_rent_reference(db, FakeRentFetcher(files))

    area = _area(rent_clean, "neighbourhood", 65210029)
    assert (area.settlement_code, area.name_he) == (5000, "רביבים")
    titles = [street["title"] for street in files[REVIVIM]["otherNeighborhoodStreets"]]
    assert len(titles) == 6 and len(set(titles)) == 5  # the fixture repeats one street
    assert area.streets == list(dict.fromkeys(titles))
    prices = _prices(rent_clean, "neighbourhood", 65210029)
    assert prices == _expected(files[REVIVIM], "neighborhoodPrice")
    assert not any(rooms == 4 for rooms, _ in prices)  # every 4-room quarter is null
    assert (3, dt.date(2025, 6, 1)) not in prices  # a null quarter between two figures
    assert prices[(3, Q2_2026)] == 8200


@pytest.mark.usefixtures("two_settlements")
def test_ac4_centre_is_wgs84(db: Session, rent_clean: Engine) -> None:
    files = _files()
    assert (round(files[TEL_AVIV]["x"], 2), round(files[TEL_AVIV]["y"], 2)) == (
        179706.07,
        666156.93,
    )
    import_rent_reference(db, FakeRentFetcher(files))

    area = _area(rent_clean, "settlement", 5000)
    assert area.srid == 4326
    assert 34.76 <= area.lng <= 34.80
    assert 32.06 <= area.lat <= 32.10


@pytest.mark.usefixtures("two_settlements")
def test_ac5_import_is_idempotent(
    db: Session, rent_clean: Engine, caplog: pytest.LogCaptureFixture
) -> None:
    def snapshot() -> tuple[int, list[Any]]:
        with rent_clean.connect() as conn:
            areas = conn.execute(text("SELECT count(*) FROM rent_areas")).scalar_one()
            prices = conn.execute(
                text(
                    "SELECT area_id, rooms, period, price_ils, updated_at FROM rent_prices"
                    " ORDER BY area_id, rooms, period"
                )
            ).all()
        return areas, list(prices)

    first = import_rent_reference(db, FakeRentFetcher(_files()))
    before = snapshot()
    caplog.clear()
    caplog.set_level(logging.INFO, logger="app.services.rent_reference")

    second = import_rent_reference(db, FakeRentFetcher(_files()))

    assert second == {**first, "prices_new": 0, "prices_changed": 0}
    assert first["prices_new"] > 0
    assert snapshot() == before
    # NF1: one INFO line with the counts and the version; no path, URL or file content.
    (line,) = [r for r in caplog.records if r.name == "app.services.rent_reference"]
    assert line.levelno == logging.INFO
    message = line.getMessage()
    for key in ("files_ok", "files_failed", "areas", "prices_new", "prices_changed", "20-08-2026"):
        assert key in message
    for leaked in ("rent/", "http", "nadlan", "תל אביב", "רביבים"):
        assert leaked not in caplog.text


@pytest.mark.usefixtures("two_settlements")
def test_ac6_revised_updates_missing_stays(db: Session, rent_clean: Engine) -> None:
    import_rent_reference(db, FakeRentFetcher(_files()))
    stored = _prices(rent_clean, "settlement", 5000)

    files = _files()
    three_rooms = next(e for e in files[TEL_AVIV]["trends"]["rooms"] if e["numRooms"] == 3)
    revised, missing = three_rooms["graphData"][:2]
    assert (revised["month"], missing["month"]) == (6, 3)
    revised["settlementPrice"] = 8999
    three_rooms["graphData"].remove(missing)
    counts = import_rent_reference(db, FakeRentFetcher(files))

    assert (counts["prices_new"], counts["prices_changed"]) == (0, 1)
    prices = _prices(rent_clean, "settlement", 5000)
    assert prices[(3, Q2_2026)] == 8999
    assert prices[(3, dt.date(2026, 3, 1))] == stored[(3, dt.date(2026, 3, 1))] == 8200
    assert prices == {**stored, (3, Q2_2026): 8999}


def _set(key: str, value: object) -> Callable[[Any], Any]:
    def mutate(data: Any) -> Any:
        data[key] = value
        return data

    return mutate


_TA = ("settlement", 5000)
_AZ = ("settlement", 565)
_RV = ("neighbourhood", 65210029)
_RH = ("neighbourhood", 65210036)
# (case, path, mutation, its area, the area imported after it)
_BAD_FILES: tuple[tuple[str, str, Callable[[Any], Any], tuple[str, int], tuple[str, int]], ...] = (
    ("not_json_object", TEL_AVIV, lambda data: [data], _TA, _AZ),
    ("wrong_id", TEL_AVIV, _set("settlementID", 5001), _TA, _AZ),
    ("bool_id", TEL_AVIV, _set("settlementID", True), _TA, _AZ),
    ("wrong_settlement", REVIVIM, _set("settlementID", 6300), _RV, _RH),
    ("control_char_name", TEL_AVIV, _set("settlementName", "תל\x07אביב"), _TA, _AZ),
    ("x_out_of_bounds", TEL_AVIV, _set("x", 99999.0), _TA, _AZ),
    ("y_out_of_bounds", REVIVIM, _set("y", 800001.0), _RV, _RH),
    ("x_as_string", TEL_AVIV, _set("x", "179706.07"), _TA, _AZ),
    ("no_trends_rooms", TEL_AVIV, _set("trends", {}), _TA, _AZ),
    ("version_21_chars", REVIVIM, _set("version", "v" * 21), _RV, _RH),
    ("version_control_chars", TEL_AVIV, _set("version", "1\nERROR forged"), _TA, _AZ),
    (
        "501_neighbourhoods",
        TEL_AVIV,
        _set("otherNeighborhoods", [{"id": 70000000 + i, "title": "x"} for i in range(501)]),
        _TA,
        _AZ,
    ),
)


@pytest.mark.usefixtures("two_settlements")
@pytest.mark.parametrize(
    ("path", "mutate", "bad_area", "next_area"),
    [case[1:] for case in _BAD_FILES],
    ids=[case[0] for case in _BAD_FILES],
)
def test_ac7_bad_file_skipped(
    db: Session,
    rent_clean: Engine,
    path: str,
    mutate: Callable[[Any], Any],
    bad_area: tuple[str, int],
    next_area: tuple[str, int],
) -> None:
    files = _files()
    files[path] = mutate(files[path])
    fetcher = FakeRentFetcher(files)
    counts = import_rent_reference(db, fetcher)

    assert counts["files_failed"] == 1
    if bad_area[0] == "settlement":  # none of its neighbourhoods is requested
        assert not any(p.startswith("neighborhood/") for p in fetcher.requests)
    assert _area(rent_clean, *bad_area) is None
    assert _prices(rent_clean, *bad_area) == {}
    assert _area(rent_clean, *next_area) is not None
    assert _prices(rent_clean, *next_area) != {}


# (case, mutation of Azor's first 3-room point (2026-Q2), the keys that then have no row)
_THREE_ROOMS = {(3, dt.date(2026, 6, 1)), (3, dt.date(2026, 3, 1)), (3, dt.date(2025, 9, 1))}
_BAD_POINTS: tuple[tuple[str, dict[str, object], set[tuple[int, dt.date]]], ...] = (
    ("price_99", {"settlementPrice": 99}, {(3, Q2_2026)}),
    ("price_1000000", {"settlementPrice": 1000000}, {(3, Q2_2026)}),
    ("price_string", {"settlementPrice": "8000"}, {(3, Q2_2026)}),
    ("price_float", {"settlementPrice": 8000.0}, {(3, Q2_2026)}),
    ("price_true", {"settlementPrice": True}, {(3, Q2_2026)}),
    ("price_null", {"settlementPrice": None}, {(3, Q2_2026)}),
    ("month_5", {"month": 5}, {(3, Q2_2026)}),
    ("year_string", {"year": "2026"}, {(3, Q2_2026)}),
    ("num_rooms_2", {"numRooms": 2}, _THREE_ROOMS),
)


@pytest.mark.parametrize(
    ("change", "missing"),
    [case[1:] for case in _BAD_POINTS],
    ids=[case[0] for case in _BAD_POINTS],
)
def test_ac8_bad_point_skipped(
    db: Session,
    rent_clean: Engine,
    monkeypatch: pytest.MonkeyPatch,
    change: dict[str, object],
    missing: set[tuple[int, dt.date]],
) -> None:
    monkeypatch.setattr(rent_reference, "RENT_SETTLEMENT_CODES", (565,))
    files = _files()
    expected = _expected(files[AZOR], "settlementPrice")
    assert missing <= expected.keys()
    three_rooms = next(e for e in files[AZOR]["trends"]["rooms"] if e["numRooms"] == 3)
    if "numRooms" in change:
        three_rooms.update(change)
    else:
        three_rooms["graphData"][0].update(change)
    counts = import_rent_reference(db, FakeRentFetcher(files))

    assert (counts["files_ok"], counts["files_failed"]) == (1, 0)
    assert _prices(rent_clean, "settlement", 565) == {
        key: price for key, price in expected.items() if key not in missing
    }


@pytest.mark.usefixtures("two_settlements")
@pytest.mark.parametrize(
    "failure", [RentSourceError("status 500"), RentSourceError("ConnectTimeout")], ids=str
)
def test_ac9_failed_settlement_is_soft(
    db: Session, rent_clean: Engine, monkeypatch: pytest.MonkeyPatch, failure: RentSourceError
) -> None:
    files: dict[str, object | RentSourceError] = {**_files(), TEL_AVIV: failure}
    fetcher = FakeRentFetcher(files)
    counts = import_rent_reference(db, fetcher)

    assert fetcher.requests == [TEL_AVIV, AZOR]  # none of Tel Aviv's neighbourhoods
    assert (counts["files_ok"], counts["files_failed"]) == (1, 1)
    assert _area(rent_clean, "settlement", 5000) is None
    assert _area(rent_clean, "settlement", 565) is not None

    # NF1: a full run requests each settlement and each listed neighbourhood once, in order.
    monkeypatch.setattr(rent_reference, "RENT_SETTLEMENT_CODES", RENT_SETTLEMENT_CODES)
    fetcher = FakeRentFetcher(_files())
    counts = import_rent_reference(db, fetcher)
    assert fetcher.requests == [
        path
        for code in RENT_SETTLEMENT_CODES
        for path in (
            [f"settlement/rent/{code}.json"] + ([REVIVIM, RAMAT_HAHAYAL] if code == 5000 else [])
        )
    ]
    assert len(RENT_SETTLEMENT_CODES) == 19
    assert (counts["files_ok"], counts["files_failed"]) == (4, 17)


@pytest.mark.asyncio
async def test_ac10_off_makes_no_request(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], rent_clean: Engine
) -> None:
    def no_fetcher() -> NadlanFetcher:
        raise AssertionError("a fetcher was built with RENT_REFERENCE=off")

    settings = get_settings()
    monkeypatch.setattr(
        rent_reference,
        "get_settings",
        lambda: settings.model_copy(update={"rent_reference": "off"}),
    )
    monkeypatch.setattr(rent_reference, "get_rent_fetcher", no_fetcher)
    httpx_logger = logging.getLogger("httpx")
    level = httpx_logger.level
    try:
        from app import worker  # sets the httpx logger to WARNING (test_worker.py)

        assert await worker.import_rent_reference_job({}) == {"skipped": 1}
    finally:
        httpx_logger.setLevel(level)
    from scripts import import_rent_reference as script

    script.main()
    assert capsys.readouterr().out == "rent-import: {'skipped': 1}\n"

    # The contrast: `nadlan` builds the fetcher and runs the import (here on a 404-only mock).
    requests: list[httpx.Request] = []

    def not_found(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(404)

    nadlan = NadlanFetcher(
        httpx.Client(transport=httpx.MockTransport(not_found), base_url="https://n.test"),
        sleep=lambda _: None,
    )
    monkeypatch.setattr(
        rent_reference,
        "get_settings",
        lambda: settings.model_copy(update={"rent_reference": "nadlan"}),
    )
    monkeypatch.setattr(rent_reference, "get_rent_fetcher", lambda: nadlan)
    counts = rent_reference.run_rent_import()
    assert counts["files_failed"] == len(requests) == 19
    assert nadlan.client.is_closed


def test_ac11_fetcher_is_polite(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[httpx.Request] = []

    def source(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        name = request.url.path.rsplit("/", 1)[-1]
        if name == "cookie.json":
            return httpx.Response(200, json={"a": 1}, headers={"Set-Cookie": "sid=abc; Path=/"})
        if name == "bom.json":
            return httpx.Response(200, content='﻿{"name": "אזור"}'.encode())
        if name == "redirect.json":
            return httpx.Response(302, headers={"Location": "https://elsewhere.test/x.json"})
        if name == "big.json":
            return httpx.Response(200, content=b" " * (MAX_BODY_BYTES + 1))
        if name == "gzip.json":
            return httpx.Response(200, content=b"\x1f\x8b", headers={"Content-Encoding": "gzip"})
        if name == "fail.json":
            return httpx.Response(500)
        if name == "not-json.json":
            return httpx.Response(200, content=b"<html>")
        raise httpx.ConnectTimeout("timed out", request=request)

    monkeypatch.setattr(
        httpx, "Client", functools.partial(httpx.Client, transport=httpx.MockTransport(source))
    )
    client = get_rent_fetcher().client
    assert client.follow_redirects is False
    assert client.timeout == httpx.Timeout(30.0)
    sleeps: list[float] = []
    fetcher = NadlanFetcher(client, sleep=sleeps.append)

    assert fetcher.fetch("settlement/rent/cookie.json") == {"a": 1}
    assert sleeps == []
    assert fetcher.fetch("settlement/rent/bom.json") == {"name": "אזור"}
    assert sleeps == [0.25]
    first, second = seen
    assert str(first.url) == "https://data.nadlan.gov.il/api/pages/settlement/rent/cookie.json"
    for request in (first, second):
        assert request.headers["User-Agent"] == "homie-rent-reference"
        assert request.headers["Accept-Encoding"] == "identity"
    assert "cookie" not in second.headers

    for path in (
        "redirect.json",
        "big.json",
        "gzip.json",
        "fail.json",
        "not-json.json",
        "timeout.json",
    ):
        with pytest.raises(RentSourceError) as excinfo:
            fetcher.fetch(path)
        assert "nadlan" not in str(excinfo.value)
        assert "html" not in str(excinfo.value)
    assert not any(request.url.host == "elsewhere.test" for request in seen)
    assert len(seen) == 8
    assert sleeps == [0.25] * 7
