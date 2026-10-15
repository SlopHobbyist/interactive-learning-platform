"""Progress business logic: attempts → SRS state, lesson completion → XP / daily log / unlocks,
and the read models for the course page and the profile. Streak freezes (streaks.py) and the
economy (economy.py, chests.py, quests.py, shop.py) are hooked in here.
"""

from __future__ import annotations

import random
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..content.loader import ContentIndex, Course, Lesson
from ..db.models import (
    Attempt,
    Chest,
    CoinEvent,
    DailyLog,
    ItemState,
    LessonCompletion,
    Setting,
    User,
    XpEvent,
)
from ..elements.registry import ElementRegistry
from . import chests as chests_mod
from . import economy, srs, streak_tools
from . import quests as quests_mod
from . import shop as shop_mod
from .streaks import Day, apply_freezes, streak_length
from .unlocks import frontier, newly_unlocked, unit_states

DEFAULT_SETTINGS: dict[str, Any] = {
    "dailyGoal": 20,
    "combo": True,
    "chests": True,
    "sounds": True,
    "hardMode": False,
    "timezone": "UTC",
    "goalChosen": False,
    "league": True,
    "skipAhead": False,
    "motion": "system",
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
    rng: random.Random | None = None,
) -> dict[str, Any]:
    now = utc_naive(now)
    settings = get_settings(db, user)
    if timezone:
        settings = update_settings(db, user, {"timezone": timezone})
    before = completed_keys(db, user, course)
    repeat = lesson.key in before
    tz = settings.get("timezone")
    day = local_date(now, tz)
    goal = int(settings.get("dailyGoal", 20))
    econ = economy.load()
    chests_on = bool(settings.get("chests", True))
    # Read before this completion is recorded: it is the state the chance is worked out from.
    state = (
        chests_mod.lesson_state(db, user, now, day, econ.lesson)
        if chests_on and not repeat
        else None
    )
    xp, boosted = economy.boosted_xp(user, max(0, int(xp)), now)
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
    log = _log_xp(db, user, day, goal, xp)
    log.lessons += 1
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
    coins = 0
    if not repeat:
        coins += economy.earn(db, user, econ.coin("lesson"), "lesson", lesson.path, day, now)
        if perfect:
            coins += economy.earn(
                db, user, econ.coin("perfect_bonus"), "perfect", lesson.path, day, now
            )
    coins += _goal_coins(db, user, log, day, now, econ)
    new_chests: list[Chest] = []
    chest_next = None
    if state is not None:
        p = chests_mod.chance(econ.lesson, state, perfect=bool(perfect))
        granted = (rng or random.Random()).random() < p
        if granted:
            new_chests.append(chests_mod.grant(db, user, "lesson", lesson.path, day, now))
        chest_next = chests_mod.next_chance(econ.lesson, chests_mod.after(state, granted))
    quests: list[dict[str, Any]] = []
    if chests_on:
        quests, quest_chests = quests_mod.refresh(
            db, user, now=now, day=day, timezone=tz, goal=goal, econ=econ
        )
        new_chests += quest_chests
        new_chests += _milestone_chests(db, user, log, day, now, econ)
    db.commit()
    after = before | {lesson.key}
    unlocked = newly_unlocked(course, before, after)
    me = me_summary(db, user, now=now)
    return {
        "xp": xp,
        "boosted": boosted,
        "repeat": repeat,
        "unlocked": unlocked,
        "streak": me["streak"],
        "daily": {"xp": log.xp, "goal": goal, "met": log.met},
        "coins_earned": coins,
        "chests": [chests_mod.to_api(c) for c in new_chests],
        "chest_next": chest_next,
        "quests": quests,
        "me": me,
    }


def _log_xp(db: Session, user: User, day: str, goal: int, xp: int) -> DailyLog:
    log = db.query(DailyLog).filter_by(user_id=user.id, local_date=day).first()
    if log is None:
        log = DailyLog(user_id=user.id, local_date=day, xp=0, goal=goal, met=False, lessons=0)
        db.add(log)
    log.goal = goal
    log.xp += xp
    log.met = log.xp >= goal
    return log


def _milestone_chests(
    db: Session, user: User, log: DailyLog, day: str, now: datetime, econ: economy.Economy
) -> list[Chest]:
    """Streak-milestone chests, once today counts (the goal is met)."""
    if not log.met:
        return []
    db.flush()
    streak = _streak(db, user, day)
    return streak_tools.milestone_chests(db, user, day=day, streak=streak, now=now, econ=econ)


def _goal_coins(
    db: Session, user: User, log: DailyLog, day: str, now: datetime, econ: economy.Economy
) -> int:
    """The daily-goal coins, once a day, when the goal is met."""
    ref = f"goal:{day}"
    if not log.met or economy.paid(db, user, "goal", ref):
        return 0
    return economy.earn(db, user, econ.coin("daily_goal"), "goal", ref, day, now)


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
    """Consecutive days ending today (or yesterday while today is open) with the goal met,
    bridging missed days with streak freezes from the inventory (used automatically)."""
    rows = {r.local_date: r for r in db.query(DailyLog).filter_by(user_id=user.id)}
    days = {k: Day(k, r.xp, r.goal, r.met, r.freeze_used) for k, r in rows.items()}
    freezes = economy.available(db, user, "freeze")
    frozen, _left = apply_freezes(days, today, freezes)
    if frozen:
        for d in frozen:
            row = rows.get(d)
            if row is None:
                row = DailyLog(user_id=user.id, local_date=d, xp=0, goal=20, met=False, lessons=0)
                db.add(row)
            row.freeze_used = True
        economy.consume(db, user, "freeze", len(frozen))
        db.commit()
    return streak_length(days, today)


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
    streak = _streak(db, user, today)  # may consume freezes: compute before reading the inventory
    # Settle a streak wager on the same day records (after freezes were applied).
    _, days = streak_tools.day_map(db, user)
    wager, wager_result = streak_tools.settle_wager(db, user, days, today, now)
    if wager_result:
        db.commit()
    unopened = db.query(Chest).filter(Chest.user_id == user.id, Chest.opened_at.is_(None)).count()
    return {
        "username": user.username,
        "coins": economy.balance(db, user),
        "freezes": economy.available(db, user, "freeze"),
        "freeze_cap": economy.load().freeze_cap,
        "boost_seconds": economy.boost_seconds(user, now),
        "equipped": shop_mod.equipped(db, user),
        "chests_unopened": unopened,
        "chests": bool(settings.get("chests", True)),
        "wager": wager,
        "wager_result": wager_result,
        "goal_chosen": bool(settings.get("goalChosen", False)),
        "xp_today": int(xp_today),
        "xp_total": int(xp_total),
        "daily_goal": goal,
        "goal_met": xp_today >= goal,
        "streak": streak,
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
    """A finished review session: XP (boosted while a boost runs), the daily log, coins and
    quests; no completion row."""
    now = utc_naive(now)
    settings = get_settings(db, user)
    if timezone:
        settings = update_settings(db, user, {"timezone": timezone})
    tz = settings.get("timezone")
    xp, boosted = economy.boosted_xp(user, max(0, int(xp)), now)
    day = local_date(now, tz)
    goal = int(settings.get("dailyGoal", 20))
    econ = economy.load()
    log = _log_xp(db, user, day, goal, xp)
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
    coins = 0
    sessions = db.query(CoinEvent).filter_by(user_id=user.id, kind="review", local_date=day).count()
    if sessions < econ.coin("review_daily_cap"):
        coins += economy.earn(db, user, econ.coin("review"), "review", None, day, now)
    coins += _goal_coins(db, user, log, day, now, econ)
    quests: list[dict[str, Any]] = []
    new_chests: list[Chest] = []
    if settings.get("chests", True):
        quests, new_chests = quests_mod.refresh(
            db, user, now=now, day=day, timezone=tz, goal=goal, econ=econ
        )
        new_chests += _milestone_chests(db, user, log, day, now, econ)
    db.commit()
    me = me_summary(db, user, now=now)
    return {
        "xp": xp,
        "boosted": boosted,
        "daily": {"xp": log.xp, "goal": goal, "met": log.met},
        "coins_earned": coins,
        "chests": [chests_mod.to_api(c) for c in new_chests],
        "quests": quests,
        "me": me,
    }
