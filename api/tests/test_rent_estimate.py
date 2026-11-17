"""The rent estimate baseline (spec 0014c): resolution, baseline, confidence, the order of reasons
and the backtest; small flats (spec 0014d): the CBS ratio, its fallbacks and its backtest; the
national districts, aliases and catalogue names (spec 0021c). Every
test runs with the constants patched to the specs' defaults, so the backtest runs can change the
module values without breaking these."""

import csv
import datetime as dt
import math
import uuid
from collections.abc import Iterator
from decimal import Decimal
from fractions import Fraction
from typing import Any

import pytest
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session

from app.db import get_sessionmaker
from app.services import rent_estimate
from app.services.areas import CSV_PATH, settlement_districts
from app.services.rent_estimate import (
    CbsFigure,
    Figure,
    backtest,
    backtest_ratio,
    estimate_rent,
    resolve_city,
)
from scripts import rent_backtest
from tests.conftest import (
    CITY_BASE,
    HOOD_A,
    HOOD_A_BASE,
    QUARTERS,
    TEL_AVIV,
    _rent_area,
    _rent_price,
    insert_cbs,
    insert_settlement,
)


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
    monkeypatch.setattr(rent_estimate, "RATIO_WINDOW_QUARTERS", 4)
    monkeypatch.setattr(rent_estimate, "RATIO_MIN_QUARTERS", 2)
    monkeypatch.setattr(rent_estimate, "RATIO_HALF_WIDTH", {"city": 0.03, "district": 0.03})


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
    assert out.reason == "unknown_city"  # spec 0014d: 2 rooms are covered now


@pytest.mark.parametrize(
    ("rooms", "keys", "baseline", "confidence"),
    [
        ("0.5", None, None, None),  # spec 0014d: below 1 only (the API rejects it)
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
    assert out.estimate.small_flat_ratio is None
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


@pytest.mark.usefixtures("cbs_clean")
def test_ac10_backtest_script_empty(rent_clean: Engine, capsys: pytest.CaptureFixture[str]) -> None:
    rent_backtest.main()
    assert capsys.readouterr().out.strip() == "no figures\nno cbs figures"


# Spec 0014d: small flats.
SMALL_BASELINE = _last4_mean(HOOD_A_BASE[3])  # 4350: the 3-room neighbourhood baseline


def _small_range(baseline: Fraction, half: float) -> tuple[int, int]:
    exact = Fraction(str(half))
    return (
        math.floor(baseline * (1 - exact) / 50) * 50,
        math.ceil(baseline * (1 + exact) / 50) * 50,
    )


@pytest.mark.parametrize("rooms", ["1", "1.5", "2"])
@pytest.mark.usefixtures("cbs_figures")
def test_ac5_small_flat_city_ratio(
    rent_figures: Engine, db: Session, statements: list[str], rooms: str
) -> None:
    statements.clear()
    out = estimate_rent(db, city="תל אביב", street="תירוש", rooms=Decimal(rooms))
    assert len(statements) == 5  # NF1: 0014c's four + the ratio
    assert out.reason is None and out.estimate is not None
    est = out.estimate
    assert (est.level, est.area_name, est.figure_rooms) == ("neighbourhood", HOOD_A, [1, 2])
    assert (est.small_flat_ratio, est.confidence) == ("city", "medium")
    baseline = Fraction(SMALL_BASELINE) * Fraction("0.8")  # 3480
    half = math.sqrt(0.08**2 + 0.03**2)
    assert half == pytest.approx(0.0854400374531753)
    # 3480 × 0.91456 = 3182.7 → down to 3150; 3480 × 1.08544 = 3777.3 → up to 3800.
    assert (est.low_ils, est.high_ils) == _small_range(baseline, half) == (3150, 3800)
    assert (est.quarters, est.latest_period) == (4, QUARTERS[-1])  # nadlan's


@pytest.mark.parametrize("case", ["district_only", "city_thin", "no_cbs", "unknown_city"])
def test_ac6_small_flat_fallbacks(
    rent_figures: Engine, cbs_clean: Engine, db: Session, statements: list[str], case: str
) -> None:
    if case in ("district_only", "city_thin"):
        insert_cbs(cbs_clean, "district", 5, Decimal("0.85"), QUARTERS[-4:])
    if case == "city_thin":
        insert_cbs(cbs_clean, "city", 5000, Decimal("0.8"), QUARTERS[-1:])
    city = "חיפה" if case == "unknown_city" else "תל אביב"
    statements.clear()
    out = estimate_rent(db, city=city, street="תירוש", rooms=Decimal(2))
    if case == "no_cbs":
        assert (out.estimate, out.reason) == (None, "no_figures")
        return
    if case == "unknown_city":
        assert (out.estimate, out.reason) == (None, "unknown_city")
        return
    assert len(statements) == 5  # NF1: 0014c's four + the ratio
    assert out.estimate is not None
    assert (out.estimate.small_flat_ratio, out.estimate.level) == ("district", "neighbourhood")
    baseline = Fraction(SMALL_BASELINE) * Fraction("0.85")  # 3697.5
    half = math.sqrt(0.08**2 + 0.03**2)
    assert (out.estimate.low_ils, out.estimate.high_ils) == _small_range(baseline, half)


# The deleted `SETTLEMENT_DISTRICT` (spec 0014d), inlined: the CSV must agree with it.
OLD_SETTLEMENT_DISTRICT = {
    **dict.fromkeys((5000, 8600, 6300, 6100, 6600, 6200, 6400, 2650, 2620, 2400, 565), 5),
    **dict.fromkeys((7900, 8300, 681, 9400, 229, 587, 9700, 466), 4),
}


def _settlement_figures(engine: Engine, code: int, name: str) -> None:
    """A settlement row with 3-room figures in every quarter (`CITY_BASE[3]` + 100 a quarter)."""
    with engine.begin() as conn:
        area_id = _rent_area(conn, "settlement", code, code, name, [])
        for i, period in enumerate(QUARTERS):
            _rent_price(conn, area_id, 3, period, CITY_BASE[3] + 100 * i)


def test_ac3_district_outside_gush_dan(rent_clean: Engine, cbs_clean: Engine, db: Session) -> None:
    _settlement_figures(rent_clean, 9100, "נהרייה")  # North District (2), not a CBS city
    insert_cbs(cbs_clean, "district", 2, Decimal("0.9"), QUARTERS[-4:])
    insert_cbs(cbs_clean, "district", 5, Decimal("0.7"), QUARTERS[-4:])  # not Nahariya's

    out = estimate_rent(db, city="נהרייה", street="הרצל", rooms=Decimal(2))

    assert out.estimate is not None
    assert (out.estimate.small_flat_ratio, out.estimate.level) == ("district", "city")
    baseline = Fraction(_last4_mean(CITY_BASE[3])) * Fraction("0.9")
    half = math.hypot(0.15, 0.03)
    assert (out.estimate.low_ils, out.estimate.high_ils) == _small_range(baseline, half)

    with CSV_PATH.open(encoding="utf-8") as file:
        rows = list(csv.DictReader(line for line in file if not line.startswith("#")))
    assert settlement_districts() == {
        int(row["code"]): int(row["district"]) for row in rows if row["district"]
    }
    assert len(settlement_districts()) > 1000
    assert {code: settlement_districts()[code] for code in OLD_SETTLEMENT_DISTRICT} == (
        OLD_SETTLEMENT_DISTRICT
    )


def test_ac8_small_flat_too_wide(
    rent_figures: Engine, cbs_clean: Engine, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    # sqrt(0.08² + 0.19²) = 0.206 > MAX_HALF_WIDTH for a district answer; the city's stays 0.085.
    monkeypatch.setattr(rent_estimate, "RATIO_HALF_WIDTH", {"city": 0.03, "district": 0.19})
    insert_cbs(cbs_clean, "district", 5, Decimal("0.85"), QUARTERS[-4:])
    out = estimate_rent(db, city="תל אביב", street="תירוש", rooms=Decimal(2))
    assert (out.estimate, out.reason) == (None, "too_uncertain")

    insert_cbs(cbs_clean, "city", 5000, Decimal("0.8"), QUARTERS[-4:])
    out = estimate_rent(db, city="תל אביב", street="תירוש", rooms=Decimal(2))
    assert out.estimate is not None and out.estimate.small_flat_ratio == "city"


def _ratio_figures(kind: str, code: int, ratios: list[str]) -> list[CbsFigure]:
    """CBS figures with the given ratio per quarter, `_quarter(0)` first."""
    figures = []
    for i, ratio in enumerate(ratios):
        figures.append(CbsFigure(kind, code, "2.5-3", _quarter(i), Decimal(1000)))
        figures.append(CbsFigure(kind, code, "1-2", _quarter(i), 1000 * Decimal(ratio)))
    return figures


def test_ac9_ratio_backtest(
    rent_clean: Engine, cbs_clean: Engine, capsys: pytest.CaptureFixture[str]
) -> None:
    # A city constant at 0.8, its district constant at 0.84: errors 0 and exactly 0.04 / 0.8.
    steady = _ratio_figures("city", 5000, ["0.8"] * 4) + _ratio_figures("district", 5, ["0.84"] * 4)
    rows = backtest_ratio(steady, windows=(1, 2), targets=2)
    assert [(r.window, r.level, r.n) for r in rows] == [
        (1, "city", 2),
        (1, "district", 2),
        (2, "city", 2),
        (2, "district", 2),
    ]
    for r in rows:
        assert r.median == r.p80 == (0.0 if r.level == "city" else 0.05)

    # A city stepping from 0.80 to 0.88 at the last target: its own error there is 0.08 / 0.88.
    step = _ratio_figures("city", 7900, ["0.80"] * 3 + ["0.88"])
    step += _ratio_figures("district", 4, ["0.80"] * 4)
    (city_row, district_row) = backtest_ratio(step, windows=(2,), targets=1)
    assert (city_row.level, city_row.n) == ("city", 1)
    assert city_row.p80 == float(Fraction(8, 88))
    assert district_row.p80 == float(Fraction(8, 88))

    # Too few prior periods for the window: no sample, no row; a city with no district in the
    # settlement list (spec 0021c) and a district alone are never targets.
    assert backtest_ratio(steady[:4], windows=(2,), targets=1) == []
    assert backtest_ratio(_ratio_figures("city", 99999, ["0.8"] * 4), windows=(1,)) == []

    # p80 is nearest rank: errors 1..5 % → sorted[ceil(4) - 1] = 4 %, median 3 %.
    spread: list[CbsFigure] = []
    for code, prior in zip(
        (5000, 8600, 6100, 6600, 6200), ("1.01", "1.02", "1.03", "1.04", "1.05"), strict=True
    ):
        spread += _ratio_figures("city", code, [prior, prior, "1"])
    (row,) = [r for r in backtest_ratio(spread, windows=(2,), targets=1) if r.level == "city"]
    assert row.n == 5
    assert row.median == pytest.approx(0.03)
    assert row.p80 == pytest.approx(0.04)

    # The script with CBS figures: constant ratios, so every window's city p80 is 0 → window 1.
    insert_cbs(cbs_clean, "city", 5000, Decimal("0.8"), QUARTERS)
    insert_cbs(cbs_clean, "district", 5, Decimal("0.85"), QUARTERS)
    rent_backtest.main()
    lines = capsys.readouterr().out.strip().splitlines()
    assert lines[0] == "no figures"
    assert lines[1] == "ratio-backtest: 24 cbs figures, bulletins 7/2026"
    assert lines[-1] == (
        "suggestion: RATIO_WINDOW_QUARTERS = 1; RATIO_HALF_WIDTH = {'city': 0.0, 'district': 0.07}"
    )


@pytest.mark.parametrize(
    ("city", "code"),
    [
        ("ב״ש", 9000),
        ("י-ם", 3000),
        ("י״ם", 3000),
        ("כ״ס", 6900),
        ("ב״ב", 6100),
        ("מודיעין-מכבים-רעות", 1200),  # the catalogue's name, exactly
        ("מודיעין מכבים רעות", 1200),  # the catalogue's name, normalised
    ],
)
def test_ac4_aliases(
    db_engine: Engine, rent_clean: Engine, db: Session, city: str, code: int
) -> None:
    with rent_clean.begin() as conn:
        for row_code, name in (
            (9000, "באר שבע"),
            (3000, "ירושלים"),
            (6900, "כפר סבא"),
            (6100, "בני ברק"),
            (1200, "מודיעין"),  # spelt differently from the catalogue
            (1201, "מודיעין עילית"),  # the inactive twin has figures too: still never matched
        ):
            _rent_area(conn, "settlement", row_code, row_code, name, [])
    insert_settlement(db_engine, 1200, "מודיעין-מכבים-רעות")
    insert_settlement(db_engine, 1201, "מודיעין מכבים רעות", active=False)

    row = resolve_city(db, city)

    assert row is not None and row.settlement_code == code


def test_ac4_catalogue_name_without_figures_is_unknown(
    db_engine: Engine, rent_clean: Engine, db: Session
) -> None:
    # Scope 7.3: an exact catalogue hit with no rent_areas row is unknown_city, no fall-through.
    with rent_clean.begin() as conn:
        _rent_area(conn, "settlement", 9000, 9000, "באר שבע", [])
    insert_settlement(db_engine, 9100, "נהריה")
    assert resolve_city(db, "נהריה") is None


def test_ac5_ratio_backtest_national() -> None:
    # Haifa (3) and Be'er Sheva (6) are CBS cities outside the old launch box.
    figures = _ratio_figures("city", 4000, ["0.8"] * 3)
    figures += _ratio_figures("city", 9000, ["0.9"] * 3)
    figures += _ratio_figures("district", 3, ["0.88"] * 3)
    figures += _ratio_figures("district", 6, ["0.9"] * 3)
    rows = backtest_ratio(figures, windows=(1,), targets=2)
    assert [(r.level, r.n) for r in rows] == [("city", 4), ("district", 4)]
    city, district = rows
    assert city.median == city.p80 == 0.0
    # Haifa's two targets err 0.08 / 0.8 = 0.1 each from district 3, Be'er Sheva's 0 from 6.
    assert district.median == pytest.approx(0.05)
    assert district.p80 == pytest.approx(0.1)
