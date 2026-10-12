"""Content validation beyond structure: element schemas, references, cycles, rendering.

Messages are written for authors (humans and LLMs) who will fix their YAML from the message
alone, so each one names the field and says what was expected.

Generic schema extensions understood here (documented in docs/ELEMENTS.md):

* ``x-index-of: "<field>"`` on an integer (or array of integers) property: each value must be a
  valid index into the sibling array ``<field>``.
* ``x-blanks: true`` on a string property: the text must contain at least one ``___`` blank.
* ``x-count-of-blanks: "<field>"`` on an array property: its length must equal the number of
  ``___`` blanks in the sibling string ``<field>``.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import jsonschema
from jsonschema import Draft202012Validator

from ..elements.registry import ElementRegistry
from .loader import ContentIndex, Course, Lesson
from .problems import Problem
from .render import RenderContext, RenderError, render_fields
from .yamlio import line_of

BLANK_RE = re.compile(r"_{3,}")
AUTO_TYPE = "auto"

_validator_cache: dict[int, Draft202012Validator] = {}


def _validator_for(schema: dict[str, Any]) -> Draft202012Validator:
    key = id(schema)
    v = _validator_cache.get(key)
    if v is None:
        v = Draft202012Validator(schema)
        _validator_cache[key] = v
    return v


def _describe_schema_error(err: jsonschema.ValidationError) -> str:
    path = ".".join(str(p) for p in err.absolute_path)
    msg = err.message
    if err.validator == "required":
        missing = [m for m in err.validator_value if m not in (err.instance or {})]
        msg = "missing required field(s): " + ", ".join(repr(m) for m in missing)
    elif err.validator == "additionalProperties":
        extra = sorted(set(err.instance) - set(err.schema.get("properties", {})))
        msg = "unknown field(s): " + ", ".join(repr(e) for e in extra)
    elif err.validator == "type":
        msg = f"expected {err.validator_value}, got {type(err.instance).__name__}"
    elif err.validator == "enum":
        msg = f"must be one of {err.validator_value}, got {err.instance!r}"
    elif err.validator in ("oneOf", "anyOf"):
        options = [v.get("type", "?") for v in err.validator_value]
        msg = f"does not match any allowed form ({'/'.join(map(str, options))})"
    elif err.validator in ("minItems", "maxItems", "minimum", "maximum", "minLength"):
        msg = err.message
    return f"{path}: {msg}" if path else msg


def _check_extensions(
    fields: dict[str, Any], schema: dict[str, Any]
) -> list[tuple[list[Any], str]]:
    """Return (loc, message) pairs for x-index-of / x-blanks / x-count-of-blanks violations."""
    out: list[tuple[list[Any], str]] = []
    props = schema.get("properties", {})
    for key, sub in props.items():
        if key not in fields:
            continue
        value = fields[key]
        target = sub.get("x-index-of")
        if target:
            arr = fields.get(target)
            n = len(arr) if isinstance(arr, list) else 0
            values = value if isinstance(value, list) else [value]
            for i, v in enumerate(values):
                if isinstance(v, bool) or not isinstance(v, int) or v < 0 or v >= n:
                    loc = [key, i] if isinstance(value, list) else [key]
                    out.append(
                        (
                            loc,
                            f"{key}: {v!r} is not a valid index into '{target}' "
                            f"(must be 0..{n - 1}; indexes start at 0)",
                        )
                    )
        if sub.get("x-blanks") and isinstance(value, str) and not BLANK_RE.search(value):
            out.append(([key], f"{key}: must contain at least one blank written as ___"))
        counted = sub.get("x-count-of-blanks")
        if counted and isinstance(value, list):
            text = fields.get(counted)
            n_blanks = len(BLANK_RE.findall(text)) if isinstance(text, str) else 0
            if n_blanks and len(value) != n_blanks:
                out.append(
                    (
                        [key],
                        f"{key}: has {len(value)} entries but '{counted}' has {n_blanks} "
                        f"blank(s); give one entry per ___",
                    )
                )
    return out


def validate_item(item: dict[str, Any], registry: ElementRegistry) -> list[tuple[list[Any], str]]:
    """Validate one plain item dict. Returns (loc-within-item, message) pairs."""
    type_ = item.get("type")
    if type_ == AUTO_TYPE:
        return []
    manifest = registry.get(type_) if isinstance(type_, str) else None
    if manifest is None:
        known = ", ".join(registry.types()) or "(none installed)"
        return [(["type"], f"unknown element type {type_!r}; installed elements: {known}")]
    fields = {k: v for k, v in item.items() if k not in {"type", "id"}}
    validator = _validator_for(manifest.schema)
    problems: list[tuple[list[Any], str]] = []
    for err in sorted(validator.iter_errors(fields), key=lambda e: list(e.absolute_path)):
        problems.append((list(err.absolute_path), _describe_schema_error(err)))
    if not problems:
        problems.extend(_check_extensions(fields, manifest.schema))
    return problems


def _check_requires(course: Course, problems: list[Problem]) -> None:
    unit_ids = {u.id for u in course.units}
    for u in course.units:
        for r in u.requires:
            if r not in unit_ids:
                problems.append(
                    Problem(
                        u.dir / "unit.yaml",
                        line_of(u.raw, ["requires"]),
                        f"requires: unknown unit {r!r}; units in this course: "
                        + ", ".join(sorted(unit_ids)),
                    )
                )
            if r == u.id:
                problems.append(
                    Problem(
                        u.dir / "unit.yaml",
                        line_of(u.raw, ["requires"]),
                        "requires: a unit cannot require itself",
                    )
                )
    lesson_keys = {lsn.key for lsn in course.lessons()}
    for lsn in course.lessons():
        for r in lsn.requires:
            if r not in lesson_keys:
                problems.append(
                    Problem(
                        lsn.file,
                        line_of(lsn.raw, ["requires"]),
                        f"requires: unknown lesson {r!r}; use 'lesson-id' for a lesson in this "
                        f"unit or 'unit-id/lesson-id' for another unit",
                    )
                )
            if r == lsn.key:
                problems.append(
                    Problem(
                        lsn.file,
                        line_of(lsn.raw, ["requires"]),
                        "requires: a lesson cannot require itself",
                    )
                )
    # Cycles.
    unit_graph = {u.id: [r for r in u.requires if r in unit_ids] for u in course.units}
    for cycle in _find_cycles(unit_graph):
        u = course.unit(cycle[0])
        if u:
            problems.append(
                Problem(
                    u.dir / "unit.yaml",
                    line_of(u.raw, ["requires"]),
                    "requires: cycle between units: " + " -> ".join(cycle + [cycle[0]]),
                )
            )
    lesson_graph = {
        lsn.key: [r for r in lsn.requires if r in lesson_keys] for lsn in course.lessons()
    }
    for cycle in _find_cycles(lesson_graph):
        lsn = course.lesson_by_key(cycle[0])
        if lsn:
            problems.append(
                Problem(
                    lsn.file,
                    line_of(lsn.raw, ["requires"]),
                    "requires: cycle between lessons: " + " -> ".join(cycle + [cycle[0]]),
                )
            )


def _find_cycles(graph: dict[str, list[str]]) -> list[list[str]]:
    """Return one representative cycle per strongly connected cycle found (DFS)."""
    WHITE, GREY, BLACK = 0, 1, 2
    color = dict.fromkeys(graph, WHITE)
    stack: list[str] = []
    cycles: list[list[str]] = []
    reported: set[str] = set()

    def visit(node: str) -> None:
        color[node] = GREY
        stack.append(node)
        for nxt in graph.get(node, []):
            if color[nxt] == GREY:
                cycle = stack[stack.index(nxt) :]
                key = min(cycle)
                if key not in reported:
                    reported.add(key)
                    cycles.append(cycle)
            elif color[nxt] == WHITE:
                visit(nxt)
        stack.pop()
        color[node] = BLACK

    for n in sorted(graph):
        if color[n] == WHITE:
            visit(n)
    return cycles


def _check_lesson(lesson: Lesson, registry: ElementRegistry, problems: list[Problem]) -> None:
    for i, item in enumerate(lesson.items):
        for loc, msg in validate_item(item, registry):
            problems.append(
                Problem(
                    lesson.file,
                    line_of(lesson.raw, ["items", i, *loc]),
                    f"items[{i}] ({item.get('type')}): {msg}",
                )
            )
        manifest = registry.get(item.get("type", ""))
        if manifest is not None:
            try:
                render_fields(item, manifest.schema, RenderContext())
            except RenderError as exc:
                problems.append(
                    Problem(lesson.file, line_of(lesson.raw, ["items", i]), f"items[{i}]: {exc}")
                )


def validate_index(
    index: ContentIndex, registry: ElementRegistry, only: Path | None = None
) -> list[Problem]:
    """Return every problem in the index (structural ones from the loader included)."""
    problems: list[Problem] = list(index.problems)
    for rp in registry.problems:
        problems.append(Problem(rp.path, 1, rp.message))
    for s in index.subjects:
        for c in s.courses:
            _check_requires(c, problems)
            for lsn in c.lessons():
                _check_lesson(lsn, registry, problems)
    if only is not None:
        only = only.resolve()
        problems = [p for p in problems if _under(p.file, only)]
    return sorted(set(problems), key=lambda p: (p.file.as_posix(), p.line, p.message))


def _under(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root)
        return True
    except ValueError:
        return False
