# match-pairs

Two columns, shuffled. Tap an entry on the left then one on the right to pair them; a wrong
pair shakes apart, a right pair locks.

| field | type | notes |
|---|---|---|
| `prompt` | markdown | optional |
| `pairs` | list of `{left, right}` | 2–8 pairs, markdown-inline |
| `explain` | markdown | |

Grading: all pairs correct = correct. `partial` = pairs right first try ÷ total.
