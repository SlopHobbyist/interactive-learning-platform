"""FastAPI application: API routers plus static hosting for the web app, elements and content."""

from __future__ import annotations

import logging
import mimetypes
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .accounts import Kratos, proxy_client
from .api import auth as auth_api
from .api import content as content_api
from .api import economy as economy_api
from .api import elements as elements_api
from .api import kratos as kratos_api
from .api import league as league_api
from .api import library as library_api
from .api import progress as progress_api
from .api import review as review_api
from .config import Settings
from .config import settings as default_settings
from .content.store import ContentStore
from .db.session import Database

log = logging.getLogger("ilp")

# Windows' registry-based mimetypes misses a few types the web app serves.
mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("font/woff", ".woff")
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("application/x-yaml", ".yaml")
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("image/svg+xml", ".svg")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or default_settings
    store = ContentStore(settings)
    database = Database(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        database.init()
        store.reload()
        for p in store.index.problems:
            log.warning("content: %s", p.format(settings.content_dir))
        if settings.dev:
            store.start_watching()
        yield
        store.stop_watching()
        app.state.kratos.close()
        await app.state.kratos_proxy.aclose()

    app = FastAPI(title="Interactive Learning Platform", version="0.1.0", lifespan=lifespan)

    @app.middleware("http")
    async def static_cors(request: Request, call_next):
        """Vendored libraries and element files may be fetched from the sandboxed (opaque-origin)
        iframe that runs learner code, so they carry a permissive CORS header. API routes do not."""
        response = await call_next(request)
        if request.url.path.startswith(("/vendor/", "/elements/")):
            response.headers["Access-Control-Allow-Origin"] = "*"
        return response

    app.state.settings = settings
    app.state.store = store
    app.state.db = database
    # Accounts (multi mode): Kratos answers "who is this session?"; the proxy carries the
    # browser's self-service flows. Both are idle in single mode.
    app.state.kratos = Kratos(settings.kratos_url)
    app.state.kratos_proxy = proxy_client(settings.kratos_url)

    @app.get("/api/health")
    def health() -> dict:
        return {"status": "ok", "dev": settings.dev, "mode": settings.mode}

    app.include_router(content_api.router)
    app.include_router(elements_api.router)
    app.include_router(progress_api.router)
    app.include_router(review_api.router)
    app.include_router(economy_api.router)
    app.include_router(library_api.router)
    app.include_router(auth_api.router)
    app.include_router(kratos_api.router)
    app.include_router(league_api.router)

    # Plugins: each element folder is served as-is so the browser can import() its module.
    if settings.elements_dir.is_dir():
        app.mount("/elements", StaticFiles(directory=settings.elements_dir), name="elements")
    # Content assets (images referenced from markdown) are served from the content tree.
    if settings.content_dir.is_dir():
        app.mount("/content", StaticFiles(directory=settings.content_dir), name="content")

    web_dir = settings.web_dir
    index_file = web_dir / "index.html"

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str, request: Request):
        """Serve files under web/; fall back to index.html for client-side routes."""
        if path.startswith(("api/", "kratos/")) or path in ("api", "kratos"):
            raise HTTPException(status_code=404, detail="Not found")
        candidate = (web_dir / path).resolve() if path else index_file
        try:
            candidate.relative_to(web_dir.resolve())
        except ValueError:
            raise HTTPException(status_code=404, detail="Not found") from None
        if candidate.is_file():
            return FileResponse(candidate)
        # Asset-looking paths (with an extension) should 404 rather than return HTML.
        last = path.rsplit("/", 1)[-1]
        if "." in last:
            raise HTTPException(status_code=404, detail="Not found")
        if index_file.is_file():
            return FileResponse(index_file)
        return JSONResponse({"detail": "web/index.html is missing"}, status_code=404)

    return app


app = create_app()
