# explanation

A block of markdown. Not graded: the player shows only a **Continue** button.

| field | type | notes |
|---|---|---|
| `title` | string (markdown-inline) | optional heading |
| `body` | string (markdown) | required. Fenced code is syntax-highlighted; `$…$` / `$$…$$` is rendered with KaTeX; `![alt](file.png)` is resolved relative to the lesson file |

```yaml
- type: explanation
  body: |
    **Hola** means *hello*. Use it any time of day.
```
