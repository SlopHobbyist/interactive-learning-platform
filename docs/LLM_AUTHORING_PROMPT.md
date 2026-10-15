# Prompt template: generate a course with an LLM

Copy everything between the rules into a chat with any capable model, fill in the three
placeholders in the first paragraph, and attach (or paste) `content/_schema/llm-context.md`,
which `uv run ilp schema` generates with every installed element's schema and examples.
Then run `uv run ilp validate` on what comes back and paste any errors into the same chat.

---

You are writing a course for an interactive learning platform. The topic is **{TOPIC}**, the
level is **{LEVEL}**, and it should have **{N_UNITS}** unit(s) of 3–5 lessons each.

Produce a file tree of YAML files, exactly in this layout, with every file's full content:

```
content/{subject-slug}/subject.yaml
content/{subject-slug}/{course-slug}/course.yaml
content/{subject-slug}/{course-slug}/01-{unit-slug}/unit.yaml
content/{subject-slug}/{course-slug}/01-{unit-slug}/01-{lesson-slug}.lesson.yaml
content/{subject-slug}/{course-slug}/01-{unit-slug}/02-{lesson-slug}.lesson.yaml
…
```

Format rules (the validator enforces these; the schema file I attached is the exact contract):

1. Slugs are lowercase letters, digits and hyphens. Numeric prefixes order units and lessons.
2. `subject.yaml`: `title`, `icon` (a Material Icons ligature name such as `translate`, `code`,
   `account_balance`, `science`), `description`.
   `course.yaml`: `title`, `description`, `level`, `tags` (list).
   `unit.yaml`: `title`, `description`. Omit `requires`; units unlock in order by default.
3. A lesson file has `title`, `description`, `xp` (10–15) and `items`. Each item has `type`, an
   `id` (unique slug within the lesson) and the fields of its element. Use only these element
   types and only their documented fields:
   `explanation`, `multiple-choice`, `true-false`, `fill-blank`, `short-answer`, `numeric`,
   `match-pairs`, `order`, `flashcard`.
4. Each lesson has 5–10 items: start with an `explanation`, then recognition (`multiple-choice`,
   `true-false`), then matching or ordering, then recall (`fill-blank`, `short-answer`,
   `numeric`), and end with one or two `flashcard`s for the key terms.
5. Every graded item (everything except `explanation` and `flashcard`) has an `explain` of one
   or two sentences saying why the answer is right.
6. `multiple-choice`: 3–5 choices, `answer` is a **0-based** index (or a list of indexes for
   multi-select). Distractors must be plausible and clearly wrong.
7. `fill-blank`: write blanks as `___` in `prompt`, one entry in `answers` per blank, in order.
   Add `bank:` with 2–3 wrong words for word-bank items. Keep `___` outside backticks. Add
   `ordered: false` when the blanks can be filled in any order (e.g. naming members of a list).
8. `short-answer` and `fill-blank`: list every accepted spelling. Comparison ignores case,
   accents, punctuation and spacing.
9. `match-pairs`: 3–6 pairs. `order`: 3–6 steps written in the correct order.
10. Markdown is allowed in prompts, bodies and explanations: bold, italics, lists, tables,
    fenced code with a language name, `$…$` math. Quote any YAML string containing `: `, `#`,
    or a comma inside `{ }`, or starting with `*`, `[` or `"`.
11. Use no images and no links to external sites.
12. For lists of facts (vocabulary, dates, definitions) you may instead write an auto-arranged
    lesson: `arrange: auto` plus `source:` with `notes` (markdown), `facts` (list of
    `{ term, definition, hint? }`) and `cloze` (sentences with `{{answer}}` blanks). The platform
    builds the items. Use this for at most one lesson per unit.

Quality rules:

- One learning goal per lesson; the title says what the learner can do afterwards.
- Prompts are questions. Explanations teach the reason, not just the answer.
- Facts must be correct. If you are unsure of a fact, leave it out.
- Progress from easy to hard inside a lesson and across the unit.

Output the files one after another, each introduced by a line with its path, each body in a
```yaml fenced block. After I run the validator I will paste its messages back, formatted as
`file:line: message`. Fix exactly what each message says and return only the changed files.

---

## After the model answers

```sh
# write the files it produced under content/, then:
uv run ilp validate content/{subject-slug}
```

Paste any `file:line: message` output back into the chat. One fix round is normal; two means
the prompt needs a clearer rule. Then open the course in the app and play one lesson of each
kind before trusting the rest.
