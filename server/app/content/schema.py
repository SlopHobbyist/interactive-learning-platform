"""Generate JSON Schemas for the content format (``ilp schema``).

Writes one schema per level into ``content/_schema/`` plus a combined ``lesson.schema.json`` whose
``items`` is a ``oneOf`` over every installed element. YAML files can reference it with
``# yaml-language-server: $schema=../../_schema/lesson.schema.json`` for editor completion.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..elements.registry import ElementRegistry
from .models import CourseMeta, LessonFile, SubjectMeta, UnitMeta

SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema"


def _base(model: type, title: str) -> dict[str, Any]:
    schema = model.model_json_schema()
    schema["$schema"] = SCHEMA_DIALECT
    schema["title"] = title
    return schema


def element_variant(type_: str, manifest_schema: dict[str, Any], graded: bool) -> dict[str, Any]:
    """The lesson-item form of an element: its schema plus the shared ``type``/``id`` keys."""
    props: dict[str, Any] = {
        "type": {"const": type_, "description": "Element type."},
        "id": {
            "type": "string",
            "pattern": "^[a-z0-9][a-z0-9_-]*$",
            "description": "Stable id for progress tracking. Optional; generated from content "
            "when missing (so editing the item resets its progress).",
        },
    }
    props.update(manifest_schema.get("properties", {}))
    variant: dict[str, Any] = {
        "type": "object",
        "title": type_,
        "properties": props,
        "required": ["type", *manifest_schema.get("required", [])],
        "additionalProperties": manifest_schema.get("additionalProperties", False),
    }
    for key in (
        "description",
        "anyOf",
        "oneOf",
        "allOf",
        "if",
        "then",
        "else",
        "dependentRequired",
    ):
        if key in manifest_schema:
            variant[key] = manifest_schema[key]
    variant["x-graded"] = graded
    return variant


AUTO_ITEM_VARIANT: dict[str, Any] = {
    "type": "object",
    "title": "auto",
    "description": "Insert the auto-arranged items generated from the lesson's 'source' here.",
    "properties": {
        "type": {"const": "auto"},
        "only": {
            "type": "array",
            "items": {"type": "string", "enum": ["notes", "facts", "cloze"]},
            "description": "Restrict to some generators (default: all).",
        },
    },
    "required": ["type"],
    "additionalProperties": False,
}


def build_schemas(registry: ElementRegistry) -> dict[str, dict[str, Any]]:
    subject = _base(SubjectMeta, "Subject")
    course = _base(CourseMeta, "Course")
    unit = _base(UnitMeta, "Unit")
    lesson = _base(LessonFile, "Lesson")

    variants = [
        element_variant(m.type, m.schema, m.graded) for _, m in sorted(registry.elements.items())
    ]
    variants.append(AUTO_ITEM_VARIANT)
    lesson["properties"]["items"] = {
        "type": "array",
        "description": "The page elements of this lesson, in order.",
        "items": {"oneOf": variants},
    }
    return {
        "subject.schema.json": subject,
        "course.schema.json": course,
        "unit.schema.json": unit,
        "lesson.schema.json": lesson,
    }


def write_schemas(registry: ElementRegistry, out_dir: Path) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for name, schema in build_schemas(registry).items():
        path = out_dir / name
        path.write_text(json.dumps(schema, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        written.append(path)
    return written
