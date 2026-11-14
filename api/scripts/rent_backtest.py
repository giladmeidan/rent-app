"""Backtest the rent estimate on the official history (specs 0014c and 0014d).

Usage: `make rent-backtest`. First the baseline: every rooms 3/4/5 figure in `rent_prices`, one
line per (window, level), then the suggested `WINDOW_QUARTERS` and `HALF_WIDTH` (`no figures` when
empty). Then the small-flat ratio: every row of `cbs_rent_prices`, one line per (window, level),
then the suggested `RATIO_WINDOW_QUARTERS` and `RATIO_HALF_WIDTH` (`no cbs figures` when empty).
Exits 0 either way.
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import func, select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.db import get_sessionmaker  # noqa: E402
from app.models import CbsRentPrice, RentArea, RentPrice  # noqa: E402
from app.services.rent_estimate import (  # noqa: E402
    BacktestRow,
    CbsFigure,
    Figure,
    backtest,
    backtest_ratio,
)


def _print_rows(rows: list[BacktestRow]) -> None:
    for r in rows:
        print(
            f"window {r.window}  {r.level:<13}  n={r.n:<5}  median {r.median:.2%}  p80 {r.p80:.2%}"
        )


def _widths(rows: list[BacktestRow], best: int) -> dict[str, float]:
    # Whole percent, rounded up (round first so 0.07 stays 7, not 8 from float noise).
    return {r.level: math.ceil(round(r.p80 * 100, 9)) / 100 for r in rows if r.window == best}


def _baseline(db: Session) -> None:
    figures = [
        Figure(*row)
        for row in db.execute(
            select(
                RentArea.kind,
                RentArea.id,
                RentArea.settlement_code,
                RentPrice.rooms,
                RentPrice.period,
                RentPrice.price_ils,
            )
            .join(RentArea, RentArea.id == RentPrice.area_id)
            .where(RentPrice.rooms.in_((3, 4, 5)))
        ).tuples()
    ]
    version = db.scalar(select(func.max(RentArea.source_version)))
    rows = backtest(figures)
    if not rows:
        print("no figures")
        return
    print(f"rent-backtest: {len(figures)} figures, source version {version}")
    _print_rows(rows)
    hood = [r for r in rows if r.level == "neighbourhood"]
    if not hood:
        print("no neighbourhood sample: no suggestion")
        return
    best = min(hood, key=lambda r: (r.p80, r.window)).window
    print(f"suggestion: WINDOW_QUARTERS = {best}; HALF_WIDTH = {_widths(rows, best)}")


def _ratio(db: Session) -> None:
    figures = [
        CbsFigure(*row)
        for row in db.execute(
            select(
                CbsRentPrice.geo_kind,
                CbsRentPrice.geo_code,
                CbsRentPrice.room_group,
                CbsRentPrice.period,
                CbsRentPrice.price_ils,
            )
        ).tuples()
    ]
    if not figures:
        print("no cbs figures")
        return
    bulletins = db.scalars(select(func.distinct(CbsRentPrice.bulletin))).all()
    print(
        f"ratio-backtest: {len(figures)} cbs figures, bulletins "
        + ", ".join(f"{b.month}/{b.year}" for b in sorted(bulletins))
    )
    rows = backtest_ratio(figures)
    _print_rows(rows)
    city = [r for r in rows if r.level == "city"]
    if not city:
        print("no city sample: no suggestion")
        return
    best = min(city, key=lambda r: (r.p80, r.window)).window
    print(f"suggestion: RATIO_WINDOW_QUARTERS = {best}; RATIO_HALF_WIDTH = {_widths(rows, best)}")


def main() -> None:
    with get_sessionmaker()() as db:
        _baseline(db)
        _ratio(db)


if __name__ == "__main__":
    main()
