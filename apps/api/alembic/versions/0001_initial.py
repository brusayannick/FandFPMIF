"""initial schema — process_logs, jobs, module_configs, module_layouts, user_settings

Revision ID: 0001_initial
Revises:
Create Date: 2026-04-29

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "0001_initial"
down_revision: str | None = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "process_logs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("source_format", sa.String(length=32)),
        sa.Column("source_filename", sa.String(length=512)),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="importing"),
        sa.Column("error", sa.Text()),
        sa.Column("events_count", sa.Integer()),
        sa.Column("cases_count", sa.Integer()),
        sa.Column("variants_count", sa.Integer()),
        sa.Column("date_min", sa.DateTime()),
        sa.Column("date_max", sa.DateTime()),
        sa.Column("detected_schema", sa.JSON()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("imported_at", sa.DateTime()),
        sa.Column("deleted_at", sa.DateTime()),
    )
    op.create_index("ix_process_logs_status", "process_logs", ["status"])
    op.create_index("ix_process_logs_created_at", "process_logs", ["created_at"])

    op.create_table(
        "jobs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("type", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("subtitle", sa.String(length=255)),
        sa.Column("module_id", sa.String(length=64)),
        sa.Column("payload_json", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="queued"),
        sa.Column("progress_current", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("progress_total", sa.Integer()),
        sa.Column("stage", sa.String(length=64)),
        sa.Column("message", sa.Text()),
        sa.Column("error", sa.Text()),
        sa.Column("rate", sa.Float()),
        sa.Column("eta_seconds", sa.Float()),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "parent_job_id",
            sa.String(length=36),
            sa.ForeignKey("jobs.id", ondelete="SET NULL"),
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("started_at", sa.DateTime()),
        sa.Column("finished_at", sa.DateTime()),
    )
    op.create_index("ix_jobs_status", "jobs", ["status"])
    op.create_index("ix_jobs_type", "jobs", ["type"])
    op.create_index("ix_jobs_module_id", "jobs", ["module_id"])
    op.create_index("ix_jobs_created_at", "jobs", ["created_at"])

    op.create_table(
        "module_configs",
        sa.Column("module_id", sa.String(length=64), primary_key=True),
        sa.Column("config_json", sa.JSON(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "module_layouts",
        sa.Column("user_id", sa.String(length=64), primary_key=True),
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
        sa.Column("key", sa.String(length=128), primary_key=True),
        sa.Column("value_json", sa.JSON()),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("user_settings")
    op.drop_table("module_layouts")
    op.drop_table("module_configs")
    op.drop_index("ix_jobs_created_at", table_name="jobs")
    op.drop_index("ix_jobs_module_id", table_name="jobs")
    op.drop_index("ix_jobs_type", table_name="jobs")
    op.drop_index("ix_jobs_status", table_name="jobs")
    op.drop_table("jobs")
    op.drop_index("ix_process_logs_created_at", table_name="process_logs")
    op.drop_index("ix_process_logs_status", table_name="process_logs")
    op.drop_table("process_logs")
