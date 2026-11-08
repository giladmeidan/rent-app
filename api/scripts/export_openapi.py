"""Print the API's OpenAPI schema as JSON without starting a server.

Usage: `python api/scripts/export_openapi.py > openapi.json`. Needs only the variables listed in
`.env.example`; nothing connects to the database or Redis.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main() -> None:
    from app.main import create_app

    json.dump(create_app().openapi(), sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
