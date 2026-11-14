"""`rent_prices` table (spec 0014a): one row per rent area, room count and quarter with a figure.
`rooms` 0 = all sizes; `period` is the first day of the quarter's last month. Every constraint
matches migration 0019 exactly."""

import datetime as dt
import uuid

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Integer, SmallInteger, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base


class RentPrice(Base):
    __tablename__ = "rent_prices"
    __table_args__ = (
        CheckConstraint("rooms IN (0, 3, 4, 5)", name="ck_rent_prices_rooms"),
        CheckConstraint(
            "EXTRACT(DAY FROM period) = 1 AND EXTRACT(MONTH FROM period) IN (3, 6, 9, 12)",
            name="ck_rent_prices_period",
        ),
        CheckConstraint("price_ils BETWEEN 500 AND 100000", name="ck_rent_prices_price_ils"),
    )

    area_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("rent_areas.id", ondelete="CASCADE"),
        primary_key=True,
    )
    rooms: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    period: Mapped[dt.date] = mapped_column(Date, primary_key=True)
    price_ils: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
