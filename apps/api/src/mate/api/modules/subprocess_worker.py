"""Subprocess worker entry point for `isolation: subprocess` modules (§5.4).

Spawned by the host (`SubprocessHost`) with::

    python -m mate.api.modules.subprocess_worker <socket_path> <module_folder>

Connects to the host's listening Unix socket, imports the module from
``<module_folder>/module.py``, walks the resulting `Module` instance for
decorated handlers and sends a `ready` message describing them. The host
then sends `call` requests for each invocation; the worker executes the
handler in-process using a `ProxyContext` that translates every `ctx.*`
attribute access into an RPC back to the host over the same socket.

Wire protocol: line-delimited JSON, one message per line. Each message is
``{"id": int, "method": str, "params": dict}`` for requests, or
``{"id": int, "result": ...}`` / ``{"id": int, "error": {...}}`` for
responses. Both sides initiate requests; ids are local to the initiator.
"""

from __future__ import annotations

import asyncio
import importlib.util
import inspect
import json
import os
import sys
import traceback
from pathlib import Path
from typing import Any


def _import_module(folder: Path):
    """Import ``<folder>/module.py`` as a package so relative imports work."""
    py_path = folder / "module.py"
    if not py_path.exists():
        raise FileNotFoundError(f"Missing module.py at {py_path}")
    ns = f"_ff_subprocess_mod_{folder.name}"
    spec = importlib.util.spec_from_file_location(
        ns, py_path, submodule_search_locations=[str(folder)]
    )
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot import {py_path}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[ns] = mod
    spec.loader.exec_module(mod)
    return mod


def _find_module_class(mod):
    from mate.sdk import Module

    for value in mod.__dict__.values():
        if (
            inspect.isclass(value)
            and issubclass(value, Module)
            and value is not Module
            and value.__module__ == mod.__name__
        ):
            return value
    raise RuntimeError(f"No Module subclass in {mod.__name__}")


def _collect_handlers(instance) -> list[dict[str, Any]]:
    """Walk the instance for route/event/job-decorated methods."""
    from mate.sdk.decorators import get_event_sub, get_job_spec, get_route_spec

    out: list[dict[str, Any]] = []
    for attr_name in dir(instance):
        unbound = getattr(type(instance), attr_name, None)
        route_spec = get_route_spec(unbound)
        event_sub = get_event_sub(unbound)
        job_spec = get_job_spec(unbound)
        if not (route_spec or event_sub or job_spec):
            continue
        entry: dict[str, Any] = {"attr": attr_name}
        if route_spec is not None:
            entry["route"] = {
                "method": route_spec.method,
                "path": route_spec.path,
                "name": route_spec.name,
            }
        if event_sub is not None:
            entry["on_event"] = {"topic": event_sub.topic}
        if job_spec is not None:
            entry["job"] = True
        out.append(entry)
    return out


class _ProxyContext:
    """ctx.* surface forwarded to the host via JSON-RPC.

    Only the methods listed in the SDK's `ModuleContext` Protocols are
    supported. DataFrame views (`pandas`, `polars`, `pm4py`) raise a clear
    error because shipping a DataFrame over the socket would require either
    Parquet roundtrip or Arrow IPC — a follow-up worth doing once a real
    subprocess module needs it.
    """

    def __init__(self, conn: "WireConnection", token: str, ctx_meta: dict[str, Any]):
        self._conn = conn
        self._token = token
        self.log_id: str = ctx_meta.get("log_id", "")
        self.module_id: str = ctx_meta.get("module_id", "")
        self.workdir = Path(ctx_meta.get("workdir", "/tmp"))
        self.event_log = _EventLogProxy(conn, token)
        self.bus = _BusProxy(conn, token)
        self.registry = _RegistryProxy(conn, token)
        self.cache = _CacheProxy(conn, token)
        self.config = _ConfigProxy(ctx_meta.get("config", {}))
        self.progress = _ProgressProxy(conn, token)
        self.logger = _LoggerProxy(conn, token)


class _EventLogProxy:
    def __init__(self, conn: "WireConnection", token: str):
        self._conn = conn
        self._token = token

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return None

    async def duckdb_fetch(self, sql: str, params: list | tuple | None = None) -> list[tuple]:
        result = await self._conn.send_request(
            "ctx.event_log.duckdb_fetch",
            {"ctx_token": self._token, "sql": sql, "params": list(params or [])},
        )
        return [tuple(row) for row in result]

    async def pandas(self):
        raise RuntimeError(
            "DataFrame views (pandas/polars/pm4py) over subprocess isolation are not "
            "supported yet — use `await event_log.duckdb_fetch(sql)` instead."
        )

    polars = pandas
    pm4py = pandas


class _BusProxy:
    def __init__(self, conn: "WireConnection", token: str):
        self._conn = conn
        self._token = token

    async def emit(self, topic: str, payload: Any) -> None:
        if hasattr(payload, "model_dump"):
            payload = payload.model_dump()
        elif not isinstance(payload, dict):
            payload = {"value": payload}
        await self._conn.send_request(
            "ctx.bus.emit", {"ctx_token": self._token, "topic": topic, "payload": payload}
        )


class _RegistryProxy:
    def __init__(self, conn: "WireConnection", token: str):
        self._conn = conn
        self._token = token

    def has(self, cap: str) -> bool:
        # Synchronous from the SDK's perspective. The worker can do this
        # because there's no event loop blocking here — we synchronously
        # await a Future tied to the connection. For simplicity in this
        # MVP we route through the async path and document the limitation.
        raise RuntimeError(
            "ctx.registry.has() is sync — call asyncio.run_coroutine_threadsafe "
            "via the host bridge instead. (Subprocess registry support is partial; "
            "use async paths from module code.)"
        )

    async def call(self, capability: str, **kwargs: Any) -> Any:
        return await self._conn.send_request(
            "ctx.registry.call",
            {"ctx_token": self._token, "capability": capability, "kwargs": kwargs},
        )


class _CacheProxy:
    def __init__(self, conn: "WireConnection", token: str):
        self._conn = conn
        self._token = token

    async def get(self, key: str) -> Any:
        return await self._conn.send_request(
            "ctx.cache.get", {"ctx_token": self._token, "key": key}
        )

    async def set(self, key: str, value: Any) -> None:
        await self._conn.send_request(
            "ctx.cache.set", {"ctx_token": self._token, "key": key, "value": value}
        )

    async def exists(self, key: str) -> bool:
        return bool(
            await self._conn.send_request(
                "ctx.cache.exists", {"ctx_token": self._token, "key": key}
            )
        )

    async def delete(self, key: str) -> None:
        await self._conn.send_request(
            "ctx.cache.delete", {"ctx_token": self._token, "key": key}
        )


class _ConfigProxy:
    def __init__(self, value: dict[str, Any]):
        self._value = dict(value)

    @property
    def value(self) -> dict[str, Any]:
        return dict(self._value)

    def get(self, key: str, default: Any = None) -> Any:
        return self._value.get(key, default)


class _ProgressProxy:
    def __init__(self, conn: "WireConnection", token: str):
        self._conn = conn
        self._token = token

    async def update(
        self,
        current: float,
        message: str | None = None,
        *,
        total: float | None = None,
        stage: str | None = None,
    ) -> None:
        await self._conn.send_request(
            "ctx.progress.update",
            {
                "ctx_token": self._token,
                "current": current,
                "total": total,
                "stage": stage,
                "message": message,
            },
        )


class _LoggerProxy:
    """Minimal structlog-compatible logger that forwards to the host."""

    def __init__(self, conn: "WireConnection", token: str, bound: dict[str, Any] | None = None):
        self._conn = conn
        self._token = token
        self._bound = dict(bound or {})

    def bind(self, **kwargs: Any) -> "_LoggerProxy":
        merged = {**self._bound, **kwargs}
        return _LoggerProxy(self._conn, self._token, merged)

    def _log(self, level: str, event: str, **kwargs: Any) -> None:
        payload = {**self._bound, **kwargs, "event": event}
        asyncio.create_task(
            self._conn.send_request(
                "ctx.logger.log",
                {"ctx_token": self._token, "level": level, "payload": payload},
            )
        )

    def info(self, event: str, **kw: Any) -> None:
        self._log("info", event, **kw)

    def debug(self, event: str, **kw: Any) -> None:
        self._log("debug", event, **kw)

    def warning(self, event: str, **kw: Any) -> None:
        self._log("warning", event, **kw)

    def error(self, event: str, **kw: Any) -> None:
        self._log("error", event, **kw)

    def exception(self, event: str, **kw: Any) -> None:
        self._log("error", event, exc_info=True, **kw)


class WireConnection:
    """Bidirectional line-delimited JSON-RPC over a stream pair."""

    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        self._reader = reader
        self._writer = writer
        self._next_id = 1
        self._pending: dict[int, asyncio.Future] = {}
        self._dispatcher: dict[str, Any] = {}
        self._lock = asyncio.Lock()

    def register(self, method: str, fn) -> None:
        self._dispatcher[method] = fn

    async def send_request(self, method: str, params: dict[str, Any]) -> Any:
        async with self._lock:
            rid = self._next_id
            self._next_id += 1
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self._pending[rid] = fut
        await self._write({"id": rid, "method": method, "params": params})
        return await fut

    async def _write(self, msg: dict[str, Any]) -> None:
        line = json.dumps(msg).encode("utf-8") + b"\n"
        self._writer.write(line)
        await self._writer.drain()

    async def run(self) -> None:
        while not self._reader.at_eof():
            line = await self._reader.readline()
            if not line:
                break
            try:
                msg = json.loads(line.decode("utf-8"))
            except json.JSONDecodeError:
                continue
            if "method" in msg:
                asyncio.create_task(self._dispatch(msg))
            else:
                rid = msg.get("id")
                fut = self._pending.pop(rid, None)
                if fut and not fut.done():
                    if "error" in msg:
                        fut.set_exception(RuntimeError(msg["error"].get("message", "remote error")))
                    else:
                        fut.set_result(msg.get("result"))

    async def _dispatch(self, msg: dict[str, Any]) -> None:
        rid = msg.get("id")
        method = msg["method"]
        params = msg.get("params", {})
        fn = self._dispatcher.get(method)
        if fn is None:
            await self._write({"id": rid, "error": {"message": f"unknown method {method!r}"}})
            return
        try:
            result = fn(params)
            if inspect.isawaitable(result):
                result = await result
            await self._write({"id": rid, "result": result})
        except Exception as exc:  # noqa: BLE001
            await self._write(
                {
                    "id": rid,
                    "error": {
                        "message": f"{type(exc).__name__}: {exc}",
                        "traceback": traceback.format_exc(),
                    },
                }
            )


async def _amain(socket_path: str, module_folder: str) -> int:
    reader, writer = await asyncio.open_unix_connection(socket_path)
    conn = WireConnection(reader, writer)

    mod = _import_module(Path(module_folder))
    module_class = _find_module_class(mod)
    instance = module_class()
    handlers_meta = _collect_handlers(instance)

    async def handle_call(params: dict[str, Any]) -> Any:
        attr = params["handler"]
        ctx_token = params["ctx_token"]
        ctx_meta = params.get("ctx", {})
        kwargs = params.get("kwargs", {}) or {}
        bound = getattr(instance, attr)
        ctx = _ProxyContext(conn, ctx_token, ctx_meta)
        if inspect.iscoroutinefunction(bound):
            return await bound(ctx, **kwargs)
        return await asyncio.to_thread(bound, ctx, **kwargs)

    conn.register("call", handle_call)
    conn.register("shutdown", lambda _params: True)

    await conn._write({"id": None, "method": "ready", "params": {"handlers": handlers_meta}})
    await conn.run()
    writer.close()
    try:
        await writer.wait_closed()
    except Exception:  # noqa: BLE001
        pass
    return 0


def main() -> None:
    if len(sys.argv) != 3:
        print("usage: subprocess_worker.py <socket_path> <module_folder>", file=sys.stderr)
        sys.exit(2)
    socket_path = sys.argv[1]
    module_folder = sys.argv[2]
    # Make the module folder importable for relative `from .x import y`.
    sys.path.insert(0, module_folder)
    raise SystemExit(asyncio.run(_amain(socket_path, module_folder)))


if __name__ == "__main__":  # pragma: no cover - executed by spawned subprocess
    main()
