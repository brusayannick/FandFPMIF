"""ModuleContext — the typed shape every entry point receives (§5.5).

The SDK only declares the *shape*. Concrete implementations live in
`flows_funds.api.modules.*` and are injected by the loader. Module code
should depend on these Protocols, not the implementations.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

import structlog


@runtime_checkable
class EventBusProtocol(Protocol):
    async def emit(self, topic: str, payload: Any) -> None: ...
    async def subscribe(self, *patterns: str) -> AsyncIterator[Any]: ...  # type: ignore[empty-body]


@runtime_checkable
class ModuleRegistryProtocol(Protocol):
    def has(self, capability_or_module_id: str) -> bool: ...
    async def call(self, capability: str, **kwargs: Any) -> Any: ...
    def installed_modules(self) -> list[str]: ...


@runtime_checkable
class ResultCacheProtocol(Protocol):
    async def get(self, key: str) -> Any: ...
    async def set(self, key: str, value: Any) -> None: ...
    async def exists(self, key: str) -> bool: ...
    async def delete(self, key: str) -> None: ...


@runtime_checkable
class ProgressReporterProtocol(Protocol):
    async def update(
        self,
        current: float,
        message: str | None = None,
        *,
        total: float | None = None,
        stage: str | None = None,
    ) -> None: ...


@runtime_checkable
class ModuleConfigProtocol(Protocol):
    @property
    def value(self) -> dict[str, Any]: ...
    def get(self, key: str, default: Any = None) -> Any: ...


@runtime_checkable
class EventLogAccessProtocol(Protocol):
    """Lazy view of the log under a given `log_id`. The async-context-manager
    pattern from §5.5 is what module authors actually use::

        async with ctx.event_log as log:
            df = await log.pandas()
            rows = await log.duckdb_fetch("SELECT activity, count(*) FROM events GROUP BY 1")
    """

    async def __aenter__(self) -> "EventLogAccessProtocol": ...
    async def __aexit__(self, *exc: object) -> None: ...

    async def pandas(self) -> Any: ...
    async def polars(self) -> Any: ...
    async def pm4py(self) -> Any: ...
    async def duckdb_fetch(self, sql: str, params: list | tuple | None = None) -> list[tuple]: ...


@dataclass
class ModuleContext:
    """The dependency-injected context every handler receives.

    Built by the loader per (log_id, module_id, invocation). For event
    handlers and route handlers without `log_id` (e.g. global routes), the
    `log_id` may be empty — module authors should treat it as optional.
    """

    log_id: str
    module_id: str
    event_log: EventLogAccessProtocol
    bus: EventBusProtocol
    registry: ModuleRegistryProtocol
    cache: ResultCacheProtocol
    config: ModuleConfigProtocol
    progress: ProgressReporterProtocol
    logger: structlog.BoundLogger
    workdir: Path
