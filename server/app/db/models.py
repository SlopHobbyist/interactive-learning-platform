"""SQLAlchemy models. Every table carries ``user_id`` from the start (plan §Phase 5) so that
multi-user mode (Phase 11) needs no further migration.

Item keys are the content paths ``subject/course/unit/lesson#item_id``; lesson keys are
``subject/course/unit/lesson``. They are plain strings, not foreign keys, because content lives on
disk and may change under the database (``ilp validate --check-db`` reports orphans).
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class User(Base):
    """A learner. In multi mode ``identity_id`` is the Ory Kratos identity it belongs to
    (accounts.link_user); the single-mode ``local`` user has none."""

    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    identity_id: Mapped[str | None] = mapped_column(
        String(64), unique=True, index=True, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    # Double XP until this moment (UTC); set when a chest with an XP boost is opened.
    xp_boost_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class UserSubject(Base):
    """A subject the learner added to their library (home page and sidebar). The catalog can
    hold hundreds of subjects; each learner only sees the ones they added. Removing a subject
    keeps its progress."""

    __tablename__ = "user_subjects"
    __table_args__ = (UniqueConstraint("user_id", "subject_id", name="uq_user_subjects"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    subject_id: Mapped[str] = mapped_column(String(128), nullable=False)
    added_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)


class ItemState(Base):
    """Spaced-repetition state per item (plan §7)."""

    __tablename__ = "item_state"
    __table_args__ = (UniqueConstraint("user_id", "item_path", name="uq_item_state_user_item"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    item_path: Mapped[str] = mapped_column(String(512), nullable=False, index=True)
    lesson_path: Mapped[str] = mapped_column(String(512), nullable=False, index=True)
    stability: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    difficulty: Mapped[float] = mapped_column(Float, nullable=False, default=5.0)
    last_review: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    reps: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    lapses: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class Attempt(Base):
    __tablename__ = "attempts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    item_path: Mapped[str] = mapped_column(String(512), nullable=False, index=True)
    lesson_path: Mapped[str] = mapped_column(String(512), nullable=False, index=True)
    answer: Mapped[dict | list | str | int | float | bool | None] = mapped_column(
        JSON, nullable=True
    )
    correct: Mapped[bool] = mapped_column(Boolean, nullable=False)
    partial: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    rating: Mapped[str] = mapped_column(String(8), nullable=False, default="good")
    ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    ts: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    mode: Mapped[str] = mapped_column(String(16), nullable=False, default="lesson")


class LessonCompletion(Base):
    __tablename__ = "lesson_completions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    lesson_path: Mapped[str] = mapped_column(String(512), nullable=False, index=True)
    completed_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    xp: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    accuracy: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    perfect: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    elapsed_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class XpEvent(Base):
    __tablename__ = "xp_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False, default="lesson")
    ref: Mapped[str | None] = mapped_column(String(512), nullable=True)
    local_date: Mapped[str] = mapped_column(String(10), nullable=False)  # YYYY-MM-DD in user tz
    ts: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)


class DailyLog(Base):
    __tablename__ = "daily_log"
    __table_args__ = (UniqueConstraint("user_id", "local_date", name="uq_daily_user_date"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    local_date: Mapped[str] = mapped_column(String(10), nullable=False)
    xp: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    goal: Mapped[int] = mapped_column(Integer, nullable=False, default=20)
    met: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    freeze_used: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    lessons: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class Inventory(Base):
    """What a learner holds: streak freezes (stackable, ``quantity``) and shop items they bought
    (``sound_pack`` / ``effect``, owned once, one ``equipped`` per slot). Free default items are
    never stored."""

    __tablename__ = "inventory"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)  # freeze | sound_pack | effect
    key: Mapped[str] = mapped_column(String(64), nullable=False)
    rarity: Mapped[str] = mapped_column(String(16), nullable=False, default="common")  # unused
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    equipped: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    obtained_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)


class CoinEvent(Base):
    """The coin ledger: the balance is the sum. Purchases are negative. ``ref`` makes one-off
    payouts idempotent (``goal:<date>``, ``league:<week start>``)."""

    __tablename__ = "coin_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    ref: Mapped[str | None] = mapped_column(String(512), nullable=True)
    local_date: Mapped[str] = mapped_column(String(10), nullable=False)
    ts: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)


class Chest(Base):
    """A chest earned from a lesson or a daily quest. Its contents are rolled when it is opened
    (``kind`` xp_boost | freeze | coins, ``amount`` minutes, freezes or coins)."""

    __tablename__ = "chests"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(16), nullable=False)  # lesson | quest
    ref: Mapped[str | None] = mapped_column(String(512), nullable=True)
    local_date: Mapped[str] = mapped_column(String(10), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    opened_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    kind: Mapped[str | None] = mapped_column(String(16), nullable=True)
    amount: Mapped[int | None] = mapped_column(Integer, nullable=True)


class DailyQuest(Base):
    """One of a learner's three quests for a local day (tier 0 easy, 1 medium, 2 hard)."""

    __tablename__ = "daily_quests"
    __table_args__ = (UniqueConstraint("user_id", "local_date", "tier", name="uq_daily_quest"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    local_date: Mapped[str] = mapped_column(String(10), nullable=False)
    tier: Mapped[int] = mapped_column(Integer, nullable=False)
    key: Mapped[str] = mapped_column(String(64), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    target: Mapped[int] = mapped_column(Integer, nullable=False)
    done_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    chest_id: Mapped[int | None] = mapped_column(ForeignKey("chests.id"), nullable=True)


class Wager(Base):
    """A streak wager (shop_plan.md §10.1): keep the streak for ``days`` days from ``start_date``
    to win ``payout`` coins. ``status`` is active | won | lost."""

    __tablename__ = "wagers"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    start_date: Mapped[str] = mapped_column(String(10), nullable=False)
    days: Mapped[int] = mapped_column(Integer, nullable=False)
    stake: Mapped[int] = mapped_column(Integer, nullable=False)
    payout: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(8), nullable=False, default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    settled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Setting(Base):
    __tablename__ = "settings"
    __table_args__ = (UniqueConstraint("user_id", "key", name="uq_settings_user_key"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(64), nullable=False)
    value: Mapped[dict | list | str | int | float | bool | None] = mapped_column(
        JSON, nullable=True
    )


Index("ix_attempts_user_ts", Attempt.user_id, Attempt.ts)
Index("ix_completions_user_lesson", LessonCompletion.user_id, LessonCompletion.lesson_path)
Index("ix_chests_user_date", Chest.user_id, Chest.local_date)
