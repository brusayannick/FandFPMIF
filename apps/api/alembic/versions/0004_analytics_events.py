"""analytics_sessions + analytics_events

Revision ID: 0004_analytics_events
Revises: 0003_folders
Create Date: 2026-05-24

Adds two tables for opt-in user behaviour tracking. Capture is off by default
and gated server-side on ``user_settings['analytics.config'].enabled``.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "0004_analytics_events"
down_revision: str | None = "0003_folders"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "analytics_sessions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("anon_user_id", sa.String(length=36), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(), nullable=False),
        sa.Column("entry_path", sa.String(length=512), nullable=True),
        sa.Column("event_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index(
        "ix_analytics_sessions_anon_user_id",
        "analytics_sessions",
        ["anon_user_id"],
    )
    op.create_index(
        "ix_analytics_sessions_last_seen_at",
        "analytics_sessions",
        ["last_seen_at"],
    )

    op.create_table(
        "analytics_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("anon_user_id", sa.String(length=36), nullable=False),
        sa.Column("event_type", sa.String(length=32), nullable=False),
        sa.Column("event_name", sa.String(length=128), nullable=False),
        sa.Column("path", sa.String(length=512), nullable=True),
        sa.Column("referrer", sa.String(length=512), nullable=True),
        sa.Column("properties", sa.JSON(), nullable=True),
        sa.Column("viewport_w", sa.Integer(), nullable=True),
        sa.Column("viewport_h", sa.Integer(), nullable=True),
        sa.Column("ua_class", sa.String(length=32), nullable=True),
        sa.Column("locale", sa.String(length=16), nullable=True),
        sa.Column("tz", sa.String(length=64), nullable=True),
        sa.Column("occurred_at", sa.DateTime(), nullable=False),
        sa.Column("server_received_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_analytics_events_session",
        "analytics_events",
        ["session_id", "occurred_at"],
    )
    op.create_index(
        "ix_analytics_events_type_name",
        "analytics_events",
        ["event_type", "event_name"],
    )
    op.create_index(
        "ix_analytics_events_occurred",
        "analytics_events",
        ["occurred_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_analytics_events_occurred", table_name="analytics_events")
    op.drop_index("ix_analytics_events_type_name", table_name="analytics_events")
    op.drop_index("ix_analytics_events_session", table_name="analytics_events")
    op.drop_table("analytics_events")

    op.drop_index(
        "ix_analytics_sessions_last_seen_at", table_name="analytics_sessions"
    )
    op.drop_index(
        "ix_analytics_sessions_anon_user_id", table_name="analytics_sessions"
    )
    op.drop_table("analytics_sessions")
