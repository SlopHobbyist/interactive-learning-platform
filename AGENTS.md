# Orientation for coding agents

This is a Duolingo / boot.dev–style learning platform for any subject. `README.md` is the product
brief; `plan.md` is the build plan and the source of truth for scope, phases and decisions.
Read `plan.md` §0 (ground rules) before changing anything.

## Layout (four separate parts)

| Part | Where | Notes |
|---|---|---|
| Core (server) | `server/` | FastAPI + SQLite. `server/app/main.py` is the entrypoint. |
| Web interface | `web/` | Plain HTML, ES modules, CSS. No build step, no Node. |
| Page elements | `elements/<type>/` | Plugins. Drop a folder in to add one, delete it to remove it. |
| Course content | `content/<subject>/<course>/<unit>/*.lesson.yaml` | YAML only. Never code. |

Docs live in `docs/` (`ARCHITECTURE.md`, `AUTHORING.md`, `ELEMENTS.md`, `LLM_AUTHORING_PROMPT.md`).

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
docker compose up --build                # http://localhost:8000 ; content/, elements/, data/ are volumes
```

Environment variables: `ILP_CONTENT_DIR`, `ILP_ELEMENTS_DIR`, `ILP_WEB_DIR`, `ILP_DATA_DIR`,
`ILP_DB_URL`, `ILP_DEV`, `ILP_MODE` (see `server/app/config.py`).

## Hard rules

1. The four parts stay separate. Content never contains code. Elements talk to the app only
   through the element API (`docs/ELEMENTS.md`). The web app never hard-codes an element type.
2. No externally hosted assets. No CDNs, remote fonts, scripts or images. Vendor everything.
3. No frontend build step and no Node toolchain.
4. Never edit the original design system at `C:\Users\admin\Downloads\web-design-wavefront`.
   Work only on the copy in `web/vendor/wavefront/`.
5. Follow the Wavefront visual language (top comment of `design_language.css`): fills not outlines,
   one accent, background shifts for hover/focus/press, shadows only on floating things, no
   gradients or glow, existing tokens only, icons as `<span class="icon">name</span>` ligatures,
   `UI.init(root)` after inserting markup, respect `prefers-reduced-motion`.
6. The content format is a public API. Any change updates the JSON Schemas, `docs/AUTHORING.md`
   and the example content in the same commit.
7. Run `pytest` and the Playwright suite before each commit. Commit per phase as
   `phase N: <summary>`; tick the phase in `plan.md` and append to its decision log.
