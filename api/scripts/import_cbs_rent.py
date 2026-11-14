"""Import the CBS small-flat rent table once (spec 0014d), as the worker does every month.

Usage: `make cbs-rent-import` (the latest bulletin) or `make cbs-rent-history` (`--history`: the
five xlsx bulletins, oldest first). With `CBS_RENT=off`, the default, it makes no request and
prints `{'skipped': 1}`.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main(argv: list[str] | None = None) -> None:
    from app.services.cbs_rent import run_cbs_import

    parser = argparse.ArgumentParser()
    parser.add_argument("--history", action="store_true")
    args = parser.parse_args(argv)
    print(f"cbs-rent-import: {run_cbs_import(history=args.history)}")


if __name__ == "__main__":
    main()
