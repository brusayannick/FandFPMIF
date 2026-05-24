"""folders + folder_id/position on event logs

Revision ID: 0003_folders
Revises: 0002_event_log_metadata_and_edits
Create Date: 2026-05-20

Adds a hierarchical Folder table for organising event logs on /processes,
plus `folder_id` and `position` columns on `process_logs` so logs can be
placed inside folders and ordered within a parent.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "0003_folders"
down_revision: str | None = "0002_event_log_metadata_and_edits"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "process_folders",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column(
            "parent_id",
            sa.String(length=36),
            sa.ForeignKey("process_folders.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
    )
    op.create_index(
        "ix_process_folders_parent_id",
        "process_folders",
        ["parent_id"],
    )

    with op.batch_alter_table("process_logs") as batch:
        batch.add_column(
            sa.Column(
                "folder_id",
                sa.String(length=36),
                # SQLite batch mode requires named constraints; the FK name
                # appears in pragma listings.
                sa.ForeignKey(
                    "process_folders.id",
                    ondelete="SET NULL",
                    name="fk_process_logs_folder_id",
                ),
                nullable=True,
            )
        )
        batch.add_column(
            sa.Column("position", sa.Integer(), nullable=False, server_default="0")
        )
    op.create_index("ix_process_logs_folder_id", "process_logs", ["folder_id"])


def downgrade() -> None:
    op.drop_index("ix_process_logs_folder_id", table_name="process_logs")
    with op.batch_alter_table("process_logs") as batch:
        batch.drop_column("position")
        batch.drop_column("folder_id")

    op.drop_index("ix_process_folders_parent_id", table_name="process_folders")
    op.drop_table("process_folders")
