# Fact ledger (working file, not published)

Every non-obvious claim in the report, with the file that backs it. Cited as
`path:symbol` so a reviewer can re-check.

## Services and deployment

| Claim | Evidence |
|---|---|
| Base stack = 4 containers: `keycloak-db`, `keycloak`, `api`, `web` | `docker-compose.yml:2,18,58,196` |
| Optional 5th: `neo4j` behind the `graph` compose profile | `docker-compose.yml:163` `profiles: ["graph"]` |
| Prod overlay adds `proxy` (Caddy), collapses onto one origin, withdraws published ports | `docker-compose.prod.yml`, `docs/DEPLOY.md` §43-74 |
| Four running modes are overlays of one composition, not separate tools | `README.md` §"Running modes"; `Makefile` |
| Prod proxy chain: uni edge proxy → VM :443 Caddy → `api`/`keycloak`/`web` by path | `docs/DEPLOY.md` §43-74 |
| Public cert on the uni proxy; VM cert only secures the proxy↔VM hop | `docs/DEPLOY.md:66-70` |
| First boot ~10 min (per-module dependency resolution); healthcheck grace 10 min | `README.md:48,67`; `docs/DEPLOY.md:27` |

## Realtime transport (the single most-cited stale claim)

| Claim | Evidence |
|---|---|
| Live updates are **SSE, not WebSocket** | `apps/api/src/mate/api/routes/events_sse.py` module docstring; `apps/web/lib/ws.ts` header comment |
| Root cause: the proxy chain drops WS upgrades; the handshake arrives as a plain `GET` and 404s | `routes/events_sse.py` docstring; `apps/web/lib/ws.ts` |
| SSE rides the same path Mate AI streaming already used successfully | `routes/events_sse.py` docstring, ref. `routes/ai.py` |
| Auth moved from token-in-URL to `Authorization: Bearer` (token no longer leaks into access logs) | `routes/events_sse.py` docstring; `apps/web/lib/ws.ts` |
| Two streams: `GET /api/v1/events?topic=…` (session-wide) and `GET /api/v1/jobs/{id}/stream` (focused job) | `routes/events_sse.py`, `apps/web/lib/ws.ts` |
| The file is still named `ws.ts` because `@/lib/ws` is a published module-SDK import alias | `apps/web/lib/ws.ts` header; `apps/web/lib/runtime-externals.json` |
| Reconnect: exponential backoff capped at 8 s; HTTP 401 means "sign back in", not "retry" | `apps/web/lib/ws.ts` header |

## Event bus and tenant isolation

| Claim | Evidence |
|---|---|
| In-process pub/sub; one bounded queue per subscriber, `DEFAULT_QUEUE_MAXSIZE = 256` | `events/bus.py:30` |
| Full queue drops the **oldest** event; cumulative drops are logged | `events/bus.py` docstring |
| `user_id` and `log_id` are reserved envelope keys; both bus fan-out and `@on_event` dispatch key on `user_id` | `events/bus.py:103-104` `_RESERVED_KEYS` |
| SSE fan-out filters envelopes whose `user_id` differs from the connected user | `routes/events_sse.py` docstring |
| Every resource keys on the Keycloak `sub` claim | `auth/dependencies.py`, `auth/ownership.py` |
| On-disk per-user data at `data/users/{user_id}/` | `README.md:169` |
| `DashboardShare` is the **only** sanctioned cross-account path, and it is read-only | `sharing.py` docstring |

## Job runtime

| Claim | Evidence |
|---|---|
| asyncio queue, SQLite-persisted `Job` rows, UUID v7 ids, no broker | `jobs/runtime.py` docstring |
| Lifecycle topics: `job.queued|started|progress|completed|failed|cancelled|queue.paused|queue.resumed` | `jobs/runtime.py` docstring |
| Progress persisted to SQLite every `progress_persist_every` ticks but broadcast on every call | `jobs/runtime.py` docstring; `config.py:54` |
| Per-user pause/resume: a paused tenant's jobs park, other tenants keep flowing | `jobs/runtime.py` docstring |
| Retry re-enqueues the same payload under a fresh job id | `jobs/runtime.py` docstring |
| Default `worker_concurrency = 2`, admin-settable live (1-8) | `config.py:53` |
| `job_execution_timeout_seconds` default 1800; a timeout SIGKILLs the offload process | `config.py:86`; `docs/DEPLOY.md:253-254` |
| Heavy CPU work offloads via `ctx.run_in_process` to a `ProcessPoolExecutor` | `modules/process_offload.py`; `config.py:93,108` |

## Readiness gate and precompute ordering

| Claim | Evidence |
|---|---|
| Log lifecycle `importing → processing → ready | failed` | `modules/processing.py` docstring |
| Expected module set frozen at import time to avoid a "0 subscribers seen yet" race | `modules/processing.py` docstring |
| Completion derived from `Job` rows linked by `parent_job_id`, so it survives an API restart (boot reconcile) | `modules/processing.py` docstring |
| Terminal statuses that un-gate: `completed`, `failed`, `cancelled` — a failed module must not strand a log | `modules/processing.py:_TERMINAL_JOB_STATUSES` |
| Ordering is declared via `provides`/`consumes`, walked as a transitive closure | `modules/loader.py:859-883` `precompute_closure` |
| A phantom `consumes` (topic no loaded module emits) is simply never reached | `modules/loader.py:868-870` |
| Only **job-backed** subscribers enter the closure | `modules/loader.py:827` `precompute_subscriber_module_ids`; `CLAUDE.md` |
| Client-side stall hint after `STALL_THRESHOLD_MS` = 3 min | `apps/web/lib/stores/jobs.ts` |

## Module system

| Claim | Evidence |
|---|---|
| Loader mounts routes, bus subscriptions, job handlers, capabilities from the manifest | `modules/loader.py` docstring |
| Per-module venv via `uv venv` + `uv pip install`, skipped on `.installed-hash` match | `modules/installer.py` docstring |
| `uv pip install` chosen over `uv sync` because lock-file writes fail on macOS Docker Desktop VirtioFS bind mounts | `modules/installer.py` docstring |
| in_process venvs are ABI-locked to the platform interpreter (3.12); `requires-python` is a gate for in_process, an interpreter selector for subprocess | `CLAUDE.md`; `modules/installer.py` |
| Runtime registry keyed on `runtime.kind`: `python`, `jvm` | `modules/runtimes/__init__.py:_RUNTIMES` |
| A runtime owns exactly two seams: `materialize` and `launch_spec` | `modules/runtimes/base.py` docstring |
| JVM runtime does **no** server-side dependency resolution: fat jar only; `materialize` validates JRE version, jar presence, `Main-Class` | `modules/runtimes/jvm.py` docstring |
| Everything downstream of the worker socket is runtime-agnostic (JSON + Parquet, never language objects) | `modules/runtimes/base.py` docstring |
| Bridge transport: line-delimited JSON over a Unix socket, bidirectional (`call`/`ping`/`shutdown` host→worker; every `ctx.*` worker→host) | `modules/subprocess_worker.py` docstring; `modules/PROTOCOL.md` §3,5,7 |
| `RPC_STREAM_LIMIT` raised well past asyncio's 64 KiB `readline` default — a single oversized line raised `LimitOverrunError` and killed the worker | `modules/subprocess_worker.py:36-42` |
| DataFrames cross via a **Parquet file**, not the socket | `modules/subprocess_worker.py:41-42`; `CLAUDE.md` |
| Worker crashes auto-respawn with backoff; `subprocess_respawn_max_attempts` 5, backoff cap 30 s | `config.py:76-77`; `tests/test_bridge_respawn.py` |
| Parent-death guard is required of every worker | `modules/PROTOCOL.md` §2 |
| Cross-runtime conformance suite; JVM cases skip without `make sdk-jvm` + a JDK | `tests/test_worker_conformance.py`; `CLAUDE.md` |
| Per-user ownership reference-counted in `module_installs`; defaults seeded on first login; uploads land in `data/uploaded_modules/` so they can never overwrite repo defaults | `db/models.py:325`; `README.md:136`; `modules/installs.py` |
| Panels may only import `@/` paths on the allow-list; violation is a **build** failure, not a runtime error | `apps/web/lib/runtime-externals.json`; `apps/web/scripts/bundle-modules.mjs`; `tests/test_runtime_externals_parity.py` |
| Panels bundled by `bundle-modules.mjs` outside the Next build (predev/build hook, watch in dev) | `CLAUDE.md`; `docs/INSTRUCTIONS.md` §5.4 |
| `module_layouts` table + routes retained but dead — Dashboards took that role, no module ever called the hooks | `docs/INSTRUCTIONS.md` §7.7 |

## Data

| Claim | Evidence |
|---|---|
| Import formats: XES / XES.gz (primary), CSV with column mapping, generic XML (secondary), OCEL 2.0 (`.jsonocel`/`.xmlocel`/`.sqlite`) | `ingest/detect.py`, `ingest/dispatch.py`, `ingest/ocel.py` |
| Per-log layout: `meta.json`, `events.parquet`, `cases.parquet`, `original.{ext}`, `ocel/{events,objects,relations,o2o}.parquet` | `docs/INSTRUCTIONS.md` §3.2; `ingest/storage.py` |
| Import job writes `events.parquet`/`cases.parquet`/`meta.json`, then `ready` or `processing` | `ingest/dispatch.py` docstring |
| DuckDB is single-threaded per connection → one connection per worker thread via `contextvars`; SQLite re-attached on demand for cross-store joins | `duckdb/pool.py` docstring |
| SQLite in WAL mode via `aiosqlite`; Alembic migrations run on boot | `docs/INSTRUCTIONS.md` §2.1; `CLAUDE.md` |
| 24 metadata tables | `db/models.py` (`__tablename__` count) |
| Usage capture is OCEL-shaped: `analytics_objects`, `analytics_object_relations`, `analytics_event_objects` | `db/models.py:546,569,591` |
| S3 mode flips the model from "local = forever copy, S3 = mirror" to "S3 = authoritative, local = LRU cache" | `docs/S3_OFFLOAD.md` §"Goal / invariant" |
| The naive mirror failed for three reasons: local copy never evicted; the biggest bloaters (`metadata.db`, module `.venv/`, `data/uv-python/`, uploaded modules) bypassed S3; hydration was whole-tree and per-process | `docs/S3_OFFLOAD.md` §"Why it did not relieve the VM" |
| Four phases implemented: eviction, bypass closure, migration + quota, hydration performance | `docs/S3_OFFLOAD.md` §94,132,189,208 |
| Multi-node seams designed but not built | `docs/S3_OFFLOAD.md` §228 |

## Auth, admin, MCP

| Claim | Evidence |
|---|---|
| Auth.js v5 JWT-only sessions (no DB adapter) on the web side; PyJWT + JWKS on the API side | `apps/web/auth.ts`; `auth/dependencies.py`; `config.py:219-231` |
| The single realm role `admin` is the only authorisation primitive | `auth/dependencies.py:ADMIN_ROLE`; `README.md:161` |
| Admin export ships a consistent snapshot of the whole metadata DB — all users' data | `routes/admin.py`; `README.md:156-164` |
| `USER_TRACKING_ONBOARDING` default `force` hides the privacy step and removes the opt-out | `config.py:45`; `README.md:110-116` |
| MCP: `user_id` is never a tool argument; a token only ever acts as its owner | `mcp/server.py` docstring |
| MCP data wall: no raw event rows — aggregates and curated module outputs only | `mcp/server.py` docstring; `docs/MCP.md` §96 |
| 8 toolsets: meta, processes, analysis, dashboards, jobs, watched, account, admin | `mcp/toolsets/` |
| Two auth paths: PAT (`mate_pat_…`) and OAuth 2.1 through Keycloak | `docs/MCP.md` §31; `auth/tokens.py:TOKEN_PREFIX` |
| MCP is opt-in (`MCP_ENABLED`), rate-limited, concurrency-capped, optionally read-only | `config.py:286-335` |
| Mate AI binds to a user-supplied OpenAI-compatible endpoint; keys stay in local SQLite | `README.md:100-106`; `routes/ai.py` |

## Size and test surface (measured 2026-08-03)

| Artefact | Size |
|---|---|
| `apps/api/src` | 39,522 Python LOC |
| `apps/web` (ts/tsx, excl. deps and build output) | 49,753 LOC |
| `apps/api/tests` | 75 test modules, 16,599 LOC |
| `packages/module-sdk-py` | 1,134 LOC |
| `packages/module-sdk-jvm` | 2,320 Java LOC |
| `packages/module-sdk-ts` public surface | 76 LOC |
| Bundled modules | 17 |

Per-module LOC (Python + panel TS): `discovery` 14,727 · `agentsimulator` 9,107 ·
`cv4cdd` 3,946 · `concept_drift_explainer` 3,787 · `process_comparison` 3,598 ·
`complexity_v2_over_time` 3,545 · `conformance` 3,232 · `ocel_discovery` 2,982 ·
`complexity_over_time` 2,775 · `complexity_v2` 2,521 · `actor_performance` 2,330 ·
`complexity` 2,140 · `performance_over_time` 1,920 · `performance` 1,454 ·
`log_evolution` 1,291 · `pcomp` 825 · `alpha_miner_java` (Java, jar-shipped).

Test suites that matter to the argument: `test_modules_loader`, `test_runtimes`,
`test_worker_conformance`, `test_worker_protocol_golden`, `test_bridge_respawn`,
`test_parent_death_guard`, `test_subprocess_cancel`, `test_precompute_ordering`,
`test_module_processing`, `test_modules_per_user`, `test_module_python_version`,
`test_runtime_externals_parity`, `test_sharing`, `test_policy`,
`test_storage_{eviction,migration,quota,s3_transfer,db_backup,module_archive}`,
`test_mcp_*` (9 files), `test_hot_reload`, `test_child_supervisor`.

## Project chronology (git)

90 commits, 2026-04-17 (`init`) → 2026-07-28. Committing accounts: 4.
Milestones read off commit messages:

| Date | Commit | Milestone |
|---|---|---|
| 2026-04-17 | `init` | Repository created |
| 2026-06-02 | `1cc1b02` | Keycloak container healthcheck fixed (`/dev/tcp` needs bash) |
| 2026-06-05 | `38e8d8e`, `df577e1`, `cedf06d`, `2866244`, `1ad9b09` | Keycloak issuer, on-box token exchange, cookie-size 502, server-side session store |
| 2026-06-05 | `8e5d407` | OCEL compatibility |
| 2026-06-07 | `31de99e` | Dashboards |
| 2026-06-09 | `d4c6f73` | Object-centric |
| 2026-06-15 | `12bf976` | Mate AI v1 with intent routing |
| 2026-06-17 | `cfc8724` | **SSE migration**, admin insights, watched folders |
| 2026-06-17 | `8ece979`, `12e09b2` | S3 + admin, new Keycloak config |
| 2026-06-21 | `2f73cbf` | Pcomp module + panel (external contributor branch) |
| 2026-06-22 | `9149d1b` | AgentSimulator |
| 2026-06-27 | `ed9db13` | Parallelisation |
| 2026-06-29 | `0362100` | Concurrency fix |
| 2026-07-01 | `c10114a` | S3 offload merged |
| 2026-07-05 | `105d5d8` | Safari login-loop fix (server-side session store re-enabled) |
| 2026-07-06 | `018329c`, `3de690d` | Caddy v2.11 encode syntax, pinned image |
| 2026-07-07 | `6da3d02` | Design-system adoption |
| 2026-07-13 | `89fdb6e` | **MCP server** + new UI |
| 2026-07-14 | `80ea9f5`, `d95ed43` | Module control; **JVM support + extra containers** |
| 2026-07-15 | `d1e6f3a` | Admin control |
| 2026-07-28 | `bfcbfc3` | Dashboard rework, onboarding/tour, canvas unification |

## Defect log sources

Symptom→cause pairs are documented in `docs/DEPLOY.md` §"Troubleshooting" and
§5a "What does not work out of the box", plus these session records under
`.cc-history/`:

- `2026-05-14 Why-does-the-cv4cdd-import-take-soo-long` — TensorFlow dependency cost
- `2026-05-26 When-importing-this-event-log-it-only-ge` — XES element detection on a 200-row sample
- `2026-06-02 ANCELED-[api-base-1414]-RUN-uv-sync---f` — `uv sync` in the image build
- `2026-06-17 KEycloak-oidc-doesnt-work…` — university IdP demanded `client_secret_basic`
- `2026-06-17 Now-i-get-on-vm-504-Gateway-Time-out` — proxy timeout
- `2026-06-19 My-friend-tries-to-build-it-but-gets-Er` — reproducibility on a second machine
- `2026-06-19 Merge-all-alembic-migrations-into-the-be` — migration consolidation
- `2026-07-01 When-stopping-platform-i-get-Waiting-f` — shutdown hang
- `2026-07-14 How-to-reset-the-pinecone-dimensions` — external vector-store schema drift
- `2026-07-28 Ein-start-hat-jetzt-gerade-10gb-gebloate` — 10 GB image/data bloat
- `2026-07-31 Idee-Global-View-für-eine-variant,-act` — the cross-module view raised in user testing

## Citations confirmed from `papers/` and manifests

- Augusto, Mendling, Vidgof & Wurm (2022), *Inf. Sci.* 598, 196-215. doi:10.1016/j.ins.2022.03.072
- Kraus & van der Aa (2024), *Looking for Change* (BPM). doi:10.1007/978-3-031-70396-6_16
- Kraus & van der Aa (2025), *Process Science* 2(1), 5. doi:10.1007/s44311-025-00012-w
- Kirchdorfer, Blümel, Kampik, van der Aa & Stuckenschmidt (2025), *Process Science* 2:4. doi:10.1007/s44311-025-00009-5 (AgentSimulator, ICPM 2024 doi:10.1109/ICPM63005.2024.10680660)
- Pitsch, Brockhoff, Adams, Leemans, Celi & van der Aalst (2025), *Hypothesis Testing for Processes*, ICPM. doi:10.1109/ICPM66919.2025.11220677
- Klijn, Tentina, Fahland & Mannhardt (2024), *Decomposing process performance based on actor behavior*, ICPM. doi:10.1109/ICPM63005.2024.10680657
- Langer, E. (2025), master's thesis, University of Münster
- Schaffner, J. (2025), master's thesis, University of Münster
- van der Aalst, Weijters & Maruster (2004), *IEEE TKDE* 16(9), 1128-1142. doi:10.1109/TKDE.2004.47
- Rozinat & van der Aalst (2008), *Inf. Syst.* 33(1), 64-95. doi:10.1016/j.is.2007.07.001
- Carmona, van Dongen & Weidlich (2022), *Process Mining Handbook*, LNBIP 448. doi:10.1007/978-3-031-08848-3_5
- Berti, van Zelst & Schuster (2023), *Softw. Impacts* 17, 100556. doi:10.1016/j.simpa.2023.100556
- Lee, Song & van der Aalst (2026), *Data Knowl. Eng.* 164, 102601. doi:10.1016/j.datak.2026.102601
- User-interaction tracking: doi:10.1016/j.is.2024.102386
