from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest
from httpx import AsyncClient

FIXTURES = Path(__file__).parent / "fixtures"


async def _wait(client: AsyncClient, log_id: str, target: str = "ready", timeout: float = 5.0) -> dict:
    deadline = asyncio.get_event_loop().time() + timeout
    last: dict = {}
    while asyncio.get_event_loop().time() < deadline:
        resp = await client.get(f"/api/v1/event-logs/{log_id}")
        last = resp.json()
        if last["status"] == target:
            return last
        await asyncio.sleep(0.05)
    raise AssertionError(f"Did not reach {target!r} in {timeout}s — last: {last}")


@pytest.mark.asyncio
async def test_jobs_list_filters(client: AsyncClient) -> None:
    with (FIXTURES / "sample.xes").open("rb") as f:
        resp = await client.post(
            "/api/v1/event-logs",
            files={"file": ("sample.xes", f, "application/xml")},
        )
    assert resp.status_code == 202
    job_id = resp.json()["job_id"]

    listing = await client.get("/api/v1/jobs", params={"type": "event_log.import"})
    assert listing.status_code == 200
    rows = listing.json()
    assert any(r["id"] == job_id for r in rows)
    for r in rows:
        assert r["type"] == "event_log.import"

    await _wait(client, resp.json()["log_id"], target="ready")
    finished = await client.get("/api/v1/jobs", params={"status": "completed", "limit": 5})
    assert finished.status_code == 200
    assert any(r["id"] == job_id for r in finished.json())


@pytest.mark.asyncio
async def test_retry_only_failed(client: AsyncClient) -> None:
    with (FIXTURES / "sample.xes").open("rb") as f:
        resp = await client.post(
            "/api/v1/event-logs",
            files={"file": ("sample.xes", f, "application/xml")},
        )
    job_id = resp.json()["job_id"]
    await _wait(client, resp.json()["log_id"], target="ready")

    rejected = await client.post(f"/api/v1/jobs/{job_id}/retry")
    assert rejected.status_code == 409


@pytest.mark.asyncio
async def test_cancel_unknown_job_409(client: AsyncClient) -> None:
    resp = await client.post("/api/v1/jobs/00000000-0000-0000-0000-000000000000/cancel")
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_pause_resume_idempotent(client: AsyncClient) -> None:
    a = await client.post("/api/v1/jobs/queue/pause")
    assert a.status_code == 204
    b = await client.post("/api/v1/jobs/queue/pause")
    assert b.status_code == 204  # idempotent
    c = await client.post("/api/v1/jobs/queue/resume")
    assert c.status_code == 204


@pytest.mark.asyncio
async def test_ws_events_receives_job_lifecycle(client: AsyncClient) -> None:
    """Subscribe to job.* over WS, kick off an import, expect a queued/started/completed sequence.

    We use the same ASGI transport so this exercises the real route — no network hop.
    """
    from flows_funds.api.main import create_app

    app = create_app()
    received: list[dict] = []

    async with app.router.lifespan_context(app):
        # Use websockets via httpx is awkward; use Starlette's TestClient pattern via
        # the app's ASGI directly. Easiest: drive the route handler with a Starlette
        # WebSocket client.
        from starlette.testclient import TestClient

        with TestClient(app) as tc:
            with tc.websocket_connect("/api/v1/events?topic=job.*") as ws:
                # Drive an import in a thread (TestClient is sync); read messages until completed.
                from threading import Thread

                def _kick() -> None:
                    with (FIXTURES / "sample.xes").open("rb") as f:
                        tc.post(
                            "/api/v1/event-logs",
                            files={"file": ("sample.xes", f, "application/xml")},
                        )

                Thread(target=_kick, daemon=True).start()
                # Read until we see job.completed or 5 s.
                import time

                deadline = time.monotonic() + 5.0
                while time.monotonic() < deadline:
                    raw = ws.receive_text()
                    msg = json.loads(raw)
                    received.append(msg)
                    if msg["topic"] == "job.completed":
                        break

    topics = [m["topic"] for m in received]
    assert "job.queued" in topics
    assert "job.started" in topics
    assert "job.completed" in topics
