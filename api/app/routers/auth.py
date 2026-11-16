"""Email-OTP auth endpoints (spec 0001a). Thin: all logic is in `services/auth.py`.

POST /auth/otp/request, POST /auth/otp/verify and POST /auth/logout are public; GET /me requires a
session (`current_user`). `UserOut` is always built by `user_out` (also `PUT /me/photo`'s, spec
0010j). A suspended account (spec 0012a): the right code answers 403 `account_suspended` with no
session, and its sessions no longer resolve. DELETE /me (spec 0013c) deletes the caller's account,
from a session signed in within `DELETE_REAUTH_S`; a blocked email's right code answers 403
`signup_blocked` with no session. Spec 0016a: POST /auth/password/login (public, its own per-network
limits) and PUT /me/password (a session younger than `DELETE_REAUTH_S`). Spec 0016b: POST
/auth/google (public, its own per-network limits) signs in or up with a Google ID token."""

import datetime as dt
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app import limits
from app.auth import COOKIE_NAME, current_user
from app.client_ip import client_network
from app.config import get_settings
from app.db import get_session
from app.models import User
from app.redis_client import RedisClient, get_redis
from app.schemas.auth import (
    GoogleLoginIn,
    OtpRequestIn,
    OtpVerifyIn,
    PasswordIn,
    PasswordLoginIn,
    UserOut,
)
from app.schemas.error import ErrorOut
from app.services import accounts, google
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


def user_out(db: Session, user: User) -> UserOut:
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
        has_password=auth_service.has_password(db, user.id),
    )


def _rate_limited(exc: RateLimitedError) -> HTTPException:
    return HTTPException(
        status_code=429, detail="rate_limited", headers={"Retry-After": str(exc.retry_after)}
    )


def _signed_in(db: Session, user: User, status_code: int) -> JSONResponse:
    """`UserOut` with a new session cookie (code, password and Google login)."""
    token = auth_service.create_session(db, user)
    response = JSONResponse(
        status_code=status_code, content=user_out(db, user).model_dump(mode="json")
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
    try:
        auth_service.request_otp(r, sender, body.email, client_network(request))
    except RateLimitedError as exc:
        raise _rate_limited(exc) from None
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
    return _signed_in(db, user, 201 if created else 200)


@router.post(
    "/auth/password/login",
    response_model=UserOut,
    responses={
        401: {"model": ErrorOut, "description": "invalid_credentials (every failure alike)"},
        403: {"model": ErrorOut, "description": "account_suspended (right password only)"},
        429: {"model": ErrorOut, "description": "Too many attempts; see Retry-After"},
        503: {"model": ErrorOut, "description": "Redis or the database is unreachable"},
    },
)
def password_login(body: PasswordLoginIn, request: Request, db: DbDep, r: RedisDep) -> JSONResponse:
    """Log in with email and password (spec 0016a). A sync handler: hashing runs in the
    threadpool, bounded by `services/passwords.py`'s semaphore and the per-network limits."""
    try:
        user = auth_service.password_login(
            db, r, body.email, body.password, client_network(request)
        )
    except RateLimitedError as exc:
        raise _rate_limited(exc) from None
    except auth_service.InvalidCredentialsError:
        raise HTTPException(status_code=401, detail="invalid_credentials") from None
    except auth_service.AccountSuspendedError:
        raise HTTPException(status_code=403, detail="account_suspended") from None
    return _signed_in(db, user, 200)


@router.post(
    "/auth/google",
    response_model=UserOut,
    responses={
        201: {"model": UserOut, "description": "Account created and logged in"},
        401: {"model": ErrorOut, "description": "invalid_google_token"},
        403: {"model": ErrorOut, "description": "account_suspended, or signup_blocked"},
        409: {
            "model": ErrorOut,
            "description": "google_account_conflict: the email's account has another Google sub",
        },
        422: {"description": "profile_required, or a malformed body"},
        429: {"model": ErrorOut, "description": "Too many attempts; see Retry-After"},
        503: {
            "model": ErrorOut,
            "description": "google_unavailable (off, or Google's keys unreachable), or Redis or "
            "the database is unreachable",
        },
    },
)
def google_login(body: GoogleLoginIn, request: Request, db: DbDep, r: RedisDep) -> JSONResponse:
    """Sign in or up with a Google ID token (spec 0016b). A sync handler: the key fetch and the
    signature check run in the threadpool."""
    try:
        user, created = auth_service.google_login(
            db, r, body.credential, body.profile, client_network(request)
        )
    except RateLimitedError as exc:
        raise _rate_limited(exc) from None
    except google.InvalidGoogleToken:
        raise HTTPException(status_code=401, detail="invalid_google_token") from None
    except google.GoogleUnavailable:
        raise HTTPException(status_code=503, detail="google_unavailable") from None
    except auth_service.ProfileRequiredError:
        raise HTTPException(status_code=422, detail="profile_required") from None
    except auth_service.AccountSuspendedError:
        raise HTTPException(status_code=403, detail="account_suspended") from None
    except auth_service.SignupBlockedError:
        raise HTTPException(status_code=403, detail="signup_blocked") from None
    except auth_service.GoogleAccountConflictError:
        raise HTTPException(status_code=409, detail="google_account_conflict") from None
    return _signed_in(db, user, 201 if created else 200)


@router.get(
    "/me",
    response_model=UserOut,
    responses={401: {"model": ErrorOut, "description": "unauthenticated"}},
)
def me(user: Annotated[User, Depends(current_user)], db: DbDep) -> UserOut:
    return user_out(db, user)


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
    # The session went after `current_user` passed: a racing DELETE /me of this account (its
    # step 11) answers as the spec's no-op second call, 204.
    if created_at is None and accounts.is_deleted(db, user.id):
        return _signed_out()
    if created_at is None or dt.datetime.now(dt.UTC) - created_at > dt.timedelta(
        seconds=DELETE_REAUTH_S
    ):
        raise HTTPException(status_code=403, detail="reauth_required")
    accounts.delete_account(db, store, user)
    return _signed_out()


@router.put(
    "/me/password",
    status_code=204,
    responses={
        401: {"model": ErrorOut, "description": "unauthenticated (also a deletion racing it)"},
        403: {
            "model": ErrorOut,
            "description": "reauth_required: the session is older than 15 minutes; sign in again",
        },
        **limits.RATE_LIMITED,
    },
)
def set_my_password(
    body: PasswordIn,
    request: Request,
    user: Annotated[User, Depends(current_user)],
    db: DbDep,
    r: RedisDep,
) -> Response:
    """Set or change the caller's password and sign out every other device (spec 0016a). No
    current password: the fresh sign-in is the proof."""
    limits.check(r, user.id, limits.WRITE)
    token = request.cookies[COOKIE_NAME]  # `current_user` resolved it
    created_at = auth_service.session_created_at(db, token)  # as DELETE /me
    if created_at is None and accounts.is_deleted(db, user.id):
        raise HTTPException(status_code=401, detail="unauthenticated")  # a racing DELETE /me
    if created_at is None or dt.datetime.now(dt.UTC) - created_at > dt.timedelta(
        seconds=DELETE_REAUTH_S
    ):
        raise HTTPException(status_code=403, detail="reauth_required")
    auth_service.set_password(db, user, body.password, token)
    return Response(status_code=204)
