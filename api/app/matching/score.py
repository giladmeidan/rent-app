"""The match score (spec 0006b; PRODUCT.md "Matching"): hard filters, then a weighted distance
score.

Written once, as SQL (`match_columns`), so the same expressions rank, page and explain: search
orders by `m_score`, and `explain` turns one result row's columns into the API's `MatchOut`. There
is no Python re-implementation of the formula.

Per criterion `c`, `m_<c>` is a `numeric` in 0-1 (Python `Decimal`, never `float`); each hard
criterion also has `f_<c>`, "fails". `raw = round(sum(WEIGHTS[c] * m_c))` on the numeric sum
(`round(numeric)` rounds half away from zero), and a listing failing any hard filter is capped at
`HARD_FAIL_CAP`: it stays in the results with its failure as the "differs" line, never hidden.

Weights (spec 0015b): budget 20, move-in 20, area 15, household 10, contract 10, shelter 10,
parking 5, smoking 5, pets 5. The hard filters are budget, move-in, area, smoking, pets and
shelter: a seeker who needs a protected space (`shelter_needed` `protected`: a listing's `mamad`,
`mamak` or `building`; `mamad`: a ממ״ד in the flat) fails a listing without one, and a listing that
did not say (NULL `shelter`, rows from before 0015b) fails it too.

A past `available_from` means "immediately" (spec 0002a) and a past stored `move_in_date` means
"now", hence both `greatest(..., current_date)`; `current_date` is the database's (UTC). The
expressions assume a profile row: with NULL profile columns they are not NULL but meaningless.

Lifestyle (spec 0007g; PRODUCT.md "Rooms"): on a **room**, the soft `lifestyle` criterion is the
agreement between the flat's questionnaire answers and the seeker's, over the questions both
answered: per shared key `1 - |a - b| / 2` (1, 0.5 or 0), averaged. It is NULL when no answer is
shared or the listing is not a room, and a NULL criterion is skipped: it neither scores nor
explains. When it is set, the 9 base criteria share `BASE_SHARE` of the score and lifestyle the
rest: `raw = round(BASE_SHARE * B + LIFESTYLE_WEIGHT * m_lifestyle)`, with `B` the unrounded base
sum, so without it the score is exactly the base one. The terms are unrolled per key in Python, so
the SQL is a plain per-row expression (no subquery, no SubPlan).

"A room" is `match_columns`' `listing_type=` keyword, by default the listing's live type. The
owner's inbox passes the application's type at apply time (security, as for price and area): an
owner who turns an apartment into a room and sets one answer must not read an apartment
applicant's answer off the score. The seeker's own views always use the live type."""

import typing
import uuid
from collections.abc import Mapping
from decimal import Decimal
from typing import Any, Final, get_args

from sqlalchemy import (
    ColumnElement,
    Date,
    Integer,
    Label,
    Numeric,
    Row,
    and_,
    any_,
    case,
    cast,
    func,
    literal,
    not_,
    or_,
)
from sqlalchemy.orm import QueryableAttribute
from sqlalchemy.orm.util import AliasedClass

from app.models import Listing, SeekerProfile
from app.schemas.match import Criterion, MatchOut
from app.schemas.profile import LIFESTYLE_KEYS

# Also the tie-break order of the explanation; `lifestyle` is last.
CRITERIA: Final[tuple[Criterion, ...]] = get_args(Criterion)
# The 9 base criteria (sum 100); `lifestyle` is weighted apart (`LIFESTYLE_WEIGHT`).
WEIGHTS: Final[dict[Criterion, int]] = {
    "budget": 20,
    "move_in": 20,
    "area": 15,
    "household": 10,
    "contract": 10,
    "parking": 5,
    "smoking": 5,
    "pets": 5,
    "shelter": 10,
}
HARD: Final[tuple[Criterion, ...]] = ("budget", "move_in", "area", "smoking", "pets", "shelter")
# A `protected` seeker's protected spaces (`listings.shelter`); `none` and NULL are not.
_PROTECTED: Final = ("mamad", "mamak", "building")
# When `lifestyle` is scored it takes this many of the 100 points; the base criteria keep the rest,
# each `W_c` scaled by `BASE_SHARE` (0.8). `lifestyle` is soft: never in `HARD`.
LIFESTYLE_WEIGHT: Final = 20
BASE_SHARE: Final = Decimal(100 - LIFESTYLE_WEIGHT) / 100
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


def _sum(terms: list[ColumnElement[Any]]) -> ColumnElement[Any]:
    total = terms[0]
    for term in terms[1:]:
        total = total + term
    return total


def _lifestyle(
    listing: type[Listing] | AliasedClass[Listing],
    profile: type[SeekerProfile] | AliasedClass[SeekerProfile],
    listing_type: QueryableAttribute[str] | ColumnElement[str],
) -> ColumnElement[Decimal]:
    """`m_lifestyle`: when `listing_type` is `'room'`, the mean of `1 - |a_k - b_k| / 2` over the
    `LIFESTYLE_KEYS` both `lifestyle` objects hold; else, or when no key is shared, NULL.

    A key is shared exactly when both sides hold it (`?`): the CHECKs (`ck_listings_lifestyle`,
    `ck_seeker_profiles_lifestyle`) allow only the numbers 1-3 as values, so a held key's term is
    never NULL. The denominator therefore tests `?` rather than extracting the answers again."""
    agreement: list[ColumnElement[Any]] = []
    shared: list[ColumnElement[Any]] = []
    for key in LIFESTYLE_KEYS:
        a = cast(listing.lifestyle[key].astext, Numeric)
        b = cast(profile.lifestyle[key].astext, Numeric)
        term = _ONE - func.abs(a - b, type_=Numeric) / 2
        agreement.append(func.coalesce(term, _ZERO, type_=Numeric))
        both = and_(listing.lifestyle.has_key(key), profile.lifestyle.has_key(key))
        shared.append(case((both, 1), else_=0))
    mean = _sum(agreement) / func.nullif(_sum(shared), 0, type_=Integer)
    return case((listing_type == "room", mean))


def match_columns(
    listing: type[Listing] | AliasedClass[Listing],
    profile: type[SeekerProfile] | AliasedClass[SeekerProfile],
    *,
    price: QueryableAttribute[int] | ColumnElement[int] | None = None,
    area_id: QueryableAttribute[uuid.UUID] | ColumnElement[uuid.UUID] | None = None,
    listing_type: QueryableAttribute[str] | ColumnElement[str] | None = None,
) -> list[Label[Any]]:
    """The labelled match columns for a statement that selects `listing` joined to one `profile`
    row (either may be an alias): `m_<criterion>` for every criterion (`m_lifestyle` may be
    NULL), `f_<criterion>` for every `HARD` one, and `m_score`.

    `price` / `area_id` replace `listing.price_ils` / `listing.area_id` as the inputs of the
    budget and area criteria (default: the listing's live columns), and `listing_type` replaces
    `listing.listing_type` as the type that decides whether lifestyle is scored (only on
    `'room'`). The owner's inbox passes the application's snapshot at apply time (spec 0006c,
    security B1; spec 0007g); the seeker's views never do."""
    listing_price = listing.price_ils if price is None else price
    listing_area = listing.area_id if area_id is None else area_id
    room_type = listing.listing_type if listing_type is None else listing_type
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
    in_area = listing_area == any_(profile.area_ids)
    m: dict[Criterion, ColumnElement[Decimal]] = {
        "budget": _ones_when(listing_price <= profile.budget_max_ils),
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
        # `IS TRUE` (spec 0010c: the columns are nullable); every caller gates on the looking part.
        "smoking": case(
            (and_(profile.smoker.is_(True), not_(listing.smoking_allowed)), _ZERO), else_=_ONE
        ),
        "pets": case(
            (and_(profile.has_pets.is_(True), not_(listing.pets_allowed)), _ZERO), else_=_ONE
        ),
        # Never NULL: a NULL `listing.shelter` falls to `_ones_when`'s `ELSE 0`.
        "shelter": case(
            (profile.shelter_needed == "any", _ONE),
            (profile.shelter_needed == "mamad", _ones_when(listing.shelter == "mamad")),
            else_=_ones_when(listing.shelter.in_(_PROTECTED)),
        ),
        "lifestyle": _lifestyle(listing, profile, room_type),
    }
    fails: dict[Criterion, ColumnElement[bool]] = {
        "budget": listing_price > profile.budget_max_ils,
        "move_in": days > MOVE_IN_WINDOW_DAYS,
        "area": m["area"] == 0,
        "smoking": m["smoking"] == 0,
        "pets": m["pets"] == 0,
        "shelter": m["shelter"] == 0,
    }
    # `B`, unrounded. `BASE_SHARE` is bound as numeric: a float bind would make the sum double
    # precision, which `round` rounds half to even. One `round`, over the whole sum.
    base = _sum([WEIGHTS[c] * m[c] for c in WEIGHTS])
    with_lifestyle = literal(BASE_SHARE, Numeric) * base + LIFESTYLE_WEIGHT * m["lifestyle"]
    raw = func.round(func.coalesce(with_lifestyle, base, type_=Numeric), type_=Numeric)
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


def _weight(criterion: Criterion) -> Decimal:
    """The effective weight of `criterion` in a score that includes lifestyle."""
    if criterion == "lifestyle":
        return Decimal(LIFESTYLE_WEIGHT)
    return BASE_SHARE * WEIGHTS[criterion]


def explain_row(row: Row[Any]) -> MatchOut:
    """`explain` on one result row's columns (`row._mapping`, keyed by the match labels)."""
    return explain(typing.cast(Mapping[str, Any], row._mapping))


def explain(values: Mapping[str, Any]) -> MatchOut:
    """The `MatchOut` of one result row's `m_*` / `f_*` / `m_score` values (`row._mapping`).

    A criterion whose `m_c` is None (`lifestyle` when not scored) is skipped. `w_c` is the
    effective weight: `BASE_SHARE * W_c` for the base criteria, `LIFESTYLE_WEIGHT` for
    `lifestyle` (the common factor leaves the base criteria's order as it was). `differs`: the
    first criterion with `m_c < 1`, sorted by (not failing, -w*(1-m_c), `CRITERIA` index), so a
    failing one comes first; `None` when every `m_c` is 1. `agrees`: the first 3 criteria with
    `m_c >= 0.5`, neither failing nor `differs`, sorted by (-w*m_c, `CRITERIA` index)."""
    m = {c: Decimal(v) for c in CRITERIA if (v := values[f"m_{c}"]) is not None}
    scored = [c for c in CRITERIA if c in m]
    failing = {c for c in HARD if values[f"f_{c}"]}
    gaps = sorted(
        (c for c in scored if m[c] < 1),
        key=lambda c: (c not in failing, -_weight(c) * (1 - m[c]), CRITERIA.index(c)),
    )
    differs = gaps[0] if gaps else None
    agrees = sorted(
        (c for c in scored if m[c] >= _AGREE_MIN and c not in failing and c != differs),
        key=lambda c: (-_weight(c) * m[c], CRITERIA.index(c)),
    )[:3]
    return MatchOut(score=int(values["m_score"]), agrees=agrees, differs=differs)
