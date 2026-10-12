# short-answer

A typed answer. Give `answers:` (a list), `pattern:` (a regex) or both.

| field | type | notes |
|---|---|---|
| `prompt` | markdown | required |
| `answers` | list of strings | any match (after normalisation) is correct |
| `pattern` | string | regex; the whole normalised answer must match |
| `normalize` | object | `case`, `accents`, `punctuation`, `whitespace` (default all `true`) |
| `placeholder` | string | |
| `multiline` | boolean | textarea instead of a single line |
| `explain` | markdown | |
