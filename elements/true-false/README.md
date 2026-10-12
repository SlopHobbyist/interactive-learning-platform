# true-false

A statement with two large buttons.

| field | type | notes |
|---|---|---|
| `prompt` | markdown | required |
| `answer` | boolean | required |
| `labels` | [string, string] | optional button labels (default True / False) |
| `explain` | markdown | |

Keyboard: `1` = first button, `2` = second, the arrow keys move between them. Enter picks the
focused button; Enter on the picked one checks.
