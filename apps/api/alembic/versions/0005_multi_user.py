"""multi-user (users table + user_id on every per-user table)

Revision ID: 0005_multi_user
Revises: 0004_analytics_events
Create Date: 2026-05-30

Drops all data-bearing tables and recreates them with a ``user_id`` foreign
key to a new ``users`` table. This is a fresh-start migration — existing rows
are discarded by design (see plan: "Fresh start (drop existing data)").

On-disk paths under ``data/event_logs/`` and ``data/module_results/`` are
relocated by the API lifespan hook on first boot, not by this revision.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "0005_multi_user"
down_revision: str | None = "0004_analytics_events"
branch_labels = None
depends_on = None


# Tables created by earlier revisions that need a fresh shape.
_LEGACY_TABLES = (
    "analytics_events",
    "analytics_sessions",
    "event_edits",
    "module_layouts",
    "module_configs",
    "user_settings",
    "jobs",
    "process_logs",
    "process_folders",
)


def upgrade() -> None:
    # Drop legacy tables in FK-safe order. SQLite tolerates dropping a child
    # before the parent because we have foreign_keys=ON set per-connection.
    for table in _LEGACY_TABLES:
        op.execute(f"DROP TABLE IF EXISTS {table}")

    op.create_table(
        "users",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("email", sa.String(length=320), nullable=True),
        sa.Column("preferred_username", sa.String(length=255), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "process_folders",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(length=36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
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
        "ix_process_folders_user_parent",
        "process_folders",
        ["user_id", "parent_id"],
    )

    op.create_table(
        "process_logs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(length=36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("source_format", sa.String(length=32), nullable=True),
        sa.Column("source_filename", sa.String(length=512), nullable=True),
        sa.Column(
            "status",
            sa.String(length=16),
            nullable=False,
            server_default="importing",
        ),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("events_count", sa.Integer(), nullable=True),
        sa.Column("cases_count", sa.Integer(), nullable=True),
        sa.Column("variants_count", sa.Integer(), nullable=True),
        sa.Column("date_min", sa.DateTime(), nullable=True),
        sa.Column("date_max", sa.DateTime(), nullable=True),
        sa.Column("detected_schema", sa.JSON(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("column_overrides", sa.JSON(), nullable=True),
        sa.Column(
            "folder_id",
            sa.String(length=36),
            sa.ForeignKey("process_folders.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("imported_at", sa.DateTime(), nullable=True),
        sa.Column("last_edited_at", sa.DateTime(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
    )
    op.create_index(
        "ix_process_logs_user_status", "process_logs", ["user_id", "status"]
    )
    op.create_index(
        "ix_process_logs_user_created_at", "process_logs", ["user_id", "created_at"]
    )
    op.create_index(
        "ix_process_logs_user_folder_id", "process_logs", ["user_id", "folder_id"]
    )

    op.create_table(
        "jobs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(length=36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("type", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("subtitle", sa.String(length=255), nullable=True),
        sa.Column("module_id", sa.String(length=64), nullable=True),
        sa.Column("payload_json", sa.JSON(), nullable=False),
        sa.Column(
            "status", sa.String(length=16), nullable=False, server_default="queued"
        ),
        sa.Column(
            "progress_current", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column("progress_total", sa.Integer(), nullable=True),
        sa.Column("stage", sa.String(length=64), nullable=True),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("rate", sa.Float(), nullable=True),
        sa.Column("eta_seconds", sa.Float(), nullable=True),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "parent_job_id",
            sa.String(length=36),
            sa.ForeignKey("jobs.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_jobs_user_status", "jobs", ["user_id", "status"])
    op.create_index("ix_jobs_user_type", "jobs", ["user_id", "type"])
    op.create_index("ix_jobs_user_module", "jobs", ["user_id", "module_id"])
    op.create_index("ix_jobs_user_created_at", "jobs", ["user_id", "created_at"])

    op.create_table(
        "module_configs",
        sa.Column(
            "user_id",
            sa.String(length=36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("module_id", sa.String(length=64), primary_key=True),
        sa.Column("config_json", sa.JSON(), nullable=False),
        sa.Column(
            "enabled", sa.Boolean(), nullable=False, server_default=sa.true()
        ),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "module_layouts",
        sa.Column(
            "user_id",
            sa.String(length=36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "log_id",
            sa.String(length=36),
            sa.ForeignKey("process_logs.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("module_id", sa.String(length=64), primary_key=True),
        sa.Column("layout_json", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "user_settings",
        sa.Column(
            "user_id",
            sa.String(length=36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("key", sa.String(length=128), primary_key=True),
        sa.Column("value_json", sa.JSON(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "event_edits",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            sa.String(length=36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "log_id",
            sa.String(length=36),
            sa.ForeignKey("process_logs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("row_index", sa.Integer(), nullable=False),
        sa.Column("field", sa.String(length=128), nullable=False),
        sa.Column("old_value_json", sa.JSON(), nullable=True),
        sa.Column("new_value_json", sa.JSON(), nullable=True),
        sa.Column("edited_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_event_edits_user_log_edited_at",
        "event_edits",
        ["user_id", "log_id", "edited_at"],
    )

    op.create_table(
        "analytics_sessions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(length=36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("anon_user_id", sa.String(length=36), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(), nullable=False),
        sa.Column("entry_path", sa.String(length=512), nullable=True),
        sa.Column("event_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index(
        "ix_analytics_sessions_user_anon",
        "analytics_sessions",
        ["user_id", "anon_user_id"],
    )
    op.create_index(
        "ix_analytics_sessions_user_last_seen",
        "analytics_sessions",
        ["user_id", "last_seen_at"],
    )

    op.create_table(
        "analytics_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            sa.String(length=36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
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
        "ix_analytics_events_user_session",
        "analytics_events",
        ["user_id", "session_id", "occurred_at"],
    )
    op.create_index(
        "ix_analytics_events_user_type_name",
        "analytics_events",
        ["user_id", "event_type", "event_name"],
    )
    op.create_index(
        "ix_analytics_events_user_occurred",
        "analytics_events",
        ["user_id", "occurred_at"],
    )


def downgrade() -> None:
    # No going back — the multi-user shape is the new shape. Downgrade re-runs
    # the four prior revisions from scratch via Alembic's chain.
    for table in (
        "analytics_events",
        "analytics_sessions",
        "event_edits",
        "user_settings",
        "module_layouts",
        "module_configs",
        "jobs",
        "process_logs",
        "process_folders",
        "users",
    ):
        op.execute(f"DROP TABLE IF EXISTS {table}")
