"""event log metadata fields + event_edits audit table

Revision ID: 0002_event_log_metadata_and_edits
Revises: 0001_initial
Create Date: 2026-05-03

Adds the columns the Settings tab needs (description, per-column display
overrides, last-edited stamp) and the audit table behind Settings → Edit
history. SQLite is migrated with batch operations.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "0002_event_log_metadata_and_edits"
down_revision: str | None = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("process_logs") as batch:
        batch.add_column(sa.Column("description", sa.Text()))
        batch.add_column(sa.Column("column_overrides", sa.JSON()))
        batch.add_column(sa.Column("last_edited_at", sa.DateTime()))

    op.create_table(
        "event_edits",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "log_id",
            sa.String(length=36),
            sa.ForeignKey("process_logs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("row_index", sa.Integer(), nullable=False),
        sa.Column("field", sa.String(length=128), nullable=False),
        sa.Column("old_value_json", sa.JSON()),
        sa.Column("new_value_json", sa.JSON()),
        sa.Column("edited_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_event_edits_log_id_edited_at",
        "event_edits",
        ["log_id", "edited_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_event_edits_log_id_edited_at", table_name="event_edits")
    op.drop_table("event_edits")
    with op.batch_alter_table("process_logs") as batch:
        batch.drop_column("last_edited_at")
        batch.drop_column("column_overrides")
        batch.drop_column("description")
