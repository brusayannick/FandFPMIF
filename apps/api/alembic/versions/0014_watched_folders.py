"""watched folders — persistent auto-scanning import source

Revision ID: 0014_watched_folders
Revises: 0013_storage_config
Create Date: 2026-06-17

Adds ``watched_folders`` (per-user scanned import source) and the
``watched_folder_files`` dedup ledger. See ``mate.api.ingest.watch`` and
``/api/v1/watched-folders``.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "0014_watched_folders"
down_revision: str | None = "0013_storage_config"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent: the dev DB is bind-mounted and may already carry the tables
    # from a partially-applied run.
    bind = op.get_bind()
    existing = set(sa.inspect(bind).get_table_names())

    if "watched_folders" not in existing:
        op.create_table(
            "watched_folders",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("dest_folder_id", sa.String(length=36), nullable=True),
            sa.Column("source_path", sa.String(length=1024), nullable=False, server_default=""),
            sa.Column("mode", sa.String(length=16), nullable=False, server_default="manual"),
            sa.Column("interval_seconds", sa.Integer(), nullable=True),
            sa.Column("status", sa.String(length=16), nullable=False, server_default="active"),
            sa.Column("last_scanned_at", sa.DateTime(), nullable=True),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.Column("default_mapping", sa.JSON(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("deleted_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(
                ["dest_folder_id"], ["process_folders.id"], ondelete="SET NULL"
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            "ix_watched_folders_user_status", "watched_folders", ["user_id", "status"]
        )

    if "watched_folder_files" not in existing:
        op.create_table(
            "watched_folder_files",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("watch_id", sa.String(length=36), nullable=False),
            sa.Column("source_name", sa.String(length=1024), nullable=False),
            sa.Column("size", sa.Integer(), nullable=True),
            sa.Column("etag", sa.String(length=255), nullable=True),
            sa.Column("mtime", sa.Float(), nullable=True),
            sa.Column("log_id", sa.String(length=36), nullable=True),
            sa.Column("status", sa.String(length=16), nullable=False, server_default="imported"),
            sa.Column("error", sa.Text(), nullable=True),
            sa.Column("imported_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["watch_id"], ["watched_folders.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["log_id"], ["process_logs.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            "ix_watched_folder_files_watch_name",
            "watched_folder_files",
            ["watch_id", "source_name"],
            unique=True,
        )


def downgrade() -> None:
    op.drop_index("ix_watched_folder_files_watch_name", table_name="watched_folder_files")
    op.drop_table("watched_folder_files")
    op.drop_index("ix_watched_folders_user_status", table_name="watched_folders")
    op.drop_table("watched_folders")
