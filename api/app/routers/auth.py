"""Email-OTP auth endpoints (spec 0001a). Thin: all logic is in `services/auth.py`.

POST /auth/otp/request, POST /auth/otp/verify and POST /auth/logout are public; GET /me requires a
session (`current_user`)."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.auth import COOKIE_NAME, current_user
from app.config import get_settings
from app.db import get_session
from app.models import User
from app.redis_client import RedisClient, get_redis
from app.schemas.auth import OtpRequestIn, OtpVerifyIn, UserOut
from app.schemas.error import ErrorOut
from app.services import auth as auth_service
from app.services.email import EmailSender, EmailUnavailable, get_email_sender
from app.services.rate_limit import RateLimitedError

router = APIRouter(tags=["auth"])

RedisDep = Annotated[RedisClient, Depends(get_redis)]
DbDep = Annotated[Session, Depends(get_session)]


@router.post(
    "/auth/otp/request",
    status_code=204,
    responses={
        429: {"model": ErrorOut, "description": "Too many codes requested; see Retry-After"},
        503: {"model": ErrorOut, "description": "email_unavailable, or Redis is unreachable"},
    },
)
def request_otp(
    body: OtpRequestIn,
    request: Request,
    r: RedisDep,
    sender: Annotated[EmailSender, Depends(get_email_sender)],
) -> Response:
    ip = request.client.host if request.client else "unknown"
    try:
        auth_service.request_otp(r, sender, body.email, ip)
    except RateLimitedError as exc:
        raise HTTPException(
            status_code=429, detail="rate_limited", headers={"Retry-After": str(exc.retry_after)}
        ) from None
    except EmailUnavailable:
        raise HTTPException(status_code=503, detail="email_unavailable") from None
    return Response(status_code=204)


@router.post(
    "/auth/otp/verify",
    response_model=UserOut,
    responses={
        201: {"model": UserOut, "description": "Account created and logged in"},
        401: {"model": ErrorOut, "description": "invalid_code"},
        422: {"description": "profile_required, or a malformed body"},
        503: {"model": ErrorOut, "description": "Redis or the database is unreachable"},
    },
)
def verify_otp(body: OtpVerifyIn, db: DbDep, r: RedisDep) -> JSONResponse:
    try:
        user, created = auth_service.verify_otp(db, r, body.email, body.code, body.profile)
    except auth_service.InvalidCodeError:
        raise HTTPException(status_code=401, detail="invalid_code") from None
    except auth_service.ProfileRequiredError:
        raise HTTPException(status_code=422, detail="profile_required") from None
    token = auth_service.create_session(db, user)
    response = JSONResponse(
        status_code=201 if created else 200,
        content=UserOut.model_validate(user).model_dump(mode="json"),
    )
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=auth_service.SESSION_TTL_S,
        path="/",
        httponly=True,
        samesite="lax",
        secure=get_settings().cookie_secure,
    )
    return response


@router.get(
    "/me",
    response_model=UserOut,
    responses={401: {"model": ErrorOut, "description": "unauthenticated"}},
)
def me(user: Annotated[User, Depends(current_user)]) -> UserOut:
    return UserOut.model_validate(user)


@router.post("/auth/logout", status_code=204)
def logout(request: Request, db: DbDep) -> Response:
    token = request.cookies.get(COOKIE_NAME)
    if token:
        auth_service.revoke_session(db, token)
    response = Response(status_code=204)
    # Same attributes as the cookie set at verify, so the browser replaces that exact cookie.
    response.delete_cookie(
        COOKIE_NAME, path="/", httponly=True, samesite="lax", secure=get_settings().cookie_secure
    )
    return response
