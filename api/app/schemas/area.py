"""API schemas for areas. Never the ORM model; `geom` and `streets` are deliberately not exposed."""

import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict


class AreaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    slug: str
    name_he: str
    kind: Literal["settlement", "neighbourhood"]
    # A neighbourhood's settlement; null on a settlement.
    parent_id: uuid.UUID | None
    # `[lng, lat]`, WGS84, 5 decimals (about 1 m).
    centre: list[float]
