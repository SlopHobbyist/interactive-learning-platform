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
   `POST /api/lessons/{path}/complete` (XP, daily log, newly unlocked tiles, coins, chests and
   quest progress) or
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
(`ILP_MODE=multi`, the default in `docker-compose.yaml`) maps Ory Kratos identities to users
(next section), and the first account inherits `local`'s rows.

## Accounts

Credentials are not ours. **Ory Kratos** (`deploy/kratos/`, a service in `docker-compose.yaml`)
owns identities, passwords, sessions and recovery; **Mailpit** is the dummy mail server it sends
recovery codes to (read them at <http://localhost:8025>).

```
browser --/kratos/self-service/...--> app (api/kratos.py proxy) --> kratos:4433 (public API)
browser --/api/... + session cookie--> app --/sessions/whoami--> kratos  (accounts.Kratos, 30 s cache)
kratos  --registration webhook------> app /api/auth/hooks/registration  (Turnstile check)
kratos  --SMTP----------------------> mailpit:1025
```

- **One origin.** The browser runs Kratos's self-service flows as JSON "browser flows"
  (`web/js/lib/kratos.js`) through the `/kratos/` proxy, so there is no CORS and Kratos's CSRF
  and session cookies are first-party. Kratos has no host port. Its `serve.public.base_url` is
  `<ILP_PUBLIC_URL>/kratos/`, so URLs it hands out route back through the proxy. The proxy and the
  whoami client never keep cookies themselves (`accounts.cookieless_jar`): they are shared by
  every browser.
- **Users.** `users.identity_id` links a row to a Kratos identity; `accounts.link_user` creates
  the row on an identity's first request and keeps `users.username` in step with the Kratos
  trait. The identity schema (`deploy/kratos/identity.schema.json`) has two traits, `username`
  and `email`; both are sign-in identifiers, and `email` is the recovery address.
- **Generated passwords.** Learners never choose one. Sign-up and recovery generate 32 random
  printable ASCII characters in the browser (`web/js/lib/password.js`, `crypto.getRandomValues`
  with rejection sampling), submit them to Kratos and show them once with a copy button and an
  "I saved my password" check (`account-ui.passwordReveal`). Kratos's minimum length is 32 and
  its haveibeenpwned lookup is off (no external calls; the passwords are random anyway).
- **Recovery.** `/recover`: email, then a six-digit code by email; Kratos signs the learner in
  with a privileged session and hands over a settings flow, and the browser sets a new generated
  password. `/account` does the same from a signed-in session ("New password"); after 15 minutes
  Kratos asks for the current password first (`/login?refresh=1`).
- **Turnstile.** The browser sends the token as `transient_payload.turnstile`; Kratos posts it to
  the registration webhook (`registration-hook.jsonnet`) *before* storing the identity
  (`response.parse: true`), and a 4xx answer aborts the sign-up with the hook's message. The hook
  has no side effects, so it is unauthenticated. Without `ILP_TURNSTILE_SECRET` it runs in
  **placeholder mode**: the widget is a local "I'm a human" checkbox that yields Cloudflare's
  test token `XXXX.DUMMY.TOKEN.XXXX`, the only token the hook accepts. With a secret the hook
  calls Cloudflare's `siteverify`. The real widget is **not wired**: it must load
  `challenges.cloudflare.com/turnstile/v0/api.js`, which the no-external-assets rule forbids, so
  turning it on needs an explicit exception to that rule. Until then, do not set the secret, or
  sign-up fails.
- **Before going public:** replace the two secrets in `deploy/kratos/kratos.yml`, serve over HTTPS
  and set `COOKIES_SECURE` / `SESSION_COOKIE_SECURE` to `"true"`, set `ILP_PUBLIC_URL`, and point
  Kratos's courier at a real SMTP server instead of Mailpit.

## Subject library

`GET /api/subjects` is the catalog: every subject on disk, shown at `/subjects` with a search
box. Each learner adds the subjects they want (`PUT /api/me/subjects/{s}`, table
`user_subjects`); only those appear on the home page and in the sidebar, so an instance can hold
hundreds of subjects. Removing one (`DELETE`) hides it but keeps its progress. Migration 0002
gave existing learners every subject they already had progress in.

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
`progress/stats.py` (profile). The player's combo meter and hearts are client-side settings.

The economy (`shop_plan.md`) is configuration plus four modules. `economy.yaml` holds coin
payouts, chest contents, the lesson-chest rules and the quest pool; `shop.yaml` is the catalog.
`progress/economy.py` is the coin ledger (`coin_events`; the balance is a sum), capped streak
freezes, the timed XP boost (`users.xp_boost_until`) and the weekly league payout;
`progress/chests.py` the lesson-chest chance (a pure function of a small state read before the
completion is recorded) and opening; `progress/quests.py` the three daily quests, whose progress
is derived from the day's records; `progress/shop.py` buying and equipping;
`progress/streak_tools.py` streak-milestone chests, streak repair and the streak wager
(`wagers` table). The web side is
`web/js/lib/economy.js` (chest cards, quest rows, the boost countdown), `views/shop.js`,
`player/sounds.js` (sound packs under `web/assets/sounds/<pack>/`, made by
`server/tools/make_sounds.py`) and `player/effects.js` (correct-answer effects and lesson-complete celebrations) and
`player/skins.js` (combo meters and progress bars).

## Keyboard and focus

A keyboard user never gets stuck: no click and no Tab is ever needed just to get back to where
keys work. Most learners answer with shortcut keys and Enter rather than Tab, so focus is often
moved for them, and **focus rings follow modality**: `focus.js` sets `data-keyboard-nav` on
`<html>` after Tab or an arrow key and clears it after a click or a typed character; while it
is absent, `app.css` makes `--focus-ring-color` (every ring in the kit) transparent. Three
layers keep keys working:

- **Elements** move focus before they disable the control that has it, and follow the flow (see
  `docs/ELEMENTS.md`, Keyboard).
- **The player** owns Enter (check, then continue; only a link or an un-picked button the
  learner moved to with Tab or the arrows keeps its own Enter, and a textarea its newline), focuses Continue in the same task as the check, holds keys typed while the
  next item mounts and replays them to it (type-ahead), and offers `root.restoreFocus()`: the
  current item, Continue, or the card's button.
- **The shell** (`web/js/lib/focus.js`) is the safety net. When focus falls to `<body>` on its
  own it calls the view's `restoreFocus()`; a key pressed while focus is on `<body>`, or parked on
  a script-only container such as the lesson text a user clicked, is delivered to that home (a
  typed letter lands in the field, Enter checks). A view can claim the whole window with
  `root.keyScope()`: the player does, so after a click on the theme toggle or Check, typed keys
  still answer the item. An open dialog is the home while it is open.
  After navigation the router focuses a view's `[data-autofocus]` control, else the view: back
  from a lesson that is the course's **Continue**, so Enter starts the next lesson. The map is
  one tab stop, on the frontier tile.

## Offline

A service worker (`web/sw.js`, registered outside dev mode) caches the shell, vendored libraries,
element modules and content reads (network-first with cache fallback), so finished-loading
lessons replay offline. Progress, library and account requests (`/api/me/...`, `/kratos/...`)
are network-only; an attempt made offline is lost.

## Testing

`pytest` covers the loader, validator, renderer, SRS, unlocks, streaks, rewards, arranger,
schemas and every API; Playwright (`-m e2e`, same command) covers the shell, every element's
examples (correct and wrong answers, keyboard), the player by mouse/keyboard/touch, keyboard-only
journeys through every demo lesson that fail if focus is ever stranded (`test_keyboard.py`), the map
(decay, re-tune, wave, keyboard, axe), the loops, an auto-arranged lesson, and the 200-tile map
render budget, and the catalog and library. Browser tests share one live server (single mode)
and reset progress before each test. Accounts are covered by API tests against a fake Kratos
(`test_auth.py`) and by `test_accounts_stack.py`, which drives sign-up, sign-in and email
recovery against a real `docker compose up` stack when `ILP_STACK_URL` is set.
