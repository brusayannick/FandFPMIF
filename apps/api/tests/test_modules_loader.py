from __future__ import annotations

import asyncio
import io
import json
import tempfile
import time
import zipfile
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
async def test_module_assets_served_and_traversal_rejected(
    client_with_sample_mod: AsyncClient, tmp_path: Path
) -> None:
    """`/api/v1/modules/{id}/assets/<path>` serves files from modules/<id>/.dist/
    (the bundler's output dir). Path traversal must be rejected. We synthesise a
    fake `panel.js` under the fixture module's `.dist/` so we can exercise the
    route without running esbuild from a test."""
    import os
    from flows_funds.api.config import get_settings

    settings = get_settings()
    dist_dir = settings.modules_dir / "sample_mod" / ".dist"
    dist_dir.mkdir(parents=True, exist_ok=True)
    panel = dist_dir / "panel.js"
    panel.write_text("module.exports = { Panel: () => null };\n")
    secret = settings.modules_dir / "sample_mod" / "secret.txt"
    secret.write_text("nope")

    ok = await client_with_sample_mod.get("/api/v1/modules/sample_mod/assets/panel.js")
    assert ok.status_code == 200
    assert "module.exports" in ok.text
    assert ok.headers.get("content-type", "").startswith("application/javascript")

    missing = await client_with_sample_mod.get("/api/v1/modules/sample_mod/assets/nope.js")
    assert missing.status_code == 404

    # Traversal — try to escape .dist/ via ../. resolve() collapses it, then
    # the relative_to() check fails.
    escape = await client_with_sample_mod.get(
        "/api/v1/modules/sample_mod/assets/..%2Fsecret.txt"
    )
    assert escape.status_code in (400, 404)


@pytest.mark.asyncio
async def test_module_install_from_upload(client_with_sample_mod: AsyncClient) -> None:
    """Upload a zipped module with a different id, wait for the install job to
    complete, and confirm the new module is loaded and routable."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            "uploaded_mod/manifest.yaml",
            "id: uploaded_mod\nname: Uploaded\nversion: 0.0.1\ncategory: foundation\n"
            "requirements:\n  event_log:\n    required_columns: [case_id, activity, timestamp]\n"
            "    min_events: 1\n    min_cases: 1\n"
            "provides: []\nconsumes: []\n"
            "dependencies:\n  python:\n    inherit: []\n    isolation: in_process\n",
        )
        zf.writestr(
            "uploaded_mod/module.py",
            (
                "from flows_funds.sdk import Module, ModuleContext, route\n\n"
                "class UploadedModule(Module):\n"
                "    id = \"uploaded_mod\"\n\n"
                "    @route.get(\"/ping\")\n"
                "    async def ping(self, ctx: ModuleContext) -> dict[str, str]:\n"
                "        return {\"id\": ctx.module_id}\n"
            ),
        )
    buf.seek(0)

    resp = await client_with_sample_mod.post(
        "/api/v1/modules/install",
        files={"file": ("uploaded_mod.zip", buf.getvalue(), "application/zip")},
    )
    assert resp.status_code == 202, resp.text
    job_id = resp.json()["job_id"]

    # Wait for the install job to finish.
    for _ in range(50):
        d = await client_with_sample_mod.get(f"/api/v1/jobs/{job_id}")
        if d.status_code == 200 and d.json()["status"] in {"completed", "failed"}:
            break
        await asyncio.sleep(0.1)
    assert d.json()["status"] == "completed", d.json()

    # New module should now be listed and routable.
    listing = await client_with_sample_mod.get("/api/v1/modules")
    ids = [m["id"] for m in listing.json()]
    assert "uploaded_mod" in ids
    ping = await client_with_sample_mod.get("/api/v1/modules/uploaded_mod/ping")
    assert ping.status_code == 200
    assert ping.json() == {"id": "uploaded_mod"}


@pytest.mark.asyncio
async def test_module_install_upload_rejects_bad_suffix(
    client_with_sample_mod: AsyncClient,
) -> None:
    resp = await client_with_sample_mod.post(
        "/api/v1/modules/install",
        files={"file": ("not-archive.txt", b"hello", "text/plain")},
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_module_install_registry_npm_rejected(
    client_with_sample_mod: AsyncClient,
) -> None:
    """npm source has no Python entry point to bind to — the job must surface
    a clear error rather than silently no-op."""
    resp = await client_with_sample_mod.post(
        "/api/v1/modules/install/registry",
        json={"source": "npm", "id": "@scope/pkg"},
    )
    assert resp.status_code == 202
    job_id = resp.json()["job_id"]
    for _ in range(30):
        d = await client_with_sample_mod.get(f"/api/v1/jobs/{job_id}")
        if d.status_code == 200 and d.json()["status"] in {"completed", "failed"}:
            break
        await asyncio.sleep(0.1)
    body = d.json()
    assert body["status"] == "failed"
    msg = (body.get("message") or "") + (body.get("error") or "")
    assert "npm" in msg.lower()


@pytest.mark.asyncio
async def test_entry_point_discovery(client_with_sample_mod: AsyncClient) -> None:
    """Register an in-process entry point pointing at a fake package; verify
    the discovery layer picks it up. We don't `pip install` anything here —
    we use `importlib.metadata`'s test hooks via a stub Distribution.
    """
    import importlib.metadata
    import sys
    import types
    from pathlib import Path

    from flows_funds.api.modules.discovery import discover_entry_points

    # Build an in-memory package with a manifest.yaml alongside __init__.py.
    pkg_root = Path(tempfile.mkdtemp(prefix="ff-ep-test-"))
    (pkg_root / "ff_ep_test_mod").mkdir()
    (pkg_root / "ff_ep_test_mod" / "__init__.py").write_text("")
    (pkg_root / "ff_ep_test_mod" / "manifest.yaml").write_text(
        "id: ep_mod\nname: EP\nversion: 0.0.1\ncategory: foundation\n"
        "requirements:\n  event_log:\n    required_columns: [case_id, activity, timestamp]\n"
        "    min_events: 1\n    min_cases: 1\n"
        "provides: []\nconsumes: []\n"
        "dependencies:\n  python:\n    inherit: []\n    isolation: in_process\n"
    )
    sys.path.insert(0, str(pkg_root))

    # Register a fake distribution exposing the entry point.
    class _StubDist(importlib.metadata.Distribution):
        def read_text(self, filename):  # type: ignore[override]
            if filename == "METADATA":
                return "Metadata-Version: 1.0\nName: ff-ep-test-mod\nVersion: 0.0.1\n"
            if filename == "entry_points.txt":
                return "[flows_funds.modules]\nep_mod = ff_ep_test_mod\n"
            return None

        def locate_file(self, path):  # type: ignore[override]
            return pkg_root / path

    original_distributions = importlib.metadata.distributions

    def _patched_distributions(*args, **kwargs):
        yield from original_distributions(*args, **kwargs)
        yield _StubDist()

    importlib.metadata.distributions = _patched_distributions  # type: ignore[assignment]
    try:
        cache = getattr(importlib.metadata, "_ep_cache", None)
        if cache is not None:
            cache.clear()
        found = {d.id: d for d in discover_entry_points()}
        assert "ep_mod" in found, list(found.keys())
        assert found["ep_mod"].source == "entry_point"
        assert (found["ep_mod"].folder / "manifest.yaml").exists()
    finally:
        importlib.metadata.distributions = original_distributions  # type: ignore[assignment]
        sys.path.remove(str(pkg_root))


def test_sweep_stale_workdirs_removes_old_dirs(tmp_path: Path) -> None:
    """`sweep_stale_workdirs` deletes leftover `ff-mod-*` temp dirs older than
    the cutoff. Belt-and-braces for the rare crash where the per-invocation
    cleanup in the loader's `_invoke_handler` didn't run.
    """
    import os
    import tempfile as _tempfile
    from unittest.mock import patch

    from flows_funds.api.modules.hot_reload import sweep_stale_workdirs

    # Run in an isolated tmp_root so we don't touch real system temp dirs.
    with patch.object(_tempfile, "gettempdir", return_value=str(tmp_path)):
        old = tmp_path / "ff-mod-discovery-abc"
        old.mkdir()
        recent = tmp_path / "ff-mod-discovery-xyz"
        recent.mkdir()
        unrelated = tmp_path / "other-temp"
        unrelated.mkdir()
        # Backdate `old` by 48 hours.
        past = time.time() - 48 * 3600
        os.utime(old, (past, past))

        removed = sweep_stale_workdirs(max_age_hours=24)

    assert removed == 1
    assert not old.exists()
    assert recent.exists()
    assert unrelated.exists()


@pytest.mark.asyncio
async def test_subprocess_wire_protocol_bidirectional() -> None:
    """Exercise the JSON-RPC framing without spawning a real subprocess.

    Two ``WireConnection``s plumbed to opposite ends of an in-memory socket
    pair stand in for host ↔ worker. We register an `add` method on one side
    and call it from the other, confirming requests and responses cross
    correctly and that simultaneous requests in both directions don't
    interleave wrongly.
    """
    import socket

    from flows_funds.api.modules.subprocess_worker import WireConnection

    sa, sb = socket.socketpair()
    reader_a, writer_a = await asyncio.open_connection(sock=sa)
    reader_b, writer_b = await asyncio.open_connection(sock=sb)
    conn_a = WireConnection(reader_a, writer_a)
    conn_b = WireConnection(reader_b, writer_b)

    conn_b.register("add", lambda p: p["x"] + p["y"])
    conn_a.register("greet", lambda p: f"hello {p['name']}")

    task_a = asyncio.create_task(conn_a.run())
    task_b = asyncio.create_task(conn_b.run())

    # Host → worker (A calls B).
    result = await conn_a.send_request("add", {"x": 2, "y": 40})
    assert result == 42

    # Worker → host (B calls A) — exercises the reverse direction so we know
    # the duplex framing doesn't deadlock.
    greeting = await conn_b.send_request("greet", {"name": "world"})
    assert greeting == "hello world"

    # Unknown method must surface a clear error rather than hang.
    with pytest.raises(RuntimeError, match="unknown method"):
        await conn_a.send_request("nope", {})

    writer_a.close()
    writer_b.close()
    for t in (task_a, task_b):
        try:
            await asyncio.wait_for(t, timeout=1.0)
        except (asyncio.TimeoutError, asyncio.CancelledError, Exception):
            t.cancel()


@pytest.mark.asyncio
async def test_handler_workdir_cleaned_up(client_with_sample_mod: AsyncClient) -> None:
    """Each handler invocation gets a fresh `ctx.workdir` from mkdtemp; the
    loader's `_invoke_handler` must rmtree it once the handler returns so per-
    call scratch dirs don't accumulate under the system tmp."""
    tmp_root = Path(tempfile.gettempdir())
    pattern = "ff-mod-sample_mod-*"

    before = set(tmp_root.glob(pattern))
    for _ in range(3):
        resp = await client_with_sample_mod.get("/api/v1/modules/sample_mod/ping")
        assert resp.status_code == 200
    after = set(tmp_root.glob(pattern))

    leaked = after - before
    assert not leaked, f"Workdir leak after handler calls: {leaked}"


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
