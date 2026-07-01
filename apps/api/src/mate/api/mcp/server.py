"""The Mate MCP server: read-only tools over a user's process-mining output.

Every call resolves the caller from the authenticated :class:`MCPPrincipal` that
[auth.MCPAuthMiddleware](auth.py) stashed on the ASGI scope - ``user_id`` is
never a tool argument, so a token only ever reads its owner's data (the platform
tenant invariant). Each tool goes through :func:`_authz` (scope + egress consent)
then :func:`_guarded` (concurrency cap + timeout + metrics + audit), and reuses
the existing data-access functions rather than re-querying.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable
from typing import Any

from fastapi import HTTPException
from mcp.server.fastmcp import Context, FastMCP
from sqlalchemy.ext.asyncio import AsyncSession

from mate.api.auth import get_owned_event_log
from mate.api.config import get_settings
from mate.api.db.engine import get_sessionmaker
from mate.api.mcp import audit, metrics
from mate.api.mcp.auth import SCOPE_PRINCIPAL_KEY, MCPPrincipal
from mate.api.mcp.consent import egress_consented
from mate.api.mcp.limits import concurrency_gate
from mate.api.mcp.scopes import SCOPE_MODULES_READ, SCOPE_PROCESSES_READ

MCP_SERVER_VERSION = "1.0"
_MAX_OUTPUT_BYTES = 200_000

_INSTRUCTIONS = (
    "Read-only access to the authenticated user's Mate process-mining outputs. "
    "Call list_processes to discover event logs (use their id as log_id), "
    "list_modules to see which analyses have results for a log, then "
    "get_module_output / get_process_overview (or the curated get_bottlenecks / "
    "get_conformance / get_process_model / get_drifts) to read the findings. "
    "All outputs are curated summaries - never raw event rows."
)

MCPContext = Context[Any, Any, Any]

# ``streamable_http_path="/"`` so the app serves at its mount root; FastMCP's
# default ("/mcp") would double-prefix to /mcp/mcp when mounted at /mcp.
mcp = FastMCP("Mate", instructions=_INSTRUCTIONS, streamable_http_path="/")


# ── principal / authz / guard ───────────────────────────────────────────────


def _principal(ctx: MCPContext) -> MCPPrincipal:
    request = ctx.request_context.request
    p = request.scope.get(SCOPE_PRINCIPAL_KEY) if request is not None else None
    if not isinstance(p, MCPPrincipal):
        raise ValueError("Unauthenticated MCP call.")
    return p


async def _authz(ctx: MCPContext, required_scope: str) -> MCPPrincipal:
    """Resolve the caller and enforce scope + egress consent."""
    p = _principal(ctx)
    if required_scope not in p.scopes:
        raise ValueError(f"This token lacks the required scope: {required_scope}")
    if not await egress_consented(p.user.id):
        raise ValueError(
            "External data access is not enabled for your account. "
            "Enable it in Settings → API & MCP."
        )
    return p


async def _guarded(
    principal: MCPPrincipal, tool: str, labels: dict[str, Any], coro: Awaitable[Any]
) -> Any:
    """Run a tool body under the concurrency cap + timeout, recording metrics + audit."""
    loop = asyncio.get_event_loop()
    start = loop.time()
    status = "ok"
    metrics.inc_active()

    async def _acquire_and_run() -> Any:
        # Acquire the concurrency slots *inside* the timeout so a saturated pool
        # fails fast instead of queueing unbounded (cross-user head-of-line).
        async with concurrency_gate(principal.user.id):
            return await coro

    try:
        return await asyncio.wait_for(
            _acquire_and_run(), timeout=get_settings().mcp_tool_timeout_seconds
        )
    except TimeoutError as exc:
        status = "timeout"
        raise ValueError(f"Tool '{tool}' timed out or the server is busy.") from exc
    except Exception:
        status = "error"
        raise
    finally:
        metrics.dec_active()
        duration = loop.time() - start
        metrics.record_tool_call(tool, status, duration)
        await audit.record_tool_call(
            user_id=principal.user.id,
            tool=tool,
            status=status,
            duration_ms=int(duration * 1000),
            token_id=principal.token_id,
            auth_type=principal.auth_type,
            labels=labels,
        )


async def _ensure_owned(session: AsyncSession, log_id: str, user_id: str) -> None:
    try:
        await get_owned_event_log(session, log_id, user_id)
    except HTTPException as exc:
        raise ValueError(str(exc.detail)) from exc


def _cap(obj: Any) -> Any:
    """Bound a tool's serialized output so one call can't return an unbounded blob."""
    raw = json.dumps(obj, default=str)
    if len(raw) <= _MAX_OUTPUT_BYTES:
        return obj
    return {
        "truncated": True,
        "reason": f"output exceeded {_MAX_OUTPUT_BYTES} bytes",
        "preview": raw[:_MAX_OUTPUT_BYTES],
    }


# ── shared impls ────────────────────────────────────────────────────────────


async def _module_output(user_id: str, log_id: str, module_id: str) -> dict[str, Any]:
    from mate.api.db.models import ModuleInstall
    from mate.api.routes.ai_guidance import build_payload

    sm = get_sessionmaker()
    async with sm() as session:
        await _ensure_owned(session, log_id, user_id)
        # Per-user module gating: a loaded module the caller hasn't installed is
        # not theirs to read (module_installs ref-counts ownership).
        if await session.get(ModuleInstall, (user_id, module_id)) is None:
            raise ValueError(f"Module '{module_id}' is not installed for your account.")
    try:
        payload, _system, _prefix = await build_payload(module_id, log_id, user_id)
    except HTTPException as exc:
        raise ValueError(str(exc.detail)) from exc
    return _cap({"log_id": log_id, "module_id": module_id, "output": payload})


# ── generic tools ───────────────────────────────────────────────────────────


@mcp.tool()
async def list_processes(ctx: MCPContext, limit: int = 50, offset: int = 0) -> list[dict[str, Any]]:
    """List your ready event logs (processes) with row-level stats.

    Returns id, name, log_model and case/event/variant counts. Use a returned
    id as the ``log_id`` for the other tools. ``limit``/``offset`` paginate.
    """
    p = await _authz(ctx, SCOPE_PROCESSES_READ)

    async def _impl() -> list[dict[str, Any]]:
        from mate.api.ai_nav import list_user_processes

        sm = get_sessionmaker()
        async with sm() as session:
            procs = await list_user_processes(session, p.user.id)
        start = max(0, offset)
        end = start + max(1, min(limit, 200))
        return [pr.model_dump() for pr in procs[start:end]]

    return await _guarded(p, "list_processes", {}, _impl())


@mcp.tool()
async def list_modules(ctx: MCPContext, log_id: str) -> list[dict[str, str]]:
    """List analysis modules that have consumable output for a process."""
    p = await _authz(ctx, SCOPE_MODULES_READ)

    async def _impl() -> list[dict[str, str]]:
        from mate.api.modules import get_module_loader
        from mate.api.routes.ai_guidance import enabled_modules_with_guidance

        sm = get_sessionmaker()
        async with sm() as session:
            await _ensure_owned(session, log_id, p.user.id)
            module_ids = await enabled_modules_with_guidance(session, p.user.id)
        loader = get_module_loader()
        out: list[dict[str, str]] = []
        for mid in module_ids:
            loaded = loader.loaded.get(mid)
            man = loaded.manifest if loaded is not None else None
            out.append(
                {
                    "module_id": mid,
                    "name": getattr(man, "name", mid) or mid,
                    "description": getattr(man, "description", "") or "",
                }
            )
        return out

    return await _guarded(p, "list_modules", {"log_id": log_id}, _impl())


@mcp.tool()
async def get_module_output(ctx: MCPContext, log_id: str, module_id: str) -> dict[str, Any]:
    """Get one module's curated analytical output for a process (no raw event rows)."""
    p = await _authz(ctx, SCOPE_MODULES_READ)
    return await _guarded(
        p,
        "get_module_output",
        {"log_id": log_id, "module_id": module_id},
        _module_output(p.user.id, log_id, module_id),
    )


@mcp.tool()
async def get_process_overview(ctx: MCPContext, log_id: str) -> dict[str, Any]:
    """Curated outputs from every guidance-capable module for a process."""
    p = await _authz(ctx, SCOPE_MODULES_READ)

    async def _impl() -> dict[str, Any]:
        from mate.api.routes.ai_guidance import build_payload, enabled_modules_with_guidance

        sm = get_sessionmaker()
        async with sm() as session:
            await _ensure_owned(session, log_id, p.user.id)
            module_ids = await enabled_modules_with_guidance(session, p.user.id)
        composite: dict[str, Any] = {}
        for mid in module_ids:
            try:
                payload, _system, _prefix = await build_payload(mid, log_id, p.user.id)
            except HTTPException:
                continue
            composite[mid] = payload
        return _cap({"log_id": log_id, "modules": composite})

    return await _guarded(p, "get_process_overview", {"log_id": log_id}, _impl())


# ── curated per-domain tools (thin, friendlier intent over get_module_output) ─


@mcp.tool()
async def get_bottlenecks(ctx: MCPContext, log_id: str) -> dict[str, Any]:
    """Performance KPIs + the top bottleneck activities for a process."""
    p = await _authz(ctx, SCOPE_MODULES_READ)
    return await _guarded(
        p, "get_bottlenecks", {"log_id": log_id}, _module_output(p.user.id, log_id, "performance")
    )


@mcp.tool()
async def get_conformance(ctx: MCPContext, log_id: str) -> dict[str, Any]:
    """Conformance fitness/precision + per-activity deviations vs the reference model."""
    p = await _authz(ctx, SCOPE_MODULES_READ)
    return await _guarded(
        p, "get_conformance", {"log_id": log_id}, _module_output(p.user.id, log_id, "conformance")
    )


@mcp.tool()
async def get_process_model(ctx: MCPContext, log_id: str) -> dict[str, Any]:
    """The discovered process-model overview (activities, paths) for a process."""
    p = await _authz(ctx, SCOPE_MODULES_READ)
    return await _guarded(
        p, "get_process_model", {"log_id": log_id}, _module_output(p.user.id, log_id, "discovery")
    )


@mcp.tool()
async def get_drifts(ctx: MCPContext, log_id: str) -> dict[str, Any]:
    """Detected concept drifts (type, time window, confidence) for a process."""
    p = await _authz(ctx, SCOPE_MODULES_READ)
    return await _guarded(
        p, "get_drifts", {"log_id": log_id}, _module_output(p.user.id, log_id, "cv4cdd")
    )


@mcp.tool()
async def get_server_info(ctx: MCPContext) -> dict[str, Any]:
    """Server version + the scopes your token holds (tool-contract version)."""
    p = _principal(ctx)
    return {
        "name": "Mate",
        "version": MCP_SERVER_VERSION,
        "auth_type": p.auth_type,
        "scopes": list(p.scopes),
    }


# ── resources (read-without-tool-call) ──────────────────────────────────────


@mcp.resource("mate://processes")
async def processes_resource() -> str:
    """The caller's processes as a JSON resource. Auth is enforced by the
    transport middleware; the principal rides the request context."""
    ctx = mcp.get_context()
    p = await _authz(ctx, SCOPE_PROCESSES_READ)  # type: ignore[arg-type]
    from mate.api.ai_nav import list_user_processes

    sm = get_sessionmaker()
    async with sm() as session:
        procs = await list_user_processes(session, p.user.id)
    return json.dumps([pr.model_dump() for pr in procs], default=str)


@mcp.resource("mate://process/{log_id}/module/{module_id}")
async def module_output_resource(log_id: str, module_id: str) -> str:
    """One module's curated output as a JSON resource."""
    ctx = mcp.get_context()
    p = await _authz(ctx, SCOPE_MODULES_READ)  # type: ignore[arg-type]
    return json.dumps(await _module_output(p.user.id, log_id, module_id), default=str)


def build_mcp_app():
    """Build the streamable-HTTP ASGI app (also creates ``mcp.session_manager``)."""
    return mcp.streamable_http_app()
