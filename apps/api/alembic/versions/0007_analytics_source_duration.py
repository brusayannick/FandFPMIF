"""analytics_events.source + duration_ms

Revision ID: 0007_analytics_source_duration
Revises: 0006_module_installs
Create Date: 2026-06-02

Distinguishes browser-emitted events (``source='client'``) from backend-emitted
ones (``source='server'`` — business-operation timings and job outcomes) and
adds a ``duration_ms`` column for the timed server events. Existing rows are
backfilled to ``client`` via the server default.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "0007_analytics_source_duration"
down_revision: str | None = "0006_module_installs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "analytics_events",
        sa.Column("source", sa.String(length=16), nullable=False, server_default="client"),
    )
    op.add_column(
        "analytics_events",
        sa.Column("duration_ms", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    # SQLite pre-3.35 can't DROP COLUMN in place; batch mode rebuilds the table.
    with op.batch_alter_table("analytics_events") as batch:
        batch.drop_column("duration_ms")
        batch.drop_column("source")
