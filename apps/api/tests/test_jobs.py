from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

import pytest
from httpx import AsyncClient

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.mark.asyncio
async def test_bus_schema_enforcement() -> None:
    """Topics with a registered Pydantic schema must reject malformed
    payloads at publish time (§5.7a). Topics without a schema pass through
    untouched so platform-emitted `job.*` events don't have to round-trip.
    """
    from pydantic import BaseModel

    from flows_funds.api.events.bus import EventBus, EventSchemaError

    class KpiPayload(BaseModel):
        log_id: str
        rate: float

    bus = EventBus()
    bus.register_schema("kpi.computed", KpiPayload)

    # Valid — passes through and gets re-normalised by Pydantic.
    await bus.publish("kpi.computed", {"log_id": "abc", "rate": 1.5})

    # Missing required field — clear error at the publish site.
    with pytest.raises(EventSchemaError):
        await bus.publish("kpi.computed", {"log_id": "abc"})

    # Wrong type — same outcome.
    with pytest.raises(EventSchemaError):
        await bus.publish("kpi.computed", {"log_id": "abc", "rate": "fast"})

    # Untyped topic — bus stays out of the way.
    await bus.publish("anything.goes", {"whatever": 1})

    # Re-registering with a different model is a hard error.
    class Other(BaseModel):
        x: int

    with pytest.raises(EventSchemaError, match="already has a schema"):
        bus.register_schema("kpi.computed", Other)


@pytest.mark.asyncio
async def test_runtime_run_in_process_uses_worker_pid() -> None:
    """`JobRuntime.run_in_process` must execute the callable in a different
    process so GIL-bound work parallelises (§8.3). We compare PIDs as the
    direct evidence — `os.getpid` is picklable and returns the worker's PID
    when run inside the executor.
    """
    from flows_funds.api.jobs.runtime import JobRuntime

    rt = JobRuntime()
    try:
        worker_pid = await rt.run_in_process(os.getpid)
        assert worker_pid != os.getpid()
        # Second call should reuse the same warm worker (or another from the
        # pool — both fine; we only assert it's not the main process).
        again = await rt.run_in_process(os.getpid)
        assert again != os.getpid()
        # kwargs path: max(a, b, key=...) is awkward to pickle; use a simple
        # picklable case to confirm kwargs route through.
        rounded = await rt.run_in_process(round, 1.55555, ndigits=2)
        assert rounded == 1.56
    finally:
        await rt.stop()


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
