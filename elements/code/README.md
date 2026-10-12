# code

A small code editor (textarea with line numbers, Tab indents) with **Run**, an output panel and
test cases. Graded: every test must pass; `partial` is the fraction of tests passed.

| field | type | notes |
|---|---|---|
| `prompt` | markdown | required |
| `language` | `python` or `javascript` | required |
| `starter` | string | code in the editor at the start |
| `solution` | string | shown after a miss |
| `tests` | list of `{ name?, stdin?, expect, hidden? }` | 1–10. The whole program runs once per test with `stdin` as its input; `expect` is compared with stdout line by line, trimmed |
| `timeout_ms` | integer | default 5000 per test |
| `explain` | markdown | |

## How code runs

- Everything runs **offline**, on the learner's machine, inside a sandboxed `<iframe
  sandbox="allow-scripts">` (opaque origin, no access to the app or its cookies) which starts a
  Web Worker per run. A timeout terminates the worker.
- **JavaScript**: `console.log` is stdout, `readline()` returns the next stdin line (or `null`).
- **Python**: runs on vendored [Pyodide](../../web/vendor/pyodide/SOURCE.md) 0.27.7, loaded
  lazily the first time a Python item appears. The runtime is about **12 MB** (wasm + standard
  library); the browser caches it after the first lesson. `input()` reads stdin lines; `print`
  writes stdout. No packages beyond the standard library.

```yaml
- type: code
  language: python
  prompt: Read two integers, one per line, and print their sum.
  starter: |
    a = int(input())
    b = int(input())
  tests:
    - { stdin: "2\n3", expect: "5" }
    - { stdin: "10\n-4", expect: "6", hidden: true }
```

Keyboard: `Ctrl/Cmd+Enter` runs; pressed again on code that has already run, it submits. Enter
inside the editor inserts a newline and Tab indents; **Esc, then Tab** (or Shift+Tab) leaves the
editor, so it is never a keyboard trap. Run stays focusable while the code runs.
