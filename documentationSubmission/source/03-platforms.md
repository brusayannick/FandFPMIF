# Existing Platforms and Positioning

## Evaluation Framework

The tools compared in this chapter differ in kind, not only in degree. Placing a cloud-hosted enterprise suite, a desktop research framework and a Python package on the same page is only defensible if the criteria are chosen so that each tool can be described fairly against them, including by saying that a criterion does not apply. Seven criteria are used, derived from the platform-versus-library distinction of §2.4 and from the constraints of the institutional setting of §1.1.

**C1: Deployment and data locality.** Where does the software run, and where does the event data physically reside during analysis? This is the criterion the institutional setting makes decisive, because a tool that requires data to leave the university is not usable for a substantial part of the intended workload regardless of its other merits.

**C2: Licensing and cost of access.** What does it cost to obtain the tool, and on what terms? The relevant question is not the list price but whether a student cohort can be given access for the duration of a seminar and whether the resulting artefacts survive the licence.

**C3: Extensibility mechanism.** How is new analytical capability added by someone who is not the vendor or the core maintainer? This criterion is developed in its own subsection (§3.4) because it is the one on which this project's contribution rests.

**C4: Multi-user support and isolation.** Can several people use one installation concurrently, with their data separated? A single-user desktop tool is not deficient for failing this; it simply answers "no", and the consequence for a seminar of twenty students is that twenty installations are required.

**C5: Analytical coverage.** How much of the discovery, conformance and enhancement space, plus the newer object-centric and predictive capabilities, does the tool cover out of the box?

**C6: Interface maturity.** Can a competent analyst who is not a developer operate the tool productively?

**C7: Target audience.** Whom was the tool designed for? This is reported explicitly because several apparent weaknesses dissolve once the intended audience is stated, and a comparison that does not state it produces misleading verdicts.

The comparison was conducted by reviewing vendor and project documentation, by trial use of the open-source tools during the project (PM4Py is a runtime dependency of the platform, and ProM was used for cross-checking discovery output), and by consulting the research literature on tool support and adoption (Grisold et al., 2020; van Dongen et al., 2005). Its limits should be stated plainly. This is a **structured qualitative comparison, not a benchmark**. No throughput, latency or accuracy figures were measured across tools. For the commercial suites in particular, the assessment rests on published documentation and analyst reporting rather than on hands-on use under a full licence, and it is therefore reliable about architecture and licensing but not about the everyday quality of the user experience. §10.6 returns to this as a threat to validity.

## Commercial Process Mining Suites

A process mining platform in the commercial sense is the integrated software environment that makes the techniques of §2.2 usable in practice. It operationalises discovery, conformance checking and enhancement as an end-to-end product, connecting to source systems such as ERP or CRM tools, extracting and maintaining event logs, and presenting the results for analysis (Thummarakoti, 2026). The central artefact a user works with is the discovered process map, complemented by a variant explorer that exposes how often each execution path occurs, dashboards of key performance indicators, conformance views that flag deviations from a reference model, and root-cause analyses that explain why inefficiencies arise (Zerbato et al., 2024).

Contemporary suites have grown well beyond control-flow discovery. Alongside the core analyses they commonly offer task mining, which captures desktop-level user interactions; process modelling with simulation or digital-twin capability; continuous monitoring and compliance checking; and action or automation engines that close the loop by triggering recommendations or downstream automation. Two newer capabilities are especially prominent. Object-centric process mining has been adopted to represent interacting object types, and Celonis in particular builds its offering around an object-centric intelligence graph. AI-assisted conversational interfaces are increasingly framed as the way to supply the operational context that autonomous agents need in order to act on processes safely. This broadening is reflected in Gartner's renaming of its Magic Quadrant from *Process Mining* to *Process Intelligence Platforms* (2026 Gartner Magic Quadrant for Process Intelligence Platforms, n.d.).

[[FIGURE]]
caption: Gartner Magic Quadrant for Process Intelligence Platforms, April 2026.
insert: SCREENSHOT / REPRODUCED FIGURE. Reuse the Magic Quadrant image already present as Figure 1 in the earlier draft "PS Flows & Funds Documentation - PM-MATE.pdf" (page 7). Check the reproduction terms before including it; if it cannot be reproduced, replace this figure with a short table listing the four Leaders (Celonis, SAP Signavio, ARIS, Pegasystems) and the acquiring entrants (UiPath, IBM, Microsoft) and delete the figure reference in the surrounding text.
[[/FIGURE]]

The market is dominated by commercial vendors. In the April 2026 quadrant the Leaders are Celonis, the most prominent pure-play vendor, together with SAP Signavio, ARIS and Pegasystems, while a number of further vendors entered the field largely by acquiring specialist tools, among them UiPath, IBM and Microsoft. Two caveats apply when reading such a figure. It positions vendors by market standing rather than feature parity, and several capability areas it scores, among them context knowledge, analysis recommendation and temporal dynamics, remain active research directions rather than settled product features.

Against the criteria, the suites score as follows. On **analytical coverage (C5)** and **interface maturity (C6)** they set the bar, and nothing in this report disputes that. On **deployment and data locality (C1)** they are cloud-first: on-premise options exist but are the exception, are priced accordingly, and are not what the vendor's roadmap is built around. On **licensing (C2)** they are the hardest constraint in an academic setting; academic programmes are time-limited and bound to the vendor's hosted environment, so an artefact built during a seminar does not outlive the licence. On **extensibility (C3)** the picture is the one that matters most here: extension is real but happens inside a vendor-governed application model. An author works with the abstractions the vendor exposes, in the language the vendor supports, subject to the vendor's review and release process. Publishing a new drift-detection method as something a Celonis user can run is not a matter of writing the method; it is a matter of entering a partner programme. On **multi-user support (C4)** they are unambiguously strong, and on **target audience (C7)** they are built for the enterprise analyst, which explains every other entry in the row.

## Open-Source and Academic Platforms

The open-source lineage splits into three traditions with quite different characters.

The **plug-in-based desktop tradition** is defined by ProM (van Dongen et al., 2005), which has been the reference environment for academic process mining for two decades. ProM's architecture is explicitly extensible: functionality is contributed as plug-ins that declare their input and output types, and the framework routes data between them. Its analytical coverage is unmatched in breadth, precisely because generations of researchers have contributed to it. Its limitations are equally clear. It is a single-user desktop Java application. There is no notion of identity, no server, no concurrent use, and no persistence beyond the user's filesystem. Its interface is built for the researcher who knows which plug-in they want, and the plug-in catalogue is large enough that this is a real barrier for anyone else.

The **library-centric Python ecosystem** is dominated by PM4Py (Berti, Zelst, et al., 2019; Berti et al., 2023), with bupaR occupying the equivalent position in R and RapidProM embedding process mining operators into RapidMiner's workflow environment. PMLAB (Carmona & Sole, n.d.) belongs to the same family as a scripting environment. Extensibility here is maximal in one sense and absent in another: anyone can write a function, and there is nothing to plug it into. There is no lifecycle, no discovery, no configuration surface, no user interface, and no isolation between one author's dependencies and another's. Coverage is broad and current, the entry barrier is developer-level, and multi-user operation is simply not a category the tools engage with.

**Open-source server offerings** exist and close part of the gap, providing a web interface and persistence over a subset of the technique space. They tend to be weaker on the extension question than the desktop tradition: capability is contributed by modifying the application, which places new analysis behind the maintainers' release cycle and means that a local extension becomes a fork to maintain.

The pattern across all three is consistent. Extensibility in the open-source world is real, but it is bought at the price of single-user desktop operation, developer-level entry barriers, or the absence of the operational concerns, authentication, job management, result persistence, that a shared installation requires.

## Extension Models in Direct Comparison

This subsection compares the extension mechanisms as such, because the differences between them are not differences of convenience. Four questions separate them: what must an author know, what isolation is granted, can dependencies conflict, and can the extension contribute interface?

**Desktop plug-in registries (ProM).** An author must know the framework's type system and annotation conventions, and must build against the framework's own release. Isolation is by class loader at best; in practice plug-ins share one JVM and one classpath. Dependency conflicts are consequently possible and are resolved by the framework's maintainers choosing a version, which occasionally means a plug-in cannot be updated because another plug-in pins an incompatible library. Interface contribution is supported, since a plug-in can supply its own visualiser, and this is a genuine strength of the model.

**Library imports (PM4Py, bupaR).** An author must know only the library's function signatures, which is the lowest entry barrier of any model here. There is no isolation, because there is no container: the author's code and the library run in whatever environment the user assembled. Dependency conflicts are not merely possible but routine, and are pushed entirely onto the user, who resolves them with virtual environments. Interface contribution is out of scope; the output is a data structure.

**Vendor application marketplaces (commercial suites).** An author must know the vendor's application model, its data model, and its submission process, which is by far the highest barrier and the only one that includes an approval step outside the author's control. Isolation is strong, since the vendor runs the code in a sandbox of its own design. Dependency conflicts are prevented by restricting what may be depended upon. Interface contribution is supported within the vendor's component vocabulary.

**The module contract developed in this project.** An author must know a manifest schema and one base class with three decorators, and nothing else about the platform; §8.12 quantifies this claim rather than asserting it. Isolation is by dependency: every module resolves its own Python dependencies into its own virtual environment, and a module can additionally elect to run in a separate process on its own interpreter (§5.4). Dependency conflicts between modules are impossible by construction, because no two modules share a resolution scope. Interface contribution is supported through a separately bundled panel constrained to an explicit allow-list of platform imports (§5.7). The mechanism is not language-bound: a manifest may declare a non-Python runtime, and the reference implementation of that path is a Java module (§5.5).

Two honest qualifications belong here rather than in the evaluation. First, the isolation Mate grants is **dependency isolation and process separation, not a security sandbox**; a module runs with the privileges of the platform process and installing one is a trusted action (§5.9). The vendor marketplaces are genuinely stronger on this axis, and they pay for it with the approval process. Second, the entry barrier claim is weakened by the fact that authoring currently requires a clone of the platform repository rather than an installable SDK package (§11.2).

## Synthesis: Identified Gap and Positioning of Mate

[[TABLE]]
caption: The evaluation grid of §3.1 applied to the tool classes and to Mate.
| Criterion | Commercial suites | ProM | PM4Py / bupaR | Open-source servers | Mate |
| --- | --- | --- | --- | --- | --- |
| C1 Deployment and data locality | Cloud-first; on-premise is the exception | Desktop, data local | Wherever the script runs | Self-hosted server | Self-hosted; all data on the host |
| C2 Licensing | Commercial; academic access time-limited | Open source | Open source | Open source | Open source |
| C3 Extensibility | Vendor-governed app model, approval required | Plug-in registry, shared classpath | Import a function; no lifecycle | Modify the application | Manifest plus SDK class; per-module dependency isolation; polyglot |
| C4 Multi-user and isolation | Strong | None (single user) | None | Present, varying depth | Per-user isolation on every layer; read-only dashboard sharing as the one exception |
| C5 Analytical coverage | Very broad, plus task mining and automation | Very broad, research-led | Broad, current | Subset | Subset, extensible; 17 bundled modules |
| C6 Interface maturity | High | Low for non-specialists | None | Moderate | Moderate |
| C7 Target audience | Enterprise analyst | Researcher | Developer or data scientist | Analyst | Analyst, researcher and student on one installation |
[[/TABLE]]

Reading the grid by column shows that each class is strong on a coherent subset and weak on its complement, and reading it by row shows that no column combines local operation, multi-user isolation and an extension mechanism open to unmodified research code. The commercial suites hold C4 to C6 and concede C1 to C3. The research tools hold C3 and C5 and concede C1's operational half, C4 and C6. That empty region is the gap:

> **a locally hosted, multi-user platform whose extension mechanism is powerful enough for unmodified research code yet governed enough for third-party contributions.**

Three design goals follow from the gap, and Chapters 4 and 5 implement them in the order given, so that the architecture reads as a consequence of this analysis rather than as a set of independent preferences.

**G1: Every component runs embedded on a single host.** No broker, no external database service, no cloud dependency at runtime. This is what C1 costs, and §4.2 justifies each technology choice against it.

**G2: Isolation is an architectural invariant, not a feature.** Because C4 must hold for a shared installation, every layer, database rows, on-disk directories, job records and live event envelopes, keys on one identity claim. §4.5 states the invariant in the form future contributors must maintain.

**G3: Extension is by contract, and the contract is proven by using it internally.** Because C3 is where the gap actually lies, the module contract is the centre of the design (Chapter 5), and the platform's own analytical functionality is authored through it with no privileged hooks. §5.1 explains why this self-imposed constraint is the strongest available evidence that the contract is sufficient, and Chapter 6 reports what happened when it was tested against real research code.
