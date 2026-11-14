"""Shared text rules for API schemas (specs 0001a, 0002a, 0002d)."""

import unicodedata
from typing import Any

# Control, format (bidi, zero-width), line/paragraph separators, private use, lone surrogates.
_INVISIBLE_CATEGORIES = frozenset({"Cc", "Cf", "Zl", "Zp", "Co", "Cs"})
_JOINERS = frozenset({"\u200c", "\u200d"})  # ZWNJ, ZWJ
# Letters (`Lo`) that render as nothing: Hangul choseong/jungseong fillers, Hangul filler,
# halfwidth Hangul filler, braille pattern blank.
_BLANK_LETTERS = frozenset({"\u115f", "\u1160", "\u3164", "\uffa0", "\u2800"})
# Default-ignorable code points that are unassigned (`Cn`) in Python 3.12's Unicode 15.0: browsers
# render them as nothing. Matched by value; the assigned ones in these ranges are `Cf` already.
# U+E0100..U+E01EF (variation selectors, `Mn`) are not in the set. Spec 0002d review B1.
_IGNORABLE_UNASSIGNED = ((0x2065, 0x2065), (0xFFF0, 0xFFF8), (0xE0000, 0xE00FF), (0xE01F0, 0xE0FFF))
_MARK_CATEGORIES = frozenset({"Mn", "Mc", "Me"})
# Pointed modern Hebrew carries at most 4 marks on a letter (dagesh, shin/sin dot, vowel, meteg).
MAX_COMBINING_RUN = 4


def _is_noncharacter(code_point: int) -> bool:
    """The 66 Unicode non-characters: U+FDD0..U+FDEF and U+xxFFFE / U+xxFFFF on every plane.
    Matched by value, not by category `Cn`: `Cn` also covers code points that are merely newer
    than Python's Unicode tables (a Unicode 16 emoji is `Cn` in Python 3.12)."""
    return 0xFDD0 <= code_point <= 0xFDEF or (code_point & 0xFFFF) in (0xFFFE, 0xFFFF)


def _is_ignorable_unassigned(code_point: int) -> bool:
    return any(low <= code_point <= high for low, high in _IGNORABLE_UNASSIGNED)


def visible_characters_only(
    value: str,
    *,
    allow_newlines: bool = False,
    field: str = "",
    require_alnum: bool = False,
    require_visible: bool = False,
) -> str:
    """Reject text that hides or spoofs characters: control, format (bidi, zero-width), line and
    paragraph separators (NUL is also rejected by Postgres), private-use characters, lone
    surrogates, non-characters, blank letters (`_BLANK_LETTERS`), unassigned default-ignorable
    code points (`_IGNORABLE_UNASSIGNED`), and more than `MAX_COMBINING_RUN` combining marks in a
    row ("Zalgo" text). ZWJ/ZWNJ stay (emoji, scripts) and do not end a run of marks; nor does
    any other unassigned (`Cn`) code point, which is accepted. With `allow_newlines`, `\\n` is
    allowed too (callers normalise `\\r\\n` first; a lone `\\r` is still rejected). With
    `require_alnum`, the value must contain at least one letter or number. With `require_visible`,
    it must contain at least one character that renders: not whitespace, a joiner (ZWJ, ZWNJ, or
    the combining grapheme joiner U+034F), a combining mark or a variation selector (U+FE00-FE0F,
    U+E0100-E01EF, U+180B-180F; all of them `Mn` or `Cf`); an emoji or any other symbol counts
    (spec 0005a review M1). `field` prefixes the error messages."""
    marks_in_row = 0
    has_alnum = False
    has_visible = False
    for ch in value:
        if ch in _JOINERS:
            continue
        if allow_newlines and ch == "\n":
            marks_in_row = 0
            continue
        category = unicodedata.category(ch)
        if (
            category in _INVISIBLE_CATEGORIES
            or ch in _BLANK_LETTERS
            or _is_noncharacter(ord(ch))
            or _is_ignorable_unassigned(ord(ch))
        ):
            raise ValueError(f"{field} contains control or invisible characters".lstrip())
        if category == "Cn":
            # Newer than Python's Unicode tables (a Unicode 16 emoji or mark): accepted, and, like
            # ZWJ/ZWNJ, it neither counts toward nor ends a run of marks.
            has_visible = True
            continue
        if category in _MARK_CATEGORIES:
            marks_in_row += 1
            if marks_in_row > MAX_COMBINING_RUN:
                raise ValueError(f"{field} has too many combining marks in a row".lstrip())
            continue
        marks_in_row = 0
        if not ch.isspace():
            has_visible = True
        if category[0] in "LN":
            has_alnum = True
    if require_alnum and not has_alnum:
        raise ValueError(f"{field} must contain a letter or digit".lstrip())
    if require_visible and not has_visible:
        raise ValueError(f"{field} must contain a visible character".lstrip())
    return value


def lf_newlines(value: Any) -> Any:
    """`\\r\\n` -> `\\n` on a string (a `BeforeValidator`); anything else unchanged. Here, not in
    `schemas/listing.py`, so `schemas/profile.py` can use it too (listing imports profile)."""
    return value.replace("\r\n", "\n") if isinstance(value, str) else value


def blank_to_none(value: Any) -> Any:
    """A blank-after-strip string is None (a `BeforeValidator` on an optional text field: an
    application's message, spec 0010l; a report's note, 0011b), not a 422 from `min_length`."""
    if isinstance(value, str) and not value.strip():
        return None
    return value
