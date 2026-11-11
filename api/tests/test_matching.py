"""Match score explanation (spec 0006b): AC11, the unit test of `explain` (no database)."""

from decimal import Decimal
from typing import Any

import pytest

from app.matching.score import CRITERIA, HARD, explain

TOP3 = ["budget", "move_in", "area"]


def _values(**overrides: Any) -> dict[str, Any]:
    """One result row's match values: every `m_*` 1, no `f_*`, `m_score` 100; `overrides` win."""
    values: dict[str, Any] = {
        **{f"m_{c}": Decimal(1) for c in CRITERIA},
        **{f"f_{c}": False for c in HARD},
        "m_score": 100,
    }
    return {**values, **overrides}


@pytest.mark.parametrize(
    ("values", "agrees", "differs"),
    [
        pytest.param(_values(), TOP3, None, id="all_ones"),
        pytest.param(
            _values(m_pets=Decimal(0), f_pets=True, m_household=Decimal(0), m_score=59),
            TOP3,
            "pets",
            id="failing_pets_beats_household",
        ),
        pytest.param(
            _values(
                m_smoking=Decimal(0), f_smoking=True, m_pets=Decimal(0), f_pets=True, m_score=59
            ),
            TOP3,
            "smoking",
            id="two_failing_tie_breaks_by_order",
        ),
        pytest.param(
            _values(
                m_budget=Decimal(0),
                f_budget=True,
                m_move_in=Decimal("0.43"),
                m_household=Decimal(0),
                m_contract=Decimal(0),
                m_score=48,
            ),
            ["area", "parking", "smoking"],
            "budget",
            id="agrees_needs_half",
        ),
    ],
)
def test_ac11_explain_rules(values: dict[str, Any], agrees: list[str], differs: str | None) -> None:
    match = explain(values)

    assert match.agrees == agrees
    assert match.differs == differs
    assert match.score == values["m_score"]
