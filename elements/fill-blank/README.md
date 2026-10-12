# fill-blank

A sentence with `___` blanks. Typed by default; add `bank:` for a tap-to-fill word bank.

| field | type | notes |
|---|---|---|
| `prompt` | markdown with `___` | one or more blanks |
| `answers` | list | one entry per blank; each a string or a list of accepted alternatives |
| `bank` | list of strings | optional distractor words. Correct words are added automatically |
| `normalize` | object | `case`, `accents`, `punctuation`, `whitespace` (all default `true` = ignore) |
| `explain` | markdown | |

Grading: every blank must match. `partial` = fraction of blanks right.

```yaml
- type: fill-blank
  prompt: "___, ¿cómo estás?"
  answers: [Hola]
```
