"""Loader and validator: the example course is clean, the broken fixtures report precise lines."""

from __future__ import annotations

from pathlib import Path

from server.app.config import REPO_ROOT
from server.app.content.loader import item_hash_id, load_content, slug_of
from server.app.content.validator import validate_index
from server.app.elements.registry import scan_elements

ELEMENTS = REPO_ROOT / "elements"
FIXTURES = Path(__file__).parent / "fixtures"


def test_slugs():
    assert slug_of("01-greetings") == "greetings"
    assert slug_of("03_intro.lesson.yaml") == "intro"
    assert slug_of("07.hello.lesson.yaml") == "hello"
    assert slug_of("12") == "12"
    assert slug_of("subject.yaml") == "subject"


def test_item_hash_is_stable_and_content_sensitive():
    a = item_hash_id("multiple-choice", {"prompt": "x", "answer": 0})
    b = item_hash_id("multiple-choice", {"answer": 0, "prompt": "x"})
    c = item_hash_id("multiple-choice", {"prompt": "y", "answer": 0})
    assert a == b
    assert a != c
    assert a.startswith("multiple-choice-") and len(a) == len("multiple-choice-") + 8


def test_example_content_is_valid():
    registry = scan_elements(ELEMENTS)
    assert registry.problems == []
    assert set(registry.types()) == {
        "code",
        "explanation",
        "multiple-choice",
        "true-false",
        "fill-blank",
        "short-answer",
        "numeric",
        "match-pairs",
        "order",
        "flashcard",
    }
    index = load_content(REPO_ROOT / "content")
    problems = validate_index(index, registry)
    assert [p.format() for p in problems] == []
    course = index.course("example", "demo")
    assert course is not None
    assert [u.id for u in course.units] == ["basics", "practice"]
    # Default requires: previous unit / previous lesson.
    assert course.units[0].requires == []
    assert course.units[1].requires == ["basics"]
    lessons = course.units[0].lessons
    assert lessons[0].requires == []
    assert lessons[1].requires == ["basics/waves"]
    assert lessons[1].path == "example/demo/basics/typing"
    # Every starter element is used somewhere in the example.
    used = {it["type"] for lsn in course.lessons() for it in lsn.items}
    assert used == set(registry.types()) - {"code"}  # code is exercised by fixtures/content


def test_fixture_content_is_valid():
    index = load_content(FIXTURES / "content")
    assert [p.format() for p in validate_index(index, scan_elements(ELEMENTS))] == []
    assert {s.id for s in index.subjects} == {"capitals", "coding"}


def test_broken_fixtures_report_file_and_line(bad_content_dir: Path):
    registry = scan_elements(ELEMENTS)
    index = load_content(bad_content_dir)
    problems = validate_index(index, registry)
    got = {(p.file.relative_to(bad_content_dir).as_posix(), p.line, p.level) for p in problems}
    messages = {p.message for p in problems}

    expected = {
        ("broken/subject.yaml", 3, "error"),  # raw colour
        ("broken/c2/course.yaml", 1, "error"),  # missing title / unknown field
        ("broken/c1/01-u1/unit.yaml", 2, "error"),  # unknown unit in requires
        ("broken/c1/01-u1/01-a.lesson.yaml", 6, "error"),  # duplicate id
        ("broken/c1/01-u1/01-a.lesson.yaml", 10, "error"),  # answer index out of range
        ("broken/c1/01-u1/01-a.lesson.yaml", 11, "error"),  # unknown element
        ("broken/c1/01-u1/01-a.lesson.yaml", 13, "error"),  # missing choices
        ("broken/c1/01-u1/01-a.lesson.yaml", 16, "error"),  # unknown field
        ("broken/c1/01-u1/02-b.lesson.yaml", 5, "error"),  # YAML syntax
        ("broken/c1/01-u1/03-c.lesson.yaml", 2, "error"),  # lesson cycle
        ("broken/c1/01-u1/03-c.lesson.yaml", 5, "error"),  # no blank
        ("broken/c1/01-u1/03-c.lesson.yaml", 9, "error"),  # blank count mismatch
        ("broken/c1/02-u2/unit.yaml", 2, "error"),  # unit cycle
        ("broken/c1/02-u2/unit.yaml", 1, "warning"),  # no lessons
        ("broken/c1/02-u2/01-e.lesson.yaml", 1, "error"),  # no items
        ("broken/c1/03-u3/01-f.lesson.yaml", 2, "error"),  # unknown lesson in requires
    }
    assert expected <= got, expected - got

    def has(fragment: str) -> bool:
        return any(fragment in m for m in messages)

    assert has("not a raw colour")
    assert has("unknown element type 'no-such-element'")
    assert has("installed elements: code, explanation")
    assert has("2 is not a valid index into 'choices' (must be 0..1")
    assert has("missing required field(s): 'choices'")
    assert has("unknown field(s): 'bogus'")
    assert has("duplicate item id 'dup'")
    assert has("YAML syntax error")
    assert has("cycle between lessons: u1/c -> u1/d -> u1/c")
    assert has("cycle between units: u2 -> u3 -> u2")
    assert has("unknown unit 'nope'; units in this course: u1, u2, u3")
    assert has("unknown lesson 'u1/zzz'")
    assert has("must contain at least one blank written as ___")
    assert has("has 2 entries but 'prompt' has 1 blank(s)")
    assert has("lesson has no items")
    assert has("missing required field 'title'")
    assert has("unknown field 'name'")
    assert sum(1 for p in problems if p.level == "error") == 16


def test_course_textbooks(tmp_path: Path):
    """``textbook:`` resolves inside the content root and reports bad paths on their own line."""
    course = tmp_path / "subj" / "c"
    (course / "01-u").mkdir(parents=True)
    (tmp_path / "subj" / "subject.yaml").write_text("title: S\n")
    (course / "01-u" / "unit.yaml").write_text("title: U\n")
    (tmp_path / "_books").mkdir()
    (tmp_path / "_books" / "vol 1.pdf").write_bytes(b"%PDF-1.4 one")
    (course / "guide.epub").write_bytes(b"epub")
    (tmp_path.parent / "outside.pdf").write_bytes(b"x")
    (course / ".hidden").mkdir()
    (course / ".hidden" / "h.pdf").write_bytes(b"x")
    (course / "course.yaml").write_text(
        "title: C\n"
        "textbook:\n"
        "  - file: ../../_books/vol 1.pdf\n"
        "    label: Volume 1\n"
        "  - guide.epub\n"
        "  - missing.pdf\n"
        "  - ../../../outside.pdf\n"
        "  - .hidden/h.pdf\n"
    )
    index = load_content(tmp_path)
    c = index.course("subj", "c")
    assert c is not None
    assert [t.to_summary() for t in c.textbooks] == [
        {
            "label": "Volume 1",
            "filename": "vol 1.pdf",
            "format": "PDF",
            "size": 12,
            "url": "/content/_books/vol%201.pdf",
        },
        {
            "label": "guide.epub",
            "filename": "guide.epub",
            "format": "EPUB",
            "size": 4,
            "url": "/content/subj/c/guide.epub",
        },
    ]
    got = {(p.line, p.message) for p in index.problems if p.file.name == "course.yaml"}
    assert got == {
        (6, "textbook: no such file 'missing.pdf'"),
        (7, "textbook: '../../../outside.pdf' is outside the content directory"),
        (8, "textbook: '.hidden/h.pdf' is hidden"),
    }

    # A single path is fine too.
    (course / "course.yaml").write_text("title: C\ntextbook: guide.epub\n")
    c = load_content(tmp_path).course("subj", "c")
    assert c is not None and [t.path for t in c.textbooks] == ["subj/c/guide.epub"]


def test_missing_element_folder_fails_validation(tmp_path: Path):
    """Deleting an element folder makes content using it fail with a clear message."""
    import shutil

    partial = tmp_path / "elements"
    shutil.copytree(ELEMENTS, partial)
    shutil.rmtree(partial / "flashcard")
    registry = scan_elements(partial)
    assert "flashcard" not in registry
    index = load_content(REPO_ROOT / "content")
    problems = validate_index(index, registry)
    msgs = [p.message for p in problems]
    assert any("unknown element type 'flashcard'" in m for m in msgs)
    assert all("flashcard" in m for m in msgs), msgs
