"""`areas` table: every CBS settlement and the neighbourhoods of the big cities (spec 0021a1), a
config table (`is_active`). Listings outside an active area are hidden everywhere. Every constraint
matches migration 0031 exactly (autogenerate must see no diff)."""

import datetime as dt
import uuid
from typing import Any

from geoalchemy2 import Geometry
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base


class Area(Base):
    __tablename__ = "areas"
    # The GiST index is created explicitly (spec: `ix_areas_geom`) instead of geoalchemy2's
    # auto-generated `idx_areas_geom`, hence `spatial_index=False` on the column.
    __table_args__ = (
        Index("ix_areas_geom", "geom", postgresql_using="gist"),
        Index("ix_areas_parent_id", "parent_id"),
        UniqueConstraint("kind", "source_code", name="uq_areas_kind_source"),
        CheckConstraint("kind IN ('settlement', 'neighbourhood')", name="ck_areas_kind"),
        CheckConstraint("(parent_id IS NULL) = (kind = 'settlement')", name="ck_areas_parent"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    slug: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    name_he: Mapped[str] = mapped_column(Text, nullable=False)
    geom: Mapped[Any] = mapped_column(
        Geometry(geometry_type="MULTIPOLYGON", srid=4326, spatial_index=False), nullable=False
    )
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("areas.id", ondelete="RESTRICT", name="fk_areas_parent_id"),
        nullable=True,
    )
    # The CBS settlement code, or nadlan's neighbourhood id.
    source_code: Mapped[int] = mapped_column(Integer, nullable=False)
    centre: Mapped[Any] = mapped_column(
        Geometry(geometry_type="POINT", srid=4326, spatial_index=False), nullable=False
    )
    # A neighbourhood's street names as nadlan spells them; empty on a settlement.
    streets: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default=text("'{}'")
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
