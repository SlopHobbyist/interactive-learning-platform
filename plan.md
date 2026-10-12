# Implementation Plan — Interactive Learning Platform

A Duolingo / boot.dev–style learning app for **any subject**. Read `README.md` first: it is the
product brief. This file is the build plan. Work through the phases **in order**. Each phase ends
with acceptance criteria. Do not start the next phase until every criterion is met and committed.

---

## 0. Ground rules for the coding agent

1. **The four parts stay separate.** These are the core (server), the web interface, the page
   elements and the course content. Each lives in its own top-level directory (see §2). Content
   never contains code. Elements never import from the web app except through the documented
   element API (§5). The web app never hard-codes an element type.
2. **No externally hosted assets, ever.** Use no CDNs, remote fonts, remote scripts or remote
   images. This is a hard rule inherited from Wavefront (`ICONS.txt`). Any third-party library is
   vendored into the repo.
3. **No frontend build step and no Node toolchain.** The web app is plain HTML, ES modules and
   CSS, the same as Wavefront. If a phase seems to need a bundler, stop and find another way.
4. **Do not modify the original design system** at `C:\Users\admin\Downloads\web-design-wavefront`.
   Copy it in once (Phase 2) and work only on the copy.
5. **Follow the Wavefront visual language** (top comment of `design_language.css`):
   - Separate surfaces by fill, not outlines.
   - Use one accent colour, only for the primary action and the "active" state.
   - Answer hover, focus and press with a background shift. Never use a border, a shadow or a scale
     change for them.
   - Use shadows only for things that float (dialog, drawer, menu, toast).
   - No gradients and no glow.
   - Use the existing tokens (`--step-1..4`, `--color-*`) and never invent raw colours.
   - Icons are `<span class="icon">ligature_name</span>`. Never use codepoints.
   - After inserting markup, call `UI.init(root)` on it.
   - Respect `prefers-reduced-motion`.
6. **The content format is a public API.** Humans and LLMs will write it by hand. Every change to it
   must update the JSON Schemas, `docs/AUTHORING.md` and the example content in the same commit.
7. **Tests accompany every phase.** Run `pytest` and the Playwright suite before each commit.
8. **Commit at the end of each phase** with a message of the form `phase N: <summary>`. Keep
   `plan.md` up to date: tick each finished phase's checkbox and note any deviation under
   "Decision log" at the bottom.

---

## 1. Tech decisions (already made; don't re-decide)

| Concern | Choice | Why |
|---|---|---|
| Server | Python 3.12, FastAPI, Uvicorn | Simple. The repo `.gitignore` is already Python-oriented. |
| Package mgmt | `uv` (`pyproject.toml` + `uv.lock`) | Fast and reproducible. |
| DB | SQLite via SQLAlchemy 2.0, migrations with Alembic | Single file. Easy to mount in Docker. Enough for personal and small-group use. |
| Content format | YAML files on disk, one lesson per file | Easy for humans and LLMs to write, and easy to diff. |
| Content validation | Pydantic models for structure, JSON Schema for each element's item fields | Language-agnostic schemas that LLMs and editors can use as well. |
| Markdown / code / math | Rendered **server-side** at load time: `markdown-it-py`, Pygments, KaTeX (vendored, client-side for math only) | Keeps the frontend dependency-free. |
| Frontend | Vanilla ES modules, hash-free History API router, Wavefront CSS/JS | Matches the design system's "no frameworks" philosophy. |
| Tests | `pytest` (server, content), Playwright for Python (browser, elements, e2e) | One language for the whole toolchain. |
| Lint/format | `ruff` (Python). Plain JS follows the style of `design_language.js`. | |
| Deploy | `Dockerfile` + `docker-compose.yaml` (currently empty; fill it) | `content/` and `elements/` are mounted as volumes so they can be edited without a rebuild. |

---

## 2. Target repository layout

```
/
├─ README.md                 product brief (exists)
├─ plan.md                   this file
├─ AGENTS.md                 short orientation for coding agents (Phase 0)
├─ pyproject.toml / uv.lock
├─ Dockerfile, docker-compose.yaml
├─ server/                   CORE
│  ├─ app/
│  │  ├─ main.py             FastAPI app, static mounts
│  │  ├─ config.py           env-driven settings (paths, DB url, dev reload)
│  │  ├─ content/            loader, pydantic models, validator, renderer, arranger
│  │  │  └─ generators/      auto-arrange generators (Phase 8)
│  │  ├─ elements/           element registry (scans /elements)
│  │  ├─ db/                 SQLAlchemy models, session, alembic/
│  │  ├─ progress/           srs.py, xp.py, streaks.py, unlocks.py, rewards.py
│  │  └─ api/                routers: content, elements, progress, review, me
│  ├─ cli.py                 `ilp` command: validate, ids, schema, new
│  └─ tests/
├─ web/                      WEB INTERFACE (served statically)
│  ├─ index.html             single shell page
│  ├─ css/app.css            app-specific styles, built on Wavefront tokens only
│  ├─ js/
│  │  ├─ app.js, router.js, api.js, store.js
│  │  ├─ lib/                answer normalisation, keyboard, sound, dom helpers
│  │  ├─ views/              home, subject, course-map, lesson, review, profile, settings, elements-gallery
│  │  ├─ player/             lesson session engine
│  │  └─ map/                the Wavefront map renderer (Phase 6)
│  └─ vendor/
│     ├─ wavefront/          copied design system (Phase 2)
│     └─ katex/ …            other vendored libs
├─ elements/                 PAGE ELEMENTS (plugins)
│  └─ <element-name>/
│     ├─ element.json        manifest + JSON Schema for item fields
│     ├─ element.js          ES module implementing the element API
│     ├─ element.css         optional; Wavefront tokens only
│     ├─ examples.yaml       sample items, used by the gallery + tests
│     └─ README.md
├─ content/                  COURSE CONTENT
│  ├─ _schema/               generated JSON Schemas (do not hand-edit)
│  └─ <subject>/…            see §4
└─ docs/
   ├─ ARCHITECTURE.md
   ├─ AUTHORING.md           how to write content (human + LLM)
   ├─ ELEMENTS.md            how to write an element
   └─ LLM_AUTHORING_PROMPT.md  copy-paste prompt for generating a course
```

---

## 3. Domain model

**Hierarchy:** Subject › Course › Unit › Lesson › Item

- **Subject:** a broad area (Spanish, Python, American History). Holds only metadata and an icon.
- **Course:** an ordered set of units with one learning goal (e.g. "Spanish A1"). Course is the
  unit of progress, of the map and of review.
- **Unit:** a themed group of lessons. It may declare `requires:` (other unit ids in the same
  course). By default it requires the previous unit.
- **Lesson:** a 3–10 minute session made of items. It may declare `requires:` (lesson ids). By
  default it requires the previous lesson in the unit.
- **Item:** one instance of a page element (a question, an explanation, a card).

**Identity.** Each item's progress is keyed by its full path:
`subject/course/unit/lesson#item_id`.
- Subject, course, unit and lesson ids are the directory or file slugs and are required.
- `item.id` is optional. When it is missing, the id is `type + short hash of the item's content`,
  so editing an item resets its progress. `ilp ids --write` fills explicit ids into files so that
  later edits keep their history.
- Renaming a slug orphans progress. The validator warns when DB rows reference paths that no
  longer exist (`ilp validate --check-db`).

---

## 4. Content format

```
content/
└─ spanish/
   ├─ subject.yaml               id, title, icon, description, color? (must be a token name)
   └─ a1/
      ├─ course.yaml             id, title, description, level, tags
      └─ 01-greetings/
         ├─ unit.yaml            id, title, description, requires?
         ├─ 01-hello.lesson.yaml
         └─ 02-introductions.lesson.yaml
```

Numeric prefixes set the order. They are stripped from the id (`01-greetings` → `greetings`).
The id can be overridden in the YAML.

### 4a. Manual layout (author picks each element)

```yaml
title: Saying hello
xp: 10                       # optional, default 10
requires: []                 # optional, overrides the default "previous lesson"
items:
  - type: explanation
    body: |
      **Hola** means *hello*. Use it any time of day.
  - type: multiple-choice
    id: hola-meaning
    prompt: What does **hola** mean?
    choices: [Hello, Goodbye, Please, Thanks]
    answer: 0
    explain: "*Hola* is the all-purpose greeting."
  - type: fill-blank
    prompt: "___, ¿cómo estás?"
    answers: [Hola]
```

### 4b. Auto-arrange (author supplies raw material; the platform builds the items)

```yaml
title: European capitals I
arrange: auto
source:
  facts:                       # term ↔ definition pairs
    - { term: France, definition: Paris }
    - { term: Spain,  definition: Madrid }
    - { term: Italy,  definition: Rome }
  cloze:                       # sentences with {{blanks}}
    - "The capital of {{Germany}} is {{Berlin}}."
  notes: |                     # optional markdown shown as an opening explanation
    Capitals are usually the largest city — but not always.
```

The arranger (Phase 8) turns this into a deterministic sequence: explanation, then recognition
(multiple choice), then matching, then recall (typed). Distractors are drawn from sibling facts in
the same unit. The random seed is the lesson path, so ids and order stay stable between loads.
A lesson may mix the two modes by using `items:` together with `- type: auto` entries.

### 4c. Validation

`ilp validate [path]` must:
- Check structure (Pydantic) and every item against its element's JSON Schema.
- Report unknown element types, duplicate ids, broken `requires`, `requires` cycles and markdown
  render errors.
- Print errors in the form `file:line: message`, using `ruamel.yaml` or PyYAML marks to get line
  numbers.
- Exit non-zero on any error.

LLMs rely on these messages to fix their own output, so keep them specific and actionable.

`ilp schema` writes `content/_schema/*.json`: one file per level, plus a combined `lesson.schema.json`
whose `items` is a `oneOf` over every installed element. YAML files can point to it with
`# yaml-language-server: $schema=...` for editor autocompletion.

---

## 5. Element plugin contract

An element is a folder in `elements/`. Deleting the folder removes the element. Adding one adds the
element. Content that uses a missing element fails validation, and the app never crashes on it.

**`element.json`**
```json
{
  "type": "multiple-choice",
  "version": 1,
  "title": "Multiple choice",
  "icon": "radio_button_checked",
  "graded": true,
  "schema": { "type": "object", "required": ["prompt", "choices", "answer"], "properties": {
    "prompt":  { "type": "string", "x-format": "markdown" },
    "choices": { "type": "array", "minItems": 2, "items": { "type": "string", "x-format": "markdown-inline" } },
    "answer":  { "oneOf": [{ "type": "integer" }, { "type": "array", "items": { "type": "integer" } }] },
    "shuffle": { "type": "boolean", "default": true },
    "explain": { "type": "string", "x-format": "markdown" }
  }}
}
```
The server renders any field marked `x-format: markdown|markdown-inline|code` to sanitised HTML.
It sends `<field>` (the raw source) and `<field>_html` side by side.

**`element.js`** must export:
```js
export default {
  type: 'multiple-choice',
  // Build UI inside `root`. ctx = { item, lang, onChange(ready:boolean), onSubmit(), ui: window.UI, lib }
  mount(root, ctx) { /* … */ return handle; },
};
// handle:
//   getAnswer()            -> any JSON-serialisable answer (null if not ready)
//   check(answer)          -> { correct: boolean, partial?: 0..1, feedback_html?: string, correct_answer_html?: string }
//   showResult(result)     -> paint correct/incorrect state, lock input
//   focus()                -> move focus to the first interactive control
//   destroy()
```
- Grading is **client-side** and synchronous. The server records what the client reports. This
  app does not defend against cheating. Note that in `ARCHITECTURE.md`.
- Ungraded elements (`"graded": false`, e.g. `explanation`) only show a Continue button.
- Keyboard: number keys pick options, Enter checks then continues. The player owns Enter. The
  element owns everything else.
- Shared helpers live in `web/js/lib/` and are passed in as `ctx.lib`: `normalize(text, {case, accents, punctuation, whitespace})`, `shuffle(seed)` and the like.
  Elements must not import web-app internals directly.

**Registry.** `GET /api/elements` lists the installed elements (manifest and module URL). The
player loads each element with dynamic `import()`. `/elements/` is mounted as static files.

**Starter set (Phase 3)**, each with `examples.yaml` and a README:

| type | notes |
|---|---|
| `explanation` | Markdown, images, code, math. Ungraded. |
| `multiple-choice` | Single or multi answer, shuffling, choice cards from Wavefront `selection.html`. |
| `true-false` | Two large choice buttons. |
| `fill-blank` | Typed blanks **or** a word bank (`bank: [...]`). Multiple blanks per prompt. |
| `short-answer` | Typed answer. Accepts a list of `answers` and/or a `pattern`, with normalisation options. |
| `numeric` | Number with `tolerance` (absolute or %) and optional unit. |
| `match-pairs` | Two columns, tap-to-pair. Graded per pair; `partial` = fraction correct. |
| `order` | Reorder rows. Reuses Wavefront's `reorder` behavior and `UI.lift`. |
| `flashcard` | Flip card with self-rating (again / hard / good / easy). Feeds SRS directly. |

**Later elements** (Phase 10 or as needed): `code` (editor + run + tests), `image-hotspot`,
`math-input`, `listen-and-type` (uses the browser's SpeechSynthesis; no remote TTS), `categorize`
(drag into buckets).

---

## 6. Gamification — "The Wavefront Map"

The README asks for a novel presentation of lessons and progress. The design below takes its name
and look from the design language.

**The map.** A course is shown as a field of tiles, not as Duolingo's single winding path:
- Each unit is a region and each lesson is a tile.
- Edges come from `requires`, so courses can branch and merge.
- The layout is deterministic. Units go in bands top to bottom, and the lessons in a unit are
  packed in a hex or offset grid.
- An optional `map: { x, y }` in the lesson YAML overrides the computed position.

**The wavefront.** Finishing a lesson sends a wave outward.
- The *frontier* is the set of tiles whose requirements are all complete. These are the playable
  tiles.
- Tiles beyond the frontier are dim and locked.
- Completing a tile animates the wave across the edges to the tiles it unlocks: a short, staggered
  fill change, skipped under reduced motion. That animation is the main reward moment.

**Signal strength (decay).** Every completed tile has a strength from 0 to 100.
- Strength is the average SRS retrievability of the tile's items (§7). It drops over time, so the
  map slowly *fades* where you are forgetting.
- Strength is drawn as **discrete fill steps** using the existing surface tokens, so no new colour
  and no glow is needed:
  - fresh (≥ 85): `--color-primary-soft` with an accent icon
  - solid (60–85): `--step-4`
  - fading (30–60): `--step-3`
  - faint (< 30): `--step-2` with a `history` icon
- Tapping a faded tile starts a short **"re-tune"** review of that tile's weakest items. The course
  header shows **coverage**: the average strength across all tiles, as a Wavefront meter.
- This is the hook. Progress is a living map that decays, and coming back to restore it is the
  daily habit (loss aversion, done visibly and honestly).

**Supporting loops.** Each is a small, separate module that can be turned off in settings.
- **XP.** Lesson base XP, multiplied by the combo multiplier, plus a perfect-lesson bonus.
- **Combo meter (in a lesson).** Consecutive correct answers raise a multiplier (×1 → ×1.5 → ×2),
  shown next to the progress bar. A wrong answer resets it.
- **Daily goal and streak.**
  - The daily goal is an XP target of 10, 20, 30 or 50, shown as a ring or meter.
  - The streak counts consecutive days with the goal met.
  - Streak freezes can be earned and are used automatically.
  - The day boundary uses the user's local timezone, sent by the client.
- **Resonance drops (variable reward).** After each lesson there is a chance of a drop:
  - Rarities are common, rare and epic.
  - Possible rewards: XP boost (next lesson ×2), streak freeze, cosmetic map tile shapes or accent
    patterns, a title.
  - **The odds are shown openly in the UI.** There is no real money and nothing to buy. Settings
    can turn drops off.
- **Mistakes are not lives.** There are no hearts by default. Wrong items are re-queued at the end
  of the lesson. An optional "hard mode" setting adds hearts.
- **Stats/profile.** XP over time (bar chart), a streak calendar heatmap, coverage per course,
  accuracy per element type and weakest items.

---

## 7. Spaced repetition

Each item has a state row: `stability` (days), `difficulty` (1–10), `last_review`, `reps`, `lapses`.
Use a simplified FSRS-style model and keep it in `progress/srs.py` as pure functions, with full
unit tests:

- Retrievability: `R(t) = (1 + t / (9 * S)) ** -1`, where t is the number of days since the last
  review.
- On a correct answer: increase `S` by a factor that grows with `(1 - R)` (successful recall of
  something nearly forgotten counts for more) and shrinks with difficulty.
- On a wrong answer: set `S` to `max(0.2, S * 0.3)`, `lapses += 1` and `difficulty += 1`.
- Flashcard self-ratings map to again, hard, good and easy multipliers. For other items, map
  correct and quick to good, and partial or slow to hard.
- Tile strength = mean `R` over the tile's graded items × 100.
- The review queue for a course is the items with the lowest `R` among completed lessons, capped at
  10–15 items per session and interleaved across lessons.

Start with constants that are easy to read and tune (put them in one dataclass). Do not import a
full FSRS library.

---

## 8. Phases

### Phase 0 — Scaffolding ☑
- `pyproject.toml` (uv) with fastapi, uvicorn, pydantic, pyyaml/ruamel.yaml, jsonschema,
  markdown-it-py, pygments, sqlalchemy, alembic, typer, pytest, playwright, ruff.
- Create the directory skeleton from §2, with `.gitkeep` files where needed.
- `server/app/main.py`: a FastAPI app serving `GET /api/health`. It also serves `web/` at `/`
  (SPA fallback to `index.html` for non-`/api` and non-asset paths) and `elements/` at `/elements/`.
- `Dockerfile`: python:3.12-slim with uv.
- `docker-compose.yaml`:
  - One `app` service on port 8000.
  - Volumes `./content`, `./elements` and `./data` (for the SQLite file).
  - `ILP_DEV=1` enables reload.
- `AGENTS.md`: a one-page orientation with the run, test and validate commands, the hard rules from
  §0 and a pointer to this plan.
- Add `data/` and `content/_schema/` (generated) to `.gitignore`. `node_modules/` doesn't need to
  be added, because Node isn't used.

**Done when:** `uv run uvicorn server.app.main:app` and `docker compose up` both serve
`/api/health` and a placeholder `index.html`, and `pytest` runs (1 trivial test).

### Phase 1 — Content model, loader, validator ☑
- Write Pydantic models for Subject, Course, Unit, Lesson and Item (an item is a generic
  `{type, id?, ...fields}`, validated later against its element schema).
- The loader walks `content/` (prefix ordering, slug ids, default `requires`) and builds an
  in-memory index. In dev mode it rebuilds when files change (watchfiles).
- Markdown renderer: render `x-format` fields with markdown-it-py, use Pygments for fenced code,
  and pass `$…$` / `$$…$$` through untouched for client-side KaTeX. Sanitise the output.
- Element registry (server side): scan `elements/*/element.json` and expose the schemas to the
  validator.
- CLI `ilp`: `validate`, `schema`, `ids --write`, and `new subject|course|unit|lesson <path>`
  (writes a template file).
- API endpoints:
  - `GET /api/subjects`
  - `GET /api/subjects/{s}`
  - `GET /api/courses/{s}/{c}` (full tree, without item bodies)
  - `GET /api/lessons/{s}/{c}/{u}/{l}` (rendered items)
- Write a small example course, `content/example/demo/`, with 2 units and 4 lessons that use every
  starter element. The element manifests can be stubbed until Phase 3.

**Done when:**
- `ilp validate` passes on the example and gives precise `file:line` errors on a set of
  deliberately broken fixtures in `server/tests/fixtures/bad/`.
- API tests cover the tree and lesson endpoints.

### Phase 2 — Web shell + Wavefront ☑
- Copy `C:\Users\admin\Downloads\web-design-wavefront` into `web/vendor/wavefront/`, excluding
  `.git`. Record the source commit (`048f204` at time of writing) in `web/vendor/wavefront/SOURCE.md`.
  Keep the showcase `.html` pages: they are the reference for correct markup.
- `index.html` loads `vendor/wavefront/design_language.css`, `css/app.css`,
  `vendor/wavefront/design_language.js` and `js/app.js` (module). The app shell has:
  - A topbar with the title, XP and streak chips, and a theme toggle.
  - A drawer with the subjects.
  - A `<main>` outlet.
- `router.js`: the History API router with routes:
  - `/` for subjects
  - `/s/:subject` for courses
  - `/c/:subject/:course` for the map (a placeholder list until Phase 6)
  - `/l/:subject/:course/:unit/:lesson` for the player
  - `/review/:subject/:course`
  - `/me` for the profile
  - `/settings`
  - `/dev/elements` for the gallery
- `api.js`: a thin fetch wrapper with JSON and error toasts via `UI.toast`.
- Mobile-first layout. On phones the player is full-bleed and the topbar collapses. Dark is the
  reference theme, and light must work too.

**Done when:**
- You can browse from subjects to courses to a lesson list for the example content, in both
  themes, at 375 px and at desktop width.
- There are no requests to any external origin. A Playwright test asserts this.

### Phase 3 — Element system + starter elements ☑
- Write each element in §5 against the contract. Reuse Wavefront components (choice cards,
  fields, the reorder behavior, chips) rather than inventing new ones. Where a new component is
  needed, add it to `css/app.css` in Wavefront's style. Put a comment there explaining which
  existing component it extends.
- `/dev/elements` gallery: for each installed element, render every item in its `examples.yaml`
  with a "Check" button and show the result JSON. This is the element developer's harness.
- `docs/ELEMENTS.md`: the contract, a walkthrough that builds a tiny element, and the rules
  (tokens only, no external assets, a11y requirements).
- Playwright tests:
  - For every example item, drive a correct answer and a wrong answer and assert what `check()`
    returns.
  - Assert keyboard operability for every element.

**Done when:**
- All 9 starter elements pass their tests and are keyboard-operable with visible focus.
- Deleting an element folder makes content that uses it fail validation with a clear message,
  while the rest of the app still runs.

### Phase 4 — Lesson player ☑
- Session engine (`web/js/player/`). It runs as a state machine with these states:
  `intro → item → checking → feedback → next … → summary`.
  - A progress bar at the top advances as items are completed.
  - Wrong graded items are re-queued once at the end ("Let's try these again").
  - A lesson completes when every graded item has been answered correctly once.
- The **Check** button stays disabled until `onChange(ready=true)`. A feedback sheet slides up from
  the bottom (Wavefront bottom sheet). It shows correct or incorrect state using the
  `--color-success-soft` / `--color-danger-soft` fills, the explanation and the correct answer,
  then a **Continue** button.
- Combo meter UI (§6). Optional sound effects, off by default, using small vendored audio files.
- Summary screen: XP earned, accuracy, time, best combo and a "continue" call to action.
- Phase 4 runs entirely on the client. It keeps a session log in memory and stubs out persistence.

**Done when:**
- A full example lesson can be played start to finish by mouse, by touch emulation and by keyboard
  only.
- An e2e test plays one lesson that includes a deliberate mistake and checks the re-queue.

### Phase 5 — Persistence & progress ☑
- DB tables (Alembic migration):
  - `users`
  - `item_state` (SRS fields)
  - `attempts` (item key, answer JSON, correct, partial, ms, ts)
  - `lesson_completions`
  - `xp_events`
  - `daily_log` (user, local_date, xp)
  - `inventory` (rewards)
  - `settings`
- **Single-user mode by default:** a `local` user is created automatically. Every table has
  `user_id` from the start so that Phase 11 can add accounts without another migration.
- Endpoints:
  - `POST /api/attempts`: batched; the player flushes at the end of every item.
  - `POST /api/lessons/{path}/complete`: returns XP, newly unlocked lessons, the streak update and
    any reward drop.
  - `GET /api/progress/{s}/{c}`: per-lesson state (locked, available, complete) and strength.
  - `GET /api/me`: XP, streak, daily goal progress.
- `progress/unlocks.py` computes the frontier from completions and `requires`. `progress/srs.py`
  holds the functions from §7.
- Wire up the player, the topbar chips and the course page to the real data.

**Done when:**
- Progress survives a server restart and container recreation (the `./data` volume).
- Unlock rules are covered by unit tests, including a branching course and a course with no
  `requires`.
- SRS functions are covered by unit tests.

### Phase 6 — The Wavefront map + review ☑
- `web/js/map/`: render the course as an SVG or CSS-grid tile field following §6. Each tile is a
  real `<a>` or `<button>`. The tiles are roving-tabindex navigable, as in Wavefront's
  `accessibility.html#roving`, and each has an `aria-label` with the title, state and strength.
- Unit regions get headers. Edges are drawn as hairlines using `--color-border-strong`.
- The wavefront unlock animation plays on return from a completed lesson. The completion response
  says which tiles to animate.
- The course header holds the coverage meter, a "Review (n due)" button and a "Continue" button
  that jumps to the next frontier tile.
- Review session: `GET /api/review/{s}/{c}?limit=12` reuses the player engine, with items drawn
  from many lessons. A per-tile "re-tune" is the same endpoint with `?lesson=`.
- Add a time-travel debug setting (`?now=` offset, dev only) so that decay can be tested and
  demoed.

**Done when:**
- With a time offset of +30 days, tiles visibly fade through the fill steps.
- A review restores their strength.
- The map is fully keyboard navigable and passes an axe/Lighthouse a11y check at ≥ 95.

### Phase 7 — Gamification loops ☑
- Daily goal picker (in settings and on first run), streak logic with freezes, the timezone-safe
  day boundary, and a streak calendar on `/me`.
- Resonance drops: the reward table is a YAML file in the server config, the odds are shown on
  `/me`, and the effects are applied (XP boost, freeze, cosmetics). Cosmetics change only token
  choices and tile shapes, never the core palette.
- Profile and stats page using Wavefront's data components (stats, meters, charts, heatmap-like
  calendar).
- Settings toggles for each loop (drops, combo, sounds, hard mode with hearts).

**Done when:**
- Streak and goal edge cases are unit-tested: midnight rollover, a missed day with a freeze, a
  missed day without one, and a timezone change.
- Each loop can be turned off with no leftover UI.

### Phase 8 — Auto-arrange ☐
- `server/app/content/generators/`:
  - `facts` produces MC, then match-pairs (in groups of 4–5), then short-answer recall.
  - `cloze` produces fill-blank, with a word-bank variant first and a typed variant second.
  - `notes` produces an explanation.
- Generators are plain Python functions `(source, ctx) -> list[Item]`, registered by name. Adding
  one is just a matter of dropping in a module.
- Distractor selection uses sibling facts in the unit, then the course. Never use the right answer
  as a distractor. If too few facts exist, fall back to true-false.
- Output is deterministic (seeded by the lesson path) and the generated item ids are stable.
  `ilp validate` validates the generated items. `ilp arrange <lesson> --print` shows the result as
  YAML, so an author can "eject" it to manual layout.

**Done when:** a lesson made only of `facts` and `cloze` plays well in the player. Snapshot tests
pin the generated output.

### Phase 9 — LLM authoring kit + multi-subject samples ☐
- `docs/AUTHORING.md`: the full format reference with an example of every element. It also covers
  the auto-arrange mode, style guidance (lesson length, how many items, writing good distractors,
  explanations on every graded item) and the validate loop.
- `docs/LLM_AUTHORING_PROMPT.md`: a copy-paste prompt template. The LLM gets the topic, level and
  number of units, and returns a file tree. It must run `ilp validate` and fix the reported errors.
  Include the combined JSON Schema path.
- `ilp schema` also emits `content/_schema/llm-context.md`: one generated file holding every
  installed element's schema and examples, to paste into any LLM.
- To prove the "every subject" claim, add three small real courses (one unit each, 3–4 lessons):
  - **Spanish A1 greetings** (language: fill-blank, word bank, match).
  - **Intro to Python** (programming: MC on code snippets, order lines, short-answer outputs).
  - **American History: the Revolution** (humanities: auto-arranged facts on people and dates,
    cloze, ordering events chronologically, and a map image in an explanation).

**Done when:** a fresh LLM given only `LLM_AUTHORING_PROMPT.md` and the `llm-context.md` produces a
course that passes `ilp validate` after at most one fix round. Test this manually and record the
result in the decision log.

### Phase 10 — Code element ☐
- `elements/code`: an editor (a vendored CodeMirror 6 *pre-built ESM bundle*, or a minimal
  textarea with line numbers if that is not possible without a build step). It has a Run button,
  an output panel, and test cases defined in the item.
- JavaScript runs in a Web Worker started from a sandboxed `<iframe sandbox="allow-scripts">`
  (opaque origin, no access to the app). A timeout terminates the worker.
- Python runs on a **vendored** Pyodide, lazy-loaded only when a Python code item appears. Note the
  download size in the element's README.
- Grading: all tests pass means correct; partial credit is the fraction of tests passed.

**Done when:** the Intro to Python sample contains two code exercises that run offline.

### Phase 11 — Accounts (optional, multi-user) ☐
- `ILP_MODE=single|multi`. Multi mode adds local username and password accounts (argon2) and
  cookie sessions. The `local` user's data migrates to the first account.
- An opt-in weekly XP leaderboard ("league") ranks the accounts on the same instance.

### Phase 12 — Hardening ☐
- PWA manifest and service worker for offline lessons (cache content and elements).
- Error boundaries: a crashing element shows a "skip item" fallback and logs the error. It never
  breaks the session.
- Performance: lazy-load element modules; the map must handle 200 tiles smoothly.
- Write `docs/ARCHITECTURE.md` and update `README.md` with a quick start.

---

## 9. Definition of done (whole project)

- `docker compose up` gives a working app with three sample subjects, a playable map, review,
  streaks and drops.
- A new element can be added by dropping in a folder. A new course can be added by dropping in
  YAML files. Neither requires a code change or a rebuild.
- An LLM can write a valid course from the docs alone.
- Every screen looks like it belongs in the Wavefront kit.

---

## Decision log

_Append dated entries here when you deviate from this plan or make a call it didn't cover._

- 2026-10-12: Plan created.
- 2026-10-12 (Phase 0): `uv` was not installed; installed with `python -m pip install --user uv`
  (binary in `%APPDATA%/Python/Python312/Scripts/`). Removed the empty, untracked `user/` and
  `data/backend|frontend` sketch directories; `content/` replaces them. Docker Desktop was not
  running during the build, so `docker compose up` is unverified (test at the first checkpoint).
- 2026-10-12 (Phase 1): Content assets (images in markdown) live next to the YAML and are served
  from a static `/content` mount; relative `src`/`href` in markdown are rewritten against the
  lesson's directory. Math is emitted as `<span class="math" data-display="0|1">TeX</span>` for
  client-side KaTeX rather than left as `$…$` text (markdown would mangle `_` and `*`).
  Three generic schema extensions keep cross-field checks element-agnostic: `x-index-of`,
  `x-blanks`, `x-count-of-blanks` (see `validator.py`). Manifests may set `self_graded: true`
  (flashcard) meaning "the element reports its own result; no Check button". Subject, course and
  unit files that fail validation still load in a tolerant fallback so their children are checked
  too. The sanitiser is `nh3`. Phases 0 and 1 landed in one commit because the API routers and the
  health app share `main.py`.
- 2026-10-12 (Phase 2): The drawer is the kit's modal drawer on phones and becomes `drawer-docked`
  (a sticky sidebar) at ≥ 1024 px, toggled from `app.js` with `matchMedia` because CSS cannot add
  the class. Views are ES modules exporting `default async (ctx) => Node`, lazily imported by the
  router. Settings live in `localStorage` through `store.js` until Phase 5/7 move them server-side.
  Pygments token colours in `app.css` map onto the kit's own hues (accent, success, warning, muted)
  rather than a separate syntax palette. The course page is a unit-grouped lesson list with a
  placeholder frontier (lessons with no requirements are available) until Phases 5–6. Browser
  tests run via a `live_server` fixture (uvicorn in a thread) and assert no request leaves the
  origin. `.gitattributes` pins LF line endings.
- 2026-10-12 (Phase 3): KaTeX 0.16.22 is vendored at `web/vendor/katex` (mjs + css + woff2 only,
  1.2 MB) and lazy-loaded by `web/js/lib/math.js` on the first `.math` span. Elements get shared
  helpers through `ctx.lib` (`web/js/lib/answers.js`, `dom.js`, `math.js`); the mount layer in
  `web/js/lib/elements.js` is the error boundary (missing or crashing element → skip card).
  Shared option/blank/bank styles live in `app.css` §06 as `.el-*` classes documented in
  `docs/ELEMENTS.md`; only match-pairs, order and flashcard ship an `element.css`. match-pairs
  and flashcard call `ctx.onSubmit()` themselves (all pairs matched / card rated). The flashcard
  has no 3D flip: the back is revealed below the front with a fill change, which also satisfies
  reduced motion. Element e2e tests drive every `examples.yaml` item through the dev gallery.
- 2026-10-12 (Phase 4): The engine (`web/js/player/engine.js`) is DOM-free. Wrong graded items are
  re-queued at the end of the pass; an item missed again is re-queued again, so a lesson completes
  only when every graded item has been answered correctly once. XP = base XP ÷ graded items per
  first-try correct answer × combo multiplier (×1 / ×1.5 at 3 / ×2 at 6), plus a 50 % perfect
  bonus; explanation-only lessons award the base XP. The feedback sheet is the kit's bottom sheet
  opened without a scrim (the learner should keep seeing their answer). Enter is handled by the
  player on its root, ignoring events the element already `preventDefault`ed (Wavefront reorder
  handles) and Enter on an element's own buttons (so activating a word-bank chip never also
  checks). Sound effects are three generated WAVs (`server/tools/make_sounds.py`). Persistence is
  stubbed in `web/js/progress.js`: completions in localStorage until Phase 5.
- 2026-10-12 (Phase 5): Alembic runs programmatically at startup (`Database.init()`), so
  `docker compose up` needs no migration step; `tzdata` is a dependency because Windows has no
  system zone database. Item and lesson keys are stored as plain path strings, not foreign keys,
  since content lives on disk (`ilp validate --check-db` reports orphans as warnings). The
  server trusts the client's XP figure (plan §5: no anti-cheat; noted for ARCHITECTURE.md). SRS
  constants live in `srs.SRSConfig`; ratings map correct+fast → good, partial or > 20 s → hard,
  wrong → again, flashcards self-rate. Settings (daily goal, loop toggles, timezone) are stored
  server-side in the `settings` table with localStorage as a paint-first cache. A dev-only
  `POST /api/dev/reset-progress` exists for tests and demos; browser tests reset before each
  test because they share one live server. Time travel is `?now=+30d` (or ISO) on the progress
  endpoints, dev only (Phase 6 uses it from the UI).
- 2026-10-12 (Phase 6): The map is CSS-positioned tiles (`--x`/`--y` in tile units) over an SVG
  of hairline edges, not a canvas, so tiles stay real links/buttons. Units are bands; lessons pack
  into an offset grid of up to four columns; unit `requires` draw an edge from the required
  unit's last tile to the first tile of the requiring unit. Completed tiles link to a per-tile
  re-tune (`/review/s/c?lesson=unit/lesson`), available tiles to the lesson. The wave is a
  `sessionStorage` note left by the player (`rememberWave`) and consumed once by the map
  (`takeWave`); it animates fills only and is skipped under reduced motion. Coverage counts
  incomplete tiles as 0. The SRS clock is the server's (or the dev `?now=` override); a client
  `ts` is stored on the attempt row only, so time-travelled reviews restore strength correctly.
  Review XP is 2 per item and is recorded via `POST /api/review/{s}/{c}/complete` (daily goal
  counts it; no completion row). Time travel is a dev-only field in Settings (`settings.devNow`),
  sent as `?now=` by `progress.js`. The a11y check uses axe-core injected by the test
  (`server/tests/e2e/assets/`, test-only, never served), asserting no serious/critical
  violations and ≥ 95 % passes as a Lighthouse proxy. uvicorn `--reload` on this Windows box
  leaves zombie listening sockets when its workers are killed; the dev server used for manual
  checks now runs without `--reload` (restart it after server changes).
- 2026-10-12 (Phase 7): Streak logic is pure (`progress/streaks.py`): today counts once met,
  otherwise the streak is read from yesterday (midnight rollover never zeroes it); freezes bridge
  a gap only when they can cover all of it, oldest day first, and are consumed automatically
  when the streak is next computed. The day boundary is the local date in the timezone the
  client sends (stored in settings; `?tz=` on reads). The reward table is `server/app/rewards.yaml`;
  odds are public at `GET /api/rewards` and on the profile. Drops roll only on first completions,
  never on repeats, and never when `drops` is off; owned cosmetics re-roll into a stackable
  reward. An XP boost doubles the next completion's XP server-side (`boosted` in the response).
  Cosmetics are `data-tile-shape` / `data-tile-pattern` on the map (radius, clip-path, a pattern
  in the accent soft fill), never a palette change; titles show on the profile. The first-run goal
  picker is a Wavefront `<dialog>` opened when `/api/me` reports `goal_chosen: false`; browser
  tests set `goalChosen` and `drops: false` after each reset so the modal and random XP boosts do
  not interfere. The XP chart and streak calendar are fills on the surface ladder (no SVG).
