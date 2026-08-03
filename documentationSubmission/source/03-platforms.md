# Existing Platforms and Positioning

## Evaluation Framework

The tools compared here differ in kind, not degree. Placing a cloud suite, a desktop research framework and a Python package on one page is only defensible if the criteria let each be described fairly, including by saying a criterion does not apply. Seven are used, derived from §2.4 and from the constraints of §1.1.

**C1: Deployment and data locality.** Where does the software run and where does event data reside during analysis? This is decisive here, because a tool requiring data to leave the university is unusable for much of the intended workload regardless of its other merits.

**C2: Licensing and cost of access.** Not the list price, but whether a student cohort can be given access for a seminar and whether the resulting artefacts survive the licence.

**C3: Extensibility mechanism.** How is new analytical capability added by someone who is not the vendor or a core maintainer? Developed separately in §3.4, because this is where the project's contribution rests.

**C4: Multi-user support and isolation.** Can several people use one installation concurrently, with their data separated? A single-user desktop tool is not deficient for answering no; the consequence is that a seminar of twenty students needs twenty installations. **C5: Analytical coverage.** How much of the discovery, conformance and enhancement space, plus object-centric and predictive capability, is available out of the box? **C6: Interface maturity.** Can a competent analyst who is not a developer work productively? **C7: Target audience.** Reported explicitly, because several apparent weaknesses dissolve once the intended audience is stated, and a comparison omitting it produces misleading verdicts.

The comparison drew on vendor and project documentation, trial use of the open-source tools during the project, and the literature on tool support and adoption (Grisold et al., 2020; van Dongen et al., 2005). Its limits should be plain: this is a **structured qualitative comparison, not a benchmark**, and for the commercial suites it rests on published documentation rather than hands-on use under a full licence, so it is reliable about architecture and licensing and not about everyday user experience. §10.6 returns to this.

## Commercial Process Mining Suites

A commercial process mining platform operationalises the techniques of §2.2 end to end, connecting to source systems such as ERP or CRM tools, extracting and maintaining event logs, and presenting results for analysis (Thummarakoti, 2026). The central artefact is the discovered process map, complemented by a variant explorer, KPI dashboards, conformance views and root-cause analyses (Zerbato et al., 2024). Contemporary suites have grown well beyond control-flow discovery: task mining capturing desktop-level interactions, process modelling with simulation, continuous monitoring and compliance checking, and action engines triggering recommendations or downstream automation. Two newer capabilities are prominent: object-centric process mining, which Celonis builds its offering around as an intelligence graph, and AI-assisted conversational interfaces, framed as the way to supply the operational context autonomous agents need to act on processes safely. The broadening is reflected in Gartner's renaming of its Magic Quadrant from *Process Mining* to *Process Intelligence Platforms* (2026 Gartner Magic Quadrant for Process Intelligence Platforms, n.d.).

[[FIGURE]]
caption: Gartner Magic Quadrant for Process Intelligence Platforms, April 2026.
insert: REPRODUCED FIGURE. Reuse the Magic Quadrant image already present as Figure 1 in the earlier draft "PS Flows & Funds Documentation - PM-MATE.pdf" (page 7). Check the reproduction terms before including it; if it cannot be reproduced, replace this figure with a short table naming the four Leaders (Celonis, SAP Signavio, ARIS, Pegasystems) and the acquiring entrants (UiPath, IBM, Microsoft), and delete the figure reference in the surrounding text.
[[/FIGURE]]

In the April 2026 quadrant the Leaders are Celonis, the most prominent pure-play vendor, together with SAP Signavio, ARIS and Pegasystems, while further vendors entered largely by acquiring specialist tools, among them UiPath, IBM and Microsoft. Two caveats apply: the figure positions vendors by market standing rather than feature parity, and several capability areas it scores, among them context knowledge, analysis recommendation and temporal dynamics, remain active research directions rather than settled product features.

Against the criteria, the suites set the bar on **coverage (C5)** and **interface maturity (C6)**, and nothing here disputes that. On **locality (C1)** they are cloud-first; on-premise options exist but are the exception and are not what the roadmap is built around. On **licensing (C2)** they are the hardest constraint in an academic setting, since academic programmes are time-limited and bound to the vendor's hosted environment, so a seminar artefact does not outlive the licence. On **extensibility (C3)** the picture matters most: extension is real but happens inside a vendor-governed application model, in the language the vendor supports, subject to the vendor's review and release process. Publishing a new drift-detection method as something a user can run is not a matter of writing the method; it is a matter of entering a partner programme. On **C4** they are unambiguously strong, and **C7**, the enterprise analyst, explains every other entry in the row.

## Open-Source and Academic Platforms

The open-source lineage splits into three traditions.

The **plug-in-based desktop tradition** is defined by ProM (van Dongen et al., 2005), the reference environment for academic process mining for two decades. Its architecture is explicitly extensible: plug-ins declare input and output types and the framework routes data between them. Its coverage is unmatched, precisely because generations of researchers contributed. Its limits are equally clear: a single-user desktop Java application with no identity, no server, no concurrent use and no persistence beyond the filesystem, and an interface built for a researcher who already knows which plug-in they want.

The **library-centric Python ecosystem** is dominated by PM4Py (Berti, Zelst, et al., 2019; Berti et al., 2023), with bupaR occupying the equivalent position in R, RapidProM embedding operators into a workflow environment and PMLAB offering a scripting environment (Carmona & Sole, n.d.). Extensibility here is maximal in one sense and absent in another: anyone can write a function, and there is nothing to plug it into, no lifecycle, no discovery, no configuration surface, no interface and no isolation between one author's dependencies and another's. **Open-source server offerings** close part of the gap with a web interface and persistence over a subset of the technique space, but are weaker on extension than the desktop tradition: capability is contributed by modifying the application, which puts new analysis behind the maintainers' release cycle and turns a local extension into a fork.

The pattern is consistent. Extensibility in the open-source world is real, but it is bought at the price of single-user desktop operation, developer-level entry barriers, or the absence of the operational concerns a shared installation requires.

## Extension Models in Direct Comparison

Four questions separate the extension mechanisms: what must an author know, what isolation is granted, can dependencies conflict, and can the extension contribute interface?

**Desktop plug-in registries (ProM).** An author must know the framework's type system and annotation conventions and build against its release. Isolation is by class loader at best; in practice plug-ins share one JVM and one classpath. Dependency conflicts are therefore possible and are resolved by maintainers choosing a version, which occasionally means a plug-in cannot be updated because another pins an incompatible library. Interface contribution is supported through custom visualisers, a genuine strength.

**Library imports (PM4Py, bupaR).** An author must know only function signatures, the lowest barrier here. There is no isolation, because there is no container. Dependency conflicts are routine and pushed entirely onto the user. Interface contribution is out of scope; the output is a data structure.

**Vendor application marketplaces.** An author must know the vendor's application model, data model and submission process, by far the highest barrier and the only one including an approval step outside the author's control. Isolation is strong, since the vendor sandboxes the code. Conflicts are prevented by restricting what may be depended upon. Interface contribution is supported within the vendor's component vocabulary.

**The module contract developed here.** An author must know a manifest schema and one base class with three decorators, and nothing else about the platform; §8.12 quantifies rather than asserts this. Isolation is by dependency: each module resolves its own Python dependencies into its own environment, and may additionally run in a separate process on its own interpreter (§5.4). Conflicts between modules are impossible by construction, because no two share a resolution scope. Interface contribution is supported through a separately bundled panel constrained to an allow-list of platform imports (§5.7). The mechanism is not language-bound: a manifest may declare a non-Python runtime, and the reference implementation of that path is a Java module (§5.5).

Two qualifications belong here rather than in the evaluation. The isolation Mate grants is **dependency isolation and process separation, not a security sandbox**; a module runs with the platform's privileges and installing one is a trusted action (§5.9). The vendor marketplaces are genuinely stronger on that axis and pay for it with the approval process. And the entry-barrier claim is weakened by authoring currently requiring a clone of the platform repository rather than an installable SDK package (§11.2).

## Synthesis: Identified Gap and Positioning of Mate

[[TABLE]]
caption: The evaluation grid of section 3.1 applied to the tool classes and to Mate.
| Criterion | Commercial suites | ProM | PM4Py / bupaR | Open-source servers | Mate |
| --- | --- | --- | --- | --- | --- |
| C1 Deployment and locality | Cloud-first; on-premise is the exception | Desktop, data local | Wherever the script runs | Self-hosted server | Self-hosted; all data on the host |
| C2 Licensing | Commercial; academic access time-limited | Open source | Open source | Open source | Open source |
| C3 Extensibility | Vendor-governed app model, approval required | Plug-in registry, shared classpath | Import a function; no lifecycle | Modify the application | Manifest plus SDK class; per-module dependency isolation; polyglot |
| C4 Multi-user and isolation | Strong | None (single user) | None | Present, varying depth | Per-user isolation on every layer; read-only dashboard sharing as the one exception |
| C5 Analytical coverage | Very broad, plus task mining and automation | Very broad, research-led | Broad, current | Subset | Subset, extensible; 17 bundled modules |
| C6 Interface maturity | High | Low for non-specialists | None | Moderate | Moderate |
| C7 Target audience | Enterprise analyst | Researcher | Developer or data scientist | Analyst | Analyst, researcher and student on one installation |
[[/TABLE]]

Read by column, each class is strong on a coherent subset and weak on its complement. Read by row, no column combines local operation, multi-user isolation and an extension mechanism open to unmodified research code. That empty region is the gap:

> **a locally hosted, multi-user platform whose extension mechanism is powerful enough for unmodified research code yet governed enough for third-party contributions.**

Three design goals follow, implemented by Chapters 4 and 5 in this order so that the architecture reads as a consequence of the analysis rather than as independent preference.

**G1: Every component runs embedded on a single host.** No broker, no external database service, no runtime cloud dependency. §4.2 justifies each technology choice against it.

**G2: Isolation is an architectural invariant, not a feature.** Every layer, database rows, on-disk directories, job records and live event envelopes, keys on one identity claim. §4.5 states the invariant in the form future contributors must maintain.

**G3: Extension is by contract, and the contract is proven by using it internally.** The module contract is the centre of the design (Chapter 5), and the platform's own analytical functionality is authored through it with no privileged hooks. §5.1 explains why this self-imposed constraint is the strongest available evidence of sufficiency, and Chapter 6 reports what happened when it met real research code.
