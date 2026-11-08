"""GET /areas — public. Active launch areas without geometry."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_session
from app.schemas.area import AreaOut
from app.services.areas import list_active_areas

router = APIRouter(tags=["areas"])


@router.get("/areas", response_model=list[AreaOut])
def get_areas(session: Annotated[Session, Depends(get_session)]) -> list[AreaOut]:
    return [AreaOut.model_validate(area) for area in list_active_areas(session)]
