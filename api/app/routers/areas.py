"""GET /areas — public. Every active area (settlements and neighbourhoods) without geometry."""

from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.db import get_session
from app.schemas.area import AreaOut
from app.schemas.error import ErrorOut
from app.services.areas import list_active_areas

router = APIRouter(tags=["areas"])


@router.get(
    "/areas",
    response_model=list[AreaOut],
    responses={503: {"model": ErrorOut, "description": "The database is unreachable"}},
)
def get_areas(
    session: Annotated[Session, Depends(get_session)], response: Response
) -> list[AreaOut]:
    response.headers["Cache-Control"] = "public, max-age=86400"
    return [
        AreaOut(
            id=row.id,
            slug=row.slug,
            name_he=row.name_he,
            kind=row.kind,
            parent_id=row.parent_id,
            centre=[round(row.lng, 5), round(row.lat, 5)],
        )
        for row in list_active_areas(session)
    ]
