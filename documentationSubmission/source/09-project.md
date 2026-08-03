# Project Organisation

## Team, Roles, and Working Model

Development was organised around four areas of responsibility under a common project-management and communication structure: **Development**, **UI and Design**, **Integration and Architecture**, and **Documentation**. Each area was assigned to one or two team members who took ownership of its progress.

The model chosen was ownership without exclusivity. A strict division of labour would have produced clean accountability and a bad system: the module contract is exactly the kind of artefact that degrades when the person designing it is not also the person who has to satisfy it. A wholly flat model would have left the cross-cutting concerns, isolation, the deployment, the documentation, belonging to nobody in particular, which is the standard way such concerns rot. The compromise was that being responsible for an area meant **coordinating and driving it rather than working on it in isolation**, with members supporting one another across boundaries wherever needed.

Communication used two complementary channels: **Microsoft Teams** as the central hub for structured collaboration, document exchange and contact with the supervisors, and **WhatsApp** for quick, informal coordination within the team. Concentrating document exchange and supervisor communication in one environment kept the current state of the work transparent to everyone involved. The meeting rhythm had two recurring touchpoints: a **weekly internal meeting** reviewing the state of each area and resolving open questions, and a **weekly lunch** as a more formal occasion to stay connected as a whole team and keep supervisors and requirements up to date.

## Timeline and Milestones

The project ran from mid-April to the beginning of August 2026. The repository records 90 commits over that period, and the milestones below are read from it rather than from a plan document, so they record when a capability actually landed rather than when it was scheduled.

[[FIGURE]]
caption: Project timeline from repository history, April to August 2026.
insert: DIAGRAM (timeline). Horizontal axis from 2026-04-17 to 2026-08-03. Plot the milestones from the table below as labelled markers. Optionally overlay commit frequency per week as a light bar series behind the markers, which shows the two activity peaks in mid-June and mid-July. Keep it to one row of markers plus the bar series; a full Gantt with per-area swimlanes would need effort data the repository does not contain.
[[/FIGURE]]

[[TABLE]]
caption: Milestones and their actual completion, from repository history.
| Date | Milestone |
| --- | --- |
| 2026-04-17 | Repository initialised; platform skeleton |
| 2026-06-02 | Containerised stack stabilised (Keycloak health check) |
| 2026-06-05 | Authentication working end to end; OCEL ingest |
| 2026-06-07 | Dashboards |
| 2026-06-09 | Object-centric discovery |
| 2026-06-15 | Integrated assistant, first version |
| 2026-06-17 | **Migration to Server-Sent Events**; admin insights; watched folders; object-storage backend, first version |
| 2026-06-21 | First externally contributed module (`pcomp`) |
| 2026-06-22 | AgentSimulator (first subprocess-isolated module) |
| 2026-06-27 | Parallel precompute |
| 2026-07-01 | Object-storage offload redesign merged |
| 2026-07-05 | Safari login-loop fix |
| 2026-07-13 | **MCP server**; interface rework |
| 2026-07-14 | **JVM module runtime**; sidecar services; module policy control |
| 2026-07-15 | Administrative control surface completed |
| 2026-07-28 | Dashboard rework; onboarding and guided tour; canvas unification |
[[/TABLE]]

Three deviations were consequential enough to explain.

**Authentication took far longer than budgeted.** Expected to be a configuration task, it became a six-week thread from early June to early July spanning the container health check, the token exchange path, the issuer configuration, cookie size, a browser-specific session failure and the university identity provider's authentication method (§9.4). The deployment milestone moved roughly three weeks later than planned.

**The realtime transport had to be rebuilt after it was working.** The WebSocket implementation was complete and correct and failed only in production, for an environmental reason nobody had anticipated (§4.10). The migration to Server-Sent Events was unplanned work in the middle of the project.

**The polyglot runtime arrived late and cheaply.** The JVM runtime was originally a stretch goal likely to be dropped. It landed in mid-July in a single work package, because by then the worker bridge already existed for subprocess isolation and the work reduced to extracting a runtime abstraction from it and writing a Java SDK against the existing protocol. This is the clearest instance in the project of an earlier architectural decision paying off later.

## Development Practice and Quality Assurance

**Version control.** Work proceeded on `main` with short-lived feature branches merged through pull requests. Four accounts appear as committers, which understates participation, since much of the work was paired and committed by one author. **Enforced gates on both toolchains.** Python is linted and formatted by `ruff` at a hundred-character line length and type-checked by `pyright` in strict mode over the API sources and the Python SDK; TypeScript is checked by `tsc --noEmit` in strict mode. These are not advisory: strict typing on the Python side is what makes the Protocol-typed context of §5.2 meaningful, because a Protocol nothing checks is a comment.

**Test layers.** Three, matching the three ways the system can be wrong. Platform tests are 75 pytest modules totalling roughly 16,600 lines covering ingest, jobs, the loader, per-user installation, isolation and sharing, storage, the MCP surface and the administrative routes. Module tests live in each module's own directory and run against that module's environment. Cross-runtime conformance tests drive the same behaviours against every runtime, with a golden-file test pinning the exact wire messages so a protocol change that would break a third-party worker fails in the platform's own suite.

**Generated-type synchronisation.** The frontend's API types are generated from the backend's OpenAPI description rather than written, and regenerating after a route or schema change is a standing rule, so a backend change the frontend has not absorbed fails at compile time instead of at run time.

Several of these were introduced **in response to a problem** rather than adopted at the start, and saying which is more useful than listing them all as good practice. The strict `pyright` configuration followed a class of bug in which a module handler received a shape it did not expect. The conformance and golden-file tests were written immediately after the JVM runtime, because the moment a second implementation of a protocol exists, prose stops being a sufficient specification. The bridge respawn and parent-death-guard tests were both written after observing the failures they now prevent. And the runtime-externals parity test exists because the allow-list was once edited in one of its two consumers and not the other, producing a panel that built and then failed in the browser.

## Significant Difficulties During the Project

Five difficulties materially affected the schedule or the design. Each is given with its architectural consequence; the complete defect record is Appendix E.

**Authentication against institutional infrastructure.** The single largest unplanned cost. The chain is instructive because each failure looked like the previous one: a Keycloak container whose health check used a bash-only construct under a shell that was not bash; an issuer configured as the container name rather than the public URL, which breaks the OIDC login loop but presents as a redirect loop; a server-side token exchange that had to stay on-box; a session cookie that grew past four kilobytes once it carried the full token, which the reverse proxy answered with a 502; and, after that was fixed with a server-side session store, a recurrence appearing **only in Safari**, which evicts oversized chunked cookies where Chrome tolerates them. The university identity provider then rejected the initial integration because it requires `client_secret_basic` specifically. *Consequence:* the server-side session store, the bootstrap script that keeps the client secret and redirect URIs consistent across `.env` and the realm, and the ordered verification checklist of §7.5 in which each step rules out one layer.

**The transport the production proxy would not carry** (§4.10). *Consequence:* both live streams migrated to Server-Sent Events, authentication moved from the query string to a header, and the deployment guide gained an explicit instruction to test live updates as a distinct step, because everything else can pass while they silently do not.

**Reproducibility across machines.** The stack built on the machines it was developed on and failed on others, for two reasons. The installer used `uv sync`, which writes a lock file, and lock-file writes fail on macOS Docker Desktop bind mounts because of restrictions in the file-sharing layer; switching to `uv venv` plus `uv pip install` made the same code path work everywhere. Separately, an environment built by a host-mode run under one interpreter and then bind-mounted into a container running another crashed on import; folding the platform's Python version into the dependency hash made such an environment rebuild automatically. *Consequence:* §5.3's hashing scheme, and the principle that the module system must tolerate a bind-mounted directory being written by two different environments.

**Storage growth on the virtual machine.** A deployment running for a few weeks accumulated far more disk than the imported data explained, and the first object-storage implementation did not help because it was a mirror rather than a cache (§4.6). *Consequence:* the four-phase redesign in which object storage became authoritative and local disk a bounded LRU cache, with the previously unenforced quota enforced and the bypassing artefacts brought in.

**Dependency cost as a user-visible defect.** The first boot of a clean checkout takes several minutes, dominated by one module's TensorFlow stack, and early testers reported it as a hang. *Consequence:* a ten-minute health-check grace period, explicit warnings in the README and the deployment guide, and the caching scheme making every subsequent boot fast. It is recorded as a difficulty rather than a footnote, because it is the most visible price the per-module isolation of §5.3 exacts.
