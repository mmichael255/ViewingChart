"""init schema

Revision ID: 0001
Revises: 
Create Date: 2026-05-06

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(length=50), nullable=False),
        sa.Column("email", sa.String(length=100), nullable=True),
        sa.Column("password_hash", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("display_name", sa.String(length=100), nullable=True),
        sa.Column("avatar_url", sa.String(length=500), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_users_id"), "users", ["id"], unique=False)
    op.create_index(op.f("ix_users_username"), "users", ["username"], unique=True)
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=True)

    op.create_table(
        "watchlists",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("name", sa.String(length=50), nullable=True),
        sa.Column("is_default", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "name", name="uk_watchlist_user_name"),
    )
    op.create_index(op.f("ix_watchlists_id"), "watchlists", ["id"], unique=False)
    op.create_index("idx_watchlists_user_default", "watchlists", ["user_id", "is_default"], unique=False)

    op.create_table(
        "watchlist_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("watchlist_id", sa.Integer(), nullable=True),
        sa.Column("symbol", sa.String(length=20), nullable=False),
        sa.Column(
            "asset_type",
            sa.Enum("crypto", "stock", name="watchlist_asset_type_enum"),
            nullable=False,
            server_default="crypto",
        ),
        sa.Column("exchange", sa.String(length=20), nullable=True),
        sa.Column("source", sa.String(length=32), nullable=True),
        sa.Column("label", sa.String(length=64), nullable=True),
        sa.Column("sub", sa.String(length=128), nullable=True),
        sa.Column("added_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["watchlist_id"], ["watchlists.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("watchlist_id", "symbol", "asset_type", name="uk_watchlist_item"),
    )
    op.create_index(op.f("ix_watchlist_items_id"), "watchlist_items", ["id"], unique=False)
    op.create_index("idx_watchlist_items_watchlist", "watchlist_items", ["watchlist_id"], unique=False)


def downgrade() -> None:
    op.drop_index("idx_watchlist_items_watchlist", table_name="watchlist_items")
    op.drop_index(op.f("ix_watchlist_items_id"), table_name="watchlist_items")
    op.drop_table("watchlist_items")

    op.drop_index("idx_watchlists_user_default", table_name="watchlists")
    op.drop_index(op.f("ix_watchlists_id"), table_name="watchlists")
    op.drop_table("watchlists")

    op.drop_index(op.f("ix_users_email"), table_name="users")
    op.drop_index(op.f("ix_users_username"), table_name="users")
    op.drop_index(op.f("ix_users_id"), table_name="users")
    op.drop_table("users")

