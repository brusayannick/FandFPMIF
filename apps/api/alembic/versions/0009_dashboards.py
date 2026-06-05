"""dashboards

Revision ID: 0009_dashboards
Revises: 0008_event_log_active_filter
Create Date: 2026-06-03

Adds the ``dashboards`` table backing the Dashboards feature: a user-built grid
of cards drawn from any installed module, bound to one event log. The placed
cards and their react-grid-layout geometry live together in ``layout_json``.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "0009_dashboards"
down_revision: str | None = "0008_event_log_active_filter"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent: SQLite runs DDL non-transactionally, so a boot that created
    # the table but crashed before stamping this revision leaves the table
    # behind while alembic still reads 0008 — re-running would then collide on
    # "table dashboards already exists". Guard on the live schema so the
    # migration recovers that stuck state and is a no-op on a fresh DB alike.
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if "dashboards" not in set(inspector.get_table_names()):
        op.create_table(
            "dashboards",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("event_log_id", sa.String(length=36), nullable=True),
            sa.Column("layout_json", sa.JSON(), nullable=False),
            sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(
                ["event_log_id"], ["process_logs.id"], ondelete="SET NULL"
            ),
            sa.PrimaryKeyConstraint("id"),
        )

    # Re-inspect: the table exists now (either pre-existing or just created).
    existing_indexes = {
        ix["name"] for ix in sa.inspect(bind).get_indexes("dashboards")
    }
    if "ix_dashboards_user_created_at" not in existing_indexes:
        op.create_index(
            "ix_dashboards_user_created_at", "dashboards", ["user_id", "created_at"]
        )


def downgrade() -> None:
    op.drop_index("ix_dashboards_user_created_at", table_name="dashboards")
    op.drop_table("dashboards")
