"""`GET /rent-estimate` (spec 0014c). Thin: all logic is in `services/rent_estimate.py`.

Signed in, any role (`current_user`): 401 `unauthenticated` without a session. The query is an
apartment's facts, never a listing id; an unknown parameter is a 422."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.auth import current_user
from app.db import get_session
from app.models import User
from app.schemas.error import ErrorOut
from app.schemas.rent_estimate import RentEstimateOut, RentEstimateParams
from app.services.rent_estimate import estimate_rent

router = APIRouter(tags=["rent-estimate"])


@router.get(
    "/rent-estimate",
    response_model=RentEstimateOut,
    responses={
        401: {"model": ErrorOut, "description": "unauthenticated"},
        503: {"model": ErrorOut, "description": "The database is unreachable"},
    },
)
def get_rent_estimate(
    params: Annotated[RentEstimateParams, Query()],
    _user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_session)],
) -> RentEstimateOut:
    return estimate_rent(db, city=params.city, street=params.street, rooms=params.rooms)
