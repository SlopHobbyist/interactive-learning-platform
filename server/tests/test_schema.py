"""`ilp schema`: JSON Schemas per level, the combined lesson schema, and llm-context.md."""

from __future__ import annotations

import json
from pathlib import Path

import jsonschema

from server.app.config import REPO_ROOT
from server.app.content.llm_context import build_llm_context, write_llm_context
from server.app.content.schema import build_schemas, write_schemas
from server.app.content.yamlio import load_yaml, to_plain
from server.app.elements.registry import scan_elements


def test_lesson_schema_accepts_example_content_and_rejects_bad_items():
    registry = scan_elements(REPO_ROOT / "elements")
    schemas = build_schemas(registry)
    lesson_schema = schemas["lesson.schema.json"]
    validator = jsonschema.Draft202012Validator(lesson_schema)
    for path in (REPO_ROOT / "content").rglob("*.lesson.yaml"):
        data = to_plain(load_yaml(path))
        errors = list(validator.iter_errors(data))
        assert errors == [], (path, [e.message for e in errors][:3])
    bad = {
        "title": "x",
        "items": [{"type": "multiple-choice", "prompt": "p", "choices": ["a", "b"]}],
    }
    assert list(validator.iter_errors(bad))  # answer missing
    bad = {"title": "x", "items": [{"type": "nope", "prompt": "p"}]}
    assert list(validator.iter_errors(bad))
    auto = {
        "title": "x",
        "arrange": "auto",
        "source": {"facts": [{"term": "a", "definition": "b"}]},
    }
    assert list(validator.iter_errors(auto)) == []
    mixed = {
        "title": "x",
        "source": {"cloze": ["{{a}} b"]},
        "items": [{"type": "auto", "only": ["cloze"]}],
    }
    assert list(validator.iter_errors(mixed)) == []


def test_committed_schemas_are_current(tmp_path: Path):
    """`content/_schema/` is shipped in the repo; fail when it drifts from the elements."""
    registry = scan_elements(REPO_ROOT / "elements")
    paths = [*write_schemas(registry, tmp_path), write_llm_context(registry, tmp_path)]
    for fresh in paths:
        committed = REPO_ROOT / "content" / "_schema" / fresh.name
        assert committed.read_text(encoding="utf-8") == fresh.read_text(encoding="utf-8"), (
            f"{fresh.name} is stale: run `uv run ilp schema`"
        )


def test_write_schemas_and_llm_context(tmp_path: Path):
    registry = scan_elements(REPO_ROOT / "elements")
    written = write_schemas(registry, tmp_path)
    assert {p.name for p in written} == {
        "subject.schema.json",
        "course.schema.json",
        "unit.schema.json",
        "lesson.schema.json",
    }
    lesson = json.loads((tmp_path / "lesson.schema.json").read_text(encoding="utf-8"))
    variants = lesson["properties"]["items"]["items"]["oneOf"]
    assert {v["title"] for v in variants} == set(registry.types()) | {"auto"}
    assert lesson["$schema"].startswith("https://json-schema.org/")

    path = write_llm_context(registry, tmp_path)
    text = path.read_text(encoding="utf-8")
    assert path.name == "llm-context.md"
    for t in registry.types():
        assert f"### `{t}`" in text
        assert registry.get(t).title in text
    assert "```json" in text and "Examples:" in text
    assert "What does **hola** mean?" in text  # an example made it in
    assert "arrange: auto" in text
    assert build_llm_context(registry) == text
