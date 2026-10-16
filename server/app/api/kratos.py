"""Reverse proxy for Ory Kratos's public API at ``/kratos/`` (multi mode only).

The browser runs Kratos's self-service flows (registration, login, logout, verification,
recovery, settings) as JSON requests to ``/kratos/self-service/...``. Proxying them keeps one
origin: no CORS, and Kratos's CSRF and session cookies are first-party cookies of the app.
Kratos's own ``serve.public.base_url`` points here, so the URLs it hands out route back through
the proxy.
"""

from __future__ import annotations

import json

import httpx
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from ..accounts import SESSION_COOKIE, TURNSTILE_MESSAGE, verify_turnstile

router = APIRouter(include_in_schema=False)

# The error id the browser sees (web/js/lib/kratos.js FlowError.id) when sign-in lacks a valid
# Turnstile token.
TURNSTILE_FAILED_ID = "turnstile_failed"

# Only the parts of the public API the web app uses.
ALLOWED_PREFIXES = ("self-service/", "sessions/whoami")
HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "host",
    "content-length",
}


def is_sign_in(method: str, path: str) -> bool:
    """The submission of a login flow. Starting one is a GET, so any POST under ``login`` counts."""
    return method == "POST" and path.startswith("self-service/login")


def turnstile_token(body: bytes) -> str:
    """``transient_payload.turnstile`` of a JSON flow submission; empty for anything else, so a
    form-encoded body (which Kratos would also accept) cannot get around the check."""
    try:
        token = json.loads(body)["transient_payload"]["turnstile"]
    except (ValueError, KeyError, TypeError):
        return ""
    return token if isinstance(token, str) else ""


@router.api_route("/kratos/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def kratos_proxy(path: str, request: Request) -> Response:
    if request.app.state.settings.mode != "multi":
        raise HTTPException(status_code=404, detail="accounts are off (ILP_MODE=single)")
    if not path.startswith(ALLOWED_PREFIXES):
        raise HTTPException(status_code=404, detail="Not found")
    client: httpx.AsyncClient = request.app.state.kratos_proxy
    headers = {k: v for k, v in request.headers.items() if k.lower() not in HOP_BY_HOP}
    client_host = request.client.host if request.client else ""
    forwarded = request.headers.get("x-forwarded-for")
    headers["x-forwarded-for"] = f"{forwarded}, {client_host}" if forwarded else client_host
    headers["x-forwarded-proto"] = request.url.scheme
    headers["x-forwarded-host"] = request.headers.get("host", "")
    body = await request.body()
    settings = request.app.state.settings
    if is_sign_in(request.method, path) and settings.turnstile_enabled:
        # Kratos's login hooks only run after the password was checked, so the human check is
        # made here, before the password gets that far. Registration uses a webhook (api/auth.py).
        remote_ip = headers["x-forwarded-for"].split(",")[0].strip()
        human = await run_in_threadpool(
            verify_turnstile, turnstile_token(body), settings.turnstile_secret, remote_ip
        )
        if not human:
            return JSONResponse(
                status_code=400,
                content={
                    "error": {
                        "id": TURNSTILE_FAILED_ID,
                        "code": 400,
                        "status": "Bad Request",
                        "message": TURNSTILE_MESSAGE,
                        "reason": TURNSTILE_MESSAGE,
                    }
                },
            )
    try:
        upstream = await client.request(
            request.method,
            f"/{path}",
            params=request.query_params,
            headers=headers,
            content=body,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail="the account service is unavailable") from exc

    if upstream.status_code < 400 and path.startswith(
        ("self-service/logout", "self-service/verification")
    ):
        # The cached whoami answer may be stale: no session any more, or a newly verified email
        # (by the form's POST or by the GET of the email's link).
        request.app.state.kratos.forget(request.cookies.get(SESSION_COOKIE))

    response = Response(content=upstream.content, status_code=upstream.status_code)
    for key, value in upstream.headers.multi_items():
        # httpx has already decoded the body, so its encoding and length no longer apply.
        if key.lower() in HOP_BY_HOP or key.lower() == "content-encoding":
            continue
        response.headers.append(key, value)
    return response
