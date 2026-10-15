"""Streak wagers

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-13
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "wagers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("start_date", sa.String(10), nullable=False),
        sa.Column("days", sa.Integer(), nullable=False),
        sa.Column("stake", sa.Integer(), nullable=False),
        sa.Column("payout", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(8), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("settled_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("wagers")
