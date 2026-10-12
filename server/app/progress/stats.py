"""Profile statistics: XP over time, the streak calendar, accuracy per element type, the
weakest items and coverage per course."""

from __future__ import annotations

import re
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..content.loader import ContentIndex
from ..db.models import Attempt, DailyLog, ItemState, LessonCompletion, User
from ..elements.registry import ElementRegistry
from . import srs
from .service import completed_keys, get_settings, local_date, me_summary, utc_naive
from .streaks import Day, best_streak
from .unlocks import frontier


def _days(db: Session, user: User) -> dict[str, Day]:
    return {
        r.local_date: Day(r.local_date, r.xp, r.goal, r.met, r.freeze_used)
        for r in db.query(DailyLog).filter_by(user_id=user.id)
    }


def xp_by_day(days: dict[str, Day], today: str, n: int = 30) -> list[dict[str, Any]]:
    end = datetime.fromisoformat(today).date()
    out = []
    for i in range(n - 1, -1, -1):
        d = (end - timedelta(days=i)).isoformat()
        day = days.get(d)
        out.append({"date": d, "xp": day.xp if day else 0, "met": bool(day and day.met)})
    return out


def calendar(days: dict[str, Day], today: str, weeks: int = 12) -> list[dict[str, Any]]:
    """The last ``weeks`` full weeks ending today (Monday first), for a heatmap."""
    end = datetime.fromisoformat(today).date()
    start = end - timedelta(days=weeks * 7 - 1)
    start -= timedelta(days=start.weekday())  # back to Monday
    out = []
    cur = start
    while cur <= end:
        d = cur.isoformat()
        day = days.get(d)
        out.append(
            {
                "date": d,
                "xp": day.xp if day else 0,
                "met": bool(day and day.met),
                "freeze": bool(day and day.freeze_used),
                "goal": day.goal if day else None,
            }
        )
        cur += timedelta(days=1)
    return out


def accuracy_by_type(db: Session, user: User, index: ContentIndex) -> list[dict[str, Any]]:
    type_of: dict[str, str] = {}
    for lsn in index.all_lessons():
        for it in lsn.items:
            type_of[f"{lsn.path}#{it['id']}"] = it["type"]
    rows = (
        db.query(Attempt.item_path, func.count(Attempt.id), func.sum(Attempt.correct))
        .filter(Attempt.user_id == user.id)
        .group_by(Attempt.item_path)
        .all()
    )
    agg: dict[str, list[int]] = {}
    for path, n, correct in rows:
        t = type_of.get(path)
        if t is None:
            continue
        a = agg.setdefault(t, [0, 0])
        a[0] += int(n)
        a[1] += int(correct or 0)
    return sorted(
        (
            {"type": t, "attempts": n, "correct": c, "accuracy": round(c / n, 3) if n else None}
            for t, (n, c) in agg.items()
        ),
        key=lambda d: (d["accuracy"] if d["accuracy"] is not None else 2, -d["attempts"]),
    )


def weakest_items(
    db: Session, user: User, index: ContentIndex, now: datetime, limit: int = 5
) -> list[dict[str, Any]]:
    titles: dict[str, tuple[str, dict[str, Any]]] = {}
    for lsn in index.all_lessons():
        for it in lsn.items:
            titles[f"{lsn.path}#{it['id']}"] = (lsn.title, it)
    scored = []
    for row in db.query(ItemState).filter_by(user_id=user.id):
        r = srs.current_retrievability(
            srs.ItemSRS(row.stability, row.difficulty, row.last_review, row.reps, row.lapses), now
        )
        lesson_title, item = titles.get(row.item_path, ("(removed)", {}))
        prompt = item.get("prompt") or item.get("front") or item.get("body") or item.get("type", "")
        prompt = (re.sub(r"[*_`#>]+", "", str(prompt)).strip().splitlines() or [""])[0]
        scored.append(
            {
                "item_path": row.item_path,
                "lesson": lesson_title,
                "type": item.get("type"),
                "prompt": str(prompt)[:120],
                "retrievability": round(r, 3),
                "lapses": row.lapses,
                "reps": row.reps,
            }
        )
    scored.sort(key=lambda d: (d["retrievability"], -d["lapses"]))
    return scored[:limit]


def courses_overview(
    db: Session, user: User, index: ContentIndex, registry: ElementRegistry, now: datetime
) -> list[dict[str, Any]]:
    out = []
    for s in index.subjects:
        for c in s.courses:
            done = completed_keys(db, user, c)
            if not done:
                continue
            states = frontier(c, done)
            prefix = f"{c.subject_id}/{c.id}/"
            rows = (
                db.query(ItemState)
                .filter(ItemState.user_id == user.id, ItemState.lesson_path.like(prefix + "%"))
                .all()
            )
            by_lesson: dict[str, list[srs.ItemSRS]] = {}
            for row in rows:
                by_lesson.setdefault(row.lesson_path, []).append(
                    srs.ItemSRS(
                        row.stability, row.difficulty, row.last_review, row.reps, row.lapses
                    )
                )
            total = 0.0
            keys = [lsn.key for lsn in c.lessons()]
            for lsn in c.lessons():
                if lsn.key not in done:
                    continue
                graded = sum(1 for it in lsn.items if (m := registry.get(it["type"])) and m.graded)
                total += srs.strength(
                    by_lesson.get(lsn.path, []), now, expected_items=graded or None
                )
            out.append(
                {
                    "subject": s.id,
                    "subject_title": s.title,
                    "course": c.id,
                    "title": c.title,
                    "completed": len(done),
                    "total": len(keys),
                    "coverage": round(total / len(keys)) if keys else 0,
                    "available": sum(1 for v in states.values() if v == "available"),
                }
            )
    return out


def stats(
    db: Session,
    user: User,
    index: ContentIndex,
    registry: ElementRegistry,
    now: datetime | None = None,
    timezone: str | None = None,
) -> dict[str, Any]:
    now = utc_naive(now)
    settings = get_settings(db, user)
    today = local_date(now, timezone or settings.get("timezone"))
    days = _days(db, user)
    me = me_summary(db, user, now=now, timezone=timezone)
    lessons_total = (
        db.query(func.count(LessonCompletion.id))
        .filter(LessonCompletion.user_id == user.id)
        .scalar()
        or 0
    )
    return {
        "me": me,
        "today": today,
        "best_streak": best_streak(days),
        "lessons_total": int(lessons_total),
        "xp_by_day": xp_by_day(days, today),
        "calendar": calendar(days, today),
        "accuracy_by_type": accuracy_by_type(db, user, index),
        "weakest": weakest_items(db, user, index, now),
        "courses": courses_overview(db, user, index, registry, now),
    }
