# Process Analysis Tool — Flows & Funds

A modular process analysis platform. Backend exposes a module registry and REST API; frontend provides an interactive BPMN canvas and per-module panels.

---

## Monorepo Layout

```
/
├── apps/
│   ├── api/          # FastAPI backend (Python, uv)
│   └── web/          # Next.js 15 frontend (TypeScript, pnpm)
├── docker-compose.yml
├── package.json       # Root pnpm workspace scripts
└── pnpm-workspace.yaml
```

A `packages/` layer is reserved for future shared libraries (e.g. generated TypeScript types from FastAPI's OpenAPI schema).

---

## Backend — `apps/api`

```
apps/api/
├── main.py                        # App factory; registers builtin modules
├── core/
│   ├── config.py                  # pydantic-settings env config
│   ├── database.py                # Async SQLAlchemy engine + session
│   └── dependencies.py            # Shared FastAPI Depends() injections
├── models/
│   └── process.py                 # ORM: ProcessDefinition, ProcessInstance, ModuleConfig
├── schemas/
│   ├── graph.py                   # Pydantic: NodeSchema, EdgeSchema, GraphSchema
│   └── process.py                 # Pydantic: request/response + ModuleManifest
├── routers/
│   ├── processes.py               # CRUD + graph save for ProcessDefinition
│   ├── modules.py                 # Module list + config endpoints
│   └── dashboard.py               # KPI stats + activity feed
├── services/
│   └── graph_service.py           # DAG validation (Kahn's algorithm, cycle detection)
├── modules/
│   ├── base.py                    # AbstractModule interface
│   ├── registry.py                # ModuleRegistry singleton
│   └── builtin/
│       ├── analytics/module.py    # process_analytics — bottlenecks, cycle-time histogram
│       ├── bpmn_importer/module.py # bpmn_importer — parses BPMN 2.0 XML → GraphSchema
│       ├── event_log_importer/module.py # event_log_importer — XES/CSV → DFG via pm4py
│       └── simulation/module.py   # process_simulation — Monte Carlo simulation
├── migrations/                    # Alembic migration scripts
├── pyproject.toml
└── Dockerfile
```

### Module system

Every module inherits `AbstractModule` (`modules/base.py`) and implements:
- `module_id` — unique snake_case string (e.g. `bpmn_importer`)
- `display_name`, `version`, `description`
- `get_router() → APIRouter` — mounted at `/api/v1/modules/{module_id}/`
- `get_config_schema() → type[BaseModel]` — Pydantic model for config form
- `on_startup()` / `on_graph_update(graph)` — optional lifecycle hooks

Modules are registered in `main.py` and mounted dynamically at startup via `registry.mount_all()`.

### API prefix

All endpoints: `/api/v1/`
- `/processes` — CRUD + `PUT /{id}/graph`
- `/modules` — list manifests, get/put config, per-module sub-routes
- `/dashboard` — `/stats`, `/activity`
- `/health`

---

## Frontend — `apps/web`

```
apps/web/
├── app/
│   ├── layout.tsx                 # Root: providers, fonts, theme
│   ├── page.tsx                   # Redirect to /dashboard
│   ├── globals.css
│   ├── api/
│   │   └── [...proxy]/route.ts    # Proxies /api/* → FastAPI
│   └── (platform)/
│       ├── layout.tsx             # Persistent sidebar + topbar
│       ├── dashboard/
│       │   ├── page.tsx
│       │   └── DashboardView.tsx
│       ├── processes/
│       │   ├── page.tsx
│       │   ├── ProcessesView.tsx
│       │   └── [id]/
│       │       ├── page.tsx
│       │       └── ProcessDetailClient.tsx
│       ├── modules/
│       │   ├── page.tsx
│       │   └── ModulesView.tsx
│       └── settings/
│           └── page.tsx
├── components/
│   ├── canvas/                    # All canvas-related code
│   │   ├── ProcessCanvas.tsx      # <ReactFlow /> connected to process store
│   │   ├── CanvasWorkspace.tsx    # Layout: palette + canvas + panels
│   │   ├── CanvasHeader.tsx       # Process name + save button
│   │   ├── CanvasContextMenu.tsx
│   │   ├── ModuleSwitcher.tsx
│   │   ├── nodes/                 # Custom xyflow node components
│   │   │   ├── TaskNode.tsx
│   │   │   ├── EventNode.tsx
│   │   │   ├── GatewayNode.tsx
│   │   │   ├── SubprocessNode.tsx
│   │   │   └── index.ts
│   │   ├── edges/
│   │   │   └── SequenceEdge.tsx
│   │   └── panels/                # Canvas-specific side panels
│   │       ├── NodePalette.tsx    # Drag-to-add node types
│   │       └── PropertiesPanel.tsx # Selected node / module output
│   ├── modules/                   # Module UI system
│   │   ├── types.ts               # ModulePanelProps, FrontendModuleManifest
│   │   ├── registry.ts            # Hardcoded frontend module manifest list
│   │   ├── ActiveModulePanel.tsx  # Renders the active module's panel
│   │   ├── ModuleConfigDialog.tsx
│   │   ├── bpmn_importer/Panel.tsx
│   │   ├── event_log_importer/Panel.tsx
│   │   ├── process_analytics/Panel.tsx
│   │   └── process_simulation/Panel.tsx
│   ├── layout/
│   │   ├── Sidebar.tsx
│   │   └── Topbar.tsx
│   └── ui/                        # shadcn/ui generated components
├── stores/
│   ├── process.store.ts           # Zustand: nodes, edges, isDirty, syncFromServer
│   └── ui.store.ts                # Zustand: sidebar, activeModuleId, selectedNodeId
├── lib/
│   ├── api-client.ts              # Fetch wrapper with ApiError
│   ├── schemas/
│   │   ├── graph.ts               # Zod: NodeSchema, EdgeSchema, GraphSchema
│   │   └── dashboard.ts           # Zod: stats + activity schemas
│   ├── utils.ts                   # cn() helper
│   └── time.ts                    # Date/duration formatters
├── hooks/
│   └── use-mobile.ts
├── types/                         # (empty — module types moved to components/modules/types.ts)
├── package.json
├── next.config.ts
└── Dockerfile
```

### State management

| Store | Holds |
|---|---|
| `process.store.ts` | `nodes`, `edges`, `isDirty`, `processId`; serialization to/from server |
| `ui.store.ts` | `sidebarCollapsed`, `isPanelOpen`, `selectedNodeId`, `activeModuleId`, `activePanelTab`; persisted to localStorage |

### Module panels

Each module panel is a React component accepting `ModulePanelProps` (defined in `components/modules/types.ts`). The active panel is selected by `activeModuleId` in the UI store and rendered by `ActiveModulePanel.tsx`.

The frontend registry (`components/modules/registry.ts`) is currently a static hardcoded list — it must be manually updated when a new backend module is added.

---

## Adding a New Module

### Backend
1. Create `apps/api/modules/builtin/{module_id}/module.py` implementing `AbstractModule`.
2. Register it in `main.py`: `registry.register(MyModule())`.

### Frontend
1. Create `apps/web/components/modules/{module_id}/Panel.tsx` implementing `ModulePanelProps`.
2. Add an entry to `apps/web/components/modules/registry.ts`.

---

## Running Locally

```bash
# Start all services
docker-compose up

# Or run individually
pnpm --filter web dev        # http://localhost:3000
uv run uvicorn main:app --reload --app-dir apps/api   # http://localhost:8000
```

FastAPI docs: `http://localhost:8000/docs`

---

## Environment Variables

```bash
# apps/api/.env
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/process_analysis_tool_flows_funds
SECRET_KEY=your-secret-here
ALLOWED_ORIGINS=http://localhost:3000
ENVIRONMENT=development

# apps/web/.env.local
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## Key Architectural Decisions

- **Graph stored as JSONB** in `ProcessDefinition.graph` — avoids a migration per node type addition.
- **DAG validated on save** via `graph_service.validate_dag()` (Kahn's algorithm) — cycles are rejected server-side.
- **Module panels receive data via props** (`ModulePanelProps`) — panels never directly mutate the process graph; they call `onNodeUpdate`.
- **No hardcoded colours in components** — all colours are CSS variables (`--primary`, `--surface`, etc.) defined in `globals.css`.
