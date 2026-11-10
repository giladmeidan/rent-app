"""Shared text rules for API schemas (specs 0001a, 0002a)."""

import unicodedata

_INVISIBLE_CATEGORIES = frozenset({"Cc", "Cf", "Zl", "Zp"})
_JOINERS = frozenset({"\u200c", "\u200d"})  # ZWNJ, ZWJ


def visible_characters_only(value: str, *, allow_newlines: bool = False, field: str = "") -> str:
    """Reject control, format (bidi, zero-width) and line/paragraph-separator characters: they hide
    or spoof text, and NUL is rejected by Postgres. ZWJ/ZWNJ stay (emoji, scripts). With
    `allow_newlines`, `\\n` is allowed too (callers normalise `\\r\\n` first; a lone `\\r` is
    still rejected). `field` prefixes the error message."""
    for ch in value:
        if ch in _JOINERS or (allow_newlines and ch == "\n"):
            continue
        if unicodedata.category(ch) in _INVISIBLE_CATEGORIES:
            raise ValueError(f"{field} contains control or invisible characters".lstrip())
    return value
