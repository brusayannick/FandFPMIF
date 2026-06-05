"""process_logs.active_filter

Revision ID: 0008_event_log_active_filter
Revises: 0007_analytics_source_duration
Create Date: 2026-06-03

Persists the Events-tab filter that the user has *applied* to a log. Unlike the
live editor draft (a query param), this column is the source of truth every
non-editor consumer reads through — Variants / Activities / Data-quality and,
crucially, all installed modules. ``NULL`` / ``[]`` means "no filter, full
dataset". Stored as a JSON array of ``{field, op, value?}`` filter entries.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "0008_event_log_active_filter"
down_revision: str | None = "0007_analytics_source_duration"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "process_logs",
        sa.Column("active_filter", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    with op.batch_alter_table("process_logs") as batch:
        batch.drop_column("active_filter")
