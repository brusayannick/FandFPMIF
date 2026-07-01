"""Cooperative shutdown flag for long-lived SSE streams.

Uvicorn drains open connections *before* the lifespan shutdown runs and never
sends `http.disconnect` to an in-flight streaming response, so a `while True`
SSE generator (`/events`, `/jobs/{id}/stream`) blocks the drain until
`--timeout-graceful-shutdown`, gets force-cancelled, and dumps a
`CancelledError` ASGI traceback.

The programmatic runner (`cli.py` / the `mate-api` script) owns the
`uvicorn.Server` and registers its `should_exit` flag here; SSE loops poll
`is_shutting_down()` and bow out within one poll interval, so the drain
completes cleanly and no force-cancel happens. Under the raw `uvicorn` CLI with
`--reload` (dev) the reloader owns the serving process, so no probe is
registered and this stays `False` forever - identical to the previous
behaviour, no regression.
"""

from __future__ import annotations

from collections.abc import Callable


def _never() -> bool:
    return False


_probe: Callable[[], bool] = _never


def set_shutdown_probe(probe: Callable[[], bool]) -> None:
    """Register the process-wide shutdown probe (called once by the runner)."""
    global _probe
    _probe = probe


def is_shutting_down() -> bool:
    """True once the server has begun graceful shutdown; drives SSE self-close."""
    return _probe()
