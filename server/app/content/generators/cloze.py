"""``cloze`` → fill-blank items: a word-bank variant first, a typed variant second.

A sentence like ``The capital of {{Germany}} is {{Berlin}}.`` becomes the prompt
``The capital of ___ is ___.`` with answers ``[Germany, Berlin]``. Alternatives can be written
as ``{{colour|color}}``. Bank distractors are the other blanks in the lesson, then fact terms and
definitions from the unit and course.
"""

from __future__ import annotations

import re
from typing import Any

from ..models import AutoSource
from . import ArrangeContext, stable_id

NAME = "cloze"
BLANK = re.compile(r"\{\{(.+?)\}\}")
MAX_DISTRACTORS = 3


def split(sentence: str) -> tuple[str, list[list[str]]]:
    answers: list[list[str]] = []

    def repl(m: re.Match[str]) -> str:
        answers.append([a.strip() for a in m.group(1).split("|") if a.strip()])
        return "___"

    prompt = BLANK.sub(repl, sentence)
    return prompt, answers


def generate(source: AutoSource, ctx: ArrangeContext) -> list[dict[str, Any]]:
    sentences = [s for s in source.cloze if BLANK.search(s)]
    if not sentences:
        return []
    parsed = [split(s) for s in sentences]
    all_words = [alts[0] for _, answers in parsed for alts in answers]
    sibling_words = [f.term for f in ctx.unit_facts + ctx.course_facts] + [
        f.definition for f in ctx.unit_facts + ctx.course_facts
    ]
    bank_items: list[dict[str, Any]] = []
    typed_items: list[dict[str, Any]] = []
    for sentence, (prompt, answers) in zip(sentences, parsed, strict=True):
        own = {a.lower() for alts in answers for a in alts}
        pool = [w for w in all_words + sibling_words if w.lower() not in own]
        seen: set[str] = set()
        distractors: list[str] = []
        local = ctx.rng.__class__(f"{ctx.seed}:cloze:{sentence}")
        local.shuffle(pool)
        for w in pool:
            if w.lower() in seen:
                continue
            seen.add(w.lower())
            distractors.append(w)
            if len(distractors) >= MAX_DISTRACTORS:
                break
        answer_field = [alts[0] if len(alts) == 1 else alts for alts in answers]
        bank_items.append(
            {
                "type": "fill-blank",
                "id": stable_id("cloze-bank", sentence),
                "prompt": prompt,
                "answers": [list(a) if isinstance(a, list) else a for a in answer_field],
                "bank": distractors,
            }
        )
        typed_items.append(
            {
                "type": "fill-blank",
                "id": stable_id("cloze-typed", sentence),
                "prompt": prompt,
                "answers": [list(a) if isinstance(a, list) else a for a in answer_field],
            }
        )
    return bank_items + typed_items
