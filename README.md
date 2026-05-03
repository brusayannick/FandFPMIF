# Flows & Funds

A locally-hosted, modular process analysis platform. Two services (`api` + `web`),
embedded data stores (SQLite + DuckDB + Parquet), no broker, no cloud.

For the full design, read [`INSTRUCTIONS.md`](./INSTRUCTIONS.md).

## Prerequisites

- **Docker Desktop** (macOS / Windows) or **Docker Engine + Compose v2** (Linux). That's it — no Python, Node, `uv`, or `pnpm` on the host.
- Free ports `3000` (web) and `8000` (api).
- ~2 GB free disk for the built images.

## Install & start

```bash
git clone <repo-url> flows-funds
cd flows-funds
make up
```

`make up` builds both images and starts the stack in the background. Open <http://localhost:3000> — first run lands on `/processes` with the empty state. Drop a XES, XES.gz, or CSV to start mining.

No `make` available? The plain-docker equivalent works the same:

```bash
docker compose up -d --build
```

## Common commands

| Command | What it does |
| --- | --- |
| `make up` | Start the prod-style stack (detached) |
| `make up-dev` | Start with hot reload — `uvicorn --reload` + `next dev`, source-mounted |
| `make down` | Stop the stack |
| `make build` | Rebuild both images |
| `docker compose logs -f api` | Tail API logs |
| `docker compose logs -f web` | Tail web logs |
| `make clean` | Wipe `./data/` (event logs, module results, SQLite) — irrevocable |

## Data & persistence

- `./data/` is bind-mounted under both modes — SQLite metadata + Parquet event logs + module results live here. Back up by copying the directory.
- `./modules/` is bind-mounted read/write — the install flow writes `modules/<id>/` into the host filesystem, and any module folder you drop in is picked up on the next start.

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
├── modules/         # Discoverable module packages — empty in v1
├── packages/
│   ├── module-sdk-py/   # Python SDK for module authors
│   ├── module-sdk-ts/   # TS SDK for module frontends
│   └── shared-types/    # Generated TS types from OpenAPI
├── data/            # Bind-mounted; SQLite + Parquet
└── docker-compose.yml
```

## What's not in v1

- No analytics modules ship with v1. The platform is the deliverable: ingest, store, jobs, the SDK, the manifest format, dependency isolation, the install flow, the (intentionally empty) module grid, and the Jobs UI.
- `subprocess` module isolation falls back to `in_process` with a warning.
- Watchdog hot-reload of modules is a manual restart in v1.
- Frontend module bundles (`frontend.panel` from a module's `.dist/`) are not yet dynamically loaded — modules can ship API routes and they mount, but a UI panel won't render until the per-module npm bundle build lands.
- Multi-user / RBAC, cloud deployment, and streaming ingestion are out of scope (see INSTRUCTIONS.md §15).

## Adding a module

```bash
mkdir modules/my_mod
$EDITOR modules/my_mod/manifest.yaml   # see §5.1 of INSTRUCTIONS.md
$EDITOR modules/my_mod/module.py        # subclass flows_funds.sdk.Module
make up-dev                             # restart picks it up
```

Or upload a zip / clone a git URL via Settings → Modules → Import.
