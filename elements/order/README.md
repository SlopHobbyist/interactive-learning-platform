# order

Reorder rows. Uses the Wavefront reorder behaviour: drag, or focus a row and press
`Alt+↑` / `Alt+↓`.

| field | type | notes |
|---|---|---|
| `prompt` | markdown | required |
| `steps` | list of markdown-inline | 2–10 rows, written in the correct order |
| `explain` | markdown | |

Grading: exact order = correct. `partial` = rows in the right position ÷ total.
