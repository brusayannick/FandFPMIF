"""`WS /api/v1/events` — topic-filtered platform-wide stream (§7.9.5).

Query params:

  - `topic` (repeatable) — bus pattern(s) to subscribe to. Defaults to `*`.
    Examples: `?topic=job.*`, `?topic=job.completed&topic=job.failed`.
  - `token` — Keycloak access token (browsers can't set custom WS headers).

The frontend uses one of these per session for toasts + drawer updates; the
high-frequency per-job feed is the separate `WS /jobs/{id}/stream` next door.

Envelopes whose payload carries a ``user_id`` distinct from the connected
user's are filtered out — that's how per-user isolation is enforced.
"""

from __future__ import annotations

import contextlib
import json
import logging
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect

from flows_funds.api.auth import get_current_user_from_token
from flows_funds.api.db.engine import get_sessionmaker
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

    token = ws.query_params.get("token", "")
    if not token:
        await ws.close(code=4401, reason="missing token")
        return

    sm = get_sessionmaker()
    async with sm() as session:
        try:
            user = await get_current_user_from_token(token, session)
            await session.commit()
        except HTTPException:
            await ws.close(code=4401, reason="invalid token")
            return

    try:
        async with bus.subscribe(topic) as stream:
            async for env in stream:
                # Filter cross-user events. System-emitted envelopes (no
                # `user_id` in payload) are always forwarded — they're
                # operator-level, never user data.
                env_user = env.payload.get("user_id") if isinstance(env.payload, dict) else None
                if env_user is not None and env_user != user.id:
                    continue
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
