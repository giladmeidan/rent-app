"""API schemas for email-OTP auth (spec 0001a). Never the ORM models."""

import datetime as dt
import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

Role = Literal["owner", "seeker"]


class OtpRequestIn(BaseModel):
    email: EmailStr


class ProfileIn(BaseModel):
    """Signup data, read only when the email has no account yet."""

    # Strip before the length check, so "  א " is 1 code point and rejected.
    model_config = ConfigDict(str_strip_whitespace=True)

    display_name: str = Field(min_length=2, max_length=40)
    role: Role


class OtpVerifyIn(BaseModel):
    email: EmailStr
    # [0-9], not \d: \d also matches Arabic-Indic and other Unicode digits.
    code: str = Field(pattern=r"^[0-9]{6}$")
    profile: ProfileIn | None = None


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    display_name: str
    role: Role
    account_type: str
    created_at: dt.datetime
