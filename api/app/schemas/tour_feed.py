"""API schemas for the calendar feed (spec 0018d). Never the ORM models."""

from pydantic import BaseModel


class TourFeedOut(BaseModel):
    """Whether the caller's calendar feed is on (never the token or its hash)."""

    active: bool


class TourFeedTokenOut(BaseModel):
    """A new feed token (`secrets.token_urlsafe(32)`, 43 characters): shown once, as `InviteOut`;
    it can never be read again."""

    token: str
