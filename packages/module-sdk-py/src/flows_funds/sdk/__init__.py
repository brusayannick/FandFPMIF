"""Public SDK surface for Flows & Funds module authors.

A module author writes:

    from flows_funds.sdk import Module, ModuleContext, on_event, route, job

    class MyModule(Module):
        id = "my_module"

        @route.get("/things")
        async def list_things(self, ctx: ModuleContext): ...

        @on_event("log.imported")
        async def on_log(self, ctx: ModuleContext, payload): ...

        @route.post("/heavy")
        @job(progress=True, title="Heavy compute")
        async def heavy(self, ctx: ModuleContext): ...

The decorators only attach metadata; the platform's module loader (in
``flows_funds.api.modules``) reads it at startup and binds the right
machinery — there is no SDK-side runtime.
"""

from flows_funds.sdk.context import (
    EventBusProtocol,
    EventLogAccessProtocol,
    ModuleConfigProtocol,
    ModuleContext,
    ModuleRegistryProtocol,
    ProgressReporterProtocol,
    ResultCacheProtocol,
)
from flows_funds.sdk.decorators import job, on_event, route
from flows_funds.sdk.errors import ModuleError, ModuleManifestError
from flows_funds.sdk.manifest import (
    DependenciesPython,
    Manifest,
    ManifestFrontend,
    ModuleCategory,
    OptionalModuleDep,
    Requirements,
    EventLogRequirements,
)
from flows_funds.sdk.module import Module

__version__ = "0.1.0"

__all__ = [
    "DependenciesPython",
    "EventBusProtocol",
    "EventLogAccessProtocol",
    "EventLogRequirements",
    "Manifest",
    "ManifestFrontend",
    "Module",
    "ModuleConfigProtocol",
    "ModuleContext",
    "ModuleCategory",
    "ModuleError",
    "ModuleManifestError",
    "ModuleRegistryProtocol",
    "OptionalModuleDep",
    "ProgressReporterProtocol",
    "Requirements",
    "ResultCacheProtocol",
    "job",
    "on_event",
    "route",
]
