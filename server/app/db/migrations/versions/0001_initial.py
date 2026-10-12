"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-10-12
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("username", sa.String(64), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "item_state",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("item_path", sa.String(512), nullable=False, index=True),
        sa.Column("lesson_path", sa.String(512), nullable=False, index=True),
        sa.Column("stability", sa.Float(), nullable=False, server_default="1.0"),
        sa.Column("difficulty", sa.Float(), nullable=False, server_default="5.0"),
        sa.Column("last_review", sa.DateTime(), nullable=False),
        sa.Column("reps", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("lapses", sa.Integer(), nullable=False, server_default="0"),
        sa.UniqueConstraint("user_id", "item_path", name="uq_item_state_user_item"),
    )
    op.create_table(
        "attempts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("item_path", sa.String(512), nullable=False, index=True),
        sa.Column("lesson_path", sa.String(512), nullable=False, index=True),
        sa.Column("answer", sa.JSON(), nullable=True),
        sa.Column("correct", sa.Boolean(), nullable=False),
        sa.Column("partial", sa.Float(), nullable=False, server_default="0"),
        sa.Column("rating", sa.String(8), nullable=False, server_default="good"),
        sa.Column("ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ts", sa.DateTime(), nullable=False),
        sa.Column("mode", sa.String(16), nullable=False, server_default="lesson"),
    )
    op.create_index("ix_attempts_user_ts", "attempts", ["user_id", "ts"])
    op.create_table(
        "lesson_completions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("lesson_path", sa.String(512), nullable=False, index=True),
        sa.Column("completed_at", sa.DateTime(), nullable=False),
        sa.Column("xp", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("accuracy", sa.Float(), nullable=False, server_default="1.0"),
        sa.Column("perfect", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("elapsed_ms", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_completions_user_lesson", "lesson_completions", ["user_id", "lesson_path"])
    op.create_table(
        "xp_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False, server_default="lesson"),
        sa.Column("ref", sa.String(512), nullable=True),
        sa.Column("local_date", sa.String(10), nullable=False),
        sa.Column("ts", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "daily_log",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("local_date", sa.String(10), nullable=False),
        sa.Column("xp", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("goal", sa.Integer(), nullable=False, server_default="20"),
        sa.Column("met", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("freeze_used", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("lessons", sa.Integer(), nullable=False, server_default="0"),
        sa.UniqueConstraint("user_id", "local_date", name="uq_daily_user_date"),
    )
    op.create_table(
        "inventory",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("key", sa.String(64), nullable=False),
        sa.Column("rarity", sa.String(16), nullable=False, server_default="common"),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("equipped", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("obtained_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("key", sa.String(64), nullable=False),
        sa.Column("value", sa.JSON(), nullable=True),
        sa.UniqueConstraint("user_id", "key", name="uq_settings_user_key"),
    )


def downgrade() -> None:
    for name in (
        "settings",
        "inventory",
        "daily_log",
        "xp_events",
        "lesson_completions",
        "attempts",
        "item_state",
        "users",
    ):
        op.drop_table(name)
