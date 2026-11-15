"""Email-OTP auth endpoints (spec 0001a). Thin: all logic is in `services/auth.py`.

POST /auth/otp/request, POST /auth/otp/verify and POST /auth/logout are public; GET /me requires a
session (`current_user`). `UserOut` is always built by `user_out` (also `PUT /me/photo`'s, spec
0010j). A suspended account (spec 0012a): the right code answers 403 `account_suspended` with no
session, and its sessions no longer resolve. DELETE /me (spec 0013c) deletes the caller's account,
from a session signed in within `DELETE_REAUTH_S`; a blocked email's right code answers 403
`signup_blocked` with no session."""

import datetime as dt
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
from app.services import accounts
from app.services import auth as auth_service
from app.services.email import EmailSender, EmailUnavailable, get_email_sender
from app.services.photo_store import PhotoStore, get_photo_store
from app.services.photos import person_photo_url
from app.services.rate_limit import RateLimitedError

router = APIRouter(tags=["auth"])

RedisDep = Annotated[RedisClient, Depends(get_redis)]
DbDep = Annotated[Session, Depends(get_session)]

# DELETE /me needs a session younger than this (spec 0013c): deletion is final, so the mailbox is
# asked again, and an old session left open elsewhere cannot delete the account.
DELETE_REAUTH_S = 900


def user_out(user: User) -> UserOut:
    """The caller's own account, with their person photo's small address (spec 0010j)."""
    # Always a live account: a deleted one's sessions never resolve (spec 0013c).
    assert user.email is not None and user.display_name is not None
    return UserOut(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        role=user.role,
        account_type=user.account_type,
        created_at=user.created_at,
        photo_url=person_photo_url(user.photo_key),
        listing_cap=user.listing_cap,
    )


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
        403: {
            "model": ErrorOut,
            "description": "account_suspended, or signup_blocked (0013c); the code is consumed",
        },
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
    except auth_service.AccountSuspendedError:
        raise HTTPException(status_code=403, detail="account_suspended") from None
    except auth_service.SignupBlockedError:
        raise HTTPException(status_code=403, detail="signup_blocked") from None
    token = auth_service.create_session(db, user)
    response = JSONResponse(
        status_code=201 if created else 200,
        content=user_out(user).model_dump(mode="json"),
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
    return user_out(user)


def _signed_out() -> Response:
    """A 204 that clears the session cookie (logout, DELETE /me)."""
    response = Response(status_code=204)
    # Same attributes as the cookie set at verify, so the browser replaces that exact cookie.
    response.delete_cookie(
        COOKIE_NAME, path="/", httponly=True, samesite="lax", secure=get_settings().cookie_secure
    )
    return response


@router.post("/auth/logout", status_code=204)
def logout(request: Request, db: DbDep) -> Response:
    token = request.cookies.get(COOKIE_NAME)
    if token:
        auth_service.revoke_session(db, token)
    return _signed_out()


@router.delete(
    "/me",
    status_code=204,
    responses={
        401: {"model": ErrorOut, "description": "unauthenticated"},
        403: {
            "model": ErrorOut,
            "description": "reauth_required: the session is older than 15 minutes; sign in again",
        },
        503: {"model": ErrorOut, "description": "The database or Redis is unreachable"},
    },
)
def delete_me(
    request: Request,
    user: Annotated[User, Depends(current_user)],
    db: DbDep,
    store: Annotated[PhotoStore, Depends(get_photo_store)],
) -> Response:
    """Delete the caller's account for good and sign out every device (spec 0013c)."""
    token = request.cookies[COOKIE_NAME]  # `current_user` resolved it
    created_at = auth_service.session_created_at(db, token)
    if created_at is None or dt.datetime.now(dt.UTC) - created_at > dt.timedelta(
        seconds=DELETE_REAUTH_S
    ):
        raise HTTPException(status_code=403, detail="reauth_required")
    accounts.delete_account(db, store, user)
    return _signed_out()
