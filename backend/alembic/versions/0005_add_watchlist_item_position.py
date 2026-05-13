"""Add watchlist_items.position for stable ordering.

Revision ID: 0005
Revises: 0004
Create Date: 2026-05-08

This migration is defensive and idempotent:
- Adds watchlist_items.position if missing
- Backfills per-watchlist positions ordered by (id asc)
- Adds index (watchlist_id, position) if missing
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0005"
down_revision = "0004"
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

    if not _has_column(bind, "watchlist_items", "position"):
        op.add_column(
            "watchlist_items",
            sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        )

    # Backfill: stable order by (watchlist_id asc, id asc) using MySQL user variables.
    # This is much faster than row-by-row Python updates for large tables.
    bind.execute(
        sa.text(
            """
            UPDATE watchlist_items wi
            JOIN (
              SELECT
                t.id,
                @pos := IF(@wl = t.watchlist_id, @pos + 1, 0) AS new_pos,
                @wl := t.watchlist_id AS _wl
              FROM (
                SELECT id, watchlist_id
                FROM watchlist_items
                ORDER BY watchlist_id ASC, id ASC
              ) t
              JOIN (SELECT @wl := NULL, @pos := -1) vars
            ) x ON x.id = wi.id
            SET wi.position = x.new_pos
            """
        )
    )

    if not _has_index(bind, "watchlist_items", "idx_watchlist_items_watchlist_position"):
        op.create_index(
            "idx_watchlist_items_watchlist_position",
            "watchlist_items",
            ["watchlist_id", "position"],
            unique=False,
        )


def downgrade() -> None:
    bind = op.get_bind()
    if _has_index(bind, "watchlist_items", "idx_watchlist_items_watchlist_position"):
        op.drop_index("idx_watchlist_items_watchlist_position", table_name="watchlist_items")
    if _has_column(bind, "watchlist_items", "position"):
        op.drop_column("watchlist_items", "position")

