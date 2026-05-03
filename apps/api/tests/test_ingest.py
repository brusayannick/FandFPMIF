from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest
from httpx import AsyncClient

FIXTURES = Path(__file__).parent / "fixtures"


async def _wait_until_ready(client: AsyncClient, log_id: str, timeout: float = 5.0) -> dict:
    deadline = asyncio.get_event_loop().time() + timeout
    last: dict = {}
    while asyncio.get_event_loop().time() < deadline:
        resp = await client.get(f"/api/v1/event-logs/{log_id}")
        assert resp.status_code == 200
        last = resp.json()
        if last["status"] == "ready":
            return last
        if last["status"] == "failed":
            raise AssertionError(f"Import failed: {last.get('error')}")
        await asyncio.sleep(0.05)
    raise AssertionError(f"Import did not finish in {timeout}s — last state: {last}")


@pytest.mark.asyncio
async def test_xes_round_trip(client: AsyncClient) -> None:
    fixture = FIXTURES / "sample.xes"
    with fixture.open("rb") as f:
        resp = await client.post(
            "/api/v1/event-logs",
            files={"file": ("sample.xes", f, "application/xml")},
            data={"name": "Sample XES"},
        )
    assert resp.status_code == 202, resp.text
    body = resp.json()
    assert body["log_id"]
    assert body["job_id"]

    detail = await _wait_until_ready(client, body["log_id"])
    assert detail["events_count"] == 9
    assert detail["cases_count"] == 3
    assert detail["variants_count"] == 2  # case-1/case-3 share a variant; case-2 cancels

    # Parquet artefacts on disk
    from flows_funds.api.ingest.storage import log_paths

    paths = log_paths(body["log_id"])
    assert paths.events.exists()
    assert paths.cases.exists()
    assert paths.meta.exists()

    meta = json.loads(paths.meta.read_text())
    assert meta["source_format"] == "xes"
    assert meta["events_count"] == 9


@pytest.mark.asyncio
async def test_csv_round_trip(client: AsyncClient) -> None:
    fixture = FIXTURES / "sample.csv"
    with fixture.open("rb") as f:
        resp = await client.post(
            "/api/v1/event-logs",
            files={"file": ("sample.csv", f, "text/csv")},
            data={"name": "Sample CSV"},
        )
    assert resp.status_code == 202, resp.text
    log_id = resp.json()["log_id"]
    detail = await _wait_until_ready(client, log_id)
    assert detail["source_format"] == "csv"
    assert detail["events_count"] == 9


@pytest.mark.asyncio
async def test_unsupported_format_415(client: AsyncClient) -> None:
    resp = await client.post(
        "/api/v1/event-logs",
        files={"file": ("notes.txt", b"hello", "text/plain")},
    )
    assert resp.status_code == 415


@pytest.mark.asyncio
async def test_list_and_delete(client: AsyncClient) -> None:
    fixture = FIXTURES / "sample.xes"
    with fixture.open("rb") as f:
        resp = await client.post(
            "/api/v1/event-logs",
            files={"file": ("sample.xes", f, "application/xml")},
        )
    log_id = resp.json()["log_id"]
    await _wait_until_ready(client, log_id)

    listing = await client.get("/api/v1/event-logs")
    assert listing.status_code == 200
    assert any(row["id"] == log_id for row in listing.json())

    delete = await client.delete(f"/api/v1/event-logs/{log_id}")
    assert delete.status_code == 204

    after = await client.get(f"/api/v1/event-logs/{log_id}")
    assert after.status_code == 404
