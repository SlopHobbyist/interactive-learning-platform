FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

# Install dependencies first so they are cached independently of the source.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY server ./server
COPY web ./web
COPY elements ./elements
COPY content ./content
COPY README.md ./
RUN uv sync --frozen --no-dev

ENV PATH="/opt/venv/bin:$PATH" \
    ILP_CONTENT_DIR=/app/content \
    ILP_ELEMENTS_DIR=/app/elements \
    ILP_WEB_DIR=/app/web \
    ILP_DATA_DIR=/app/data

EXPOSE 8000
CMD ["sh", "-c", "uvicorn server.app.main:app --host 0.0.0.0 --port 8000 ${ILP_DEV:+--reload --reload-dir /app/server}"]
