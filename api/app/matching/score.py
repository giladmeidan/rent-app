"""The match score (spec 0006b; PRODUCT.md "Matching"): hard filters, then a weighted distance
score.

Written once, as SQL (`match_columns`), so the same expressions rank, page and explain: search
orders by `m_score`, and `explain` turns one result row's columns into the API's `MatchOut`. There
is no Python re-implementation of the formula.

Per criterion `c`, `m_<c>` is a `numeric` in 0-1 (Python `Decimal`, never `float`); each hard
criterion also has `f_<c>`, "fails". `raw = round(sum(WEIGHTS[c] * m_c))` on the numeric sum
(`round(numeric)` rounds half away from zero), and a listing failing any hard filter is capped at
`HARD_FAIL_CAP`: it stays in the results with its failure as the "differs" line, never hidden.

A past `available_from` means "immediately" (spec 0002a) and a past stored `move_in_date` means
"now", hence both `greatest(..., current_date)`; `current_date` is the database's (UTC). The
expressions assume a profile row: with NULL profile columns they are not NULL but meaningless."""

from collections.abc import Mapping
from decimal import Decimal
from typing import Any, Final, get_args

from sqlalchemy import (
    ColumnElement,
    Date,
    Integer,
    Label,
    Numeric,
    and_,
    any_,
    case,
    cast,
    func,
    not_,
    or_,
)
from sqlalchemy.orm import QueryableAttribute

from app.models import Listing, SeekerProfile
from app.schemas.match import Criterion, MatchOut

# Also the tie-break order of the explanation.
CRITERIA: Final[tuple[Criterion, ...]] = get_args(Criterion)
WEIGHTS: Final[dict[Criterion, int]] = {
    "budget": 25,
    "move_in": 20,
    "area": 20,
    "household": 10,
    "contract": 10,
    "parking": 5,
    "smoking": 5,
    "pets": 5,
}
HARD: Final[tuple[Criterion, ...]] = ("budget", "move_in", "area", "smoking", "pets")
HARD_FAIL_CAP: Final = 59
# Move-in dates up to four weeks apart pass, scoring linearly from 1 (same day) down to 0.
MOVE_IN_WINDOW_DAYS: Final = 28
# A flexible date on either side ("גמיש ±2 שבועות") forgives this many days.
FLEXIBLE_DAYS: Final = 14

_ONE = cast(1, Numeric)
_ZERO = cast(0, Numeric)
_AGREE_MIN = Decimal("0.5")


def _ones_when(condition: ColumnElement[bool]) -> ColumnElement[Decimal]:
    """`1` when `condition` holds, else `0`, as numeric."""
    return case((condition, _ONE), else_=_ZERO)


def _days_if(flag: QueryableAttribute[bool]) -> ColumnElement[int]:
    """`FLEXIBLE_DAYS` when `flag`, else 0: a boolean enters arithmetic only through a CASE."""
    return case((flag, FLEXIBLE_DAYS), else_=0)


def match_columns(listing: type[Listing], profile: type[SeekerProfile]) -> list[Label[Any]]:
    """The labelled match columns for a statement that selects `listing` joined to one `profile`
    row (either may be an alias): `m_<criterion>` for every criterion, `f_<criterion>` for every
    `HARD` one, and `m_score`."""
    today = func.current_date(type_=Date)
    gap = func.abs(
        func.greatest(listing.available_from, today, type_=Date)
        - func.greatest(profile.move_in_date, today, type_=Date),
        type_=Integer,
    )
    days = func.greatest(
        0,
        gap - _days_if(listing.entry_flexible) - _days_if(profile.move_in_flexible),
        type_=Integer,
    )
    in_area = listing.area_id == any_(profile.area_ids)
    m: dict[Criterion, ColumnElement[Decimal]] = {
        "budget": _ones_when(listing.price_ils <= profile.budget_max_ils),
        "move_in": func.greatest(
            _ZERO, _ONE - cast(days, Numeric) / MOVE_IN_WINDOW_DAYS, type_=Numeric
        ),
        "area": _ones_when(in_area),
        "household": _ones_when(profile.household == any_(listing.accepted_households)),
        "contract": _ones_when(
            or_(
                listing.min_contract_months.is_(None),
                profile.contract_months >= listing.min_contract_months,
            )
        ),
        "parking": case(
            (profile.parking_needed == 0, _ONE),
            else_=func.least(
                _ONE, cast(listing.parking_spots, Numeric) / profile.parking_needed, type_=Numeric
            ),
        ),
        "smoking": case((and_(profile.smoker, not_(listing.smoking_allowed)), _ZERO), else_=_ONE),
        "pets": case((and_(profile.has_pets, not_(listing.pets_allowed)), _ZERO), else_=_ONE),
    }
    fails: dict[Criterion, ColumnElement[bool]] = {
        "budget": listing.price_ils > profile.budget_max_ils,
        "move_in": days > MOVE_IN_WINDOW_DAYS,
        "area": m["area"] == 0,
        "smoking": m["smoking"] == 0,
        "pets": m["pets"] == 0,
    }
    weighted = [WEIGHTS[c] * m[c] for c in CRITERIA]
    total = weighted[0]
    for term in weighted[1:]:
        total = total + term
    raw = func.round(total, type_=Numeric)
    score = cast(
        case(
            (or_(*(fails[c] for c in HARD)), func.least(raw, HARD_FAIL_CAP, type_=Numeric)),
            else_=raw,
        ),
        Integer,
    )
    return [
        *(m[c].label(f"m_{c}") for c in CRITERIA),
        *(fails[c].label(f"f_{c}") for c in HARD),
        score.label("m_score"),
    ]


def explain(values: Mapping[str, Any]) -> MatchOut:
    """The `MatchOut` of one result row's `m_*` / `f_*` / `m_score` values (`row._mapping`).

    `differs`: the first criterion with `m_c < 1`, sorted by (not failing, -W*(1-m_c), `CRITERIA`
    index), so a failing one comes first; `None` when every `m_c` is 1. `agrees`: the first 3
    criteria with `m_c >= 0.5`, neither failing nor `differs`, sorted by (-W*m_c, `CRITERIA`
    index)."""
    m = {c: Decimal(values[f"m_{c}"]) for c in CRITERIA}
    failing = {c for c in HARD if values[f"f_{c}"]}
    gaps = sorted(
        (c for c in CRITERIA if m[c] < 1),
        key=lambda c: (c not in failing, -WEIGHTS[c] * (1 - m[c]), CRITERIA.index(c)),
    )
    differs = gaps[0] if gaps else None
    agrees = sorted(
        (c for c in CRITERIA if m[c] >= _AGREE_MIN and c not in failing and c != differs),
        key=lambda c: (-WEIGHTS[c] * m[c], CRITERIA.index(c)),
    )[:3]
    return MatchOut(score=int(values["m_score"]), agrees=agrees, differs=differs)
