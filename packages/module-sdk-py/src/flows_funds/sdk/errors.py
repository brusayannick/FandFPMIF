"""Public exception types raised at the SDK / loader boundary."""

from __future__ import annotations


class ModuleError(Exception):
    """Base class for SDK / loader errors."""


class ModuleManifestError(ModuleError):
    """Manifest parsing, validation, or dependency-graph error."""
