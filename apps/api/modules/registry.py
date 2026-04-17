from __future__ import annotations

from fastapi import FastAPI

from modules.base import AbstractModule
from schemas.graph import GraphSchema
from schemas.process import ModuleManifest


class ModuleRegistry:
    """Singleton-ish registry of installed modules.

    A module is registered by calling :meth:`register` with an instance of a
    class inheriting :class:`AbstractModule`. :meth:`mount_all` then mounts all
    modules' routers at ``/api/v1/modules/{module_id}`` on a FastAPI app.
    """

    def __init__(self) -> None:
        self._modules: dict[str, AbstractModule] = {}

    def register(self, module: AbstractModule) -> None:
        if module.module_id in self._modules:
            raise ValueError(f"Module {module.module_id!r} already registered")
        self._modules[module.module_id] = module

    def get(self, module_id: str) -> AbstractModule | None:
        return self._modules.get(module_id)

    def all(self) -> list[AbstractModule]:
        return list(self._modules.values())

    def mount_all(self, app: FastAPI, *, api_prefix: str = "/api/v1") -> None:
        for module_id, module in self._modules.items():
            router = module.get_router()
            app.include_router(
                router,
                prefix=f"{api_prefix}/modules/{module_id}",
                tags=[module.display_name],
            )
            try:
                module.on_startup()
            except Exception:  # pragma: no cover
                pass

    def list_manifests(self) -> list[ModuleManifest]:
        manifests: list[ModuleManifest] = []
        for module in self._modules.values():
            schema: dict | None
            try:
                schema = module.get_config_schema().model_json_schema()
            except Exception:
                schema = None
            manifests.append(
                ModuleManifest(
                    module_id=module.module_id,
                    display_name=module.display_name,
                    version=module.version,
                    description=module.description,
                    config_schema=schema,
                )
            )
        return manifests

    def notify_graph_update(self, graph: GraphSchema) -> None:
        for module in self._modules.values():
            try:
                module.on_graph_update(graph)
            except Exception:  # pragma: no cover
                pass


registry = ModuleRegistry()
