"""Host-side wrapper for subprocess-isolated modules (§5.4).

Spawns `subprocess_worker.py` inside the module's `.venv`, listens on a
Unix socket for the worker's connection, and exposes a `SubprocessModule`
object that mimics the in-process `Module` instance: each handler is a
sync stub that the loader picks up via the same `_collect_handlers`
machinery, but calling it routes through JSON-RPC to the worker.

When the worker runs the handler, every `ctx.*` call comes back over the
same socket as a request; this host dispatches them against a registered
real `ModuleContext` looked up by `ctx_token`.
"""

from __future__ import annotations

import asyncio
import os
import shutil
import tempfile
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any

import structlog

from mate.api.modules.subprocess_worker import WireConnection
from mate.sdk.decorators import (
    _ATTR_JOB,
    _ATTR_ON_EVENT,
    _ATTR_ROUTE,
    EventSubscription,
    JobSpec,
    RouteSpec,
)
from mate.sdk.manifest import Manifest

log = structlog.get_logger(__name__)


class SubprocessHostError(RuntimeError):
    pass


class SubprocessModule:
    """Stand-in for the actual `Module` instance — the worker holds the real
    one. We synthesise stub methods carrying the same decorator metadata so
    the loader's `_collect_handlers` walk picks them up untouched.

    Intentionally NOT a subclass of `mate.sdk.Module`: the SDK's
    `__init_subclass__` validates `id` at class-definition time, which is
    fine for module authors but pointless for this duck-typed shim. The
    loader's `_bind` only reads `dir(instance)` + callable attrs + decorator
    metadata via `getattr(type(instance), name, None)`, so duck typing is
    enough.
    """

    def __init__(
        self, manifest_id: str, handlers_meta: list[dict[str, Any]], bridge: "SubprocessBridge"
    ) -> None:
        self.id = manifest_id
        self._bridge = bridge
        self._handlers_meta = handlers_meta
        self._install_stubs()

    def _install_stubs(self) -> None:
        for entry in self._handlers_meta:
            attr = entry["attr"]
            stub = self._make_handler_stub(attr)
            installed = False
            route_meta = entry.get("route")
            if route_meta:
                setattr(
                    stub,
                    _ATTR_ROUTE,
                    RouteSpec(
                        method=route_meta["method"],
                        path=route_meta["path"],
                        name=route_meta.get("name"),
                    ),
                )
                installed = True
            event_meta = entry.get("on_event")
            if event_meta:
                setattr(stub, _ATTR_ON_EVENT, EventSubscription(topic=event_meta["topic"]))
                installed = True
            job_meta = entry.get("job")
            if job_meta:
                # title/subtitle are static strings or None; a None means the
                # author used a callable (which can't cross the socket), so the
                # loader falls back to its default label via `_resolve_dynamic`.
                setattr(
                    stub,
                    _ATTR_JOB,
                    JobSpec(
                        progress=job_meta.get("progress", False),
                        title=job_meta.get("title"),
                        subtitle=job_meta.get("subtitle"),
                        priority=job_meta.get("priority", 0),
                        cancellable=job_meta.get("cancellable", True),
                        result_url=job_meta.get("result_url"),
                    ),
                )
                installed = True
            if not installed:
                continue
            # Bind on the instance AND the type so the loader's `_bind` walk
            # (which reads decorator metadata off `type(instance)`) picks them
            # up exactly like an in_process module.
            setattr(self, attr, stub)
            setattr(type(self), attr, stub)

    def _make_handler_stub(self, attr: str):
        """One stub for @route/@job/@on_event alike — forwards the call (with
        any positional payload + kwargs) to the worker over the bridge."""
        bridge = self._bridge

        async def stub(_self, ctx, *args, **kwargs):  # `_self` ignored; we're bound
            return await bridge.call_handler(attr, ctx, args, kwargs)

        stub.__name__ = attr
        stub.__qualname__ = f"SubprocessModule.{attr}"
        return stub


class SubprocessBridge:
    """Owns the worker process + socket for one module."""

    def __init__(self, manifest: Manifest, folder: Path) -> None:
        self.manifest = manifest
        self.folder = folder
        self._server: asyncio.base_events.Server | None = None
        self._conn: WireConnection | None = None
        self._proc: asyncio.subprocess.Process | None = None
        self._socket_dir = Path(tempfile.mkdtemp(prefix=f"ff-sock-{manifest.id}-"))
        self._socket_path = self._socket_dir / "rpc.sock"
        self._ready_evt = asyncio.Event()
        self._handlers_meta: list[dict[str, Any]] = []
        self._ctx_registry: dict[str, Any] = {}

    async def start(self) -> SubprocessModule:
        # Spawn the worker, wait for its `ready` (which carries the handler
        # list), then hand back a SubprocessModule whose stubs the loader binds
        # like any in_process module — @route, @job and @on_event all work.
        self._server = await asyncio.start_unix_server(
            self._on_connect, path=str(self._socket_path)
        )
        os.chmod(self._socket_path, 0o600)

        worker_py = _worker_python(self.folder)
        # Run the worker by file path (not `-m`) so we don't import the whole
        # `mate.api` package chain under the module's venv Python — the worker
        # only needs `mate.sdk`, which the installer installs into the venv.
        worker_script = Path(__file__).with_name("subprocess_worker.py")
        cmd = [
            str(worker_py),
            str(worker_script),
            str(self._socket_path),
            str(self.folder),
        ]
        self._proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={**os.environ, "PYTHONUNBUFFERED": "1"},
        )

        # Pipe worker stderr to our log so author tracebacks aren't lost.
        asyncio.create_task(self._drain_pipe(self._proc.stderr, "stderr"))
        asyncio.create_task(self._drain_pipe(self._proc.stdout, "stdout"))

        try:
            await asyncio.wait_for(self._ready_evt.wait(), timeout=30.0)
        except asyncio.TimeoutError as exc:
            await self.stop()
            raise SubprocessHostError(
                f"Subprocess module {self.manifest.id!r} did not signal ready in 30s."
            ) from exc

        return SubprocessModule(self.manifest.id, self._handlers_meta, self)

    async def stop(self) -> None:
        if self._conn is not None:
            try:
                await asyncio.wait_for(self._conn.send_request("shutdown", {}), timeout=2.0)
            except Exception:  # noqa: BLE001
                pass
        if self._proc is not None and self._proc.returncode is None:
            try:
                self._proc.terminate()
                await asyncio.wait_for(self._proc.wait(), timeout=5.0)
            except (asyncio.TimeoutError, ProcessLookupError):
                self._proc.kill()
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()
        shutil.rmtree(self._socket_dir, ignore_errors=True)

    async def _drain_pipe(self, stream, label: str) -> None:
        while True:
            line = await stream.readline()
            if not line:
                break
            log.info(
                "modules.subprocess.worker_output",
                module_id=self.manifest.id,
                stream=label,
                line=line.decode("utf-8", errors="replace").rstrip(),
            )

    async def _on_connect(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        conn = WireConnection(reader, writer)
        self._conn = conn

        # Worker → host RPCs for ctx.*
        for method, handler in self._ctx_handlers().items():
            conn.register(method, handler)
        conn.register("ready", self._on_ready)

        await conn.run()

    async def _on_ready(self, params: dict[str, Any]) -> Any:
        self._handlers_meta = params.get("handlers", [])
        self._ready_evt.set()
        return True

    async def call_handler(self, attr: str, ctx, args: tuple, kwargs: dict[str, Any]) -> Any:
        if self._conn is None:
            raise SubprocessHostError(f"Worker for {self.manifest.id!r} is not connected.")
        token = uuid.uuid4().hex
        self._ctx_registry[token] = ctx
        try:
            ctx_meta = {
                "log_id": ctx.log_id,
                "module_id": ctx.module_id,
                "workdir": str(ctx.workdir),
                "config": ctx.config.value if hasattr(ctx.config, "value") else {},
                # Snapshot the visible capability names so the worker's
                # (synchronous) ctx.registry.has() answers without a round-trip.
                "capabilities": _registry_snapshot(ctx),
            }
            return await self._conn.send_request(
                "call",
                {
                    "handler": attr,
                    "ctx_token": token,
                    "ctx": ctx_meta,
                    "args": [_jsonify(a) for a in args],
                    "kwargs": {k: _jsonify(v) for k, v in kwargs.items()},
                },
            )
        finally:
            self._ctx_registry.pop(token, None)

    def _ctx_handlers(self) -> dict[str, Callable]:
        """Wire ctx.* RPC names to real ModuleContext methods."""

        async def event_log_duckdb_fetch(params: dict[str, Any]) -> list[list[Any]]:
            ctx = self._ctx_registry[params["ctx_token"]]
            async with ctx.event_log as log_access:
                rows = await log_access.duckdb_fetch(params["sql"], params.get("params"))
            return [list(r) for r in rows]

        async def event_log_materialize(params: dict[str, Any]) -> str:
            # Write the (filter-applied) log to a Parquet under the per-call
            # workdir (shared filesystem) and hand the worker the path, so its
            # ctx.event_log.pandas()/polars()/pm4py() load it locally. The file
            # rides the workdir's auto-cleanup when the handler finishes.
            ctx = self._ctx_registry[params["ctx_token"]]
            async with ctx.event_log as log_access:
                df = await log_access.pandas()
            out = Path(ctx.workdir) / f"_eventlog_{uuid.uuid4().hex}.parquet"
            await asyncio.to_thread(df.to_parquet, str(out))
            return str(out)

        async def bus_emit(params: dict[str, Any]) -> None:
            ctx = self._ctx_registry[params["ctx_token"]]
            await ctx.bus.emit(params["topic"], params["payload"])

        async def cache_get(params: dict[str, Any]) -> Any:
            ctx = self._ctx_registry[params["ctx_token"]]
            return await ctx.cache.get(params["key"])

        async def cache_set(params: dict[str, Any]) -> None:
            ctx = self._ctx_registry[params["ctx_token"]]
            await ctx.cache.set(params["key"], params["value"])

        async def cache_exists(params: dict[str, Any]) -> bool:
            ctx = self._ctx_registry[params["ctx_token"]]
            return await ctx.cache.exists(params["key"])

        async def cache_delete(params: dict[str, Any]) -> None:
            ctx = self._ctx_registry[params["ctx_token"]]
            await ctx.cache.delete(params["key"])

        async def registry_call(params: dict[str, Any]) -> Any:
            ctx = self._ctx_registry[params["ctx_token"]]
            return await ctx.registry.call(params["capability"], **params.get("kwargs", {}))

        async def progress_update(params: dict[str, Any]) -> None:
            ctx = self._ctx_registry[params["ctx_token"]]
            await ctx.progress.update(
                params["current"],
                params.get("message"),
                total=params.get("total"),
                stage=params.get("stage"),
            )

        async def logger_log(params: dict[str, Any]) -> None:
            ctx = self._ctx_registry[params["ctx_token"]]
            level = params.get("level", "info")
            payload = params.get("payload", {})
            event = payload.pop("event", "")
            getattr(ctx.logger, level, ctx.logger.info)(event, **payload)

        return {
            "ctx.event_log.duckdb_fetch": event_log_duckdb_fetch,
            "ctx.event_log.materialize": event_log_materialize,
            "ctx.bus.emit": bus_emit,
            "ctx.cache.get": cache_get,
            "ctx.cache.set": cache_set,
            "ctx.cache.exists": cache_exists,
            "ctx.cache.delete": cache_delete,
            "ctx.registry.call": registry_call,
            "ctx.progress.update": progress_update,
            "ctx.logger.log": logger_log,
        }


def _worker_python(folder: Path) -> Path:
    """Path to the module's venv python (with platform sdk available via the
    MetaPathFinder shim during in_process — for subprocess we use the venv
    python directly since it's isolated)."""
    candidates = [folder / ".venv" / "bin" / "python3", folder / ".venv" / "bin" / "python"]
    for c in candidates:
        if c.exists():
            return c
    raise SubprocessHostError(
        f"No .venv/bin/python3 under {folder} — install must run before starting the subprocess."
    )


def _jsonify(value: Any) -> Any:
    """Best-effort JSON-native form for a handler arg crossing the socket.
    Pydantic models dump to dicts; everything else passes through (the worker
    receives JSON-native types, not reconstructed models)."""
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    return value


def _registry_snapshot(ctx: Any) -> list[str]:
    """Module + capability names visible to this ctx's user, so the worker's
    synchronous ctx.registry.has() can answer locally."""
    reg = getattr(ctx, "registry", None)
    if reg is None:
        return []
    names: set[str] = set()
    if hasattr(reg, "installed_modules"):
        names.update(reg.installed_modules())
    if hasattr(reg, "visible_capabilities"):
        names.update(reg.visible_capabilities())
    return sorted(names)
