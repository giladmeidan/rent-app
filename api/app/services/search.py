"""Public search and the public listing page (spec 0003a).

"Public" has one definition, `_public_listings()`: a live (active, not yet lapsed) **apartment**
in an **active** launch area. Rooms stay hidden until Slice 7 adds the gender
preference (PRODUCT.md "Gender preference — hard filter on ROOM listings"); listings outside an
active area are hidden (PRODUCT.md "Launch area"). Both public functions below build on it and
no other code here states any part of it, so search and the listing page can never disagree.

The optional map box (spec 0003c) filters on the listing's **approximate** point, the same point the
response's `lat` / `lng` show, so it reveals nothing the response does not.

Nothing here reads the caller's session: a cookie changes nothing, and a non-public listing is
indistinguishable from an unknown id (`ListingNotFoundError`, a 404)."""

import uuid
from collections.abc import Sequence
from typing import Any

from sqlalchemy import Integer, Select, and_, cast, func, or_, select
from sqlalchemy.orm import Session, undefer

from app.models import Area, Listing
from app.models.listing import PLAIN_GEOMETRY
from app.schemas.search import SearchParams
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


def _order(params: SearchParams) -> tuple[Any, ...]:
    """Deterministic for paging: every sort ends on `created_at DESC, id`."""
    newest = (Listing.created_at.desc(), Listing.id)
    if params.sort == "price_asc":
        return (Listing.price_ils.asc(), *newest)
    if params.sort == "price_desc":
        return (Listing.price_ils.desc(), *newest)
    return newest


def search_listings(db: Session, params: SearchParams) -> tuple[Sequence[Listing], int]:
    """One page of public listings matching `params`, and the total matching (ignoring
    `limit` / `offset`). Exactly two statements: the count, then the page."""
    filtered = _filtered(params)
    # Count over a subquery of the whole filtered select, so the join to `areas` is kept.
    total = db.execute(
        select(func.count()).select_from(filtered.order_by(None).subquery())
    ).scalar_one()
    page = db.scalars(
        filtered.order_by(*_order(params)).limit(params.limit).offset(params.offset)
    ).all()
    return page, total


def get_public_listing(db: Session, listing_id: uuid.UUID) -> Listing:
    """The listing if it is public. Raises `ListingNotFoundError` for an unknown id and for a
    paused, expired, room or inactive-area listing alike."""
    listing = db.scalar(_public_listings().where(Listing.id == listing_id))
    if listing is None:
        raise ListingNotFoundError
    return listing
