# Architecture

Four parts, kept separate on disk and in code. `plan.md` is the build history and the decision
log; this page is the map of what exists.

```
server/    CORE          FastAPI + SQLite. Loads content, renders markdown, serves the API and
                         the static files, keeps progress.
web/       WEB INTERFACE Plain HTML, ES modules and CSS on the Wavefront design system.
                         No build step, no Node, no network beyond its own origin.
elements/  PAGE ELEMENTS Plugins. A folder = an element (manifest + ES module + optional CSS).
content/   COURSE CONTENT YAML only. Subject › Course › Unit › Lesson › Item.
```

## Request flow

1. **Startup.** `server/app/main.py` builds the app: runs Alembic to head (`db/session.py`),
   scans `elements/*/element.json` into the registry (`elements/registry.py`), walks `content/`
   into an in-memory index (`content/loader.py`), expands auto-arranged lessons
   (`content/arranger.py`) and, in dev mode, watches both directories for changes.
2. **Reading content.** `GET /api/courses/{s}/{c}` returns the tree without item bodies;
   `GET /api/lessons/{s}/{c}/{u}/{l}` returns the lesson with every item rendered: each field an
   element schema marks `x-format: markdown|markdown-inline|code` gets a sibling `<field>_html`
   (markdown-it-py + Pygments, sanitised by nh3; math becomes `<span class="math">` for client-side
   KaTeX). The client never parses markdown.
3. **Playing.** The router (`web/js/router.js`) loads `views/lesson.js`, which hands the payload
   to the player (`web/js/player/`). The engine (`engine.js`) is a DOM-free state machine:
   intro → item → checking → feedback → next … → summary, with missed items re-queued. For each
   item the mount layer (`web/js/lib/elements.js`) imports the element's module from
   `/elements/<type>/element.js` and calls `mount(root, ctx)`; the element grades itself
   (`check()` is client-side and synchronous) and the player records what it reports.
4. **Persisting.** The player flushes every attempt to `POST /api/attempts` (the server advances
   the item's spaced-repetition state, `progress/srs.py`) and, at the end, calls
   `POST /api/lessons/{path}/complete` (XP, daily log, newly unlocked tiles, reward drop) or
   `POST /api/review/{s}/{c}/complete`.
5. **The map.** `GET /api/progress/{s}/{c}` returns each lesson's state (locked / available /
   complete, from `progress/unlocks.py`) and strength (mean retrievability of its items ×100).
   `web/js/map/map.js` lays units out as bands and lessons as tiles, draws edges from `requires`,
   and animates the wave to newly unlocked tiles once, from a note the player leaves in
   `sessionStorage`.

## Identity and progress keys

Progress is keyed by content paths, not database foreign keys: `subject/course/unit/lesson` for
lessons and `…/lesson#item_id` for items. Ids are directory and file slugs; an item without `id:`
gets `type-<hash of its content>`, so editing it resets its progress (`ilp ids --write` persists
explicit ids). `ilp validate --check-db` warns about rows whose paths no longer exist.

Every table carries `user_id`. Single-user mode uses one `local` user; multi-user mode
(`ILP_MODE=multi`) adds argon2 accounts and HMAC-signed session cookies, and the first account
registered inherits `local`'s rows by renaming that user.

## Trust model

Grading happens in the browser and the server records what the client reports, including the XP
figure. **This app does not defend against cheating**; it is a personal and small-group tool.
Learner code in the `code` element runs in a Web Worker inside a sandboxed, opaque-origin iframe
with a timeout, so it cannot reach the app's storage or cookies; that is a safety boundary for
mistakes, not a security boundary against a hostile author (content is trusted).

## Plugins (elements)

An element never imports from `web/js/`. Everything it needs arrives through `ctx`
(`item`, `onChange`, `onSubmit`, `ui` = Wavefront's `window.UI`, `lib` = shared helpers). The
manifest's JSON Schema is the whole contract with content: the validator checks items against it,
`ilp schema` folds it into `content/_schema/lesson.schema.json` and `llm-context.md`, and the
server renders its `x-format` fields. Missing or crashing elements degrade to a "skipped" card.
See `docs/ELEMENTS.md`.

## Content generation

`arrange: auto` lessons and `- type: auto` blocks are expanded at load time by generators in
`server/app/content/generators/` (notes, facts, cloze; drop in a module to add one). Output is
deterministic (seeded by the lesson path, ids hashed from the source), validated like hand-written
items, and can be ejected with `ilp arrange <file> --print`. See `docs/AUTHORING.md`.

## Gamification modules

Each loop is its own module and its own setting: `progress/srs.py` (decay and review queues),
`progress/unlocks.py` (frontier), `progress/streaks.py` (streak, freezes, local-day boundary),
`progress/rewards.py` + `rewards.yaml` (drops with public odds, inventory, boosts, cosmetics),
`progress/stats.py` (profile). The player's combo meter and hearts are client-side settings.

## Offline

A service worker (`web/sw.js`, registered outside dev mode) caches the shell, vendored libraries,
element modules and content reads (network-first with cache fallback), so finished-loading
lessons replay offline. Progress endpoints are network-only; an attempt made offline is lost.

## Testing

`pytest` covers the loader, validator, renderer, SRS, unlocks, streaks, rewards, arranger,
schemas and every API; Playwright (`-m e2e`, same command) covers the shell, every element's
examples (correct and wrong answers, keyboard), the player by mouse/keyboard/touch, the map
(decay, re-tune, wave, keyboard, axe), the loops, an auto-arranged lesson, and the 200-tile map
render budget. Browser tests share one live server and reset progress before each test.
