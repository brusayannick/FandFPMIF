# Discussion: Limitations and Open Questions

## Architectural Limitations

Each limitation is labelled **intrinsic**, following from a decision that defines the system, or **unimplemented**, buildable without contradicting the design.

**Single-host operation (intrinsic).** The platform runs on one machine and schedules nothing across machines. This follows from design goal G1: distributing work would require a broker or shared queue, and eliminating exactly that class of dependency is what makes the system deployable by a person rather than a team. Within that premise the job runtime could dispatch to a worker on another host if the storage layer's multi-node seams were closed; what is intrinsic is the metadata database, a single-writer SQLite file that would have to be replaced to admit a second writer.

**The interpreter lock on in-process modules (intrinsic).** Modules loaded into the platform's process are ABI-locked to its interpreter; the escape hatch is subprocess isolation, which exists precisely because the lock cannot be removed. What is arguably unimplemented is the ergonomics: a module could be promoted to subprocess isolation automatically when its declared Python range excludes the platform's, rather than failing to load.

**The memory ceiling for large logs (partly intrinsic).** Aggregation in DuckDB is bounded by configuration and scales well; any module materialising the whole log as a DataFrame or PM4Py object is bounded by the log, and the platform cannot make an arbitrary algorithm streaming. What is unimplemented is a per-module memory budget that would fail such a module cleanly instead of degrading the instance (§5.10).

**The trust assumption on installed modules (unimplemented).** A module runs with the platform's privileges and installing one is equivalent to running code on the server (§5.9). This is unimplemented rather than intrinsic: containerising each module, dropping capabilities or applying a filesystem namespace are all possible, and none was done because the deployment's users are known and the engineering cost was judged better spent elsewhere. The consequence is that the platform suits an institution whose module authors are identifiable and does not suit a public service accepting arbitrary uploads.

## Limitations of the Authoring Experience

Chapter 8 revealed a barrier to entry separate from the architecture and mostly cheaper to fix.

**Authoring requires cloning the platform repository (incidental).** There is no installable SDK distribution: an author must clone the whole monorepo to get the SDK, the running platform and the reload loop. Publishing the Python SDK as a package with a small development harness would remove this, and it is the single change that would most improve the authoring experience.

**There is no scaffolding command (incidental).** Every author begins by copying an existing module. A `make new-module` target generating a manifest, a class, a test and a panel stub is an afternoon's work and was never prioritised.

**First-boot dependency cost (structural, mitigated).** Several minutes on a clean checkout is the price of per-module isolation (§5.3) and cannot be removed without giving up the property that makes conflicting dependencies possible. It could be mitigated by pre-warming a wheel cache in the image or resolving modules lazily on first use; neither was done.

**Manual restart for discovery outside the reload modes (incidental).** Hot reload is gated to development, so in the containerised default mode adding a module folder requires a restart.

**Four leaks in the abstraction (mixed).** Enumerated in §8.12. Two are cheaply fixable: the panel allow-list error message could name the allow-list, and the `@on_event`-without-`@job` case could emit a startup warning, since that combination is almost always a mistake. Two are structural: the once-per-process rule cannot be expressed in Python's type system, and the gate-versus-selector distinction for `requires-python` is a genuine consequence of how in-process loading works.

## Functionality Not Realised

Shortfalls, distinct from the deliberate non-goals of §1.4.

**The cross-module view of an activity or variant.** The clearest request from user testing (§6.7) and the most substantial thing not built. Partial groundwork exists in the drill-down parameter convention and the shared canvas contract, but the platform-level abstraction it needs, an activity or variant as an addressable entity modules can annotate, does not. It was not built because it is a design question rather than an implementation task, and the project ran out of time to answer it properly.

**A model shipped with the drift-detection module.** The module is enabled by default and subscribes to the import event, so on an installation without a model every import starts a job that fails (§7.4). The proper fix is to ship a model, disable the module by default, or make it skip cleanly when no model is configured. The last is small and should have been done.

**Node and R runtimes.** Reserved in the manifest schema and rejected at load. The JVM runtime proved the abstraction; the others were deprioritised once it was clear the Java ecosystem covered the research the project cared about.

**A shared time-slicing helper.** Four over-time modules duplicate the same windowing logic. §6.7 records this as a lesson recognised and deliberately not acted upon, because the four aggregate differently and a helper general enough for all would have been harder to use than the duplication. It is listed here so the decision is visible rather than looking like an oversight.

**A conservative default for usage capture.** The shipped default enables capture for every user and removes the opt-out (§7.6). Defensible for a research deployment with separately informed participants; the wrong default otherwise, and changing it would have cost nothing.

## Open Architectural Seams

Places where the design anticipates an extension it does not support. These are the natural entry points for successor work.

**Multi-node coordination in the storage layer.** The object-storage redesign explicitly identified and left open the seams a second node would need: the local cache is per-node with no cross-node invalidation, and the metadata database is a single-writer store whose loss would orphan every object in the bucket. Closing them is the prerequisite for horizontal scaling.

**Further runtime kinds.** The runtime abstraction has exactly two seams and one implementation beyond Python. Adding Node or R is writing a `materialize`, a `launch_spec` and an SDK against the existing protocol, with the conformance suite as the acceptance test. This is the best-specified piece of successor work in the project.

**Versioned module coexistence.** Would require versioned route mounting, capability names and event topics. The design is coherent; the machinery is absent.

**Per-module resource governance.** The job execution timeout and the CPU-offload pool are the beginnings of it. A real implementation needs per-module accounting and a policy layer.

**A general declaration vocabulary for external resources.** §6.5 found that the manifest describes package dependencies well and has no vocabulary for "requires a service at an operator-supplied address" or "transmits data to a user-configured destination". Both were handled by narrow fields. Generalising them into a capability-and-permission model is the seam, and it is also the precondition for any move towards adversarial containment, because a sandbox needs to know what a module is entitled to do.

## Transferability of the Results

Three results are not specific to process mining, and one is.

**The module contract generalises.** Nothing in it mentions event logs: a manifest declares registration, requirements and dependencies; a class instantiated once per process carries route, event and job handlers; a Protocol-typed context supplies data access, a scoped cache, configuration, progress and inter-module communication. Any analytical platform whose workload is *artefact in, artefact out* over a large shared dataset could adopt it directly, and bioinformatics pipelines, geospatial analysis and simulation platforms have the same shape. It assumes extensions are compute-oriented and stateless between invocations, and would transfer badly to extensions that must own long-lived state or a socket of their own.

**The declared-event ordering model generalises**, and is the result this report would most readily recommend to others. Expressing "run after X" as a subscription to X's completion event rather than as a priority number gives three properties for free: the reason is recorded rather than encoded, ordering composes transitively without authors coordinating numbers, and failure semantics fall out, because an event not emitted skips dependants automatically (§5.6). It assumes the dependency graph is acyclic and that completion is observable.

**The readiness-gate design generalises**, with one caveat. Freezing the expected set at the start of a workflow, deriving completion from persisted records rather than in-memory counters so a restart recovers, and treating *any* terminal state as releasing the gate are all domain-independent. The caveat is that freezing trades flexibility for determinism, which is right when the workflow is short relative to the deployment's change rate and wrong when it is not.

**What does not generalise** is the specific storage split. Parquet plus an embedded columnar engine for immutable facts, with a relational store for mutable metadata, is right because event logs are written once and read by aggregation. A domain whose primary data is mutable, or whose reads are point lookups rather than scans, should not copy it.

## Directions for Future Work

Five items in priority order, each tied to a limitation above and scoped to what a successor team could realistically do.

1. **Make the drift-detection module skip cleanly without a model.** Half a day. Removes the worst first-impression defect on a fresh deployment (§11.3).
2. **Publish the SDK as an installable package and add a scaffolding command.** One to two weeks. Removes the largest friction in the authoring experience (§11.2) and is the prerequisite for any credible external-author study, which is in turn the missing evidence for the report's central claim (§10.4).
3. **Build the cross-module view of an activity and a variant.** Four to six weeks, the first of them design. Introduce the addressable entity, let modules annotate it, and render the aggregate view; the drill-down convention and canvas contract are the foundation (§11.3). This is the highest-value functional addition and the one users actually asked for.
4. **Replace the discovery module's graph layout.** Two to four weeks. The current layout degrades on large graphs. Concrete candidates are a Sugiyama-style layered layout and the backbone-based process map construction of Lee et al. (2026), whose optimised formulation the module already cites. This is self-contained module work requiring no platform change, which makes it a good first task for a successor.
5. **Close the multi-node storage seams.** Six weeks or more, worth starting only if a deployment needs it: cross-node cache invalidation and a replacement for the single-writer metadata store, in that order (§11.4).

Two items are deliberately **not** proposed. Adversarial containment of modules is a large piece of work that changes what the platform is, and should be undertaken only if the user population comes to include untrusted authors. And a connector ecosystem, however valuable, is a multi-year commitment competing directly with vendors whose entire business is that asset.
