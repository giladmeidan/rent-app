"""FastAPI application factory."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import areas, health


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Rent App API", version="0.0.1")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.web_origin],
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept-Language"],
    )
    app.include_router(health.router)
    app.include_router(areas.router)
    return app


app = create_app()
