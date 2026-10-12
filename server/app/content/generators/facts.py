"""``facts`` → recognition (multiple choice), then matching (groups of 4–5), then recall (typed).

Distractors come from sibling facts in the same lesson, then the unit, then the course; the
right answer is never a distractor. With too few distractors a fact falls back to true/false.
"""

from __future__ import annotations

from typing import Any

from ..models import AutoSource, Fact
from . import ArrangeContext, stable_id

NAME = "facts"
MIN_DISTRACTORS = 2
MAX_CHOICES = 4
GROUP = 5
SHORT = 24  # characters: longer definitions are shown, and the term is typed


def _explain(fact: Fact) -> str:
    if fact.hint:
        return f"**{fact.term}**: {fact.definition}. {fact.hint}"
    return f"**{fact.term}**: {fact.definition}."


def _recognition(fact: Fact, facts: list[Fact], ctx: ArrangeContext) -> dict[str, Any]:
    distractors = ctx.distractors(fact, facts, MAX_CHOICES - 1)
    if len(distractors) >= MIN_DISTRACTORS:
        choices = [fact.definition, *distractors]
        return {
            "type": "multiple-choice",
            "id": stable_id("facts-mc", fact.term, fact.definition),
            "prompt": f"**{fact.term}**",
            "choices": choices,
            "answer": 0,
            "shuffle": True,
            "explain": _explain(fact),
        }
    # Too few siblings: a true/false statement, half the time with a wrong pairing.
    wrong = distractors[0] if distractors else None
    use_wrong = wrong is not None and ctx.rng.random() < 0.5
    shown = wrong if use_wrong else fact.definition
    return {
        "type": "true-false",
        "id": stable_id("facts-tf", fact.term, fact.definition, "wrong" if use_wrong else "right"),
        "prompt": f"**{fact.term}**: *{shown}*",
        "answer": not use_wrong,
        "explain": _explain(fact),
    }


def _matching(group: list[Fact], index: int) -> dict[str, Any]:
    return {
        "type": "match-pairs",
        "id": stable_id("facts-match", str(index), *[f"{f.term}={f.definition}" for f in group]),
        "prompt": "Match each term to its definition.",
        "pairs": [{"left": f.term, "right": f.definition} for f in group],
    }


def _recall(fact: Fact) -> dict[str, Any]:
    """Typed recall. The shorter side is typed: a date or a capital is asked from its term, a
    long description is shown and its term is typed (nobody retypes a sentence)."""
    type_term = len(fact.definition) > len(fact.term) and len(fact.definition) > SHORT
    if type_term:
        prompt = f"*{fact.definition}* — type the term."
        answers = [fact.term]
    else:
        prompt = f"**{fact.term}** — type the answer from memory."
        answers = [fact.definition]
    return {
        "type": "short-answer",
        "id": stable_id("facts-recall", fact.term, fact.definition),
        "prompt": prompt,
        "answers": answers,
        "placeholder": "Your answer",
        "explain": _explain(fact),
    }


def generate(source: AutoSource, ctx: ArrangeContext) -> list[dict[str, Any]]:
    facts = list(source.facts)
    if not facts:
        return []
    items: list[dict[str, Any]] = [_recognition(f, facts, ctx) for f in facts]
    # Matching in groups of 4–5 (a group of 2–3 is fine for the tail; a single fact is skipped).
    if len(facts) >= 2:
        groups: list[list[Fact]] = [facts[i : i + GROUP] for i in range(0, len(facts), GROUP)]
        if len(groups) > 1 and len(groups[-1]) == 1:
            groups[-2].append(groups.pop()[0])
        for i, group in enumerate(groups):
            if len(group) >= 2:
                items.append(_matching(group, i))
    items.extend(_recall(f) for f in facts)
    return items
