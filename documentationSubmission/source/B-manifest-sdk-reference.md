# Module Manifest and SDK Reference

The lookup counterpart to Chapter 8. The manifest is validated on load, so every rule below fails at startup rather than at first use.

## Manifest schema

**Identity.** `id` (required, lowercase snake_case, globally unique, must equal the class attribute `id`; a duplicate is a startup error), `name`, `version`, `category` (`foundation`, `attribute`, `external_input`, `advanced`, `comparison`, `other`), `description` (one line, shown on the card), `about` (longer prose on the detail page), `license`, `keywords[]` (helps the assistant route messages; derived from name and description when omitted).

**Provenance.** `source[]`, up to 20 entries of `title`, `fullCitation` and optional `url`. `artifacts[]`, entries of `name` and `url` pointing at reference implementations and datasets.

**Requirements.** `requirements.event_log.log_model` is `case_centric` or `object_centric` and is checked first, so a mismatch hides the module for that log entirely. `required_columns[]`, `min_events` and `min_cases` are availability gates and the interface names what is missing; `optional_columns[]` is not a gate and merely unlocks additional output. `requirements.modules[]` are hard dependencies and a missing one aborts startup; `requirements.optional_modules[]` are `{id, reason}` pairs that the module must degrade gracefully without.

**Bus contract.** `provides[]` lists every capability and topic the module publishes; `consumes[]` lists every topic it subscribes to and capability it calls. Emitting or calling something undeclared is a startup error.

**Dependencies.** `dependencies.python.packages[]` are installed into the module's own environment and may be Git URLs. `inherit[]` names libraries made importable from the platform environment without reinstalling; inheriting and pinning the same package is an error. `isolation` is `in_process` (default) or `subprocess`. `requires-python` is a **validation gate** under `in_process` and an **interpreter selector** under `subprocess`. `dependencies.npm[]` installs into the module's own `node_modules`.

**Runtime.** `runtime.kind` is `python` (default) or `jvm`; any other value is rejected at load. A `jvm` block additionally takes `jar` (folder-relative path to a self-contained fat jar), `requires-java` (default 17, validated at materialisation) and `jvm-args[]`.

**Frontend and output.** `frontend.panel` is the panel entry point; omitting it makes the platform render the module's declared datasets instead. `frontend.widgets[]` entries carry `id`, `entry`, `title`, `description`, `icon`, default and minimum grid size, minimum pixel size measured in the browser, a `help` block with a required `what`, optional `views` and `kpis` so a dashboard placement can show a subset, an optional `drill` declaration, an optional settings entry, and the log models supported. `datasets[]` declares typed outputs the platform renders generically.

**Behaviour flags.** `config_schema` is JSON Schema rendered as a settings form and validated on save. `default_enabled` decides whether the module is seeded into a new user's set. `is_confidential_safe` set false means the module transmits data off the host; it is an **author declaration, not an enforcement**.

## Decorators and job parameters

`@route.get|post|put|patch|delete(path)` mounts under `/api/v1/modules/{id}/`. `@on_event(topic)` subscribes to an exact topic; there are no subscriber-side wildcards. `@job(...)` stacks on either.

[[TABLE]]
caption: Job decorator parameters.
| Parameter | Default | Effect |
| --- | --- | --- |
| `progress` | `False` | Enables `ctx.progress.update(...)` streaming |
| `title` | from handler name | Toast and drawer headline; may be a callable, which falls back to a static label under subprocess isolation |
| `subtitle` | from module and route | Drawer subtitle; same callable form |
| `priority` | `0` | Higher is scheduled sooner |
| `cancellable` | `True` | Whether the cancel action is enabled |
| `result_url` | none | URL template for the toast's open action |
[[/TABLE]]

## Context protocols

Every field is a typed Protocol: depend on the Protocol, not the implementation.

`log_id`, `module_id` identify the invocation; `log_id` is empty for global routes. `event_log` is an async context manager offering `duckdb_fetch(sql)`, `pandas()`, `polars()` and `pm4py()`; aggregate in DuckDB and materialise a DataFrame only when required. `open_event_log(log_id, filters)` is the only sanctioned second-log accessor, enforcing ownership and reporting a foreign log as not found; it is not proxied under subprocess isolation. `cache` offers `get`, `set` and `exists` scoped to `(log_id, module_id)`, invalidated on re-import or config change, and is the only sanctioned result store. `config` offers `value` and `get(key, default)`. `progress` offers `update` in the three accepted forms. `bus` offers `emit(topic, payload)` and subscription. `registry` offers `has(capability)` and `await call(capability, **kwargs)`, user-scoped. `logger` is pre-bound with both identifiers and also feeds the module log tail; `print()` is dropped. `workdir` is a per-invocation scratch directory removed automatically. `run_in_process(fn, *args)` offloads CPU-bound work to the process pool under standard pickling rules.

## Reserved event names

`log.imported` and `ocel.imported` fire after a successful import and are the entry points to the precompute closure. `log.deleted` fires on deletion. `job.queued`, `job.started`, `job.progress`, `job.completed`, `job.failed`, `job.cancelled`, `job.plan`, `job.queue.paused` and `job.queue.resumed` carry the job lifecycle. `<module_id>.completed` is emitted by the platform when that module's precompute job succeeds and is the mechanism for ordering. `module.log.<level>` carries module log lines. Module topics must be namespaced by module id.

## Panel import allow-list

A panel may import from `@mate/module-sdk-ts` and from the host paths on the allow-list: the HTTP helpers, the live-stream subscribers, formatting utilities, the shared widget kit, the canvas shell and control cluster, the drill-down helpers, the settings-scope helpers and the visualisation-settings store. Anything else under the platform source tree is rejected. The list lives in one file read by both the bundler and the runtime installer, with a parity test asserting they never diverge. **Violation is a build failure, not a runtime error.**

## Authoring checklist

Manifest validates and `id` matches between manifest and class, with `log_model` set. Every emitted topic appears in `provides`, and every subscribed topic and called capability in `consumes` or `optional_modules`. No imports from the platform application packages, only the SDKs. Long operations use `@job`, with progress for anything running minutes, and precompute that must run after another module subscribes to that module's `completed` event with a job-backed handler, because an `@on_event` without `@job` gates nothing. Handlers hold no request-scoped state on the instance and do not call `asyncio.run`. Results go through `ctx.cache` and temporary files through `ctx.workdir`. Every graph view uses the shared canvas shell with its controls in the settings popover, and every widget declares `help.what` and minimum pixel sizes measured in the browser and reads correctly at that size. Tests pass against the platform's inherited versions, no platform-level files are modified, and generated directories are gitignored.
