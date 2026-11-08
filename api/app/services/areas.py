"""Area queries."""

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Area


def list_active_areas(session: Session) -> Sequence[Area]:
    """Active areas ordered by Hebrew display name."""
    stmt = select(Area).where(Area.is_active.is_(True)).order_by(Area.name_he)
    return session.scalars(stmt).all()
