"""Chests (shop_plan.md §3–4): the chance of one after a lesson, granting, and opening.

The chance is a pure function of a small state (``LessonState``) read from the database before
the completion is recorded, so the rules are unit-testable without one. A chest's contents are
rolled when it is opened, so the freeze cap applies to what the learner holds at that moment.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from ..db.models import Chest, User, XpEvent
from . import economy
from .economy import CONTENT_LABELS, Economy, LessonChestRules

SOURCE_TITLES = {"lesson": "Lesson chest", "quest": "Quest chest"}


@dataclass(frozen=True)
class LessonState:
    session: int  # XP-earning activities already done this session
    dry: int  # first completions since the last lesson chest
    today: int  # lesson chests already earned today
    first: bool  # no lesson has ever been completed


def chance(rules: LessonChestRules, state: LessonState, *, perfect: bool) -> float:
    if rules.daily_cap and state.today >= rules.daily_cap:
        return 0.0
    if rules.first_lesson and state.first:
        return 1.0
    if rules.guarantee_after and state.dry >= rules.guarantee_after:
        return 1.0
    c = (
        rules.base
        + min(rules.session_max, rules.per_session_lesson * state.session)
        + (rules.perfect if perfect else 0.0)
        + rules.per_dry_lesson * state.dry
    )
    return round(min(1.0, max(0.0, c)), 4)


def after(state: LessonState, granted: bool) -> LessonState:
    """The state for the next lesson, assuming it follows within the session."""
    return LessonState(
        session=state.session + 1,
        dry=0 if granted else state.dry + 1,
        today=state.today + (1 if granted else 0),
        first=False,
    )


def next_chance(rules: LessonChestRules, state: LessonState) -> dict[str, Any]:
    return {
        "chance": chance(rules, state, perfect=False),
        "chance_perfect": chance(rules, state, perfect=True),
        "today": state.today,
        "cap": rules.daily_cap,
        "capped": bool(rules.daily_cap and state.today >= rules.daily_cap),
    }


def lesson_state(
    db: Session, user: User, now: datetime, day: str, rules: LessonChestRules
) -> LessonState:
    """Read the state before the current completion is recorded."""
    gap = timedelta(minutes=rules.session_gap_minutes)
    session = 0
    prev = now
    events = (
        db.query(XpEvent.ts)
        .filter(XpEvent.user_id == user.id, XpEvent.ts <= now)
        .order_by(XpEvent.ts.desc())
        .limit(50)
    )
    for (ts,) in events:
        if prev - ts > gap:
            break
        session += 1
        prev = ts
    last = (
        db.query(Chest.created_at)
        .filter(Chest.user_id == user.id, Chest.source == "lesson")
        .order_by(Chest.created_at.desc())
        .first()
    )
    lessons = db.query(XpEvent).filter(XpEvent.user_id == user.id, XpEvent.kind == "lesson")
    dry = (lessons.filter(XpEvent.ts > last[0]) if last else lessons).count()
    today = db.query(Chest).filter_by(user_id=user.id, source="lesson", local_date=day).count()
    first = last is None and dry == 0
    return LessonState(session=session, dry=dry, today=today, first=first)


def grant(db: Session, user: User, source: str, ref: str | None, day: str, now: datetime) -> Chest:
    chest = Chest(user_id=user.id, source=source, ref=ref, local_date=day, created_at=now)
    db.add(chest)
    db.flush()
    return chest


def unopened(db: Session, user: User) -> list[Chest]:
    return (
        db.query(Chest)
        .filter(Chest.user_id == user.id, Chest.opened_at.is_(None))
        .order_by(Chest.created_at, Chest.id)
        .all()
    )


def roll_contents(econ: Economy, rng: random.Random, freezes_held: int) -> tuple[str, int]:
    """(kind, amount). A freeze over the cap becomes coins."""
    kinds = list(econ.contents.items())
    total = sum(w for _, w in kinds) or 1.0
    pick = rng.random() * total
    kind = kinds[-1][0]
    acc = 0.0
    for name, weight in kinds:
        acc += weight
        if pick < acc:
            kind = name
            break
    if kind == "freeze" and freezes_held >= econ.freeze_cap:
        kind = "coins"
    if kind == "xp_boost":
        return kind, econ.boost_minutes
    if kind == "freeze":
        return kind, 1
    return "coins", rng.choice(econ.chest_coins)


def open_chest(
    db: Session,
    user: User,
    chest_id: int,
    now: datetime,
    day: str,
    rng: random.Random | None = None,
) -> Chest:
    """Roll and apply a chest's contents. KeyError: not yours; ValueError: already open."""
    chest = db.query(Chest).filter_by(user_id=user.id, id=chest_id).first()
    if chest is None:
        raise KeyError(chest_id)
    if chest.opened_at is not None:
        raise ValueError("this chest is already open")
    econ = economy.load()
    kind, amount = roll_contents(
        econ, rng or random.Random(), economy.available(db, user, "freeze")
    )
    if kind == "xp_boost":
        economy.extend_boost(user, now, amount)
    elif kind == "freeze":
        economy.add_freeze(db, user, now, econ.freeze_cap)
    else:
        economy.earn(db, user, amount, "chest", f"chest:{chest.id}", day, now)
    chest.kind, chest.amount, chest.opened_at = kind, amount, now
    db.commit()
    return chest


def reward_api(kind: str | None, amount: int | None) -> dict[str, Any] | None:
    if kind is None:
        return None
    title, icon = CONTENT_LABELS.get(kind, (kind, "redeem"))
    if kind == "xp_boost":
        text = f"{amount} minutes of double XP, starting now."
        title = f"{amount}-minute XP boost"
    elif kind == "freeze":
        text = "Covers one missed day automatically."
    else:
        text = "Spend them in the shop."
        title = f"{amount} coins"
    return {"kind": kind, "amount": amount, "title": title, "description": text, "icon": icon}


def to_api(chest: Chest) -> dict[str, Any]:
    return {
        "id": chest.id,
        "source": chest.source,
        "title": SOURCE_TITLES.get(chest.source, "Chest"),
        "subtitle": chest.ref if chest.source == "quest" else None,
        "local_date": chest.local_date,
        "opened": chest.opened_at is not None,
        "reward": reward_api(chest.kind, chest.amount),
    }
