"""Progress endpoints: attempts, completions, course progress, me, settings.

Dev-only time travel: with ``ILP_DEV=1`` a ``?now=`` query (ISO datetime) or ``?now=+30d``
offset is honoured so decay can be demoed (plan §Phase 6).
"""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..content.store import ContentStore
from ..db.models import (
    Attempt,
    Chest,
    CoinEvent,
    DailyLog,
    DailyQuest,
    Inventory,
    ItemState,
    LessonCompletion,
    Setting,
    XpEvent,
)
from ..db.session import current_user, get_db
from ..progress import economy, service
from .deps import get_store, require_dev

router = APIRouter(prefix="/api", tags=["progress"])

_OFFSET = re.compile(r"^([+-]?\d+(?:\.\d+)?)([dhm])$")


def resolve_now(request: Request, now: str | None) -> datetime | None:
    """Parse the dev-only ``now`` override. Returns None for "real now"."""
    if not now:
        return None
    if not request.app.state.settings.dev:
        raise HTTPException(status_code=400, detail="time travel needs ILP_DEV=1")
    m = _OFFSET.match(now.strip())
    if m:
        value, unit = float(m.group(1)), m.group(2)
        delta = {
            "d": timedelta(days=value),
            "h": timedelta(hours=value),
            "m": timedelta(minutes=value),
        }[unit]
        return datetime.now(UTC) + delta
    try:
        return datetime.fromisoformat(now.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail="now must be ISO 8601 or an offset like +30d"
        ) from exc


class AttemptIn(BaseModel):
    item_path: str
    answer: Any = None
    correct: bool
    partial: float | None = None
    ms: int = 0
    ts: str | None = None
    rating: str | None = None
    graded: bool = True
    item_id: str | None = None
    attempt: int | None = None


class AttemptsIn(BaseModel):
    attempts: list[AttemptIn] = Field(default_factory=list)
    timezone: str | None = None
    mode: str = "lesson"


class CompleteIn(BaseModel):
    xp: int = 0
    accuracy: float = 1.0
    perfect: bool = False
    elapsed_ms: int = 0
    timezone: str | None = None


class SettingsIn(BaseModel):
    dailyGoal: int | None = Field(default=None, ge=1, le=500)
    combo: bool | None = None
    chests: bool | None = None
    sounds: bool | None = None
    hardMode: bool | None = None
    timezone: str | None = None
    goalChosen: bool | None = None
    league: bool | None = None
    skipAhead: bool | None = None


@router.post("/attempts")
def post_attempts(
    body: AttemptsIn,
    request: Request,
    db: Session = Depends(get_db),
    now: str | None = Query(default=None),
) -> dict[str, Any]:
    user = current_user(request, db)
    n = service.record_attempts(
        db,
        user,
        [a.model_dump() for a in body.attempts],
        mode=body.mode,
        now=resolve_now(request, now),
    )
    return {"recorded": n}


@router.post("/lessons/{subject}/{course}/{unit}/{lesson}/complete")
def post_complete(
    subject: str,
    course: str,
    unit: str,
    lesson: str,
    body: CompleteIn,
    request: Request,
    db: Session = Depends(get_db),
    store: ContentStore = Depends(get_store),
    now: str | None = Query(default=None),
) -> dict[str, Any]:
    c = store.index.course(subject, course)
    lsn = store.index.lesson(subject, course, unit, lesson)
    if c is None or lsn is None:
        raise HTTPException(status_code=404, detail="lesson not found")
    user = current_user(request, db)
    return service.complete_lesson(
        db,
        user,
        c,
        lsn,
        xp=body.xp,
        accuracy=body.accuracy,
        perfect=body.perfect,
        elapsed_ms=body.elapsed_ms,
        timezone=body.timezone,
        now=resolve_now(request, now),
    )


@router.get("/progress/{subject}/{course}")
def get_progress(
    subject: str,
    course: str,
    request: Request,
    db: Session = Depends(get_db),
    store: ContentStore = Depends(get_store),
    now: str | None = Query(default=None),
) -> dict[str, Any]:
    c = store.index.course(subject, course)
    if c is None:
        raise HTTPException(status_code=404, detail="course not found")
    user = current_user(request, db)
    return service.course_progress(db, user, c, store.registry, now=resolve_now(request, now))


@router.get("/me")
def get_me(
    request: Request,
    db: Session = Depends(get_db),
    now: str | None = Query(default=None),
    tz: str | None = Query(default=None),
) -> dict[str, Any]:
    user = current_user(request, db)
    when = resolve_now(request, now)
    economy.settle_league(db, user, service.utc_naive(when), mode=request.app.state.settings.mode)
    return service.me_summary(db, user, now=when, timezone=tz)


@router.get("/settings")
def get_settings(request: Request, db: Session = Depends(get_db)) -> dict[str, Any]:
    return service.get_settings(db, current_user(request, db))


@router.put("/settings")
def put_settings(
    body: SettingsIn, request: Request, db: Session = Depends(get_db)
) -> dict[str, Any]:
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    return service.update_settings(db, current_user(request, db), patch)


@router.post("/dev/reset-progress", dependencies=[Depends(require_dev)])
def dev_reset_progress(request: Request, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Dev only: wipe the current user's progress (tests, demos)."""
    user = current_user(request, db)
    n = 0
    models = (Attempt, ItemState, LessonCompletion, XpEvent, DailyLog, Inventory, Setting)
    for model in (DailyQuest, *models, Chest, CoinEvent):
        n += db.query(model).filter_by(user_id=user.id).delete()
    user.xp_boost_until = None
    db.commit()
    return {"deleted": n}
