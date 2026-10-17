# Orientation for coding agents

This is MidnightCrammer, a Duolingo / boot.dev–style learning platform for any subject.
`README_claude.md` is the product overview and `docs/ARCHITECTURE.md` the map of what exists.
Read the hard rules below before changing anything.

## Layout (four separate parts)

| Part | Where | Notes |
|---|---|---|
| Core (server) | `server/` | FastAPI + SQLite. `server/app/main.py` is the entrypoint. |
| Web interface | `web/` | Plain HTML, ES modules, CSS. No build step, no Node. |
| Page elements | `elements/<type>/` | Plugins. Drop a folder in to add one, delete it to remove it. |
| Course content | `content/<subject>/<course>/<unit>/*.lesson.yaml` | YAML only. Never code. |

Accounts (`ILP_MODE=multi`, the compose default) are Ory Kratos, configured in `deploy/kratos/`
and proxied at `/kratos/`. Never add password handling to the app; see `docs/ARCHITECTURE.md`
(Accounts).

Docs live in `docs/` (`ARCHITECTURE.md`, `AUTHORING.md`, `ELEMENTS.md`, `EMAIL.md`, `HTTPS.md`, `LLM_AUTHORING_PROMPT.md`).

## Commands

```sh
uv sync                                  # install (uv is the package manager; no pip, no npm)
uv run uvicorn server.app.main:app --reload   # dev server on http://127.0.0.1:8000
ILP_DEV=1 uv run uvicorn server.app.main:app --reload   # with dev tools enabled
uv run pytest                            # server + content tests
uv run pytest -m e2e                     # Playwright browser tests (needs `uv run playwright install chromium`)
uv run ilp validate [content/...]        # validate content, prints file:line: message
uv run ilp schema                        # regenerate content/_schema/*.json (+ llm-context.md)
uv run ilp arrange <lesson.yaml>         # print what auto-arrange generates for a lesson
uv run ilp ids --write                   # persist generated item ids into the YAML
uv run ruff check . && uv run ruff format .
docker compose up --build                # http://localhost:8000 (+ Kratos, and Mailpit on :8025 until ILP_SMTP_URL is set); content/, elements/, data/ are volumes
ILP_STACK_URL=http://localhost:8000 uv run pytest -m e2e server/tests/e2e/test_accounts_stack.py   # accounts, against that stack
```

Environment variables: `ILP_CONTENT_DIR`, `ILP_ELEMENTS_DIR`, `ILP_WEB_DIR`, `ILP_DATA_DIR`,
`ILP_DB_URL`, `ILP_DEV`, `ILP_MODE`, `ILP_SQLITE_EXCLUSIVE`, `ILP_KRATOS_URL`,
`ILP_TURNSTILE_SITE_KEY`, `ILP_TURNSTILE_SECRET`, `ILP_HELP_EMAIL` (see `server/app/config.py`); compose also reads
`ILP_PUBLIC_URL`, `ILP_CONTENT_HOST_DIR`, `ILP_KRATOS_COOKIE_SECRET`, `ILP_KRATOS_CIPHER_SECRET` and
`ILP_SECURE_COOKIES`, `ILP_FORWARDED_ALLOW_IPS`, `ILP_TLS`, `ILP_HOST_PORT`, `ILP_TLS_CERT`, `ILP_TLS_KEY`, `ILP_CERTS_HOST_DIR`,
`ILP_SMTP_URL`, `ILP_MAIL_FROM`, `ILP_MAIL_FROM_NAME` (see `.env.example`, `docs/HTTPS.md`, `docs/EMAIL.md`). TLS keys live in the gitignored `certs/`; never commit one. Instance settings go in the gitignored `.env`, never in
tracked files. Tests merge `content/` with the test-only subjects in `server/tests/fixtures/content/`.
`ILP_SQLITE_EXCLUSIVE=1` is set in the Docker image: WAL needs it on a Windows/macOS bind mount.

## Hard rules

1. The four parts stay separate. Content never contains code. Elements talk to the app only
   through the element API (`docs/ELEMENTS.md`). The web app never hard-codes an element type.
2. No externally hosted assets. No CDNs, remote fonts, scripts or images. Vendor everything.
   The one exception is Cloudflare's Turnstile script, which cannot be self-hosted; it loads only
   when both Turnstile keys are set (`docs/ARCHITECTURE.md`, Accounts).
3. No frontend build step and no Node toolchain.
4. `web/vendor/wavefront/` is a vendored copy of the Wavefront design system. Change it only
   when you must, and list every change in its `SOURCE.md` so it survives a re-sync.
5. Follow the Wavefront visual language (top comment of `design_language.css`): fills not outlines,
   one accent, background shifts for hover/focus/press, shadows only on floating things, no
   gradients or glow, existing tokens only, icons as `<span class="icon">name</span>` ligatures,
   `UI.init(root)` after inserting markup, respect reduced motion via `prefersReducedMotion()` /
   `:root[data-motion="reduce"]` (the OS preference, overridable by the Motion setting).
6. The content format is a public API. Any change regenerates the committed JSON Schemas (`uv run ilp schema`), updates `docs/AUTHORING.md`
   and the example content in the same commit.
7. Run `pytest` and the Playwright suite before each commit.
