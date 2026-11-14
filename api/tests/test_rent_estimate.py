"""The rent estimate baseline (spec 0014c): resolution, baseline, confidence, the order of reasons
and the backtest. Every test runs with the five constants patched to the spec's defaults, so the
backtest run can change the module values without breaking these."""

import datetime as dt
import uuid
from collections.abc import Iterator
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy import Engine, event, text
from sqlalchemy.orm import Session

from app.db import get_sessionmaker
from app.services import rent_estimate
from app.services.rent_estimate import Figure, backtest, estimate_rent, resolve_city
from scripts import rent_backtest

# Six quarters, newest last; the default window (4) is the last four.
QUARTERS = [
    dt.date(2025, 3, 1),
    dt.date(2025, 6, 1),
    dt.date(2025, 9, 1),
    dt.date(2025, 12, 1),
    dt.date(2026, 3, 1),
    dt.date(2026, 6, 1),
]
TEL_AVIV = "תל אביב -יפו"  # the source's spelling
HOOD_A = "הצפון הישן"
HOOD_B = "לב העיר"
# rooms → the first quarter's figure; each later quarter adds 100.
CITY_BASE = {3: 5000, 4: 6600, 5: 8200}
HOOD_A_BASE = {3: 4000, 4: 6000, 5: 7600}
SETTLEMENTS = {
    5000: TEL_AVIV,
    6400: "הרצליה",
    7900: "פתח תקווה",
    8300: "ראשון לציון",
    2620: "קריית אונו",
    9400: "יהוד-מונוסון",
    229: "גני תקווה",
    8600: "רמת גן",
}


def _last4_mean(base: int) -> int:
    """The mean of the last four of six figures base, base+100, ..., base+500."""
    return base + 350


@pytest.fixture(autouse=True)
def default_constants(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(rent_estimate, "WINDOW_QUARTERS", 4)
    monkeypatch.setattr(rent_estimate, "MIN_QUARTERS", 2)
    monkeypatch.setattr(rent_estimate, "HALF_WIDTH", {"neighbourhood": 0.08, "city": 0.15})
    monkeypatch.setattr(rent_estimate, "MAX_HALF_WIDTH", 0.20)
    monkeypatch.setattr(rent_estimate, "HIGH_MAX_HALF_WIDTH", 0.10)


@pytest.fixture
def rent_clean(migrated_db: Engine) -> Engine:
    with migrated_db.begin() as conn:
        conn.execute(text("TRUNCATE rent_prices, rent_areas"))
    return migrated_db


def _area(conn: Any, kind: str, source_id: int, code: int, name: str, streets: list[str]) -> Any:
    return conn.execute(
        text(
            "INSERT INTO rent_areas (kind, source_id, settlement_code, name_he, centre, streets,"
            " source_version) VALUES (:kind, :source, :code, :name,"
            " ST_SetSRID(ST_MakePoint(34.78, 32.08), 4326), :streets, '20-08-2026') RETURNING id"
        ),
        {"kind": kind, "source": source_id, "code": code, "name": name, "streets": streets},
    ).scalar_one()


def _price(conn: Any, area_id: uuid.UUID, rooms: int, period: dt.date, price: int) -> None:
    conn.execute(
        text("INSERT INTO rent_prices (area_id, rooms, period, price_ils) VALUES (:a, :r, :p, :v)"),
        {"a": area_id, "r": rooms, "p": period, "v": price},
    )


@pytest.fixture
def rent_figures(rent_clean: Engine) -> Engine:
    """Settlement rows for the eight alias codes, figures on 5000 only: the city and
    neighbourhood A (rooms 3-5, six quarters), neighbourhood B one 4-room figure (thin)."""
    with rent_clean.begin() as conn:
        ids = {
            code: _area(conn, "settlement", code, code, name, [])
            for code, name in SETTLEMENTS.items()
        }
        hood_a = _area(
            conn, "neighbourhood", 101, 5000, HOOD_A, ["תירוש", "דיזנגוף", "רחוב הירקון"]
        )
        hood_b = _area(conn, "neighbourhood", 102, 5000, HOOD_B, ["דיזנגוף", "בלפור"])
        for i, period in enumerate(QUARTERS):
            for rooms in (3, 4, 5):
                _price(conn, ids[5000], rooms, period, CITY_BASE[rooms] + 100 * i)
                _price(conn, hood_a, rooms, period, HOOD_A_BASE[rooms] + 100 * i)
        _price(conn, hood_b, 4, QUARTERS[-1], 9000)
    return rent_clean


@pytest.fixture
def db(rent_clean: Engine) -> Iterator[Session]:
    with get_sessionmaker()() as session:
        yield session


@pytest.fixture
def statements(migrated_db: Engine) -> Iterator[list[str]]:
    seen: list[str] = []

    def record(_conn: Any, _cursor: Any, statement: str, *_: Any) -> None:
        seen.append(statement)

    event.listen(migrated_db, "before_cursor_execute", record)
    yield seen
    event.remove(migrated_db, "before_cursor_execute", record)


def test_ac1_neighbourhood_baseline(
    rent_figures: Engine, db: Session, statements: list[str]
) -> None:
    statements.clear()
    out = estimate_rent(db, city="תל-אביב", street="רחוב תירוש", rooms=Decimal(4))
    assert 0 < len(statements) <= 4  # NF1 (and the listener sees this engine)
    assert out.reason is None and out.estimate is not None
    est = out.estimate
    assert (est.level, est.area_name, est.figure_rooms) == ("neighbourhood", HOOD_A, [4])
    baseline = _last4_mean(HOOD_A_BASE[4])  # 6350
    assert baseline == 6350
    # 6350 × 0.92 = 5842 → down to 5800; 6350 × 1.08 = 6858 → up to 6900.
    assert (est.low_ils, est.high_ils) == (5800, 6900)
    assert est.confidence == "high"
    assert est.quarters == 4
    assert est.latest_period == QUARTERS[-1]


@pytest.mark.parametrize("street", ["הרצל", "דיזנגוף"], ids=["unplaced", "in_two"])
def test_ac2_street_unplaced_uses_city(rent_figures: Engine, db: Session, street: str) -> None:
    out = estimate_rent(db, city="תל אביב", street=street, rooms=Decimal(4))
    assert out.estimate is not None
    assert (out.estimate.level, out.estimate.area_name) == ("city", TEL_AVIV)
    baseline = _last4_mean(CITY_BASE[4])  # 6950: × 0.85 = 5907.5, × 1.15 = 7992.5
    assert baseline == 6950
    assert (out.estimate.low_ils, out.estimate.high_ils) == (5900, 8000)
    assert out.estimate.confidence == "medium"


def test_ac3_thin_figures_fall_back(
    rent_figures: Engine, db: Session, statements: list[str]
) -> None:
    statements.clear()
    out = estimate_rent(db, city="תל אביב", street="בלפור", rooms=Decimal(4))
    assert 0 < len(statements) <= 4  # NF1 (and the listener sees this engine)
    assert out.estimate is not None
    assert (out.estimate.level, out.estimate.area_name) == ("city", TEL_AVIV)

    out = estimate_rent(db, city="הרצליה", street="סוקולוב", rooms=Decimal(4))
    assert (out.estimate, out.reason) == (None, "no_figures")


@pytest.mark.parametrize(
    ("city", "code"),
    [
        ("תל אביב", 5000),
        ('ת"א', 5000),
        ("יפו", 5000),
        ("תל אביב-יפו", 5000),
        ("הרצליה", 6400),
        ("פתח תקוה", 7900),
        ("פ״ת", 7900),
        ("ראשל״צ", 8300),
        ("ראשון", 8300),
        ("קרית אונו", 2620),
        ("יהוד", 9400),
        ("מונוסון", 9400),
        ("גני תקוה", 229),
        ("ר'ג", 8600),
        ("רמת גן", 8600),
    ],
)
def test_ac4_city_resolution(rent_figures: Engine, db: Session, city: str, code: int) -> None:
    row = resolve_city(db, city)
    assert row is not None and row.settlement_code == code


def test_ac4_city_resolution_unknown_and_order(rent_figures: Engine, db: Session) -> None:
    assert estimate_rent(db, city="חיפה", street="הרצל", rooms=Decimal(4)).reason == "unknown_city"
    out = estimate_rent(db, city="חיפה", street="הרצל", rooms=Decimal(2))
    assert out.reason == "rooms_not_covered"


@pytest.mark.parametrize(
    ("rooms", "keys", "baseline", "confidence"),
    [
        ("1", None, None, None),
        ("2", None, None, None),
        ("2.5", [3], _last4_mean(HOOD_A_BASE[3]), "medium"),
        ("3.5", [3, 4], (_last4_mean(HOOD_A_BASE[3]) + _last4_mean(HOOD_A_BASE[4])) / 2, "medium"),
        ("6", [5], _last4_mean(HOOD_A_BASE[5]), "medium"),
        ("4", [4], _last4_mean(HOOD_A_BASE[4]), "high"),
    ],
)
def test_ac5_rooms_to_keys(
    rent_figures: Engine,
    db: Session,
    rooms: str,
    keys: list[int] | None,
    baseline: float | None,
    confidence: str | None,
) -> None:
    out = estimate_rent(db, city="תל אביב", street="תירוש", rooms=Decimal(rooms))
    if keys is None:
        assert (out.estimate, out.reason) == (None, "rooms_not_covered")
        return
    assert baseline is not None and out.estimate is not None
    assert out.estimate.figure_rooms == keys
    assert out.estimate.level == "neighbourhood"
    assert out.estimate.confidence == confidence
    assert out.estimate.low_ils <= baseline * 0.92 < out.estimate.low_ils + 50
    assert out.estimate.high_ils - 50 < baseline * 1.08 <= out.estimate.high_ils


def test_ac6_too_wide_gives_no_number(
    rent_figures: Engine, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(rent_estimate, "HALF_WIDTH", {"neighbourhood": 0.08, "city": 0.25})
    out = estimate_rent(db, city="תל אביב", street="הרצל", rooms=Decimal(4))
    assert (out.estimate, out.reason) == (None, "too_uncertain")
    # The neighbourhood level is still within the limit.
    assert estimate_rent(db, city="תל אביב", street="תירוש", rooms=Decimal(4)).estimate


def test_ac7_empty_tables(rent_clean: Engine, db: Session) -> None:
    out = estimate_rent(db, city="תל אביב", street="תירוש", rooms=Decimal(4))
    assert (out.estimate, out.reason) == (None, "no_figures")


def _quarter(i: int) -> dt.date:
    return rent_estimate.quarters_back(dt.date(2026, 6, 1), -i)


def test_ac9_backtest_known_errors() -> None:
    hood, city = uuid.uuid4(), uuid.uuid4()
    # Three quarters: the neighbourhood constant at 5000, its city at 6000 (error exactly 0.2).
    figures = [Figure("neighbourhood", hood, 1, 4, _quarter(i), 5000) for i in range(3)]
    figures += [Figure("settlement", city, 1, 4, _quarter(i), 6000) for i in range(3)]
    rows = backtest(figures, windows=(1, 2), targets=3)
    # Window 1: targets q1 and q2 (q0 has no prior quarter); window 2 needs two: only q2.
    assert [(r.window, r.level, r.n) for r in rows] == [
        (1, "neighbourhood", 2),
        (1, "city", 2),
        (2, "neighbourhood", 1),
        (2, "city", 1),
    ]
    for r in rows:
        expected = 0.0 if r.level == "neighbourhood" else 0.2
        assert r.median == pytest.approx(expected) and r.p80 == pytest.approx(expected)

    # Too few prior quarters for the window: no sample, no row.
    assert backtest(figures[:2], windows=(2,), targets=1) == []

    # p80 is nearest rank: errors 1..5 % → sorted[ceil(4) - 1] = 4 %, median 3 %.
    spread = []
    for prior in (1010, 1020, 1030, 1040, 1050):
        area = uuid.uuid4()
        spread += [Figure("neighbourhood", area, 2, 3, _quarter(i), prior) for i in range(2)]
        spread.append(Figure("neighbourhood", area, 2, 3, _quarter(2), 1000))
    (row,) = backtest(spread, windows=(2,), targets=1)
    assert (row.level, row.n) == ("neighbourhood", 5)
    assert row.median == pytest.approx(0.03)
    assert row.p80 == pytest.approx(0.04)


def test_ac10_backtest_script_empty(rent_clean: Engine, capsys: pytest.CaptureFixture[str]) -> None:
    rent_backtest.main()
    assert capsys.readouterr().out.strip() == "no figures"
