"""Chests, coins, daily quests and the shop (shop_plan.md)

- ``coin_events`` (the coin ledger), ``chests``, ``daily_quests`` and ``users.xp_boost_until``.
- The ``drops`` setting is renamed ``chests``.
- Resonance-drop leftovers are refunded as coins and removed: each held XP boost is worth 25,
  each cosmetic or title 100, and each freeze above the new cap of 2 is worth 100 (its price).

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-13
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("xp_boost_until", sa.DateTime(), nullable=True))
    op.create_table(
        "coin_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("ref", sa.String(512), nullable=True),
        sa.Column("local_date", sa.String(10), nullable=False),
        sa.Column("ts", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "chests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("source", sa.String(16), nullable=False),
        sa.Column("ref", sa.String(512), nullable=True),
        sa.Column("local_date", sa.String(10), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("opened_at", sa.DateTime(), nullable=True),
        sa.Column("kind", sa.String(16), nullable=True),
        sa.Column("amount", sa.Integer(), nullable=True),
    )
    op.create_index("ix_chests_user_date", "chests", ["user_id", "local_date"])
    op.create_table(
        "daily_quests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("local_date", sa.String(10), nullable=False),
        sa.Column("tier", sa.Integer(), nullable=False),
        sa.Column("key", sa.String(64), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("target", sa.Integer(), nullable=False),
        sa.Column("done_at", sa.DateTime(), nullable=True),
        sa.Column("chest_id", sa.Integer(), sa.ForeignKey("chests.id"), nullable=True),
        sa.UniqueConstraint("user_id", "local_date", "tier", name="uq_daily_quest"),
    )

    op.execute("UPDATE settings SET key = 'chests' WHERE key = 'drops'")

    refund = """
        INSERT INTO coin_events (user_id, amount, kind, ref, local_date, ts)
        SELECT user_id, {amount}, 'refund', key, date('now'), datetime('now')
        FROM inventory WHERE {where}
    """
    op.execute(refund.format(amount="quantity * 25", where="kind = 'xp_boost' AND quantity > 0"))
    op.execute(refund.format(amount="100", where="kind IN ('cosmetic', 'title')"))
    op.execute(
        refund.format(amount="(quantity - 2) * 100", where="kind = 'freeze' AND quantity > 2")
    )
    op.execute("DELETE FROM inventory WHERE kind IN ('xp_boost', 'cosmetic', 'title')")
    op.execute("UPDATE inventory SET quantity = 2 WHERE kind = 'freeze' AND quantity > 2")


def downgrade() -> None:
    # The refunds and the removed cosmetics are not restored.
    op.execute("UPDATE settings SET key = 'drops' WHERE key = 'chests'")
    op.drop_table("daily_quests")
    op.drop_index("ix_chests_user_date", table_name="chests")
    op.drop_table("chests")
    op.drop_table("coin_events")
    op.drop_column("users", "xp_boost_until")
