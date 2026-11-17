"""Build `api/data/settlements.csv` from CBS's settlement list on data.gov.il (spec 0021a1).

Run by hand, once, when the CBS file changes; never by the app, CI or a deploy. The CSV is committed
and `make import-areas` reads it.

Usage: `uv --directory api run python scripts/build_settlements.py`
"""

import csv
import re
import sys
from pathlib import Path
from typing import Any

import httpx

RESOURCE_ID = "d47a54ff-87f0-44b3-b33a-f284c0c38e5a"  # "קובץ היישובים 2023" (bycode2023)
URL = "https://data.gov.il/api/3/action/datastore_search"
CSV_PATH = Path(__file__).resolve().parents[1] / "data" / "settlements.csv"
HEADER = (
    "# CBS settlement list (data.gov.il dataset localities-in-israel, resource "
    f"{RESOURCE_ID}), CBS Open License: attribution required"
)
JUDEA_AND_SAMARIA = 7  # CBS district; not areas (Gilad 2026-11-17, PRODUCT.md "Launch area")
_HYPHEN = re.compile(r"\s*-\s*")


def settlement_row(record: dict[str, Any]) -> tuple[int, str, int, int, int] | None:
    """(code, name_he, district, itm_x, itm_y), or None for a row with no or a malformed coordinate
    (12 digits: ITM X then Y, in `0014a`'s bounds) or in Judea and Samaria."""
    coordinate = record.get("קואורדינטות")
    if type(coordinate) is not int or not 10**11 <= coordinate < 10**12:
        return None
    x, y = divmod(coordinate, 10**6)
    if not (100000 <= x <= 300000 and 350000 <= y <= 800000):
        return None
    district = record["סמל מחוז"]
    if district == JUDEA_AND_SAMARIA:
        return None
    name = _HYPHEN.sub("-", str(record["שם יישוב"]).strip())
    return int(record["סמל יישוב"]), name, int(district), x, y


def main() -> None:
    response = httpx.get(URL, params={"resource_id": RESOURCE_ID, "limit": 2000}, timeout=60.0)
    response.raise_for_status()
    result = response.json()["result"]
    records: list[dict[str, Any]] = result["records"]
    if len(records) != result["total"]:
        sys.exit(f"build-settlements: got {len(records)} of {result['total']} rows")
    rows = sorted(row for record in records if (row := settlement_row(record)) is not None)
    with CSV_PATH.open("w", encoding="utf-8", newline="") as out:
        out.write(HEADER + "\n")
        writer = csv.writer(out, lineterminator="\n")
        writer.writerow(("code", "name_he", "district", "itm_x", "itm_y"))
        writer.writerows(rows)
    print(f"build-settlements: {len(rows)} of {len(records)} rows written to {CSV_PATH.name}")


if __name__ == "__main__":
    main()
