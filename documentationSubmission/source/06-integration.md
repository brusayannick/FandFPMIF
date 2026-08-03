# Extensibility in Practice: Module Integration as Evidence

## Selection Rationale

Seventeen modules ship with the platform, and which seventeen was not decided by feature coverage alone. A set chosen only for coverage is a catalogue, and a catalogue proves nothing about the extension mechanism. The selection served two purposes, and the second turns it into evidence.

The **first** is that a user opening a freshly imported log should find the analyses they expect. Discovery, performance and conformance are the baseline of §2.2 and had to be present in several algorithmic variants, because a platform offering one discovery algorithm has quietly taken a position on the fitness-precision trade-off on the user's behalf. Object-centric discovery had to be present because the ingest path supports OCEL. The complexity and drift families were the research topics this seminar engaged with.

The **second** is that each module stresses a different axis of the extension mechanism, so the set functions as an integration test of the contract. Four axes were covered. **Compute-heavy scientific code with a pinned dependency stack**: `cv4cdd` brings TensorFlow, a trained model as a binary artefact and an upper bound on the Python version. **A non-Python runtime**: `alpha_miner_java` is implemented entirely in Java and shipped as a fat jar. **An external service dependency**: `actor_performance` needs a graph database beside the platform, not a library inside it. **An external model provider**: `concept_drift_explainer` calls a hosted language model and vector store, testing the manifest's ability to declare a data-egress boundary it was not designed to describe.

## Module Profiles


Grouped by category and kept short; algorithmic background, parameters and known limitations are in Appendix D, and the table below records what each module exercised.

**Foundation.** **Discovery** turns a log into a process model and renders it as a directly-follows graph, a Petri net from the Alpha or Inductive miner, a process tree, a heuristics net or BPMN (van der Aalst et al., 2004), computing the layout following the backbone-based process map approach of Lee et al. (2026). It provides seven capabilities other modules call, and at 14,727 lines it established that a module can be a substantial application rather than a thin wrapper. **Performance** measures throughput, cycle and lead times, the 90th-percentile cycle time and bottlenecks; it declares `discovery` as an optional dependency, computing metrics per discovered activity when present and falling back to raw activity labels when not. **Object-Centric Discovery** discovers a process from OCEL logs, exposing object types, activities and the object-centric DFG (Berti et al., 2023; van der Aalst, 2019); it consumes `ocel.imported` rather than `log.imported`, and it forced the log-model gate, without which case-centric and object-centric modules appeared for each other's logs and failed confusingly.

**Analysis.** **Conformance Checking** takes a user-supplied BPMN reference model and computes fitness, precision and per-activity deviations with token-based replay by default and alignments optionally, painting the deviations onto the model (Carmona et al., 2022; Rozinat & van der Aalst, 2008); it is the only module whose primary input is an artefact the user uploads. **Complexity** measures entropy-based complexity over variants and activity sequences, with Lempel-Ziv, affinity, structure and Pentland's task and process complexity (Augusto et al., 2022), and was the first module needing richer XES attributes than the canonical three columns. **Complexity V2** implements the 28-metric suite of Langer (2025) and is the clearest instance of a master's thesis becoming usable software. **Complexity Over Time**, **Complexity V2 Over Time** and **Performance Over Time** slice the log into time windows and score each with the corresponding suite; that they exist as separate modules rather than as flags is itself a finding, since it was cheaper to write a second module than to make the first configurable (§6.7). **Log Evolution** shows how a log grows and shifts, inherits nothing but pandas, and at 1,291 lines is close to the floor of what a useful module costs. **CV4CDD** detects when and how a process changed, encoding the log as a similarity image and running a trained object-detection model to find sudden, gradual, incremental and recurring drifts (Kraus & van der Aa, 2024, 2025); **Concept Drift Explainer** explains *why* it changed, taking those drift points, searching the user's uploaded enterprise documents for context and returning ranked, citation-backed candidate causes (Schaffner, 2025). **AgentSimulator** simulates the process as interacting agents, learning each resource's behaviour, calendars and handovers from the log and scoring synthetic logs against a held-out slice (Kirchdorfer et al., 2025). **Actor Performance** decomposes waiting time by actor behaviour, distinguishing direct continuation, continuation after an interruption, and handover to an actor who was idle or busy (Klijn et al., 2024). **Alpha Miner (Java)** discovers a Petri net with the classic Alpha algorithm (van der Aalst et al., 2004); it is analytically redundant with Discovery, and that is the point, since it demonstrates the JVM runtime with an algorithm whose correct output is already known.

**Comparison.** **Process Comparison** compares two filtered views side by side, an overlaid DFG diff, variant differences, similarity by earth mover's distance and footprints, and per-activity frequency changes; each side carries its own filter, so the two views may be two cohorts of the *same* log, which is what motivated `open_event_log` and the filter-aware cache key. **Pcomp** tests whether two logs differ in a statistically meaningful way, using earth mover's distance under a permutation or bootstrap test (Pitsch et al., 2025); it is 211 lines of module code plus a panel, with everything else coming from the authors' published package installed from a Git URL.

[[TABLE]]
caption: The bundled module set, the platform property each exercised most, and its size.
| Module | Isolation | Platform property exercised | LOC |
| --- | --- | --- | --- |
| discovery | in_process | Capability registry as provider; module as a full application | 14,727 |
| performance | in_process | Degradation on an optional dependency | 1,454 |
| ocel_discovery | in_process | Log-model gating; the object-centric import topic | 2,982 |
| conformance | in_process | Module-owned upload and configuration surface | 3,232 |
| complexity | in_process | Optional-column requirements | 2,140 |
| complexity_v2 | in_process | Inheriting the numerical stack | 2,521 |
| complexity_over_time | in_process | Time-sliced recomputation | 2,775 |
| complexity_v2_over_time | in_process | The same, at 28 metrics | 3,545 |
| performance_over_time | in_process | The same, for KPIs | 1,920 |
| log_evolution | in_process | Minimum viable dependency set | 1,291 |
| cv4cdd | in_process | Pinned dependencies plus a binary model artefact | 3,946 |
| concept_drift_explainer | in_process | Hard module dependency; egress boundary | 3,787 |
| agentsimulator | subprocess | Separate interpreter; Parquet DataFrame handoff | 9,107 |
| actor_performance | subprocess | Sidecar service under a compose profile | 2,330 |
| alpha_miner_java | JVM runtime | Polyglot bridge and protocol conformance | jar |
| process_comparison | in_process | Cross-log access; filter-aware cache keys | 3,598 |
| pcomp | in_process | Dependency installed from a Git URL | 825 |
[[/TABLE]]

## Case Study: Porting Python Research Code into a Module

The CV4CDD reference implementation is a good specimen precisely because it is normal. Published alongside two papers (Kraus & van der Aa, 2024, 2025), it looked the way research repositories look: scripts driven from the command line, helper modules importing each other by relative path, a configuration block of module-level constants, hard-coded input and output paths, a `requirements.txt` pinning TensorFlow, a trained model checkpoint in the repository, and no interface.

**A manifest, absorbed entirely.** Identity, citations, required columns, the import subscription, the provided capability, the frontend entry and the dependency block with its Python upper bound are declaration, not code. Nothing in the research repository changed to produce it.

**An entry point and an adapter, the real work.** The module class is 458 lines and the adapter a further 447. Between them they translate the platform's event-log access into the shapes the original expects, replace module-level configuration constants with values read from user configuration, redirect file input and output into the invocation's scratch directory and the result cache, and report progress. The 2,000-odd lines under the original repository's own directory structure were vendored **unmodified**, which was the objective: the platform-facing code is an adapter, and the research code stays recognisable to its author and re-syncable against upstream. A panel of 424 lines renders detected drifts on a timeline.

**Two edits the SDK could not absorb.** File-system assumptions: the original wrote intermediate images relative to the working directory, which in a server process is neither writable nor per-invocation. And global state: it loaded the model once into a module-level variable at import time, which is exactly what the once-per-process rule makes dangerous. Both are invisible in a script and load-bearing in a server.

Two properties of the model artefact caused more trouble than the code. The checkpoint is large enough that committing it is awkward and downloading at boot is slow, so the platform grew the ability to pin a model globally as an administrative action. And because the module is enabled by default and subscribes to the import event, on an installation with no model **every log import starts a job that fails**. That is a genuine wart, documented in the deployment guide, and §11.3 records it rather than hiding it.

Effort: roughly three working days from checkout to a module rendering drift points, with the largest single block spent on dependency resolution rather than on code.

## Case Study: A Non-Python Module

The Alpha Miner answers one question: does the contract abstract over the execution runtime, or does it merely have a place where a non-Python runtime could go?

The module folder contains three things: `manifest.yaml`, a `README.md` and `dist/alpha-miner-all.jar`. There is no Python file in it. The manifest replaces the Python dependency block with a runtime block naming the kind, the jar path, the minimum Java version and the JVM arguments, and declares a typed dataset so the discovered Petri net is rendered by the platform's generic graph visualisation rather than by a panel. That the module needs no frontend to be useful is itself a result: a module can contribute an artefact and let the platform display it.

What the **platform** had to supply, once, is the substantial part: the runtime abstraction and its JVM implementation, 319 lines of Python; the Java SDK a module author links against, 1,794 lines; and a conformance fixture of 185 lines. A Java runtime was baked into the API image so no toolchain is needed on the deployment host. What the **module author** had to supply is 341 lines of Java implementing the Alpha algorithm and declaring one handler.

The bridge's costs are measurable. Per-call overhead is the same 5 to 50 milliseconds as any bridged module, which for a discovery run measured in seconds is noise. Data transfer is the more interesting figure: the log does not cross the socket at all, since the host writes the requested view to Parquet on the shared filesystem and the worker reads it with its own library. This is why a jar with no knowledge of the platform's internals can process a million-event log without a bespoke serialisation format. Conformance is tested, not asserted: a golden-file test pins the exact bytes of the wire messages, so a protocol change that would break a third-party worker fails in the platform's own test suite.

## Case Study: A Module with External Dependencies

Two modules extend past the process boundary in different directions and together exposed the limits of the manifest as a declaration format.

**Actor Performance needs a server, not a library.** Its method builds an event knowledge graph and queries it through a graph database (Klijn et al., 2024), which a module cannot bring in its virtual environment. The pattern settled on is an **optional compose-profile sidecar**: the container is declared behind a profile that is off by default, the operator enables it with one environment variable and a password, and the module connects to a configured address. Three rules make this safe to share. The module must treat the shared instance as transient scratch space rather than its own store; it must namespace everything it writes by tenant, because one instance serves all users; and it must degrade to an explanatory setup screen rather than an error when the sidecar is absent. That last rule matters more than it looks: because the module declares no import subscription, an installation without the sidecar shows a module explaining what is missing rather than a red failed job on every import.

**Concept Drift Explainer needs a model provider and a vector store.** It is the only module sending the user's data off the host: it takes CV4CDD's drift points, retrieves passages from documents the user uploaded, and asks a hosted language model to rank candidate explanations with citations. Configuration and credentials are the user's, validated against the module's schema. The module declares itself as not confidentiality-safe, and both its description and its card say so, so a user analysing a restricted log knows before running it that doing so transmits content to a third party.

What this revealed is a genuine limitation. The manifest describes dependencies well when a dependency is a package. It has no vocabulary for "requires a service at an address the operator must provide", and none for "transmits data to a destination the user configures". Both were handled by adding narrow, specific fields, a confidentiality flag and a documented sidecar convention, rather than by generalising, because a general capability-and-permission model was more machinery than two cases justified. §11.4 lists the generalisation as an open seam, and §5.9's honesty applies with particular force: nothing prevents a module from opening a network connection, and the confidentiality flag is a **declaration by the author, not an enforcement by the platform**.

## Comparative Integration Effort

[[TABLE]]
caption: Integration effort by module. Platform lines counts lines added to the platform's own source tree to make that module possible.
| Integration | Platform lines | Module lines | Reused unmodified | Platform defects uncovered |
| --- | --- | --- | --- | --- |
| cv4cdd | 0 | 1,329 | ~2,000 | Cache size limits; the workdir contract; a global-state hazard |
| agentsimulator | 0 | ~2,700 | ~4,900 | The 64 KiB socket limit; DataFrames across the bridge; interpreter selection |
| alpha_miner_java | 2,298 | 341 Java | 0 | The runtime abstraction did not exist |
| actor_performance | 0 | 1,914 | promg, as a declared dependency | Modules needing a service; tenant namespacing in a shared sidecar |
| concept_drift_explainer | 0 | 2,885 | 0 | Hard module dependencies; the egress declaration gap |
| pcomp | 0 | 651 | the authors' package, from Git | Git-URL dependencies in the manifest |
[[/TABLE]]

The `alpha_miner_java` figure is 319 lines of Python runtime abstraction, 1,794 of Java SDK and 185 of conformance fixture. Module lines include the frontend panel where one exists.

**The absence is the load-bearing result.** Five of the six integrations changed **zero lines** of the platform's own source. The sixth changed 2,298, and every one of them built a *general* capability rather than accommodating that module: a second JVM module would change zero lines too. This is the concrete form of objective O1 and the strongest empirical claim this report makes.

**Effort declined over the project**, but attributing the decline needs care. The earliest integration cost roughly three working days and uncovered three platform defects; the most recent was written by a project member on a separate branch in substantially less time, at 651 lines and one platform change. Part of the decline is genuinely attributable to contract improvements traceable to specific integrations: the workdir contract came from CV4CDD, the Parquet handoff and raised message limit from AgentSimulator, the `open_event_log` accessor from Process Comparison. Part is that `pcomp`'s reference implementation was already a properly packaged distribution while CV4CDD's was a directory of scripts, and part is that the authors had by then written several modules. §10.4 treats this conflation as the central threat to the extensibility claim.

## Lessons Learned and Resulting Changes to the Contract

Each lesson is paired with the change it caused, because a lesson that changed nothing is an opinion.

**Research code assumes a writable working directory, and a server has none.** *Change:* `ctx.workdir` became part of the contract, a per-invocation scratch directory the loader removes in a `finally` block covering all four invocation sites, with a startup sweep clearing directories a previous crash left behind.

**Bulk data cannot cross a socket as JSON.** AgentSimulator's first bridged run died on a message larger than the stream reader's default line limit, presenting as an unexplained worker crash. *Change:* the limit was raised well past any plausible control message, and DataFrame access across the bridge became a Parquet handoff.

**Ordering between precomputing modules is a real requirement, and a priority number is the wrong shape.** *Change:* the reserved `<module_id>.completed` event, the transitive precompute closure and cascade-skipping (§4.8).

**A module sometimes needs a second log, and letting it fetch one itself would breach isolation.** *Change:* `ctx.open_event_log(log_id, filters)`, the single sanctioned cross-log accessor, enforcing the ownership check itself and reporting another user's log as not found rather than as forbidden.

**"Same analysis, sliced by time" recurred four times.** *Change:* none, deliberately. A shared time-slicing helper was considered and rejected because the four aggregate differently and a helper general enough for all would have been harder to use than the duplication. Recorded as a lesson recognised and **not** acted upon; §11.3 restates it as such.

**User testing found the platform's weakest seam, and it is not in the module contract.** In a session with an external user, the clearest request was for the modules to be **connected**: clicking an activity in one module's output should lead to what every other module knows about that activity, and likewise for a variant. Today each panel is an island, with cross-linking limited to drill-down parameters a widget may choose to emit. *Change:* partial. The drill-down parameter convention and the shared canvas contract were introduced so clickable marks emit a standard set of parameters and a receiving panel can act on them, which is the mechanism a global view would be built on. The global view itself was not built; §11.6 proposes it as the first item of future work, because the abstraction it needs, an activity or variant as an addressable entity across modules, does not exist and is a genuine design question.
