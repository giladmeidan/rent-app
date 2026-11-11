"""CHECK texts that more than one table shares, built from the schema's one list of values.

`LIFESTYLE_CHECK` is `ck_listings_lifestyle` and `ck_seeker_profiles_lifestyle` (migration 0010,
which freezes the same text): `lifestyle` is an object whose keys are among `LIFESTYLE_KEYS` and
whose every value is the JSON number 1, 2 or 3. The jsonpath is `strict`, so an array value is not
unwrapped. `tests/test_migrations.py` checks that the migrated constraint matches this text."""

from typing import get_args

from app.schemas.profile import LIFESTYLE_KEYS, LifestyleAnswer

_KEYS = ", ".join(f"'{key}'" for key in LIFESTYLE_KEYS)
_NOT_AN_ANSWER = " && ".join(f"@ != {answer}" for answer in get_args(LifestyleAnswer))

LIFESTYLE_CHECK = (
    "jsonb_typeof(lifestyle) = 'object'"
    f" AND (lifestyle - ARRAY[{_KEYS}]) = '{{}}'::jsonb"
    " AND NOT jsonb_path_exists(lifestyle,"
    f" 'strict $.* ? (@.type() != \"number\" || ({_NOT_AN_ANSWER}))')"
)
