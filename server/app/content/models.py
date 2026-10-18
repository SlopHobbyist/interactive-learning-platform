"""Pydantic models for the content format (Subject › Course › Unit › Lesson › Item).

These validate *structure*. An item's element-specific fields are validated separately against
the element's JSON Schema (see :mod:`.validator`). Keep these models in sync with
``docs/AUTHORING.md`` and the output of ``ilp schema``.
"""

from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
TOKEN_RE = re.compile(r"^[a-z][a-z0-9-]*$")


def _check_slug(value: str, what: str) -> str:
    if not SLUG_RE.match(value):
        raise ValueError(
            f"{what} must be a slug: lowercase letters, digits, '-' or '_' (got {value!r})"
        )
    return value


class SubjectMeta(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str | None = Field(default=None, description="Overrides the directory slug.")
    title: str
    icon: str = Field(default="school", description="Material icon ligature name.")
    description: str = ""
    color: str | None = Field(
        default=None,
        description="Optional Wavefront token name (e.g. 'primary'), never a raw colour.",
    )

    @field_validator("id")
    @classmethod
    def _slug(cls, v: str | None) -> str | None:
        return _check_slug(v, "id") if v is not None else v

    @field_validator("color")
    @classmethod
    def _token(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if v.startswith("#") or v.startswith("rgb") or not TOKEN_RE.match(v):
            raise ValueError(
                "color must be a design-token name such as 'primary', not a raw colour"
            )
        return v


class Textbook(BaseModel):
    model_config = ConfigDict(extra="forbid")

    file: str = Field(
        description="Path relative to course.yaml. It may lead out of the course directory "
        "(e.g. '../_books/guide.pdf') but must stay inside the content directory."
    )
    label: str = Field(
        default="",
        description="Shown when a course has several files, e.g. 'Volume 1'. "
        "Default: the file name.",
    )


class CourseMeta(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str | None = None
    title: str
    description: str = ""
    level: str = ""
    tags: list[str] = Field(default_factory=list)
    textbook: str | Textbook | list[str | Textbook] | None = Field(
        default=None,
        description="Optional files (PDF, EPUB, ODT…) learners can download from the course "
        "page: one path, or a list of paths or {file, label} entries.",
    )

    @field_validator("id")
    @classmethod
    def _slug(cls, v: str | None) -> str | None:
        return _check_slug(v, "id") if v is not None else v

    def textbooks(self) -> list[Textbook]:
        tb = self.textbook
        entries = tb if isinstance(tb, list) else [] if tb is None else [tb]
        return [Textbook(file=e) if isinstance(e, str) else e for e in entries]


class UnitMeta(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str | None = None
    title: str
    description: str = ""
    requires: list[str] | None = Field(
        default=None,
        description="Unit ids in the same course that must be complete first. "
        "Default: the previous unit.",
    )

    @field_validator("id")
    @classmethod
    def _slug(cls, v: str | None) -> str | None:
        return _check_slug(v, "id") if v is not None else v


class MapPosition(BaseModel):
    model_config = ConfigDict(extra="forbid")
    x: float
    y: float


class Item(BaseModel):
    """One page element instance. Fields other than ``type`` and ``id`` belong to the element."""

    model_config = ConfigDict(extra="allow")

    type: str
    id: str | None = None

    @field_validator("id")
    @classmethod
    def _slug(cls, v: str | None) -> str | None:
        return _check_slug(v, "item id") if v is not None else v

    def fields(self) -> dict[str, Any]:
        """The element-specific fields (everything except type and id)."""
        return {k: v for k, v in self.model_dump().items() if k not in {"type", "id"}}


class Fact(BaseModel):
    model_config = ConfigDict(extra="forbid")
    term: str
    definition: str
    hint: str | None = None


class AutoSource(BaseModel):
    """Raw material for the auto-arranger (Phase 8)."""

    model_config = ConfigDict(extra="forbid")

    facts: list[Fact] = Field(default_factory=list)
    cloze: list[str] = Field(default_factory=list)
    notes: str | None = None

    @model_validator(mode="after")
    def _not_empty(self) -> AutoSource:
        if not self.facts and not self.cloze and not self.notes:
            raise ValueError("source must contain at least one of: facts, cloze, notes")
        return self

    @field_validator("cloze")
    @classmethod
    def _has_blank(cls, v: list[str]) -> list[str]:
        for sentence in v:
            if "{{" not in sentence or "}}" not in sentence:
                raise ValueError(f"cloze sentence has no {{{{blank}}}}: {sentence!r}")
        return v


class LessonFile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str | None = None
    title: str
    description: str = ""
    xp: int = Field(default=10, ge=0)
    requires: list[str] | None = Field(
        default=None,
        description="Lesson ids ('lesson' in this unit or 'unit/lesson') that must be complete "
        "first. Default: the previous lesson in the unit.",
    )
    arrange: Literal["auto"] | None = None
    source: AutoSource | None = None
    items: list[Item] = Field(default_factory=list)
    map: MapPosition | None = None

    @field_validator("id")
    @classmethod
    def _slug(cls, v: str | None) -> str | None:
        return _check_slug(v, "id") if v is not None else v

    @model_validator(mode="after")
    def _mode(self) -> LessonFile:
        has_auto_item = any(it.type == "auto" for it in self.items)
        if self.arrange == "auto" and self.source is None:
            raise ValueError("arrange: auto needs a 'source' block")
        if self.arrange is None and self.source is not None and not has_auto_item:
            raise ValueError("'source' is only used with 'arrange: auto' or an item of type 'auto'")
        if has_auto_item and self.source is None:
            raise ValueError("an item of type 'auto' needs a 'source' block on the lesson")
        if self.arrange is None and not self.items:
            raise ValueError("lesson has no items (add 'items:' or 'arrange: auto')")
        return self
