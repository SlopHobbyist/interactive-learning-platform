# MidnightCrammer

A Duolingo / boot.dev–style learning app for **any subject**, built to be fed by you (or an LLM)
writing YAML. Open source and self-hosted. Run it alone with no accounts, or with Docker for
accounts, where each learner adds the subjects they want from the catalog.

- **Content is files.** `content/<subject>/<course>/<unit>/*.lesson.yaml`. Write items by hand
  or give the arranger a list of facts and sentences and let it build the lesson.
- **Elements are plugins.** Ten ship (explanation, multiple choice, true/false, fill in the
  blank, short answer, numeric, match pairs, order, flashcard, code with offline Python and
  JavaScript). Drop a folder into `elements/` to add one.
- **Progress is a map that decays.** Each course is a field of tiles; finishing a lesson sends a
  wave to the tiles it unlocks, and tiles fade as spaced repetition says you are forgetting.
  Tap a faded tile to re-tune it. Plus XP, a combo meter, a daily goal with streaks and freezes,
  three daily quests and lesson chests (with the odds printed in the shop), and coins to spend
  on sound packs, correct-answer effects and streak freezes. No real money.
- **Looks like Wavefront.** The web app is built on the Wavefront design system (vendored under
  `web/vendor/wavefront`), with one accent, fills instead of outlines and no gradients.

## Quick start

```sh
uv sync                                        # Python 3.12 + uv; no Node
uv run uvicorn server.app.main:app --port 8000 # http://127.0.0.1:8000
```

or with Docker:

```sh
docker compose up --build                      # http://localhost:8000, mail at :8025
```

Without Docker the app runs in single-user mode (no sign-in). The compose file runs it with
accounts: [Ory Kratos](https://www.ory.sh/kratos/) handles sign-up, sign-in and password
recovery, and [Mailpit](https://mailpit.axllent.org/) catches the recovery emails at
<http://localhost:8025>. Learners pick a username and give an email; their password is 32
generated characters shown once, to copy into a password manager.

Instance settings live in a gitignored `.env` next to `docker-compose.yaml`; copy
`.env.example` to start. Reached at another address? Set `ILP_PUBLIC_URL`.

> **Before anyone but you can reach it:** the Kratos secrets default to public placeholders and
> the cookies are not marked secure, which is fine on localhost and nowhere else. In `.env`, set
> `ILP_KRATOS_COOKIE_SECRET` and `ILP_KRATOS_CIPHER_SECRET` (exactly 32 characters; e.g.
> `openssl rand -hex 16`), serve the app over HTTPS and set `ILP_SECURE_COOKIES=true`. Don't edit
> the secrets in `deploy/kratos/kratos.yml`: that file is tracked. Read the Accounts section of
> `docs/ARCHITECTURE.md` too.

`content/`, `elements/` and `data/` (the SQLite file) are mounted as volumes, so you can edit
courses and elements without a rebuild. Set `ILP_DEV=1` for auto-reload of content, the element
gallery at `/dev/elements`, time travel in Settings and a progress reset button.

## Write a course

```sh
uv run ilp new subject content/chemistry
uv run ilp new course  content/chemistry/intro
uv run ilp new unit    content/chemistry/intro/01-atoms
uv run ilp new lesson  content/chemistry/intro/01-atoms/01-what-is-an-atom
uv run ilp validate    content/chemistry        # file:line: message, exits non-zero on errors
```

Or let a model write it: `uv run ilp schema` generates `content/_schema/llm-context.md`; paste it
together with `docs/LLM_AUTHORING_PROMPT.md` into any capable LLM, save the files it returns,
run `ilp validate`, paste the messages back once. `docs/AUTHORING.md` is the full reference,
including the auto-arrange mode:

```yaml
title: European capitals
arrange: auto
source:
  facts:
    - { term: France, definition: Paris }
    - { term: Spain, definition: Madrid }
  cloze:
    - "The capital of {{Germany}} is {{Berlin}}."
```

## Write an element

An element is a folder with `element.json` (manifest + JSON Schema for its fields),
`element.js` (`mount(root, ctx)` returning `getAnswer / check / showResult / focus / destroy`),
optional `element.css`, `examples.yaml` and a README. `docs/ELEMENTS.md` walks through one.

## Commands

| command | what |
|---|---|
| `uv run pytest` | server, content and browser tests (`uv run playwright install chromium` once) |
| `uv run ilp validate [path]` | validate content; `--check-db` also reports orphaned progress |
| `uv run ilp schema` | regenerate `content/_schema/*.json` and `llm-context.md` |
| `uv run ilp ids --write` | persist generated item ids so edits keep progress |
| `uv run ilp arrange <lesson>` | print what the arranger generates for a lesson |
| `uv run ruff check . && uv run ruff format .` | lint and format |

Environment: `ILP_CONTENT_DIR`, `ILP_ELEMENTS_DIR`, `ILP_WEB_DIR`, `ILP_DATA_DIR`, `ILP_DB_URL`,
`ILP_DEV`, `ILP_MODE=single|multi` (accounts and a weekly league), `ILP_KRATOS_URL`,
`ILP_TURNSTILE_SITE_KEY`, `ILP_TURNSTILE_SECRET`; for Docker, `ILP_PUBLIC_URL`,
`ILP_CONTENT_HOST_DIR`, `ILP_KRATOS_COOKIE_SECRET`, `ILP_KRATOS_CIPHER_SECRET`,
`ILP_SECURE_COOKIES` (all listed in `.env.example`).

## Layout

```
server/    FastAPI app, content loader/validator/renderer, progress (SRS, unlocks, streaks,
           rewards), CLI (`ilp`), tests
web/       index.html, css/app.css, js/ (router, views, player, map), vendor/ (Wavefront, KaTeX,
           Pyodide)
elements/  one folder per element
content/   one directory per subject; _schema/ is generated but committed (run `uv run ilp schema` after changing an element)
docs/      ARCHITECTURE.md, AUTHORING.md, ELEMENTS.md, LLM_AUTHORING_PROMPT.md
deploy/    kratos/: accounts config for docker compose
```

Grading is client-side and the server trusts it: this is a personal tool, not an exam system.
