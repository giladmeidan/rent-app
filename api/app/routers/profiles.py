"""Seeker profile endpoints (spec 0006a). Thin: all logic is in `services/profiles.py`.

Both require a session of any role (`current_user`, spec 0010b: "a person looking" is this profile,
open to every account): 401 `unauthenticated` without one. Neither takes a user id: an account
reads and writes only its own profile (NF2)."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import limits
from app.auth import current_user
from app.db import get_session
from app.models import User
from app.redis_client import RedisClient, get_redis
from app.schemas.error import ErrorOut
from app.schemas.profile import SeekerProfileIn, SeekerProfileOut
from app.services import profiles as profiles_service
from app.services.listings import UnknownAreaError

router = APIRouter(tags=["profiles"])

DbDep = Annotated[Session, Depends(get_session)]
UserDep = Annotated[User, Depends(current_user)]
RedisDep = Annotated[RedisClient, Depends(get_redis)]

_SESSION: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorOut, "description": "unauthenticated"},
    503: {"model": ErrorOut, "description": "The database is unreachable"},
}


@router.get(
    "/me/profile",
    response_model=SeekerProfileOut,
    responses={
        **_SESSION,
        404: {"model": ErrorOut, "description": "seeker_profile_not_found: no profile yet"},
    },
)
def get_profile(user: UserDep, db: DbDep) -> SeekerProfileOut:
    profile = profiles_service.get_profile(db, user.id)
    if profile is None:
        raise HTTPException(status_code=404, detail="seeker_profile_not_found")
    return SeekerProfileOut.model_validate(profile)


@router.put(
    "/me/profile",
    response_model=SeekerProfileOut,
    responses={
        **_SESSION,
        422: {"description": "unknown_area, or a malformed body (list `detail`)"},
        **limits.RATE_LIMITED,
    },
)
def put_profile(body: SeekerProfileIn, user: UserDep, db: DbDep, r: RedisDep) -> SeekerProfileOut:
    limits.check(r, user.id, limits.WRITE)
    try:
        profile = profiles_service.put_profile(db, user, body)
    except UnknownAreaError:
        raise HTTPException(status_code=422, detail="unknown_area") from None
    return SeekerProfileOut.model_validate(profile)
