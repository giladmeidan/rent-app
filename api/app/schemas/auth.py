"""API schemas for email-OTP and password auth (specs 0001a, 0016a). Never the ORM models."""

import datetime as dt
import uuid
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints, field_validator

from app.schemas._text import visible_characters_only

Role = Literal["owner", "seeker"]
# 10-128 characters, any kind (NIST SP 800-63B), stored exactly as typed: the field-level
# `strip_whitespace=False` overrides `ProfileIn`'s model-wide stripping (spec 0016a).
Password = Annotated[str, StringConstraints(strip_whitespace=False, min_length=10, max_length=128)]


class OtpRequestIn(BaseModel):
    email: EmailStr


class ProfileIn(BaseModel):
    """Signup data, read only when the email has no account yet."""

    # Strip before the length check, so "  א " is 1 code point and rejected.
    model_config = ConfigDict(str_strip_whitespace=True)

    display_name: str = Field(min_length=2, max_length=40)
    role: Role
    # Optional at sign-up (spec 0016a); read only when this verify creates the account.
    password: Password | None = None

    @field_validator("display_name")
    @classmethod
    def _visible_characters_only(cls, value: str) -> str:
        """No control, format or separator characters, newlines included (`schemas/_text.py`)."""
        return visible_characters_only(value, field="display_name")


class OtpVerifyIn(BaseModel):
    email: EmailStr
    # [0-9], not \d: \d also matches Arabic-Indic and other Unicode digits.
    code: str = Field(pattern=r"^[0-9]{6}$")
    profile: ProfileIn | None = None


class PasswordLoginIn(BaseModel):
    email: EmailStr
    # Not min 10: a short password at login is a 401, not a 422 that tells the rule.
    password: Annotated[
        str, StringConstraints(strip_whitespace=False, min_length=1, max_length=128)
    ]


class PasswordIn(BaseModel):
    password: Password


class UserOut(BaseModel):
    """The caller's own account. `photo_url`: their person photo's small address (spec 0010j),
    null without one. `listing_cap`: live listings allowed at once (spec 0012a; the admin may
    raise it). `has_password`: the account has a password (spec 0016a)."""

    id: uuid.UUID
    email: str
    display_name: str
    role: Role
    account_type: str
    created_at: dt.datetime
    photo_url: str | None
    listing_cap: int
    has_password: bool
