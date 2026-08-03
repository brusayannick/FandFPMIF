# Platform Setup and Operation

## Prerequisites and Repository Layout

Three things must be true of the host. A **container runtime**: Docker Desktop, or Docker Engine with Compose v2, recent enough for the compose merge tags the production overlay uses. Three **free ports**, 3000, 8000 and 8080, though the production overlay withdraws all three in favour of 443. And roughly **three gigabytes of free disk**, dominated by each module's own dependency tree, of which the drift-detection module's TensorFlow stack alone is about half a gigabyte. What is **not** required is a language toolchain: the images bring their own, and a Java runtime is baked into the API image. Only the host-native mode of §7.3 needs `uv` and `pnpm` locally.

```
mate/
  apps/api/               FastAPI backend (Python 3.12, src/mate/api/)
  apps/web/               Next.js 15 frontend (App Router, React 19)
  packages/module-sdk-py/ Python SDK that module authors subclass
  packages/module-sdk-ts/ TypeScript SDK for module frontends
  packages/module-sdk-jvm/ Java SDK for JVM modules
  packages/shared-types/  TypeScript types generated from OpenAPI
  modules/                Bundled module packages, discovered at startup
  infra/                  Keycloak realm, Caddy config, bootstrap scripts
  data/                   Bind-mounted: SQLite, Parquet, uploads, cached runtimes
  docs/                   Design spec, deploy runbook, MCP reference
  docker-compose.yml      Base stack
  compose.dev.yml         Dev overlay: hot reload
  docker-compose.prod.yml Prod overlay: Caddy and TLS
  Makefile                The single source of truth for every command
```

## Local Setup

```bash
git clone <repo-url> mate && cd mate
cp .env.example .env          # then rotate the two secrets below
make up                       # docker compose up -d --build
```

Exactly two values must change before the stack is exposed beyond the local machine: `AUTH_SECRET`, which encrypts the session cookie, and `KEYCLOAK_CLIENT_SECRET`, the confidential client secret for the web client. The sample value of the latter also appears in the committed realm export, which makes rotating it a security step rather than a formality; §7.4 explains that both places must change together or login fails.

Then open `http://localhost:3000` and sign in as `admin@flows-funds.local` with password `flowsfunds`; Keycloak forces a reset. The first run lands on the processes page ready for a XES, XES.gz or CSV file.

**First boot takes several minutes, and users who are not warned will conclude the system has hung.** Each module resolves its own dependencies on first start (§5.3), and one pulls TensorFlow, so the API container carries a ten-minute health-check grace period. Later boots reuse the cached wheels and dependency hashes and start in seconds. This is an intended consequence of per-module isolation, not a defect.

Additional accounts are created in the Keycloak console at `http://localhost:8080/admin`. The same console assigns the `admin` realm role that unlocks the administrative area; the seeded account does **not** carry it.

## Running Modes and Their Selection

These are **four layered configurations of one composition, not four tools**. `make up` is `docker compose up -d --build` against the base file; every other mode adds an overlay.

[[TABLE]]
caption: The four running modes and when to choose each.
| Mode | Command | What it gives | Choose it when |
| --- | --- | --- | --- |
| Host-native development | `make dev` | Both dev servers on the host, hot reload, no Docker | You are a **module author** or frontend contributor and want the shortest edit-to-reload loop. Needs `uv` and `pnpm` locally. |
| Base composition | `make up` | Production-style built images, detached, no reload, ports published | You want to **run** the platform, or preview the production build locally. The quick-start default. |
| Development overlay | `make up-dev` | `uvicorn --reload` and `next dev` in the containers, source mounted | You are a **platform contributor** needing the containerised environment with reload. |
| Production overlay | `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build` | Adds Caddy and TLS, collapses onto one origin, withdraws published ports | You are **deploying**. There is deliberately no `make` target, so the command is conscious. |
[[/TABLE]]

## Deployment on a University Virtual Machine

**Provisioning assumptions.** A Linux VM reachable over SSH, with Docker Engine and Compose v2, membership of the faculty development VPN for administrative access, and TLS certificate files under the standard Let's Encrypt path readable by the Docker daemon; renewal happens outside the platform and the proxy re-reads on restart. **The proxy chain shapes the deployment.** The university's edge proxy knows one thing: this hostname forwards to that port on the VM. It cannot split traffic across three services. So the VM runs a Caddy container binding 443, terminating TLS with the VM's own certificate and routing by path: `/api/v1/*` and `/health` to the API, `/auth/*` to Keycloak, everything else to the web application. The public certificate lives on the university proxy; the VM certificate secures only the proxy-to-VM hop, which is why Caddy binds by port and tolerates the hostname mismatch.

[[FIGURE]]
caption: The two-proxy chain in production, and the same-origin collapse it produces.
insert: DIAGRAM. Three stacked layers with downward arrows. Top: "Internet, https://pm-mate.uni-muenster.de (public cert on the uni proxy)". Middle: "uni edge proxy, forwards :80 and :443 to the VM's :443". Bottom: a box "VM :443, proxy container (Caddy), terminates TLS with the pm-mate-vm certificate" containing three routing rows: "/api/v1/* and /health to api:8000", "/auth/* to keycloak:8080", "everything else to web:3000". Annotate: "single same-origin: no CORS, no hosts entries" and "WS upgrades are dropped here, see section 4.10".
[[/FIGURE]]

The consequence is the **same-origin collapse**: the browser talks to one origin for everything, so the per-port CORS configuration and the local hosts entry for Keycloak that the localhost setup needs both disappear, and the published ports are withdrawn. This is also where §4.10's transport constraint originates: the edge proxy does not carry WebSocket upgrades, which is why both live streams are Server-Sent Events, and why the verification below exercises live updates specifically.

**Bootstrap.** Clone into the deployment user's home directory and run `infra/bootstrap-vm.sh`, which does three fiddly things in one idempotent pass: generates `.env` with fresh secrets, patches the realm export so the production origin is an allowed redirect target and the client secret matches `.env`, and brings the stack up after a free-port check. Two things must line up or login fails, and guaranteeing them is why the script exists. The **client secret** appears in `.env` and in the realm JSON and must be identical in both. The **redirect URI and web origin** must include the production hostname, because Keycloak only redirects to pre-approved URLs. A crucial detail for anyone doing this by hand: the realm import happens **only on the first boot, into an empty Keycloak database**; on a redeploy it is skipped and realm changes must be made in the administration console.

**University login.** To send every login straight to the university identity provider, register an OIDC client with the university whose redirect URI is Keycloak's broker callback, configure the identity provider on the *running* Keycloak with the supplied script, and set the identity-provider hint in `.env`. The local administrator account remains reachable through the Keycloak master realm as a break-glass path. Replacing an already-imported provider requires deleting it first, because Keycloak ignores the provider type on update.

**Resource limits and optional services.** Four environment variables matter on a shared machine: worker concurrency, the job execution timeout, the CPU-offload pool size, and DuckDB's per-query limits. Optional sidecars are enabled by listing compose profiles: the graph database for `actor_performance`, and the object-storage backend, which needs a byte budget configured before it reclaims disk rather than merely mirroring.

**What does not work out of the box.** Each item is an opt-in or a per-deployment secret rather than a bug: the graph sidecar is off, so `actor_performance` shows a setup screen; the drift-detection module has no model unless one is uploaded or pinned globally, and without one every import starts a job that fails; the seeded account has no `admin` role; the university identity provider points at placeholders until configured; the MCP server is off; and user deletion does not remove the Keycloak account unless the administrative client is configured.

## Verification and Update Procedure

A deployment is healthy when five checks pass in this order, because each rules out one layer.

1. **The web application answers through the proxy.** `curl -I https://<host>` returns a redirect or 200.
2. **The API answers through the proxy.** `curl https://<host>/health` returns the liveness payload unauthenticated.
3. **The Keycloak issuer is the public URL**, not a container name or localhost, checked against the realm's OpenID configuration document. If this is wrong, login loops, and this is the fastest way to see it.
4. **A full login round-trip succeeds.** Do this once in Safari as well as Chrome, because Safari enforces cookie size limits more strictly and the failure mode is browser-specific (§9.4).
5. **Import a log, watch a job, open the assistant.** This confirms live updates survive both proxies. If everything else works and only live updates stall, the transport is the problem.

Two further confirmations are worth making on a fresh deployment: that the one-shot realm-hardening service exited zero, since a non-zero exit leaves the platform running with an unpatched realm, and that module mounting succeeded, which the module settings page shows per module with any load errors.

**Updating a running instance** is a pull, a rebuild and a restart; migrations run automatically on API startup. What must precede an update is a **backup**, because migrations are not reversible in general: copy the bind-mounted `data/` directory and keep the copy until the update is verified. Two rebuild triggers are easy to forget: any variable inlined into the client bundle at build time needs `--build`, and an environment-variable change needs the service brought up again rather than restarted, because a restart preserves the old environment.

## Administration and Data Governance

**Role assignment.** The single realm role `admin`, assigned in the Keycloak console, unlocks the administrative area, the export, module policy and the live concurrency control, and deserves the care of any administrative credential.

**The metadata export** is a consistent snapshot of the whole metadata database as one SQLite file. It is the most useful administrative tool and the most sensitive artefact the platform produces: it contains **every user's** accounts, usage data, process metadata, dashboards and settings, not the requesting administrator's. Handle it as a data extract, not a diagnostic dump.

**The usage-capture policy** has three settings and a default worth commenting on. Capture records interaction events locally in the OCEL-shaped model of Abb and Rehse (2024) and transmits nothing off the host. `force` keeps capture on for every user and **hides both the onboarding privacy step and the privacy settings tab, so there is no opt-out**; `on` enables it by default with an opt-out; `off` disables it by default with an opt-in. The shipped default is `force`. For a research deployment where usage data is part of what is studied and users are informed separately, that is defensible. For any other deployment it is the wrong default, and the honest statement is that the platform makes the convenient choice rather than the conservative one.

**Backup** is copying `data/`, which holds the metadata database, per-user Parquet event data and module results, uploaded modules and cached runtimes. Keycloak's data lives in a Docker volume and must be backed up separately if accounts are to survive; taking the stack down with volumes removed wipes accounts and re-imports the realm on the next boot.

## A Typical Analysis Workflow

This walks once through a user's path so a reader who has not used the system can picture the architecture chapters. Appendix A is the manual.

The user lands on **Processes** and chooses *Import event log*. For a CSV they first complete a column-mapping step, saying which column is the case identifier, which the activity and which the timestamp, since a CSV carries no semantics of its own (§2.1).

[[FIGURE]]
caption: Importing an event log, with the column-mapping step shown for a CSV source.
insert: SCREENSHOT. The import page at /processes/import, light mode, roughly 1440 px wide. Show a CSV mid-import so the column-mapping wizard is visible with case_id, activity and timestamp mapped and at least one unmapped optional column. Crop to the content area.
[[/FIGURE]]

The request returns immediately with a log identifier and a job identifier, and the new row appears greyed out with an inline progress bar fed by the per-job stream. The bottom-left job dock shows the same progress and a toast announces the queued import.

When parsing finishes the log does not become available at once. It enters `processing` while the modules in its precompute closure run (§4.8), and the jobs drawer renders that closure as a checklist: what is waiting, running, finished, and skipped because an upstream module failed. Only when every expected module has reached a terminal state does the row un-grey.

[[FIGURE]]
caption: The processes list during import, with the job dock and the precompute checklist.
insert: SCREENSHOT. The /processes page, light mode, roughly 1440 px wide, with at least three logs listed and one in the processing state showing its inline progress bar. Open the jobs drawer so the precompute plan checklist is visible with a mix of finished, running and waiting entries.
[[/FIGURE]]

Clicking the log opens its detail page: a header of key statistics, tabs for the events table and variants, and a grid of module cards grouped by category. Cards are full colour when the module applies, greyed with a tooltip when a requirement is unmet, and amber-badged when an optional dependency is missing. Clicking a card opens that module's panel, which is the module's own code rendered inside the platform's chrome (§5.7).

[[FIGURE]]
caption: A module panel: the discovery module's directly-follows graph for the active log.
insert: SCREENSHOT. /processes/{logId}/modules/discovery, light mode, roughly 1440 px wide. Show the DFG canvas with the shared canvas controls visible and the settings popover closed. Use a log with 15 to 30 activities so the graph is legible at figure size.
[[/FIGURE]]

[[FIGURE]]
caption: A composed dashboard drawing cards from several modules against one log.
insert: SCREENSHOT. A dashboard page with at least five cards from at least three different modules, light mode, roughly 1440 px wide, including one KPI tile row and one chart. Crop to the board area.
[[/FIGURE]]

Finally the user composes a **dashboard**: a saved grid of cards drawn from any installed module's widgets, all bound to one log. This is where cross-module work happens today, and where the limitation of §6.7 is felt, since the cards sit side by side without a shared notion of the activity or variant the user is looking at. A dashboard can be shared read-only with named colleagues, the single sanctioned path by which anything crosses an account boundary (§4.5). Returning later, the user finds the log, its precomputed results and their dashboard exactly as they left them, which is the property §2.4 named as the first thing a platform adds to a library.
