"""Resonance drops: the reward table (``server/app/rewards.yaml``), the roll, and applying
a reward to the inventory. The odds are public (``GET /api/rewards``).
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Any

from ruamel.yaml import YAML
from sqlalchemy.orm import Session

from ..db.models import Inventory, User

REWARDS_FILE = Path(__file__).resolve().parents[1] / "rewards.yaml"
STACKABLE = {"xp_boost", "freeze"}


@dataclass(frozen=True)
class Reward:
    key: str
    kind: str
    rarity: str
    title: str
    description: str
    icon: str
    slot: str | None = None

    def to_api(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "kind": self.kind,
            "rarity": self.rarity,
            "title": self.title,
            "description": self.description,
            "icon": self.icon,
            "slot": self.slot,
        }


@dataclass(frozen=True)
class RewardTable:
    drop_chance: float
    perfect_bonus: float
    rarities: dict[str, float]
    rewards: tuple[Reward, ...]

    def by_rarity(self, rarity: str) -> list[Reward]:
        return [r for r in self.rewards if r.rarity == rarity]

    def get(self, key: str) -> Reward | None:
        return next((r for r in self.rewards if r.key == key), None)

    def odds(self) -> dict[str, Any]:
        """Per-reward probability after a normal and a perfect lesson, for the profile page."""
        out = []
        for r in self.rewards:
            n_same = len(self.by_rarity(r.rarity)) or 1
            p_given_drop = self.rarities.get(r.rarity, 0) / n_same
            out.append(
                {
                    **r.to_api(),
                    "chance": round(self.drop_chance * p_given_drop, 4),
                    "chance_perfect": round(
                        min(1.0, self.drop_chance + self.perfect_bonus) * p_given_drop, 4
                    ),
                }
            )
        return {
            "drop_chance": self.drop_chance,
            "perfect_bonus": self.perfect_bonus,
            "rarities": self.rarities,
            "rewards": out,
        }


@lru_cache(maxsize=1)
def load_table(path: Path = REWARDS_FILE) -> RewardTable:
    data = YAML(typ="safe").load(path.read_text(encoding="utf-8")) or {}
    rewards = tuple(
        Reward(
            key=str(r["key"]),
            kind=str(r["kind"]),
            rarity=str(r.get("rarity", "common")),
            title=str(r.get("title", r["key"])),
            description=str(r.get("description", "")),
            icon=str(r.get("icon", "redeem")),
            slot=r.get("slot"),
        )
        for r in data.get("rewards", [])
    )
    rarities = {str(k): float(v) for k, v in (data.get("rarities") or {}).items()}
    return RewardTable(
        drop_chance=float(data.get("drop_chance", 0.0)),
        perfect_bonus=float(data.get("perfect_bonus", 0.0)),
        rarities=rarities,
        rewards=rewards,
    )


def roll(
    table: RewardTable,
    *,
    perfect: bool,
    rng: random.Random | None = None,
    owned: set[str] = frozenset(),
) -> Reward | None:
    """Decide the drop after a lesson. ``owned`` keys of non-stackable rewards are re-rolled
    into a stackable one of the same rarity (or nothing) so cosmetics never drop twice."""
    rng = rng or random.Random()
    chance = min(1.0, table.drop_chance + (table.perfect_bonus if perfect else 0.0))
    if rng.random() >= chance:
        return None
    rarities = list(table.rarities.items())
    total = sum(w for _, w in rarities) or 1.0
    pick = rng.random() * total
    rarity = rarities[-1][0]
    acc = 0.0
    for name, weight in rarities:
        acc += weight
        if pick < acc:
            rarity = name
            break
    pool = table.by_rarity(rarity)
    if not pool:
        return None
    reward = rng.choice(pool)
    if reward.kind not in STACKABLE and reward.key in owned:
        fallback = [r for r in pool if r.kind in STACKABLE and r.key != reward.key]
        if not fallback:
            fallback = [r for r in table.rewards if r.kind in STACKABLE]
        return rng.choice(fallback) if fallback else None
    return reward


def owned_keys(db: Session, user: User) -> set[str]:
    return {row.key for row in db.query(Inventory).filter_by(user_id=user.id)}


def grant(db: Session, user: User, reward: Reward, now: datetime) -> Inventory:
    """Add a reward to the inventory (stacking boosts and freezes). Commits are the caller's."""
    row = db.query(Inventory).filter_by(user_id=user.id, key=reward.key).first()
    if row is not None and reward.kind in STACKABLE:
        row.quantity += 1
        return row
    if row is not None:
        return row
    equipped = False
    if reward.kind in ("cosmetic", "title"):
        # The first cosmetic of a slot (or the first title) is equipped automatically.
        same_slot = [
            r
            for r in db.query(Inventory).filter_by(user_id=user.id, kind=reward.kind)
            if reward.kind == "title" or _slot_of(r.key) == reward.slot
        ]
        equipped = not any(r.equipped for r in same_slot)
    row = Inventory(
        user_id=user.id,
        kind=reward.kind,
        key=reward.key,
        rarity=reward.rarity,
        quantity=1,
        equipped=equipped,
        obtained_at=now,
    )
    db.add(row)
    db.flush()
    return row


def _slot_of(key: str) -> str | None:
    r = load_table().get(key)
    return r.slot if r else None


def consume(db: Session, user: User, kind: str, n: int = 1) -> int:
    """Use up to ``n`` stackable items of ``kind``. Returns how many were consumed."""
    row = db.query(Inventory).filter_by(user_id=user.id, kind=kind).first()
    if row is None or row.quantity <= 0:
        return 0
    used = min(n, row.quantity)
    row.quantity -= used
    if row.quantity == 0:
        db.delete(row)
    return used


def available(db: Session, user: User, kind: str) -> int:
    row = db.query(Inventory).filter_by(user_id=user.id, kind=kind).first()
    return row.quantity if row else 0


def inventory_api(db: Session, user: User) -> list[dict[str, Any]]:
    table = load_table()
    out = []
    for row in db.query(Inventory).filter_by(user_id=user.id).order_by(Inventory.obtained_at):
        reward = table.get(row.key)
        out.append(
            {
                "id": row.id,
                "key": row.key,
                "kind": row.kind,
                "rarity": row.rarity,
                "quantity": row.quantity,
                "equipped": row.equipped,
                "obtained_at": row.obtained_at.isoformat(),
                "title": reward.title if reward else row.key,
                "description": reward.description if reward else "",
                "icon": reward.icon if reward else "redeem",
                "slot": reward.slot if reward else None,
            }
        )
    return out


def equipped(db: Session, user: User) -> dict[str, str | None]:
    """{slot: key} for equipped cosmetics plus "title"."""
    table = load_table()
    out: dict[str, str | None] = {"tile_shape": None, "tile_pattern": None, "title": None}
    for row in db.query(Inventory).filter_by(user_id=user.id, equipped=True):
        reward = table.get(row.key)
        if reward is None:
            continue
        if reward.kind == "title":
            out["title"] = reward.title
        elif reward.slot:
            out[reward.slot] = reward.key
    return out


def set_equipped(db: Session, user: User, inventory_id: int, on: bool) -> dict[str, str | None]:
    row = db.query(Inventory).filter_by(user_id=user.id, id=inventory_id).first()
    if row is None:
        raise KeyError(inventory_id)
    reward = load_table().get(row.key)
    if reward is None or reward.kind not in ("cosmetic", "title"):
        raise ValueError("only cosmetics and titles can be equipped")
    if on:
        for other in db.query(Inventory).filter_by(user_id=user.id, kind=row.kind, equipped=True):
            o = load_table().get(other.key)
            if other.id != row.id and (row.kind == "title" or (o and o.slot == reward.slot)):
                other.equipped = False
    row.equipped = on
    db.commit()
    return equipped(db, user)
