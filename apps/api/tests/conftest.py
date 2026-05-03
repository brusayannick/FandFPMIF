"""Shared test fixtures.

The API is run against an isolated DATA_DIR per test session so SQLite, the
job runtime, and any Parquet output land in a tmp dir.
"""

from __future__ import annotations

import asyncio
import os
import shutil
from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient


@pytest.fixture(scope="session")
def event_loop() -> Iterator[asyncio.AbstractEventLoop]:
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="session")
def session_data_dir(tmp_path_factory: pytest.TempPathFactory) -> Iterator[Path]:
    root = tmp_path_factory.mktemp("ff-data")
    (root / "event_logs").mkdir()
    (root / "module_results").mkdir()
    yield root
    shutil.rmtree(root, ignore_errors=True)


@pytest.fixture(scope="session", autouse=True)
def _configure_env(session_data_dir: Path) -> Iterator[None]:
    os.environ["DATA_DIR"] = str(session_data_dir)
    os.environ["DATABASE_URL"] = (
        f"sqlite+aiosqlite:///{session_data_dir}/metadata.db"
    )
    os.environ["WORKER_CONCURRENCY"] = "1"
    # Default modules dir: an empty subdir so unrelated tests don't see the fixture mod.
    empty_modules = session_data_dir / "modules-empty"
    empty_modules.mkdir(exist_ok=True)
    os.environ["MODULES_DIR"] = str(empty_modules)
    # Force the lru_cache'd settings to be re-read.
    from flows_funds.api import config as cfg

    cfg.get_settings.cache_clear()

    # Build the schema by running migrations head.
    from sqlalchemy import create_engine

    from flows_funds.api.db.models import Base

    sync_url = (
        os.environ["DATABASE_URL"]
        .replace("+aiosqlite", "")
    )
    engine = create_engine(sync_url, future=True)
    Base.metadata.create_all(engine)
    engine.dispose()

    yield


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    from flows_funds.api.main import create_app

    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as c:
        async with app.router.lifespan_context(app):
            yield c


@pytest.fixture
async def client_with_sample_mod(tmp_path: Path) -> AsyncIterator[AsyncClient]:
    """Spin up the app with the `sample_mod` fixture loaded.

    We copy the fixture into a tmp dir and override MODULES_DIR for the duration
    of the test so each test sees a clean module surface.
    """
    import shutil

    src = Path(__file__).parent / "fixtures" / "modules" / "sample_mod"
    dst = tmp_path / "modules" / "sample_mod"
    shutil.copytree(src, dst)

    prev = os.environ.get("MODULES_DIR")
    os.environ["MODULES_DIR"] = str(tmp_path / "modules")
    from flows_funds.api import config as cfg

    cfg.get_settings.cache_clear()

    try:
        from flows_funds.api.main import create_app

        app = create_app()
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as c:
            async with app.router.lifespan_context(app):
                yield c
    finally:
        if prev is None:
            os.environ.pop("MODULES_DIR", None)
        else:
            os.environ["MODULES_DIR"] = prev
        cfg.get_settings.cache_clear()
