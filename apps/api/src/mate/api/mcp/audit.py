"""Audit trail for MCP access.

The authoritative record is a structured log line emitted on **every** tool
call (and auth failure) - always, independent of the user's analytics opt-out -
so it ships to log aggregation / SIEM for compliance. A best-effort mirror into
the analytics stream feeds the admin insights UI (that one respects tracking
consent and never blocks the call).
"""

from __future__ import annotations

from typing import Any

import structlog

log = structlog.get_logger("mcp.audit")


async def record_tool_call(
    *,
    user_id: str,
    tool: str,
    status: str,
    duration_ms: int,
    token_id: str | None,
    auth_type: str,
    labels: dict[str, Any] | None = None,
) -> None:
    labels = labels or {}
    log.info(
        "mcp.tool_call",
        user_id=user_id,
        tool=tool,
        status=status,
        duration_ms=duration_ms,
        token_id=token_id,
        auth_type=auth_type,
        **labels,
    )
    try:
        from mate.api.db.engine import get_sessionmaker
        from mate.api.routes.analytics import record_server_event

        sm = get_sessionmaker()
        async with sm() as session:
            await record_server_event(
                session,
                user_id=user_id,
                event_type="mcp",
                event_name=tool,
                duration_ms=duration_ms,
                properties={
                    "status": status,
                    "token_id": token_id,
                    "auth_type": auth_type,
                    **labels,
                },
            )
    except Exception as exc:
        log.warning("mcp.audit.analytics_failed", error=str(exc))
