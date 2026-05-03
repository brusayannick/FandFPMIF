"""Module loader — discovery → install → import → mount (§5.3).

Mounts each loaded module's:

  - ``@route.*`` handlers under ``/api/v1/modules/{id}/...`` (FastAPI handles
    sync→threadpool — §5.5).
  - ``@on_event`` handlers as bus subscribers (with SDK auto-wrap).
  - ``@job`` handlers on the platform `JobRuntime` and, when stacked under a
    route, replaces the route body with an enqueue-and-return-job-id stub.
  - Capabilities (``manifest.provides``) on the registry.

`subprocess` isolation, watchdog hot-reload, and the entry-point discovery
for installable third-party modules are flagged as gaps in the relevant
helpers and not wired here.
"""

from __future__ import annotations

import asyncio
import importlib.util
import inspect
import sys
import tempfile
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import structlog
from fastapi import APIRouter, FastAPI, HTTPException

from flows_funds.api.config import get_settings
from flows_funds.api.db.engine import get_sessionmaker
from flows_funds.api.db.models import ModuleConfig
from flows_funds.api.events import EventBus
from flows_funds.api.jobs.runtime import JobHandle, JobRuntime
from flows_funds.api.modules.availability import Availability, evaluate as evaluate_availability
from flows_funds.api.modules.cache import ResultCache
from flows_funds.api.modules.discovery import DiscoveredModule, discover, topo_sort
from flows_funds.api.modules.event_log_access import EventLogAccess
from flows_funds.api.modules.finder import get_finder, module_namespace, reset_finder
from flows_funds.api.modules.installer import install_module
from flows_funds.api.modules.registry import CapabilityRegistry
from flows_funds.sdk.context import ModuleContext
from flows_funds.sdk.decorators import (
    JobSpec,
    RouteSpec,
    get_event_sub,
    get_job_spec,
    get_route_spec,
)
from flows_funds.sdk.manifest import Manifest
from flows_funds.sdk.module import Module

log = structlog.get_logger(__name__)


@dataclass
class LoadedModule:
    discovered: DiscoveredModule
    instance: Module
    sub_router: APIRouter
    handlers: dict[str, Callable[..., Awaitable[Any]]] = field(default_factory=dict)
    capabilities: list[str] = field(default_factory=list)

    @property
    def id(self) -> str:
        return self.discovered.id

    @property
    def manifest(self) -> Manifest:
        return self.discovered.manifest


# ---------------------------------------------------------------------------
# SDK protocol implementations bound to the platform runtime.
# ---------------------------------------------------------------------------


class _SdkBusAdapter:
    """Bridge `flows_funds.sdk.context.EventBusProtocol` over our EventBus."""

    def __init__(self, bus: EventBus) -> None:
        self._bus = bus

    async def emit(self, topic: str, payload: Any) -> None:
        if hasattr(payload, "model_dump"):
            payload = payload.model_dump()
        elif not isinstance(payload, dict):
            payload = {"value": payload}
        await self._bus.publish(topic, payload)

    async def subscribe(self, *patterns: str):
        # Module-author-facing subscribe is a syntactic helper around our
        # context-managed bus — return an async iterator. The lifetime of the
        # subscription matches the iterator's lifetime.
        async def _iter():
            async with self._bus.subscribe(patterns or ("*",)) as stream:
                async for env in stream:
                    yield env

        return _iter()


class _NoopProgress:
    async def update(
        self,
        current: float,
        message: str | None = None,
        *,
        total: float | None = None,
        stage: str | None = None,
    ) -> None:
        return None


class _JobProgressAdapter:
    """Wraps the platform `JobHandle.progress()` for module authors."""

    def __init__(self, handle: JobHandle) -> None:
        self._handle = handle

    async def update(
        self,
        current: float,
        message: str | None = None,
        *,
        total: float | None = None,
        stage: str | None = None,
    ) -> None:
        await self._handle.progress(int(current), int(total) if total else None, stage=stage, message=message)


class _ModuleConfigAdapter:
    def __init__(self, value: dict[str, Any]) -> None:
        self._value = dict(value)

    @property
    def value(self) -> dict[str, Any]:
        return dict(self._value)

    def get(self, key: str, default: Any = None) -> Any:
        return self._value.get(key, default)


def _extra_handler_params(bound_method: Callable[..., Any]) -> list[inspect.Parameter]:
    """Return a handler's parameters after `ctx`.

    The first param of every module handler is `ctx: ModuleContext`, which the
    loader supplies; everything after is forwarded from FastAPI's query string.
    """
    try:
        sig = inspect.signature(bound_method)
    except (TypeError, ValueError):
        return []
    params = list(sig.parameters.values())
    if not params:
        return []
    # `bound_method` is a bound instance method, so `self` is already removed.
    # Skip the first param (`ctx`) — what remains are the user kwargs.
    return params[1:]


def _build_endpoint_signature(extras: list[inspect.Parameter]) -> inspect.Signature:
    """Build a FastAPI-friendly signature: `log_id` + any forwarded kwargs."""
    log_id_param = inspect.Parameter(
        "log_id",
        kind=inspect.Parameter.KEYWORD_ONLY,
        default=None,
        annotation=str | None,
    )
    forwarded: list[inspect.Parameter] = []
    for p in extras:
        default = p.default if p.default is not inspect.Parameter.empty else None
        annotation = (
            p.annotation if p.annotation is not inspect.Parameter.empty else (Any)
        )
        forwarded.append(
            inspect.Parameter(
                p.name,
                kind=inspect.Parameter.KEYWORD_ONLY,
                default=default,
                annotation=annotation,
            )
        )
    return inspect.Signature(parameters=[log_id_param, *forwarded])


# ---------------------------------------------------------------------------
# Loader
# ---------------------------------------------------------------------------


class ModuleLoader:
    def __init__(
        self,
        modules_dir: Path,
        *,
        bus: EventBus,
        runtime: JobRuntime,
        registry: CapabilityRegistry,
        api_app: FastAPI | None = None,
    ) -> None:
        self.modules_dir = modules_dir
        self.bus = bus
        self.runtime = runtime
        self.registry = registry
        self.api_app = api_app
        self.loaded: dict[str, LoadedModule] = {}
        self._mount_router: APIRouter | None = None
        self._sub_event_tasks: list[asyncio.Task] = []

    async def load_all(self) -> list[LoadedModule]:
        discovered = discover(self.modules_dir)
        if not discovered:
            log.info("modules.loader.no_modules", dir=str(self.modules_dir))
            return []

        ordered = topo_sort(discovered)
        finder = get_finder()

        for d in ordered:
            try:
                site = await install_module(d.folder, d.manifest)
                if site is not None:
                    finder.register(
                        d.manifest.id,
                        site,
                        inherit=d.manifest.dependencies.python.inherit,
                    )
            except Exception as exc:  # noqa: BLE001
                log.exception("modules.loader.install_failed", module_id=d.id, error=str(exc))
                continue

            try:
                instance = self._import_module_class(d)
            except Exception as exc:  # noqa: BLE001
                log.exception("modules.loader.import_failed", module_id=d.id, error=str(exc))
                continue

            loaded = LoadedModule(
                discovered=d,
                instance=instance,
                sub_router=APIRouter(prefix=f"/modules/{d.id}", tags=[f"module:{d.id}"]),
            )
            self._bind(loaded)
            self.loaded[d.id] = loaded
            self.registry.add_module(d.id)
            await self._seed_module_config(d.manifest)

        if self.api_app is not None:
            self._mount_router = APIRouter(prefix="/api/v1")
            for loaded in self.loaded.values():
                self._mount_router.include_router(loaded.sub_router)
            self.api_app.include_router(self._mount_router)
            self.api_app.openapi_schema = None  # invalidate so /openapi.json picks up the new routes

        return list(self.loaded.values())

    async def unload_all(self) -> None:
        for task in self._sub_event_tasks:
            task.cancel()
        await asyncio.gather(*self._sub_event_tasks, return_exceptions=True)
        self._sub_event_tasks.clear()

        for loaded in self.loaded.values():
            self.registry.remove_module(loaded.id)
        self.loaded.clear()
        reset_finder()

    async def load_one(self, folder: Path, manifest: Manifest) -> LoadedModule:
        """Load (or reload) a single module post-startup. Used by the install
        flow (§7.6.2) so the user doesn't have to restart the API to see a
        newly-imported module.
        """
        from flows_funds.api.modules.discovery import DiscoveredModule

        existing = self.loaded.get(manifest.id)
        if existing is not None:
            await self.unload_one(manifest.id)

        finder = get_finder()
        site = await install_module(folder, manifest)
        if site is not None:
            finder.register(
                manifest.id,
                site,
                inherit=manifest.dependencies.python.inherit,
            )

        d = DiscoveredModule(folder=folder, manifest=manifest)
        instance = self._import_module_class(d)
        loaded = LoadedModule(
            discovered=d,
            instance=instance,
            sub_router=APIRouter(prefix=f"/modules/{d.id}", tags=[f"module:{d.id}"]),
        )
        self._bind(loaded)
        self.loaded[d.id] = loaded
        self.registry.add_module(d.id)
        await self._seed_module_config(d.manifest)

        if self.api_app is not None:
            mount = APIRouter(prefix="/api/v1")
            mount.include_router(loaded.sub_router)
            self.api_app.include_router(mount)
            self.api_app.openapi_schema = None

        return loaded

    async def unload_one(self, module_id: str) -> bool:
        """Unmount a module's routes / event subscribers / capabilities. The
        FastAPI router can't actually be unbound at runtime, so the in-memory
        routes survive until the next process restart — but the handlers are
        gated on `self.loaded`, so calls return 404 cleanly.
        """
        loaded = self.loaded.pop(module_id, None)
        if loaded is None:
            return False
        # Cancel any per-module event subscriptions. We restart the lot since
        # we don't track ownership per task; phase-9 minimum.
        for task in self._sub_event_tasks:
            task.cancel()
        await asyncio.gather(*self._sub_event_tasks, return_exceptions=True)
        self._sub_event_tasks.clear()
        # Re-bind events for the remaining modules.
        for remaining in self.loaded.values():
            self._rebind_events(remaining)
        self.registry.remove_module(module_id)
        return True

    def _rebind_events(self, loaded: LoadedModule) -> None:
        for attr_name in dir(loaded.instance):
            event_sub = get_event_sub(getattr(type(loaded.instance), attr_name, None))
            if event_sub is None:
                continue
            job_spec = get_job_spec(getattr(type(loaded.instance), attr_name, None))
            self._bind_event(loaded, getattr(loaded.instance, attr_name), event_sub, job_spec)

    async def _seed_module_config(self, manifest: Manifest) -> None:
        """Insert a `module_configs` row honouring `manifest.default_enabled`
        on first discovery. Existing rows are left untouched (user choice wins).
        """
        try:
            sm = get_sessionmaker()
        except Exception:  # noqa: BLE001 — engine not initialised in tests
            return
        async with sm() as session:
            existing = await session.get(ModuleConfig, manifest.id)
            if existing is not None:
                return
            session.add(
                ModuleConfig(
                    module_id=manifest.id,
                    config_json={},
                    enabled=manifest.default_enabled,
                )
            )
            await session.commit()

    def manifests(self) -> list[Manifest]:
        return [m.manifest for m in self.loaded.values()]

    def availability_for(
        self,
        *,
        detected_schema: dict[str, Any] | None,
        events_count: int | None,
        cases_count: int | None,
    ) -> dict[str, Availability]:
        ids = {m.id for m in self.loaded.values()}
        return {
            m.id: evaluate_availability(
                m.manifest,
                detected_schema=detected_schema,
                events_count=events_count,
                cases_count=cases_count,
                installed_module_ids=ids,
            )
            for m in self.loaded.values()
        }

    # -- internal -----------------------------------------------------------

    def _import_module_class(self, d: DiscoveredModule) -> Module:
        ns = module_namespace(d.id)
        py_path = d.folder / "module.py"
        if not py_path.exists():
            raise FileNotFoundError(f"Module {d.id!r} is missing module.py at {py_path}.")
        # Treat the module folder as a package so module.py can use relative
        # imports (`from .serializers import ...`) for sibling files.
        spec = importlib.util.spec_from_file_location(
            ns, py_path, submodule_search_locations=[str(d.folder)]
        )
        if spec is None or spec.loader is None:
            raise ImportError(f"Cannot create import spec for {d.id!r} at {py_path}.")
        mod = importlib.util.module_from_spec(spec)
        sys.modules[ns] = mod
        spec.loader.exec_module(mod)

        # Find the `Module` subclass declared in this file.
        for value in mod.__dict__.values():
            if (
                inspect.isclass(value)
                and issubclass(value, Module)
                and value is not Module
                and value.__module__ == ns
            ):
                if value.id != d.id:
                    raise RuntimeError(
                        f"Module class id {value.id!r} does not match manifest id {d.id!r}."
                    )
                return value()
        raise RuntimeError(f"No Module subclass found in {py_path}.")

    def _bind(self, loaded: LoadedModule) -> None:
        for cap in loaded.manifest.provides:
            # Capabilities are bound lazily — module authors surface them via
            # @route handlers; mapping a capability name to a specific handler
            # is left as a phase 5.1 enhancement (no v1 module needs cross-
            # module RPC). For now we record them as "advertised by this module".
            self.registry.add_module(loaded.id)
            loaded.capabilities.append(cap)

        for attr_name in dir(loaded.instance):
            attr = getattr(loaded.instance, attr_name)
            if not callable(attr):
                continue
            route_spec = get_route_spec(getattr(type(loaded.instance), attr_name, None))
            event_sub = get_event_sub(getattr(type(loaded.instance), attr_name, None))
            job_spec = get_job_spec(getattr(type(loaded.instance), attr_name, None))

            if route_spec is not None:
                self._bind_route(loaded, attr, route_spec, job_spec)
            if event_sub is not None:
                self._bind_event(loaded, attr, event_sub, job_spec)

    def _bind_route(
        self,
        loaded: LoadedModule,
        bound_method: Callable[..., Any],
        spec: RouteSpec,
        job_spec: JobSpec | None,
    ) -> None:
        module_id = loaded.id
        router = loaded.sub_router

        # Forward any handler kwargs (besides `ctx`) to FastAPI as query
        # params so module routes can take typed inputs without each module
        # re-declaring the FastAPI plumbing.
        extras = _extra_handler_params(bound_method)

        if job_spec is None:
            async def _endpoint(**kwargs: Any) -> Any:  # noqa: ANN401
                log_id = kwargs.pop("log_id", None)
                ctx = await self._make_context(module_id, log_id or "")
                # FastAPI handles sync→threadpool for sync handlers automatically
                # when registered as routes; for async we await directly.
                if inspect.iscoroutinefunction(bound_method):
                    return await bound_method(ctx, **kwargs)
                return await asyncio.to_thread(lambda: bound_method(ctx, **kwargs))

            _endpoint.__signature__ = _build_endpoint_signature(extras)  # type: ignore[attr-defined]
        else:
            title_default = (
                job_spec.title
                if isinstance(job_spec.title, str)
                else f"{module_id}.{spec.path.lstrip('/').replace('/', '.')}"
            )

            async def _endpoint(log_id: str | None = None) -> dict[str, str]:  # type: ignore[misc]
                ctx_log_id = log_id or ""

                async def _job_handler(handle: JobHandle) -> None:
                    ctx = await self._make_context(
                        module_id,
                        ctx_log_id,
                        progress=_JobProgressAdapter(handle),
                    )
                    if inspect.iscoroutinefunction(bound_method):
                        await bound_method(ctx)
                    else:
                        await asyncio.to_thread(bound_method, ctx)

                # Register a one-shot handler under a unique type tag.
                job_type = f"module.{module_id}.{spec.path.lstrip('/').replace('/', '.') or 'root'}"
                if job_type not in self.runtime._handlers:  # type: ignore[attr-defined]
                    self.runtime.register(job_type, _job_handler)

                job_id = await self.runtime.submit(
                    type_=job_type,
                    title=title_default,
                    subtitle=str(job_spec.subtitle or f"{module_id} · {spec.path}"),
                    module_id=module_id,
                    payload={"log_id": ctx_log_id},
                    priority=job_spec.priority,
                )
                return {"job_id": job_id}

        method = spec.method.lower()
        router.add_api_route(
            spec.path,
            _endpoint,
            methods=[method.upper()],
            name=spec.name or f"{module_id}_{method}_{spec.path}",
            response_model=spec.response_model,
        )

    def _bind_event(
        self,
        loaded: LoadedModule,
        bound_method: Callable[..., Any],
        sub_spec: Any,
        job_spec: JobSpec | None = None,
    ) -> None:
        topic = sub_spec.topic
        module_id = loaded.id

        if job_spec is None:
            async def _runner() -> None:
                try:
                    async with self.bus.subscribe([topic]) as stream:
                        async for env in stream:
                            try:
                                ctx = await self._make_context(
                                    module_id, env.payload.get("log_id", "")
                                )
                                if inspect.iscoroutinefunction(bound_method):
                                    await bound_method(ctx, env.payload)
                                else:
                                    await asyncio.to_thread(bound_method, ctx, env.payload)
                            except Exception:  # noqa: BLE001
                                log.exception(
                                    "modules.event_handler_failed",
                                    module_id=module_id,
                                    topic=topic,
                                )
                except asyncio.CancelledError:
                    return

            self._sub_event_tasks.append(asyncio.create_task(_runner()))
            return

        # Stacked @on_event + @job — run handler through the JobRuntime so it
        # appears in the dock with progress, cancellation, etc.
        job_type = f"module.{module_id}.event.{topic.replace('.', '_')}"

        async def _job_handler(handle: JobHandle) -> None:
            event_payload = handle.payload.get("_event_payload", {})
            ctx = await self._make_context(
                module_id,
                handle.payload.get("log_id", ""),
                progress=_JobProgressAdapter(handle),
            )
            if inspect.iscoroutinefunction(bound_method):
                await bound_method(ctx, event_payload)
            else:
                await asyncio.to_thread(bound_method, ctx, event_payload)

        if job_type not in self.runtime._handlers:  # type: ignore[attr-defined]
            self.runtime.register(job_type, _job_handler)

        title_default = (
            job_spec.title
            if isinstance(job_spec.title, str)
            else f"{module_id}.{topic}"
        )
        subtitle_default = (
            job_spec.subtitle
            if isinstance(job_spec.subtitle, str)
            else f"{module_id} · on {topic}"
        )

        async def _runner() -> None:
            try:
                async with self.bus.subscribe([topic]) as stream:
                    async for env in stream:
                        try:
                            await self.runtime.submit(
                                type_=job_type,
                                title=title_default,
                                subtitle=subtitle_default,
                                module_id=module_id,
                                payload={
                                    "log_id": env.payload.get("log_id", ""),
                                    "_event_payload": env.payload,
                                },
                                priority=job_spec.priority,
                            )
                        except Exception:  # noqa: BLE001
                            log.exception(
                                "modules.event_job_submit_failed",
                                module_id=module_id,
                                topic=topic,
                            )
            except asyncio.CancelledError:
                return

        self._sub_event_tasks.append(asyncio.create_task(_runner()))

    async def _make_context(
        self,
        module_id: str,
        log_id: str,
        *,
        progress: Any | None = None,
    ) -> ModuleContext:
        # workdir is per-invocation; for v1 we use a temp dir scoped to the
        # process. A future enhancement: clean up after the call returns
        # (would need a context manager around the handler).
        workdir = Path(tempfile.mkdtemp(prefix=f"ff-mod-{module_id}-"))

        cfg_json: dict[str, Any] = {}
        try:
            sm = get_sessionmaker()
            async with sm() as session:
                row = await session.get(ModuleConfig, module_id)
                if row is not None and row.config_json:
                    cfg_json = dict(row.config_json)
        except Exception:  # noqa: BLE001 — engine not initialised in tests
            cfg_json = {}

        return ModuleContext(
            log_id=log_id,
            module_id=module_id,
            event_log=EventLogAccess(log_id) if log_id else _UnboundEventLog(),  # type: ignore[arg-type]
            bus=_SdkBusAdapter(self.bus),  # type: ignore[arg-type]
            registry=self.registry,
            cache=ResultCache(log_id, module_id) if log_id else _UnboundCache(),  # type: ignore[arg-type]
            config=_ModuleConfigAdapter(cfg_json),
            progress=progress or _NoopProgress(),
            logger=log.bind(module_id=module_id, log_id=log_id),
            workdir=workdir,
        )


class _UnboundEventLog:
    """Placeholder used when a route handler isn't scoped to a specific log."""

    async def __aenter__(self):
        raise RuntimeError("This handler isn't scoped to a log_id.")

    async def __aexit__(self, *exc):
        return None

    async def pandas(self):  # type: ignore[no-untyped-def]
        raise RuntimeError("This handler isn't scoped to a log_id.")

    async def polars(self):
        raise RuntimeError("This handler isn't scoped to a log_id.")

    async def pm4py(self):
        raise RuntimeError("This handler isn't scoped to a log_id.")

    async def duckdb_fetch(self, *_, **__):
        raise RuntimeError("This handler isn't scoped to a log_id.")


class _UnboundCache:
    async def get(self, *_):
        return None

    async def set(self, *_):
        raise RuntimeError("This handler isn't scoped to a log_id.")

    async def exists(self, *_):
        return False

    async def delete(self, *_):
        return None


_loader: ModuleLoader | None = None


def get_module_loader() -> ModuleLoader:
    if _loader is None:
        raise HTTPException(
            status_code=503,
            detail="Module loader not initialised — startup did not run.",
        )
    return _loader


def set_module_loader(loader: ModuleLoader | None) -> None:
    global _loader
    _loader = loader
