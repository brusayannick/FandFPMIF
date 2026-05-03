"""Capability registry — typed RPC over module `provides`/`consumes` (§5.7)."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import structlog

log = structlog.get_logger(__name__)


@dataclass
class _Capability:
    module_id: str
    handler: Callable[..., Awaitable[Any]]


class CapabilityRegistry:
    """Maps capability ids (e.g. ``kpi.throughput``) → handler.

    Module loaders register capabilities via :meth:`register`. Module code
    invokes them through :meth:`call`. The registry validates declared
    consumes against `provides` at startup so missing-dep bugs surface
    explicitly.
    """

    def __init__(self) -> None:
        self._caps: dict[str, _Capability] = {}
        self._modules: set[str] = set()

    def add_module(self, module_id: str) -> None:
        self._modules.add(module_id)

    def remove_module(self, module_id: str) -> None:
        self._modules.discard(module_id)
        for key in [k for k, c in self._caps.items() if c.module_id == module_id]:
            del self._caps[key]

    def register(
        self,
        module_id: str,
        capability: str,
        handler: Callable[..., Awaitable[Any]],
    ) -> None:
        if capability in self._caps:
            raise RuntimeError(
                f"Capability {capability!r} already provided by module "
                f"{self._caps[capability].module_id!r}; conflict from {module_id!r}."
            )
        self._caps[capability] = _Capability(module_id=module_id, handler=handler)

    def has(self, capability_or_module_id: str) -> bool:
        return capability_or_module_id in self._caps or capability_or_module_id in self._modules

    def installed_modules(self) -> list[str]:
        return sorted(self._modules)

    async def call(self, capability: str, **kwargs: Any) -> Any:
        cap = self._caps.get(capability)
        if cap is None:
            raise LookupError(
                f"Capability {capability!r} is not provided by any loaded module."
            )
        return await cap.handler(**kwargs)
