"""The arranger: turns a lesson's ``source`` into items.

``arrange: auto`` lessons get the full generated sequence; ``- type: auto`` entries inside a
manual ``items:`` list are expanded in place (optionally restricted with ``only: [...]``).
Everything is deterministic: the seed is the lesson path and item ids hash the source material.
"""

from __future__ import annotations

import io
from pathlib import Path
from typing import Any

from .generators import ArrangeContext, names, registry
from .loader import ContentIndex, Course, Lesson, load_content
from .models import AutoSource, Fact


def sibling_facts(course: Course, lesson: Lesson) -> tuple[list[Fact], list[Fact]]:
    unit: list[Fact] = []
    rest: list[Fact] = []
    for other in course.lessons():
        if other is lesson or not other.source:
            continue
        facts = [Fact.model_validate(f) for f in other.source.get("facts", [])]
        (unit if other.unit_id == lesson.unit_id else rest).extend(facts)
    return unit, rest


def arrange_lesson(lesson: Lesson, course: Course) -> list[dict[str, Any]]:
    """Return the lesson's items with every auto part generated."""
    if not lesson.source:
        return [it for it in lesson.items if it.get("type") != "auto"]
    source = AutoSource.model_validate(lesson.source)
    unit_facts, course_facts = sibling_facts(course, lesson)
    ctx = ArrangeContext(seed=lesson.path, unit_facts=unit_facts, course_facts=course_facts)
    gens = registry()

    def run(only: list[str] | None) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for name in names():
            if only and name not in only:
                continue
            out.extend(gens[name](source, ctx))
        return out

    if lesson.arrange == "auto" and not any(it.get("type") == "auto" for it in lesson.items):
        return list(lesson.items) + run(None)
    expanded: list[dict[str, Any]] = []
    for item in lesson.items:
        if item.get("type") == "auto":
            expanded.extend(run(item.get("only")))
        else:
            expanded.append(item)
    return expanded


def expand_auto(index: ContentIndex) -> None:
    """Replace auto parts with generated items, in place, for every lesson in the index."""
    for s in index.subjects:
        for c in s.courses:
            for lsn in c.lessons():
                if lsn.arrange == "auto" or any(it.get("type") == "auto" for it in lsn.items):
                    lsn.items = arrange_lesson(lsn, c)
                    lsn.generated = True


def arrange_lesson_file(path: Path, registry_unused: Any = None, root: Path | None = None) -> str:
    """``ilp arrange <lesson> --print``: the generated items as YAML (to eject to manual layout)."""
    from ruamel.yaml import YAML

    path = path.resolve()
    root = root or _content_root_for(path)
    index = load_content(root)
    target = next((lsn for lsn in index.all_lessons() if lsn.file.resolve() == path), None)
    if target is None:
        raise FileNotFoundError(f"{path} is not a lesson under {root}")
    y = YAML()
    y.indent(mapping=2, sequence=4, offset=2)
    y.width = 100
    buf = io.StringIO()
    y.dump({"title": target.title, "xp": target.xp, "items": target.items}, buf)
    return buf.getvalue()


def _content_root_for(path: Path) -> Path:
    """Walk up from a lesson file to the content root (the parent of the subject directory)."""
    cur = path.parent
    while cur != cur.parent:
        if (cur / "subject.yaml").is_file():
            return cur.parent
        cur = cur.parent
    return path.parents[3]
