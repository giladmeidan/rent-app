"""API schema for `GET /health`."""

from typing import Literal

from pydantic import BaseModel

DependencyState = Literal["ok", "error"]


class HealthOut(BaseModel):
    status: Literal["ok", "degraded"]
    db: DependencyState
    redis: DependencyState
