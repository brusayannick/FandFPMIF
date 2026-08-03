# Introduction

## Motivation and Institutional Context

Process mining has established itself as a discipline that turns the event data recorded by enterprise information systems into actionable insight about how processes actually run (van der Aalst, 2020). In recent years the field has undergone a shift of emphasis. Early process mining was largely retrospective, reconstructing past behaviour for after-the-fact analysis; the current generation of methods and tools aims to be transparent, timely and forward-looking, offering proactive support for ongoing operations (Grisold, van der Aa, et al., 2024; Reinkemeyer, 2020a). This evolution has raised both what organisations expect from process mining and what the surrounding research community seeks to deliver.

Around this shared subject, however, two communities have developed distinct priorities and toolsets. Practitioners are driven primarily by business value and return on investment. They require usable, scalable, well-integrated platforms that support sense-making and strategic alignment, and they tend to adopt commercial suites such as Celonis, SAP Signavio and ARIS, whose strengths lie in usability and scale (Grisold et al., 2020; van der Aalst, 2020). Researchers, by contrast, value transparency and extensibility. They develop new algorithms to improve precision measures, to detect process dynamics, or to address other technical challenges, and they need an environment in which their own methods can be implemented and tested. They typically work with open, flexible toolkits such as ProM, PM4Py, bupaR and RapidProM (Berti, Zelst, et al., 2019; Carmona & Sole, n.d.; van Dongen et al., 2005). The result is a divide between flexibility and research capability on one side and usability and scale on the other.

This project seminar, *Flows and Funds: Process Mining in Finance*, was carried out at the Chair for Information Systems and Information Management at the University of Münster. Its task was to design, implement and operate a process mining platform for a mixed audience of analysts, researchers and students. Three properties of that institutional setting made an institution-hosted tool desirable rather than merely convenient.

The first is **data sovereignty**. Event logs used in teaching and research are frequently derived from real organisational data or are supplied under agreements that restrict where the data may be stored. A cloud-hosted analysis tool moves that data outside the institution's control as a precondition of using it at all. A platform that runs on university infrastructure and keeps every byte on the host removes that precondition.

The second is **licensing**. The commercial suites that define the state of practice are priced and licensed for enterprise deployment. Academic programmes exist, but they are time-limited, capacity-limited and bound to the vendor's environment. They are a poor foundation for a tool that is meant to outlive a single cohort of students.

The third is **exposure to current methods**. A large part of the value of a process mining seminar lies in letting students work with techniques that are recent enough to still be contested. Those techniques exist as research prototypes: a repository, a paper, a set of scripts. Bringing them in front of students today means each student reproduces the author's environment by hand. A platform on which a prototype can be installed once and then used by everyone changes the economics of that exposure entirely.

The system built in response is called **PM-MATE** (referred to below simply as *Mate*). It is a locally hosted, multi-user process mining platform whose defining property is a module system: analysis methods are contributed as self-contained packages that the platform discovers, isolates and mounts, without any modification to the platform itself. The comparison with existing tools that justifies this shape is deferred to Chapter 3; this section only establishes why an institution-hosted, extensible tool was worth building at all.

## Problem Conceptualisation

The problem this project addresses is not the absence of process mining functionality. Discovery, conformance checking and performance analysis are all available today, in several mature implementations. The problem is that the available implementations force a choice between two properties that are both required, and that no single tool supplies together.

On one side stand the commercial process intelligence platforms. They offer analytical breadth, connector ecosystems, polished interfaces and operational maturity. They are also cloud-first, licence-bound and closed to external contribution in any sense that matters to a researcher: extension happens inside a vendor-governed application model, on the vendor's schedule and subject to the vendor's review. A new drift-detection method published this year cannot be run inside them this year.

On the other side stand the libraries and research prototypes. They are open, inspectable and genuinely extensible, because extension means writing Python. They are also single-user, stateless between sessions, and largely without an interface. They assume a developer at a terminal, not an analyst at a browser. Multi-user operation, identity, persistence, job management and result sharing are not weak in these tools; they are absent, because they were never in scope.

The consequence for the target users is concrete. A researcher who has published a method has no path from the paper's repository to a place where a non-developer can use it, short of building a product around it. A student who wants to compare four complexity measures on the same log must install four environments. An analyst who wants both a polished variant explorer and a state-of-the-art drift detector must use two tools and reconcile the results by hand. The methods and the usability exist; they do not exist in the same place.

The guiding question the remainder of this report answers is therefore:

> **Can a process mining platform be built that is operable by non-developers and by several users at once, that keeps all data on institution-controlled hardware, and whose extension mechanism is powerful enough to absorb unmodified research code, without the platform's own analytical functionality receiving any privilege that a third-party extension does not also receive?**

The final clause is the one that carries the weight. Any platform can claim to be extensible. The claim becomes falsifiable only when the platform's own features are built through the same interface that outsiders must use, because then an inadequate interface fails visibly rather than being quietly worked around.

## Objectives and Criteria for Success

The problem statement translates into five objectives. Each is stated together with the criterion by which it is judged and a forward reference to the section that reports the outcome, so that Chapter 10 measures the result against a contract fixed in advance rather than against a description of what was built.

**O1: Extension without core modification.** A new analysis method can be added to a running platform without editing any file under the platform's own source directories. *Criterion:* every analytical capability the platform offers is implemented as a module authored through the public SDK, and the platform's own source tree contains no module-specific branch, registry entry or import. Reported in §10.2 and §10.4.

**O2: An authoring contract a researcher can satisfy.** A person who understands their own method, but not the platform, can package that method as a module. *Criterion:* the number of platform concepts an author must learn is bounded and enumerable, and a complete minimal module can be stated in a single page. Reported in §8.12 and §10.4.

**O3: Multi-user operation with strict isolation.** Several people use one instance concurrently and no data crosses between accounts. *Criterion:* every persisted row, every on-disk artefact and every live event envelope is keyed by the authenticated identity, and the one deliberate exception (shared dashboards) is read-only and explicit. Reported in §10.2, with the mechanism in §4.5.

**O4: Local operation without an operations team.** The complete system runs on a single institution-controlled host, with no external service dependency at runtime and no specialist administration. *Criterion:* a documented sequence of commands takes a bare virtual machine to a working, authenticated, TLS-terminated deployment, and the same repository runs unchanged on a developer laptop. Reported in §10.2, with the runbook in §7.4.

**O5: Continuous feedback for long-running analysis.** An analysis that takes minutes reports what it is doing while it does it, and a failure in one analysis does not block the rest. *Criterion:* every long operation is a persisted, observable, cancellable job, and a log becomes available exactly when the analyses it is waiting for have reached a terminal state, whether they succeeded or not. Reported in §10.2, with the mechanism in §4.8.

## Scope and Delimitation

The following were excluded by decision, not by omission, and are distinguished here from the shortfalls reported in §11.3.

**No distributed or multi-node operation.** The platform is designed for a single host. Where the storage layer anticipates a second node, the seam is documented and left unbuilt (§4.6, §11.4). Horizontal scaling was never a goal; a design that needs a cluster to start would have defeated the local-first premise.

**No managed cloud offering.** There is no hosted variant, no tenant provisioning beyond the bundled identity provider, and no billing or quota model beyond a per-user storage budget.

**No exhaustive coverage of process mining techniques.** The bundled module set is chosen to demonstrate that the extension mechanism works across different kinds of method (§6.1), not to compete with a commercial suite's feature list. Absent techniques are absent because nobody wrote that module, which is precisely the situation the platform is designed to make cheap to remedy.

**No productisation beyond the university virtual machine.** The deployment target is one institutional VM behind the faculty's reverse proxy. Hardening appropriate to a public internet service, a support process and a release cadence are all out of scope.

**No streaming or change-data-capture ingestion.** Ingestion is batch import. A watched-folder source polls storage and imports new files automatically, but there is no live event stream.

## Structure of the Report

Chapter 2 establishes the vocabulary the report relies on and draws the distinction between a process mining *library* and a *platform* that licenses the comparison in Chapter 3. Chapter 3 places the existing commercial and open-source tools on a common evaluation grid and reads the gap that Mate occupies off that grid. Chapters 4 and 5 are the core: Chapter 4 documents the platform architecture, and Chapter 5 develops modularity as the architectural principle from which the rest follows. Chapter 6 turns the module set into evidence, narrating three integrations in detail and quantifying their cost. Chapters 7 and 8 make the work reproducible: how the platform is deployed and operated, and how a third party writes a new module. Chapter 9 documents how the project itself was run. Chapters 10 to 12 evaluate the result against the criteria of §1.3, discuss what remains open, and conclude. Readers who want operating instructions rather than argument should go directly to the appendices: Appendix A is the end-user manual, Appendix B the manifest and SDK reference, and Appendix C the configuration and operations reference.
