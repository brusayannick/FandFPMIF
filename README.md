# Flows & Funds

A locally-hosted, modular process analysis platform. Two services (`api` + `web`),
embedded data stores (SQLite + DuckDB + Parquet), no broker, no cloud.

For the full design, read [`INSTRUCTIONS.md`](./INSTRUCTIONS.md).

## Quick start

```bash
make install   # uv sync --extra dev + pnpm install
make dev       # api on :8000, web on :3000 (no docker)
```

Open http://localhost:3000 — first run lands on `/processes` with the empty state. Drop a XES, XES.gz, or CSV to start mining.

### With Docker

```bash
make up        # production-style images, two services
make up-dev    # uvicorn --reload + next dev, source-mounted
make down
```

The `data/` directory is bind-mounted under both modes — back up by copying it.

### Tests

```bash
make test       # backend (pytest, 20 tests)
make typecheck  # frontend (tsc)
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
make dev                                # restart picks it up
```

Or upload a zip / clone a git URL via Settings → Modules → Import.
