# Evaluation

## Evaluation Design

The object of evaluation is an artefact, and the appropriate question is whether it does what it was built to do. The assessment has three parts: **criterion-based assessment against the objectives of §1.3**, each stated with its criterion before the system was finished; **comparative positioning** on the grid of §3.1, with explicit attention to where the result is worse; and **empirical evidence from construction**, since the integrations of Chapter 6 and the walkthrough of Chapter 8 are the closest this project comes to measuring its central claim.

What is deliberately not attempted is set out in §10.6: no controlled user study, no cross-tool performance benchmark, and no assessment of the analytical correctness of the bundled methods beyond their reproducing their reference implementations.

## Achievement of the Stated Objectives

**O1, extension without core modification: achieved.** All seventeen modules, including the three foundation modules supplying the baseline functionality, live under `modules/` and use the same SDK any third party would, and the platform's source contains no module-specific branch, registry entry or import. Five of the six integrations in §6.6 changed zero lines of platform code; the sixth changed 2,298, all of which built the general JVM runtime rather than accommodating that module. The verdict is strong because the criterion was falsifiable and a single privileged hook anywhere would have failed it.

**O2, an authoring contract satisfiable without platform knowledge: achieved with qualifications.** §8.12 enumerates nine concepts and §8.2 gives a complete module in about fifteen lines. The qualifications are real: four points of the abstraction leak (§8.12), authoring requires cloning the platform repository rather than installing an SDK package (§11.2), and there is no scaffolding command. The concept count is met; the friction around it is not what the objective envisaged.

**O3, multi-user operation with strict isolation: achieved.** All four layers are covered (§4.5), and the one exception is confined to a single module of predicates so the surface capable of crossing an account boundary is auditable in one sitting. Two honest notes attach. The bus does not itself enforce tenancy; isolation is applied at fan-out, so an event emitted without a user identifier reaches everyone, and the platform relies on convention plus review at that one point. And isolation is between *users of the platform*, not against *code installed into it*: §5.9 states that a module runs with the platform's privileges, so the claim is about tenants, not adversarial modules.

**O4, local operation without an operations team: achieved.** `infra/bootstrap-vm.sh` performs the deployment in one idempotent pass, §7.4 covers the surrounding steps, and `make up` runs the same composition locally. The qualification is that "without an operations team" is true for steady-state operation and was emphatically not true for the initial integration with institutional infrastructure, which cost roughly six weeks (§9.4). The system is now easy to deploy because that work is done and written down, not because it was easy.

**O5, continuous feedback for long-running analysis: achieved.** Every long operation is a persisted, observable, cancellable job, and the readiness gate releases a log when its expected modules reach any terminal state, so a failed analysis delays a log by its own duration and no longer and its dependants are skipped rather than stranded (§4.8). The qualification is that progress reporting is a guideline rather than a runtime gate; the alternative, a timeout, was judged the worse failure.

Two things built but not among the objectives, the MCP server and the integrated assistant, are not credited against them.

## Comparative Assessment against Existing Platforms

[[TABLE]]
caption: Mate placed on the evaluation grid of section 3.1, with the direction of each verdict.
| Criterion | Verdict for Mate | Relative to the best alternative |
| --- | --- | --- |
| C1 Deployment and locality | Self-hosted, all data on the host, no runtime cloud dependency | **Better** than the commercial suites for this setting; equal to the desktop and library tools |
| C2 Licensing | Open source, no licence to expire | **Better** than the commercial suites; equal to the open-source tools |
| C3 Extensibility | Manifest plus SDK class; per-module dependency isolation; polyglot runtime; UI contribution | **Better** on dependency isolation and polyglot support; **worse** than vendor marketplaces on adversarial containment |
| C4 Multi-user and isolation | Per-user isolation on every layer; read-only sharing as the sole exception | **Better** than every open-source alternative; comparable in kind, not maturity, to the commercial suites |
| C5 Analytical coverage | 17 modules; no task mining, no automation engine, no connector ecosystem | **Substantially worse** than the commercial suites and than ProM |
| C6 Interface maturity | Coherent and usable; one incoherence found in user testing | **Worse** than the commercial suites; **better** than the research tools |
| C7 Target audience | Analyst, researcher and student on one installation | A different position rather than a better one |
[[/TABLE]]

A credible comparison concedes, so the concessions come first. **Analytical breadth is not close**: seventeen modules against a commercial suite's feature surface is not a contest, and against ProM's two decades of plug-ins it is not a contest either. What the platform offers instead is that the marginal cost of the eighteenth module is low and does not depend on its maintainers. **There is no connector ecosystem**; ingestion is file import plus a watched folder, and the commercial suites' most valuable and least glamorous asset is the set of extractors turning an SAP or Salesforce instance into an event log. **Maturity and scale are what three and a half months produce**: one host, a small number of operators, one informal usability session, uneven interface polish. And **adversarial containment is absent** where the vendor marketplaces have it (§5.9).

What is purchased in exchange is specific and defensible: **data that never leaves institutional hardware; no licence that can expire out from under a cohort of students; an extension path from a published paper to a usable analysis that passes through nobody's partner programme; and dependency isolation strong enough that a module pinning TensorFlow and a module pinning an incompatible SciPy coexist without either author knowing the other exists.** For the setting of §1.1 that trade is right; for an enterprise analytics deployment it plainly is not, and this report does not claim otherwise.

## Extensibility: Measured Rather than Asserted

This is the central empirical result and deserves both statement and scepticism.

**The measurement.** Six integrations (§6.6) produced 2,298 lines of platform change in total, all in one integration and all general rather than module-specific; the other five changed nothing. Module sizes ranged from 651 lines to roughly 2,700 excluding vendored code, with between zero and 4,900 lines of reference implementation reused unmodified. The authoring surface is nine concepts and a fifteen-line minimal module. Effort per integration declined from roughly three working days for the first to substantially less for the last.

**Why the sample is weak.** Six integrations by the people who built the platform is not a sample from the population the claim is about. The authors knew the contract without reading it, so nothing measured here reflects the cost of learning it. They could change the contract when it did not fit and did so five times (§6.7), which is exactly the affordance an external author lacks, and several of those changes were prompted by an integration and then made that integration easy, which is circular as evidence. And the modules were selected partly *because* they would stress the mechanism, so the set is neither random nor representative.

**Why effort in author-hours conflates two things.** The decline mixes improvement in the contract with improvement in the authors and with variation in the input: the first integration's reference implementation was a directory of scripts, the last one's a properly packaged distribution. A fair reading attributes part of the decline to the contract changes traceable to specific integrations, and part to learning and easier inputs; the evidence does not permit separating them.

**What an external author would plausibly experience.** The two weak external signals are that a project member on a separate branch produced a working module and panel in 651 lines, and that a master's thesis became a 28-metric module. Both are more external than the core team and considerably less external than a stranger. Extrapolating from §8.12, an author following Chapter 8 would meet the nine documented concepts and additionally hit the four leaks named there, of which the `@on_event`-without-`@job` trap has a silent failure mode and is therefore most likely to cost real time. They would also hit the friction of §11.2. The honest summary is that the **contract** is supported by this evidence and the **authoring experience** is not yet measured at all.

## Performance and Scaling Behaviour

The figures below are observations on realistic inputs on the hardware used during the project, not benchmarks; no controlled protocol was followed and no hardware was held constant.

**Import and precompute.** Import time is dominated by parsing, and XES parsing dominates CSV by a wide margin for equivalent data, which is why normalising once to Parquet is worth doing (§4.6). After normalisation, aggregate queries over logs in the low millions of events return in well under a second, which is what makes a dashboard of ten cards feel immediate. Total time from upload to a `ready` log is the import time plus the slowest chain in the precompute closure, dominated for the default module set by the drift-detection module running a neural network. **Memory.** DuckDB's use is bounded by configuration rather than by the data; the practical ceiling is set by modules that materialise a DataFrame or a PM4Py event log object, both proportional to the log and neither boundable by the platform, which is why §8.5 pushes aggregation into the columnar engine as guidance rather than style.

**First-boot dependency resolution** is the largest fixed cost: several minutes on a clean checkout, dominated by one module's TensorFlow stack, with a ten-minute health-check grace period. Subsequent boots take seconds. Disk cost is tens of megabytes per module inheriting the shared libraries and hundreds for one that does not.

**Bridge latency** adds roughly 5 to 50 milliseconds per handler call for bridged modules, invisible for a module performing one expensive computation and the reason §5.4's rule is narrow for a chatty one. Bulk data does not pay it. **Concurrency** defaults to two job workers, the correct default for a single VM shared by several users, because process mining jobs are CPU-bound and oversubscription degrades everyone's latency rather than improving throughput.

**Where the single-node design becomes binding.** Three thresholds, in the order reached. **Concurrent heavy analyses**: a handful of users each running discovery on a large log saturates the worker pool, and the only remedies are queueing and a bigger machine. **Memory**, when one module needs a whole log as a DataFrame and the log no longer fits. **Disk**, which the object-storage backend defers rather than removes, since the metadata database and module environments remain local. None has a fix inside the current architecture, which is the point of §5.10 and §11.1.

## Threats to Validity

**Self-assessment.** The evaluation was performed by the team that built the system against criteria the same team wrote. The criteria were fixed before the outcome was known and are falsifiable, which mitigates but does not remove the bias.

**Absence of external users.** No controlled study of module authoring was conducted, and the usability evidence is one informal session with one external user. That session was nonetheless the source of the most substantive design criticism the project received (§6.7), which suggests the marginal value of more such sessions would have been high.

**Comparison partly from documentation.** The commercial suites were assessed from vendor documentation rather than hands-on use under a full licence. The resulting judgements about architecture, deployment model and extension governance are reliable; judgements about day-to-day usability would not be, and none are made.

**Single hardware configuration.** Every performance observation comes from one virtual machine and a few developer laptops, and no figure in §10.5 characterises the software independently of that hardware.

**Survivorship in the module set.** The seventeen modules are the ones that were completed. Methods too awkward to integrate would not appear here; the authors are not aware of an instance, but absence of a recorded failure is not evidence that none occurred.
