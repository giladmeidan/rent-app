"""`cbs_rent_prices` table (spec 0014d): the CBS average rent for 1-2 and 2.5-3 rooms per city or
residential district and quarter. `period` is the first day of the quarter's last month,
`bulletin` the first day of the bulletin's month. Every constraint matches migration 0021
exactly."""

import datetime as dt
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, DateTime, Integer, Numeric, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base


class CbsRentPrice(Base):
    __tablename__ = "cbs_rent_prices"
    __table_args__ = (
        CheckConstraint(
            "EXTRACT(DAY FROM period) = 1 AND EXTRACT(MONTH FROM period) IN (3, 6, 9, 12)",
            name="ck_cbs_rent_period",
        ),
        CheckConstraint("price_ils BETWEEN 500 AND 100000", name="ck_cbs_rent_price_ils"),
        CheckConstraint("geo_kind IN ('city', 'district')", name="ck_cbs_rent_geo_kind"),
        CheckConstraint("room_group IN ('1-2', '2.5-3')", name="ck_cbs_rent_room_group"),
        CheckConstraint("EXTRACT(DAY FROM bulletin) = 1", name="ck_cbs_rent_bulletin"),
    )

    geo_kind: Mapped[str] = mapped_column(Text, primary_key=True)
    geo_code: Mapped[int] = mapped_column(Integer, primary_key=True)
    room_group: Mapped[str] = mapped_column(Text, primary_key=True)
    period: Mapped[dt.date] = mapped_column(Date, primary_key=True)
    price_ils: Mapped[Decimal] = mapped_column(Numeric(8, 1), nullable=False)
    sampling_error: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    bulletin: Mapped[dt.date] = mapped_column(Date, nullable=False)
    imported_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
