# Writing a page element

An element is a folder in `elements/`. Dropping a folder in installs it; deleting the folder
removes it. Content that uses a missing element fails `ilp validate` with a clear message, and the
player shows a "not installed, skipped" card for it instead of crashing.

```
elements/<type>/
├─ element.json    manifest + JSON Schema for the item's fields   (required)
├─ element.js      ES module implementing the element API         (required)
├─ element.css     optional styles, Wavefront tokens only
├─ examples.yaml   sample items: shown in /dev/elements, driven by the tests
└─ README.md       what it is, its fields, an example
```

## The manifest: `element.json`

```json
{
  "type": "multiple-choice",
  "version": 1,
  "title": "Multiple choice",
  "icon": "radio_button_checked",
  "description": "Pick one (or several) of 2–6 choices.",
  "graded": true,
  "self_graded": false,
  "schema": {
    "type": "object",
    "required": ["prompt", "choices", "answer"],
    "additionalProperties": false,
    "properties": {
      "prompt":  { "type": "string", "x-format": "markdown" },
      "choices": { "type": "array", "minItems": 2, "maxItems": 6,
                   "items": { "type": "string", "x-format": "markdown-inline" } },
      "answer":  { "x-index-of": "choices",
                   "oneOf": [{ "type": "integer", "minimum": 0 },
                             { "type": "array", "items": { "type": "integer", "minimum": 0 } }] },
      "shuffle": { "type": "boolean", "default": true },
      "explain": { "type": "string", "x-format": "markdown" }
    }
  }
}
```

| key | meaning |
|---|---|
| `type` | the value authors write in `- type:`; lowercase, `a-z0-9-` |
| `version` | integer, bump when the schema changes incompatibly |
| `title`, `icon`, `description` | shown in the gallery and docs; `icon` is a Material ligature name |
| `graded` | `false` for things like explanations: the player shows only **Continue** |
| `self_graded` | `true` when the element reports its own result (flashcard ratings): no **Check** button; the element calls `ctx.onSubmit()` |
| `schema` | JSON Schema (draft 2020-12) for the item's fields, **excluding** `type` and `id` |

### Schema extensions the server understands

| extension | on | effect |
|---|---|---|
| `"x-format": "markdown"` | string | rendered server-side to sanitised HTML, delivered as `<field>_html` next to `<field>` |
| `"x-format": "markdown-inline"` | string | same, without the `<p>` wrapper (choices, labels, pairs) |
| `"x-format": "code"` | string | highlighted with Pygments; the sibling `language` field picks the lexer |
| `"x-blanks": true` | string | `___` runs become `<span class="blank" data-blank="n">` in the HTML; the field must contain at least one |
| `"x-index-of": "<field>"` | integer / integer array | every value must be a valid 0-based index into the sibling array |
| `"x-count-of-blanks": "<field>"` | array | the array must have one entry per `___` in the sibling string |

These work inside nested objects and arrays too (`pairs[].left`).

Math written as `$…$` / `$$…$$` in any markdown field is emitted as
`<span class="math" data-display="0|1">TeX</span>`; the app renders it with vendored KaTeX after
mount (`ctx.lib.renderMath(root)` if you add markup later).

## The module: `element.js`

```js
export default {
  type: 'multiple-choice',
  mount(root, ctx) {
    // build the UI inside `root` ...
    return {
      getAnswer() { /* any JSON value, or null when not ready */ },
      check(answer) { /* { correct, partial?, feedback_html?, correct_answer_html? } */ },
      showResult(result) { /* paint correct / wrong, lock input */ },
      focus() { /* move focus to the first control (or the current answer) */ },
      destroy() { /* remove listeners */ },
    };
  },
};
```

`ctx` is:

| field | meaning |
|---|---|
| `item` | the rendered item: every field from the YAML plus `<field>_html` for x-format fields, `id`, `type`, `graded` |
| `lang` | the document language |
| `onChange(ready)` | call whenever readiness changes; `true` enables **Check** |
| `onSubmit()` | ask the player to check now (used after the last pair matches, or by a self-graded element) |
| `ui` | `window.UI` (Wavefront: `init`, `toast`, `lift`, `keepInView`, …) |
| `lib` | shared helpers (below) |

Grading is client-side and synchronous. `check(answer)` must be pure: it may be called with the
value returned by `getAnswer()` and must not touch the DOM; `showResult(result)` does the painting.
`partial` is 0–1 and feeds XP and the spaced-repetition rating (`1` = good, `< 1` = hard, `0` = again).

### Keyboard

The rule for the whole app: **a keyboard user never gets stuck**. They never have to click, or
press Tab, just to get back to where keys work. `server/tests/e2e/test_keyboard.py` plays every
demo lesson with the keyboard alone and holds the app to it.

- **The player owns Enter**: Enter checks, then continues, wherever focus is. It leaves Enter to
  the focused control in three cases: links follow; a `<textarea>` takes a newline (there
  `Ctrl/Cmd+Enter` checks); a button runs its own action (pick, place, Run) **unless it is the
  choice already made**, marked `aria-pressed="true"`. So Enter on a picked option submits it,
  and `Ctrl/Cmd+Enter` submits from any button.
- To keep a key for yourself, handle it and call `event.preventDefault()`; the player ignores a
  key with `defaultPrevented` set (Wavefront's reorder handles rely on this). Call
  `event.stopPropagation()` as well if the player must not see it at all (the code editor's
  Enter). If your control's natural Enter would leave no way to submit (a reorder handle grabs
  on Enter), take Enter back and call `ctx.onSubmit()` (see `elements/order`).
- **Never strand focus.** Disabling, hiding or removing the focused control drops focus to
  `<body>`, where no key reaches anything. Move focus to the next sensible control *before* you
  disable it: the next open pair, the flip button after the hint. For a button that is busy for
  a moment (Run), use `aria-disabled="true"` and a guard instead of `disabled`. The app has a
  safety net (`web/js/lib/focus.js`) that sends focus and the next key to your `focus()`, but
  that jumps to your first control, which is rarely where the user was.
- **Number keys pick options** (`1`–`9`), letters are fine for a second column (`a`–`h`). A key
  that picks something also focuses it, so Enter right after it submits that pick.
- **Arrow keys move between options** in a group, as radios do natively. Give a custom group
  (buttons, a checkbox list, two columns) the same.
- **Focus follows the flow.** When one action makes the next one obvious, move focus there:
  picking a left option moves it to the right column.
- **Type-ahead is free.** Keys pressed while your item is still mounting are held by the player
  and replayed once `focus()` has run, so a fast "Enter, 2, Enter" lands on your element.
- **No keyboard traps.** If a control has to capture Tab (a code editor), give a documented way
  out: in `elements/code`, Esc then Tab leaves the editor.
- Every control must be reachable with Tab and show a visible focus ring. Reuse Wavefront's
  controls and the `.el-*` classes and this is automatic.

### `ctx.lib`

| helper | what it does |
|---|---|
| `html\`…\`` / `raw(html)` / `el(tag, attrs, …children)` / `icon(name)` / `clear(node)` | DOM building; `html` escapes interpolations unless wrapped in `raw()` |
| `escapeHtml(s)`, `plural(n, word)` | text helpers |
| `normalize(text, {case, accents, punctuation, whitespace})` | fold a typed answer; each flag `true` means ignore that difference |
| `matchesAny(given, accepted, opts)`, `matchesPattern(given, regex, opts)` | compare typed answers |
| `parseNumber(text)`, `numberWithin(n, answer, tolerance, 'absolute'|'percent')` | numbers |
| `shuffle(array, seed?)`, `derange(array, seed?)`, `seeded(seed)`, `hashString(s)` | deterministic shuffles; seed with `item.id` so an item looks the same on every mount |
| `renderMath(root)` | render `.math` spans you inserted after mount |
| `prefersReducedMotion()` | respect it for anything that moves |

Elements must not import from `web/js/` directly. Everything they need arrives through `ctx`.

## Styling

Use Wavefront classes first (`.button`, `.input`, `.chip`, `.sortable`, `.choice-*`) and the
element support classes in `web/css/app.css` §06:

| class | role |
|---|---|
| `.el-prompt` | the prompt text (put `.prose` on it too) |
| `.el-options` / `.el-options-row` | a column / a two-up row of options |
| `.el-option` | one option (a `<label>` with a hidden input, or a `<button aria-pressed>`); add `.is-correct`, `.is-wrong`, `.is-missed`, `.is-locked` after checking |
| `.el-key` | the number-key badge inside an option |
| `.el-input` | a typed field (`.input` + this); add `.is-valid` / `.is-invalid` |
| `.el-blank`, `.el-slot` | an inline blank: input (typed) or button (word bank) |
| `.el-bank` | the word bank: `button.chip.chip-clickable`, `.is-used` when spent |

If the element needs more, put it in its own `element.css` using **tokens only**
(`var(--color-…)`, `var(--space-…)`). Never a raw colour, never a border or shadow for a state, no
gradients, no glow, no scale on hover. State is a change of fill.

## Walkthrough: a tiny `yes-no` element

1. `elements/yes-no/element.json`

   ```json
   { "type": "yes-no", "version": 1, "title": "Yes or no", "icon": "thumbs_up_down", "graded": true,
     "schema": { "type": "object", "required": ["prompt", "answer"], "additionalProperties": false,
       "properties": { "prompt": { "type": "string", "x-format": "markdown" },
                       "answer": { "type": "string", "enum": ["yes", "no"] },
                       "explain": { "type": "string", "x-format": "markdown" } } } }
   ```

2. `elements/yes-no/element.js`

   ```js
   export default {
     type: 'yes-no',
     mount(root, ctx) {
       const { item, lib: { html, raw, el } } = ctx;
       let value = null;
       const buttons = ['yes', 'no'].map((v, i) =>
         el('button', { type: 'button', class: 'el-option', 'aria-pressed': 'false', 'data-value': v },
           el('span', { class: 'el-key', 'aria-hidden': 'true' }, String(i + 1)), v));
       buttons.forEach((b) => b.addEventListener('click', () => {
         value = b.dataset.value;
         buttons.forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
         ctx.onChange(true);
       }));
       root.append(html`<div class="prose el-prompt mb-4">${raw(item.prompt_html)}</div>
                        <div class="el-options-row">${buttons}</div>`);
       return {
         getAnswer: () => value,
         check: (a) => ({ correct: a === item.answer, feedback_html: item.explain_html || '',
                          correct_answer_html: item.answer }),
         showResult(r) { buttons.forEach((b) => { b.disabled = true;
           b.classList.add(b.dataset.value === item.answer ? 'is-correct' : b.dataset.value === value ? 'is-wrong' : 'is-locked'); }); },
         focus() { buttons[0].focus(); },
         destroy() {},
       };
     },
   };
   ```

3. `elements/yes-no/examples.yaml`

   ```yaml
   - id: sky
     prompt: Is the sky blue?
     answer: "yes"
   ```

4. Open `/dev/elements?type=yes-no` (with `ILP_DEV=1`) and press **Check**. Run
   `uv run ilp schema` so editors learn the new type, and `uv run ilp validate`.

## Rules

- **Tokens only, fills for state.** See above.
- **No external assets.** No CDN scripts, fonts or images. Vendor anything you need under
  `web/vendor/` and document it in a `SOURCE.md`.
- **No build step.** Plain ES modules.
- **Accessibility.** Keyboard operable without getting stuck (see Keyboard), visible focus,
  `aria-pressed` / real inputs for selection,
  an `aria-live` region for progress an eye would otherwise see (the match element's "2 of 4").
- **Deterministic.** Seed shuffles with `item.id`.
- **Never throw from `check()`.** If you cannot grade, return `{ correct: false }` with feedback.
- **Keep the schema honest.** `additionalProperties: false`, `required` for what you need, a
  `description` on anything an author could get wrong. Authors and LLMs read your schema.
