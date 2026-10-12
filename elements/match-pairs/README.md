# match-pairs

Two columns, shuffled. Tap an entry on the left then one on the right to pair them; a wrong
pair shakes apart, a right pair locks.

| field | type | notes |
|---|---|---|
| `prompt` | markdown | optional |
| `pairs` | list of `{left, right}` | 2–8 pairs, markdown-inline |
| `explain` | markdown | |

Grading: all pairs correct = correct. `partial` = pairs right first try ÷ total.

Keyboard: `1`–`8` pick on the left, `a`–`h` on the right; the arrow keys move between options and
Enter or Space picks the focused one. Picking on one side moves focus to the other; a matched pair
hands focus to the next open option. The item submits itself when the last pair matches.
