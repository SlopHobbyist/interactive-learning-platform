"""Accounts: the mode the web app should run in, and Kratos's registration webhook.

Sign-up, sign-in, sign-out and recovery are Kratos self-service flows that the browser drives
through the ``/kratos/`` proxy (``api/kratos.py``); this router does not handle credentials.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import accounts
from ..db.session import get_db, optional_user

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Kratos shows a webhook's message ids as given; anything in the 4000000 range reads as a
# validation error in its UI. This one is ours: "the human check failed".
TURNSTILE_FAILED = 4000901


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
        }
        if user
        else None,
        "turnstile": {
            "mode": "cloudflare" if settings.turnstile_secret else "placeholder",
            "site_key": settings.turnstile_site_key or None,
            # Placeholder mode: the widget is a local checkbox that yields this token.
            "placeholder_token": None if settings.turnstile_secret else accounts.PLACEHOLDER_TOKEN,
        },
    }


class RegistrationHook(BaseModel):
    username: str = ""
    turnstile: str = Field(default="", max_length=4096)
    remote_ip: str = ""


@router.post("/hooks/registration", status_code=204)
def registration_hook(body: RegistrationHook, request: Request) -> Response:
    """Kratos calls this before it stores a new identity (``kratos.yml``, ``response.parse``).

    204 lets the registration through; a 4xx with Kratos's ``messages`` shape aborts it and the
    message is shown on the form. The hook has no side effects, so it needs no secret: calling it
    directly only answers whether a Turnstile token is valid."""
    settings = request.app.state.settings
    if settings.mode != "multi":
        raise HTTPException(status_code=404, detail="accounts are off (ILP_MODE=single)")
    remote_ip = body.remote_ip.split(",")[0].strip()
    if accounts.verify_turnstile(body.turnstile, settings.turnstile_secret, remote_ip):
        return Response(status_code=204)
    return JSONResponse(
        status_code=400,
        content={
            "messages": [
                {
                    "instance_ptr": "#/",
                    "messages": [
                        {
                            "id": TURNSTILE_FAILED,
                            "text": "Please complete the human check, then try again.",
                            "type": "error",
                        }
                    ],
                }
            ]
        },
    )
