"""The CBS small-flat rent import (spec 0014d): the parser on the real 7/2026 file and on xlsx built
here, the upsert by bulletin, and the job with `httpx.MockTransport` (never the network)."""

import datetime as dt
import functools
import io
import logging
import time
import zipfile
from collections.abc import Callable, Iterator
from decimal import Decimal
from pathlib import Path
from typing import Any

import httpx
import openpyxl
import pytest
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_sessionmaker
from app.services import cbs_rent
from app.services.cbs_rent import (
    CbsFileError,
    CbsRow,
    CbsTable,
    bulletin_url,
    get_cbs_client,
    import_cbs_rent,
    parse_table,
    store,
)
from app.services.rent_reference import REQUEST_INTERVAL_S

REAL = (Path(__file__).parent / "fixtures" / "cbs_rent" / "a4_9_e_2026_07.xlsx").read_bytes()
TODAY = dt.date(2026, 11, 14)
HTML_PAGE = b"<!DOCTYPE html><html><body>error</body></html>".ljust(2056, b" ")


@pytest.fixture
def db(cbs_clean: Engine) -> Iterator[Session]:
    with get_sessionmaker()() as session:
        yield session


@pytest.fixture
def no_sleep(monkeypatch: pytest.MonkeyPatch) -> list[float]:
    sleeps: list[float] = []
    monkeypatch.setattr(time, "sleep", sleeps.append)
    return sleeps


def _stored(engine: Engine) -> list[Any]:
    with engine.connect() as conn:
        return list(
            conn.execute(
                text(
                    "SELECT geo_kind, geo_code, room_group, period, price_ils, sampling_error,"
                    " bulletin FROM cbs_rent_prices ORDER BY 1, 2, 3, 4"
                )
            ).all()
        )


def test_ac1_parse_real_file() -> None:
    table = parse_table(REAL, today=TODAY)
    assert table.bulletin == dt.date(2026, 7, 1)
    rows = {(r.geo_kind, r.geo_code, r.room_group, r.period): r for r in table.rows}
    assert len(table.rows) == len(rows) == 322  # 7 periods × 24 blocks × 2 groups − 14 `-` cells

    q2_2026 = rows[("city", 5000, "1-2", dt.date(2026, 6, 1))]
    assert (q2_2026.price_ils, q2_2026.sampling_error) == (Decimal("5486.7"), Decimal("71.67"))
    assert rows[("city", 5000, "2.5-3", dt.date(2026, 6, 1))].price_ils == Decimal("7092.6")
    # Column F is I-III 2025 although row 4 holds 2024 over B:E and 2025 only at H.
    assert rows[("city", 5000, "1-2", dt.date(2025, 3, 1))].price_ils == Decimal("5362.6")
    assert rows[("city", 5000, "1-2", dt.date(2024, 12, 1))].price_ils == Decimal("5333.3")

    blocks = {(r.geo_kind, r.geo_code) for r in table.rows}
    assert {("district", 4), ("district", 5)} <= blocks
    assert {("city", 6400), ("city", 6600), ("city", 7100)} <= blocks
    assert len(blocks) == 24
    assert ("city", 2) not in blocks and ("city", 3) not in blocks  # the room rows
    assert {r.room_group for r in table.rows} == {"1-2", "2.5-3"}  # no Total, 3.5-4 or 4.5 +
    # Quarters only, no annual averages: seven consecutive quarter periods.
    assert sorted({r.period for r in table.rows}) == [
        dt.date(2024, 12, 1),
        dt.date(2025, 3, 1),
        dt.date(2025, 6, 1),
        dt.date(2025, 9, 1),
        dt.date(2025, 12, 1),
        dt.date(2026, 3, 1),
        dt.date(2026, 6, 1),
    ]
    assert not [r for r in table.rows if r.geo_code in (2610, 6900) and r.room_group == "1-2"]
    assert [kind for kind, code in blocks if code in (2, 3)] == ["district", "district"]


# A small valid table: I-III and IV-VI 2026 in bulletin 7/2026, districts 4 and 5 and city 5000.
def _layout() -> list[list[Any]]:
    def block(header: str, small: float, large: float) -> list[list[Any]]:
        return [
            [header, 9000, 90],
            ["1-2", small, 40.123, small + 100, 41],
            ["2.5-3", large, 50, large + 100, 51],
            ["3.5-4", 9000, 60, 9100, 61],
            ["4.5 +", 9900, 70, 9990, 71],
        ]

    return [
        ["Last produced for Price Statistics Monthly No. 7/2026, Central Bureau of Statistics"],
        [],
        ["Table 4.9 Average Monthly Prices of Rent (NIS)"],
        ["Districts\nand no.\nof rooms", "2026"],
        [None, "I-III", None, "IV-VI"],
        [None, "Average\nprice ", "Sampling\nerror", "Average\nprice ", "Sampling\nerror"],
        ["Total", 4000, 10, 4100, 11],
        ["1-2", 3000, 30, 3100, 31],
        ["Residential Districts"],
        *block("center District - 4", 4000, 5000),
        *block("Tel Aviv District - 5", 5000, 6000),
        ["Big cities"],
        *block("Tel Aviv - 5000", 5500, 7000),
        ["(1) Prices in the various quarters include changes."],
    ]


def _october(trailing_year: str | None) -> list[list[Any]]:
    """`_layout` as October bulletins lay it out: an "Annual average" column first, its year
    (2025) in `B4`, the quarters after it; and a trailing annual-average column with
    `trailing_year` over it."""
    rows = _layout()
    rows[3] = ["Districts", "2025", None, "2026", None, None, None, trailing_year]
    rows[4] = [None, "Annual average", None, "I-III", None, "IV-VI", None, "Annual average"]
    for row in rows[6:]:
        if len(row) > 1:
            row[1:1] = [8000, 80]
    return rows


def _xlsx(rows: list[list[Any]]) -> bytes:
    book = openpyxl.Workbook()
    sheet = book.active
    assert sheet is not None
    for row in rows:
        sheet.append(row)
    out = io.BytesIO()
    book.save(out)
    return out.getvalue()


def _swap_sheet_xml(content: bytes, old: bytes, new: bytes) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(content)) as src, zipfile.ZipFile(out, "w") as dst:
        for item in src.infolist():
            data = src.read(item)
            if item.filename == "xl/worksheets/sheet1.xml":
                assert old in data
                data = data.replace(old, new)
            dst.writestr(item, data)
    return out.getvalue()


def _zip(entries: int, size: int) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        for i in range(entries):
            archive.writestr(f"x{i}.xml", b"\0" * size)
    return out.getvalue()


def _with(change: Callable[[list[list[Any]]], None]) -> bytes:
    rows = _layout()
    change(rows)
    return _xlsx(rows)


def _set(row: int, col: int, value: object) -> Callable[[list[list[Any]]], None]:
    def change(rows: list[list[Any]]) -> None:
        while len(rows[row]) <= col:
            rows[row].append(None)
        rows[row][col] = value

    return change


def _insert(at: int, row: list[Any]) -> Callable[[list[list[Any]]], None]:
    return lambda rows: rows.insert(at, row)


BAD_FILES: dict[str, Callable[[], bytes]] = {
    "html_page": lambda: HTML_PAGE,
    "not_zip": lambda: b"PK\x03\x04 but not a zip",
    "zip_entries": lambda: _zip(101, 1),
    "zip_size": lambda: _zip(1, 21 * 1024 * 1024),
    "zip_not_xlsx": lambda: _zip(2, 10),
    "a1_no_bulletin": lambda: _with(_set(0, 0, "Price Statistics Monthly")),
    "bulletin_after_today": lambda: _with(_set(0, 0, "Monthly No. 12/2026, CBS")),
    "bulletin_month_13": lambda: _with(_set(0, 0, "Monthly No. 13/2025, CBS")),
    "unknown_label": lambda: _with(_set(4, 3, "Q2")),
    "out_of_sequence": lambda: _with(_set(4, 3, "VII-IX")),
    "row4_year_disagrees": lambda: _with(_set(3, 3, "2025")),
    "row4_year_off_quarter": lambda: _with(_set(3, 2, "2026")),
    "first_year_before_2015": lambda: _with(_set(3, 1, "2014")),
    "newest_not_before_bulletin": lambda: _with(_set(0, 0, "Monthly No. 6/2026, CBS")),
    "no_quarter_column": lambda: _with(lambda rows: rows.__setitem__(4, [None, "Annual average"])),
    "header_before_section": lambda: _with(_insert(7, ["Tel Aviv - 5000"])),
    "duplicate_block": lambda: _with(lambda rows: rows.extend(_layout()[-6:-1])),
    "no_city_5000": lambda: _with(_set(20, 0, "Tel Aviv - 5001")),
    "no_district_4": lambda: _with(_set(9, 0, "center District - 7")),
    "two_sheets": lambda: _two_sheets(),
    "room_row_twice": lambda: _with(_insert(22, ["1-2", 5600, 40, 5700, 41])),
    "a1_year_0000": lambda: _with(_set(0, 0, "Monthly No. 7/0000, CBS")),
    "b4_0000": lambda: _with(_set(3, 1, "0000")),
    "b4_9999": lambda: _with(_set(3, 1, 9999)),
    "annual_year_disagrees": lambda: _xlsx(_october("2025")),
}


# The rule each bad file breaks (its fixed message).
RULES = {
    "html_page": "not a readable xlsx file",
    "not_zip": "not a readable xlsx file",
    "zip_entries": "too many zip entries",
    "zip_size": "too large uncompressed",
    "zip_not_xlsx": "not a readable xlsx file",
    "a1_no_bulletin": "A1 does not name the bulletin",
    "bulletin_after_today": "the bulletin is after today's month",
    "bulletin_month_13": "A1 does not name the bulletin",
    "unknown_label": "an unknown quarter label in row 5",
    "out_of_sequence": "quarter columns out of sequence",
    "row4_year_disagrees": "a row-4 year disagrees with its column",
    "row4_year_off_quarter": "a row-4 year disagrees with its column",
    "first_year_before_2015": "the first year is before 2015",
    "newest_not_before_bulletin": "the newest quarter does not end before the bulletin",
    "no_quarter_column": "no quarter column",
    "header_before_section": "a block header before any section row",
    "duplicate_block": "a block appears twice",
    "no_city_5000": "no 1-2 row for city 5000 or districts 4 and 5",
    "no_district_4": "no 1-2 row for city 5000 or districts 4 and 5",
    "two_sheets": "not exactly one sheet",
    "room_row_twice": "a room row appears twice in a block",
    "a1_year_0000": "A1 does not name the bulletin",
    "b4_0000": "a row-4 cell is not a year",
    "b4_9999": "a row-4 cell is not a year",
    "annual_year_disagrees": "a row-4 year disagrees with its column",
}


def _two_sheets() -> bytes:
    book = openpyxl.load_workbook(io.BytesIO(_xlsx(_layout())))
    book.create_sheet("other")
    out = io.BytesIO()
    book.save(out)
    return out.getvalue()


def _serve(content: bytes) -> httpx.Client:
    return httpx.Client(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, content=content))
    )


def test_ac2_valid_built_table() -> None:
    table = parse_table(_xlsx(_layout()), today=TODAY)
    assert table.bulletin == dt.date(2026, 7, 1)
    assert len(table.rows) == 12  # 3 blocks × 2 groups × 2 quarters; the Total 1-2 row skipped
    first = table.rows[0]
    assert first == CbsRow(
        "district", 4, "1-2", dt.date(2026, 3, 1), Decimal("4000.0"), Decimal("40.12")
    )


@pytest.mark.parametrize("name", BAD_FILES)
@pytest.mark.usefixtures("no_sleep")
def test_ac2_bad_files_and_cells(name: str, cbs_clean: Engine, db: Session) -> None:
    content = BAD_FILES[name]()
    with pytest.raises(CbsFileError) as caught:
        parse_table(content, today=TODAY)
    assert str(caught.value) == RULES[name]  # a fixed rule text, never the file or the URL
    with _serve(content) as client:
        result = import_cbs_rent(db, client, today=TODAY)
    # A body that is not a zip is no file at all (skipped); a zip that breaks a rule is rejected.
    assert result == ({"skipped": 1} if not content.startswith(b"PK\x03\x04") else {"rejected": 1})
    assert _stored(cbs_clean) == []


@pytest.mark.parametrize("value", ["-", "n/a", True, 99, 1_000_000, None, float("nan"), 10**400])
def test_ac2_bad_cell_skipped_alone(value: object) -> None:
    rows = _layout()
    assert rows[20][0] == "Tel Aviv - 5000"
    huge = value == 10**400  # openpyxl cannot write it: a placeholder, swapped in the sheet XML
    rows[21][3] = 987654 if huge else value  # Tel Aviv 5000, 1-2, IV-VI 2026
    rows[21][2] = "x"  # its I-III error: text, so NULL
    content = _xlsx(rows)
    if huge:
        content = _swap_sheet_xml(content, b"<v>987654</v>", b"<v>1" + b"0" * 400 + b"</v>")
    table = parse_table(content, today=TODAY)
    keys = {(r.geo_kind, r.geo_code, r.room_group, r.period): r for r in table.rows}
    assert len(table.rows) == 11
    assert ("city", 5000, "1-2", dt.date(2026, 6, 1)) not in keys
    kept = keys[("city", 5000, "1-2", dt.date(2026, 3, 1))]
    assert (kept.price_ils, kept.sampling_error) == (Decimal("5500.0"), None)


@pytest.mark.parametrize("trailing_year", [None, "2026"])
def test_ac2_october_layout(trailing_year: str | None) -> None:
    # Amended in review: a first "Annual average" column anchors the next I-III to the year after.
    table = parse_table(_xlsx(_october(trailing_year)), today=TODAY)
    assert len(table.rows) == 12
    assert sorted({r.period for r in table.rows}) == [dt.date(2026, 3, 1), dt.date(2026, 6, 1)]
    keys = {(r.geo_kind, r.geo_code, r.room_group, r.period): r for r in table.rows}
    assert keys[("city", 5000, "1-2", dt.date(2026, 3, 1))].price_ils == Decimal("5500.0")


def _row(period: dt.date, price: str, code: int = 5000) -> CbsRow:
    return CbsRow("city", code, "1-2", period, Decimal(price), None)


def test_ac3_upsert_by_bulletin(cbs_clean: Engine, db: Session) -> None:
    july, april, october = dt.date(2026, 7, 1), dt.date(2026, 4, 1), dt.date(2026, 10, 1)
    q1, q2, q4_2025 = dt.date(2026, 3, 1), dt.date(2026, 6, 1), dt.date(2025, 12, 1)
    assert store(db, CbsTable(july, [_row(q1, "5400.0"), _row(q2, "5486.7")])) == {"written": 2}
    db.commit()

    # An older bulletin: the shared period keeps July's value and bulletin, the absent one is added.
    assert store(db, CbsTable(april, [_row(q1, "5351.0"), _row(q4_2025, "5300.0")])) == {
        "written": 1
    }
    db.commit()
    by_period = {row.period: row for row in _stored(cbs_clean)}
    assert (by_period[q1].price_ils, by_period[q1].bulletin) == (Decimal("5400.0"), july)
    assert (by_period[q4_2025].price_ils, by_period[q4_2025].bulletin) == (
        Decimal("5300.0"),
        april,
    )

    # A newer bulletin with a revised value overwrites.
    revised = CbsTable(october, [_row(q2, "5500.5")])
    assert store(db, revised) == {"written": 1}
    db.commit()
    by_period = {row.period: row for row in _stored(cbs_clean)}
    assert (by_period[q2].price_ils, by_period[q2].bulletin) == (Decimal("5500.5"), october)

    # The same table twice writes the same rows.
    before = _stored(cbs_clean)
    assert store(db, revised) == {"written": 1}
    db.commit()
    assert _stored(cbs_clean) == before


def _settings(monkeypatch: pytest.MonkeyPatch, value: str) -> None:
    settings = get_settings()
    monkeypatch.setattr(
        cbs_rent, "get_settings", lambda: settings.model_copy(update={"cbs_rent": value})
    )


def _mock_client(
    monkeypatch: pytest.MonkeyPatch, answer: Callable[[httpx.Request], httpx.Response]
) -> list[httpx.Request]:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return answer(request)

    monkeypatch.setattr(
        httpx, "Client", functools.partial(httpx.Client, transport=httpx.MockTransport(handler))
    )
    return seen


@pytest.mark.asyncio
async def test_ac4_job_fetch(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    cbs_clean: Engine,
    db: Session,
    no_sleep: list[float],
) -> None:
    # Off: no client, no request, from the worker job and from both script forms.
    def no_client() -> httpx.Client:
        raise AssertionError("a client was built with CBS_RENT=off")

    original_client = cbs_rent.get_cbs_client
    _settings(monkeypatch, "off")
    monkeypatch.setattr(cbs_rent, "get_cbs_client", no_client)
    httpx_logger = logging.getLogger("httpx")
    level = httpx_logger.level
    try:
        from app import worker  # sets the httpx logger to WARNING (test_worker.py)

        assert await worker.import_cbs_rent_job({}) == {"skipped": 1}
    finally:
        httpx_logger.setLevel(level)
    from scripts import import_cbs_rent as script

    script.main([])
    script.main(["--history"])
    assert capsys.readouterr().out == "cbs-rent-import: {'skipped': 1}\n" * 2
    monkeypatch.setattr(cbs_rent, "get_cbs_client", original_client)

    # August answers the 2,056-byte page, July the real file: stored, two requests.
    august = bulletin_url(2026, 8)
    july = bulletin_url(2026, 7)
    seen = _mock_client(
        monkeypatch,
        lambda r: httpx.Response(200, content=REAL if str(r.url) == july else HTML_PAGE),
    )
    client = get_cbs_client()
    assert client.follow_redirects is False
    assert client.timeout == httpx.Timeout(30.0)
    assert client.headers["User-Agent"] == "homie-rent-reference"
    assert client.headers["Accept-Encoding"] == "identity"
    with client:
        assert import_cbs_rent(db, client, today=dt.date(2026, 8, 20)) == {"written": 322}
    assert [str(r.url) for r in seen] == [august, july]
    assert no_sleep == [REQUEST_INTERVAL_S]
    assert len(_stored(cbs_clean)) == 322

    # A 302 to the file is a bad answer, never followed.
    seen.clear()
    _mock_client(monkeypatch, lambda r: httpx.Response(302, headers={"Location": july}))
    with get_cbs_client() as client:
        assert import_cbs_rent(db, client, today=dt.date(2026, 8, 20)) == {"skipped": 1}

    # All six months bad: skipped, no error, six requests.
    answers = iter(
        [
            httpx.Response(404),
            httpx.Response(302, headers={"Location": july}),
            httpx.Response(200, content=HTML_PAGE),
            httpx.Response(200, content=b"\x1f\x8b", headers={"Content-Encoding": "gzip"}),
            httpx.Response(200, content=b"PK\x03\x04" + b"\0" * cbs_rent.MAX_BODY_BYTES),
            None,
        ]
    )

    def bad(request: httpx.Request) -> httpx.Response:
        answer = next(answers)
        if answer is None:
            raise httpx.ConnectTimeout("timed out", request=request)
        return answer

    seen = _mock_client(monkeypatch, bad)
    with get_cbs_client() as client:
        assert import_cbs_rent(db, client, today=dt.date(2026, 8, 20)) == {"skipped": 1}
    assert len(seen) == 6
    assert [str(r.url) for r in seen][-1] == bulletin_url(2026, 3)

    # A file that fails a rule (its bulletin 7/2026 is after June): rejected.
    _mock_client(monkeypatch, lambda _: httpx.Response(200, content=REAL))
    with get_cbs_client() as client:
        assert import_cbs_rent(db, client, today=dt.date(2026, 6, 20)) == {"rejected": 1}

    # `cbs` through the entry point: the client is built and closed; history is five requests,
    # oldest first.
    _settings(monkeypatch, "cbs")
    seen = _mock_client(monkeypatch, lambda _: httpx.Response(404))
    assert cbs_rent.run_cbs_import(history=True) == {"skipped": 5}
    assert [str(r.url) for r in seen] == [
        bulletin_url(2025, 7),
        bulletin_url(2025, 10),
        bulletin_url(2026, 1),
        bulletin_url(2026, 4),
        bulletin_url(2026, 7),
    ]
