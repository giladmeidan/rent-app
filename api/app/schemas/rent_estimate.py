"""`GET /rent-estimate` (spec 0014c): the official average rent for an apartment's facts."""

import datetime as dt
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.schemas.listing import City, Rooms, Street

RentEstimateReason = Literal["unknown_city", "rooms_not_covered", "no_figures", "too_uncertain"]


class RentEstimateParams(BaseModel):
    """The query: an apartment's facts, never a listing id. Unlike `SearchParams`, an unknown
    parameter is a 422."""

    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    city: City
    street: Street
    rooms: Rooms


class RentEstimateRange(BaseModel):
    low_ils: int
    high_ils: int
    confidence: Literal["high", "medium"]
    level: Literal["neighbourhood", "city"]
    area_name: str  # the rent_areas name_he of the level used
    figure_rooms: list[int]  # the room counts behind it: [3], [3, 4], [5]; [1, 2] for small flats
    quarters: int  # figures behind it (the smallest count over its room counts)
    latest_period: dt.date  # the newest period in rent_prices
    # 1-2 rooms (spec 0014d): the CBS ratio applied to the 3-room baseline, the city's or its
    # district's; None on every 2.5+ answer
    small_flat_ratio: Literal["city", "district"] | None


class RentEstimateOut(BaseModel):
    """Exactly one of `estimate` and `reason` is set."""

    estimate: RentEstimateRange | None
    reason: RentEstimateReason | None
