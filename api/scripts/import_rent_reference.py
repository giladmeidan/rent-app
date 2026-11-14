"""Import the official rent figures once (spec 0014a), as the worker does every month.

Usage: `make rent-import` (reads the settings from the environment). With `RENT_REFERENCE=off`, the
default, it makes no request and prints `{'skipped': 1}`.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main() -> None:
    from app.services.rent_reference import run_rent_import

    print(f"rent-import: {run_rent_import()}")


if __name__ == "__main__":
    main()
