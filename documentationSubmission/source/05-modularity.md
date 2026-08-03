# Modularity as an Architectural Principle

## Design Goals of the Extension Mechanism

Design goal G3 of §3.5 stated the requirement this chapter implements. Three properties follow from the gap analysis.

**Extension without core modification.** Adding an analysis method must not require editing any file under `apps/api` or `apps/web`. Every core edit is something a maintainer must review, merge and carry forward, and it is the mechanism by which the open-source server tools of §3.3 turn a local extension into a fork. **Dependency independence between extensions.** Two modules must be able to depend on incompatible versions of the same library and both work; this is not hypothetical, since one bundled module pins NumPy 1.26 and TensorFlow, another needs a conflicting SciPy range, and a third brings a package installable only from a Git URL. **An authoring contract satisfiable without understanding the platform.** The author of a drift-detection method understands drift detection; they should not need FastAPI dependency injection, asyncio scheduling, DuckDB pooling or React context propagation to make their method usable.

To these is added a self-imposed constraint doing more work than the three combined:

> **The platform's own analytical functionality uses the same contract as third-party code. There are no internal hooks reserved for first-party modules.**

The justification is epistemic. A contract its authors need not use is one whose inadequacies are invisible: whenever it fails to express something, the first-party author reaches past it and the gap is never recorded. When every capability the platform ships must be expressible in the contract, each inadequacy stops the platform's own development until it is fixed. This is why discovery is a folder under `modules/` rather than a package under `apps/api`, and it is the strongest evidence of sufficiency available short of a controlled study with external authors, which §10.4 concedes was not conducted.

## The Module Contract

A module is a folder containing two required files.

`manifest.yaml` **is the registration.** It declares identity, the works it implements with full citations, what the log must look like for the module to apply, what other modules it needs as hard or soft dependencies, what it publishes and consumes on the bus, its dependencies and isolation level, and its frontend contributions. There is no `register()` call; the manifest is the whole registration, validated on load so manifest errors fail loudly at startup rather than quietly at first use. Appendix B is the field-by-field reference.

`module.py` **is the implementation.** It contains exactly one subclass of `Module`, whose class attribute `id` must match the manifest, and which the loader instantiates **once per process**. Handlers are ordinary methods carrying one of three decorators: `@route.*` mounts an HTTP endpoint in the module's namespace with full FastAPI semantics, `@on_event(topic)` subscribes to a bus topic, and `@job(...)` stacks on either to make the handler a persisted, observable, cancellable job returning a job identifier immediately.

Handlers may be `async def` or plain `def`, and neither can block the event loop. The mechanism leans on existing machinery where it exists: `@route` handlers are real FastAPI routes and inherit Starlette's threadpool for synchronous functions, while `@on_event` and `@job` run outside the request lifecycle and are auto-wrapped by the SDK. The wrapping is invisible, a safety net rather than an API, so an author who has never heard of it writes correct code either way.

Every handler receives a `ModuleContext` exposing the log and module identifiers; `event_log` for data access; `open_event_log` for the one sanctioned way to read a second log; `cache`, scoped to the pair of log and module; `config`; `progress`; `bus`; `registry`, for typed calls into other modules; `logger`, pre-bound with both identifiers; and `workdir`, a scratch directory the loader removes after every invocation whether the handler succeeded or not.

The decision worth stating is that **every context facility is typed as a Protocol, not a concrete class**. Three things follow. The platform can change how event data is fetched, or where the cache lives, without touching a module. The same handler code runs unmodified whether the context is the real in-process object or the proxy a bridged worker sees across a socket (§5.5), so the transport is genuinely hidden rather than merely documented as hidden. And a module can be unit-tested against a fabricated context built by the SDK's own helpers, with no running platform, database or real log.

## Discovery, Dependency Resolution, and Materialisation

Startup proceeds in six steps.

**Discovery.** The platform scans `modules/*/manifest.yaml` one level deep and inspects installed Python distributions exposing a `mate.modules` entry point, so a module may be distributed as a package rather than a folder. The directory is flat and folder names are arbitrary; only the manifest's `id` is authoritative, and a duplicate identifier is a startup error. **Validation.** Manifests are parsed and the dependency graph built; a cycle or a missing hard dependency aborts startup, because a partially satisfied graph produces failures at arbitrary later moments that are far harder to diagnose than a refusal to boot. **Materialisation.** Each module's toolchain is prepared *inside its own folder*: for Python, a virtual environment with the declared packages installed. The dependency block is content-hashed and cached, so a boot where nothing changed skips installation and starts in seconds. For in-process modules the hash also folds in the platform's Python version, so an environment built under a different interpreter rebuilds automatically instead of crashing on import. In parallel the web-side bundler compiles each module's declared panel and widgets.

**Topological mounting.** Modules load in hard-dependency order, each class instantiated once, routes registered under `/api/v1/modules/{id}/`, event handlers subscribed, job handlers registered and capabilities published. **Per-log gating.** When a log is opened, each module's requirements are re-evaluated against it: the log-model check runs first, so case-centric and object-centric modules never appear for the wrong kind of log, and the column and minimum-size checks then decide availability, with the interface explaining what is missing. **Hot reload in development.** A filesystem watcher reloads changed modules without restarting the platform, gated to the development environment so production boots always run with a known module set.

Why per-module resolution rather than one shared environment? Because a shared environment makes the set of installable modules a function of which other modules are installed, which is exactly what makes plug-in ecosystems brittle. Under per-module resolution a module's dependency set is a property of the module alone, and a resolution failure is contained: the failing module is marked failed to load with the resolver's own error text on its card, and the rest of the platform starts. The cost is disk and time. A module inheriting the heavy shared libraries adds tens of megabytes; one bringing its own numerical stack adds hundreds, and the module bundling TensorFlow adds roughly half a gigabyte. First boot is correspondingly slow, several minutes on a clean checkout, which is why the API container carries a ten-minute health-check grace period and why the documentation warns explicitly: users who are not told will conclude the system has hung.

The `inherit` mechanism blunts the disk cost. Most modules need PM4Py, pandas, polars, NumPy and DuckDB, and reinstalling those per module wastes hundreds of megabytes for no benefit. Listing them under `inherit` makes them importable from the platform's environment without reinstallation, while anything not inherited stays fully isolated. Declaring a package as inherited *and* pinning a different version of it is a manifest error caught at startup.

## Isolation Levels and Their Trade-offs

**In-process** is the default. The module is imported into the platform's interpreter, with a custom import finder resolving its imports against its own environment first, then the standard library, then the inherited set, then the SDK. It sees neither other modules' dependencies nor the platform's beyond what it inherited, and calls are ordinary Python calls.

The constraint is that in-process modules are **ABI-locked to the platform's interpreter**, currently 3.12, and their environments are always built on exactly that Python. A manifest's `requires-python` is therefore a **validation gate, not an interpreter selector**: if the platform's interpreter does not satisfy it, the module refuses to load with an actionable message instead of failing later with a cryptic extension-module error. The corollary is easy to get wrong: hand-pinning an upper bound such as `<3.13` to dodge a suspected ABI mismatch achieves nothing, because the platform already pins the interpreter.

**Subprocess** runs the module in a long-lived worker on its own interpreter, selected from `requires-python` and downloaded by the package manager if absent, with handler calls proxied over a Unix-socket JSON-RPC channel. The decision rule is narrow and should be applied literally:

> Choose subprocess isolation when, and only when, the module needs a **different Python version** than the platform, or has a **native-library conflict that cannot be reconciled** with the platform's own, such as requiring NumPy 1.x while the platform ships 2.x.

Everything else, including a large dependency tree or a long computation, is not a reason: the process pool exists for CPU-bound work, and dependency isolation is already provided in-process. The costs are real: roughly 5 to 50 milliseconds per call; no `inherit`, because there is no shared interpreter across a process boundary, so inherited names are installed into the module's own environment; best-effort rather than immediate cancellation; static rather than dynamic job titles; and no `open_event_log`, so a bridged module cannot read a second log.

Data movement deserves its own note, because the naive design fails. Arguments, return values and cache writes travel as JSON over the socket. DataFrames do not: `pandas()`, `polars()` and `pm4py()` inside a worker are served by writing the requested view to a **Parquet file on the shared filesystem** and passing its path, so the worker reads it with its own libraries at full speed. Sending a DataFrame through the socket would mean serialising megabytes of numeric data as JSON, and the original implementation hit exactly the wall that predicts (§4.10).

[[TABLE]]
caption: The two isolation levels and when each applies.
| Property | in_process (default) | subprocess |
| --- | --- | --- |
| Interpreter | The platform's, currently 3.12 | The module's own, chosen by `requires-python` |
| `requires-python` acts as | Validation gate | Interpreter selector |
| Call overhead | None (direct call) | Approximately 5 to 50 ms per call |
| `inherit` shared libraries | Yes, no reinstall | No, installed into the module's own environment |
| DataFrame access | Direct | Parquet handoff on the shared filesystem |
| `open_event_log` | Available | Not proxied |
| Cancellation | Cooperative, immediate | Best effort |
| Choose it when | Always, unless the row below applies | A different Python version, or an irreconcilable native-library conflict |
[[/TABLE]]

## Polyglot Modules and the Host–Worker Protocol

The bridge carrying subprocess isolation is not Python-specific, which is where the extension mechanism stops being a Python plug-in system. A manifest may declare a `runtime` block instead of Python dependencies, naming a non-Python execution kind, and the module mounts through the same bridge.

The platform's side is organised around a runtime abstraction owning exactly two seams: `materialize` prepares and validates the module's toolchain artefacts, and `launch_spec` returns the argument vector, environment and working directory used to spawn the worker. Everything downstream of the worker socket is runtime-agnostic, speaking JSON and Parquet and never language objects.

**The JVM is the reference implementation**, chosen because the process mining research ecosystem, ProM above all, is Java, and wrapping an existing Java algorithm is the intended use. A JVM module ships as a self-contained fat jar; there is deliberately **no server-side dependency resolution**, no Maven or Gradle at load time, because reproducing a second language's resolver inside the platform would multiply the failure surface for little gain. Materialisation only validates: a runtime present and new enough, the declared jar present, and the jar runnable. A Java runtime is baked into the API image, so no toolchain is needed on the deployment host, and the jar is committed, so no build step is needed at deployment.

The wire protocol is a specification rather than prose, because a second implementer needs a specification. It fixes the process-launch contract including a mandatory parent-death guard, the newline-delimited JSON framing, the handshake in which the worker announces its handlers, the three host-to-worker methods, the context methods the worker may call back, error and cancellation semantics, and a conformance checklist. Conformance is tested rather than asserted: a cross-runtime suite exercises the same behaviours against every runtime, and a golden-file test pins the exact wire messages so a protocol change cannot pass unnoticed. Node and R runtimes are **reserved by design and rejected at present**; the manifest's runtime kinds are a closed set, so declaring an unimplemented kind fails at load with a clear message.

## Inter-Module Communication

Modules never call each other directly. **The event bus** carries asynchronous, fire-and-forget notification with fan-out: a module emits a topic with a payload and any number of modules may subscribe. Emitted topics must be declared in `provides` and subscribed topics in `consumes`, validated at startup, so a module reacting to an event nobody emits, or emitting one it never declared, is caught at boot rather than becoming a silent no-op in production. Payload shapes are Pydantic models enforced per topic at publish time. **The capability registry** carries synchronous, typed request and response, and also answers whether a capability is present, so a module can degrade gracefully: the performance module computes metrics per discovered activity when discovery is installed and falls back to raw activity labels when it is not. The registry is user-scoped, so a call only reaches modules the calling user has installed.

The decision worth defending is that **ordering between precomputing modules is an event subscription, not a priority field**. A numeric `precompute_order` is worse in three ways. A number expresses *when* rather than *why*, so nothing records that a module runs later because it needs discovery's output, and the reason is what a future maintainer needs. Numbers do not compose: two modules each needing discovery have no principled way to choose values relative to each other. And a number cannot express failure semantics, whereas an event simply not emitted when its producer fails gives cascade-skipping for free (§4.8). Subscribing to `discovery.completed` says what is meant, composes transitively, and degrades correctly. The producer does nothing: the platform emits `<module_id>.completed` automatically when a precompute job succeeds, so ordering is a decision the *consumer* makes without the upstream module knowing it has dependants.

## User Interface Extension through Panels

A module contributes interface by declaring a panel entry point and optionally reusable widgets, bundled separately from the main application build and served by the API under the module's namespace; the host loads a panel lazily, executing the bundle with a small loader that resolves its imports from a shared runtime object. The mechanism solves a specific problem: a panel must share the host's React instance, query client and component primitives, or hooks and context will not flow across the boundary and every panel would ship its own copy of the component library. So every shared dependency is external at bundle time and resolved at run time from the host.

The constraint this imposes is an **explicit allow-list of importable platform paths**, deliberately small and stable: the HTTP helpers, the live-stream subscribers, formatting utilities, the widget and canvas kits, the drill-down helpers and the visualisation-settings store. Two properties motivate it. The platform can refactor everything not on the list without breaking third-party panels, which is what makes evolving a large frontend possible while third-party code exists against it. And the list is a single file read by both the bundler and the runtime installer, with a test asserting they never diverge, so it cannot rot into a lie. The failure mode confuses new authors and is stated again in §8.7: importing outside the allow-list produces a **build failure, not a runtime error**.

## Ownership, Installation, and Lifecycle

Modules are shared code but **per-user installations**. The code lives once on disk, under `modules/` for bundled defaults or a separate uploads directory for user-installed ones, so an upload can never overwrite or shadow a default. What is per-user is the *installation*: a table records who has what, enablement is reference-counted, every user is seeded the default set on first login, and uninstalling is user-scoped and reversible with a restore-defaults action.

Three consequences follow. A module must not assume it is globally enabled, because the user making a request may not have it, and any cross-module interaction only reaches modules that user has. The precompute closure of §4.8 is intersected with the importing user's installed set, so two users importing the same file may legitimately wait for different analyses. And uninstalling is cheap and safe.

## Trust and Security Model for Third-Party Modules

Overstating isolation would be the most damaging inaccuracy in this report, so this section states what it does and does not guarantee.

**What isolation provides.** Dependency isolation is complete: a module cannot see another's packages, break another by upgrading a shared library, or corrupt the platform's environment. Process separation, when elected, contains a crash, a memory blow-up or a native segmentation fault to the worker, recovered by respawning. Failure isolation at load time means a module whose dependencies do not resolve does not prevent startup. Result isolation means a module writing through its context cache writes to a per-user, per-log location and cannot reach another tenant's data through the sanctioned interfaces.

**What isolation does not provide.** None of this is a **security sandbox against a malicious author**. An in-process module executes inside the platform's process with the platform's privileges: it can read and write any file that process can reach, including other users' Parquet data and the metadata database, open network connections, and import whatever it likes. Subprocess isolation moves the code to a different process but not to a different security principal, since the worker runs as the same operating-system user, on the same filesystem, with the same reachable network. There is no seccomp profile, no container per module, no capability dropping and no filesystem namespace.

**The operational consequence** must be stated to operators rather than left implicit: **installing a module is a trusted action, equivalent to running code on the server.** An administrator can restrict installation to administrators, which is the appropriate posture for an installation with untrusted users. This report's extensibility claim is a claim about **dependency and failure isolation, not adversarial containment**, and §11.1 records the gap as an architectural limitation rather than an oversight.

## Deliberate Limitations of the Module Model

Five boundaries are built into the design. Naming them here rather than discovering them in the evaluation is what makes Chapter 10 a verdict rather than a defence.

**Single-node execution.** A module runs on the host that received the request; there is no scheduling across machines. This follows from G1, since distributing modules would need a broker.

**One instance per process.** The `Module` subclass is instantiated once, so handlers must hold no request-scoped state. This buys a trivial lifecycle with no initialisation ordering problems, at the cost of a rule authors must know and the interface cannot enforce.

**No versioned coexistence.** Two versions of one module identifier cannot load at once. Supporting it would need versioned routing, capability names and event topics, which is a large amount of machinery for a situation that has not arisen.

**No per-module resource quotas.** There is no memory ceiling, CPU share or disk budget per module. The controls that exist are platform-wide: worker concurrency, a job execution timeout, DuckDB thread and memory limits, and a per-user storage budget. A module allocating without bound degrades the whole instance.

**A frozen precompute closure per import.** The set of modules a log waits for is fixed when the import begins, so a module installed midway does not join that import's closure and a log imported before a module existed does not retroactively acquire its results. This is the price of the determinism argued for in §4.8.
