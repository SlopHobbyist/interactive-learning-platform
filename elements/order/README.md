# order

Reorder rows. Uses the Wavefront reorder behaviour: drag, or focus a row and press
`Alt+↑` / `Alt+↓`.

| field | type | notes |
|---|---|---|
| `prompt` | markdown | required |
| `steps` | list of markdown-inline | 2–10 rows, written in the correct order |
| `explain` | markdown | |

Grading: exact order = correct. `partial` = rows in the right position ÷ total.

Keyboard: Up/Down choose a row's handle, Space picks the row up, Up/Down move it, Space (or Enter)
drops it, Esc cancels. Enter on a handle that is not held checks.
