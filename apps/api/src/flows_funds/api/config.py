"""Runtime configuration. Reads from env / .env via pydantic-settings."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    data_dir: Path = Field(default=Path("data"), description="Bind-mounted persistent data root.")
    modules_dir: Path = Field(
        default=Path("modules"),
        description="Filesystem-discovered module folder (§5.3).",
    )
    database_url: str = Field(
        default="sqlite+aiosqlite:///data/metadata.db",
        description="aiosqlite URL — async SQLAlchemy engine.",
    )

    log_level: Literal["debug", "info", "warning", "error"] = "info"

    # Job queue — minimal config for phase 3; the full set lands in phase 4.
    worker_concurrency: int = Field(default=2, ge=1, le=8)
    progress_persist_every: int = Field(
        default=1000,
        description="Persist job progress to SQLite every N processed events.",
    )

    cors_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:3000"],
        description="Allowed origins for the Next.js dev server.",
    )

    @property
    def event_logs_dir(self) -> Path:
        return self.data_dir / "event_logs"

    @property
    def module_results_dir(self) -> Path:
        return self.data_dir / "module_results"

    def ensure_dirs(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.event_logs_dir.mkdir(parents=True, exist_ok=True)
        self.module_results_dir.mkdir(parents=True, exist_ok=True)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
