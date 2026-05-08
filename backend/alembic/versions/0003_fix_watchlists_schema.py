"""Fix watchlists/watchlist_items schema for existing dev DB.

Revision ID: 0003
Revises: 0002
Create Date: 2026-05-07
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def _has_column(bind, table: str, column: str) -> bool:
    insp = sa.inspect(bind)
    return any(col["name"] == column for col in insp.get_columns(table))


def _has_index(bind, table: str, index_name: str) -> bool:
    insp = sa.inspect(bind)
    return any(ix["name"] == index_name for ix in insp.get_indexes(table))


def _has_unique_constraint(bind, table: str, name: str) -> bool:
    insp = sa.inspect(bind)
    return any(c.get("name") == name for c in insp.get_unique_constraints(table))


def upgrade() -> None:
    bind = op.get_bind()

    # watchlists columns
    if not _has_column(bind, "watchlists", "is_default"):
        op.add_column(
            "watchlists",
            sa.Column("is_default", sa.Boolean(), nullable=True, server_default=sa.text("0")),
        )
    if not _has_column(bind, "watchlists", "created_at"):
        op.add_column("watchlists", sa.Column("created_at", sa.DateTime(), nullable=True))
    if not _has_column(bind, "watchlists", "updated_at"):
        op.add_column("watchlists", sa.Column("updated_at", sa.DateTime(), nullable=True))

    # watchlists constraints/indexes
    if not _has_unique_constraint(bind, "watchlists", "uk_watchlist_user_name"):
        op.create_unique_constraint("uk_watchlist_user_name", "watchlists", ["user_id", "name"])

    if not _has_index(bind, "watchlists", "idx_watchlists_user_default"):
        op.create_index("idx_watchlists_user_default", "watchlists", ["user_id", "is_default"], unique=False)
    if not _has_index(bind, "watchlists", "ix_watchlists_id"):
        op.create_index("ix_watchlists_id", "watchlists", ["id"], unique=False)

    # watchlist_items columns
    if not _has_column(bind, "watchlist_items", "asset_type"):
        op.add_column(
            "watchlist_items",
            sa.Column(
                "asset_type",
                sa.Enum("crypto", "stock", name="watchlist_asset_type_enum"),
                nullable=False,
                server_default="crypto",
            ),
        )
    if not _has_column(bind, "watchlist_items", "source"):
        op.add_column("watchlist_items", sa.Column("source", sa.String(length=32), nullable=True))
    if not _has_column(bind, "watchlist_items", "label"):
        op.add_column("watchlist_items", sa.Column("label", sa.String(length=64), nullable=True))
    if not _has_column(bind, "watchlist_items", "sub"):
        op.add_column("watchlist_items", sa.Column("sub", sa.String(length=128), nullable=True))

    # watchlist_items constraints/indexes
    if not _has_unique_constraint(bind, "watchlist_items", "uk_watchlist_item"):
        op.create_unique_constraint("uk_watchlist_item", "watchlist_items", ["watchlist_id", "symbol", "asset_type"])

    if not _has_index(bind, "watchlist_items", "idx_watchlist_items_watchlist"):
        op.create_index("idx_watchlist_items_watchlist", "watchlist_items", ["watchlist_id"], unique=False)
    if not _has_index(bind, "watchlist_items", "ix_watchlist_items_id"):
        op.create_index("ix_watchlist_items_id", "watchlist_items", ["id"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()

    # watchlist_items
    if _has_index(bind, "watchlist_items", "ix_watchlist_items_id"):
        op.drop_index("ix_watchlist_items_id", table_name="watchlist_items")
    if _has_index(bind, "watchlist_items", "idx_watchlist_items_watchlist"):
        op.drop_index("idx_watchlist_items_watchlist", table_name="watchlist_items")
    if _has_unique_constraint(bind, "watchlist_items", "uk_watchlist_item"):
        op.drop_constraint("uk_watchlist_item", "watchlist_items", type_="unique")

    for col in ["sub", "label", "source", "asset_type"]:
        if _has_column(bind, "watchlist_items", col):
            op.drop_column("watchlist_items", col)

    # watchlists
    if _has_index(bind, "watchlists", "ix_watchlists_id"):
        op.drop_index("ix_watchlists_id", table_name="watchlists")
    if _has_index(bind, "watchlists", "idx_watchlists_user_default"):
        op.drop_index("idx_watchlists_user_default", table_name="watchlists")
    if _has_unique_constraint(bind, "watchlists", "uk_watchlist_user_name"):
        op.drop_constraint("uk_watchlist_user_name", "watchlists", type_="unique")

    for col in ["updated_at", "created_at", "is_default"]:
        if _has_column(bind, "watchlists", col):
            op.drop_column("watchlists", col)

