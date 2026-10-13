"""Weekly XP league standings (Phase 11), shared by the league page and its coin payout.

The week is the ISO week in UTC of the XP events' timestamps. Only users whose ``league``
setting is true (the default) are listed.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..db.models import Setting, User, XpEvent

DEFAULT_OPT_IN = True  # mirrors DEFAULT_SETTINGS["league"] in service.py


def week_bounds(now: datetime) -> tuple[datetime, datetime]:
    now = now.replace(tzinfo=None)
    start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    return start, start + timedelta(days=7)


def opted_in(db: Session) -> set[int]:
    # Users who never touched the setting follow the default.
    stored = {row.user_id: row.value for row in db.query(Setting).filter(Setting.key == "league")}
    return {uid for (uid,) in db.query(User.id) if stored.get(uid, DEFAULT_OPT_IN) is True}


def standings(db: Session, start: datetime, end: datetime) -> list[dict[str, Any]]:
    """Opted-in learners by XP earned in [start, end), best first, with ``rank``."""
    opted = opted_in(db)
    rows = (
        db.query(User.id, User.username, func.coalesce(func.sum(XpEvent.amount), 0))
        .outerjoin(
            XpEvent,
            (XpEvent.user_id == User.id) & (XpEvent.ts >= start) & (XpEvent.ts < end),
        )
        .group_by(User.id)
        .all()
    )
    table = [
        {"user_id": uid, "username": name, "xp": int(xp)} for uid, name, xp in rows if uid in opted
    ]
    table.sort(key=lambda r: (-r["xp"], r["username"]))
    for i, r in enumerate(table):
        r["rank"] = i + 1
    return table
