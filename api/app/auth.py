"""FastAPI dependencies for the current user (spec 0001a). Cookie `rent_session`.

There is no role dependency (spec 0010b): inside the market any account acts, and the role is read
only where apartments need it (`POST /listings` and `services/applications.py::apply`)."""

from typing import Annotated

from fastapi import Cookie, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import User
from app.services.auth import resolve_session

COOKIE_NAME = "rent_session"


def optional_user(
    db: Annotated[Session, Depends(get_session)],
    token: Annotated[str | None, Cookie(alias=COOKIE_NAME)] = None,
) -> User | None:
    """The logged-in user, or None when the cookie is missing, unknown, expired or revoked."""
    return resolve_session(db, token) if token else None


def current_user(user: Annotated[User | None, Depends(optional_user)]) -> User:
    """The logged-in user; 401 `unauthenticated` otherwise."""
    if user is None:
        raise HTTPException(status_code=401, detail="unauthenticated")
    return user
