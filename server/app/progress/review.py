"""Review queues (plan §7): the items with the lowest retrievability among completed lessons,
interleaved across lessons and capped per session. A per-tile "re-tune" is the same queue
restricted to one lesson.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from ..content.loader import Course, Lesson
from ..db.models import ItemState, User
from ..elements.registry import ElementRegistry
from . import srs
from .service import completed_keys, utc_naive

REVIEW_XP_PER_ITEM = 2


def review_queue(
    db: Session,
    user: User,
    course: Course,
    registry: ElementRegistry,
    *,
    limit: int = 12,
    lesson_key: str | None = None,
    now: datetime | None = None,
) -> tuple[list[tuple[Lesson, dict[str, Any], float]], int]:
    """Return ([(lesson, item, retrievability)], due_count), weakest first, interleaved."""
    now = utc_naive(now)
    done = completed_keys(db, user, course)
    lessons: list[Lesson] = [lsn for lsn in course.lessons() if lsn.key in done]
    if lesson_key is not None:
        lessons = [lsn for lsn in lessons if lsn.key == lesson_key]
    if not lessons:
        return [], 0
    prefix = f"{course.subject_id}/{course.id}/"
    rows = (
        db.query(ItemState)
        .filter(ItemState.user_id == user.id, ItemState.lesson_path.like(prefix + "%"))
        .all()
    )
    r_by_item = {
        row.item_path: srs.current_retrievability(
            srs.ItemSRS(row.stability, row.difficulty, row.last_review, row.reps, row.lapses), now
        )
        for row in rows
    }
    per_lesson: list[list[tuple[Lesson, dict[str, Any], float]]] = []
    due = 0
    for lsn in lessons:
        bucket = []
        for item in lsn.items:
            m = registry.get(item["type"])
            if m is None or not m.graded:
                continue
            r = r_by_item.get(f"{lsn.path}#{item['id']}", 0.0)
            if r < srs.DEFAULT_CONFIG.retention_target:
                due += 1
            bucket.append((lsn, item, r))
        bucket.sort(key=lambda t: t[2])
        if bucket:
            per_lesson.append(bucket)
    # Weakest lessons first, then round-robin so a session mixes lessons.
    per_lesson.sort(key=lambda b: b[0][2])
    out: list[tuple[Lesson, dict[str, Any], float]] = []
    i = 0
    while len(out) < limit and any(per_lesson):
        bucket = per_lesson[i % len(per_lesson)]
        if bucket:
            out.append(bucket.pop(0))
        i += 1
        if i > 10_000:  # pragma: no cover - safety
            break
        per_lesson = [b for b in per_lesson if b] or []
        if not per_lesson:
            break
    return out, due
