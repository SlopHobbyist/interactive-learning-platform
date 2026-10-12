"""Weekly XP league (Phase 11): ranks the accounts on this instance that opted in.

The week is the ISO week in UTC of the XP events' timestamps. Only users whose ``league``
setting is true are listed; everyone else is invisible and sees the table without themselves.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..db.models import Setting, User, XpEvent
from ..db.session import get_db, optional_user
from .progress import resolve_now

router = APIRouter(prefix="/api/league", tags=["league"])


def week_bounds(now: datetime) -> tuple[datetime, datetime]:
    now = now.replace(tzinfo=None)
    start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    return start, start + timedelta(days=7)


@router.get("")
def get_league(
    request: Request, db: Session = Depends(get_db), now: str | None = Query(default=None)
) -> dict[str, Any]:
    override = resolve_now(request, now)
    current = (override or datetime.now(UTC)).astimezone(UTC).replace(tzinfo=None)
    start, end = week_bounds(current)
    me = optional_user(request, db)
    opted = {
        row.user_id
        for row in db.query(Setting).filter(Setting.key == "league")
        if row.value is True
    }
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
        r["me"] = bool(me and me.id == r["user_id"])
    return {
        "week_start": start.date().isoformat(),
        "week_end": (end - timedelta(days=1)).date().isoformat(),
        "mode": request.app.state.settings.mode,
        "opted_in": bool(me and me.id in opted),
        "entries": [{k: v for k, v in r.items() if k != "user_id"} for r in table],
    }
