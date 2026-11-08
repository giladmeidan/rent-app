"""API schema for error bodies (same `{"detail": ...}` shape FastAPI uses for HTTPException)."""

from pydantic import BaseModel


class ErrorOut(BaseModel):
    detail: str
