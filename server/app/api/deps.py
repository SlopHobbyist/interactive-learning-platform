"""FastAPI dependencies shared by the routers."""

from __future__ import annotations

from fastapi import HTTPException, Request

from ..config import Settings
from ..content.store import ContentStore


def get_store(request: Request) -> ContentStore:
    return request.app.state.store


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def require_dev(request: Request) -> None:
    if not request.app.state.settings.dev:
        raise HTTPException(status_code=404, detail="Not found (dev-only endpoint; set ILP_DEV=1)")
