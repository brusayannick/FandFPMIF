# S3 Offload — Scalable Storage Plan

Status of the storage backend today, the gaps that stop it from actually
relieving the VM, and the phased plan to fix them. Scope decided: **S3
authoritative, local disk a bounded cache; hydrate-to-local on read;
multi-node-ready but single-node now.** See `apps/api/src/mate/api/storage/`.

## Today (before this work)

`mode="s3"` (Admin → Storage) makes the bucket a **write-through mirror**: a
log/output dir is written locally, then uploaded; on a read-miss the whole dir
is pulled back. Per-user key layout, isolated:

```
{prefix}/users/{uid}/event_logs/{lid}/{events,cases,meta,original}…
{prefix}/users/{uid}/event_logs/{lid}/ocel/{events,objects,relations,o2o}.parquet
{prefix}/users/{uid}/module_results/{lid}/{mid}/{key}.{json,parquet,bin}
```

Mirrored to S3: event-log Parquet (`events`/`cases`), OCEL Parquet (4 tables),
`meta.json`, original uploads, module result caches (+ filter variants),
watched-folder source path.

### Why it did not relieve the VM

1. **Local copy was never evicted.** Write lands locally first, then uploads;
   reads pull the whole dir down, mark it hydrated, and never delete it. Turning
   S3 on added a second copy + upload cost — it did not shrink the VM.
2. **The biggest bloaters bypass S3 entirely** (VM-only, never synced):
   `metadata.db` (SQLite, grows unbounded with `jobs`/`analytics_event`; also a
   SPOF — lose the VM and every S3 object is orphaned), module `.venv/`
   (100 MB–2 GB each), `data/uv-python/` runtimes (200–400 MB per interpreter),
   `data/uploaded_modules/` packages.
3. **Hydration is whole-tree, per-process.** A cold read of a 10 GB log pulls
   all 10 GB before DuckDB touches it (DuckDB reads local paths only, no
   httpfs). `_hydrated` is per-process, so each worker/VM re-downloads a full
   copy.

Plus: no data migration on backend switch (old data stranded); `quota_bytes`
exists but is unenforced.

## Goal / invariant

VM local disk bounded by **active working set + module runtime artifacts**, not
total-data-ever. S3 holds the complete, restorable truth. The model flips from
`local = forever copy, S3 = mirror` to `S3 = authoritative, local = LRU cache`.

---

## Phase 1 — Mirror → cache-with-eviction  ✅ implemented

The core. Makes the local tree a reclaimable cache. Code:
`apps/api/src/mate/api/storage/eviction.py`.

- **Disk budget.** `local_cache_max_bytes` (env default `0` = disabled / keep
  every copy). Admin-tunable live at Admin → Storage, persisted in
  `system_settings` under `storage.cache` (mirrors the worker-concurrency
  pattern). Independent of the S3-side `quota_bytes`.
- **Access bookkeeping.** Effective last-access per cache dir =
  `max(in-process atime, newest file mtime)`. mtime is the restart-surviving
  fallback, so no new table / migration in Phase 1.
- **Reaper.** A periodic sweep (`cache_evict_interval_seconds`, default 60 s):
  when local cache bytes exceed the budget, delete least-recently-used dirs down
  to 90 % of the budget. Each delete is local-only — the bytes survive on S3 and
  re-hydrate on next read.
- **Lease guard (correctness-critical).** Every read/write of a cache dir takes
  a refcount lease for its duration (`EventLogAccess`, `ObjectCentricLogAccess`,
  `ResultCache`). The reaper never evicts a leased dir, and a reader blocks
  briefly if it races an in-flight eviction of the same dir — so a tree can
  never be deleted out from under a running DuckDB scan or a Parquet rewrite.

**Hard invariants (enforced):**

- Eviction runs **only in S3 mode**. In local mode the local copy is the only
  copy; the reaper no-ops.
- A dir is deleted locally **only after its S3 prefix is confirmed non-empty** —
  a remote copy provably exists to re-hydrate from.
- **`cache_evict_dry_run` defaults `true`**: the reaper logs what it would evict
  and deletes nothing. Soak first, confirm the candidate set, then flip to
  enable deletes.
- A dir accessed within `cache_evict_min_age_seconds` (default 600 s) is never
  evicted — guards against deleting a tree whose upload is still in flight.

Outcome: with S3 on + a budget set, the VM disk is bounded and idle data is
reclaimed.

---

## Phase 2 — Close the bypass holes (the real GB-scale hogs)  ✅ implemented

1. **`metadata.db` → S3 backup** (`storage/db_backup.py`). Hourly + on-shutdown
   SQLite online-backup snapshot to `{prefix}/_system/metadata.db`, so S3 is a
   complete restorable picture and losing the VM no longer orphans the bucket.
   SQLite stays single-node. **Restore is operator-invoked, not automatic** —
   `alembic upgrade head` runs in the entrypoint before the app, so a fresh
   (empty-schema) DB already exists by lifespan; a restore there would be too
   late and racy. Recovery is a pre-boot CLI step (see *Operating* below).
2. **Jobs retention** (`jobs/maintenance.py`). The daily sweeper
   (`main._retention_loop`, formerly analytics-only) now also prunes terminal
   `jobs` older than `JOB_RETENTION_DAYS` (0 = keep forever). Active jobs are
   never touched; `parent_job_id` is `SET NULL` so deletion order is safe.
3. **Uploaded module archives → S3** (`storage/module_archive.py`). On install,
   the module *source* (sans `.venv`/`.dist`/`.installed-hash`) is tar.gz'd to
   `{prefix}/_system/modules/{mid}.tar.gz`. At boot (S3 mode) any *owned* upload
   whose dir is missing is re-materialised before the loader runs, which then
   rebuilds the venv/bundle locally. The archive is deleted on last-owner
   uninstall. Restore + GC are both scoped to the `module_installs` set so they
   never fight over a dir.
4. **Uploaded-module GC** (`modules/maintenance.py`). At boot (S3 mode) any
   `uploaded_modules/{mid}` dir with zero install rows is removed, reclaiming its
   venv + bundle + source. **Deferred:** capping `data/uv-python/` to
   live-manifest interpreters — `uv` self-manages that cache; lower value, do
   later.

### Operating (Phase 1 + 2)

- **Cache budget** (Phase 1): Admin → Storage → *Local cache budget*, or env
  `LOCAL_CACHE_MAX_BYTES` / `CACHE_EVICT_DRY_RUN` / `CACHE_EVICT_MIN_AGE_SECONDS`.
  Off by default; set a budget + turn dry-run off to actually reclaim.
- **Jobs retention**: `JOB_RETENTION_DAYS` (0 = keep forever).
- **DB restore on a fresh VM** (before `alembic upgrade head`):
  ```
  STORAGE_MODE=s3 STORAGE_S3_ENDPOINT=… STORAGE_S3_BUCKET=… \
  STORAGE_S3_ACCESS_KEY=… STORAGE_S3_SECRET_KEY=… STORAGE_S3_PREFIX=… \
    uv run python -m mate.api.storage.db_backup restore
  ```
  Storage config normally lives *inside* metadata.db, so the CLI (and any
  DB-less bootstrap) reads the bucket from these `STORAGE_*` env vars — a
  fallback in `storage/config.py` consulted only when the DB has no
  `storage_config` row. Restore no-ops if the local DB already exists, so it's
  safe to run unconditionally in an entrypoint.

## Phase 3 — Migration + quota  ✅ implemented

1. **Backend-switch migration job** (`storage/migration.py`). A `storage.migrate`
   admin job walks every per-log + per-module cache dir and pushes it to S3
   (`to_s3`, after a local→s3 switch) or pulls it down (`to_local`, before an
   s3→local switch), with progress. **Copy-only** — it never deletes the source,
   so it's safe to re-run and needs no destructive-confirm; the "switch + delete"
   hazard simply doesn't exist. Both directions require S3 active (run `to_local`
   before flipping back). Admin route `POST /admin/storage/migrate`; buttons on
   the Storage page; tracked in Admin → Jobs.
2. **Enforce `quota_bytes`** (`storage/quota.py`). `StorageConfig.quota_bytes` is
   the total-bucket ceiling. The event-log upload route rejects up-front (507)
   when usage meets/exceeds it — before staging bytes. Usage (an S3 LIST) is
   cached for a 30 s TTL and invalidated on delete (frees space), so it's not a
   LIST per write. A guardrail, not a fence: an unknown usage (S3 error) never
   blocks. No-op unless S3 active + a quota is set.

## Phase 4 — Hydration performance  ✅ implemented

1. **Lazy `original.*` hydration** (`storage/sync.py`). Data hydration
   (`hydrate_log` → `download_prefix(skip=_is_original)`) now omits the retained
   `original.{ext}` upload — the common path (modules, dashboards, the events
   editor) never pulls those potentially huge bytes. The four paths that actually
   need the original — re-import, remap, duplicate, admin-download — call a new
   `hydrate_original` on demand (admin-download pulls *only* the original, never
   the parquet). Independent of the `_hydrated` data marker, so the two fetch
   independently.
2. **Parallel + integrity transfers** (`storage/s3.py`). `upload_dir` /
   `download_prefix` fan their per-object loops across a thread pool
   (`_TRANSFER_CONCURRENCY=8`; boto3 clients are thread-safe, S3 I/O drops the
   GIL) — a many-file OCEL log transfers in a fraction of the serial wall-clock.
   `download_prefix` verifies each file's byte length against the listed `Size`
   and raises `StorageError` on a short read (so the caller re-hydrates).
   `upload_dir` uses `upload_file`, which auto-switches to multipart above ~8 MB,
   so large Parquet uploads correctly. `download_prefix` gained the `skip`
   predicate used by (1).

## Multi-node-ready seams (design now, build later — out of scope)

- S3-authoritative + local-as-cache already makes app nodes stateless w.r.t.
  user data: any node hydrates on demand; per-node `_hydrated` is fine (S3 is
  shared truth). Free from Phase 1.
- Keep metadata access behind SQLAlchemy async (no SQLite-specific SQL) so
  SQLite→Postgres is a config swap when going multi-node.
- Known remaining multi-node blockers (in-process event bus, asyncio job queue)
  are left as-is — the next epic.

## Sequencing

`P1 (cache+evict+lease)` → `P2.1/2.2 (metadata durability + retention)` →
`P3 (migration + quota)` → `P2.3/2.4 (module artifacts)` → `P4 (perf)`.
P1 ships standalone value; the rest is independent after it.
