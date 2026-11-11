"""Seeker housing profiles (spec 0006a): one per seeker, read and replaced by that seeker only.

Privacy (NF2): a profile is personal data. This module returns it only to its own seeker
(`get_profile`, `put_profile`); `has_profile` answers existence only (the apply gate in
`services/applications.py`). From 0006b / 0006c the matching queries read it too.

`area_ids` has no FK (an array cannot carry one): `put_profile` checks every id is an active area
in one statement and refuses the whole profile otherwise (`UnknownAreaError`, as listings do)."""

import uuid

from sqlalchemy import any_, exists, func, literal, select
from sqlalchemy.dialects.postgresql import ARRAY, UUID, insert
from sqlalchemy.orm import Session

from app.models import Area, SeekerProfile, User
from app.schemas.profile import SeekerProfileIn
from app.services.listings import UnknownAreaError


def get_profile(db: Session, user_id: uuid.UUID) -> SeekerProfile | None:
    """The seeker's profile, or None before their first `PUT`. One statement."""
    profile: SeekerProfile | None = db.scalar(
        select(SeekerProfile).where(SeekerProfile.user_id == user_id)
    )
    return profile


def has_profile(db: Session, user_id: uuid.UUID) -> bool:
    """Whether the seeker has a profile; reads nothing of it. One statement."""
    return bool(db.scalar(select(exists().where(SeekerProfile.user_id == user_id))))


def _check_areas(db: Session, area_ids: list[uuid.UUID]) -> None:
    """Every id (already distinct, `SeekerProfileIn`) is an active area, or `UnknownAreaError`."""
    ids = literal(area_ids, ARRAY(UUID(as_uuid=True)))
    active = db.scalar(
        select(func.count()).select_from(Area).where(Area.id == any_(ids), Area.is_active.is_(True))
    )
    if (active or 0) < len(area_ids):
        raise UnknownAreaError


def put_profile(db: Session, seeker: User, data: SeekerProfileIn) -> SeekerProfile:
    """Create or replace `seeker`'s profile with `data` (already validated by `SeekerProfileIn`)
    and return it. Raises `UnknownAreaError` (nothing written). Two statements: the area check,
    then one `INSERT ... ON CONFLICT (user_id) DO UPDATE ... RETURNING`, so two concurrent PUTs
    leave one row (the later one's values). Commits."""
    try:
        _check_areas(db, data.area_ids)
        values = data.model_dump()
        stmt = insert(SeekerProfile).values(user_id=seeker.id, **values)
        stmt = stmt.on_conflict_do_update(
            index_elements=[SeekerProfile.user_id],
            set_={**{name: stmt.excluded[name] for name in values}, "updated_at": func.now()},
        )
        profile = db.scalars(
            stmt.returning(SeekerProfile), execution_options={"populate_existing": True}
        ).one()
        db.commit()
    except Exception:
        db.rollback()
        raise
    return profile
