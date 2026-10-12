"""``ilp validate --check-db``: warn about progress rows whose content paths no longer exist."""

from __future__ import annotations

from ..config import settings
from ..content.loader import ContentIndex
from ..content.problems import Problem
from .models import Attempt, ItemState, LessonCompletion
from .session import Database


def orphaned_paths(index: ContentIndex, database: Database | None = None) -> list[Problem]:
    database = database or Database(settings)
    try:
        database.migrate()
    except Exception as exc:  # pragma: no cover - broken DB file
        return [Problem(index.root, 1, f"could not open the database: {exc}", "warning")]
    lesson_paths = {lsn.path for lsn in index.all_lessons()}
    item_paths = {f"{lsn.path}#{it['id']}" for lsn in index.all_lessons() for it in lsn.items}
    problems: list[Problem] = []
    with database.session() as db:
        seen_lessons = {row[0] for row in db.query(LessonCompletion.lesson_path).distinct()}
        seen_items = {row[0] for row in db.query(ItemState.item_path).distinct()}
        seen_items |= {row[0] for row in db.query(Attempt.item_path).distinct()}
    for p in sorted(seen_lessons - lesson_paths):
        problems.append(
            Problem(
                index.root,
                1,
                f"database has progress for lesson '{p}' which no longer exists",
                "warning",
            )
        )
    for p in sorted(seen_items - item_paths):
        lesson_path = p.split("#", 1)[0]
        if lesson_path in lesson_paths:
            problems.append(
                Problem(
                    index.root,
                    1,
                    f"database has item progress for '{p}' which no longer exists "
                    f"(the item was edited or removed; use `ilp ids --write` to keep ids stable)",
                    "warning",
                )
            )
    return problems
