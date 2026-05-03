from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest
from httpx import AsyncClient

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.mark.asyncio
async def test_modules_list_includes_sample(client_with_sample_mod: AsyncClient) -> None:
    resp = await client_with_sample_mod.get("/api/v1/modules")
    assert resp.status_code == 200
    data = resp.json()
    ids = [m["id"] for m in data]
    assert "sample_mod" in ids
    sample = next(m for m in data if m["id"] == "sample_mod")
    assert sample["category"] == "foundation"
    assert sample["provides"] == ["sample.ping"]


@pytest.mark.asyncio
async def test_module_route_mounted(client_with_sample_mod: AsyncClient) -> None:
    """The @route.get('/ping') on SampleModule should be mounted under
    /api/v1/modules/sample_mod/ping by the loader."""
    resp = await client_with_sample_mod.get("/api/v1/modules/sample_mod/ping")
    assert resp.status_code == 200
    body = resp.json()
    assert body == {"module_id": "sample_mod", "status": "pong"}


@pytest.mark.asyncio
async def test_module_manifest_endpoint(client_with_sample_mod: AsyncClient) -> None:
    resp = await client_with_sample_mod.get("/api/v1/modules/sample_mod/manifest")
    assert resp.status_code == 200
    m = resp.json()
    assert m["id"] == "sample_mod"
    assert "duckdb" in m["dependencies"]["python"]["inherit"]


@pytest.mark.asyncio
async def test_module_config_get_put(client_with_sample_mod: AsyncClient) -> None:
    initial = await client_with_sample_mod.get("/api/v1/modules/sample_mod/config")
    assert initial.status_code == 200
    assert initial.json() == {"config": {}, "enabled": True}

    payload = {"config": {"threshold": 0.5}, "enabled": True}
    put = await client_with_sample_mod.put("/api/v1/modules/sample_mod/config", json=payload)
    assert put.status_code == 200
    assert put.json() == payload

    again = await client_with_sample_mod.get("/api/v1/modules/sample_mod/config")
    assert again.json() == payload


@pytest.mark.asyncio
async def test_availability_evaluated_against_log_schema(client_with_sample_mod: AsyncClient) -> None:
    """Upload a small log, then list modules with ?log_id=… and confirm the
    sample module is reported `available` (it requires case_id/activity/timestamp)."""
    with (FIXTURES / "sample.xes").open("rb") as f:
        upload = await client_with_sample_mod.post(
            "/api/v1/event-logs",
            files={"file": ("sample.xes", f, "application/xml")},
        )
    log_id = upload.json()["log_id"]

    # Wait until ready.
    for _ in range(50):
        d = await client_with_sample_mod.get(f"/api/v1/event-logs/{log_id}")
        if d.json()["status"] == "ready":
            break
        await asyncio.sleep(0.05)

    listing = await client_with_sample_mod.get("/api/v1/modules", params={"log_id": log_id})
    assert listing.status_code == 200
    sample = next(m for m in listing.json() if m["id"] == "sample_mod")
    assert sample["availability"]["status"] == "available", sample
