"""Import the areas once (spec 0021a1): every settlement of `api/data/settlements.csv`. By hand,
once per environment after `make migrate`, and when the CBS file changes; never scheduled. Only
with `RENT_REFERENCE=nadlan`, which production never sets (spec 0013a), does it also read the big
cities' neighbourhoods from nadlan.gov.il; otherwise it makes no request.

Usage: `make import-areas` (reads the settings from the environment).
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main() -> None:
    from app.config import get_settings
    from app.db import get_sessionmaker
    from app.services.areas import import_areas
    from app.services.rent_reference import get_rent_fetcher

    if get_settings().rent_reference != "nadlan":
        with get_sessionmaker()() as db:
            print(f"import-areas: {import_areas(db, None)}")
        return
    fetcher = get_rent_fetcher()
    with fetcher.client, get_sessionmaker()() as db:
        print(f"import-areas: {import_areas(db, fetcher)}")


if __name__ == "__main__":
    main()
