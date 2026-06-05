"""event log object-centric (OCEL) support

Revision ID: 0011_event_log_object_centric
Revises: 0010_event_log_column_roles
Create Date: 2026-06-05

Adds ``log_model`` (the single case-centric vs object-centric isolation switch)
and the object-centric counts (``objects_count`` / ``object_types_count`` /
``relations_count``) to ``process_logs``. Existing rows backfill to
``case_centric`` via the server default.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "0011_event_log_object_centric"
down_revision: str | None = "0010_event_log_column_roles"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent: the dev DB is bind-mounted and may already carry these columns
    # from a partially-applied run (see 0010's note). Guard on the live schema.
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = {c["name"] for c in inspector.get_columns("process_logs")}

    if "log_model" not in existing:
        op.add_column(
            "process_logs",
            sa.Column(
                "log_model",
                sa.String(length=16),
                nullable=False,
                server_default="case_centric",
            ),
        )
    for col in ("objects_count", "object_types_count", "relations_count"):
        if col not in existing:
            op.add_column("process_logs", sa.Column(col, sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("process_logs", "relations_count")
    op.drop_column("process_logs", "object_types_count")
    op.drop_column("process_logs", "objects_count")
    op.drop_column("process_logs", "log_model")
