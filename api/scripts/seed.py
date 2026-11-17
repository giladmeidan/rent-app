"""Seed the areas: every settlement of `api/data/settlements.csv` and the neighbourhoods the rent
fixtures list (`import_areas` with `FixtureFetcher`, spec 0021a1; no network). Idempotent; safe to
run on every `make dev`.

Usage: `python api/scripts/seed.py` (reads DATABASE_URL from the environment).
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import Engine  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.db import make_engine  # noqa: E402
from app.services.areas import import_areas  # noqa: E402
from app.services.rent_reference import RentSourceError  # noqa: E402

FIXTURES = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "rent_reference"


class FixtureFetcher:
    """Serves `api/tests/fixtures/rent_reference/` (`settlement/rent/5000.json` is
    `settlement_5000.json`); a missing file answers like a 404."""

    def fetch(self, path: str) -> object:
        kind, _rent, name = path.split("/")
        file = FIXTURES / f"{kind}_{name}"
        if not file.is_file():
            raise RentSourceError("status 404")
        return json.loads(file.read_text(encoding="utf-8"))


def seed_areas(engine: Engine) -> dict[str, int]:
    """Import the areas through the fixture fetcher; returns `import_areas`' counts."""
    with Session(engine) as db:
        return import_areas(db, FixtureFetcher())


def main() -> None:
    from app.config import get_database_settings

    engine = make_engine(get_database_settings().database_url.get_secret_value())
    try:
        counts = seed_areas(engine)
    finally:
        engine.dispose()
    print(f"seed: {counts}")


if __name__ == "__main__":
    main()
