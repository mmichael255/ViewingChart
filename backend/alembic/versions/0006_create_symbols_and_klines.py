"""Create symbols and klines tables for kline persistence.

Revision ID: 0006
Revises: 0005
Create Date: 2026-05-14

The Symbol and Kline ORM models were added to models.py but no Alembic
migration was ever created for them. This migration fills that gap.
"""

from alembic import op
import sqlalchemy as sa


revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create asset_type_enum (used by symbols.asset_type)
    asset_type_enum = sa.Enum("crypto", "stock", name="asset_type_enum")

    op.create_table(
        "symbols",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("symbol", sa.String(length=32), nullable=False),
        sa.Column("base_asset", sa.String(length=16), nullable=False),
        sa.Column("quote_asset", sa.String(length=16), nullable=False),
        sa.Column("asset_type", asset_type_enum, nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=True, default=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("symbol", "asset_type", name="uk_symbol_asset"),
    )
    op.create_index(op.f("ix_symbols_id"), "symbols", ["id"], unique=False)
    op.create_index("idx_asset_source", "symbols", ["asset_type", "source"], unique=False)

    op.create_table(
        "klines",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("symbol_id", sa.Integer(), nullable=False),
        sa.Column("bar_interval", sa.String(length=8), nullable=False),
        sa.Column("open_time", sa.Integer(), nullable=False),
        sa.Column("open_price", sa.Numeric(24, 8), nullable=False),
        sa.Column("high_price", sa.Numeric(24, 8), nullable=False),
        sa.Column("low_price", sa.Numeric(24, 8), nullable=False),
        sa.Column("close_price", sa.Numeric(24, 8), nullable=False),
        sa.Column("base_volume", sa.Numeric(32, 8), nullable=False),
        sa.ForeignKeyConstraint(["symbol_id"], ["symbols.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "symbol_id", "bar_interval", "open_time", name="uk_kline_symbol_bar_time"
        ),
    )
    op.create_index(op.f("ix_klines_id"), "klines", ["id"], unique=False)
    op.create_index(
        "idx_kline_symbol_bar_time",
        "klines",
        ["symbol_id", "bar_interval", "open_time"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("idx_kline_symbol_bar_time", table_name="klines")
    op.drop_index(op.f("ix_klines_id"), table_name="klines")
    op.drop_table("klines")

    op.drop_index("idx_asset_source", table_name="symbols")
    op.drop_index(op.f("ix_symbols_id"), table_name="symbols")
    op.drop_table("symbols")

    # Drop the enum type (MySQL handles this via the table drop, but be explicit)
    sa.Enum(name="asset_type_enum").drop(op.get_bind(), checkfirst=True)