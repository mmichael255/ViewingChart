"""Fix users schema for existing dev DB.

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-07

This migration is intentionally defensive: some dev DBs were created manually
or with partial schema, so the `users` table may exist but miss columns/indexes
from the initial model.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def _has_column(bind, table: str, column: str) -> bool:
    insp = sa.inspect(bind)
    return any(col["name"] == column for col in insp.get_columns(table))


def _has_index(bind, table: str, index_name: str) -> bool:
    insp = sa.inspect(bind)
    return any(ix["name"] == index_name for ix in insp.get_indexes(table))


def upgrade() -> None:
    bind = op.get_bind()

    # Columns expected by `app.database.models.User`
    if not _has_column(bind, "users", "password_hash"):
        op.add_column(
            "users",
            sa.Column("password_hash", sa.String(length=255), nullable=False, server_default=""),
        )

    if not _has_column(bind, "users", "display_name"):
        op.add_column("users", sa.Column("display_name", sa.String(length=100), nullable=True))

    if not _has_column(bind, "users", "avatar_url"):
        op.add_column("users", sa.Column("avatar_url", sa.String(length=500), nullable=True))

    if not _has_column(bind, "users", "is_active"):
        op.add_column("users", sa.Column("is_active", sa.Boolean(), nullable=True, server_default=sa.text("1")))

    if not _has_column(bind, "users", "updated_at"):
        op.add_column("users", sa.Column("updated_at", sa.DateTime(), nullable=True))

    # Indexes expected by 0001_init.py
    # Alembic autogenerates names like ix_users_username; we keep those stable.
    if not _has_index(bind, "users", "ix_users_username"):
        op.create_index("ix_users_username", "users", ["username"], unique=True)

    if not _has_index(bind, "users", "ix_users_email"):
        op.create_index("ix_users_email", "users", ["email"], unique=True)

    if not _has_index(bind, "users", "ix_users_id"):
        op.create_index("ix_users_id", "users", ["id"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()

    # Drop indexes if present
    if _has_index(bind, "users", "ix_users_id"):
        op.drop_index("ix_users_id", table_name="users")
    if _has_index(bind, "users", "ix_users_email"):
        op.drop_index("ix_users_email", table_name="users")
    if _has_index(bind, "users", "ix_users_username"):
        op.drop_index("ix_users_username", table_name="users")

    # Drop columns if present (reverse order)
    if _has_column(bind, "users", "updated_at"):
        op.drop_column("users", "updated_at")
    if _has_column(bind, "users", "is_active"):
        op.drop_column("users", "is_active")
    if _has_column(bind, "users", "avatar_url"):
        op.drop_column("users", "avatar_url")
    if _has_column(bind, "users", "display_name"):
        op.drop_column("users", "display_name")
    if _has_column(bind, "users", "password_hash"):
        op.drop_column("users", "password_hash")

