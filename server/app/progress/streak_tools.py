"""Streak tools (shop_plan.md §10.1): milestone chests, streak repair and the streak wager.

Each works on the same day records as the streak itself (``streaks.Day``). A day "counts" when
the goal was met or a freeze covered it; repair works by marking missed days as covered, so the
streak code needs no special case. Freezes are applied first (``service._streak``), so repair is
only offered for a gap they could not cover.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from ..db.models import Chest, DailyLog, User, Wager
from . import chests as chests_mod
from . import economy
from .economy import Economy
from .streaks import Day, gap_days, streak_length


def day_map(db: Session, user: User) -> tuple[dict[str, DailyLog], dict[str, Day]]:
    rows = {r.local_date: r for r in db.query(DailyLog).filter_by(user_id=user.id)}
    days = {k: Day(k, r.xp, r.goal, r.met, r.freeze_used) for k, r in rows.items()}
    return rows, days


def _counts(days: dict[str, Day], d: str) -> bool:
    return d in days and days[d].counts


def _plus(d: str, n: int) -> str:
    return (date.fromisoformat(d) + timedelta(days=n)).isoformat()


# --------------------------------------------------------------- milestones
def milestone_chests(
    db: Session, user: User, *, day: str, streak: int, now: datetime, econ: Economy
) -> list[Chest]:
    """Chests for a streak that reached a milestone today. Paid once per streak: the check is
    "no milestone chest of this length since this streak began"."""
    n = econ.streak_chests.get(streak, 0)
    if n <= 0:
        return []
    start = _plus(day, -(streak - 1))
    ref = f"{streak}-day streak"
    paid = (
        db.query(Chest.id)
        .filter(
            Chest.user_id == user.id,
            Chest.source == "streak",
            Chest.ref == ref,
            Chest.local_date >= start,
        )
        .first()
    )
    if paid:
        return []
    return [chests_mod.grant(db, user, "streak", ref, day, now) for _ in range(n)]


# ------------------------------------------------------------------- repair
def repair_info(days: dict[str, Day], today: str, tools: dict[str, int]) -> dict[str, Any] | None:
    """What a repair would do now, or None when there is nothing (or too little) to repair."""
    gap = gap_days(days, today)
    if not gap or len(gap) > tools.get("repair_max_gap", 0):
        return None
    last = max(k for k, d in days.items() if d.counts and k < today)
    lost = streak_length(days, last)
    if lost < tools.get("repair_min_streak", 1):
        return None
    restored = lost + len(gap) + (1 if _counts(days, today) else 0)
    return {"missed": gap, "lost": lost, "restores": restored}


def apply_repair(db: Session, user: User, today: str, tools: dict[str, int]) -> dict[str, Any]:
    """Cover the missed days. ValueError when there is nothing to repair."""
    rows, days = day_map(db, user)
    info = repair_info(days, today, tools)
    if info is None:
        raise ValueError("there is no broken streak to repair")
    for d in info["missed"]:
        row = rows.get(d)
        if row is None:
            row = DailyLog(user_id=user.id, local_date=d, xp=0, goal=20, met=False, lessons=0)
            db.add(row)
        row.freeze_used = True
    return info


# -------------------------------------------------------------------- wager
def active_wager(db: Session, user: User) -> Wager | None:
    return db.query(Wager).filter_by(user_id=user.id, status="active").first()


def wager_state(w: Wager, days: dict[str, Day], today: str) -> tuple[int, str]:
    """(days kept so far, status). A day before today that did not count loses the wager;
    today may still be open."""
    kept = 0
    for i in range(w.days):
        d = _plus(w.start_date, i)
        if d > today:
            break
        if _counts(days, d):
            kept += 1
        elif d < today:
            return kept, "lost"
    return kept, "won" if kept >= w.days else "active"


def wager_api(w: Wager, kept: int) -> dict[str, Any]:
    return {
        "id": w.id,
        "start_date": w.start_date,
        "end_date": _plus(w.start_date, w.days - 1),
        "days": w.days,
        "kept": kept,
        "stake": w.stake,
        "payout": w.payout,
        "status": w.status,
    }


def settle_wager(
    db: Session, user: User, days: dict[str, Day], today: str, now: datetime
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """(the active wager for the API, a wager settled by this call). Commits are the caller's."""
    w = active_wager(db, user)
    if w is None:
        return None, None
    kept, status = wager_state(w, days, today)
    if status == "active":
        return wager_api(w, kept), None
    w.status, w.settled_at = status, now
    if status == "won":
        economy.earn(db, user, w.payout, "wager", f"wager:{w.id}", today, now)
    return None, wager_api(w, kept)


def start_wager(
    db: Session, user: User, today: str, now: datetime, *, stake: int, tools: dict[str, int]
) -> Wager:
    if active_wager(db, user) is not None:
        raise ValueError("you already have a wager running")
    w = Wager(
        user_id=user.id,
        start_date=today,
        days=int(tools.get("wager_days", 7)),
        stake=stake,
        payout=int(tools.get("wager_payout", stake * 2)),
        status="active",
        created_at=now,
    )
    db.add(w)
    db.flush()
    return w
