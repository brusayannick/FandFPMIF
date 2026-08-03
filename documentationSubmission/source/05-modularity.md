# Modularity as an Architectural Principle

## Design Goals of the Extension Mechanism

Design goal G3 of §3.5 stated the requirement this chapter implements: extension by contract, with the contract proven by using it internally. Three properties follow from the gap analysis.

**Extension without core modification.** Adding an analysis method must not require editing any file under `apps/api` or `apps/web`. The reason is not tidiness. Every edit to the core is an edit somebody has to review, merge and carry forward, and it is the mechanism by which the open-source server tools of §3.3 turn a local extension into a fork. If a module can be added by placing a folder on disk, the maintainers of the platform are not on the critical path of anyone's research.

**Dependency independence between extensions.** Two modules must be able to depend on incompatible versions of the same library and both work. This is the failure mode that makes shared-classpath and shared-environment models painful in practice, and it is not hypothetical here: one bundled module pins NumPy 1.26 and TensorFlow, another needs SciPy in a range that conflicts with it, and a third brings a package that is only installable from a Git URL.

**An authoring contract satisfiable without understanding the platform.** The author of a drift-detection method understands drift detection. They should not have to understand FastAPI dependency injection, asyncio scheduling, DuckDB connection pooling or React context propagation in order to make their method usable.

To these is added a self-imposed constraint that does more work than the three goals combined:

> **The platform's own analytical functionality uses the same contract as third-party code. There are no internal hooks reserved for first-party modules.**

The justification is epistemic. A contract that its authors do not have to use is a contract whose inadequacies are invisible: whenever the contract fails to express something, the author of first-party code simply reaches past it, and the gap is never recorded. When every capability the platform ships, discovery, performance, conformance, complexity, drift detection, object-centric discovery, must be expressible in the contract, then each inadequacy stops the platform's own development until it is fixed. This is why the discovery module is a folder under `modules/` rather than a package under `apps/api`, and it is the strongest evidence available that the contract is sufficient, short of a controlled study with external authors, which §10.4 concedes was not conducted.

## The Module Contract

A module is a folder containing two required files.

`manifest.yaml` **is the registration.** It declares identity (`id`, `name`, `version`, `category`, `description`, `license`), the works it implements (`source`, with full citations and links to reference implementations), what the log must look like for the module to be applicable (`requirements.event_log`: the log model, required and optional columns, minimum event and case counts), what other modules it needs (`requirements.modules` for hard dependencies, `optional_modules` for soft ones), what it publishes and consumes on the bus (`provides`, `consumes`), its dependencies and isolation level, and its frontend contributions. There is no `register()` call anywhere; the manifest is the whole of the registration, and it is validated on load so that manifest errors fail loudly at startup rather than quietly at first use.

`module.py` **is the implementation.** It contains exactly one subclass of `Module`, whose class attribute `id` must match the manifest, and which the loader instantiates **once per process**. Handlers are ordinary methods carrying one of three decorators. `@route.get`, `@route.post` and their siblings mount an HTTP endpoint under the module's namespace, with full FastAPI semantics for path parameters and Pydantic request and response models. `@on_event(topic)` subscribes to a bus topic. `@job(...)` stacks on top of either to turn the handler into a persisted, observable, cancellable job that returns a job identifier immediately.

Handlers may be written `async def` or plain `def`, and the platform guarantees that neither can block the event loop. The mechanism differs by handler kind and leans on existing machinery where it exists: `@route` handlers are registered as real FastAPI routes and inherit Starlette's threadpool for synchronous functions, whereas `@on_event` and `@job` run outside the request lifecycle and are auto-wrapped by the SDK. The wrapping is invisible: it is a safety net, not an API, and an author who has never heard of it writes correct code either way.

Every handler receives a `ModuleContext` giving access to nine facilities: the log identifier and module identifier for the current invocation; `event_log` for data access; `open_event_log` for the one sanctioned way to read a *second* log; `cache`, a result store scoped to the pair of log and module; `config`, the user's validated settings; `progress`, the reporter; `bus`, for emitting and subscribing; `registry`, for typed calls into other modules; `logger`, pre-bound with the module and log identifiers; and `workdir`, a scratch directory that the loader removes after every invocation whether the handler succeeded or not.

The design decision worth stating is that **every context facility is typed as a Protocol, not as a concrete class**. An author writing against `EventLogAccessProtocol` is writing against a shape, not against the platform's implementation of that shape. Three things follow. The platform can change how event data is fetched, or where the cache is stored, without touching a single module. The same handler code runs unmodified whether the context is the real in-process object or the proxy that a bridged worker sees across a socket (§5.5); the transport is genuinely hidden rather than merely documented as hidden. And a module can be unit-tested against a fabricated context built by the SDK's own test helpers, without a running platform, a database or a real log.

This subsection states the contract normatively. Chapter 8 instantiates it as a procedure a reader can follow.

## Discovery, Dependency Resolution, and Materialisation

Startup proceeds in six steps.

**Discovery.** The platform scans `modules/*/manifest.yaml`, one level deep, and additionally inspects installed Python distributions that expose a `mate.modules` entry point, which allows a module to be distributed as a package rather than as a folder. The directory is flat and folder names are arbitrary; only the manifest's `id` is authoritative, and two modules declaring the same identifier is a startup error.

**Validation.** Manifests are parsed and the dependency graph is built. A cycle or a missing hard dependency aborts startup, because a partially satisfied dependency graph produces failures at arbitrary later moments that are much harder to diagnose than a refusal to boot.

**Materialisation.** Each module's toolchain is prepared *inside the module's own folder*. For a Python module this means creating a virtual environment and installing the declared packages into it. The declared dependency block is content-hashed and the hash cached, so that a boot in which nothing changed skips installation entirely and starts in seconds. For `in_process` modules the hash additionally folds in the platform's own Python version, so that a virtual environment built under a different interpreter, for instance a host-mode environment bind-mounted into the container, is rebuilt automatically rather than crashing on import. In parallel, the web-side bundler compiles each module's declared panel and widgets into the module's output directory.

**Topological mounting.** Modules are loaded in hard-dependency order, each `Module` subclass instantiated exactly once, its routes registered under `/api/v1/modules/{id}/`, its event handlers subscribed on the bus, its job handlers registered with the queue, and its declared capabilities published on the registry.

**Per-log gating.** When a log is opened, each module's `requirements.event_log` is re-evaluated against that log. The log-model check runs first, so that case-centric and object-centric modules never appear for the wrong kind of log; then the column and minimum-size checks decide whether the module is available, with the interface explaining exactly what is missing when it is not.

**Hot reload in development.** A filesystem watcher reloads changed modules without restarting the platform, debounced and excluding writes inside generated directories. It is gated on the development environment so that production boots always run with a known module set.

Why per-module resolution rather than one shared environment? Because a shared environment makes the set of installable modules a function of which other modules are installed, and that is exactly the property that makes plug-in ecosystems brittle. Under per-module resolution, a module's dependency set is a property of the module alone, and a resolution failure is contained: the failing module is marked as failed to load with the resolver's own error text shown on its card, and the rest of the platform starts normally. The cost is disk. A module that inherits the platform's heavy shared libraries adds tens of megabytes; one that brings its own numerical stack adds hundreds, and the module that bundles TensorFlow adds roughly half a gigabyte. First boot is correspondingly slow, several minutes on a clean checkout, which is why the API container's health check carries a ten-minute grace period and why the documentation warns about it explicitly: users who are not told will conclude the system has hung.

The `inherit` mechanism blunts the disk cost. Most modules need PM4Py, pandas, polars, NumPy and DuckDB, and reinstalling those per module would waste hundreds of megabytes for no benefit. Listing them under `inherit` makes them importable from the platform's own environment without reinstallation, while anything not inherited stays fully isolated. Declaring a package as inherited *and* pinning a different version of it in the same manifest is a manifest error caught at startup.

## Isolation Levels and Their Trade-offs

Two execution modes exist, and the choice between them is one of the few genuinely consequential decisions an author makes.

**In-process** is the default. The module is imported into the platform's own interpreter, with a custom import finder resolving its imports against its own environment first, then the standard library, then the inherited set, then the SDK. It sees neither other modules' dependencies nor the platform's own beyond what it inherited. Calls are ordinary Python calls, so there is no serialisation and no inter-process overhead.

The constraint is that in-process modules are **ABI-locked to the platform's interpreter**, currently 3.12. Their environments are always built on exactly that Python. A manifest's `requires-python` for an in-process module is therefore a **validation gate, not an interpreter selector**: if the platform's interpreter does not satisfy it, the module refuses to load with an actionable message instead of failing later with a cryptic extension-module error. The corollary matters for authors and is easy to get wrong: hand-pinning an upper bound such as `<3.13` to dodge a suspected ABI mismatch does nothing useful, because the platform already pins the interpreter.

**Subprocess** runs the module in a long-lived worker process on its own interpreter, selected from `requires-python` and downloaded by the package manager if absent, with every handler call proxied over a Unix-socket JSON-RPC channel. The decision rule is narrow and should be applied literally:

> Choose subprocess isolation when, and only when, the module needs a **different Python version** than the platform, or has a **native-library conflict that cannot be reconciled** with the platform's own, such as requiring NumPy 1.x while the platform ships 2.x.

Everything else, including a large dependency tree or a long-running computation, is not a reason; the process pool exists for CPU-bound work, and dependency isolation is already provided in-process.

The costs are real and should be understood before the choice is made. Each call adds roughly 5 to 50 milliseconds of inter-process overhead, which is negligible for a module that runs one expensive computation and returns a small result and significant for a chatty one. The `inherit` mechanism does not apply, because there is no shared interpreter across a process boundary, so inherited names are installed into the module's own environment and the disk cost rises accordingly. Job cancellation becomes best-effort rather than immediate. Dynamic job titles computed by a callable fall back to a static label. And `open_event_log`, the cross-log accessor, is not proxied at all, so a bridged module cannot read a second log.

Data movement across the boundary deserves its own note, because the naive design fails. Handler arguments, return values and cache writes travel as JSON over the socket. DataFrames do not: `pandas()`, `polars()` and `pm4py()` inside a worker are served by writing the requested view to a **Parquet file on the shared filesystem** and passing its path, so the worker reads it with its own libraries at full speed. Sending a DataFrame through the socket would mean serialising megabytes of numeric data as JSON, and the original implementation ran into exactly the wall that predicts: the socket's line reader has a default buffer limit that a single large message exceeds, and exceeding it tore down the connection and killed the worker (§4.10).

[[TABLE]]
caption: The two isolation levels and when each applies.
| Property | in_process (default) | subprocess |
| --- | --- | --- |
| Interpreter | The platform's, currently 3.12 | The module's own, chosen by `requires-python` |
| `requires-python` acts as | Validation gate | Interpreter selector |
| Call overhead | None (direct call) | Approximately 5 to 50 ms per call |
| `inherit` shared libraries | Yes, no reinstall | No, installed into the module's own environment |
| DataFrame access | Direct | Parquet handoff on the shared filesystem |
| `open_event_log` (second log) | Available | Not proxied |
| Cancellation | Cooperative, immediate | Best effort |
| Choose it when | Always, unless the row below applies | A different Python version, or an irreconcilable native-library conflict |
[[/TABLE]]

## Polyglot Modules and the Host–Worker Protocol

The bridge that carries subprocess isolation is not Python-specific, and this is the point at which the extension mechanism stops being a Python plug-in system. A manifest may declare a `runtime` block instead of Python dependencies, naming a non-Python execution kind, and the module is mounted through the same bridge.

The platform's side of this is organised around a runtime abstraction that owns exactly two seams. `materialize` prepares and validates the module's toolchain artefacts, and `launch_spec` returns the argument vector, environment and working directory used to spawn the worker. Everything downstream of the worker socket is runtime-agnostic: the wire protocol, the object that stands in for the module instance on the host side, the mounting of routes, jobs and event handlers, and every context service. They speak JSON and Parquet, never language objects.

**The JVM is the reference implementation**, chosen because the process mining research ecosystem, ProM above all, is Java, and wrapping an existing Java algorithm is exactly the intended use. A JVM module ships as a self-contained fat jar; there is deliberately **no server-side dependency resolution**, no Maven or Gradle invocation at load time, because reproducing a second language's dependency resolver inside the platform would multiply the failure surface for little gain. Materialisation therefore only validates: that a runtime is present and new enough, that the declared jar exists inside the module folder, and that it is runnable. A Java runtime is baked into the API image, so no toolchain is required on the host, and the jar is committed to the repository, so no build step is required at deployment.

The wire protocol is documented as a specification rather than described in prose, because a second implementer needs a specification. It fixes the process-launch contract including a mandatory parent-death guard, so that a worker whose host has died exits rather than lingering as an orphan holding a socket; the framing, which is newline-delimited JSON with one message per line; the handshake, in which the worker announces the handlers it found; the three host-to-worker methods (`call`, `ping`, `shutdown`); the context methods the worker may call back; error and cancellation semantics; and a conformance checklist. Conformance is tested rather than asserted: a cross-runtime test suite exercises the same behaviours against every runtime, and a golden-file test pins the exact wire messages so that a protocol change cannot pass unnoticed. The JVM cases skip when no Java toolchain is present, which keeps the suite runnable on a machine that has only Python.

Node and R runtimes are **reserved by design and rejected at present**. The manifest schema's runtime kinds are a closed set, and declaring an unimplemented kind fails at load with a clear message rather than producing an obscure launch error. The seam exists; the implementations do not, and §11.4 lists them among the open seams rather than among the shortfalls.

## Inter-Module Communication

Modules never call each other directly. Two mechanisms exist, with different guarantees and different intended uses.

**The event bus** carries asynchronous, fire-and-forget notification with fan-out. A module emits a topic with a payload; any number of modules may subscribe. Topics a module emits must be declared in `provides` and topics it subscribes to in `consumes`, and the platform validates these declarations at startup, so a module that reacts to an event nobody emits, or emits one it never declared, is caught at boot rather than producing a silent no-op in production. Payload shapes are declared as Pydantic models in the module's `events.py` and enforced per topic at publish time.

**The capability registry** carries synchronous, typed request and response. A module advertises capabilities in `provides` and another calls them by name, having declared the dependency in `consumes` or `optional_modules`. Because the availability of an optional dependency is a runtime question, the registry also answers whether a capability is present, so that a module can degrade gracefully: the performance module computes per-activity metrics against discovered activities when the discovery module is installed, and falls back to raw activity labels when it is not, telling the user which of the two it did. The registry is user-scoped, so a capability call only ever reaches modules the calling user actually has installed.

The design decision worth defending is that **ordering between precomputing modules is expressed as an event subscription, not as a priority field**. The obvious alternative would be a numeric `precompute_order` in the manifest, and it is worse in three specific ways. A number expresses *when* rather than *why*, so nothing records that a module runs later because it needs discovery's output, and the reason is exactly what a future maintainer needs. Numbers do not compose: two modules that each need discovery have no principled way to choose their own numbers relative to each other, and an author adding a third module has to guess a value that does not collide. And a number cannot express failure semantics, whereas an event that is simply not emitted when its producer fails gives cascade-skipping for free (§4.8). Subscribing to `discovery.completed` says what is meant, composes transitively, and degrades correctly. The producer does nothing at all: the platform emits `<module_id>.completed` automatically when a module's precompute job succeeds, so ordering is a decision the *consumer* makes without the upstream module knowing it has dependants.

## User Interface Extension through Panels

A module contributes interface by declaring a panel entry point, and optionally a set of reusable widgets, in its manifest. These are bundled separately from the main application build, by a dedicated script that runs at container start in production and in watch mode during development, and the resulting bundles are served by the API under the module's own namespace. The host loads a panel lazily, executing the bundle with a small module loader that resolves its imports from a shared runtime object.

The mechanism exists to solve a specific problem: a panel must share the host's React instance, its query client and its component primitives, or hooks and context will not flow across the boundary and every panel would ship its own copy of the entire component library. So every shared dependency is marked external at bundle time and resolved at run time from the host.

The constraint this imposes on authors is an **explicit allow-list of importable platform paths**. A panel may import from the module SDK and from the listed host paths, and from nothing else under the platform's source tree. The list is deliberately small and stable: the HTTP helpers, the live-stream subscribers, formatting utilities, the widget kit, the canvas shell, the drill-down helpers and the visualisation-settings store. Two properties motivate the design. The platform can refactor everything not on the list without breaking third-party panels, which is what makes it possible to evolve a large frontend while third-party code exists against it. And the list is a single file read by both the bundler and the runtime installer, with a test asserting the two never diverge, so the allow-list cannot rot into a lie.

The failure mode is worth stating precisely because it confuses new authors, and it is stated again in §8.7. Importing outside the allow-list produces a **build failure, not a runtime error**: the bundle does not compile, because the import is neither external nor resolvable. This is the better failure, since it happens on the author's machine rather than in a user's browser, but it is confusing if the author expects the import to work the way it does everywhere else in the repository.

## Ownership, Installation, and Lifecycle

Modules are shared code but **per-user installations**. The distinction is easy to miss and has consequences for authors.

The code lives once on disk, in the repository's `modules/` directory for bundled defaults, or under a separate uploads directory for user-installed ones, so that an upload can never overwrite or shadow a repository default. What is per-user is the *installation*: a table records which users have which module installed, enablement is reference-counted, every user is seeded the default set on first login, and uninstalling is user-scoped and reversible, with a restore-defaults action that re-adds anything a user removed.

Three consequences follow. A module must not assume it is globally enabled, because the user currently making a request may not have it installed, and any cross-module interaction, a registry call or an event subscription, only reaches modules that this user has. The precompute closure of §4.8 is intersected with the importing user's installed set, so two users importing the same file may legitimately wait for different analyses. And uninstalling is cheap and safe, which is what allows a user to try a module and remove it without consequence.

Distribution has three channels: a zip or tarball upload, a Git URL that the platform clones, and a published Python package exposing the module entry point. The first two unpack into the uploads directory, materialise dependencies, bundle the frontend and mount; a failure rolls back cleanly rather than leaving a half-extracted folder. Removal is deletion of the folder, and because everything a module added, its environment, its bundles, its lock file, its caches, lives inside that folder, nothing is left behind and the platform's own dependency files are untouched.

## Trust and Security Model for Third-Party Modules

This section states what the isolation mechanism does and does not guarantee, because overstating it would be the most damaging inaccuracy in this report.

**What isolation provides.** Dependency isolation is complete: a module cannot see another module's packages, cannot break another module by upgrading a shared library, and cannot corrupt the platform's own environment. Process separation, when elected, additionally means a crash, a memory blow-up or a native-code segmentation fault is contained to the worker and is recovered by respawning it. Failure isolation at load time means a module whose dependencies do not resolve does not prevent the platform from starting. Result isolation means a module writing through its context cache writes into a per-user, per-log location, and cannot reach another tenant's data through the sanctioned interfaces.

**What isolation does not provide.** None of this is a **security sandbox against a malicious author**. An in-process module executes inside the platform's own process, with the platform's privileges. It can read and write any file the platform process can reach, including other users' Parquet data and the metadata database. It can open network connections. It can import whatever it likes. Subprocess isolation moves the code to a different process but not to a different security principal: the worker runs as the same operating-system user, on the same filesystem, with the same reachable network. There is no seccomp profile, no container per module, no capability dropping and no filesystem namespace.

**The operational consequence** is therefore simple and must be stated to operators rather than left implicit: **installing a module is a trusted action, equivalent to running code on the server.** An administrator can lock module installation down so that only administrators may install, and the appropriate posture for an installation with untrusted users is to do so. The claim this report makes about extensibility is a claim about **dependency and failure isolation, not about adversarial containment**, and §11.1 records the gap as an architectural limitation rather than as an oversight.

## Deliberate Limitations of the Module Model

Five boundaries are built into the design. Each is a consequence of an explicit trade-off, and naming them here rather than discovering them in the evaluation is what makes Chapter 10 a verdict rather than a defence.

**Single-node execution.** A module runs on the host that received the request. There is no scheduling across machines. This follows directly from G1: a design that could distribute modules would need a broker, and the broker was the thing the local-first premise ruled out.

**One instance per process.** The `Module` subclass is instantiated once, and handlers therefore must hold no request-scoped state on the instance. This buys a trivial lifecycle with no initialisation ordering problems, at the cost of a rule authors must know and that the interface cannot enforce.

**No versioned coexistence.** Two versions of the same module identifier cannot be loaded at once; the identifier is unique across the installation. Supporting coexistence would require versioned routing, versioned capability names and versioned event topics, which is a large amount of machinery for a situation, a user needing two versions of one analysis simultaneously, that has not arisen.

**No per-module resource quotas.** There is no memory ceiling, CPU share or disk budget per module. The controls that exist are platform-wide: worker concurrency, a job execution timeout that can kill a runaway offload, DuckDB thread and memory limits, and a per-user storage budget. A module that allocates without bound degrades the whole instance, and the mitigation today is the job timeout rather than a quota.

**A frozen precompute closure per import.** The set of modules a log waits for is fixed when the import begins. A module installed midway through an import does not join that import's closure, and a log imported before a module existed does not retroactively acquire its results; the user runs that analysis on demand instead. This is the price of the determinism argued for in §4.8, and it is the right price, but it is a limitation.
