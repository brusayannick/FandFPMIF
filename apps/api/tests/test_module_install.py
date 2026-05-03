from __future__ import annotations

import asyncio
import io
import os
import zipfile
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

FIXTURES = Path(__file__).parent / "fixtures"


def _zip_sample_mod() -> bytes:
    """Pack the sample_mod fixture into an in-memory zip ready for upload."""
    src = FIXTURES / "modules" / "sample_mod"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in src.rglob("*"):
            if p.is_file():
                zf.write(p, arcname=str(p.relative_to(src.parent)))
    return buf.getvalue()


@pytest.fixture
async def empty_modules_client(tmp_path: Path) -> AsyncIterator[AsyncClient]:
    """A fresh app with an empty modules dir — the install flow installs INTO it."""
    prev = os.environ.get("MODULES_DIR")
    os.environ["MODULES_DIR"] = str(tmp_path / "modules")
    (tmp_path / "modules").mkdir()

    from flows_funds.api import config as cfg
    cfg.get_settings.cache_clear()

    try:
        from flows_funds.api.main import create_app
        app = create_app()
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as c:
            async with app.router.lifespan_context(app):
                yield c
    finally:
        if prev is None:
            os.environ.pop("MODULES_DIR", None)
        else:
            os.environ["MODULES_DIR"] = prev
        cfg.get_settings.cache_clear()


async def _wait_for_job(client: AsyncClient, job_id: str, timeout: float = 15.0) -> dict:
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        resp = await client.get(f"/api/v1/jobs/{job_id}")
        body = resp.json()
        if body["status"] in {"completed", "failed", "cancelled"}:
            return body
        await asyncio.sleep(0.1)
    raise AssertionError(f"job {job_id} did not finish")


@pytest.mark.asyncio
async def test_install_via_zip_and_route_is_live(empty_modules_client: AsyncClient) -> None:
    archive = _zip_sample_mod()
    resp = await empty_modules_client.post(
        "/api/v1/modules/install",
        files={"file": ("sample_mod.zip", archive, "application/zip")},
    )
    assert resp.status_code == 202, resp.text
    job_id = resp.json()["job_id"]

    final = await _wait_for_job(empty_modules_client, job_id)
    assert final["status"] == "completed", final

    listing = await empty_modules_client.get("/api/v1/modules")
    ids = [m["id"] for m in listing.json()]
    assert "sample_mod" in ids

    # The mounted module's @route.get('/ping') should answer.
    ping = await empty_modules_client.get("/api/v1/modules/sample_mod/ping")
    assert ping.status_code == 200, ping.text
    assert ping.json() == {"module_id": "sample_mod", "status": "pong"}


@pytest.mark.asyncio
async def test_install_rejects_double_install(empty_modules_client: AsyncClient) -> None:
    archive = _zip_sample_mod()
    first = await empty_modules_client.post(
        "/api/v1/modules/install",
        files={"file": ("sample_mod.zip", archive, "application/zip")},
    )
    await _wait_for_job(empty_modules_client, first.json()["job_id"])

    second = await empty_modules_client.post(
        "/api/v1/modules/install",
        files={"file": ("sample_mod.zip", archive, "application/zip")},
    )
    final = await _wait_for_job(empty_modules_client, second.json()["job_id"])
    assert final["status"] == "failed"
    assert "already installed" in (final.get("error") or "").lower()


@pytest.mark.asyncio
async def test_uninstall_removes_module(empty_modules_client: AsyncClient) -> None:
    archive = _zip_sample_mod()
    install = await empty_modules_client.post(
        "/api/v1/modules/install",
        files={"file": ("sample_mod.zip", archive, "application/zip")},
    )
    await _wait_for_job(empty_modules_client, install.json()["job_id"])

    uninstall = await empty_modules_client.delete("/api/v1/modules/sample_mod")
    assert uninstall.status_code == 204

    listing = await empty_modules_client.get("/api/v1/modules")
    ids = [m["id"] for m in listing.json()]
    assert "sample_mod" not in ids


@pytest.mark.asyncio
async def test_install_no_file_or_git_400(empty_modules_client: AsyncClient) -> None:
    resp = await empty_modules_client.post("/api/v1/modules/install", data={})
    assert resp.status_code == 400
