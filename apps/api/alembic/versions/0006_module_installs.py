"""per-user module install ownership (module_installs)

Revision ID: 0006_module_installs
Revises: 0005_multi_user
Create Date: 2026-06-01

Reference-counts which user installed which module so module listing,
availability, upload, and deletion are per-user. Module code still lives once
on shared disk; this table only tracks ownership (see ``db/models.ModuleInstall``).
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "0006_module_installs"
down_revision: str | None = "0005_multi_user"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "module_installs",
        sa.Column(
            "user_id",
            sa.String(length=36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("module_id", sa.String(length=64), primary_key=True),
        sa.Column("source", sa.String(length=16), nullable=True),
        sa.Column("installed_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_module_installs_module_id", "module_installs", ["module_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_module_installs_module_id", table_name="module_installs")
    op.drop_table("module_installs")
