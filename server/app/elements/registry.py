"""Server-side element registry.

An element is a folder under ``elements/`` holding an ``element.json`` manifest. The registry scans
those folders, validates the manifests, and exposes each element's JSON Schema to the content
validator and the API. Nothing here knows about any particular element type.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import jsonschema

from ..content.yamlio import YamlError, load_yaml, to_plain

MANIFEST_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["type", "version", "title", "schema"],
    "additionalProperties": False,
    "properties": {
        "type": {"type": "string", "pattern": "^[a-z][a-z0-9-]*$"},
        "version": {"type": "integer", "minimum": 1},
        "title": {"type": "string"},
        "description": {"type": "string"},
        "icon": {"type": "string"},
        "graded": {"type": "boolean", "default": True},
        "self_graded": {
            "type": "boolean",
            "default": False,
            "description": "The element reports its own result (e.g. flashcard ratings); "
            "the player shows no Check button.",
        },
        "schema": {"type": "object"},
    },
}


@dataclass
class ElementManifest:
    type: str
    version: int
    title: str
    icon: str
    graded: bool
    description: str
    schema: dict[str, Any]
    dir: Path
    self_graded: bool = False
    has_css: bool = False
    has_js: bool = False

    @property
    def module_url(self) -> str:
        return f"/elements/{self.dir.name}/element.js"

    @property
    def css_url(self) -> str | None:
        return f"/elements/{self.dir.name}/element.css" if self.has_css else None

    def to_api(self) -> dict[str, Any]:
        return {
            "type": self.type,
            "version": self.version,
            "title": self.title,
            "icon": self.icon,
            "graded": self.graded,
            "self_graded": self.self_graded,
            "description": self.description,
            "schema": self.schema,
            "module": self.module_url,
            "css": self.css_url,
        }

    def examples(self) -> list[dict[str, Any]]:
        """Items from ``examples.yaml`` (a list, or a mapping with an ``items`` list)."""
        path = self.dir / "examples.yaml"
        if not path.is_file():
            return []
        data = to_plain(load_yaml(path))
        if isinstance(data, dict):
            data = data.get("items", [])
        out = []
        for raw in data or []:
            item = dict(raw)
            item.setdefault("type", self.type)
            out.append(item)
        return out


@dataclass
class RegistryProblem:
    path: Path
    message: str

    def __str__(self) -> str:
        return f"{self.path}:1: {self.message}"


@dataclass
class ElementRegistry:
    elements: dict[str, ElementManifest] = field(default_factory=dict)
    problems: list[RegistryProblem] = field(default_factory=list)

    def get(self, type_: str) -> ElementManifest | None:
        return self.elements.get(type_)

    def __contains__(self, type_: str) -> bool:
        return type_ in self.elements

    def types(self) -> list[str]:
        return sorted(self.elements)

    def to_api(self) -> list[dict[str, Any]]:
        return [self.elements[t].to_api() for t in self.types()]


_manifest_validator = jsonschema.Draft202012Validator(MANIFEST_SCHEMA)


def scan_elements(elements_dir: Path) -> ElementRegistry:
    registry = ElementRegistry()
    if not elements_dir.is_dir():
        return registry
    for folder in sorted(p for p in elements_dir.iterdir() if p.is_dir()):
        manifest_path = folder / "element.json"
        if not manifest_path.is_file():
            continue  # a folder without a manifest is not an element (e.g. shared assets)
        try:
            raw = json.loads(manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            registry.problems.append(
                RegistryProblem(manifest_path, f"element.json is not valid JSON: {exc.msg}")
            )
            continue
        errors = sorted(_manifest_validator.iter_errors(raw), key=lambda e: list(e.path))
        if errors:
            for err in errors:
                where = "/".join(str(p) for p in err.absolute_path) or "(root)"
                registry.problems.append(
                    RegistryProblem(manifest_path, f"manifest field {where}: {err.message}")
                )
            continue
        try:
            jsonschema.Draft202012Validator.check_schema(raw["schema"])
        except jsonschema.SchemaError as exc:
            registry.problems.append(
                RegistryProblem(
                    manifest_path, f"'schema' is not a valid JSON Schema: {exc.message}"
                )
            )
            continue
        manifest = ElementManifest(
            type=raw["type"],
            version=raw["version"],
            title=raw["title"],
            icon=raw.get("icon", "extension"),
            graded=raw.get("graded", True),
            self_graded=raw.get("self_graded", False),
            description=raw.get("description", ""),
            schema=raw["schema"],
            dir=folder,
            has_css=(folder / "element.css").is_file(),
            has_js=(folder / "element.js").is_file(),
        )
        if manifest.type in registry.elements:
            other = registry.elements[manifest.type].dir
            registry.problems.append(
                RegistryProblem(
                    manifest_path,
                    f"duplicate element type {manifest.type!r} (also defined in {other})",
                )
            )
            continue
        registry.elements[manifest.type] = manifest
    return registry


__all__ = [
    "ElementManifest",
    "ElementRegistry",
    "RegistryProblem",
    "YamlError",
    "scan_elements",
]
