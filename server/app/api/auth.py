"""Accounts: the mode the web app should run in.

Sign-up, sign-in, sign-out, verification and recovery are Kratos self-service flows that the
browser drives through the ``/kratos/`` proxy (``api/kratos.py``); this router does not handle
credentials. The human check on sign-up and sign-in is made in that proxy.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from .. import accounts
from ..db.session import get_db, optional_user

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/mode")
def get_mode(request: Request, db: Session = Depends(get_db)) -> dict[str, Any]:
    settings = request.app.state.settings
    user = optional_user(request, db)
    identity = None
    if settings.mode == "multi" and user is not None:
        identity = request.app.state.kratos.whoami(request.cookies.get(accounts.SESSION_COOKIE))
    return {
        "mode": settings.mode,
        "authenticated": user is not None,
        "user": {
            "id": user.id,
            "username": user.username,
            "email": identity.email if identity else None,
            "email_verified": identity.email_verified if identity else None,
        }
        if user
        else None,
        # Where to write for help from a person (ILP_HELP_EMAIL); null hides it.
        "help_email": settings.help_email or None,
        # "cloudflare": the real widget, on sign-up and sign-in. "placeholder" (the default): a
        # local checkbox on sign-up that yields this token, and nothing on sign-in.
        "turnstile": {
            "mode": "cloudflare" if settings.turnstile_enabled else "placeholder",
            "site_key": settings.turnstile_site_key if settings.turnstile_enabled else None,
            "placeholder_token": None if settings.turnstile_enabled else accounts.PLACEHOLDER_TOKEN,
        },
    }
