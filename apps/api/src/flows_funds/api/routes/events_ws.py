"""`WS /api/v1/events` — topic-filtered platform-wide stream (§7.9.5).

Query params:

  - `topic` (repeatable) — bus pattern(s) to subscribe to. Defaults to `*`.
    Examples: `?topic=job.*`, `?topic=job.completed&topic=job.failed`.

The frontend uses one of these per session for toasts + drawer updates; the
high-frequency per-job feed is the separate `WS /jobs/{id}/stream` next door.
"""

from __future__ import annotations

import contextlib
import json
import logging
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from flows_funds.api.events import get_event_bus

router = APIRouter(tags=["events"])


def _json_default(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


@router.websocket("/events")
async def stream_events(
    ws: WebSocket,
    topic: list[str] = Query(default_factory=lambda: ["*"]),
) -> None:
    await ws.accept()
    bus = get_event_bus()
    try:
        async with bus.subscribe(topic) as stream:
            async for env in stream:
                try:
                    await ws.send_text(json.dumps(env.to_json(), default=_json_default))
                except RuntimeError:
                    return
    except WebSocketDisconnect:
        return
    except Exception:  # noqa: BLE001
        logging.exception("ws_events.unhandled")
        with contextlib.suppress(Exception):
            await ws.close(code=1011)
