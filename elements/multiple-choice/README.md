# multiple-choice

One question, 2–6 choices, one or several correct answers.

| field | type | notes |
|---|---|---|
| `prompt` | markdown | required |
| `choices` | list of markdown-inline | 2–6 entries |
| `answer` | integer or list of integers | **0-based** index into `choices`. A list makes it multi-select (all must be picked) |
| `shuffle` | boolean | default `true` |
| `explain` | markdown | shown after checking |

Keyboard: `1`–`6` toggle a choice, `Enter` checks.

```yaml
- type: multiple-choice
  prompt: What does **hola** mean?
  choices: [Hello, Goodbye, Please, Thanks]
  answer: 0
  explain: "*Hola* is the all-purpose greeting."
```
