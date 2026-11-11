"""Seeker profile endpoints (spec 0006a). Thin: all logic is in `services/profiles.py`.

Both require a **seeker** session (`current_seeker`): 401 `unauthenticated` without one, 403
`seeker_only` for an owner. Neither takes a user id: a seeker reads and writes only their own
profile (NF2)."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import current_seeker
from app.db import get_session
from app.models import User
from app.schemas.error import ErrorOut
from app.schemas.profile import SeekerProfileIn, SeekerProfileOut
from app.services import profiles as profiles_service
from app.services.listings import UnknownAreaError

router = APIRouter(tags=["profiles"])

DbDep = Annotated[Session, Depends(get_session)]
SeekerDep = Annotated[User, Depends(current_seeker)]

_SEEKER_ONLY: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorOut, "description": "unauthenticated"},
    403: {"model": ErrorOut, "description": "seeker_only: the caller is an owner"},
    503: {"model": ErrorOut, "description": "The database is unreachable"},
}


@router.get(
    "/me/profile",
    response_model=SeekerProfileOut,
    responses={
        **_SEEKER_ONLY,
        404: {"model": ErrorOut, "description": "seeker_profile_not_found: no profile yet"},
    },
)
def get_profile(seeker: SeekerDep, db: DbDep) -> SeekerProfileOut:
    profile = profiles_service.get_profile(db, seeker.id)
    if profile is None:
        raise HTTPException(status_code=404, detail="seeker_profile_not_found")
    return SeekerProfileOut.model_validate(profile)


@router.put(
    "/me/profile",
    response_model=SeekerProfileOut,
    responses={
        **_SEEKER_ONLY,
        422: {"description": "unknown_area, or a malformed body (list `detail`)"},
    },
)
def put_profile(body: SeekerProfileIn, seeker: SeekerDep, db: DbDep) -> SeekerProfileOut:
    try:
        profile = profiles_service.put_profile(db, seeker, body)
    except UnknownAreaError:
        raise HTTPException(status_code=422, detail="unknown_area") from None
    return SeekerProfileOut.model_validate(profile)
