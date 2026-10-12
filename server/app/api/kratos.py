"""Reverse proxy for Ory Kratos's public API at ``/kratos/`` (multi mode only).

The browser runs Kratos's self-service flows (registration, login, logout, recovery, settings)
as JSON requests to ``/kratos/self-service/...``. Proxying them keeps one origin: no CORS, and
Kratos's CSRF and session cookies are first-party cookies of the app. Kratos's own
``serve.public.base_url`` points here, so the URLs it hands out route back through the proxy.
"""

from __future__ import annotations

import httpx
from fastapi import APIRouter, HTTPException, Request, Response

from ..accounts import SESSION_COOKIE

router = APIRouter(include_in_schema=False)

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
    try:
        upstream = await client.request(
            request.method,
            f"/{path}",
            params=request.query_params,
            headers=headers,
            content=await request.body(),
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail="the account service is unavailable") from exc

    if path.startswith("self-service/logout") and upstream.status_code < 400:
        request.app.state.kratos.forget(request.cookies.get(SESSION_COOKIE))

    response = Response(content=upstream.content, status_code=upstream.status_code)
    for key, value in upstream.headers.multi_items():
        # httpx has already decoded the body, so its encoding and length no longer apply.
        if key.lower() in HOP_BY_HOP or key.lower() == "content-encoding":
            continue
        response.headers.append(key, value)
    return response
