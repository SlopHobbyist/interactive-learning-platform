"""Weekly XP league (Phase 11): ranks the accounts on this instance that opted in.

The week is the ISO week in UTC of the XP events' timestamps. Only users whose ``league``
setting is true (the default) are listed; anyone who opts out is invisible and sees the table
without themselves. The top three of a finished week are paid coins (progress/economy.py).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from ..db.session import get_db, optional_user
from ..progress.league import opted_in, standings, week_bounds
from .progress import resolve_now

router = APIRouter(prefix="/api/league", tags=["league"])


@router.get("")
def get_league(
    request: Request, db: Session = Depends(get_db), now: str | None = Query(default=None)
) -> dict[str, Any]:
    override = resolve_now(request, now)
    current = (override or datetime.now(UTC)).astimezone(UTC).replace(tzinfo=None)
    start, end = week_bounds(current)
    me = optional_user(request, db)
    table = standings(db, start, end)
    for r in table:
        r["me"] = bool(me and me.id == r["user_id"])
    return {
        "week_start": start.date().isoformat(),
        "week_end": (end - timedelta(days=1)).date().isoformat(),
        "mode": request.app.state.settings.mode,
        "opted_in": bool(me and me.id in opted_in(db)),
        "entries": [{k: v for k, v in r.items() if k != "user_id"} for r in table],
    }
