# Authoring a Flows & Funds Module

This is the practical guide for building a module. For the platform-level rationale (why Parquet, why DuckDB, why per-module venvs) read [`/INSTRUCTIONS.md` §5](../INSTRUCTIONS.md). This document is the contract: what to put on disk, what the platform calls, what your module is allowed to call back.

---

## 1. What a module is

A module is a self-contained folder under `modules/<folder>/`. The platform discovers it on startup, installs its declared dependencies into the folder itself, registers its routes / event handlers / jobs, and renders its frontend panel on the per-process page (`/processes/{logId}/modules/{moduleId}`).

A module is **not**:

- A patch to the platform — you never edit `apps/api` or `apps/web` to ship a module.
- A long-running service — the platform owns the FastAPI process, the asyncio event loop, the job queue, and the WebSocket fan-out. Your code runs inside them.
- A privileged citizen — the same SDK is used by core, third-party, and user modules. There are no internal hooks reserved for first-party code.

To remove a module: delete the folder. Everything it added (its venv, its bundled JS, its lockfile) lives inside the folder.

---

## 2. Folder layout

```
modules/<folder>/
├── manifest.yaml           # required — registration, requirements, deps, frontend
├── module.py               # required — entry point: subclass of Module
├── pyproject.toml          # optional — synthesised from manifest if absent
├── package.json            # optional — synthesised from manifest if absent
├── events.py               # recommended — Pydantic schemas for emitted events
├── tests/                  # pytest tests for your handlers
├── panel/
│   └── index.tsx           # frontend module page entry (see manifest.frontend.panel)
├── widgets/
│   └── *.tsx               # reusable widgets advertised in manifest.frontend.widgets
├── .venv/                  # auto-created; gitignored
├── .dist/                  # auto-bundled JS; gitignored
├── node_modules/           # gitignored
└── uv.lock                 # committed — pins your Python deps
```

`<folder>` is arbitrary on disk; the manifest's `id` is authoritative.

---

## 3. `manifest.yaml`

Every field is validated by the SDK ([`packages/module-sdk-py/src/flows_funds/sdk/manifest.py`](../packages/module-sdk-py/src/flows_funds/sdk/manifest.py)). Manifest errors fail loud at startup.

```yaml
id: my_module                       # lowercase snake_case, globally unique
name: My Module                     # human-readable
version: 0.1.0
category: foundation                # foundation | attribute | external_input | advanced | other
description: One-line summary shown on the module card.
author: You
license: MIT

requirements:
  event_log:                        # checked against the log's detected schema
    required_columns: [case_id, activity, timestamp]
    optional_columns: [resource, end_timestamp]
    min_events: 100
    min_cases: 5
  modules: []                       # hard deps — must be loaded
  optional_modules:                 # soft deps — used if present
    - id: discovery
      reason: Activity labels are taken from discovery if available.

provides:                           # capabilities you publish on the registry / bus
  - my_module.compute_something

consumes:                           # bus topics / capabilities you depend on
  - log.imported

dependencies:
  python:
    requires-python: ">=3.12"
    packages:                       # private to this module — installed into .venv
      - "scikit-learn>=1.5"
    inherit:                        # reuse the platform's already-installed copy
      - pm4py
      - pandas
      - duckdb
    isolation: in_process           # in_process (default) | subprocess
  npm:
    - "d3-sankey@^0.12"

frontend:
  panel: ./panel/index.tsx
  widgets:
    - id: kpi-card
      entry: ./widgets/KpiCard.tsx
  page_layout:
    - section: KPIs
      widgets: [kpi-card]

permissions:
  - read:event_log
  - write:module_results
```

Rules the manifest validator enforces:

- `id` is lowercase snake_case and globally unique across all modules.
- A package cannot appear in both `dependencies.python.packages` and `dependencies.python.inherit` — pick one.
- Hard-dep cycles in `requirements.modules` abort startup.
- Two modules declaring the same `id` is a startup error.

`inherit` exists so process-mining modules don't reinstall pandas/numpy/pm4py per module — those weigh hundreds of MB. Anything not inherited is fully isolated to your `.venv`.

---

## 4. `module.py` — the entry point

```python
from flows_funds.sdk import Module, ModuleContext, on_event, route, job


class MyModule(Module):
    id = "my_module"                           # must match manifest.id

    @route.get("/kpis")
    async def get_kpis(self, ctx: ModuleContext) -> dict:
        cached = await ctx.cache.get("kpis")
        if cached is not None:
            return cached
        kpis = await self._compute(ctx)
        await ctx.cache.set("kpis", kpis)
        return kpis

    @on_event("log.imported")
    async def precompute(self, ctx: ModuleContext, payload: dict) -> None:
        await self._compute(ctx)

    @route.post("/recompute")
    @job(progress=True, title="My Module — recompute")
    async def recompute(self, ctx: ModuleContext) -> dict:
        await ctx.progress.update(0.0, "Loading log")
        async with ctx.event_log as log:
            df = await log.pandas()
        await ctx.progress.update(0.5, "Computing")
        kpis = self._reduce(df)
        await ctx.cache.set("kpis", kpis)
        await ctx.progress.update(1.0, "Done")
        return kpis
```

Rules:

- One subclass of `Module` per module file. The loader instantiates it exactly once per process — never instantiate it yourself.
- The class attribute `id` must equal `manifest.yaml::id`.
- Decorators only attach metadata. There is no `register(...)` call — the manifest is the registration.
- Handlers may be `async def` or plain `def`. Sync handlers are auto-wrapped so they cannot block the event loop:
  - `@route.*` rides FastAPI's built-in `run_in_threadpool`.
  - `@on_event` and `@job` are wrapped by the SDK with `asyncio.to_thread` ([`decorators.py`](../packages/module-sdk-py/src/flows_funds/sdk/decorators.py)).
- For anything expected to run more than a few seconds, add `@job` so the user sees a toast / dock entry / progress bar instead of a hung request.

### `@route.*`

Mounts at `/api/v1/modules/{id}/<path>`. The HTTP method comes from the decorator (`route.get`, `route.post`, `route.put`, `route.patch`, `route.delete`).

```python
@route.get("/things/{thing_id}")
async def get_thing(self, ctx: ModuleContext, thing_id: str) -> Thing: ...
```

Path parameters and request bodies use FastAPI semantics. Pydantic models for request/response are first-class.

### `@on_event(topic)`

Subscribes to a bus topic. Topics are dotted strings; wildcards are not supported on the subscriber side — subscribe to the exact topic you care about.

Built-in platform topics include `log.imported`, `log.deleted`, and `job.queued|started|progress|completed|failed|cancelled`. Module-emitted topics are namespaced by module id (`my_module.something`).

### `@job(...)`

Stack `@job` on top of a `@route` or `@on_event` handler to make it asynchronous and observable.

| Param | Default | Effect |
|---|---|---|
| `progress` | `False` | Enables `ctx.progress.update(...)` streaming. |
| `title` | derived | Toast + drawer headline. May be a `(ctx, payload) -> str` callable. |
| `subtitle` | derived | Drawer subtitle. |
| `priority` | `0` | Higher = scheduled sooner. |
| `cancellable` | `True` | Whether the *Cancel* button is enabled. |
| `result_url` | `None` | URL template for the toast's *Open* action on success. |

When `@job` wraps a route, the route returns `{ "job_id": "..." }` immediately and the work runs on the platform's queue; the frontend handles the response generically.

---

## 5. `ModuleContext` — what every handler receives

Defined in [`packages/module-sdk-py/src/flows_funds/sdk/context.py`](../packages/module-sdk-py/src/flows_funds/sdk/context.py). All fields are typed Protocols — depend on the Protocol, not the implementation.

```python
@dataclass
class ModuleContext:
    log_id: str                     # the log this invocation is scoped to ("" for global routes)
    module_id: str
    event_log: EventLogAccessProtocol
    bus: EventBusProtocol
    registry: ModuleRegistryProtocol
    cache: ResultCacheProtocol
    config: ModuleConfigProtocol
    progress: ProgressReporterProtocol
    logger: structlog.BoundLogger
    workdir: Path                   # scratch space, auto-cleaned on completion
```

### `ctx.event_log`

Lazy access to the log. Always use the async-context-manager form so the platform can manage file handles and DuckDB connections:

```python
async with ctx.event_log as log:
    rows = await log.duckdb_fetch(
        "SELECT activity, count(*) FROM events GROUP BY 1 ORDER BY 2 DESC"
    )
    df = await log.pandas()         # or .polars(), .pm4py()
```

Prefer DuckDB for aggregations (millions of rows in milliseconds). Use pandas/polars when you need DataFrame semantics. Use `pm4py` only when an algorithm needs the pm4py event log object — it's the heaviest.

### `ctx.cache`

Per-`(log_id, module_id)` result cache. Use it to memoise expensive computations across requests:

```python
if not await ctx.cache.exists("kpis"):
    await ctx.cache.set("kpis", await self._compute(ctx))
return await ctx.cache.get("kpis")
```

Caches are invalidated automatically when the log changes (re-import) or when the module config changes.

### `ctx.config`

User-set configuration, validated against your `config_schema`. Read with `ctx.config.value` (full dict) or `ctx.config.get(key, default)`.

### `ctx.progress`

Inside a `@job(progress=True)` handler, emit progress to the dock + drawer + WebSocket stream:

```python
await ctx.progress.update(0.42, "Computing fitness")
await ctx.progress.update(current=4200, total=10000, stage="replay")
```

### `ctx.workdir`

A temporary directory unique to this invocation. Cleaned automatically on completion.

### `ctx.logger`

A `structlog.BoundLogger` already bound with `module_id` and `log_id`. Use it; `print()` is dropped.

---

## 6. Communicating with other modules

Two patterns. Both are typed.

### (a) Event bus — fire-and-forget, fan-out

```python
# emitter
await ctx.bus.emit("my_module.kpi.computed", {"log_id": ctx.log_id, "kpis": kpis})

# subscriber (in another module)
@on_event("my_module.kpi.computed")
async def react(self, ctx: ModuleContext, payload: dict) -> None: ...
```

Topics you emit must be listed in your manifest's `provides:` (or be one of the platform's built-in topics). Topics you subscribe to must be listed in your `consumes:`. The platform validates this at startup, so missing-dep bugs surface at boot — not at runtime.

Define payload shapes as Pydantic models in your `events.py` and use them on both sides. The bus rejects untyped emits.

### (b) Capability registry — typed RPC for synchronous queries

When you need a result back from another module, use the registry instead of round-tripping through the bus:

```python
if ctx.registry.has("conformance"):
    fitness = await ctx.registry.call("conformance.compute_fitness", log_id=ctx.log_id)
else:
    ctx.logger.warning("conformance not installed; skipping fitness annotation")
```

Capabilities you publish go in `provides:`. Capabilities you call must be in `consumes:` (hard) or `optional_modules:` (soft). The platform refuses to mount a module that calls undeclared capabilities.

Rule of thumb:
- Use the **bus** for "this happened, anyone interested can react." It is one-way.
- Use the **registry** for "I need a value." It is request/response.

---

## 7. Frontend

The platform loads each module's frontend bundle from `modules/<folder>/.dist/` — your panel and widgets are bundled with esbuild at platform startup, not as part of the Next.js build. You don't import anything from `apps/web`.

### Panel

`manifest.frontend.panel` is the entry rendered on `/processes/{logId}/modules/{moduleId}`. Minimum shape:

```tsx
// modules/<folder>/panel/index.tsx
import type { ModulePanelProps } from "@flows-funds/module-sdk-ts";

export default function Panel({ logId, moduleId, config }: ModulePanelProps) {
  // render whatever you want; common building blocks (process visualiser,
  // KPI card, ECharts wrapper, time-window picker) come from the TS SDK
  return <div>...</div>;
}
```

Use the shadcn-themed building blocks in `@flows-funds/module-sdk-ts` rather than re-implementing tables, KPI cards, charts. They consume the same CSS variables as the host app, so light/dark and density switches just work.

### Widgets

Widgets advertised in `manifest.frontend.widgets` can be embedded by other modules:

```tsx
import { useWidget } from "@flows-funds/module-sdk-ts";

const ThroughputChart = useWidget("performance", "throughput-chart");
return <ThroughputChart logId={logId} config={{}} />;
```

`useWidget` lazy-loads, renders a `Skeleton` while loading, and a placeholder card if the source module is missing.

### Talking to your backend

Use the platform fetch helper — it injects the auth/session correctly and respects the API base URL:

```tsx
import { api } from "@flows-funds/module-sdk-ts";
const kpis = await api.get(`/api/v1/modules/${moduleId}/kpis?log_id=${logId}`);
```

For real-time updates, subscribe to the `WS /events` stream filtered by your topic:

```tsx
import { useEvents } from "@flows-funds/module-sdk-ts";
useEvents(["my_module.kpi.computed"], (env) => { ... });
```

---

## 8. Dependencies & isolation

### Python

The platform creates and owns `modules/<folder>/.venv`:

- On every boot, the platform hashes your `dependencies` block. If unchanged, it skips `uv sync` — boots are near-instant.
- Your code resolves imports against `.venv/site-packages` first, then stdlib, then the platform's `inherit` set, then the SDK. Other modules' dependencies are not visible.
- If your manifest sets `isolation: subprocess`, the platform spawns a long-lived worker process from your venv and proxies handler calls over a Unix-socket JSON-RPC. The `ModuleContext` interface is unchanged. Use this only when you have a hard native-lib conflict (e.g. `numpy 1.x` while the platform ships `numpy 2.x`); it adds 5–50 ms per call.

### npm

`pnpm install --dir modules/<folder>` runs at startup. Bundles land in `.dist/`. Same isolation story — your widgets bundle against your own `node_modules`.

### Don't touch

- `apps/api/pyproject.toml` and `apps/web/package.json` are off-limits to module authors. If a module modifies them, that's a bug. Your dependencies belong in your manifest.

### `.gitignore` per module

```
.venv/
.dist/
node_modules/
__pycache__/
```

Commit `manifest.yaml`, `module.py`, your tests, your frontend sources, and `uv.lock`.

---

## 9. Lifecycle a module goes through

1. **Discovery.** On boot the platform scans `modules/*/manifest.yaml` (one level deep) and any installed Python entry points exposing `flows_funds.modules`.
2. **Validation.** Manifests parsed; dep graph built; cycles or missing hard deps abort startup.
3. **Materialise dependencies.** `uv sync` per module if its dep hash changed; same for the JS bundle.
4. **Topological load.** Hard-dep order. Your module's `Module` subclass is instantiated once.
5. **Mount.** Routes registered at `/api/v1/modules/{id}/*`, `@on_event` handlers subscribed, `@job` handlers registered with the queue.
6. **Per-log gating.** When a log is opened, the platform re-evaluates `requirements.event_log` against that log's schema. Your card renders as **available** or **unavailable** with a tooltip explaining what's missing.
7. **Hot reload (dev).** Watchdog on `modules/` re-loads changed files without a platform restart. Manifest dep changes trigger an in-place `uv sync` for that module only.

If a module fails to load (manifest error, install error, import error), the failure is reported on the per-module card and in `/settings/modules/{moduleId}` — the rest of the platform stays up.

---

## 10. Testing

Put pytest tests in `modules/<folder>/tests/`. The SDK ships test helpers that build a fake `ModuleContext` against a temporary log directory:

```python
# modules/my_module/tests/test_handlers.py
import pytest
from flows_funds.sdk.testing import build_test_context, sample_log

from modules.my_module.module import MyModule


@pytest.mark.asyncio
async def test_get_kpis():
    log = sample_log(rows=1000)
    ctx = await build_test_context(log_id=log.id, module_id="my_module")
    out = await MyModule().get_kpis(ctx)
    assert "throughput" in out
```

Run them from the repo root:

```
uv run pytest modules/my_module/tests
```

The platform's CI also runs every module's tests against the platform's `inherit` set, catching version drift early.

---

## 11. Distribution

Three channels are supported by the *Settings → Modules → Import* flow:

1. **Zip / tarball** — drop `modules/<folder>/` into a `.zip` or `.tar.gz`.
2. **Git URL** — repo root must contain the module folder layout from §2.
3. **PyPI / npm** — publish a Python package exposing the `flows_funds.modules` entry point. The platform discovers it without copying files into `modules/`.

For the first two, the platform unpacks into `modules/<id>/`, runs `uv sync`, runs the JS bundle step, and mounts. Failures roll back cleanly — a half-installed folder is deleted.

---

## 12. Author checklist

Before submitting a module:

- [ ] `manifest.yaml` validates (run `uv run python -c "from flows_funds.sdk import Manifest; Manifest.load_yaml('modules/<folder>/manifest.yaml')"`).
- [ ] `id` matches between `manifest.yaml` and `module.py`.
- [ ] Every emitted bus topic is in `provides:`; every subscribed topic is in `consumes:`.
- [ ] Every `ctx.registry.call(...)` target is in `consumes:` or `optional_modules:`.
- [ ] No imports from `apps/api/*` or `apps/web/*` — only `flows_funds.sdk` and `@flows-funds/module-sdk-ts`.
- [ ] Long operations use `@job(progress=True)`.
- [ ] Sync `def` handlers are fine — don't reach for `asyncio.run` or `loop.run_until_complete`. The SDK auto-wraps.
- [ ] Tests run green against the platform's `inherit` versions.
- [ ] No platform-level files modified (`apps/api/pyproject.toml`, `apps/web/package.json`, etc.).
- [ ] `.venv/`, `.dist/`, `node_modules/` gitignored.

If all of those hold, dropping the folder into `modules/` and restarting is enough — the module is live.
