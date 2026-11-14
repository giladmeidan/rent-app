"""Backtest the rent estimate baseline on the official history (spec 0014c).

Usage: `make rent-backtest`. Reads every rooms 3/4/5 figure in `rent_prices`, prints one line per
(window, level), then the suggested `WINDOW_QUARTERS` and `HALF_WIDTH`. No figures: prints
`no figures` and exits 0.
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main() -> None:
    from sqlalchemy import func, select

    from app.db import get_sessionmaker
    from app.models import RentArea, RentPrice
    from app.services.rent_estimate import Figure, backtest

    with get_sessionmaker()() as db:
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
    for r in rows:
        print(
            f"window {r.window}  {r.level:<13}  n={r.n:<5}  median {r.median:.2%}  p80 {r.p80:.2%}"
        )
    hood = [r for r in rows if r.level == "neighbourhood"]
    if not hood:
        print("no neighbourhood sample: no suggestion")
        return
    best = min(hood, key=lambda r: (r.p80, r.window)).window
    # Whole percent, rounded up (round first so 0.07 stays 7, not 8 from float noise).
    widths = {r.level: math.ceil(round(r.p80 * 100, 9)) / 100 for r in rows if r.window == best}
    print(f"suggestion: WINDOW_QUARTERS = {best}; HALF_WIDTH = {widths}")


if __name__ == "__main__":
    main()
