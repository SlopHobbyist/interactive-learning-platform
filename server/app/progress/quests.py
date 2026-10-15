"""Daily quests: three a day, one per tier, reset at local midnight.

Quests are picked deterministically per learner and day and stored on first read, so a config
change never rewrites today's quests. Progress is derived from the day's records (daily log,
completions, attempts), never kept as separate counters. A quest met for the first time grants
one chest.

Only graded attempts count towards runs and reviews. The attempts table has no graded flag, but
a graded attempt always creates the item's ``item_state`` row and an ungraded one (an
explanation) never does, so the join on ``item_state`` keeps exactly the graded ones.
"""

from __future__ import annotations

import random
from datetime import UTC, datetime, time, timedelta
from typing import Any

from sqlalchemy.orm import Session

from ..db.models import Attempt, Chest, DailyLog, DailyQuest, ItemState, LessonCompletion, User
from . import chests as chests_mod
from .economy import TIERS, Economy, QuestDef


def tz_of(name: str | None):
    from .service import tz_of as _tz

    return _tz(name)


def day_bounds(day: str, timezone: str | None) -> tuple[datetime, datetime]:
    """The local day as a naive-UTC [start, end)."""
    tz = tz_of(timezone)
    start = datetime.combine(datetime.fromisoformat(day).date(), time(0), tzinfo=tz)
    end = start + timedelta(days=1)
    conv = lambda d: d.astimezone(UTC).replace(tzinfo=None)  # noqa: E731
    return conv(start), conv(end)


def resets_in(now: datetime, day: str, timezone: str | None) -> int:
    return max(0, int((day_bounds(day, timezone)[1] - now).total_seconds()))


def pick(
    econ: Economy, user_id: int, day: str, goal: int, items_learned: int
) -> list[tuple[int, QuestDef, int]]:
    rng = random.Random(f"{user_id}:{day}")
    out = []
    for tier, name in enumerate(TIERS):
        pool = [q for q in econ.quests.get(name, ()) if items_learned >= q.requires_items]
        if not pool:
            continue
        q = rng.choice(pool)
        out.append((tier, q, q.target_for(goal)))
    return out


def ensure(db: Session, user: User, day: str, goal: int, econ: Economy) -> list[DailyQuest]:
    rows = (
        db.query(DailyQuest)
        .filter_by(user_id=user.id, local_date=day)
        .order_by(DailyQuest.tier)
        .all()
    )
    if rows:
        return rows
    learned = db.query(ItemState).filter_by(user_id=user.id).count()
    for tier, q, target in pick(econ, user.id, day, goal, learned):
        db.add(
            DailyQuest(
                user_id=user.id, local_date=day, tier=tier, key=q.key, kind=q.kind, target=target
            )
        )
    db.flush()
    return (
        db.query(DailyQuest)
        .filter_by(user_id=user.id, local_date=day)
        .order_by(DailyQuest.tier)
        .all()
    )


def longest_run(results: list[bool]) -> int:
    best = run = 0
    for ok in results:
        run = run + 1 if ok else 0
        best = max(best, run)
    return best


def metrics(db: Session, user: User, day: str, timezone: str | None) -> dict[str, int]:
    start, end = day_bounds(day, timezone)
    log = db.query(DailyLog).filter_by(user_id=user.id, local_date=day).first()
    graded = (
        db.query(Attempt.correct, Attempt.mode)
        .join(
            ItemState,
            (ItemState.user_id == Attempt.user_id) & (ItemState.item_path == Attempt.item_path),
        )
        .filter(Attempt.user_id == user.id, Attempt.ts >= start, Attempt.ts < end)
        .order_by(Attempt.ts, Attempt.id)
        .all()
    )
    perfect = (
        db.query(LessonCompletion)
        .filter(
            LessonCompletion.user_id == user.id,
            LessonCompletion.perfect.is_(True),
            LessonCompletion.completed_at >= start,
            LessonCompletion.completed_at < end,
        )
        .count()
    )
    return {
        "xp": log.xp if log else 0,
        "lessons": log.lessons if log else 0,
        "perfect": perfect,
        "run": longest_run([bool(c) for c, _ in graded]),
        "review": sum(1 for _, mode in graded if mode == "review"),
    }


def refresh(
    db: Session,
    user: User,
    *,
    now: datetime,
    day: str,
    timezone: str | None,
    goal: int,
    econ: Economy,
) -> tuple[list[dict[str, Any]], list[Chest]]:
    """Today's quests with progress; grants a chest for each quest met since the last look.
    Returns (quests for the API, chests granted now). Commits are the caller's."""
    db.flush()
    rows = ensure(db, user, day, goal, econ)
    m = metrics(db, user, day, timezone)
    granted: list[Chest] = []
    out = []
    for row in rows:
        q = econ.quest(row.key)
        title = q.title_for(row.target) if q else row.key
        progress = min(row.target, int(m.get(row.kind, 0)))
        if row.done_at is None and progress >= row.target:
            chest = chests_mod.grant(db, user, "quest", title, day, now)
            row.done_at, row.chest_id = now, chest.id
            granted.append(chest)
        if row.done_at is not None:
            progress = row.target
        chest = db.get(Chest, row.chest_id) if row.chest_id else None
        out.append(
            {
                "id": row.id,
                "tier": TIERS[row.tier] if row.tier < len(TIERS) else str(row.tier),
                "key": row.key,
                "kind": row.kind,
                "title": title,
                "icon": q.icon if q else "flag",
                "target": row.target,
                "progress": progress,
                "done": row.done_at is not None,
                "chest": chests_mod.to_api(chest) if chest else None,
            }
        )
    return out, granted
