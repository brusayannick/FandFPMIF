# Introduction

## Motivation and Institutional Context

Process mining turns the event data recorded by enterprise information systems into insight about how processes actually run (van der Aalst, 2020). The field has shifted from retrospective reconstruction towards transparent, timely and forward-looking support for ongoing operations (Grisold, van der Aa, et al., 2024; Reinkemeyer, 2020a), raising both what organisations expect and what the research community seeks to deliver.

Around this shared subject two communities have developed distinct priorities. Practitioners are driven by business value and adopt commercial suites such as Celonis, SAP Signavio and ARIS, whose strengths are usability and scale (Grisold et al., 2020; van der Aalst, 2020). Researchers value transparency and extensibility, develop new algorithms, and work with open toolkits such as ProM, PM4Py, bupaR and RapidProM (Berti, Zelst, et al., 2019; Carmona & Sole, n.d.; van Dongen et al., 2005). The result is a divide between flexibility and research capability on one side and usability and scale on the other.

This project seminar, *Flows and Funds: Process Mining in Finance*, was carried out at the Chair for Information Systems and Information Management at the University of Münster. Its task was to design, implement and operate a process mining platform for analysts, researchers and students. Three properties of that setting made an institution-hosted tool necessary rather than merely convenient. **Data sovereignty**: event logs used in teaching and research are often derived from real organisational data or supplied under agreements restricting where they may be stored, and a cloud-hosted tool moves that data outside the institution's control as a precondition of use. **Licensing**: the commercial suites are priced for enterprise deployment, and their academic programmes are time-limited, capacity-limited and bound to the vendor's environment, which is a poor foundation for a tool meant to outlive one cohort of students. **Exposure to current methods**: much of the value of a process mining seminar lies in working with techniques recent enough to still be contested, and those exist as research prototypes, a repository, a paper, a set of scripts, so putting one in front of students today means every student reproduces the author's environment by hand.

The system built in response is **PM-MATE**, referred to below as *Mate*: a locally hosted, multi-user process mining platform whose defining property is a module system, in which analysis methods are contributed as self-contained packages that the platform discovers, isolates and mounts, without modification to the platform itself. Chapter 3 supplies the comparison with existing tools that justifies this shape.

## Problem Conceptualisation

The problem is not the absence of process mining functionality; discovery, conformance checking and performance analysis all exist in mature implementations. The problem is that the available implementations force a choice between two properties that are both required and that no single tool supplies together.

The commercial process intelligence platforms offer analytical breadth, connector ecosystems, polished interfaces and operational maturity. They are also cloud-first, licence-bound and closed to external contribution in the sense that matters to a researcher: extension happens inside a vendor-governed application model, on the vendor's schedule and subject to the vendor's review. A drift-detection method published this year cannot be run inside them this year.

The libraries and research prototypes are open, inspectable and genuinely extensible, because extension means writing Python. They are also single-user, stateless between sessions and largely without an interface. Multi-user operation, identity, persistence, job management and result sharing are not weak in these tools; they are absent, because they were never in scope.

The consequence is concrete. A researcher who has published a method has no path from the paper's repository to a place where a non-developer can use it, short of building a product. A student comparing four complexity measures on one log installs four environments. An analyst wanting both a polished variant explorer and a current drift detector uses two tools and reconciles by hand. The methods and the usability exist; they do not exist in the same place. The guiding question is therefore:

> **Can a process mining platform be built that is operable by non-developers and by several users at once, that keeps all data on institution-controlled hardware, and whose extension mechanism is powerful enough to absorb unmodified research code, without the platform's own analytical functionality receiving any privilege that a third-party extension does not also receive?**

The final clause carries the weight. Any platform can claim extensibility. The claim becomes falsifiable only when the platform's own features are built through the interface outsiders must use, because then an inadequate interface fails visibly instead of being quietly worked around.

## Objectives and Criteria for Success

Five objectives follow, each with the criterion by which it is judged and a forward reference, so that Chapter 10 measures against a contract fixed in advance.

**O1: Extension without core modification.** *Criterion:* every analytical capability the platform offers is a module authored through the public SDK, and the platform's source contains no module-specific branch, registry entry or import. Reported in §10.2, §10.4.

**O2: An authoring contract a researcher can satisfy.** *Criterion:* the platform concepts an author must learn are bounded and enumerable, and a complete minimal module fits on one page. Reported in §8.12, §10.4.

**O3: Multi-user operation with strict isolation.** *Criterion:* every persisted row, on-disk artefact and live event envelope is keyed by the authenticated identity, and the one deliberate exception is read-only and explicit. Reported in §10.2; mechanism in §4.5.

**O4: Local operation without an operations team.** *Criterion:* a documented command sequence takes a bare virtual machine to a working, authenticated, TLS-terminated deployment, and the same repository runs unchanged on a laptop. Reported in §10.2; runbook in §7.4.

**O5: Continuous feedback for long-running analysis.** *Criterion:* every long operation is a persisted, observable, cancellable job, and a log becomes available exactly when the analyses it waits for reach a terminal state, whether they succeeded or not. Reported in §10.2; mechanism in §4.8.

## Scope and Delimitation

The following were excluded by decision, not omission, and are distinguished here from the shortfalls of §11.3. **No distributed or multi-node operation**: the platform targets a single host, and where the storage layer anticipates a second node the seam is documented and left unbuilt (§4.6, §11.4); a design needing a cluster to start would defeat the local-first premise. **No managed cloud offering**: no hosted variant, no tenant provisioning beyond the bundled identity provider, no billing model beyond a per-user storage budget. **No exhaustive coverage of process mining techniques**: the bundled module set demonstrates that the extension mechanism works across different kinds of method (§6.1) rather than competing with a commercial feature list, and absent techniques are absent because nobody wrote that module, which is exactly the situation the platform makes cheap to remedy. **No productisation beyond the university virtual machine**: hardening appropriate to a public internet service, a support process and a release cadence are all out of scope. **No streaming or change-data-capture ingestion**: ingestion is batch import, and although a watched folder polls storage and imports new files, there is no live event stream.

## Structure of the Report

Chapter 2 establishes the vocabulary and the library-versus-platform distinction that licenses the comparison in Chapter 3, which places existing tools on a common grid and reads off the gap Mate occupies. Chapters 4 and 5 are the core: the platform architecture, and modularity as the principle from which the rest follows. Chapter 6 turns the module set into evidence, narrating three integrations and quantifying their cost. Chapters 7 and 8 make the work reproducible: how the platform is deployed and operated, and how a third party writes a module. Chapter 9 documents how the project was run. Chapters 10 to 12 evaluate, discuss what remains open, and conclude. Readers wanting operating instructions should go directly to the appendices: A is the end-user manual, B the manifest and SDK reference, C the configuration and operations reference.
