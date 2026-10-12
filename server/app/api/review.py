"""Review sessions: a lesson-shaped payload built from the weakest items of a course."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..content.render import RenderContext, render_fields
from ..content.store import ContentStore
from ..db.session import current_user, get_db
from ..progress import service
from ..progress.review import REVIEW_XP_PER_ITEM, review_queue
from .content import content_base_url
from .deps import get_store
from .progress import resolve_now

router = APIRouter(prefix="/api/review", tags=["review"])


@router.get("/{subject}/{course}")
def get_review(
    subject: str,
    course: str,
    request: Request,
    db: Session = Depends(get_db),
    store: ContentStore = Depends(get_store),
    limit: int = Query(default=12, ge=1, le=50),
    lesson: str | None = Query(default=None, description="unit/lesson for a single-tile re-tune"),
    now: str | None = Query(default=None),
) -> dict[str, Any]:
    c = store.index.course(subject, course)
    if c is None:
        raise HTTPException(status_code=404, detail="course not found")
    user = current_user(request, db)
    queue, due = review_queue(
        db, user, c, store.registry, limit=limit, lesson_key=lesson, now=resolve_now(request, now)
    )
    registry = store.registry
    items = []
    for lsn, item, r in queue:
        manifest = registry.get(item["type"])
        rendered = render_fields(
            item, manifest.schema, RenderContext(base_url=content_base_url(store, lsn))
        )
        rendered["graded"] = True
        rendered["_path"] = f"{lsn.path}#{item['id']}"
        rendered["_lesson"] = {"key": lsn.key, "title": lsn.title}
        rendered["_retrievability"] = round(r, 3)
        # Review items are shuffled client-side by their own seeds; keep ids unique per session.
        rendered["id"] = f"{lsn.unit_id}--{lsn.id}--{item['id']}"
        items.append(rendered)
    title = "Re-tune" if lesson else "Review"
    target = c.lesson_by_key(lesson) if lesson else None
    return {
        "id": "review",
        "title": f"{title}: {target.title}" if target else f"{title}: {c.title}",
        "description": (
            f"{len(items)} of the items you are closest to forgetting."
            if items
            else "Nothing to review yet. Finish a lesson first."
        ),
        "xp": REVIEW_XP_PER_ITEM * len(items),
        "path": f"{c.subject_id}/{c.id}/_review",
        "subject": c.subject_id,
        "course": c.id,
        "lesson": lesson,
        "due": due,
        "items": items,
        "mode": "review",
    }


class ReviewCompleteIn(BaseModel):
    xp: int = 0
    items: int = 0
    accuracy: float = 1.0
    timezone: str | None = None


@router.post("/{subject}/{course}/complete")
def post_review_complete(
    subject: str,
    course: str,
    body: ReviewCompleteIn,
    request: Request,
    db: Session = Depends(get_db),
    store: ContentStore = Depends(get_store),
    now: str | None = Query(default=None),
) -> dict[str, Any]:
    c = store.index.course(subject, course)
    if c is None:
        raise HTTPException(status_code=404, detail="course not found")
    user = current_user(request, db)
    return service.complete_review(
        db, user, c, xp=body.xp, timezone=body.timezone, now=resolve_now(request, now)
    )
