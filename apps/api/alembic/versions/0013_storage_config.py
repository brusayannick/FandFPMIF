"""global storage backend configuration

Revision ID: 0013_storage_config
Revises: 0012_dashboard_log_model
Create Date: 2026-06-17

Adds the singleton ``storage_config`` table — VM-wide selection of where event
logs and module outputs are durably stored (local disk vs a connected S3/Ceph
bucket). See ``mate.api.storage`` and ``/api/v1/admin/storage``. The single row
is created lazily by the app, so this migration only creates the table.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "0013_storage_config"
down_revision: str | None = "0012_dashboard_log_model"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent: the dev DB is bind-mounted and may already carry the table
    # from a partially-applied run.
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "storage_config" in set(inspector.get_table_names()):
        return

    op.create_table(
        "storage_config",
        sa.Column("id", sa.String(length=16), nullable=False),
        sa.Column("mode", sa.String(length=8), nullable=False, server_default="local"),
        sa.Column("endpoint_url", sa.String(length=512), nullable=True),
        sa.Column("bucket", sa.String(length=255), nullable=True),
        sa.Column("region", sa.String(length=64), nullable=True),
        sa.Column("access_key", sa.String(length=255), nullable=True),
        sa.Column("secret_key_enc", sa.Text(), nullable=True),
        sa.Column("path_style", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("use_ssl", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("prefix", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("quota_bytes", sa.Integer(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("storage_config")
