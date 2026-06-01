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
import shutil
import sys
import tempfile
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, get_type_hints

import structlog
from fastapi import APIRouter, FastAPI, HTTPException
from pydantic import BaseModel

from flows_funds.api.auth import CurrentUser, CurrentUserDep
from flows_funds.api.db.engine import get_sessionmaker
from flows_funds.api.db.models import ModuleConfig
from flows_funds.api.events import EventBus
from flows_funds.api.jobs.runtime import JobHandle, JobRuntime
from flows_funds.api.modules.availability import Availability
from flows_funds.api.modules.availability import evaluate as evaluate_availability
from flows_funds.api.modules.cache import ResultCache
from flows_funds.api.modules.discovery import DiscoveredModule, discover, topo_sort
from flows_funds.api.modules.event_log_access import EventLogAccess
from flows_funds.api.modules.finder import get_finder, module_namespace, reset_finder
from flows_funds.api.modules.installer import install_module
from flows_funds.api.modules.installs import user_module_ids, user_owns_module
from flows_funds.api.modules.registry import CapabilityRegistry
from flows_funds.api.modules.subprocess_host import SubprocessBridge
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
    """Bridge `flows_funds.sdk.context.EventBusProtocol` over our EventBus.

    Every emitted payload is stamped with the owning user's id (and the active
    log id) so the event stays inside that user's tenant: the `WS /events`
    fan-out filters by `user_id`, and the loader's `@on_event` dispatch only
    delivers to handlers whose owning user matches. Without this stamp a module
    that emits an event would broadcast it to *every* connected user — a
    cross-tenant leak of whatever the payload carries.
    """

    def __init__(self, bus: EventBus, user_id: str, log_id: str = "") -> None:
        self._bus = bus
        self._user_id = user_id
        self._log_id = log_id

    async def emit(self, topic: str, payload: Any) -> None:
        if hasattr(payload, "model_dump"):
            payload = payload.model_dump()
        elif not isinstance(payload, dict):
            payload = {"value": payload}
        else:
            payload = dict(payload)
        # `user_id` is a reserved routing key — force it to the emitting user so
        # a module can't (by bug or by design) address another tenant. `log_id`
        # is a hint, so only fill it when the module didn't set one itself.
        payload["user_id"] = self._user_id
        if self._log_id:
            payload.setdefault("log_id", self._log_id)
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


class _BusForwardingLogger:
    """Wraps a structlog `BoundLogger` so every log call also fans out to the
    event bus as `module.log.<level>` — the per-module logs tail in Settings
    (§7.6.2) subscribes to that topic and filters by payload.module_id.

    We keep the structlog output too so server-side log aggregators stay
    untouched.
    """

    def __init__(self, base, bus: EventBus, module_id: str, user_id: str) -> None:
        self._base = base
        self._bus = bus
        self._module_id = module_id
        self._user_id = user_id

    def bind(self, **kwargs: Any) -> "_BusForwardingLogger":
        return _BusForwardingLogger(
            self._base.bind(**kwargs), self._bus, self._module_id, self._user_id
        )

    def _emit(self, level: str, event: str, **kwargs: Any) -> None:
        getattr(self._base, level)(event, **kwargs)
        # Best-effort: never let a logging side-effect break the handler.
        # `user_id` scopes the line to the owning tenant — the Settings logs
        # tail subscribes to `module.log.*` over the per-user WS, so without it
        # one user would see another's log fields (which can embed their data).
        try:
            asyncio.create_task(
                self._bus.publish(
                    f"module.log.{level}",
                    {
                        "module_id": self._module_id,
                        "user_id": self._user_id,
                        "event": event,
                        "fields": kwargs,
                    },
                )
            )
        except Exception:  # noqa: BLE001
            pass

    def debug(self, event: str, **kw: Any) -> None:
        self._emit("debug", event, **kw)

    def info(self, event: str, **kw: Any) -> None:
        self._emit("info", event, **kw)

    def warning(self, event: str, **kw: Any) -> None:
        self._emit("warning", event, **kw)

    def error(self, event: str, **kw: Any) -> None:
        self._emit("error", event, **kw)

    def exception(self, event: str, **kw: Any) -> None:
        self._emit("error", event, exc_info=True, **kw)


class _UserScopedRegistry:
    """Per-invocation view of the process-global `CapabilityRegistry`.

    The underlying registry holds every module loaded into the process —
    shared across all tenants. This view filters it down to the modules the
    *owning user* has installed, so cross-module RPC (`ctx.registry.call`),
    capability probing (`has`) and listing (`installed_modules`) can never
    reach a module another tenant installed. Module code only ever talks to
    its own user's modules.
    """

    def __init__(self, registry: CapabilityRegistry, allowed_module_ids: frozenset[str]) -> None:
        self._registry = registry
        self._allowed = allowed_module_ids

    def has(self, capability_or_module_id: str) -> bool:
        if capability_or_module_id in self._allowed:
            return True
        owner = self._registry.owner_of(capability_or_module_id)
        return owner is not None and owner in self._allowed

    def installed_modules(self) -> list[str]:
        return sorted(m for m in self._registry.installed_modules() if m in self._allowed)

    async def call(self, capability: str, **kwargs: Any) -> Any:
        owner = self._registry.owner_of(capability)
        if owner is None or owner not in self._allowed:
            # Same message whether the capability is unknown or just not the
            # caller's — avoids leaking which modules other tenants installed.
            raise LookupError(
                f"Capability {capability!r} is not provided by any module you have installed."
            )
        return await self._registry.call(capability, **kwargs)


def _resolve_dynamic(
    value: Any, log_id: str, module_id: str, fallback: str
) -> str:
    """Resolve a `@job(title=...)` value that may be a callable.

    Authors can pass either a plain string or `(ctx_stub, payload) -> str`
    for runtime-formatted titles like *"Discovery — model.bpmn vs Order-to-
    Cash 2024"*. We feed the callable a minimal stub instead of the real
    ModuleContext (which doesn't exist yet at submission time — the job
    hasn't run) and the in-flight payload.
    """
    if value is None or isinstance(value, str):
        return str(value) if isinstance(value, str) else fallback
    if not callable(value):
        return fallback
    ctx_stub = {"log_id": log_id, "module_id": module_id}
    payload = {"log_id": log_id, "module_id": module_id}
    try:
        out = value(ctx_stub, payload)
        return str(out) if out is not None else fallback
    except Exception:  # noqa: BLE001
        log.exception("modules.job.dynamic_title_failed", module_id=module_id)
        return fallback


def _extra_handler_params(bound_method: Callable[..., Any]) -> list[inspect.Parameter]:
    """Return a handler's parameters after `ctx`.

    The first param of every module handler is `ctx: ModuleContext`, which the
    loader supplies; everything after is forwarded from FastAPI's query string.

    Modules typically use `from __future__ import annotations`, which turns
    every annotation into a string. We resolve them via `get_type_hints` so
    FastAPI sees real classes (notably `UploadFile`, which it auto-detects as
    a form/file param only when it's a real type — a string `'UploadFile'`
    annotation silently degrades to a query param and the file arrives None.
    """
    try:
        sig = inspect.signature(bound_method)
    except (TypeError, ValueError):
        return []
    params = list(sig.parameters.values())
    if not params:
        return []
    try:
        hints = get_type_hints(
            bound_method.__func__ if hasattr(bound_method, "__func__") else bound_method,
            include_extras=True,
        )
    except Exception:  # noqa: BLE001
        hints = {}
    # `bound_method` is a bound instance method, so `self` is already removed.
    # Skip the first param (`ctx`) — what remains are the user kwargs.
    resolved: list[inspect.Parameter] = []
    for p in params[1:]:
        if p.name in hints:
            resolved.append(p.replace(annotation=hints[p.name]))
        else:
            resolved.append(p)
    return resolved


def _build_endpoint_signature(extras: list[inspect.Parameter]) -> inspect.Signature:
    """Build a FastAPI-friendly signature: `log_id` + auth + any forwarded kwargs.

    ``__ff_user`` is the Keycloak-validated user, injected via
    ``CurrentUserDep`` so module routes inherit auth without each module having
    to wire it up. The endpoint pops it out of kwargs before forwarding.
    """
    log_id_param = inspect.Parameter(
        "log_id",
        kind=inspect.Parameter.KEYWORD_ONLY,
        default=None,
        annotation=str | None,
    )
    user_param = inspect.Parameter(
        "__ff_user",
        kind=inspect.Parameter.KEYWORD_ONLY,
        default=inspect.Parameter.empty,
        annotation=CurrentUserDep,
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
    return inspect.Signature(parameters=[log_id_param, user_param, *forwarded])


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
        uploaded_modules_dir: Path | None = None,
        api_app: FastAPI | None = None,
    ) -> None:
        self.modules_dir = modules_dir
        # User uploads live in their own persistent root so they never mix with
        # or clobber the repo defaults. Falls back to a sibling of modules_dir
        # when not supplied (kept optional for tests / older call sites).
        self.uploaded_modules_dir = (
            uploaded_modules_dir
            if uploaded_modules_dir is not None
            else modules_dir.parent / "uploaded_modules"
        )
        self.bus = bus
        self.runtime = runtime
        self.registry = registry
        self.api_app = api_app
        self.loaded: dict[str, LoadedModule] = {}
        # Ids discovered under ``modules_dir`` at boot — the shared "default"
        # set every user is seeded with. Uploads added later via ``load_one``
        # must never land here, so it is only ever populated in ``load_all``.
        self.default_module_ids: set[str] = set()
        self._mount_router: APIRouter | None = None
        self._sub_event_tasks: list[asyncio.Task] = []
        self._bridges: dict[str, SubprocessBridge] = {}

    async def load_all(self) -> list[LoadedModule]:
        discovered = discover(self.modules_dir, self.uploaded_modules_dir)
        # Snapshot which ids are repo defaults by *root* (not manifest source):
        # an upload already present on disk at boot must not be mistaken for a
        # default just because it discovers as "filesystem".
        defaults_root = self.modules_dir.resolve()
        self.default_module_ids = {
            d.id
            for d in discovered
            if d.folder.resolve().is_relative_to(defaults_root)
        }
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
            except Exception as exc:
                log.exception("modules.loader.install_failed", module_id=d.id, error=str(exc))
                continue

            try:
                instance = await self._instantiate(d)
            except Exception as exc:
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

        for bridge in self._bridges.values():
            try:
                await bridge.stop()
            except Exception:  # noqa: BLE001
                log.exception("modules.subprocess.stop_failed")
        self._bridges.clear()

        for loaded in self.loaded.values():
            self.registry.remove_module(loaded.id)
        self.loaded.clear()
        reset_finder()

    async def load_one(
        self,
        folder: Path,
        manifest: Manifest,
    ) -> LoadedModule:
        """Load (or reload) a single module post-startup."""
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
        instance = await self._instantiate(d)
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
        bridge = self._bridges.pop(module_id, None)
        if bridge is not None:
            try:
                await bridge.stop()
            except Exception:  # noqa: BLE001
                log.exception("modules.subprocess.stop_failed", module_id=module_id)
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
        """No-op since the multi-user migration.

        ``module_configs`` is now keyed by ``(user_id, module_id)`` — seeding
        without a user_id would either leave the row orphaned or require
        materialising defaults for every existing user. Instead, routes
        treat "no row" as ``enabled = manifest.default_enabled`` (see
        ``routes/modules.py`` GET ``/config`` and ``_make_context`` below).
        Kept around so existing call sites still link.
        """
        return None

    def manifests(self) -> list[Manifest]:
        return [m.manifest for m in self.loaded.values()]

    def availability_for(
        self,
        *,
        detected_schema: dict[str, Any] | None,
        events_count: int | None,
        cases_count: int | None,
        installed_module_ids: set[str] | None = None,
    ) -> dict[str, Availability]:
        # Resolve hard/soft module requirements against *this user's* installed
        # set, not every module loaded in the process. Otherwise a module would
        # show "available" because its dependency happens to be loaded for some
        # other tenant, even though the current user never installed it.
        ids = (
            installed_module_ids
            if installed_module_ids is not None
            else {m.id for m in self.loaded.values()}
        )
        return {
            m.id: evaluate_availability(
                m.manifest,
                detected_schema=detected_schema,
                events_count=events_count,
                cases_count=cases_count,
                installed_module_ids=ids,
            )
            for m in self.loaded.values()
            if installed_module_ids is None or m.id in ids
        }

    # -- internal -----------------------------------------------------------

    async def _instantiate(self, d: DiscoveredModule) -> Module:
        """Build a `Module` instance — either in-process or via a subprocess
        bridge depending on the manifest's `isolation` setting (§5.4)."""
        if d.manifest.dependencies.python.isolation == "subprocess":
            bridge = SubprocessBridge(d.manifest, d.folder)
            instance = await bridge.start()
            self._bridges[d.id] = bridge
        else:
            instance = self._import_module_class(d)
        # Pick up any Pydantic event schemas the module ships (§5.7a). Done
        # post-instantiate so the in-process import side effects have run.
        self._register_module_events(d)
        return instance

    def _register_module_events(self, d: DiscoveredModule) -> None:
        """Optionally import `<folder>/events.py` and register its
        `EVENT_SCHEMAS: dict[str, type[BaseModel]]` mapping on the bus.

        Modules without an `events.py` are silently skipped — schema
        enforcement is opt-in. A malformed `EVENT_SCHEMAS` value logs a
        warning but does not abort the module load.
        """
        events_path = d.folder / "events.py"
        if not events_path.exists():
            return
        ns = f"{module_namespace(d.id)}.events"
        try:
            spec = importlib.util.spec_from_file_location(ns, events_path)
            if spec is None or spec.loader is None:
                return
            mod = importlib.util.module_from_spec(spec)
            sys.modules[ns] = mod
            spec.loader.exec_module(mod)
        except Exception:  # noqa: BLE001
            log.exception("modules.events.import_failed", module_id=d.id)
            return
        schemas = getattr(mod, "EVENT_SCHEMAS", None)
        if not isinstance(schemas, dict):
            return
        from pydantic import BaseModel as _BaseModel
        for topic, model in schemas.items():
            if not (isinstance(topic, str) and isinstance(model, type) and issubclass(model, _BaseModel)):
                log.warning(
                    "modules.events.invalid_entry",
                    module_id=d.id,
                    topic=topic,
                )
                continue
            try:
                self.bus.register_schema(topic, model)
            except Exception:  # noqa: BLE001
                log.exception(
                    "modules.events.schema_conflict", module_id=d.id, topic=topic
                )

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
            async def _endpoint(**kwargs: Any) -> Any:
                log_id = kwargs.pop("log_id", None)
                user: CurrentUser = kwargs.pop("__ff_user")
                ctx = await self._make_context(module_id, log_id or "", user.id)
                return await self._invoke_handler(bound_method, ctx, **kwargs)

            _endpoint.__signature__ = _build_endpoint_signature(extras)  # type: ignore[attr-defined]
        else:
            static_title_default = (
                job_spec.title
                if isinstance(job_spec.title, str)
                else f"{module_id}.{spec.path.lstrip('/').replace('/', '.')}"
            )

            # Map of extra-arg name → annotation so the job runner can
            # re-hydrate Pydantic models from the serialized payload.
            extras_by_name = {p.name: p.annotation for p in extras}

            async def _endpoint(**kwargs: Any) -> dict[str, str]:  # type: ignore[misc]
                ctx_log_id = kwargs.pop("log_id", None) or ""
                user: CurrentUser = kwargs.pop("__ff_user")

                # Serialize forwarded args into the job payload. Pydantic
                # models dump to dicts; primitives pass through. This is the
                # bridge between the HTTP request (where FastAPI parses the
                # body) and the background job (which only has a JSON blob).
                serialized_extras: dict[str, Any] = {}
                for name, value in kwargs.items():
                    if isinstance(value, BaseModel):
                        serialized_extras[name] = value.model_dump(mode="json")
                    else:
                        serialized_extras[name] = value

                async def _job_handler(handle: JobHandle) -> None:
                    ctx = await self._make_context(
                        module_id,
                        handle.payload.get("log_id", ""),
                        handle.user_id,
                        progress=_JobProgressAdapter(handle),
                    )
                    raw = handle.payload.get("_extras") or {}
                    rebuilt: dict[str, Any] = {}
                    for name, value in raw.items():
                        ann = extras_by_name.get(name)
                        if (
                            isinstance(ann, type)
                            and issubclass(ann, BaseModel)
                            and isinstance(value, dict)
                        ):
                            rebuilt[name] = ann.model_validate(value)
                        else:
                            rebuilt[name] = value
                    await self._invoke_handler(bound_method, ctx, **rebuilt)

                # Register a one-shot handler under a unique type tag.
                job_type = f"module.{module_id}.{spec.path.lstrip('/').replace('/', '.') or 'root'}"
                if job_type not in self.runtime._handlers:  # type: ignore[attr-defined]
                    self.runtime.register(job_type, _job_handler)

                # Resolve callable title/subtitle at submission time (§5.6).
                # The author's callable receives a stub ctx-like dict + the
                # payload so it can format e.g. the log's display name into
                # the job toast.
                resolved_title = _resolve_dynamic(
                    job_spec.title, ctx_log_id, module_id, static_title_default
                )
                resolved_subtitle = _resolve_dynamic(
                    job_spec.subtitle,
                    ctx_log_id,
                    module_id,
                    f"{module_id} · {spec.path}",
                )

                job_id = await self.runtime.submit(
                    type_=job_type,
                    user_id=user.id,
                    title=resolved_title,
                    subtitle=resolved_subtitle,
                    module_id=module_id,
                    payload={"log_id": ctx_log_id, "_extras": serialized_extras},
                    priority=job_spec.priority,
                )
                return {"job_id": job_id}

            _endpoint.__signature__ = _build_endpoint_signature(extras)  # type: ignore[attr-defined]

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
                                event_user_id = env.payload.get("user_id")
                                if not event_user_id:
                                    # System events without user ownership are
                                    # only forwarded to module handlers that
                                    # don't need per-user paths.
                                    continue
                                # The bus is process-global, but a module must
                                # only react to events from users who installed
                                # it — otherwise user B's import would run user
                                # A's module against B's data.
                                if not await self._user_owns(event_user_id, module_id):
                                    continue
                                ctx = await self._make_context(
                                    module_id,
                                    env.payload.get("log_id", ""),
                                    event_user_id,
                                )
                                await self._invoke_handler(bound_method, ctx, env.payload)
                            except Exception:
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
                handle.user_id,
                progress=_JobProgressAdapter(handle),
            )
            await self._invoke_handler(bound_method, ctx, event_payload)

        if job_type not in self.runtime._handlers:  # type: ignore[attr-defined]
            self.runtime.register(job_type, _job_handler)

        static_title_default = f"{module_id}.{topic}"
        static_subtitle_default = f"{module_id} · on {topic}"

        async def _runner() -> None:
            try:
                async with self.bus.subscribe([topic]) as stream:
                    async for env in stream:
                        try:
                            log_id = env.payload.get("log_id", "")
                            event_user_id = env.payload.get("user_id")
                            if not event_user_id:
                                continue
                            # Only enqueue work for users who installed this
                            # module — see the no-job runner above.
                            if not await self._user_owns(event_user_id, module_id):
                                continue
                            resolved_title = _resolve_dynamic(
                                job_spec.title, log_id, module_id, static_title_default
                            )
                            resolved_subtitle = _resolve_dynamic(
                                job_spec.subtitle, log_id, module_id, static_subtitle_default
                            )
                            await self.runtime.submit(
                                type_=job_type,
                                user_id=event_user_id,
                                title=resolved_title,
                                subtitle=resolved_subtitle,
                                module_id=module_id,
                                payload={
                                    "log_id": log_id,
                                    "_event_payload": env.payload,
                                },
                                priority=job_spec.priority,
                            )
                        except Exception:
                            log.exception(
                                "modules.event_job_submit_failed",
                                module_id=module_id,
                                topic=topic,
                            )
            except asyncio.CancelledError:
                return

        self._sub_event_tasks.append(asyncio.create_task(_runner()))

    async def _invoke_handler(
        self,
        bound_method: Callable[..., Any],
        ctx: ModuleContext,
        *args: Any,
        **kwargs: Any,
    ) -> Any:
        # _make_context mkdtemps a fresh workdir per invocation; delete it
        # once the handler is done so per-call scratch space doesn't pile up
        # (§5.5 "workdir: scratch space, auto-cleaned on completion").
        try:
            if inspect.iscoroutinefunction(bound_method):
                return await bound_method(ctx, *args, **kwargs)
            return await asyncio.to_thread(bound_method, ctx, *args, **kwargs)
        finally:
            shutil.rmtree(ctx.workdir, ignore_errors=True)

    async def _user_owns(self, user_id: str, module_id: str) -> bool:
        """Whether *user_id* has *module_id* installed.

        Gate for the process-global event bus: a module subscribes once at
        load time but must only fire for events belonging to users who
        installed it. Failures fall closed (treat as not-owned) so a transient
        DB error never leaks one tenant's event into another's module.
        """
        try:
            sm = get_sessionmaker()
            async with sm() as session:
                return await user_owns_module(session, user_id, module_id)
        except Exception:  # noqa: BLE001
            log.exception("modules.ownership_check_failed", module_id=module_id)
            return False

    async def _make_context(
        self,
        module_id: str,
        log_id: str,
        user_id: str,
        *,
        progress: Any | None = None,
    ) -> ModuleContext:
        # workdir is per-invocation; for v1 we use a temp dir scoped to the
        # process. A future enhancement: clean up after the call returns
        # (would need a context manager around the handler).
        workdir = Path(tempfile.mkdtemp(prefix=f"ff-mod-{module_id}-"))

        cfg_json: dict[str, Any] = {}
        owned_ids: set[str] = set()
        try:
            sm = get_sessionmaker()
            async with sm() as session:
                row = await session.get(ModuleConfig, (user_id, module_id))
                if row is not None and row.config_json:
                    cfg_json = dict(row.config_json)
                # Modules this user has installed — scopes ctx.registry so
                # cross-module RPC can only reach the user's own modules.
                owned_ids = await user_module_ids(session, user_id)
        except Exception:
            cfg_json = {}

        return ModuleContext(
            log_id=log_id,
            module_id=module_id,
            user_id=user_id,
            event_log=EventLogAccess(log_id, user_id) if log_id else _UnboundEventLog(),  # type: ignore[arg-type]
            bus=_SdkBusAdapter(self.bus, user_id, log_id),  # type: ignore[arg-type]
            registry=_UserScopedRegistry(self.registry, frozenset(owned_ids)),  # type: ignore[arg-type]
            cache=ResultCache(log_id, module_id, user_id) if log_id else _UnboundCache(),  # type: ignore[arg-type]
            config=_ModuleConfigAdapter(cfg_json),
            progress=progress or _NoopProgress(),
            logger=_BusForwardingLogger(  # type: ignore[arg-type]
                log.bind(module_id=module_id, log_id=log_id, user_id=user_id),
                self.bus,
                module_id,
                user_id,
            ),
            workdir=workdir,
            run_in_process=self.runtime.run_in_process,  # type: ignore[arg-type]
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
