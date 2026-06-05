"""End-to-end tests for the Dashboards API (/api/v1/dashboards)."""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from httpx import AsyncClient

FIXTURES = Path(__file__).parent / "fixtures"


async def _wait_until_ready(client: AsyncClient, log_id: str, timeout: float = 5.0) -> None:
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        resp = await client.get(f"/api/v1/event-logs/{log_id}")
        body = resp.json()
        if body["status"] == "ready":
            return
        if body["status"] == "failed":
            raise AssertionError(f"Import failed: {body.get('error')}")
        await asyncio.sleep(0.05)
    raise AssertionError("Import did not finish")


async def _seed_log(client: AsyncClient) -> str:
    with (FIXTURES / "sample.csv").open("rb") as f:
        resp = await client.post(
            "/api/v1/event-logs",
            files={"file": ("sample.csv", f, "text/csv")},
            data={"name": "Sample CSV"},
        )
    log_id = resp.json()["log_id"]
    await _wait_until_ready(client, log_id)
    return log_id


def _item(i: str, *, x: int = 0, y: int = 0) -> dict:
    return {
        "i": i,
        "module_id": "performance",
        "widget_id": "kpi-overview",
        "title": "KPIs",
        "x": x,
        "y": y,
        "w": 6,
        "h": 8,
        "config": {},
    }


@pytest.mark.asyncio
async def test_dashboard_crud_lifecycle(client: AsyncClient) -> None:
    # Create empty
    resp = await client.post("/api/v1/dashboards", json={"name": "  My board  "})
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["name"] == "My board"  # trimmed
    assert created["items"] == []
    dash_id = created["id"]

    # List shows it with card_count 0
    resp = await client.get("/api/v1/dashboards")
    assert resp.status_code == 200
    rows = resp.json()
    assert any(r["id"] == dash_id and r["card_count"] == 0 for r in rows)

    # Bind a log + add cards
    log_id = await _seed_log(client)
    resp = await client.patch(
        f"/api/v1/dashboards/{dash_id}",
        json={"event_log_id": log_id, "items": [_item("a"), _item("b", y=8)]},
    )
    assert resp.status_code == 200, resp.text
    detail = resp.json()
    assert detail["event_log_id"] == log_id
    assert len(detail["items"]) == 2
    assert detail["items"][0]["module_id"] == "performance"

    # List reflects card count
    resp = await client.get("/api/v1/dashboards")
    row = next(r for r in resp.json() if r["id"] == dash_id)
    assert row["card_count"] == 2

    # Get detail round-trips the geometry
    resp = await client.get(f"/api/v1/dashboards/{dash_id}")
    assert resp.json()["items"][1]["y"] == 8

    # Delete
    resp = await client.delete(f"/api/v1/dashboards/{dash_id}")
    assert resp.status_code == 204
    resp = await client.get(f"/api/v1/dashboards/{dash_id}")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_dashboard_rejects_unowned_log(client: AsyncClient) -> None:
    resp = await client.post(
        "/api/v1/dashboards",
        json={"name": "bad", "event_log_id": "does-not-exist"},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_dashboard_empty_name_rejected(client: AsyncClient) -> None:
    resp = await client.post("/api/v1/dashboards", json={"name": "   "})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_dashboard_export_import_roundtrip(client: AsyncClient) -> None:
    resp = await client.post(
        "/api/v1/dashboards",
        json={"name": "Exportable", "items": [_item("x")]},
    )
    dash_id = resp.json()["id"]

    resp = await client.get(f"/api/v1/dashboards/{dash_id}/export")
    assert resp.status_code == 200, resp.text
    doc = resp.json()
    assert doc["kind"] == "mate.dashboard"
    assert doc["name"] == "Exportable"
    assert len(doc["items"]) == 1
    assert "event_log_id" not in doc  # export is log-agnostic

    # Re-import creates a fresh, independent board
    resp = await client.post("/api/v1/dashboards/import", json=doc)
    assert resp.status_code == 201, resp.text
    imported = resp.json()
    assert imported["id"] != dash_id
    assert imported["name"] == "Exportable"
    assert len(imported["items"]) == 1
