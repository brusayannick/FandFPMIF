"""OAuth-style scope taxonomy for MCP access.

Kept deliberately small and read-only. An empty grant means "all read scopes"
(back-compat for tokens minted before scoping). Tools declare the scope they
require; :func:`mate.api.mcp.server._authz` enforces it.
"""

from __future__ import annotations

from collections.abc import Iterable

SCOPE_PROCESSES_READ = "processes:read"
SCOPE_MODULES_READ = "modules:read"

ALL_SCOPES: tuple[str, ...] = (SCOPE_PROCESSES_READ, SCOPE_MODULES_READ)

SCOPE_DESCRIPTIONS: dict[str, str] = {
    SCOPE_PROCESSES_READ: "List your processes (event logs) and their stats.",
    SCOPE_MODULES_READ: "Read module analysis outputs for your processes.",
}


def sanitize_scopes(scopes: Iterable[str] | None) -> list[str]:
    """Keep only known scopes, de-duplicated and ordered. Drops the unknown."""
    if not scopes:
        return []
    seen = set(scopes)
    return [s for s in ALL_SCOPES if s in seen]


def effective_scopes(granted: Iterable[str] | None) -> tuple[str, ...]:
    """The scopes a principal actually has: an empty grant == all read scopes."""
    cleaned = sanitize_scopes(granted)
    return tuple(cleaned) if cleaned else ALL_SCOPES
