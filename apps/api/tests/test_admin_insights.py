"""Admin insights — cross-user dashboards gated by the ``admin`` realm role.

The default test user (``conftest._override_current_user_for_tests``) holds only
the ``user`` role, so it exercises the 403 path; ``admin_client`` re-overrides
``get_current_user`` with an admin to exercise the 200 path.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime

import pytest
from httpx import ASGITransport, AsyncClient

from .conftest import TEST_USER_EMAIL, TEST_USER_ID


@pytest.fixture
async def admin_client() -> AsyncIterator[AsyncClient]:
    """Like the shared ``client`` fixture but the current user is an admin."""
    from mate.api.auth.dependencies import CurrentUser, get_current_user
    from mate.api.main import create_app

    app = create_app()
    admin = CurrentUser(
        id=TEST_USER_ID,
        email=TEST_USER_EMAIL,
        preferred_username="test",
        name="Test User",
        roles=("user", "admin"),
    )

    async def _admin_user() -> CurrentUser:
        return admin

    app.dependency_overrides[get_current_user] = _admin_user
    transport = ASGITransport(app=app)
    async with (
        AsyncClient(transport=transport, base_url="http://testserver") as c,
        app.router.lifespan_context(app),
    ):
        yield c


@pytest.mark.asyncio
async def test_insights_require_admin(client: AsyncClient) -> None:
    # A plain ``user`` is forbidden from both cross-user endpoints.
    assert (await client.get("/api/v1/admin/insights/overview")).status_code == 403
    assert (await client.get("/api/v1/admin/insights/event-logs")).status_code == 403


@pytest.mark.asyncio
async def test_overview_shape(admin_client: AsyncClient) -> None:
    resp = await admin_client.get("/api/v1/admin/insights/overview?days=30")
    assert resp.status_code == 200
    body = resp.json()

    assert body["days"] == 30
    # The seeded test user is always present.
    assert body["kpis"]["user_count"] >= 1
    # Every series is a list, present even when empty.
    for key in (
        "signups_by_day",
        "logs_by_day",
        "logs_by_status",
        "logs_by_format",
        "logs_by_model",
        "top_users",
        "jobs_by_status",
        "job_failures_by_day",
        "sessions_by_day",
        "top_event_types",
    ):
        assert isinstance(body[key], list), key


@pytest.mark.asyncio
async def test_event_logs_lists_with_owner(admin_client: AsyncClient) -> None:
    from sqlalchemy import delete

    from mate.api.db.engine import get_sessionmaker
    from mate.api.db.models import EventLog

    log_id = str(uuid.uuid4())
    marker = f"admin-insights-{log_id[:8]}"
    sm = get_sessionmaker()
    async with sm() as session:
        session.add(
            EventLog(
                id=log_id,
                user_id=TEST_USER_ID,
                name=marker,
                status="ready",
                source_format="csv",
                events_count=42,
                cases_count=7,
                created_at=datetime.now(UTC).replace(tzinfo=None),
            )
        )
        await session.commit()

    try:
        # Search matches the log name and the row carries the owning user.
        resp = await admin_client.get(f"/api/v1/admin/insights/event-logs?q={marker}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 1
        row = body["items"][0]
        assert row["id"] == log_id
        assert row["owner_id"] == TEST_USER_ID
        assert row["owner_email"] == TEST_USER_EMAIL
        assert row["events_count"] == 42

        # The owner's email is searchable too.
        by_owner = await admin_client.get(f"/api/v1/admin/insights/event-logs?q={TEST_USER_EMAIL}")
        assert any(r["id"] == log_id for r in by_owner.json()["items"])
    finally:
        async with sm() as session:
            await session.execute(delete(EventLog).where(EventLog.id == log_id))
            await session.commit()
