"""The room fit (spec 0007b; PRODUCT.md "Rooms"): whether a room's gender preference fits a seeker.

Written once, as SQL (`room_fit`). Search, the map box and the count filter on
`room_fit(...).is_not(False)`, the listing page reports it, and the apply gate refuses on `False`;
none of them restates any part of it.

A room fits unless it is for women and the seeker is not a woman, it is for men and the seeker is
not a man, or it contradicts the seeker's flatmates preference (a men-only room for "women", a
women-only room for "men"). An `'any'` room always fits.

The person fit (spec 0010h; PRODUCT.md "שוק השותפים", decision 7): whether two people may see each
other in people browse, the gender rule both ways, written once as SQL (`person_fit`)."""

from sqlalchemy import ColumnElement, Text, and_, case, literal, not_, or_
from sqlalchemy.orm.util import AliasedClass

from app.models import Listing, SeekerProfile


def room_fit(
    listing: type[Listing] | AliasedClass[Listing],
    profile: type[SeekerProfile] | AliasedClass[SeekerProfile],
) -> ColumnElement[bool | None]:
    """`true` / `false` for a room and a profile with a room section (`gender` set); NULL for an
    apartment, for a profile without a room section and, under an outer join, for no profile row.
    Inside the WHEN every operand is NOT NULL (`gender` is set, so the row exists;
    `flatmate_gender` and `gender_preference` are NOT NULL columns), so it is never NULL there.
    Either argument may be an alias, as for `match_columns`."""
    misfit = or_(
        and_(listing.gender_preference == "women", profile.gender != "woman"),
        and_(listing.gender_preference == "men", profile.gender != "man"),
        and_(profile.flatmate_gender == "women", listing.gender_preference == "men"),
        and_(profile.flatmate_gender == "men", listing.gender_preference == "women"),
    )
    return case(
        (and_(listing.listing_type == "room", profile.gender.is_not(None)), not_(misfit)),
    )


def person_fit(
    viewer_gender: str | None,
    viewer_pref: str,
    other: type[SeekerProfile] | AliasedClass[SeekerProfile],
) -> ColumnElement[bool]:
    """Whether the viewer (their `gender` and flatmates preference, bound as values) and the person
    `other` (a profile, or an alias of one) may see each other. Both directions count:

    - the person wants women flatmates and the viewer is not a woman, or wants men and the viewer
      is not a man: hidden (a viewer with no gender is neither);
    - the viewer wants women flatmates and the person is not a woman, or wants men and the person
      is not a man: hidden;
    - otherwise they fit. Two `'any'` people always fit.

    A viewer with no profile (or no personal part) passes `None` and `'any'`, so they see only
    people whose preference is `'any'`. `other.gender` is NOT NULL on a visible card (spec 0010c),
    and the viewer's side uses IS DISTINCT FROM, so the result is never NULL there."""
    gender = literal(viewer_gender, Text)
    pref = literal(viewer_pref, Text)
    misfit = or_(
        and_(other.flatmate_gender == "women", gender.is_distinct_from("woman")),
        and_(other.flatmate_gender == "men", gender.is_distinct_from("man")),
        and_(pref == "women", other.gender != "woman"),
        and_(pref == "men", other.gender != "man"),
    )
    return not_(misfit)
