"""The economy (shop_plan.md): the config in ``server/app/economy.yaml``, the coin ledger,
streak freezes (capped), the timed XP boost and the weekly league payout.

Chests are in ``chests.py``, daily quests in ``quests.py`` and the catalog in ``shop.py``.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Any

from ruamel.yaml import YAML
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..db.models import CoinEvent, Inventory, User

ECONOMY_FILE = Path(__file__).resolve().parents[1] / "economy.yaml"
TIERS = ("easy", "medium", "hard")

CONTENT_LABELS = {
    "xp_boost": ("XP boost", "speed"),
    "freeze": ("Streak freeze", "ac_unit"),
    "coins": ("Coins", "toll"),
}


@dataclass(frozen=True)
class QuestDef:
    key: str
    kind: str
    title: str
    icon: str
    target: int | None = None
    target_goal: float | None = None
    requires_items: int = 0

    def target_for(self, goal: int) -> int:
        """The fixed target, or a multiple of the daily goal rounded to 5 (at least 5)."""
        if self.target_goal is None:
            return max(1, int(self.target or 1))
        return max(5, int(round(goal * self.target_goal / 5.0)) * 5)

    def title_for(self, target: int) -> str:
        return self.title.replace("{n}", str(target))


@dataclass(frozen=True)
class LessonChestRules:
    base: float
    per_session_lesson: float
    session_max: float
    session_gap_minutes: int
    perfect: float
    per_dry_lesson: float
    guarantee_after: int
    first_lesson: bool
    daily_cap: int


@dataclass(frozen=True)
class Economy:
    coins: dict[str, Any]
    contents: dict[str, float]
    chest_coins: tuple[int, ...]
    boost_minutes: int
    freeze_cap: int
    lesson: LessonChestRules
    quests: dict[str, tuple[QuestDef, ...]]
    streak_chests: dict[int, int]
    tools: dict[str, int]

    def coin(self, key: str) -> int:
        return int(self.coins.get(key, 0) or 0)

    def quest(self, key: str) -> QuestDef | None:
        return next((q for tier in self.quests.values() for q in tier if q.key == key), None)

    def odds(self) -> dict[str, Any]:
        """The public odds: what a chest holds, and the lesson-chest rules."""
        total = sum(self.contents.values()) or 1.0
        contents = [
            {
                "kind": kind,
                "title": CONTENT_LABELS.get(kind, (kind, "redeem"))[0],
                "icon": CONTENT_LABELS.get(kind, (kind, "redeem"))[1],
                "chance": round(weight / total, 4),
            }
            for kind, weight in self.contents.items()
        ]
        r = self.lesson
        return {
            "contents": contents,
            "coins": list(self.chest_coins),
            "boost_minutes": self.boost_minutes,
            "freeze_cap": self.freeze_cap,
            "lesson": {
                "base": r.base,
                "per_session_lesson": r.per_session_lesson,
                "session_max": r.session_max,
                "session_gap_minutes": r.session_gap_minutes,
                "perfect": r.perfect,
                "per_dry_lesson": r.per_dry_lesson,
                "guarantee_after": r.guarantee_after,
                "first_lesson": r.first_lesson,
                "daily_cap": r.daily_cap,
            },
            "streak_chests": {str(k): v for k, v in sorted(self.streak_chests.items())},
            "tools": dict(self.tools),
            "earn": {
                "lesson": self.coin("lesson"),
                "perfect_bonus": self.coin("perfect_bonus"),
                "review": self.coin("review"),
                "daily_goal": self.coin("daily_goal"),
                "league": [int(x) for x in self.coins.get("league") or []],
            },
        }


@lru_cache(maxsize=1)
def load(path: Path = ECONOMY_FILE) -> Economy:
    data = YAML(typ="safe").load(path.read_text(encoding="utf-8")) or {}
    chests = data.get("chests") or {}
    lc = data.get("lesson_chest") or {}
    quests: dict[str, tuple[QuestDef, ...]] = {}
    for tier in TIERS:
        quests[tier] = tuple(
            QuestDef(
                key=str(q["key"]),
                kind=str(q["kind"]),
                title=str(q.get("title", q["key"])),
                icon=str(q.get("icon", "flag")),
                target=q.get("target"),
                target_goal=q.get("target_goal"),
                requires_items=int(q.get("requires_items", 0) or 0),
            )
            for q in (data.get("quests") or {}).get(tier) or []
        )
    return Economy(
        coins=dict(data.get("coins") or {}),
        contents={str(k): float(v) for k, v in (chests.get("contents") or {}).items()},
        chest_coins=tuple(int(x) for x in chests.get("coins") or [10]),
        boost_minutes=int(chests.get("boost_minutes", 15)),
        freeze_cap=int(chests.get("freeze_cap", 2)),
        lesson=LessonChestRules(
            base=float(lc.get("base", 0.0)),
            per_session_lesson=float(lc.get("per_session_lesson", 0.0)),
            session_max=float(lc.get("session_max", 0.0)),
            session_gap_minutes=int(lc.get("session_gap_minutes", 30)),
            perfect=float(lc.get("perfect", 0.0)),
            per_dry_lesson=float(lc.get("per_dry_lesson", 0.0)),
            guarantee_after=int(lc.get("guarantee_after", 0) or 0),
            first_lesson=bool(lc.get("first_lesson", False)),
            daily_cap=int(lc.get("daily_cap", 0) or 0),
        ),
        quests=quests,
        streak_chests={int(k): int(v) for k, v in (data.get("streak_chests") or {}).items()},
        tools={str(k): int(v) for k, v in (data.get("streak_tools") or {}).items()},
    )


# -------------------------------------------------------------------- coins
def balance(db: Session, user: User) -> int:
    return int(
        db.query(func.coalesce(func.sum(CoinEvent.amount), 0))
        .filter(CoinEvent.user_id == user.id)
        .scalar()
        or 0
    )


def paid(db: Session, user: User, kind: str, ref: str) -> bool:
    return db.query(CoinEvent.id).filter_by(user_id=user.id, kind=kind, ref=ref).first() is not None


def earn(
    db: Session, user: User, amount: int, kind: str, ref: str | None, day: str, now: datetime
) -> int:
    """Credit coins. Returns the amount (0 when there is nothing to pay)."""
    amount = int(amount)
    if amount <= 0:
        return 0
    db.add(CoinEvent(user_id=user.id, amount=amount, kind=kind, ref=ref, local_date=day, ts=now))
    return amount


def spend(
    db: Session, user: User, amount: int, kind: str, ref: str | None, day: str, now: datetime
) -> None:
    """Debit coins. Raises ValueError when the balance is short. Commits are the caller's."""
    if balance(db, user) < amount:
        raise ValueError("not enough coins")
    db.add(
        CoinEvent(user_id=user.id, amount=-int(amount), kind=kind, ref=ref, local_date=day, ts=now)
    )


# ------------------------------------------------------------------ freezes
def available(db: Session, user: User, kind: str) -> int:
    row = db.query(Inventory).filter_by(user_id=user.id, kind=kind).first()
    return row.quantity if row else 0


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


def add_freeze(db: Session, user: User, now: datetime, cap: int) -> bool:
    """One more streak freeze, unless the learner already holds ``cap``."""
    row = db.query(Inventory).filter_by(user_id=user.id, kind="freeze").first()
    if row is not None and row.quantity >= cap:
        return False
    if row is None:
        db.add(
            Inventory(
                user_id=user.id, kind="freeze", key="streak_freeze", quantity=1, obtained_at=now
            )
        )
    else:
        row.quantity += 1
    db.flush()
    return True


# -------------------------------------------------------------------- boost
def boost_seconds(user: User, now: datetime) -> int:
    if user.xp_boost_until is None or user.xp_boost_until <= now:
        return 0
    return int((user.xp_boost_until - now).total_seconds())


def extend_boost(user: User, now: datetime, minutes: int) -> datetime:
    """Start a boost, or add to the one already running."""
    start = user.xp_boost_until if user.xp_boost_until and user.xp_boost_until > now else now
    user.xp_boost_until = start + timedelta(minutes=minutes)
    return user.xp_boost_until


def boosted_xp(user: User, xp: int, now: datetime) -> tuple[int, bool]:
    """Double ``xp`` while a boost is running."""
    if xp > 0 and boost_seconds(user, now) > 0:
        return xp * 2, True
    return xp, False


# ------------------------------------------------------------------- league
def settle_league(db: Session, user: User, now: datetime, *, mode: str) -> int:
    """Pay last week's league coins once (multi-user mode only). Returns the coins paid."""
    if mode != "multi":
        return 0
    from .league import standings, week_bounds

    econ = load()
    prizes = [int(x) for x in econ.coins.get("league") or []]
    if not prizes:
        return 0
    this_start, _ = week_bounds(now)
    start = this_start - timedelta(days=7)
    ref = f"league:{start.date().isoformat()}"
    if paid(db, user, "league", ref):
        return 0
    table = [r for r in standings(db, start, this_start) if r["xp"] > 0]
    if len(table) < int(econ.coins.get("league_min_learners", 3) or 0):
        return 0
    rank = next((i for i, r in enumerate(table) if r["user_id"] == user.id), None)
    if rank is None or rank >= len(prizes):
        return 0
    day = now.date().isoformat()
    amount = earn(db, user, prizes[rank], "league", ref, day, now)
    db.commit()
    return amount
