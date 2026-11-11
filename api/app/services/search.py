"""Public search and the public listing page (spec 0003a).

"Public" has one definition, `_public_listings()`: a live (active, not yet lapsed) **apartment**
in an **active** launch area. Rooms stay hidden until Slice 7 adds the gender
preference (PRODUCT.md "Gender preference — hard filter on ROOM listings"); listings outside an
active area are hidden (PRODUCT.md "Launch area"). Both public functions below build on it and
no other code here states any part of it, so search and the listing page can never disagree.

The optional map box (spec 0003c) filters on the listing's **approximate** point, the same point the
response's `lat` / `lng` show, so it reveals nothing the response does not.

The caller's match (spec 0006b): given the id of a seeker who has a profile, the page statement
joins that one profile row and adds `matching.score.match_columns`, so the score is computed,
ordered on and explained in the same statement; it never filters and never changes the count.
Nothing else here depends on the caller, and a non-public listing is indistinguishable from an
unknown id (`ListingNotFoundError`, a 404)."""

import typing
import uuid
from collections.abc import Mapping
from typing import Any

from sqlalchemy import Integer, Label, Row, Select, and_, cast, func, or_, select
from sqlalchemy.orm import Session, undefer

from app.matching.score import explain, match_columns
from app.models import Area, Listing, SeekerProfile
from app.models.listing import PLAIN_GEOMETRY
from app.schemas.match import MatchOut
from app.schemas.search import SearchParams, SearchSort
from app.services.listings import ListingNotFoundError

# A flexible-entry listing ("גמיש ±2 שבועות") counts as available this many days earlier.
FLEXIBLE_ENTRY_DAYS = 14


def _public_listings() -> Select[tuple[Listing]]:
    """Every listing the public may see. The only statement of the visibility rule. Loads the
    approximate point (`lat` / `lng`) in the same statement."""
    return (
        select(Listing)
        .options(undefer(Listing.lat), undefer(Listing.lng))
        .join(Area, Area.id == Listing.area_id)
        .where(
            Listing.status == "active",
            Listing.expires_at > func.now(),
            Listing.listing_type == "apartment",
            Area.is_active.is_(True),
        )
    )


def _filtered(params: SearchParams) -> Select[tuple[Listing]]:
    query = _public_listings()
    if params.price_min is not None:
        query = query.where(Listing.price_ils >= params.price_min)
    if params.price_max is not None:
        query = query.where(Listing.price_ils <= params.price_max)
    if params.rooms_min is not None:
        query = query.where(Listing.rooms >= params.rooms_min)
    if params.rooms_max is not None:
        query = query.where(Listing.rooms <= params.rooms_max)
    if params.available_by is not None:
        # `date - integer` in SQL, never `available_by + 14` in Python (9999-12-31 would overflow).
        flexible_from = Listing.available_from - cast(FLEXIBLE_ENTRY_DAYS, Integer)
        query = query.where(
            or_(
                Listing.available_from <= params.available_by,
                and_(Listing.entry_flexible.is_(True), flexible_from <= params.available_by),
            )
        )
    if params.pets:
        query = query.where(Listing.pets_allowed.is_(True))
    if params.furnished:
        query = query.where(Listing.furnished.in_(("partial", "full")))
    if params.elevator:
        query = query.where(Listing.elevator.is_(True))
    if params.parking:
        query = query.where(Listing.parking_spots >= 1)
    if params.bbox is not None:
        # On the approximate point, the one the response shows; a NULL location never matches.
        # Planar: a lng/lat rectangle on the point's `::geometry` cast (the `ix_listings_location`
        # expression), exact for any valid box. On `geography` the box's edges would be great-circle
        # arcs: wrong for wide boxes, and an error for a 180-degree-wide one.
        west, south, east, north = params.bbox
        envelope = func.ST_MakeEnvelope(west, south, east, north, 4326)
        query = query.where(func.ST_Intersects(cast(Listing.location, PLAIN_GEOMETRY), envelope))
    return query


def _effective_sort(requested: SearchSort | None, with_profile: bool) -> SearchSort:
    """`requested`, else `match` with a profile and `newest` without; `match` without a profile is
    `newest` (a shared `?sort=match` link still works for a visitor)."""
    if requested is None:
        return "match" if with_profile else "newest"
    if requested == "match" and not with_profile:
        return "newest"
    return requested


def _order(sort: SearchSort, score: Label[Any] | None) -> tuple[Any, ...]:
    """Deterministic for paging: every sort ends on `created_at DESC, id`. `match` needs the
    statement's `m_score` column (`score`)."""
    newest = (Listing.created_at.desc(), Listing.id)
    if sort == "price_asc":
        return (Listing.price_ils.asc(), *newest)
    if sort == "price_desc":
        return (Listing.price_ils.desc(), *newest)
    if sort == "match" and score is not None:
        return (score.desc(), *newest)
    return newest


def _with_match(
    query: Select[tuple[Listing]], profile_user_id: uuid.UUID
) -> tuple[Select[Any], Label[Any]]:
    """`query` joined to the seeker's one profile row, with the match columns added; and the
    `m_score` column."""
    columns = match_columns(Listing, SeekerProfile)
    matched = query.join(SeekerProfile, SeekerProfile.user_id == profile_user_id).add_columns(
        *columns
    )
    score = next(column for column in columns if column.name == "m_score")
    return matched, score


def _explain(row: Row[Any]) -> MatchOut:
    """`explain` on one page row's columns (`row._mapping`, keyed by the match columns' labels)."""
    return explain(typing.cast(Mapping[str, Any], row._mapping))


def search_listings(
    db: Session, params: SearchParams, profile_user_id: uuid.UUID | None = None
) -> tuple[list[tuple[Listing, MatchOut | None]], int, SearchSort]:
    """One page of public listings matching `params` with each one's match (`None` without a
    `profile_user_id`), the total matching (ignoring `limit` / `offset`, and never the score), and
    the sort applied. Exactly two statements: the count, then the page."""
    filtered = _filtered(params)
    sort = _effective_sort(params.sort, profile_user_id is not None)
    # Count over a subquery of the whole filtered select, so the join to `areas` is kept.
    total = db.execute(
        select(func.count()).select_from(filtered.order_by(None).subquery())
    ).scalar_one()
    if profile_user_id is None:
        listings = db.scalars(
            filtered.order_by(*_order(sort, None)).limit(params.limit).offset(params.offset)
        ).all()
        return [(listing, None) for listing in listings], total, sort
    matched, score = _with_match(filtered, profile_user_id)
    rows = db.execute(
        matched.order_by(*_order(sort, score)).limit(params.limit).offset(params.offset)
    ).all()
    return [(row[0], _explain(row)) for row in rows], total, sort


def get_public_listing_with_match(
    db: Session, listing_id: uuid.UUID, profile_user_id: uuid.UUID | None
) -> tuple[Listing, MatchOut | None]:
    """The listing if it is public, with the seeker's match when `profile_user_id` is given. Raises
    `ListingNotFoundError` for an unknown id and for a paused, expired, room or inactive-area
    listing alike. One statement."""
    query = _public_listings().where(Listing.id == listing_id)
    if profile_user_id is None:
        listing = db.scalar(query)
        if listing is None:
            raise ListingNotFoundError
        return listing, None
    matched, _ = _with_match(query, profile_user_id)
    row = db.execute(matched).first()
    if row is None:
        raise ListingNotFoundError
    return row[0], _explain(row)


def get_public_listing(db: Session, listing_id: uuid.UUID) -> Listing:
    """The listing if it is public, without a match (the apply gate). Raises
    `ListingNotFoundError` as `get_public_listing_with_match`."""
    return get_public_listing_with_match(db, listing_id, None)[0]
