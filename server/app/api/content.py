"""Read-only content endpoints: subjects, courses (tree) and lessons (rendered items)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from ..content.loader import Lesson
from ..content.render import RenderContext, render_fields
from ..content.store import ContentStore
from .deps import get_store

router = APIRouter(prefix="/api", tags=["content"])


def _404(what: str) -> HTTPException:
    return HTTPException(status_code=404, detail=f"{what} not found")


@router.get("/subjects")
def list_subjects(store: ContentStore = Depends(get_store)) -> list[dict[str, Any]]:
    return [s.to_summary() for s in store.index.subjects]


@router.get("/subjects/{subject}")
def get_subject(subject: str, store: ContentStore = Depends(get_store)) -> dict[str, Any]:
    s = store.index.subject(subject)
    if s is None:
        raise _404("subject")
    return {**s.to_summary(), "courses": [c.to_summary() for c in s.courses]}


@router.get("/courses/{subject}/{course}")
def get_course(
    subject: str, course: str, store: ContentStore = Depends(get_store)
) -> dict[str, Any]:
    s = store.index.subject(subject)
    c = s.course(course) if s else None
    if s is None or c is None:
        raise _404("course")
    registry = store.registry
    return {
        **c.to_summary(),
        "subject": s.to_summary(),
        "units": [
            {
                "id": u.id,
                "title": u.title,
                "description": u.description,
                "requires": u.requires,
                "lessons": [lsn.to_summary(registry) for lsn in u.lessons],
            }
            for u in c.units
        ],
    }


def content_base_url(store: ContentStore, lesson: Lesson) -> str:
    """URL of the lesson's directory under the static ``/content`` mount (for relative images)."""
    try:
        rel = lesson.file.parent.resolve().relative_to(store.settings.content_dir.resolve())
    except ValueError:
        return "/content"
    return "/content/" + rel.as_posix()


def render_lesson(store: ContentStore, lesson: Lesson) -> dict[str, Any]:
    registry = store.registry
    ctx = RenderContext(base_url=content_base_url(store, lesson))
    items: list[dict[str, Any]] = []
    for item in lesson.items:
        manifest = registry.get(item["type"])
        if manifest is None:
            # Content using a missing element is reported by the validator; the player shows
            # a "skip" card instead of crashing.
            items.append({**item, "_missing": True, "graded": False})
            continue
        rendered = render_fields(item, manifest.schema, ctx)
        rendered["graded"] = manifest.graded
        items.append(rendered)
    return {
        "id": lesson.id,
        "title": lesson.title,
        "description": lesson.description,
        "xp": lesson.xp,
        "path": lesson.path,
        "subject": lesson.subject_id,
        "course": lesson.course_id,
        "unit": lesson.unit_id,
        "requires": lesson.requires,
        "arrange": lesson.arrange,
        "items": items,
        "base_url": ctx.base_url,
    }


@router.get("/lessons/{subject}/{course}/{unit}/{lesson}")
def get_lesson(
    subject: str, course: str, unit: str, lesson: str, store: ContentStore = Depends(get_store)
) -> dict[str, Any]:
    lsn = store.index.lesson(subject, course, unit, lesson)
    if lsn is None:
        raise _404("lesson")
    return render_lesson(store, lsn)
