"""In-process rate limiting + concurrency for the MCP server (single instance).

A single-instance deployment (see DEPLOY.md) shares one process, so an
in-memory token-bucket per user and per-user/global semaphores are sufficient.
Horizontal scale-out would need a shared store - call that out before scaling.
"""

from __future__ import annotations

import asyncio
import time

from mate.api.config import get_settings

# Per-user token buckets: user_id -> (tokens, last_refill_monotonic).
_buckets: dict[str, tuple[float, float]] = {}

# Per-user concurrency gates (lazily created) + a global cap.
_user_sems: dict[str, asyncio.Semaphore] = {}
_global_sem: asyncio.Semaphore | None = None


def check_rate_limit(user_id: str) -> tuple[bool, int]:
    """Token-bucket admit check. Returns ``(allowed, retry_after_seconds)``.

    ``mcp_rate_limit_per_minute = 0`` disables limiting.
    """
    settings = get_settings()
    rate = settings.mcp_rate_limit_per_minute
    if rate <= 0:
        return True, 0
    burst = float(max(rate, settings.mcp_rate_limit_burst))
    refill_per_sec = rate / 60.0
    now = time.monotonic()
    tokens, last = _buckets.get(user_id, (burst, now))
    tokens = min(burst, tokens + (now - last) * refill_per_sec)
    if tokens >= 1.0:
        _buckets[user_id] = (tokens - 1.0, now)
        return True, 0
    _buckets[user_id] = (tokens, now)
    retry_after = max(1, int((1.0 - tokens) / refill_per_sec)) if refill_per_sec else 1
    return False, retry_after


def _user_semaphore(user_id: str) -> asyncio.Semaphore:
    sem = _user_sems.get(user_id)
    if sem is None:
        sem = asyncio.Semaphore(max(1, get_settings().mcp_max_concurrency_per_user))
        _user_sems[user_id] = sem
    return sem


def _global_semaphore() -> asyncio.Semaphore:
    global _global_sem
    if _global_sem is None:
        _global_sem = asyncio.Semaphore(max(1, get_settings().mcp_max_concurrency_global))
    return _global_sem


class _Gate:
    """Async context manager acquiring the global + per-user concurrency slots."""

    def __init__(self, user_id: str) -> None:
        self._user_id = user_id

    async def __aenter__(self) -> None:
        await _global_semaphore().acquire()
        try:
            await _user_semaphore(self._user_id).acquire()
        except BaseException:
            _global_semaphore().release()
            raise

    async def __aexit__(self, *exc: object) -> None:
        _user_semaphore(self._user_id).release()
        _global_semaphore().release()


def concurrency_gate(user_id: str) -> _Gate:
    return _Gate(user_id)


def reset_for_tests() -> None:  # pragma: no cover - test helper
    _buckets.clear()
    _user_sems.clear()
    global _global_sem
    _global_sem = None
