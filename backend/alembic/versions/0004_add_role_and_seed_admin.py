"""Add users.role and seed superadmin from env.

Revision ID: 0004
Revises: 0003
Create Date: 2026-05-07

This migration is intentionally defensive and idempotent:
- Adds `users.role` if missing
- Ensures all users have a role (defaults to "user")
- Ensures a superadmin account exists/updated using ADMIN_* env vars

The migration stores only a bcrypt hash in DB; ADMIN_PASSWORD is expected
to be provided as plaintext via environment variables at migration time.
"""

from __future__ import annotations

import os
from datetime import datetime

from alembic import op
import sqlalchemy as sa
from passlib.context import CryptContext


revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def _has_column(bind, table: str, column: str) -> bool:
    insp = sa.inspect(bind)
    return any(col["name"] == column for col in insp.get_columns(table))


def _require_env(name: str) -> str:
    v = os.getenv(name, "").strip()
    if not v:
        raise RuntimeError(
            f"Missing required env var {name}. "
            "Set ADMIN_USERNAME and ADMIN_PASSWORD when running Alembic migrations."
        )
    return v


def upgrade() -> None:
    bind = op.get_bind()

    # 1) Schema: users.role
    if not _has_column(bind, "users", "role"):
        op.add_column(
            "users",
            sa.Column("role", sa.String(length=32), nullable=False, server_default="user"),
        )

    # Ensure existing rows have a role (defensive for older DBs / odd defaults)
    op.execute(sa.text("UPDATE users SET role='user' WHERE role IS NULL OR role=''"))

    # 2) Seed/ensure superadmin
    admin_username = _require_env("ADMIN_USERNAME")
    admin_password = _require_env("ADMIN_PASSWORD")
    admin_email = os.getenv("ADMIN_EMAIL")
    admin_email = admin_email.strip().lower() if admin_email else None

    # Hash password now (bcrypt)
    if len(admin_password.encode("utf-8")) > 72:
        raise RuntimeError("ADMIN_PASSWORD is too long (bcrypt max is 72 bytes).")
    password_hash = _pwd_context.hash(admin_password)

    now = datetime.utcnow()

    # Try to find by username first; fall back to email if provided.
    row = bind.execute(
        sa.text("SELECT id FROM users WHERE username = :u LIMIT 1"),
        {"u": admin_username},
    ).fetchone()
    if row is None and admin_email:
        row = bind.execute(
            sa.text("SELECT id FROM users WHERE email = :e LIMIT 1"),
            {"e": admin_email},
        ).fetchone()

    if row is None:
        bind.execute(
            sa.text(
                """
                INSERT INTO users (username, email, password_hash, role, is_active, created_at, updated_at)
                VALUES (:u, :e, :ph, 'superadmin', 1, :ca, :ua)
                """
            ),
            {"u": admin_username, "e": admin_email, "ph": password_hash, "ca": now, "ua": now},
        )
    else:
        user_id = int(row[0])
        bind.execute(
            sa.text(
                """
                UPDATE users
                SET
                  username = :u,
                  email = COALESCE(:e, email),
                  password_hash = :ph,
                  role = 'superadmin',
                  is_active = 1,
                  updated_at = :ua
                WHERE id = :id
                """
            ),
            {"id": user_id, "u": admin_username, "e": admin_email, "ph": password_hash, "ua": now},
        )


def downgrade() -> None:
    bind = op.get_bind()
    if _has_column(bind, "users", "role"):
        op.drop_column("users", "role")

