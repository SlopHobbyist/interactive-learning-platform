"""Chests (public odds, opening), daily quests, the shop, and profile statistics."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..content.store import ContentStore
from ..db.models import User
from ..db.session import current_user, get_db
from ..progress import chests as chests_mod
from ..progress import economy
from ..progress import quests as quests_mod
from ..progress import shop as shop_mod
from ..progress import stats as stats_mod
from ..progress.service import get_settings, local_date, me_summary, utc_naive
from .deps import get_store
from .progress import resolve_now

router = APIRouter(prefix="/api", tags=["economy"])


def _today(db: Session, user: User, now: datetime, tz: str | None) -> tuple[str, str | None]:
    tz = tz or get_settings(db, user).get("timezone")
    return local_date(now, tz), tz


# ------------------------------------------------------------------- quests
@router.get("/quests")
def get_quests(
    request: Request,
    db: Session = Depends(get_db),
    now: str | None = Query(default=None),
    tz: str | None = Query(default=None),
) -> dict[str, Any]:
    user = current_user(request, db)
    when = utc_naive(resolve_now(request, now))
    settings = get_settings(db, user)
    day, zone = _today(db, user, when, tz)
    if not settings.get("chests", True):
        return {"enabled": False, "date": day, "resets_in": 0, "quests": [], "chests": []}
    quests, granted = quests_mod.refresh(
        db,
        user,
        now=when,
        day=day,
        timezone=zone,
        goal=int(settings.get("dailyGoal", 20)),
        econ=economy.load(),
    )
    db.commit()
    return {
        "enabled": True,
        "date": day,
        "resets_in": quests_mod.resets_in(when, day, zone),
        "quests": quests,
        "chests": [chests_mod.to_api(c) for c in granted],
    }


# ------------------------------------------------------------------- chests
@router.get("/chests")
def get_chests(request: Request, db: Session = Depends(get_db)) -> dict[str, Any]:
    user = current_user(request, db)
    return {
        "unopened": [chests_mod.to_api(c) for c in chests_mod.unopened(db, user)],
        "odds": economy.load().odds(),
    }


@router.post("/chests/{chest_id}/open")
def post_open_chest(
    chest_id: int,
    request: Request,
    db: Session = Depends(get_db),
    now: str | None = Query(default=None),
    tz: str | None = Query(default=None),
) -> dict[str, Any]:
    user = current_user(request, db)
    when = utc_naive(resolve_now(request, now))
    day, _ = _today(db, user, when, tz)
    try:
        chest = chests_mod.open_chest(db, user, chest_id, when, day)
    except KeyError:
        raise HTTPException(status_code=404, detail="not your chest") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    return {"chest": chests_mod.to_api(chest), "me": me_summary(db, user, now=when, timezone=tz)}


# --------------------------------------------------------------------- shop
@router.get("/shop")
def get_shop(
    request: Request,
    db: Session = Depends(get_db),
    now: str | None = Query(default=None),
    tz: str | None = Query(default=None),
) -> dict[str, Any]:
    user = current_user(request, db)
    when = utc_naive(resolve_now(request, now))
    day, zone = _today(db, user, when, tz)
    economy.settle_league(db, user, when, mode=request.app.state.settings.mode)
    me_summary(db, user, now=when, timezone=zone)  # applies freezes, settles a wager
    return shop_mod.catalog_api(db, user, day)


@router.post("/shop/{key}/buy")
def post_buy(
    key: str,
    request: Request,
    db: Session = Depends(get_db),
    now: str | None = Query(default=None),
    tz: str | None = Query(default=None),
) -> dict[str, Any]:
    user = current_user(request, db)
    when = utc_naive(resolve_now(request, now))
    day, zone = _today(db, user, when, tz)
    me_summary(
        db, user, now=when, timezone=zone
    )  # freezes first: repair covers what they could not
    try:
        item = shop_mod.buy(db, user, key, when, day)
    except KeyError:
        raise HTTPException(status_code=404, detail="no such item") from None
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from None
    return {
        "item": item.to_api(),
        "coins": economy.balance(db, user),
        "equipped": shop_mod.equipped(db, user),
        "me": me_summary(db, user, now=when, timezone=tz),
    }


class EquipIn(BaseModel):
    key: str


@router.put("/shop/equip")
def put_equip(body: EquipIn, request: Request, db: Session = Depends(get_db)) -> dict[str, Any]:
    user = current_user(request, db)
    try:
        return {"equipped": shop_mod.equip(db, user, body.key)}
    except KeyError:
        raise HTTPException(status_code=404, detail="no such item") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None


# -------------------------------------------------------------------- stats
@router.get("/stats")
def get_stats(
    request: Request,
    db: Session = Depends(get_db),
    store: ContentStore = Depends(get_store),
    now: str | None = Query(default=None),
    tz: str | None = Query(default=None),
) -> dict[str, Any]:
    user = current_user(request, db)
    return stats_mod.stats(
        db, user, store.index, store.registry, now=resolve_now(request, now), timezone=tz
    )
