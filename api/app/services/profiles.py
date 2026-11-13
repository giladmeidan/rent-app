"""Profiles (spec 0006a): one per account (0010b), read and replaced by that account only.

Privacy (NF2): a profile is personal data. This module returns it only to its own account
(`get_profile`, `put_profile`); `has_profile` answers only whether the looking part is filled (the
listing page in `routers/search.py`; the apply gate in `services/applications.py` asks the same
inline, 0008d). From 0006b / 0006c the matching queries read it too.

Two independent parts (spec 0010c): the looking part (the 7 housing fields, all or none) and the
personal part (spec 0007a's room section: `gender`, `birth_year`, `lifestyle`, `about_me`).
`put_profile` writes both on every `PUT` (omitting a part clears it). From 0007b the room fit rule
and the match score read the personal part, and from 0007c the owner inbox shows it on room
applications only.

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
    """Whether the account's profile has the looking part filled (spec 0010c: a NULL budget means
    it is empty; a personal-only profile counts as no profile for matching, search and the seeker
    rule). Reads nothing else of it. One statement."""
    return bool(
        db.scalar(
            select(
                exists().where(
                    SeekerProfile.user_id == user_id, SeekerProfile.budget_max_ils.is_not(None)
                )
            )
        )
    )


def profile_user_id(db: Session, user: User | None) -> uuid.UUID | None:
    """The caller's id when they have a profile with the looking part, whatever their role (spec
    0010b; one PK lookup), else None (a visitor runs no statement)."""
    if user is None:
        return None
    return user.id if has_profile(db, user.id) else None


def sees_room_privacy(user: User | None, profile_user_id: uuid.UUID | None) -> bool:
    """Whether the caller gets a room's flatmate ages and answers (decision 13, Gilad 2026-11-13):
    signed in with the seeker role, or with a profile with the looking part (`profile_user_id`,
    already read). No statement."""
    return user is not None and (user.role == "seeker" or profile_user_id is not None)


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
    and return it: both parts, so a part left out is cleared (spec 0010c). Raises
    `UnknownAreaError` (nothing written). Two statements: the area check (only when the looking
    part is sent), then one `INSERT ... ON CONFLICT (user_id) DO UPDATE ... RETURNING`, so two
    concurrent PUTs leave one row (the later one's values). Commits."""
    try:
        if data.area_ids is not None:
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
