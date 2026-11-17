"""The rent price estimate, step 1: the baseline (spec 0014c), and small flats (spec 0014d).

An apartment's facts (city, street, rooms; never a listing id) → the official average rent for its
room count in its neighbourhood, or in its city when the street does not place it in exactly one
neighbourhood, as a range with a confidence level. Reads `rent_areas` / `rent_prices` (spec 0014a)
in at most four queries. `backtest` sets `WINDOW_QUARTERS` and `HALF_WIDTH` from the official
history, with the same window and mean code as the estimate.

A 1, 1.5 or 2 room apartment gets the 3-room baseline × the CBS ratio of 1-2 to 2.5-3 room rent
(`cbs_rent_prices`, its city's or its district's) in one more query; `backtest_ratio` sets
`RATIO_WINDOW_QUARTERS` and `RATIO_HALF_WIDTH`.
"""

import datetime as dt
import math
import statistics
import unicodedata
import uuid
from collections import defaultdict
from collections.abc import Iterable, Sequence
from decimal import Decimal
from fractions import Fraction
from typing import Literal, NamedTuple, cast

from sqlalchemy import ColumnElement, Row, func, select, tuple_
from sqlalchemy.orm import Session

from app.models import Area, CbsRentPrice, RentArea, RentPrice
from app.schemas.rent_estimate import RentEstimateOut, RentEstimateRange, RentEstimateReason
from app.services.areas import settlement_districts

Level = Literal["neighbourhood", "city"]
RatioLevel = Literal["city", "district"]

# backtest (make rent-backtest, 2026-11-14, source version 20-08-2026): quarters averaged, ending
# at the newest period; window 3 had the smallest neighbourhood p80 (7.65 %)
WINDOW_QUARTERS = 3
MIN_QUARTERS = min(2, WINDOW_QUARTERS)  # policy, spec 0014c: figures needed inside the window
# backtest (same run): range = baseline × (1 ± half width), window 3's p80 rounded up
# (neighbourhood 7.65 %, city 17.78 %)
HALF_WIDTH: dict[Level, float] = {"neighbourhood": 0.08, "city": 0.18}
MAX_HALF_WIDTH = 0.20  # policy, spec 0014c: a level wider than this gives no number
HIGH_MAX_HALF_WIDTH = 0.10  # policy, spec 0014c: at most this, and not capped, is "high"

SMALL_ROOMS = {Decimal("1"), Decimal("1.5"), Decimal("2")}  # policy (Gilad 2026-11-14)
# backtest (make rent-backtest, 2026-11-14, CBS bulletins 7/2025, 1/2026, 4/2026, 7/2026; 10/2025
# rejected): newest CBS quarters averaged per geography; window 1 had the smallest city p80 (1.25 %)
RATIO_WINDOW_QUARTERS = 1
RATIO_MIN_QUARTERS = min(2, RATIO_WINDOW_QUARTERS)  # policy, spec 0014d
# backtest (same run): ratio p80 error at window 1, rounded up (city 1.25 %: a city's own ratio;
# district 6.27 %: a launch-box city's ratio predicted from its district's)
RATIO_HALF_WIDTH: dict[RatioLevel, float] = {"city": 0.02, "district": 0.07}
# Normalised alias → settlement code (the source's own names match without an alias).
CITY_ALIASES: dict[str, int] = {
    "תל אביב": 5000,
    "תא": 5000,
    "יפו": 5000,
    "הרצליה": 6400,
    "פתח תקוה": 7900,
    "פת": 7900,
    "ראשלצ": 8300,
    "ראשון": 8300,
    "קרית אונו": 2620,
    "יהוד": 9400,
    "מונוסון": 9400,
    "גני תקוה": 229,
    "רג": 8600,
    "בש": 9000,  # spec 0021c
    "י ם": 3000,
    "ים": 3000,
    "כס": 6900,
    "בב": 6100,
}
_STREET_PREFIXES = ("רחוב ", "רח ")
_PLACE_CHARS = str.maketrans({c: None for c in "\"'`׳״"} | {c: " " for c in "-–־"})


def normalise_place(text: str) -> str:
    """NFC; quotes and geresh/gershayim removed; hyphen, en dash and maqaf as a space; whitespace
    collapsed and stripped. Applied to both sides of every place comparison."""
    return " ".join(unicodedata.normalize("NFC", text).translate(_PLACE_CHARS).split())


def street_forms(street: str) -> set[str]:
    """`normalise_place(street)`, and the same without a leading `רחוב ` / `רח `: the forms a
    street is looked up by in a neighbourhood's street list."""
    form = normalise_place(street)
    forms = {form}
    for prefix in _STREET_PREFIXES:
        if form.startswith(prefix):
            forms.add(form.removeprefix(prefix))
            break
    return forms


def figure_keys(rooms: Decimal) -> list[int] | None:
    """The room counts whose figures stand for `rooms`; None below 2.5 (no figures yet)."""
    if rooms < Decimal("2.5"):
        return None
    if rooms == Decimal("2.5"):
        return [3]
    if rooms >= Decimal("5.5"):
        return [5]
    low = int(rooms)
    return [low] if rooms == low else [low, low + 1]


def quarters_back(period: dt.date, quarters: int) -> dt.date:
    """The quarter period `quarters` quarters before `period` (first day of its last month)."""
    months = period.year * 12 + period.month - 1 - 3 * quarters
    return dt.date(months // 12, months % 12 + 1, 1)


def window(end: dt.date, quarters: int) -> tuple[dt.date, dt.date]:
    """`end` and the `quarters - 1` quarters before it, as an inclusive (first, last) range."""
    return quarters_back(end, quarters - 1), end


def mean_if_enough(prices: Sequence[int | Fraction], minimum: int) -> Fraction | None:
    """The exact mean of `prices` (or ratios), or None with fewer than `minimum` of them."""
    if not prices or len(prices) < minimum:
        return None
    return Fraction(sum(prices), len(prices))


def resolve_city(db: Session, city: str) -> Row[tuple[uuid.UUID, int, str, str | None]] | None:
    """The settlement row (id, settlement_code, name_he, catalogue name) for the owner's city text,
    first hit wins (spec 0021c): an active catalogue settlement named exactly the stripped text;
    the row's own name; its catalogue name; `CITY_ALIASES`. None when nothing matches or the code
    has no settlement row. One query: an exact catalogue hit narrows it to that code's row."""
    stripped = city.strip()
    exact = (
        select(Area.source_code)
        .where(Area.kind == "settlement", Area.is_active.is_(True), Area.name_he == stripped)
        .limit(1)
        .correlate(None)  # the outer join's `areas` is a different row
        .scalar_subquery()
    )
    rows = db.execute(
        select(
            RentArea.id,
            RentArea.settlement_code,
            RentArea.name_he,
            cast("ColumnElement[str | None]", Area.name_he).label("catalogue_name"),  # outer join
        )
        .outerjoin(
            Area,
            (Area.kind == "settlement")
            & Area.is_active.is_(True)
            & (Area.source_code == RentArea.settlement_code),
        )
        .where(
            RentArea.kind == "settlement",
            exact.is_(None) | (RentArea.settlement_code == exact),
        )
    ).all()
    wanted = normalise_place(city)
    for row in rows:
        if row.catalogue_name == stripped:
            return row
    for row in rows:
        if normalise_place(row.name_he) == wanted:
            return row
    for row in rows:
        if row.catalogue_name is not None and normalise_place(row.catalogue_name) == wanted:
            return row
    code = CITY_ALIASES.get(wanted)
    return next((row for row in rows if row.settlement_code == code), None)


def _neighbourhood(
    db: Session, settlement_code: int, street: str
) -> Row[tuple[uuid.UUID, str, list[str]]] | None:
    """The one neighbourhood of the settlement whose street list holds the street, else None
    (unplaced, or in several: city level)."""
    forms = street_forms(street)
    rows = db.execute(
        select(RentArea.id, RentArea.name_he, RentArea.streets).where(
            RentArea.kind == "neighbourhood", RentArea.settlement_code == settlement_code
        )
    ).all()
    candidates = [r for r in rows if forms & {normalise_place(s) for s in r.streets}]
    return candidates[0] if len(candidates) == 1 else None


def _no(reason: RentEstimateReason) -> RentEstimateOut:
    return RentEstimateOut(estimate=None, reason=reason)


def ratios[G](
    prices: Iterable[tuple[G, str, dt.date, Decimal]],
) -> dict[G, dict[dt.date, Fraction]]:
    """(geography, room group, period, price) → per geography, per period holding both groups,
    the exact ratio price(1-2) / price(2.5-3)."""
    groups: dict[tuple[G, dt.date], dict[str, Decimal]] = defaultdict(dict)
    for geo, group, period, price in prices:
        groups[(geo, period)][group] = price
    out: dict[G, dict[dt.date, Fraction]] = defaultdict(dict)
    for (geo, period), by_group in groups.items():
        if "1-2" in by_group and "2.5-3" in by_group:
            out[geo][period] = Fraction(by_group["1-2"]) / Fraction(by_group["2.5-3"])
    return out


def _small_flat_ratio(db: Session, settlement_code: int) -> tuple[RatioLevel, Fraction] | None:
    """Step 5b: the mean CBS ratio over the CBS window, the city's when it has enough periods,
    else its district's; None when neither has. One query."""
    geos: list[tuple[RatioLevel, int]] = [("city", settlement_code)]
    district = settlement_districts().get(settlement_code)
    if district is not None:
        geos.append(("district", district))
    newest = select(func.max(CbsRentPrice.period)).scalar_subquery()
    rows = db.execute(
        select(
            CbsRentPrice.geo_kind,
            CbsRentPrice.geo_code,
            CbsRentPrice.room_group,
            CbsRentPrice.period,
            CbsRentPrice.price_ils,
            newest,
        ).where(tuple_(CbsRentPrice.geo_kind, CbsRentPrice.geo_code).in_(geos))
    ).all()
    if not rows:
        return None
    first, last = window(rows[0][5], RATIO_WINDOW_QUARTERS)
    by_geo = ratios(
        ((kind, code), group, period, price)
        for kind, code, group, period, price, _ in rows
        if first <= period <= last
    )
    for geo in geos:
        mean = mean_if_enough(list(by_geo.get(geo, {}).values()), RATIO_MIN_QUARTERS)
        if mean is not None:
            return geo[0], mean
    return None


def estimate_rent(db: Session, *, city: str, street: str, rooms: Decimal) -> RentEstimateOut:
    """Evaluation order: rooms → newest period → city → street → figures → small-flat ratio →
    width; the first that fails is the answer's `reason`."""
    small = rooms in SMALL_ROOMS
    keys = [3] if small else figure_keys(rooms)
    if keys is None:
        return _no("rooms_not_covered")
    latest = db.scalar(select(func.max(RentPrice.period)))
    if latest is None:
        return _no("no_figures")
    settlement = resolve_city(db, city)
    if settlement is None:
        return _no("unknown_city")
    hood = _neighbourhood(db, settlement.settlement_code, street)
    levels: list[tuple[Level, uuid.UUID, str]] = []
    if hood is not None:
        levels.append(("neighbourhood", hood.id, hood.name_he))
    levels.append(("city", settlement.id, settlement.name_he))

    first, last = window(latest, WINDOW_QUARTERS)
    prices: dict[tuple[uuid.UUID, int], list[int]] = defaultdict(list)
    for area_id, key, price in db.execute(
        select(RentPrice.area_id, RentPrice.rooms, RentPrice.price_ils).where(
            RentPrice.area_id.in_([area_id for _, area_id, _ in levels]),
            RentPrice.rooms.in_(keys),
            RentPrice.period.between(first, last),
        )
    ).tuples():
        prices[(area_id, key)].append(price)

    for level, area_id, area_name in levels:
        means = [mean_if_enough(prices[(area_id, key)], MIN_QUARTERS) for key in keys]
        if any(mean is None for mean in means):
            continue
        baseline = sum(m for m in means if m is not None) / len(means)
        half = HALF_WIDTH[level]
        small_flat_ratio: RatioLevel | None = None
        if small:
            ratio = _small_flat_ratio(db, settlement.settlement_code)
            if ratio is None:
                return _no("no_figures")
            small_flat_ratio, mean_ratio = ratio
            baseline *= mean_ratio
            half = math.hypot(half, RATIO_HALF_WIDTH[small_flat_ratio])
        if half > MAX_HALF_WIDTH:
            return _no("too_uncertain")
        exact_half = Fraction(str(half))
        capped = small or len(keys) != 1 or rooms != keys[0]
        estimate = RentEstimateRange(
            low_ils=math.floor(baseline * (1 - exact_half) / 50) * 50,
            high_ils=math.ceil(baseline * (1 + exact_half) / 50) * 50,
            confidence="high" if half <= HIGH_MAX_HALF_WIDTH and not capped else "medium",
            level=level,
            area_name=area_name,
            figure_rooms=[1, 2] if small else keys,
            small_flat_ratio=small_flat_ratio,
            quarters=min(len(prices[(area_id, key)]) for key in keys),
            latest_period=latest,
        )
        return RentEstimateOut(estimate=estimate, reason=None)
    return _no("no_figures")


class Figure(NamedTuple):
    kind: str  # "settlement" or "neighbourhood"
    area_id: uuid.UUID
    settlement_code: int
    rooms: int
    period: dt.date
    price_ils: int


class CbsFigure(NamedTuple):
    geo_kind: str  # "city" or "district"
    geo_code: int
    room_group: str  # "1-2" or "2.5-3"
    period: dt.date
    price_ils: Decimal


class BacktestRow(NamedTuple):
    window: int
    level: Literal["neighbourhood", "city", "district"]
    n: int
    median: float
    p80: float


def backtest(
    figures: Sequence[Figure], *, windows: Iterable[int] = range(1, 9), targets: int = 4
) -> list[BacktestRow]:
    """Predict every neighbourhood figure of the newest `targets` quarters from the `window`
    quarters strictly before it, at both levels; the relative errors per (window, level)."""
    series: dict[tuple[Level, object, int], list[tuple[dt.date, int]]] = defaultdict(list)
    for f in figures:
        if f.kind == "neighbourhood":
            series[("neighbourhood", f.area_id, f.rooms)].append((f.period, f.price_ils))
        else:
            series[("city", f.settlement_code, f.rooms)].append((f.period, f.price_ils))
    newest = sorted({f.period for f in figures}, reverse=True)[:targets]
    actuals = [f for f in figures if f.kind == "neighbourhood" and f.period in newest]

    rows: list[BacktestRow] = []
    for size in windows:
        errors: dict[Level, list[float]] = {"neighbourhood": [], "city": []}
        for f in actuals:
            first, last = window(quarters_back(f.period, 1), size)
            sources: dict[Level, object] = {
                "neighbourhood": f.area_id,
                "city": f.settlement_code,
            }
            for level, source in sources.items():
                prices = [p for d, p in series[(level, source, f.rooms)] if first <= d <= last]
                prediction = mean_if_enough(prices, min(2, size))
                if prediction is not None:
                    errors[level].append(float(abs(prediction - f.price_ils) / f.price_ils))
        rows += _summaries(size, errors)
    return rows


def _summaries(
    size: int, errors: dict[Level, list[float]] | dict[RatioLevel, list[float]]
) -> list[BacktestRow]:
    """One row per level with errors: n, median and the nearest-rank p80."""
    rows: list[BacktestRow] = []
    for level, errs in errors.items():
        if errs:
            ranked = sorted(errs)
            p80 = ranked[math.ceil(0.8 * len(ranked)) - 1]
            rows.append(BacktestRow(size, level, len(errs), statistics.median(errs), p80))
    return rows


def backtest_ratio(
    figures: Sequence[CbsFigure], *, windows: Iterable[int] = range(1, 7), targets: int = 4
) -> list[BacktestRow]:
    """Predict each CBS city's ratio (one with a district in `settlement_districts`) at its newest
    `targets` periods from the `window` quarters strictly before it: from the city's own ratios
    and from its district's; the relative errors per (window, level)."""
    by_geo = ratios(
        ((f.geo_kind, f.geo_code), f.room_group, f.period, f.price_ils) for f in figures
    )
    districts = settlement_districts()
    cities = [geo for geo in by_geo if geo[0] == "city" and geo[1] in districts]
    rows: list[BacktestRow] = []
    for size in windows:
        errors: dict[RatioLevel, list[float]] = {"city": [], "district": []}
        for city in cities:
            own = by_geo[city]
            sources: dict[RatioLevel, dict[dt.date, Fraction]] = {
                "city": own,
                "district": by_geo.get(("district", districts[city[1]]), {}),
            }
            for target in sorted(own, reverse=True)[:targets]:
                first, last = window(quarters_back(target, 1), size)
                for level, source in sources.items():
                    prior = [r for period, r in source.items() if first <= period <= last]
                    prediction = mean_if_enough(prior, min(2, size))
                    if prediction is not None:
                        errors[level].append(float(abs(prediction - own[target]) / own[target]))
        rows += _summaries(size, errors)
    return rows
