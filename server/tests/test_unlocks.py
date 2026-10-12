"""Frontier rules: default chains, a branching course and a course with no requires."""

from __future__ import annotations

from pathlib import Path

from server.app.content.loader import load_content
from server.app.progress.unlocks import frontier, newly_unlocked, unit_states


def _course(tmp_path: Path, units: dict[str, tuple[list[str] | None, dict[str, list[str] | None]]]):
    """Build a course on disk: {unit: (unit_requires, {lesson: lesson_requires})}."""
    root = tmp_path / "content"
    (root / "s").mkdir(parents=True)
    (root / "s" / "subject.yaml").write_text("title: S\n", encoding="utf-8")
    (root / "s" / "c").mkdir()
    (root / "s" / "c" / "course.yaml").write_text("title: C\n", encoding="utf-8")
    for i, (uid, (ureq, lessons)) in enumerate(units.items()):
        d = root / "s" / "c" / f"{i + 1:02d}-{uid}"
        d.mkdir()
        meta = "title: U\n" + (f"requires: {ureq}\n" if ureq is not None else "")
        (d / "unit.yaml").write_text(meta, encoding="utf-8")
        for j, (lid, lreq) in enumerate(lessons.items()):
            body = "title: L\nitems:\n  - type: explanation\n    body: x\n"
            if lreq is not None:
                body += f"requires: {lreq}\n"
            (d / f"{j + 1:02d}-{lid}.lesson.yaml").write_text(body, encoding="utf-8")
    index = load_content(root)
    assert not index.errors(), [str(p) for p in index.errors()]
    return index.course("s", "c")


def test_default_chain(tmp_path: Path):
    course = _course(tmp_path, {"u1": (None, {"a": None, "b": None}), "u2": (None, {"c": None})})
    assert frontier(course, set()) == {"u1/a": "available", "u1/b": "locked", "u2/c": "locked"}
    assert frontier(course, {"u1/a"}) == {"u1/a": "complete", "u1/b": "available", "u2/c": "locked"}
    assert frontier(course, {"u1/a", "u1/b"})["u2/c"] == "available"
    assert unit_states(course, set()) == {"u1": "available", "u2": "locked"}
    assert unit_states(course, {"u1/a", "u1/b"}) == {"u1": "complete", "u2": "available"}
    assert newly_unlocked(course, {"u1/a"}, {"u1/a", "u1/b"}) == ["u2/c"]


def test_no_requires_everything_open(tmp_path: Path):
    course = _course(tmp_path, {"u1": ([], {"a": [], "b": []}), "u2": ([], {"c": []})})
    assert set(frontier(course, set()).values()) == {"available"}


def test_branching_and_merging(tmp_path: Path):
    #  a → b ─┐
    #  a → c ─┴→ d   (d requires both b and c; e in unit 2 requires unit 1 complete)
    course = _course(
        tmp_path,
        {
            "u1": (None, {"a": [], "b": ["a"], "c": ["a"], "d": ["b", "c"]}),
            "u2": (None, {"e": []}),
        },
    )
    f = frontier(course, {"u1/a"})
    assert f["u1/b"] == "available" and f["u1/c"] == "available" and f["u1/d"] == "locked"
    f = frontier(course, {"u1/a", "u1/b"})
    assert f["u1/d"] == "locked"
    f = frontier(course, {"u1/a", "u1/b", "u1/c"})
    assert f["u1/d"] == "available" and f["u2/e"] == "locked"
    f = frontier(course, {"u1/a", "u1/b", "u1/c", "u1/d"})
    assert f["u2/e"] == "available"
    assert newly_unlocked(course, {"u1/a", "u1/b"}, {"u1/a", "u1/b", "u1/c"}) == ["u1/d"]


def test_cross_unit_lesson_requires(tmp_path: Path):
    # A unit with no unit-level requirement but a lesson that needs a lesson from another unit.
    course = _course(tmp_path, {"u1": (None, {"a": None}), "u2": ([], {"b": ["u1/a"], "c": []})})
    f = frontier(course, set())
    assert f == {"u1/a": "available", "u2/b": "locked", "u2/c": "available"}
    assert frontier(course, {"u1/a"})["u2/b"] == "available"
