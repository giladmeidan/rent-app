"""Shared text rules for API schemas (specs 0001a, 0002a, 0002d)."""

import unicodedata

# Control, format (bidi, zero-width), line/paragraph separators, private use, lone surrogates.
_INVISIBLE_CATEGORIES = frozenset({"Cc", "Cf", "Zl", "Zp", "Co", "Cs"})
_JOINERS = frozenset({"\u200c", "\u200d"})  # ZWNJ, ZWJ
# Letters (`Lo`) that render as nothing: Hangul choseong/jungseong fillers, Hangul filler,
# halfwidth Hangul filler, braille pattern blank.
_BLANK_LETTERS = frozenset({"\u115f", "\u1160", "\u3164", "\uffa0", "\u2800"})
_MARK_CATEGORIES = frozenset({"Mn", "Mc", "Me"})
# Pointed modern Hebrew carries at most 4 marks on a letter (dagesh, shin/sin dot, vowel, meteg).
MAX_COMBINING_RUN = 4


def _is_noncharacter(code_point: int) -> bool:
    """The 66 Unicode non-characters: U+FDD0..U+FDEF and U+xxFFFE / U+xxFFFF on every plane.
    Matched by value, not by category `Cn`: `Cn` also covers code points that are merely newer
    than Python's Unicode tables (a Unicode 16 emoji is `Cn` in Python 3.12)."""
    return 0xFDD0 <= code_point <= 0xFDEF or (code_point & 0xFFFF) in (0xFFFE, 0xFFFF)


def visible_characters_only(
    value: str, *, allow_newlines: bool = False, field: str = "", require_alnum: bool = False
) -> str:
    """Reject text that hides or spoofs characters: control, format (bidi, zero-width), line and
    paragraph separators (NUL is also rejected by Postgres), private-use characters, lone
    surrogates, non-characters, blank letters (`_BLANK_LETTERS`), and more than
    `MAX_COMBINING_RUN` combining marks in a row ("Zalgo" text). ZWJ/ZWNJ stay (emoji, scripts)
    and do not end a run of marks. With `allow_newlines`, `\\n` is allowed too (callers normalise
    `\\r\\n` first; a lone `\\r` is still rejected). With `require_alnum`, the value must contain
    at least one letter or number. `field` prefixes the error messages."""
    marks_in_row = 0
    has_alnum = False
    for ch in value:
        if ch in _JOINERS:
            continue
        if allow_newlines and ch == "\n":
            marks_in_row = 0
            continue
        category = unicodedata.category(ch)
        if category in _INVISIBLE_CATEGORIES or ch in _BLANK_LETTERS or _is_noncharacter(ord(ch)):
            raise ValueError(f"{field} contains control or invisible characters".lstrip())
        if category in _MARK_CATEGORIES:
            marks_in_row += 1
            if marks_in_row > MAX_COMBINING_RUN:
                raise ValueError(f"{field} has too many combining marks in a row".lstrip())
            continue
        marks_in_row = 0
        if category[0] in "LN":
            has_alnum = True
    if require_alnum and not has_alnum:
        raise ValueError(f"{field} must contain a letter or digit".lstrip())
    return value
