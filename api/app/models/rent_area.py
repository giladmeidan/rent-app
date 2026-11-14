"""`rent_areas` table (spec 0014a): one row per settlement and per neighbourhood of
nadlan.gov.il's public rent files. Every constraint matches migration 0019 exactly (autogenerate
must see no diff)."""

import datetime as dt
import uuid
from typing import Any

from geoalchemy2 import Geometry
from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base


class RentArea(Base):
    __tablename__ = "rent_areas"
    __table_args__ = (
        UniqueConstraint("kind", "source_id", name="uq_rent_areas_kind_source"),
        CheckConstraint("kind IN ('settlement', 'neighbourhood')", name="ck_rent_areas_kind"),
        CheckConstraint("char_length(name_he) BETWEEN 1 AND 80", name="ck_rent_areas_name_length"),
        Index("ix_rent_areas_settlement_code", "settlement_code"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    # The source's settlement code or neighbourhood id; a neighbourhood's parent is
    # `settlement_code`.
    source_id: Mapped[int] = mapped_column(Integer, nullable=False)
    settlement_code: Mapped[int] = mapped_column(Integer, nullable=False)
    name_he: Mapped[str] = mapped_column(Text, nullable=False)
    # No spatial index: about 350 rows (and geoalchemy2 would expect `idx_rent_areas_centre`).
    centre: Mapped[Any] = mapped_column(
        Geometry(geometry_type="POINT", srid=4326, spatial_index=False), nullable=False
    )
    streets: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default=text("'{}'")
    )
    source_version: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
