"""External-egress consent for MCP.

Mate's local-first ethos: data leaving the box to an external LLM client is an
explicit, revocable choice. When ``mcp_require_egress_consent`` is on (default),
a user must opt in (Settings → API & MCP) before any MCP tool returns their
data; tools 403 until then. Unlike the in-app MATE AI assistant (which shares
process *aggregates* by default), MCP egress stays consent-gated because it can
expose far more than rolled-up stats. [[project_ai_data_wall]]
"""

from __future__ import annotations

from mate.api.config import get_settings
from mate.api.db.engine import get_sessionmaker
from mate.api.db.models import UserSetting

MCP_EGRESS_CONSENT_KEY = "mcp.egress_consent"


async def egress_consented(user_id: str) -> bool:
    """True if this user may serve data over MCP (or consent isn't required)."""
    if not get_settings().mcp_require_egress_consent:
        return True
    sm = get_sessionmaker()
    async with sm() as session:
        row = await session.get(UserSetting, (user_id, MCP_EGRESS_CONSENT_KEY))
    return bool(row.value_json) if row is not None and row.value_json is not None else False
