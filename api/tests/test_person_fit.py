"""The person fit (spec 0010h AC2): `matching.fit.person_fit`'s SQL against the table of nine
viewers (woman / man / other, each wanting any / women / men flatmates) plus the viewer with no
profile, and nine people (the same nine). `_expected` states the rule in words, apart from the
SQL; `/people` applying it is `test_market_people.py::test_ac2_browse_applies_gender_rule`."""

import itertools
import uuid

from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, aliased

from app.matching.fit import person_fit
from app.models import SeekerProfile
from tests.conftest import make_profile, make_seeker

GENDERS = ("woman", "man", "other")
PREFS = ("any", "women", "men")
WANTED = {"women": "woman", "men": "man"}
NINE = list(itertools.product(GENDERS, PREFS))
# The viewer with no profile (or no personal part) passes `None` and `'any'`.
VIEWERS: list[tuple[str | None, str]] = [*NINE, (None, "any")]


def _expected(viewer: tuple[str | None, str], person: tuple[str | None, str]) -> bool:
    """Each side's preference, when not `any`, must name the other's gender."""
    (viewer_gender, viewer_pref), (person_gender, person_pref) = viewer, person
    person_ok = person_pref == "any" or viewer_gender == WANTED[person_pref]
    viewer_ok = viewer_pref == "any" or person_gender == WANTED[viewer_pref]
    return person_ok and viewer_ok


def test_ac2_two_way_matrix(db_engine: Engine, gush_dan: uuid.UUID) -> None:
    people: dict[uuid.UUID, tuple[str, str]] = {}
    for n, (gender, pref) in enumerate(NINE):
        user_id = make_seeker(db_engine, f"p{n}@example.com", f"P{n}")
        make_profile(db_engine, user_id, gush_dan, gender=gender, flatmate_gender=pref)
        people[user_id] = (gender, pref)

    # The bullets of AC2, spelled out before the whole table.
    assert not _expected(("woman", "women"), ("man", "any"))  # a man is hidden from her
    assert not _expected(("man", "any"), ("woman", "women"))  # and she is hidden from him
    assert not _expected(("man", "any"), ("other", "women"))  # wants women: hidden from a man
    assert not _expected(("other", "any"), ("man", "women"))  # and from "other"
    assert all(_expected((g, "any"), (h, "any")) for g in GENDERS for h in GENDERS)
    assert [p for p in NINE if _expected((None, "any"), p)] == [(g, "any") for g in GENDERS]

    other = aliased(SeekerProfile, name="other")
    with Session(db_engine) as db:
        for viewer in VIEWERS:
            want = {user_id for user_id, person in people.items() if _expected(viewer, person)}
            for profile in (SeekerProfile, other):
                rows = db.execute(
                    select(profile.user_id, person_fit(*viewer, profile).label("fit"))
                ).all()
                assert len(rows) == len(people)
                assert all(row.fit is not None for row in rows), viewer  # never NULL
                assert {row.user_id for row in rows if row.fit} == want, viewer
            # Symmetric: whenever both are real people, the rule reads the same from either side.
            if viewer[0] is not None:
                for person in NINE:
                    assert _expected(viewer, person) == _expected(person, viewer)
