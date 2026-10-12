# numeric

A number input.

| field | type | notes |
|---|---|---|
| `prompt` | markdown | required |
| `answer` | number | required |
| `tolerance` | number ≥ 0 | default 0 |
| `tolerance_type` | `absolute` or `percent` | default `absolute` |
| `unit` | string | shown after the input |
| `explain` | markdown | |

Commas and spaces in the typed value are ignored; a decimal comma is accepted.
