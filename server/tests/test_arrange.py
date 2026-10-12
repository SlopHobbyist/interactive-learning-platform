"""Auto-arrange (Phase 8): deterministic output pinned by snapshots, mixed mode, distractor
rules, the true/false fallback, and the CLI."""

from __future__ import annotations

from pathlib import Path

from server.app.config import REPO_ROOT
from server.app.content.arranger import arrange_lesson_file
from server.app.content.generators import names, registry
from server.app.content.loader import load_content
from server.app.content.validator import validate_index
from server.app.elements.registry import scan_elements

FIX = Path(__file__).parent / "fixtures" / "arrange"
WEST = FIX / "geo" / "capitals" / "01-europe" / "01-west.lesson.yaml"
NORTH = FIX / "geo" / "capitals" / "01-europe" / "02-north.lesson.yaml"


def test_generators_are_discovered_in_order():
    assert names() == ["notes", "facts", "cloze"]
    assert set(registry()) == {"notes", "facts", "cloze"}


def test_snapshots_pin_the_generated_output():
    for lesson, expected in ((WEST, "01-west.yaml"), (NORTH, "02-north.yaml")):
        got = arrange_lesson_file(lesson)
        want = (FIX / "_expected" / expected).read_text(encoding="utf-8")
        assert got == want, f"regenerate with: uv run ilp arrange {lesson} > {expected}"


def test_generated_lessons_validate_and_are_deterministic():
    registry_ = scan_elements(REPO_ROOT / "elements")
    a = load_content(FIX)
    b = load_content(FIX)
    assert [p.format() for p in validate_index(a, registry_)] == []
    west_a = a.lesson("geo", "capitals", "europe", "west")
    west_b = b.lesson("geo", "capitals", "europe", "west")
    assert west_a.generated and west_a.items == west_b.items
    types = [it["type"] for it in west_a.items]
    # notes → MC per fact → one matching group → recall per fact → cloze bank ×2 → cloze typed ×2
    assert types == (
        ["explanation"]
        + ["multiple-choice"] * 3
        + ["match-pairs"]
        + ["short-answer"] * 3
        + ["fill-blank"] * 4
    )
    ids = [it["id"] for it in west_a.items]
    assert len(ids) == len(set(ids)) and all(i.startswith("auto-") for i in ids)
    # Distractors never include the right answer and come from siblings in the unit.
    for it in west_a.items:
        if it["type"] == "multiple-choice":
            assert it["choices"].count(it["choices"][it["answer"]]) == 1
            assert it["choices"][0] in {"Paris", "Madrid", "Lisbon"}
            assert any(
                c in {"Oslo", "Stockholm", "Copenhagen", "Helsinki", "Reykjavik", "Tallinn"}
                for c in it["choices"][1:]
            )
    bank = [it for it in west_a.items if it["type"] == "fill-blank" and "bank" in it]
    typed = [it for it in west_a.items if it["type"] == "fill-blank" and "bank" not in it]
    assert len(bank) == 2 and len(typed) == 2
    assert bank[0]["prompt"] == "The capital of ___ is ___." and bank[0]["answers"] == [
        "Germany",
        "Berlin",
    ]
    assert typed[1]["answers"] == [["Rome", "Roma"]]
    assert all(w.lower() not in {"germany", "berlin"} for w in bank[0]["bank"])


def test_mixed_mode_expands_in_place_and_respects_only():
    index = load_content(FIX)
    north = index.lesson("geo", "capitals", "europe", "north")
    types = [it["type"] for it in north.items]
    assert types[0] == "explanation" and north.items[0]["id"] == "intro"
    assert types[-1] == "true-false" and north.items[-1]["id"] == "outro"
    assert "explanation" not in types[1:-1]  # notes were excluded by `only: [facts]`
    assert types[1:7] == ["multiple-choice"] * 6
    # Six facts → one matching group of 5 + ... no: 6 splits into 5 + 1, and the lone fact joins
    # the previous group, so a single group of 6.
    assert (
        types.count("match-pairs") == 1
        and len([it for it in north.items if it["type"] == "match-pairs"][0]["pairs"]) == 6
    )


def test_too_few_distractors_fall_back_to_true_false(tmp_path: Path):
    root = tmp_path / "content"
    d = root / "s" / "c" / "01-u"
    d.mkdir(parents=True)
    (root / "s" / "subject.yaml").write_text("title: S\n", encoding="utf-8")
    (root / "s" / "c" / "course.yaml").write_text("title: C\n", encoding="utf-8")
    (d / "unit.yaml").write_text("title: U\n", encoding="utf-8")
    (d / "01-a.lesson.yaml").write_text(
        "title: A\narrange: auto\nsource:\n  facts:\n"
        "    - { term: Up, definition: Down }\n    - { term: Hot, definition: Cold }\n",
        encoding="utf-8",
    )
    index = load_content(root)
    lesson = index.lesson("s", "c", "u", "a")
    types = [it["type"] for it in lesson.items]
    assert types == ["true-false", "true-false", "match-pairs", "short-answer", "short-answer"]
    registry_ = scan_elements(REPO_ROOT / "elements")
    assert [p.format() for p in validate_index(index, registry_)] == []
    # Still deterministic across loads.
    assert load_content(root).lesson("s", "c", "u", "a").items == lesson.items


def test_cli_arrange_prints_yaml():
    from typer.testing import CliRunner

    from server.cli import app

    result = CliRunner().invoke(app, ["arrange", str(WEST)])
    assert result.exit_code == 0, result.output
    assert "auto-facts-mc-" in result.output and "title: Western capitals" in result.output
