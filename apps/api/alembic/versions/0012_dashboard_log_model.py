"""dashboard log model (case-centric vs object-centric)

Revision ID: 0012_dashboard_log_model
Revises: 0011_event_log_object_centric
Create Date: 2026-06-06

Adds ``log_model`` to ``dashboards`` — the board's data model, fixed at
creation. Mirrors ``process_logs.log_model``; existing rows backfill to
``case_centric`` via the server default.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "0012_dashboard_log_model"
down_revision: str | None = "0011_event_log_object_centric"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent: the dev DB is bind-mounted and may already carry the column
    # from a partially-applied run. Guard on the live schema.
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = {c["name"] for c in inspector.get_columns("dashboards")}

    if "log_model" not in existing:
        op.add_column(
            "dashboards",
            sa.Column(
                "log_model",
                sa.String(length=16),
                nullable=False,
                server_default="case_centric",
            ),
        )


def downgrade() -> None:
    op.drop_column("dashboards", "log_model")
