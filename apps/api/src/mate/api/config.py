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

    env: Literal["dev", "prod"] = Field(
        default="prod",
        description="Set to 'dev' to enable watchdog hot-reload of modules/ (§5.3 #7).",
    )

    # Behaviour-tracking policy & onboarding default. Read by the frontend via
    # GET /api/v1/usage/config (surfaced as `onboarding_mode`):
    #   force — tracking is ON for every user; the onboarding privacy step and
    #           the Settings → Privacy tab are hidden, and users cannot opt out.
    #   on    — tracking is enabled by default during onboarding (opt-out flow).
    #   off   — tracking is disabled by default during onboarding (opt-in flow).
    user_tracking_onboarding: Literal["force", "on", "off"] = Field(
        default="force",
        description="USER_TRACKING_ONBOARDING — tracking default/policy (force|on|off).",
    )

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

    # Keycloak / OIDC. Set in docker-compose; required for any authenticated
    # request to succeed. The `iss` claim on issued tokens must equal
    # ``keycloak_issuer`` (browser-facing URL). The JWKS endpoint can live on
    # a different host (e.g. the docker DNS name) — ``keycloak_jwks_url`` lets
    # the API fetch keys without going via the browser-facing hostname.
    keycloak_issuer: str = Field(
        default="http://localhost:8080/realms/flows-funds",
        description="OIDC issuer URL — must match the `iss` claim on tokens.",
    )
    keycloak_jwks_url: str = Field(
        default="http://localhost:8080/realms/flows-funds/protocol/openid-connect/certs",
        description="Where the API fetches signing keys (back-channel).",
    )
    keycloak_audience: str = Field(
        default="flows-funds-api",
        description="Expected `aud` claim on access tokens.",
    )
    keycloak_jwks_ttl_seconds: int = Field(default=3600, ge=60)

    # Secret used to derive the Fernet key that encrypts the S3 secret-access-key
    # stored in the metadata DB (Admin → Storage). Must be set and STABLE in
    # production — rotating it makes the stored S3 secret undecryptable and the
    # admin has to re-enter it. Falls back to ``database_url`` when unset so dev
    # works out of the box (acceptable: the DB is local-only there).
    storage_encryption_key: str | None = Field(
        default=None,
        description="STORAGE_ENCRYPTION_KEY — encrypts the stored S3 secret key.",
    )

    @property
    def users_dir(self) -> Path:
        return self.data_dir / "users"

    @property
    def uploaded_modules_dir(self) -> Path:
        """Persistent root for user-uploaded modules.

        Kept separate from ``modules_dir`` (the git-tracked repo defaults) so an
        upload can never overwrite or sit next to a default's code. Discovery
        scans both roots; a default and an upload sharing an id is a hard error.
        """
        return self.data_dir / "uploaded_modules"

    def event_logs_dir_for(self, user_id: str) -> Path:
        return self.users_dir / user_id / "event_logs"

    def module_results_dir_for(self, user_id: str) -> Path:
        return self.users_dir / user_id / "module_results"

    def ensure_dirs(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.users_dir.mkdir(parents=True, exist_ok=True)
        self.uploaded_modules_dir.mkdir(parents=True, exist_ok=True)

    def ensure_user_dirs(self, user_id: str) -> None:
        self.event_logs_dir_for(user_id).mkdir(parents=True, exist_ok=True)
        self.module_results_dir_for(user_id).mkdir(parents=True, exist_ok=True)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
