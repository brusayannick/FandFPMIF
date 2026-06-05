"""event log column roles + mapping review flag

Revision ID: 0010_event_log_column_roles
Revises: 0009_dashboards
Create Date: 2026-06-03

Adds ``column_roles`` (resolved role → source-column mapping) and
``mapping_needs_review`` (the importer had to guess a mandatory column) to
``process_logs`` so the smart column-mapping + manual-override flow can record
and surface its result.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "0010_event_log_column_roles"
down_revision: str | None = "0009_dashboards"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent: the dev DB is bind-mounted and may already carry these columns
    # from a partially-applied run (see 0009's note). Guard on the live schema.
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = {c["name"] for c in inspector.get_columns("process_logs")}

    if "column_roles" not in existing:
        op.add_column("process_logs", sa.Column("column_roles", sa.JSON(), nullable=True))
    if "mapping_needs_review" not in existing:
        op.add_column(
            "process_logs",
            sa.Column(
                "mapping_needs_review",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
        )


def downgrade() -> None:
    op.drop_column("process_logs", "mapping_needs_review")
    op.drop_column("process_logs", "column_roles")
