from __future__ import annotations

from flows_funds.sdk import Module, ModuleContext, on_event, route


_received: list[dict] = []
_last_called_path: list[str] = []


def get_received() -> list[dict]:
    return list(_received)


def get_calls() -> list[str]:
    return list(_last_called_path)


class SampleModule(Module):
    id = "sample_mod"

    @route.get("/ping")
    async def ping(self, ctx: ModuleContext) -> dict[str, str]:
        _last_called_path.append("ping")
        return {"module_id": ctx.module_id, "status": "pong"}

    @on_event("test.shout")
    async def on_shout(self, ctx: ModuleContext, payload: dict) -> None:
        _received.append(payload)
