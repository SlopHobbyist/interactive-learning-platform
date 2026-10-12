# flashcard

A flip card. The learner reveals the back and rates their recall: **Again**, **Hard**, **Good**
or **Easy**. The rating is passed straight to the spaced-repetition scheduler. There is no
Check button: this element is *self-graded* (`"self_graded": true` in the manifest).

| field | type | notes |
|---|---|---|
| `front` | markdown | required |
| `back` | markdown | required |
| `hint` | markdown-inline | optional |

Keyboard: `Space` flips, `1`–`4` rate.
