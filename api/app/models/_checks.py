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

# A photo key (spec 0010d): `secrets.token_urlsafe(32)`, 43 characters of the URL-safe base64
# alphabet. `ck_listing_photos_key` and `ck_users_photo_key` (migration 0013) hold every stored key
# to it, so nothing else (an id, a `/`) can ever become part of an object name.
PHOTO_KEY_PATTERN = "^[A-Za-z0-9_-]{43}$"


def photo_key_check(column: str) -> str:
    """The CHECK text holding `column` to `PHOTO_KEY_PATTERN`."""
    return f"{column} ~ '{PHOTO_KEY_PATTERN}'"
