# Developing a New Module: A Practical Walkthrough

Chapter 5 stated the contract and Chapter 6 showed that the platform's own authors could satisfy it. Neither shows that a reader can. This chapter is a followable tutorial producing one small but complete module, and every step cites the subsection of Chapter 5 that motivates it. Appendix B is the reference.

## Development Environment for Module Authors

Clone the repository, install both toolchains with `make install`, and start one of the reload-capable modes; the clone-and-start sequence is §7.2. `make dev` is the right mode for module work: both dev servers run on the host, so a change to `module.py` restarts the API in seconds and a change to a panel is picked up by the bundler's watch mode with no rebuild. `make up-dev` gives the same reload inside containers and is preferable only when the module needs something the containers provide, such as the bundled Keycloak or a sidecar.

One decision must be made first, because it determines the loop length for the rest of the chapter: **will the module run on the platform's interpreter, or its own?** §8.3 gives the rule; the default answer is the platform's.

## Scaffolding a Module

The minimum viable module is a folder, a manifest and a class. Create `modules/my_module/` with the required manifest fields only:

```yaml
id: my_module
name: My Module
version: 0.1.0
category: advanced
description: One-line summary shown on the module card.
license: MIT

requirements:
  event_log:
    log_model: case_centric
    required_columns: [case_id, activity, timestamp]

provides: []
consumes: [log.imported]
```

`id` is lowercase snake_case and globally unique; the folder name is arbitrary (§5.3). `requirements.event_log` is what the per-log gate evaluates, and `consumes` must list every subscribed topic, validated at startup (§5.6).

Then `modules/my_module/module.py`:

```python
from mate.sdk import Module, ModuleContext, route


class MyModule(Module):
    id = "my_module"

    @route.get("/summary")
    async def summary(self, ctx: ModuleContext) -> dict:
        async with ctx.event_log as log:
            rows = await log.duckdb_fetch(
                "SELECT activity, count(*) AS n FROM events GROUP BY 1 ORDER BY 2 DESC"
            )
        return {"activities": rows}
```

That is a complete module: exactly one `Module` subclass, its `id` matching the manifest, instantiated once per process by the loader (§5.2). There is no registration call, because the manifest is the registration. Restart, and two confirmations tell an author it worked, which matters because recognising success before writing anything substantial saves confusion: the API logs a mount line for the module id, and the module appears under **Settings, Modules** with status *Active*. On failure the same page shows the error, and the rest of the platform is unaffected.

## Declaring Dependencies and Selecting an Isolation Level

Dependencies belong in the manifest and **never** in the platform's project files; editing them from a module is a bug, not a shortcut (§5.1).

```yaml
dependencies:
  python:
    requires-python: ">=3.12"
    packages:
      - "scikit-learn>=1.5"
    inherit: [pm4py, pandas, duckdb, numpy]
    isolation: in_process
```

The loader hashes this block, creates an environment inside the module folder and installs `packages`. On any later boot with an unchanged hash the install is skipped (§5.3). `inherit` makes libraries importable from the platform's environment without reinstalling, which keeps a module's disk cost at tens rather than hundreds of megabytes; inheriting and pinning the same package is a manifest error. If resolution fails, the module is marked failed to load with the resolver's own message and nothing else is affected.

Then apply §5.4's rule literally: **in-process by default; `subprocess` only for a different Python version or an irreconcilable native-library conflict.** Two consequences should be present in the author's mind when choosing it: each handler call costs roughly 5 to 50 milliseconds, so a module making many small calls should not be bridged; and `inherit` stops applying, so the inherited libraries are installed into the module's own environment. DataFrame access still works, served by a Parquet handoff rather than the socket.

One trap deserves naming. For an in-process module, `requires-python` is a **validation gate, not an interpreter selector** (§5.4). Hand-pinning an upper bound such as `<3.13` accomplishes nothing, because the platform already pins the interpreter. Declare `requires-python` only when the dependencies genuinely cannot run on a newer Python, so the gate turns that into a fast, clear failure.

## Implementing Handlers

Three handler kinds, in the order an author needs them.

**A job handler**, for anything expected to take more than a few seconds:

```python
@route.post("/recompute")
@job(progress=True, title="My Module - recompute")
async def recompute(self, ctx: ModuleContext) -> dict:
    await ctx.progress.update(0.0, "Loading log")
    async with ctx.event_log as log:
        df = await log.pandas()
    await ctx.progress.update(0.5, "Computing")
    result = self._reduce(df)
    await ctx.cache.set("result", result)
    return result
```

The route now returns a job identifier immediately, the work runs on the platform's queue, and the frontend surfaces it as a toast, a dock entry and a drawer row.

**An event subscription**, to react to imports or to another module; topics are exact dotted strings with no subscriber-side wildcards. **An HTTP route**, to serve results to the panel, mounting at `/api/v1/modules/{id}/<path>` with full FastAPI semantics. Handlers may be `async def` or plain `def`; synchronous ones cannot block the event loop, because routes ride FastAPI's threadpool and event and job handlers are auto-wrapped by the SDK (§5.2).

The constraint easiest to violate deserves its own sentence, because nothing enforces it: **the module class is instantiated once per process, so handlers must hold no request-scoped state on `self`.** Caching a DataFrame or a model on the instance during one invocation and reading it in the next is a correctness bug under concurrency, and it is exactly the pattern ported research code arrives with (§6.3). State that should persist belongs in `ctx.cache`.

## Working with the Event Log and the Result Cache

A handler reaches data through the context, never the filesystem, always through the async context-manager form so the platform can manage file handles and pooled connections:

```python
async with ctx.event_log as log:
    rows = await log.duckdb_fetch("SELECT activity, count(*) FROM events GROUP BY 1")
    df   = await log.polars()          # or .pandas(), .pm4py()
```

Choosing among the three representations is consequential. **Aggregate in the columnar engine**: a `GROUP BY` over millions of events is milliseconds in DuckDB and seconds plus a large allocation as a DataFrame. **Materialise a DataFrame only when the algorithm requires DataFrame semantics**, and reach for the PM4Py event log object only when an algorithm needs that object, because it is by far the heaviest.

Reading a *second* log has one sanctioned route, `ctx.open_event_log(log_id, filters)`, which enforces the ownership check itself and reports another user's log as not found rather than as forbidden, so its existence is never confirmed. Reaching into platform internals to open a log directly bypasses that check and is the single most damaging thing a module can do to §4.5's invariant. The `filters` argument is what makes *the same log twice* meaningful, which is why a module memoising a cross-log result must hash **every** view's log identifier and filter into the cache key.

`ctx.cache` is scoped to the pair of log and module and invalidated automatically when the log is re-imported or the configuration changes. What must **not** happen is writing results anywhere else: a module writing to a path of its own choosing has stepped outside the per-user directory layout and therefore outside tenant isolation, so the file is no longer keyed by the owning user, removed when the log is deleted, or covered by the storage budget. `ctx.workdir` exists for temporary files and is removed after every invocation.

## Progress Reporting and the Readiness Gate

Progress takes three forms, none requiring the total in advance:

```python
await ctx.progress.update(0.42, "Computing fitness")        # fraction -> percentage bar
await ctx.progress.update(current=4200, total=10000)        # counts  -> bar plus an ETA
await ctx.progress.update(current=processed)                # counter -> "n processed"
```

A float in the unit interval with no total is a fraction; an integer `current` is a running counter. Reporting nothing is permitted: the job runs with an indeterminate bar and, after about three minutes of silence, a stall hint. It is a guideline rather than a gate (§4.8), but a long job should emit something live.

Participation in the readiness gate follows from the decorators, and there is a trap. Subscribing to the import topic **with a `@job`** places the module in the precompute closure, so a freshly imported log stays in `processing` until this job reaches a terminal state (§4.8). Declaring a dependency on another module's completion event orders the two:

```python
@on_event("discovery.completed")
@job(progress=True, title="My Module - overlays")
async def precompute(self, ctx, payload): ...
```

with `consumes: [discovery.completed]` and `optional_modules: [discovery]` in the manifest so the edge validates and appears in the jobs UI. The upstream module does nothing; the platform emits the completion event automatically.

The trap, stated explicitly: **an `@on_event` handler without a `@job` creates no job record and therefore never gates anything.** It is a fire-and-forget hook appropriate for a cheap cache refresh, and it appears in neither the precompute plan nor the jobs UI. An author who intends to hold a log until their analysis is ready, and omits `@job`, gets a log that becomes ready immediately and a panel that is empty when the user opens it.

## Contributing a Frontend Panel

A module ships interface by declaring an entry point:

```yaml
frontend:
  panel: ./panel/index.tsx
  widgets:
    - id: activity-table
      entry: ./widgets/ActivityTable.tsx
```

The panel is a React component receiving the log and module identifiers, bundled by the platform's own script outside the Next.js build (§5.7). The constraint is the **allow-list of importable platform paths**: `@mate/module-sdk-ts` and the listed host paths, covering the HTTP helpers, the live-stream subscribers, formatting utilities, the shared widget and canvas kits and the drill-down helpers, and nothing else from the platform's source tree. The allow-list protects the platform's ability to refactor everything not on it, and it is a single file read by both the bundler and the runtime installer with a test asserting they never diverge.

The symptom of ignoring it is the most common frontend obstacle for new authors and is not what they expect: the import produces a **build failure, not a runtime error**, because it is neither marked external nor resolvable within the module. This is the better failure, since it happens on the author's machine, but it is confusing to someone who has just written an import that works everywhere else in the repository.

## Testing and Verification

Three verification layers exist, and it matters which need extra toolchains.

**Module-local tests** live in `modules/<folder>/tests/` and run against the module's own environment. The SDK ships helpers building a fabricated `ModuleContext` over a temporary log directory, so a handler can be tested with no running platform, database or Keycloak: `uv run pytest modules/my_module/tests`.

**Platform gates** are `make test` for the API suite, `uv run pyright` for strict Python typing, `make fmt` for lint and formatting, and `make typecheck` for the web application. The web type-check covers `apps/web` and does **not** see module panels, which must be checked separately.

**Cross-runtime conformance** applies to non-Python modules. The suite drives the same behaviours against every runtime and a golden-file test pins the exact wire messages. Its JVM cases need the Java SDK built with `make sdk-jvm` and a JDK on the host, and **skip cleanly** when neither is present.

## Packaging, Distribution, and Installation

A finished module either **lives in the repository** as a bundled default, committed under `modules/`, seeded into every user's installed set on first login and included in the platform's own test runs; or it is **distributed** as a zip or tarball, a Git URL, or a published Python package exposing the module entry point, and imported through **Settings, Modules, Import**, with the platform unpacking into a separate uploads directory so an upload can never shadow a repository default. Either way, installation is **per user and reference-counted** (§5.8): the code exists once, and who has it installed is per account. So updates to a distributed module are a re-import rather than a background upgrade, uninstalling is user-scoped and reversible, and no module may assume it is globally enabled.

## A Non-Python Module in Brief

An author whose algorithm is already implemented in another language replaces the Python dependency block with a runtime declaration:

```yaml
runtime:
  kind: jvm
  jar: dist/my-module-all.jar
  requires-java: 17
  jvm-args: ["-Xmx1g"]
```

The build artefact expected is a **self-contained fat jar** inside the module folder: there is no server-side dependency resolution, so everything but the Java runtime must be bundled. Materialisation validates only that a runtime is present and new enough, that the jar exists and that it is runnable. The worker must speak the wire protocol documented in `modules/PROTOCOL.md`, which the platform's Java SDK implements, so an author subclasses the SDK's module type and declares handlers exactly as a Python author does. The reference implementation to copy from is `modules/alpha_miner_java`, whose entire module folder is a manifest, a README and a jar. §5.5 gives the design rationale and the protocol document the wire-level detail.

## Common Failure Modes

The mistakes observed during the project, with the symptom an author actually sees.

[[TABLE]]
caption: Common authoring failure modes, their causes and remedies.
| Symptom | Cause | Remedy |
| --- | --- | --- |
| Module absent from Settings, Modules after a restart | Manifest failed to parse, or the folder is not one level under `modules/` | Read the load error on the modules page; validate the manifest before restarting |
| Module marked failed to load with a resolver error | Dependency resolution failed: a bad specifier, an unreachable index, or no wheel for the platform | Fix the specifier. The rest of the platform is unaffected, so only this module is down |
| Module loads locally and fails to import in the container | The environment was built under a different interpreter than the platform's | Nothing to do: the platform's Python version is part of the dependency hash, so the environment rebuilds itself (§5.3) |
| Module refuses to load with a Python-version message | `requires-python` excludes the platform's interpreter, and the module is `in_process` | Either drop the constraint, since the platform pins the interpreter, or switch to `subprocess` if a different version is genuinely needed (§8.3) |
| Panel does not build | An import outside the allow-list | Import from `@mate/module-sdk-ts` or a listed host path only. This is a **build** error, not a runtime one (§8.7) |
| A registry call or an event never arrives | The module is not installed for *this* user, or the topic is undeclared | No module may assume it is globally enabled (§5.8); declare every topic in `provides` or `consumes` |
| An event reaches other users' sessions | The emitted envelope omits `user_id` | Always include the tenant claim. The omission is silent: nothing crashes and nothing warns (§4.5) |
| The log becomes ready before the analysis has run | The import subscription has no `@job`, so it creates no job record and gates nothing | Stack `@job` on the `@on_event` handler (§8.6) |
| A log stays in `processing` indefinitely | A precompute job neither succeeds nor fails, for instance an infinite loop | The job execution timeout force-stops it; the gate then releases, because any terminal status counts (§4.8) |
| Results appear for the wrong filtered view | A cross-log result was memoised without hashing every view's filter into the key | Include each view's `(log_id, filter)` pair in the cache key (§8.5) |
| Intermittent wrong results under concurrent use | Request-scoped state held on the module instance, which exists once per process | Keep per-invocation state in local variables and persistent state in `ctx.cache` (§8.4) |
[[/TABLE]]

## What the Walkthrough Demonstrates

Read back as evidence, the chapter is a claim about how much platform knowledge the contract requires, and the claim can be made precise.

**The minimal module is two files and about fifteen lines.** No registration, no dependency injection, no lifecycle hooks, no build step.

**The concepts an author must learn are enumerable.** Nine: the manifest as registration; one base class instantiated once per process; three handler decorators; the context object; the isolation decision rule; the cache as the only sanctioned result store; progress as optional; the readiness gate and its `@job` requirement; and the panel allow-list. That fits on a page, which was objective O2.

**What the SDK absorbs** is substantial and mostly invisible: sync-to-async wrapping, dependency resolution and isolation, environment creation and caching, route mounting and namespacing, job persistence and progress streaming, cache scoping and invalidation, tenant keying of every artefact, panel bundling and runtime sharing, and the entire worker bridge for non-Python modules.

**Where the abstraction still leaks** should be stated with the same directness. Four leaks appear in this chapter alone. The once-per-process rule is a correctness constraint the type system does not express and that ported code routinely violates. The gate-versus-selector distinction for `requires-python` is a platform implementation detail an author must nonetheless understand. The `@on_event`-without-`@job` trap has a silent failure mode. And the panel allow-list surfaces as a build error whose message does not name the allow-list. Each is documented, none is enforced, and all four are carried into §10.4 as qualifications on the extensibility claim.
