"""API schema for a listing's match against the caller's housing profile (spec 0006b).

Only the score and criterion codes: no profile value is ever returned (NF3). The web turns the codes
into copy from the listing and the seeker's own profile."""

from typing import Literal

from pydantic import BaseModel

# The match criteria, in tie-break order (`app/matching/score.py` `CRITERIA` is this tuple).
# `lifestyle` (spec 0007g) is soft and scored on rooms only; it is NULL, and so never named, when
# the flat and the seeker share no answered question.
# `shelter` (spec 0015b) is hard: a seeker who needs a protected space fails a listing without one.
Criterion = Literal[
    "budget",
    "move_in",
    "area",
    "household",
    "contract",
    "parking",
    "smoking",
    "pets",
    "shelter",
    "lifestyle",
]


class MatchOut(BaseModel):
    """`score` 0-100 (59 at most when a hard filter fails), up to 3 agreeing criteria and the one
    that differs most (a failing one first), or `None` when every criterion fully matches."""

    score: int
    agrees: list[Criterion]
    differs: Criterion | None
