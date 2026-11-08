"""API schemas for areas. Never the ORM model; `geom` is deliberately not exposed here."""

import uuid

from pydantic import BaseModel, ConfigDict


class AreaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    slug: str
    name_he: str
