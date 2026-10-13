"""The shop (shop_plan.md §6): the catalog in ``server/app/shop.yaml``, buying with coins and
equipping. Slot items (sound packs, effects) are owned once and one per slot is equipped; the
default item of a slot is free, always owned and never stored. Freezes stack up to the cap.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Any

from ruamel.yaml import YAML
from sqlalchemy.orm import Session

from ..db.models import Inventory, User
from . import economy

SHOP_FILE = Path(__file__).resolve().parents[1] / "shop.yaml"
SLOTS = ("sounds", "effect")


@dataclass(frozen=True)
class Item:
    key: str
    kind: str
    title: str
    description: str
    icon: str
    price: int
    slot: str | None = None
    default: bool = False
    asset: str | None = None
    steps: int = 0

    def to_api(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "kind": self.kind,
            "slot": self.slot,
            "title": self.title,
            "description": self.description,
            "icon": self.icon,
            "price": self.price,
            "default": self.default,
            "asset": self.asset,
            "steps": self.steps,
        }


@dataclass(frozen=True)
class Catalog:
    items: tuple[Item, ...]

    def get(self, key: str) -> Item | None:
        return next((i for i in self.items if i.key == key), None)

    def default(self, slot: str) -> Item | None:
        return next((i for i in self.items if i.slot == slot and i.default), None)


@lru_cache(maxsize=1)
def load(path: Path = SHOP_FILE) -> Catalog:
    data = YAML(typ="safe").load(path.read_text(encoding="utf-8")) or {}
    return Catalog(
        items=tuple(
            Item(
                key=str(i["key"]),
                kind=str(i["kind"]),
                title=str(i.get("title", i["key"])),
                description=str(i.get("description", "")),
                icon=str(i.get("icon", "storefront")),
                price=int(i.get("price", 0)),
                slot=i.get("slot"),
                default=bool(i.get("default", False)),
                asset=i.get("asset"),
                steps=int(i.get("steps", 0) or 0),
            )
            for i in data.get("items", [])
        )
    )


def owned_keys(db: Session, user: User) -> set[str]:
    return {
        row.key
        for row in db.query(Inventory).filter(
            Inventory.user_id == user.id, Inventory.kind.in_(("sound_pack", "effect"))
        )
    }


def equipped(db: Session, user: User) -> dict[str, dict[str, Any]]:
    """{slot: item} for every slot, falling back to the slot's default."""
    cat = load()
    out: dict[str, dict[str, Any]] = {}
    rows = db.query(Inventory).filter(
        Inventory.user_id == user.id,
        Inventory.kind.in_(("sound_pack", "effect")),
        Inventory.equipped.is_(True),
    )
    for row in rows:
        item = cat.get(row.key)
        if item and item.slot:
            out[item.slot] = item.to_api()
    for slot in SLOTS:
        if slot not in out and (d := cat.default(slot)) is not None:
            out[slot] = d.to_api()
    return out


def catalog_api(db: Session, user: User) -> dict[str, Any]:
    cat = load()
    econ = economy.load()
    owned = owned_keys(db, user)
    eq = equipped(db, user)
    coins = economy.balance(db, user)
    freezes = economy.available(db, user, "freeze")
    items = []
    for item in cat.items:
        is_owned = item.default or item.key in owned
        at_cap = item.kind == "freeze" and freezes >= econ.freeze_cap
        items.append(
            {
                **item.to_api(),
                "owned": is_owned if item.slot else False,
                "equipped": bool(item.slot and eq.get(item.slot, {}).get("key") == item.key),
                "held": freezes if item.kind == "freeze" else None,
                "can_buy": (not item.slot or not is_owned) and not at_cap and coins >= item.price,
            }
        )
    return {
        "coins": coins,
        "freezes": freezes,
        "freeze_cap": econ.freeze_cap,
        "items": items,
        "equipped": eq,
    }


def _equip(db: Session, user: User, item: Item) -> None:
    for row in db.query(Inventory).filter(
        Inventory.user_id == user.id, Inventory.kind == item.kind, Inventory.equipped.is_(True)
    ):
        other = load().get(row.key)
        if other and other.slot == item.slot and row.key != item.key:
            row.equipped = False
    row = db.query(Inventory).filter_by(user_id=user.id, key=item.key).first()
    if row is not None:
        row.equipped = True


def buy(db: Session, user: User, key: str, now: datetime, day: str) -> Item:
    """KeyError: no such item. ValueError: cannot buy it (with the reason)."""
    item = load().get(key)
    if item is None:
        raise KeyError(key)
    econ = economy.load()
    if item.slot and (item.default or key in owned_keys(db, user)):
        raise ValueError("you already own this")
    if item.kind == "freeze" and economy.available(db, user, "freeze") >= econ.freeze_cap:
        raise ValueError(f"you already hold {econ.freeze_cap} streak freezes")
    economy.spend(db, user, item.price, "shop", item.key, day, now)  # ValueError when short
    if item.kind == "freeze":
        economy.add_freeze(db, user, now, econ.freeze_cap)
    else:
        db.add(
            Inventory(
                user_id=user.id,
                kind=item.kind,
                key=item.key,
                quantity=1,
                equipped=False,
                obtained_at=now,
            )
        )
        db.flush()
        _equip(db, user, item)  # buying equips
    db.commit()
    return item


def equip(db: Session, user: User, key: str) -> dict[str, dict[str, Any]]:
    """Equip an owned slot item (or a slot's default, which un-equips the rest)."""
    item = load().get(key)
    if item is None:
        raise KeyError(key)
    if not item.slot:
        raise ValueError("only sound packs and effects can be equipped")
    if item.default:
        for row in db.query(Inventory).filter(
            Inventory.user_id == user.id, Inventory.kind == item.kind, Inventory.equipped.is_(True)
        ):
            other = load().get(row.key)
            if other and other.slot == item.slot:
                row.equipped = False
    elif key not in owned_keys(db, user):
        raise ValueError("buy it first")
    else:
        _equip(db, user, item)
    db.commit()
    return equipped(db, user)
