# Writing content

Content is YAML files on disk. No code, no database, no build step: drop files in, run
`ilp validate`, reload. This page is the full format reference, written for humans and for LLMs
alike. If you are an LLM, also read the generated `content/_schema/llm-context.md`, which lists
every installed element's exact schema and examples.

## 1. The tree

```
content/
└─ spanish/                      SUBJECT   (directory + subject.yaml)
   ├─ subject.yaml
   └─ a1/                        COURSE    (directory + course.yaml)
      ├─ course.yaml
      └─ 01-greetings/           UNIT      (directory + unit.yaml)
         ├─ unit.yaml
         ├─ 01-hello.lesson.yaml LESSON    (one file per lesson)
         ├─ 02-how-are-you.lesson.yaml
         └─ assets/              images referenced from lessons (optional)
```

Hierarchy: **Subject › Course › Unit › Lesson › Item**.

- **Ids are the slugs.** Directory and file names become ids. A numeric prefix sets the order and
  is stripped: `01-greetings` → `greetings`, `02-how-are-you.lesson.yaml` → `how-are-you`.
  Slugs are lowercase letters, digits, `-` and `_`. An `id:` key in the YAML overrides the slug.
- Directories starting with `_` or `.` are ignored (`content/_schema/` holds generated schemas).
- Progress is keyed by `subject/course/unit/lesson#item_id`. Renaming any of these orphans the
  progress underneath it.

## 2. The four metadata files

### subject.yaml

```yaml
title: Spanish
icon: translate          # Material icon ligature name; default "school"
description: Everyday Spanish, starting from your first hello.
# color: primary         # optional design-token name, never a raw colour
```

### course.yaml

```yaml
title: Spanish A1
description: Greet people, ask how they are and introduce yourself.
level: A1                # free text: A1, beginner, intermediate…
tags: [language, beginner]
```

### unit.yaml

```yaml
title: Greetings
description: Hello, goodbye, how are you, and who you are.
# requires: [other-unit]   # unit ids in this course that must be complete first.
                           # Default: the previous unit. [] makes the unit available at once.
```

### *.lesson.yaml

```yaml
title: Hello and goodbye
description: The greetings you will use every single day.   # optional, shown in lists
xp: 10                     # optional, default 10
# requires: [hello]        # lesson ids that must be complete first: "hello" (same unit) or
                           # "greetings/hello" (another unit). Default: the previous lesson.
# map: { x: 2, y: 1 }      # optional position override on the course map
items:
  - type: explanation
    body: ...
```

Put `# yaml-language-server: $schema=../../../_schema/lesson.schema.json` on the first line and
editors that understand JSON Schema (VS Code with the YAML extension) will autocomplete every
field. Generate the schemas with `uv run ilp schema`.

## 3. Items

Every entry in `items:` is one page element. The shape is always:

```yaml
- type: <element type>     # required: one of the installed elements (see §4)
  id: <slug>               # optional but recommended; see "Ids" below
  <element fields…>
```

**Ids.** When `id` is missing, the platform uses `<type>-<hash of the item's content>`, so editing
an item's text resets its progress. Give items explicit ids before learners start using a course,
or run `uv run ilp ids --write` to fill them in. Ids must be unique inside the lesson.

**Markdown.** Fields marked *markdown* accept CommonMark plus tables and strikethrough. Fenced code
blocks are syntax-highlighted (name the language after the backticks). `$…$` and `$$…$$` render as
math. Images use `![alt](assets/file.svg)` with a path relative to the lesson file. *markdown-inline*
fields (choices, pairs, steps) take bold, italics, code and links but no paragraphs or blocks.

**Explain.** Every graded element has an optional `explain` (markdown) shown after checking,
whether the learner was right or wrong. Write one for every graded item. It is the part that teaches.

## 4. The elements

The starter set. `uv run ilp schema` writes the exact JSON Schema for each one to
`content/_schema/lesson.schema.json`; each element also has a README in `elements/<type>/`.

### explanation — ungraded text

```yaml
- type: explanation
  title: Saying hello            # optional heading (markdown-inline)
  body: |                        # markdown
    **Hola** means *hello*. Use it any time of day.

    | Spanish | English |
    |---|---|
    | Buenos días | Good morning |
```

### multiple-choice — one or several correct answers

```yaml
- type: multiple-choice
  prompt: What does **hola** mean?           # markdown
  choices: [Hello, Goodbye, Please, Thanks]  # 2–6, markdown-inline
  answer: 0                                  # 0-based index, or a list for multi-select: [0, 2]
  shuffle: true                              # default true; set false when order matters ("which line is first")
  explain: "*Hola* is the all-purpose greeting."
```

A list `answer` makes the item multi-select: every listed choice must be picked, and no others.

### true-false — a statement

```yaml
- type: true-false
  prompt: "**Tú** is the informal word for *you*."
  answer: true
  labels: [Yes, No]                          # optional, default [True, False]
  explain: The formal *you* is **usted**.
```

### fill-blank — typed, or picked from a word bank

```yaml
- type: fill-blank
  prompt: "Me ___ Ana. ¿Y tú, cómo te ___?"  # one ___ (3+ underscores) per blank
  answers: [llamo, llamas]                   # one entry per blank, in order
  bank: [llama, llamáis]                     # optional: extra WRONG words. Correct ones are added automatically.
  normalize: { case: true, accents: true, punctuation: true, whitespace: true }  # defaults; true = ignore
  explain: "*Me llamo* / *te llamas* — the ending changes with the person."
```

An entry in `answers` may be a list of accepted alternatives: `answers: [[len, "len()"]]`.
Blanks inside backticks are not recognised; keep `___` outside code spans.

### short-answer — a typed answer

```yaml
- type: short-answer
  prompt: How do you say *thank you* in Spanish?
  answers: [gracias]                         # any match (after normalisation) is correct
  # pattern: "^[2468]$"                      # alternative or addition: a regex the whole answer must match
  placeholder: type your answer              # optional
  multiline: false                           # optional
  normalize: { case: true, accents: true, punctuation: true, whitespace: true }
  explain: "**Gracias.**"
```

Give `answers`, `pattern`, or both. For code output, list the exact text: `answers: ["1024"]`.

### numeric — a number with tolerance

```yaml
- type: numeric
  prompt: What is $\pi$ to two decimal places?
  answer: 3.14
  tolerance: 0.005                           # optional, default 0
  tolerance_type: absolute                   # or percent
  unit: ""                                   # optional, shown after the input (km/s)
  explain: π ≈ 3.14159…
```

### match-pairs — two shuffled columns

```yaml
- type: match-pairs
  prompt: Match the Spanish greeting to its meaning.   # optional
  pairs:                                               # 2–8 pairs, markdown-inline
    - { left: Hola, right: Hello }
    - { left: Adiós, right: Goodbye }
    - { left: "¿Cómo estás?", right: "How are you?" } # quote anything with a comma or colon
  explain: "*Hasta* means *until*."
```

Partial credit is the fraction of pairs matched first try.

### order — put rows in sequence

```yaml
- type: order
  prompt: Put these events in chronological order.
  steps:                                     # 2–10 rows, written in the CORRECT order; shuffled for the learner
    - Boston Tea Party (1773)
    - Declaration of Independence (1776)
    - Treaty of Paris (1783)
  explain: Tea, declaration, peace.
```

For code, wrap each line in backticks and keep the indentation inside them:
`` - "`    return result`" ``.

### flashcard — self-rated recall

```yaml
- type: flashcard
  front: "**hola**"                          # markdown
  back: hello                                # markdown
  hint: a greeting                           # optional, markdown-inline
```

The learner reveals the back and rates it *again / hard / good / easy*. No `explain`: the back is
the explanation. Flashcards feed spaced repetition directly.

## 5. Auto-arrange: give facts, get a lesson

For vocabulary, dates, definitions and anything else that is a list of pairs, let the platform
build the items. Set `arrange: auto` and supply a `source`:

```yaml
title: Key dates
arrange: auto
source:
  notes: |                       # optional markdown; becomes an opening explanation
    The whole Revolution fits in a decade.
  facts:                         # term ↔ definition pairs
    - { term: Boston Tea Party, definition: "1773" }
    - { term: Declaration of Independence, definition: "1776", hint: 4 July }
  cloze:                         # sentences with {{blanks}}; the text inside braces is the answer
    - "The Declaration was adopted on 4 July {{1776}}."
    - "The first shots were fired at {{Lexington}} in {{1775}}."
```

The arranger produces, in order: the notes as an explanation, multiple-choice recognition for each
fact (distractors drawn from the other facts in the lesson, then the unit, then the course; the
right answer is never a distractor), match-pairs in groups of 4–5, short-answer recall, then
fill-blank for each cloze sentence (word-bank first, typed second). Output is deterministic: the
same file always gives the same items and ids.

Two details worth knowing when you write facts:

- **Recall types the shorter side.** A short definition (a date, a capital, up to about 24
  characters) is typed from its term; a long definition is shown and the *term* is typed. Keep
  terms short and unambiguous so they can be typed.
- **Too few facts fall back to true/false.** Multiple choice needs at least two distractors. A
  lesson (or unit, or course) with only one or two facts gets true/false statements instead.
- `{{Rome|Roma}}` in a cloze sentence accepts either spelling.

**Mixing.** A hand-written lesson can include one auto block among its items:

```yaml
source:
  facts: [...]
items:
  - type: explanation
    body: ...
  - type: auto                   # expands to the generated items here
    only: [facts]                # optional: notes | facts | cloze
  - type: true-false
    ...
```

Run `uv run ilp arrange <lesson file> --print` to see the generated YAML; paste it into `items:`
if you want to hand-edit the result ("eject" from auto mode).

## 6. Style guide

- **Lesson length: 5–10 items, 3–10 minutes.** Open with a short explanation, close with the
  hardest recall. Split anything longer into two lessons.
- **One idea per lesson.** The title should say what the learner can do afterwards.
- **Explain every graded item.** One or two sentences: why the answer is right, and what the
  tempting wrong answer gets wrong.
- **Distractors must be plausible and unambiguously wrong.** Same part of speech, same length,
  same register. Never two defensible answers unless the item is multi-select.
- **Prompts are questions, not instructions.** "What does *hola* mean?" rather than "Translate".
- **Vary the element.** Recognition (multiple-choice, true-false) before recall (fill-blank,
  short-answer). Matching and ordering for sets. Flashcards for raw vocabulary.
- **Typed answers need every accepted spelling.** List alternatives; the normaliser already
  ignores case, accents, punctuation and extra spaces unless you turn that off.
- **Code goes in fenced blocks** inside `prompt`, with the language named. Ask for exact output
  with `short-answer`, for a number with `numeric`, for structure with `order`.
- **Images live next to the lesson** (`assets/`), are referenced relatively, and have alt text.
  No external URLs: the app never loads anything from another origin.
- **Quote YAML strings** that contain `: `, `#`, `,` inside `{ }`, or start with `*`, `[`, `"`.

## 7. The validate loop

```sh
uv run ilp validate                     # whole content tree
uv run ilp validate content/spanish     # one subject (or course, unit, lesson file)
uv run ilp schema                       # regenerate content/_schema/*.json and llm-context.md
uv run ilp ids --write                  # persist generated item ids into the files
uv run ilp new lesson content/spanish/a1/01-greetings/05-numbers   # template
```

`validate` prints one problem per line as `file:line: message` and exits non-zero on errors.
Messages name the field and what was expected:

```
content/spanish/a1/01-greetings/02-how-are-you.lesson.yaml:27: items[1] (fill-blank): answers: has 2 entries but 'prompt' has 1 blank(s); give one entry per ___
content/x/c/u/01-a.lesson.yaml:11: items[2] (no-such-element): unknown element type 'no-such-element'; installed elements: explanation, fill-blank, …
content/x/c/u/unit.yaml:2: requires: unknown unit 'nope'; units in this course: u1, u2, u3
```

It checks: YAML syntax, the structure of every file, each item against its element's schema,
answer indexes, blank counts, duplicate ids, `requires` targets and cycles, and that every
markdown field renders. Fix, re-run, repeat until it prints `OK`.

Content reloads on the next request while the server runs (`ILP_DEV=1`), so you can edit a lesson
and refresh the browser.
