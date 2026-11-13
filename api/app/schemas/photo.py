"""API schemas for photos (spec 0010d). Never the ORM model.

`PhotoOut` is a photo's two public addresses (`{PHOTO_PUBLIC_BASE_URL}/{key}-s.webp`, 480 px long
edge, and `-l.webp`, 1600 px) and its id (to delete or reorder it). The addresses are random and
never contain a user, listing or photo id (MARKET-PLAN Q16)."""

import uuid

from pydantic import BaseModel, ConfigDict, Field


class PhotoOut(BaseModel):
    id: uuid.UUID
    small_url: str
    large_url: str


class PhotoOrderIn(BaseModel):
    """The listing's photo ids in their new order (the first is the cover): exactly its photos,
    each once."""

    model_config = ConfigDict(extra="forbid")

    photo_ids: list[uuid.UUID] = Field(min_length=1, max_length=10)
