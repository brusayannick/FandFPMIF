"""Backend-switch data migration (S3_OFFLOAD Phase 3.1). S3 + sync stubbed."""

from __future__ import annotations

import types
from pathlib import Path

import pytest

from mate.api.storage import migration
from mate.api.storage.s3 import S3Object


def _objs(keys: list[str]) -> list[S3Object]:
    return [S3Object(key=k, size=1, etag=None, last_modified=None) for k in keys]


def test_s3_cache_dirs_parses_keys(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(migration, "get_settings", lambda: types.SimpleNamespace(data_dir=tmp_path))
    monkeypatch.setattr(migration, "get_storage_settings", lambda: types.SimpleNamespace(prefix=""))
    keys = [
        "users/u1/event_logs/log1/events.parquet",
        "users/u1/event_logs/log1/meta.json",  # same dir → deduped
        "users/u1/module_results/log1/mod1/result.json",
        "users/u2/event_logs/log9/cases.parquet",
        "users/u1/event_logs/log1/ocel/events.parquet",  # nested → still the log dir
    ]
    monkeypatch.setattr(migration.s3, "list_objects", lambda *a, **k: _objs(keys))
    dirs = migration._s3_cache_dirs()
    assert set(dirs) == {
        tmp_path / "users/u1/event_logs/log1",
        tmp_path / "users/u1/module_results/log1/mod1",
        tmp_path / "users/u2/event_logs/log9",
    }


def test_s3_cache_dirs_honors_admin_prefix(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(migration, "get_settings", lambda: types.SimpleNamespace(data_dir=tmp_path))
    monkeypatch.setattr(
        migration, "get_storage_settings", lambda: types.SimpleNamespace(prefix="prod")
    )
    monkeypatch.setattr(
        migration.s3,
        "list_objects",
        lambda *a, **k: _objs(["prod/users/u1/event_logs/L/e.parquet"]),
    )
    assert migration._s3_cache_dirs() == [tmp_path / "users/u1/event_logs/L"]


def test_push_one_verifies_remote(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    pushed: list[Path] = []
    monkeypatch.setattr(migration.storage_sync, "persist_dir_sync", lambda d: pushed.append(d))
    monkeypatch.setattr(migration.storage_sync, "rel_key", lambda d: "k/")
    monkeypatch.setattr(migration.s3, "prefix_nonempty", lambda *a, **k: True)
    d = tmp_path / "log"
    d.mkdir()
    assert migration._push_one(d) is True
    assert pushed == [d]


def test_pull_one_downloads(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(migration.storage_sync, "rel_key", lambda d: "k/")

    def fake_download(key: str, local_dir: Path, s=None) -> int:
        local_dir.mkdir(parents=True, exist_ok=True)
        (local_dir / "events.parquet").write_bytes(b"x")
        return 1

    monkeypatch.setattr(migration.s3, "download_prefix", fake_download)
    d = tmp_path / "log"
    assert migration._pull_one(d) is True
    assert (d / "events.parquet").exists()


class _FakeHandle:
    """Minimal JobHandle stand-in for the migration handler."""

    def __init__(self, direction: str) -> None:
        self.payload = {"direction": direction}
        self.progress_calls = 0

    async def progress(self, *a, **k) -> None:
        self.progress_calls += 1

    def raise_if_cancelled(self) -> None:
        pass


async def test_handler_to_s3_runs_push_over_cache_dirs(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    dirs = [tmp_path / "a", tmp_path / "b", tmp_path / "c"]
    monkeypatch.setattr(migration, "is_s3", lambda: True)
    monkeypatch.setattr(migration.eviction, "cache_dirs", lambda: dirs)
    seen: list[Path] = []
    monkeypatch.setattr(migration, "_push_one", lambda d: seen.append(d) or True)
    handle = _FakeHandle("to_s3")
    await migration._make_handler()(handle)
    assert seen == dirs
    assert handle.payload["migrated"] == 3
    assert handle.payload["failed"] == 0


async def test_handler_requires_s3(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(migration, "is_s3", lambda: False)
    with pytest.raises(RuntimeError, match="S3 backend"):
        await migration._make_handler()(_FakeHandle("to_s3"))


async def test_handler_counts_failures(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    dirs = [tmp_path / "a", tmp_path / "b"]
    monkeypatch.setattr(migration, "is_s3", lambda: True)
    monkeypatch.setattr(migration.eviction, "cache_dirs", lambda: dirs)

    def flaky(d: Path) -> bool:
        if d.name == "b":
            raise RuntimeError("upload failed")
        return True

    monkeypatch.setattr(migration, "_push_one", flaky)
    handle = _FakeHandle("to_s3")
    await migration._make_handler()(handle)
    assert handle.payload["migrated"] == 1
    assert handle.payload["failed"] == 1
