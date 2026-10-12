"""Rewards (public odds), inventory, and profile statistics."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..content.store import ContentStore
from ..db.session import current_user, get_db
from ..progress import rewards as rewards_mod
from ..progress import stats as stats_mod
from .deps import get_store
from .progress import resolve_now

router = APIRouter(prefix="/api", tags=["rewards"])


@router.get("/rewards")
def get_rewards() -> dict[str, Any]:
    return rewards_mod.load_table().odds()


@router.get("/inventory")
def get_inventory(request: Request, db: Session = Depends(get_db)) -> dict[str, Any]:
    user = current_user(request, db)
    return {
        "items": rewards_mod.inventory_api(db, user),
        "equipped": rewards_mod.equipped(db, user),
    }


class EquipIn(BaseModel):
    equipped: bool = True


@router.put("/inventory/{item_id}/equip")
def put_equip(
    item_id: int, body: EquipIn, request: Request, db: Session = Depends(get_db)
) -> dict[str, Any]:
    user = current_user(request, db)
    try:
        return {"equipped": rewards_mod.set_equipped(db, user, item_id, body.equipped)}
    except KeyError:
        raise HTTPException(status_code=404, detail="not in your inventory") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None


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
