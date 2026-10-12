"""Kratos accounts and per-learner subject libraries

- ``users.identity_id`` links a row to an Ory Kratos identity; ``password_hash`` (the Phase 11
  argon2 accounts) is dropped because Kratos now owns credentials.
- ``user_subjects`` holds the subjects each learner added. Existing learners get every subject
  they already have progress in, so their sidebar does not come up empty.

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-12
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Plain ALTER TABLE, not a batch rebuild: rebuilding `users` would drop a table every other
    # table references, which SQLite refuses with foreign keys on. A unique index stands in for
    # the unique constraint ADD COLUMN cannot carry.
    op.add_column("users", sa.Column("identity_id", sa.String(64), nullable=True))
    op.create_index("ix_users_identity_id", "users", ["identity_id"], unique=True)
    op.drop_column("users", "password_hash")
    op.create_table(
        "user_subjects",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("subject_id", sa.String(128), nullable=False),
        sa.Column("added_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("user_id", "subject_id", name="uq_user_subjects"),
    )
    op.execute(
        """
        INSERT INTO user_subjects (user_id, subject_id, added_at)
        SELECT user_id, subject, MIN(ts) FROM (
            SELECT user_id, substr(lesson_path, 1, instr(lesson_path, '/') - 1) AS subject,
                   completed_at AS ts
            FROM lesson_completions
            UNION ALL
            SELECT user_id, substr(lesson_path, 1, instr(lesson_path, '/') - 1), ts
            FROM attempts
        )
        WHERE subject != ''
        GROUP BY user_id, subject
        """
    )


def downgrade() -> None:
    op.drop_table("user_subjects")
    op.add_column("users", sa.Column("password_hash", sa.String(255), nullable=True))
    op.drop_index("ix_users_identity_id", table_name="users")
    op.drop_column("users", "identity_id")
