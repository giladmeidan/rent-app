"""Unit tests for the shared visible-characters rule (spec 0002d, AC1-AC5). No database.

Every non-ASCII input is written as an escape, never as a literal invisible character."""

import pytest

from app.schemas._text import _is_noncharacter, visible_characters_only

INVISIBLE = "city contains control or invisible characters"
TOO_MANY_MARKS = "city has too many combining marks in a row"
NO_ALNUM = "city must contain a letter or digit"


def _positions(ch: str) -> list[str]:
    """`ch` alone, first, between letters and last."""
    return [ch, f"{ch}ab", f"a{ch}b", f"ab{ch}"]


@pytest.mark.parametrize(
    "ch",
    [
        "\ue000",  # private use, BMP start
        "\uf8ff",  # private use, BMP end (Apple's logo)
        "\U000f0000",  # supplementary private use, plane 15
        "\U0010fffd",  # supplementary private use, plane 16
        "\ufdd0",  # non-character block start
        "\ufdef",  # non-character block end
        "\ufffe",
        "\uffff",
        "\U0001fffe",
        "\U0001ffff",
        "\U0010ffff",
        "\ud800",  # lone surrogate (direct callers only; JSON fails earlier in pydantic-core)
        "\udfff",
    ],
    ids=lambda ch: f"U+{ord(ch):04X}",
)
def test_ac1_rejects_private_use_noncharacters_and_surrogates(ch: str) -> None:
    for value in _positions(ch):
        with pytest.raises(ValueError, match=f"^{INVISIBLE}$"):
            visible_characters_only(value, field="city")
        with pytest.raises(ValueError, match="contains control or invisible characters"):
            visible_characters_only(value, allow_newlines=True)


def test_ac1_exactly_the_66_noncharacters() -> None:
    noncharacters = [cp for cp in range(0x110000) if _is_noncharacter(cp)]

    assert len(noncharacters) == 66
    assert noncharacters[:32] == list(range(0xFDD0, 0xFDF0))
    assert noncharacters[32:] == [
        plane << 16 | low for plane in range(17) for low in (0xFFFE, 0xFFFF)
    ]


@pytest.mark.parametrize(
    "ch", ["\u115f", "\u1160", "\u3164", "\uffa0", "\u2800"], ids=lambda ch: f"U+{ord(ch):04X}"
)
def test_ac2_rejects_blank_letters(ch: str) -> None:
    for value in [*_positions(ch), ch * 3]:
        with pytest.raises(ValueError, match=f"^{INVISIBLE}$"):
            visible_characters_only(value, field="city")


@pytest.mark.parametrize(
    "value",
    [
        "a" + "\u0301" * 5,
        "a" + "\u0301" * 3 + "\u200c" + "\u0301" * 3,  # a joiner does not end the run
        "a" + "\u0301" * 2 + "\u200d" + "\u0301" * 3,
        "\u0301" * 5,  # no base letter at all
        "ok " + "\u05b8" * 5,  # Hebrew points count too
        "a" + "\u0903" * 5,  # Mc (spacing mark)
        "a" + "\u20dd" * 5,  # Me (enclosing mark)
        "a" + "\u0301\u0903\u20dd\u05b8\u0301",  # mixed mark categories
    ],
)
def test_ac3_combining_runs_capped_at_four_rejects(value: str) -> None:
    with pytest.raises(ValueError, match=f"^{TOO_MANY_MARKS}$"):
        visible_characters_only(value, field="city")


@pytest.mark.parametrize(
    "value",
    [
        "a" + "\u0301" * 4,
        "ש\u05bc\u05c1\u05b8\u05bd",  # shin + dagesh + shin dot + qamats + meteg = 4 marks
        "e\u0301",  # decomposed e-acute
        "ש\u05c1\u05b8לו\u05b9ם",  # pointed shalom
        ("a" + "\u0301" * 4) * 3,  # a base letter ends each run
        "a" + "\u0301" * 4 + " " + "\u0301" * 4,  # a space ends the run too
    ],
)
def test_ac3_combining_runs_capped_at_four(value: str) -> None:
    assert visible_characters_only(value, field="city") == value
    assert visible_characters_only(value, field="city", require_alnum=True) == value


def test_ac3_newline_ends_a_run_in_multiline_text() -> None:
    value = "a" + "\u0301" * 4 + "\n" + "\u0301" * 4
    assert visible_characters_only(value, allow_newlines=True) == value


@pytest.mark.parametrize("value", ["...", "-", "\U0001f642", " - ", "\u0301", "\u200d"])
def test_ac4_require_alnum_rejects(value: str) -> None:
    with pytest.raises(ValueError, match=f"^{NO_ALNUM}$"):
        visible_characters_only(value, field="city", require_alnum=True)


# U+0661 is ARABIC-INDIC DIGIT ONE (`Nd`).
@pytest.mark.parametrize("value", ["תל אביב", "12", "רמת-גן", "\u0661", "x"])
def test_ac4_require_alnum(value: str) -> None:
    assert visible_characters_only(value, field="city", require_alnum=True) == value


def test_ac4_without_require_alnum_an_emoji_passes() -> None:
    assert visible_characters_only("\U0001f642") == "\U0001f642"
    assert visible_characters_only("...") == "..."


@pytest.mark.parametrize(
    ("value", "allow_newlines"),
    [
        ("\U0001f468\u200d\U0001f469\u200d\U0001f467", False),  # ZWJ family emoji
        ("\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645", False),  # ZWNJ (Persian)
        ("line one\nline two", True),
        ("\U0001fae9", False),  # Unicode 16 emoji: `Cn` in Python 3.12, must stay accepted
        ("\U0001fae9 דירה", True),
    ],
)
def test_ac5_existing_rules_unchanged(value: str, allow_newlines: bool) -> None:
    assert visible_characters_only(value, allow_newlines=allow_newlines) == value


@pytest.mark.parametrize(
    ("value", "allow_newlines"),
    [
        ("a\u202eb", False),  # bidi override
        ("a\u202eb", True),
        ("a\u0000b", False),  # NUL
        ("a\u0000b", True),
        ("a\nb", False),  # a newline without allow_newlines
        ("a\rb", True),  # a lone CR even with allow_newlines
        ("a\u2028b", True),  # line separator
        ("a\u200bb", False),  # zero-width space
    ],
)
def test_ac5_existing_rules_unchanged_rejects(value: str, allow_newlines: bool) -> None:
    with pytest.raises(ValueError, match="contains control or invisible characters"):
        visible_characters_only(value, allow_newlines=allow_newlines)
