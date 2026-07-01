"""Admin governance for the MCP server: live enable toggle + mint policy.

The ``/mcp`` app is mounted at boot when ``MCP_ENABLED`` is set, but an admin
can flip availability at runtime via a ``SystemSetting`` without a restart
(the middleware checks this per request and 503s when off). The mint policy
gates *who* may create PATs.
"""

from __future__ import annotations

import time
from typing import Literal

from sqlalchemy.ext.asyncio import AsyncSession

from mate.api.config import get_settings
from mate.api.db.models import SystemSetting

MCP_ENABLED_KEY = "mcp.enabled"
MCP_MINT_POLICY_KEY = "mcp.mint_policy"

MintPolicy = Literal["all_users", "admin_only", "disabled"]
_DEFAULT_MINT_POLICY: MintPolicy = "all_users"

# Short TTL cache for the live enable flag so it isn't a per-request DB read on
# the hot path (incl. unauthenticated traffic). An admin toggle takes effect
# within the TTL.
_ENABLED_TTL_SECONDS = 5.0
_enabled_cache: tuple[float, bool] | None = None


async def mcp_runtime_enabled() -> bool:
    """Effective availability: the boot flag AND the admin's live toggle.

    Absent setting → defaults to the boot flag, so turning on ``MCP_ENABLED``
    is enough out of the box; an admin can later force it off live.
    """
    if not get_settings().mcp_enabled:
        return False
    global _enabled_cache
    now = time.monotonic()
    if _enabled_cache is not None and now - _enabled_cache[0] < _ENABLED_TTL_SECONDS:
        return _enabled_cache[1]
    from mate.api.db.engine import get_sessionmaker

    sm = get_sessionmaker()
    async with sm() as session:
        row = await session.get(SystemSetting, MCP_ENABLED_KEY)
    value = True if (row is None or row.value_json is None) else bool(row.value_json)
    _enabled_cache = (now, value)
    return value


def reset_enabled_cache() -> None:  # pragma: no cover - test/admin helper
    global _enabled_cache
    _enabled_cache = None


async def get_mint_policy(session: AsyncSession) -> MintPolicy:
    row = await session.get(SystemSetting, MCP_MINT_POLICY_KEY)
    value = row.value_json if row is not None else None
    if value in ("all_users", "admin_only", "disabled"):
        return value  # type: ignore[return-value]
    return _DEFAULT_MINT_POLICY


def may_mint(policy: MintPolicy, is_admin: bool) -> bool:
    if policy == "disabled":
        return False
    if policy == "admin_only":
        return is_admin
    return True
