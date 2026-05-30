# Flows & Funds

A locally-hosted, modular process mining platform. Two services (`api` + `web`),
embedded data stores (SQLite + DuckDB + Parquet), no broker, no cloud. Ships
with a working set of analytics modules and an in-app AI assistant.

For the full design rationale, read [`INSTRUCTIONS.md`](./INSTRUCTIONS.md). For
the module authoring contract, read [`modules/README.md`](./modules/README.md).

## Quick start

```bash
git clone <repo-url> flows-funds
cd flows-funds
make up
```

Then open <http://localhost:3000>.

## Advanced setup

### Prerequisites

- **Docker Desktop** (macOS / Windows) or **Docker Engine + Compose v2** (Linux). No Python, Node, `uv`, or `pnpm` needed on the host.
- Free ports `3000` (web) and `8000` (api).
- ~2 GB free disk for the built images. First boot pulls each module's Python deps (cv4cdd alone pulls TensorFlow, ~500 MB) — subsequent boots reuse the cached wheels under `data/uv-python/`.

### Step-by-step

1. **Clone the repo.**

   ```bash
   git clone <repo-url> flows-funds
   cd flows-funds
   ```

2. **Build and start the stack.** `make up` is a thin wrapper around `docker compose up -d --build` — it builds both images (`api`, `web`) and starts them detached. Either command works:

   ```bash
   make up
   # or
   docker compose up -d --build
   ```

   First boot takes several minutes because each module resolves its Python deps into its own `.venv/`. The api container's healthcheck has a 10-minute grace period to cover the worst case (cv4cdd pulling TensorFlow). Subsequent boots reuse the cached wheels and start in seconds.

3. **Open the app.** Visit <http://localhost:3000>. The first run lands on `/processes` with the empty state — drop a XES, XES.gz, or CSV file to start mining.

4. **Hot-reload mode (optional, for development).** Use the dev overlay to run `uvicorn --reload` + `next dev` with the source tree mounted:

   ```bash
   make up-dev
   ```

5. **Stop the stack.**

   ```bash
   make down
   ```

## Bundled modules

The modules under [`modules/`](./modules/) are discovered on startup and
mounted automatically:

| Module | What it does |
| --- | --- |
| `discovery` | Process discovery — DFG, Petri nets (Alpha / Inductive), Process Tree, Heuristics Net, BPMN |
| `performance` | Throughput, lead / cycle / sojourn time, P90, bottlenecks, performance DFG |
| `complexity` | EPA-based complexity measures — variant/sequence entropy, Lempel-Ziv, affinity, structure, Pentland's task/process complexity |
| `cv4cdd` | Computer-vision concept-drift detection (sudden, gradual, incremental, recurring) |
| `concept_drift_explainer` | LLM-backed explanations for drifts, grounded in user-uploaded enterprise documents |
| `agent_simulator` | Agent-based simulation that learns from a log and generates synthetic traces |
| `demo` | Minimal reference module — useful when authoring your own |

Enable / disable / configure each one under **Settings → Modules**.

## Mate AI

The right-side chat panel ("Mate AI") is wired to your own LLM provider —
keys, model, and system prompt live in `data/metadata.db` (under the
`ai.config` user-setting) and never leave the box. Configure under
**Settings → AI**. The assistant can reference the active process log,
modules, and recent jobs when answering.

## Privacy & usage

Anonymous usage capture is **on by default**. Toggle it under
**Settings → Privacy**. Events stay in the local SQLite database; nothing
ships off the host.

## Common commands

| Command | What it does |
| --- | --- |
| `make up` | Start the prod-style stack (detached) |
| `make up-dev` | Start with hot reload — `uvicorn --reload` + `next dev`, source-mounted |
| `make down` | Stop the stack |
| `make build` | Rebuild both images |
| `make test` | Run the Python test suite (inside Docker) |
| `make typecheck` | Type-check the web app |
| `docker compose logs -f api` | Tail API logs |
| `docker compose logs -f web` | Tail web logs |
| `make clean` | Wipe `data/event_logs/`, `data/module_results/`, and `data/metadata.db` — irrevocable. Module folders are kept. |

## Data & persistence

- `./data/` is bind-mounted — SQLite metadata, Parquet event logs, module results, and the cached uv-managed Python runtimes all live here. Back up by copying the directory.
- `./modules/` is bind-mounted read/write — the install flow writes `modules/<id>/` into the host filesystem, and any module folder you drop in is picked up on the next start. Each module's `.venv/` and `.dist/` (esbuilt frontend bundle) are auto-created and gitignored.

## Configuration

The defaults in [`docker-compose.yml`](./docker-compose.yml) work out of the box for `localhost`. Override when running on a different host:

- `NEXT_PUBLIC_API_URL` (default `http://localhost:8000`) — the URL the **browser** uses to reach the API. This is inlined at build time, so changing it requires a rebuild (`make build` or `docker compose up -d --build`).
- `CORS_ORIGINS` on the api (default `["http://localhost:3000"]`) — extend this if the web origin changes.

## Tests

Run inside Docker so the host doesn't need the toolchain:

```bash
docker compose run --rm api uv run pytest apps/api/tests -v
docker compose run --rm web pnpm typecheck
```

## Layout

```
flows-funds/
├── apps/
│   ├── api/         # FastAPI backend
│   └── web/         # Next.js 15 frontend
├── modules/         # Bundled + user-installed module packages
├── packages/
│   ├── module-sdk-py/   # Python SDK for module authors
│   ├── module-sdk-ts/   # TS SDK for module frontends
│   └── shared-types/    # Generated TS types from OpenAPI
├── data/            # Bind-mounted; SQLite + Parquet + cached runtimes
└── docker-compose.yml
```

## Adding a module

```bash
mkdir modules/my_mod
$EDITOR modules/my_mod/manifest.yaml   # see modules/README.md §3
$EDITOR modules/my_mod/module.py        # subclass flows_funds.sdk.Module
make up-dev                             # restart picks it up
```

Or upload a zip / clone a git URL via **Settings → Modules → Import**.