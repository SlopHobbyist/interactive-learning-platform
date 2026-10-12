"""Progress business logic: attempts → SRS state, lesson completion → XP / daily log / unlocks,
and the read models for the course page and the profile. Streak freezes and reward drops are
added in Phase 7 (rewards.py / streaks.py) and hooked in here.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..content.loader import ContentIndex, Course, Lesson
from ..db.models import Attempt, DailyLog, ItemState, LessonCompletion, Setting, User, XpEvent
from ..elements.registry import ElementRegistry
from . import srs
from .unlocks import frontier, newly_unlocked, unit_states

DEFAULT_SETTINGS: dict[str, Any] = {
    "dailyGoal": 20,
    "combo": True,
    "drops": True,
    "sounds": False,
    "hardMode": False,
    "timezone": "UTC",
}


# --------------------------------------------------------------------- time
def tz_of(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def local_date(now: datetime, timezone: str | None) -> str:
    aware = now.replace(tzinfo=UTC) if now.tzinfo is None else now
    return aware.astimezone(tz_of(timezone)).date().isoformat()


def utc_naive(now: datetime | None = None) -> datetime:
    now = now or datetime.now(UTC)
    if now.tzinfo is not None:
        now = now.astimezone(UTC).replace(tzinfo=None)
    return now


# ----------------------------------------------------------------- settings
def get_settings(db: Session, user: User) -> dict[str, Any]:
    out = dict(DEFAULT_SETTINGS)
    for row in db.query(Setting).filter_by(user_id=user.id):
        out[row.key] = row.value
    return out


def update_settings(db: Session, user: User, patch: dict[str, Any]) -> dict[str, Any]:
    for key, value in patch.items():
        if key not in DEFAULT_SETTINGS:
            continue
        row = db.query(Setting).filter_by(user_id=user.id, key=key).first()
        if row is None:
            db.add(Setting(user_id=user.id, key=key, value=value))
        else:
            row.value = value
    db.commit()
    return get_settings(db, user)


# ----------------------------------------------------------------- attempts
def _state_from_row(row: ItemState) -> srs.ItemSRS:
    return srs.ItemSRS(row.stability, row.difficulty, row.last_review, row.reps, row.lapses)


def record_attempts(
    db: Session,
    user: User,
    attempts: list[dict[str, Any]],
    mode: str = "lesson",
    now: datetime | None = None,
) -> int:
    """Insert attempts and advance each item's SRS state. Returns the number recorded.

    The server clock (or the dev time-travel override) drives the SRS state; a client-supplied
    ``ts`` is kept on the attempt row for analytics only, and ignored under an override.
    """
    override = now is not None
    now = utc_naive(now)
    n = 0
    for a in attempts:
        item_path = str(a.get("item_path") or "")
        if "#" not in item_path:
            continue
        lesson_path = item_path.split("#", 1)[0]
        correct = bool(a.get("correct"))
        partial = a.get("partial")
        partial = float(partial) if partial is not None else (1.0 if correct else 0.0)
        ms = int(a.get("ms", 0) or 0)
        rating = srs.rating_for(correct, partial, ms, a.get("rating"))
        ts = now
        if a.get("ts") and not override:
            try:
                ts = utc_naive(datetime.fromisoformat(str(a["ts"]).replace("Z", "+00:00")))
            except ValueError:
                ts = now
        db.add(
            Attempt(
                user_id=user.id,
                item_path=item_path,
                lesson_path=lesson_path,
                answer=a.get("answer"),
                correct=correct,
                partial=partial,
                rating=rating,
                ms=ms,
                ts=ts,
                mode=mode,
            )
        )
        if a.get("graded", True):
            row = db.query(ItemState).filter_by(user_id=user.id, item_path=item_path).first()
            if row is None:
                st = srs.first_review(rating, now)
                db.add(
                    ItemState(
                        user_id=user.id,
                        item_path=item_path,
                        lesson_path=lesson_path,
                        stability=st.stability,
                        difficulty=st.difficulty,
                        last_review=st.last_review,
                        reps=st.reps,
                        lapses=st.lapses,
                    )
                )
                db.flush()  # the same item may appear again later in this batch
            else:
                st = srs.review(_state_from_row(row), rating, now)
                row.stability, row.difficulty, row.last_review = (
                    st.stability,
                    st.difficulty,
                    st.last_review,
                )
                row.reps, row.lapses = st.reps, st.lapses
        n += 1
    db.commit()
    return n


# -------------------------------------------------------------- completions
def completed_keys(db: Session, user: User, course: Course) -> set[str]:
    prefix = f"{course.subject_id}/{course.id}/"
    rows = (
        db.query(LessonCompletion.lesson_path)
        .filter(
            LessonCompletion.user_id == user.id, LessonCompletion.lesson_path.like(prefix + "%")
        )
        .distinct()
    )
    return {row[0][len(prefix) :] for row in rows}


def complete_lesson(
    db: Session,
    user: User,
    course: Course,
    lesson: Lesson,
    *,
    xp: int,
    accuracy: float,
    perfect: bool,
    elapsed_ms: int,
    timezone: str | None,
    now: datetime | None = None,
) -> dict[str, Any]:
    now = utc_naive(now)
    settings = get_settings(db, user)
    if timezone:
        settings = update_settings(db, user, {"timezone": timezone})
    before = completed_keys(db, user, course)
    repeat = lesson.key in before
    xp = max(0, int(xp))
    db.add(
        LessonCompletion(
            user_id=user.id,
            lesson_path=lesson.path,
            completed_at=now,
            xp=xp,
            accuracy=float(accuracy),
            perfect=bool(perfect),
            elapsed_ms=int(elapsed_ms),
        )
    )
    day = local_date(now, settings.get("timezone"))
    goal = int(settings.get("dailyGoal", 20))
    log = db.query(DailyLog).filter_by(user_id=user.id, local_date=day).first()
    if log is None:
        log = DailyLog(user_id=user.id, local_date=day, xp=0, goal=goal, met=False, lessons=0)
        db.add(log)
    log.goal = goal
    log.xp += xp
    log.lessons += 1
    log.met = log.xp >= goal
    if xp:
        db.add(
            XpEvent(
                user_id=user.id,
                amount=xp,
                kind="review" if repeat else "lesson",
                ref=lesson.path,
                local_date=day,
                ts=now,
            )
        )
    db.commit()
    after = before | {lesson.key}
    unlocked = newly_unlocked(course, before, after)
    me = me_summary(db, user, now=now)
    return {
        "xp": xp,
        "repeat": repeat,
        "unlocked": unlocked,
        "streak": me["streak"],
        "daily": {"xp": log.xp, "goal": goal, "met": log.met},
        "drop": None,  # Phase 7
        "me": me,
    }


# ------------------------------------------------------------- read models
def course_progress(
    db: Session, user: User, course: Course, registry: ElementRegistry, now: datetime | None = None
) -> dict[str, Any]:
    now = utc_naive(now)
    done = completed_keys(db, user, course)
    states = frontier(course, done)
    prefix = f"{course.subject_id}/{course.id}/"
    rows = (
        db.query(ItemState)
        .filter(ItemState.user_id == user.id, ItemState.lesson_path.like(prefix + "%"))
        .all()
    )
    by_lesson: dict[str, list[srs.ItemSRS]] = {}
    for row in rows:
        by_lesson.setdefault(row.lesson_path, []).append(_state_from_row(row))
    strength: dict[str, float] = {}
    due = 0
    for lsn in course.lessons():
        if lsn.key not in done:
            continue
        graded = sum(
            1 for it in lsn.items if (m := registry.get(it["type"])) is not None and m.graded
        )
        sts = by_lesson.get(lsn.path, [])
        strength[lsn.key] = srs.strength(sts, now, expected_items=graded or None)
        due += sum(
            1
            for s in sts
            if srs.current_retrievability(s, now) < srs.DEFAULT_CONFIG.retention_target
        )
    return {
        "lessons": states,
        "units": unit_states(course, done),
        "strength": strength,
        "due": due,
        "completed": len(done),
        "total": len(course.lessons()),
    }


def _streak(db: Session, user: User, today: str) -> int:
    """Consecutive days ending today (or yesterday, if today is not over) with the goal met.
    Phase 7 adds freezes here."""
    rows = {r.local_date: r for r in db.query(DailyLog).filter_by(user_id=user.id)}
    day = datetime.fromisoformat(today).date()
    if not (today in rows and rows[today].met):
        day = day - timedelta(days=1)  # today still in progress: count from yesterday
    streak = 0
    while True:
        row = rows.get(day.isoformat())
        if row is None or not (row.met or row.freeze_used):
            break
        streak += 1
        day -= timedelta(days=1)
    return streak


def me_summary(
    db: Session, user: User, now: datetime | None = None, timezone: str | None = None
) -> dict[str, Any]:
    now = utc_naive(now)
    settings = get_settings(db, user)
    tz = timezone or settings.get("timezone")
    today = local_date(now, tz)
    log = db.query(DailyLog).filter_by(user_id=user.id, local_date=today).first()
    goal = int(settings.get("dailyGoal", 20))
    xp_today = log.xp if log else 0
    xp_total = (
        db.query(func.coalesce(func.sum(XpEvent.amount), 0))
        .filter(XpEvent.user_id == user.id)
        .scalar()
        or 0
    )
    lessons = (
        db.query(func.count(func.distinct(LessonCompletion.lesson_path)))
        .filter(LessonCompletion.user_id == user.id)
        .scalar()
        or 0
    )
    return {
        "username": user.username,
        "xp_today": int(xp_today),
        "xp_total": int(xp_total),
        "daily_goal": goal,
        "goal_met": xp_today >= goal,
        "streak": _streak(db, user, today),
        "lessons_completed": int(lessons),
        "today": today,
        "timezone": tz,
    }


def orphan_check_paths(index: ContentIndex) -> set[str]:
    return {lsn.path for lsn in index.all_lessons()}


def complete_review(
    db: Session,
    user: User,
    course: Course,
    *,
    xp: int,
    timezone: str | None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """A finished review session: XP and the daily log, no completion row."""
    now = utc_naive(now)
    settings = get_settings(db, user)
    if timezone:
        settings = update_settings(db, user, {"timezone": timezone})
    xp = max(0, int(xp))
    day = local_date(now, settings.get("timezone"))
    goal = int(settings.get("dailyGoal", 20))
    log = db.query(DailyLog).filter_by(user_id=user.id, local_date=day).first()
    if log is None:
        log = DailyLog(user_id=user.id, local_date=day, xp=0, goal=goal, met=False, lessons=0)
        db.add(log)
    log.goal = goal
    log.xp += xp
    log.met = log.xp >= goal
    if xp:
        db.add(
            XpEvent(
                user_id=user.id,
                amount=xp,
                kind="review",
                ref=f"{course.subject_id}/{course.id}/_review",
                local_date=day,
                ts=now,
            )
        )
    db.commit()
    me = me_summary(db, user, now=now)
    return {"xp": xp, "daily": {"xp": log.xp, "goal": goal, "met": log.met}, "me": me}
