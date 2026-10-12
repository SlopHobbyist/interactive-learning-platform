"""Auto-arrange generators (plan §4b, §Phase 8).

A generator is a plain function ``(source: AutoSource, ctx: ArrangeContext) -> list[dict]``
registered under a name. Every module in this package that defines ``NAME`` and ``generate`` is
picked up automatically, so adding a generator is a matter of dropping in a module.

Generated items are plain item dicts (``type``, ``id``, element fields). Ids are stable: they are
derived from the generator name and a hash of the source material, so progress survives reloads
and unrelated edits. Order is deterministic: the random seed is the lesson path.
"""

from __future__ import annotations

import hashlib
import importlib
import pkgutil
import random
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from ..models import AutoSource, Fact

Generator = Callable[[AutoSource, "ArrangeContext"], list[dict[str, Any]]]

# The order generators run in when a lesson does not restrict them with `only`.
DEFAULT_ORDER = ("notes", "facts", "cloze")


@dataclass
class ArrangeContext:
    seed: str  # the lesson path
    unit_facts: list[Fact] = field(default_factory=list)  # facts in sibling lessons of the unit
    course_facts: list[Fact] = field(default_factory=list)  # facts elsewhere in the course
    rng: random.Random = field(default_factory=random.Random)

    def __post_init__(self) -> None:
        self.rng = random.Random(self.seed)

    def distractors(self, fact: Fact, own: list[Fact], n: int) -> list[str]:
        """Up to ``n`` definitions that are not the right answer, nearest siblings first."""
        out: list[str] = []
        seen = {fact.definition.strip().lower()}
        for pool in (own, self.unit_facts, self.course_facts):
            candidates = [f.definition for f in pool if f.definition.strip().lower() not in seen]
            # Deterministic but varied: shuffle each pool with a seed derived from the fact.
            local = random.Random(f"{self.seed}:{fact.term}:{len(out)}")
            local.shuffle(candidates)
            for c in candidates:
                key = c.strip().lower()
                if key in seen:
                    continue
                seen.add(key)
                out.append(c)
                if len(out) >= n:
                    return out
        return out


def stable_id(kind: str, *parts: str) -> str:
    digest = hashlib.sha1("\x1f".join(parts).encode("utf-8")).hexdigest()[:8]
    return f"auto-{kind}-{digest}"


_REGISTRY: dict[str, Generator] | None = None


def registry() -> dict[str, Generator]:
    """Discover generator modules in this package (once)."""
    global _REGISTRY
    if _REGISTRY is None:
        found: dict[str, Generator] = {}
        for info in pkgutil.iter_modules(__path__):
            if info.name.startswith("_"):
                continue
            mod = importlib.import_module(f"{__name__}.{info.name}")
            name = getattr(mod, "NAME", None)
            fn = getattr(mod, "generate", None)
            if isinstance(name, str) and callable(fn):
                found[name] = fn
        _REGISTRY = found
    return _REGISTRY


def names() -> list[str]:
    ordered = [n for n in DEFAULT_ORDER if n in registry()]
    extra = sorted(n for n in registry() if n not in DEFAULT_ORDER)
    return ordered + extra
