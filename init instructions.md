
***

## Mission Statement

You are building **Process Analysis Tool - Flows \& Funds**, a modular, production-grade process analysis platform. This is the **core shell** of a platform designed to accept new analytical modules without structural changes. Every architectural and design decision must prioritize extensibility, clarity, and performance. This document is your single source of truth.

***

## Tech Stack Overview

### Frontend

#### Next.js 15 (App Router)

Next.js is your **React meta-framework and application backbone**. It handles:

- **File-based routing** via the `app/` directory — every folder is a route segment, every `page.tsx` is a view, every `layout.tsx` wraps persistent UI (sidebar, topbar) around child pages.
- **Server Components by default** — components that fetch data or render static UI run on the server, reducing JavaScript sent to the browser.
- **`"use client"` directive** — mark components with this when they use browser APIs, React state (`useState`, `useEffect`), or interactive libraries like xyflow. The canvas workspace **must** be a Client Component.
- **API Routes** (`app/api/`) — thin bridge routes that proxy requests from the frontend to the FastAPI backend. Use these to avoid exposing the backend URL directly to the browser.
- **Proxy** (`proxy.ts`) — intercept requests for authentication guards, redirects, and locale detection before the page renders.


#### shadcn/ui

shadcn/ui is your **component library and design foundation**. It is not a dependency you install as a package — it is a collection of copy-owned components generated into `components/ui/` via the shadcn CLI. This means:

- Every component is fully owned, editable, and customizable without overriding third-party styles.
- Components are built on **Radix UI primitives** (accessible, unstyled behaviour) and styled with **Tailwind CSS v4**.
- Use the shadcn CLI to add components: `npx shadcn@latest add button card dialog table tabs`.
- The platform's UI consistency is enforced through shadcn tokens defined in `globals.css` (CSS variables for `--background`, `--foreground`, `--primary`, `--muted`, etc.).
- **React Flow UI** (xyflow's official shadcn component set) is installed via the same CLI: `npx shadcn@latest add "https://reactflow.dev/components/..."`. These are pre-built, Tailwind-styled node and edge layouts that integrate natively with your design tokens.


#### Tailwind CSS v4

Tailwind is your **utility-first styling engine**. In v4:

- Configuration moves from `tailwind.config.ts` to `@theme` blocks inside `globals.css` — no separate config file needed.
- Design tokens (colors, radius, fonts) are defined once as CSS variables and consumed both by Tailwind utilities and raw CSS.
- Use `cn()` (from `lib/utils.ts`) to conditionally merge Tailwind class names: `cn("base-class", condition && "conditional-class", className)`.


#### @xyflow/react

xyflow is your **interactive canvas engine**. It renders the visual process graph — nodes, edges, handles, and the viewport — entirely in the browser. Its role:

```
- Provides `<ReactFlow />` as the canvas container, `<Background />` for the grid pattern, `<Controls />` for zoom/pan buttons, and `<MiniMap />` for the overview thumbnail.
```

- Exposes `useReactFlow()` hook for programmatic access to `fitView()`, `setNodes()`, `setEdges()`, `getNodes()`, and viewport manipulation.
- Supports **custom nodes** — every process node type (Task, Gateway, Event, Subprocess) is a React component registered in the `nodeTypes` map and passed to `<ReactFlow nodeTypes={nodeTypes} />`.
- Supports **custom edges** — custom edge renderers with animated paths, status badges, and throughput labels.

```
- **Critical rule:** The `<ReactFlow />` component and all xyflow hooks must live inside Client Components (`"use client"`). The canvas page must be wrapped in a `ReactFlowProvider` if xyflow state is accessed outside the direct `<ReactFlow />` child tree.
```


#### Zustand

Zustand is your **global client-side state manager**. Because xyflow's node/edge state needs to be accessible from multiple parts of the UI simultaneously (toolbar, properties panel, node components, analytics overlay), Zustand acts as the single source of truth. Its role:

- Stores `nodes`, `edges`, `onNodesChange`, `onEdgesChange`, and `onConnect` as the canonical xyflow state.
- Stores UI state: `selectedNodeId`, `activePanelTab`, `isSimulationRunning`, `activeModuleId`.
- Custom nodes call Zustand's `useProcessStore()` hook directly to read/update their own state without prop drilling.
- Enables cross-module communication: when the Analytics module reads process performance data, it reads from the same Zustand store that the Canvas module writes to.


#### React Query (TanStack Query v5)

React Query is your **server state manager and data-fetching layer**. It handles all communication between the Next.js frontend and the FastAPI backend:

- Provides `useQuery()` for GET requests (fetching process definitions, analytics data, module configs) with built-in caching, background refetching, and stale-time control.
- Provides `useMutation()` for POST/PUT/DELETE requests (saving process graphs, triggering simulations, adding modules) with optimistic update support.
- The `QueryClientProvider` wraps the root layout so all components have access.
- Cache keys follow the pattern `["processes", processId]` — this enables granular cache invalidation when a process is updated.


#### Zod

Zod is your **runtime schema validation library**. It validates:

- API responses from FastAPI before they are consumed by the frontend — if the response shape changes, Zod throws a clear error rather than a silent undefined crash.
- Form inputs in the Properties Panel before submission.
- Module configuration schemas — each module declares a Zod schema for its configuration object, enforcing type safety at the module boundary.
- Zod schemas double as TypeScript types via `z.infer<typeof Schema>`, eliminating schema/type duplication.

***

### Backend

#### FastAPI

FastAPI is your **Python API layer and computational engine**. It runs as a standalone service (default port `8000`) and is consumed exclusively by the Next.js frontend via its API routes. Its roles:

- **Routing:** All endpoints are organized by domain using `APIRouter`. Each module registers its own router: `app.include_router(process_router, prefix="/api/v1/processes")`.
- **Request/Response Validation:** Every request body and response model is a Pydantic class. FastAPI uses these to auto-validate incoming JSON and serialize outgoing responses — no manual validation code.
- **OpenAPI Schema:** FastAPI auto-generates a `/docs` (Swagger UI) and `/redoc` endpoint from your Pydantic models. Use `openapi-fetch` on the frontend to generate a fully typed TypeScript client from this schema, giving you end-to-end type safety without manual type writing.
- **Async by default:** All route handlers should be `async def` to prevent blocking the event loop during I/O operations (database reads, external API calls, file processing).
- **Dependency Injection:** FastAPI's `Depends()` system injects shared services (database sessions, authentication, module registries) into route handlers cleanly without global variables.


#### Pydantic v2

Pydantic is FastAPI's **data modelling and validation backbone**. Every graph structure, module configuration, and analytics result is a Pydantic model:

- `BaseModel` classes define the shape of all API contracts.
- Validators (`@field_validator`, `@model_validator`) enforce business rules — e.g., a process graph must have at least one start event.
- The `model_json_schema()` method exports JSON Schema, which FastAPI feeds into its OpenAPI output.


#### SQLAlchemy 2.0 + Alembic

SQLAlchemy is your **ORM** (Object-Relational Mapper). Use the async engine (`AsyncSession`) to interact with PostgreSQL without blocking. Its role:

- Maps Python classes to database tables — `ProcessDefinition`, `ProcessInstance`, `Node`, `Edge`, `ModuleConfig`.
- Provides `async with session.begin()` context managers for transactional operations.

Alembic handles **database migrations**. Every schema change is a versioned migration file (`alembic revision --autogenerate -m "add simulation_results table"`). Run migrations as part of the deployment pipeline.

#### PostgreSQL

PostgreSQL is your **primary relational database**. It stores:

- Process definitions (the serialized node/edge graph as JSONB)
- Process instances and execution history
- Module configurations and registrations
- User accounts and permissions

Use JSONB columns for storing the xyflow graph state (nodes and edges arrays) — this allows flexible schema evolution for node data without requiring a migration every time a node type adds a new property.

#### uv (Python Package Manager)

`uv` is your **Python dependency and virtual environment manager**. It replaces `pip` + `venv` + `pip-tools` with a single, extremely fast tool:

- `uv sync` installs all dependencies from `pyproject.toml` in seconds.
- `uv add fastapi pydantic sqlalchemy` adds packages and pins them in `pyproject.toml`.
- Include `uv.lock` in version control for reproducible installs across environments.

***

## Typography

The platform uses **SF Pro Display** as its primary typeface — Apple's system sans-serif, optimized for display at 20pt and above.

```css
/* globals.css — font stack */
:root {
  --font-display: "SF Pro Display", -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif;
  --font-body:    "SF Pro Text", -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif;
}
```


### Rules

- **Headlines and page titles:** `--font-display`, Bold (700), rendered at `--text-xl` (24-36px) and above. SF Pro Display's optical sizing makes it crisp and authoritative at these scales.
- **Body, labels, buttons, metadata:** `--font-display` or `--font-body`, Regular (400) or Light (300). Never use Bold below 18px in the process canvas — it creates visual noise on dense graphs.
- **Data values and numbers** in analytics panels: `font-variant-numeric: tabular-nums lining-nums` — ensures columns align perfectly as values update in real time.
- **Node labels in the canvas:** Regular weight, 13-14px (`--text-sm`), with `text-rendering: optimizeLegibility`. Do not use Bold for node labels unless indicating an error or critical state.
- **SF Pro Display is a system font on Apple devices and does not require a CDN load.** On non-Apple systems, `-apple-system` and `BlinkMacSystemFont` fall through gracefully to the system sans-serif. This makes the font stack zero-cost in terms of network requests.

***

## UI Design System

### Colour Palette — Dark-First Precision

The platform defaults to **dark mode** as its primary theme (process analysts and engineers typically work in low-light environments or prefer focused dark interfaces). Light mode is fully supported via a toggle.

```css
:root, [data-theme="dark"] {
  --background:           #0e0e0f;
  --surface:              #141415;
  --surface-2:            #1a1a1b;
  --surface-offset:       #202022;
  --border:               rgba(255, 255, 255, 0.08);
  --divider:              rgba(255, 255, 255, 0.05);

  --text:                 #f0eeeb;
  --text-muted:           #8a8886;
  --text-faint:           #4a4947;

  --primary:              #4f98a3;   /* Hydra Teal — primary accent */
  --primary-hover:        #227f8b;
  --primary-active:       #1a626b;
  --primary-highlight:    rgba(79, 152, 163, 0.12);

  --success:              #6daa45;
  --warning:              #e8af34;
  --error:                #dd6974;
  --info:                 #5591c7;

  --radius-sm:            4px;
  --radius-md:            8px;
  --radius-lg:            12px;
  --radius-xl:            16px;
}

[data-theme="light"] {
  --background:           #f7f6f2;
  --surface:              #ffffff;
  --surface-2:            #f4f3ef;
  --surface-offset:       #eeede9;
  --border:               rgba(0, 0, 0, 0.08);
  --divider:              rgba(0, 0, 0, 0.05);

  --text:                 #1a1917;
  --text-muted:           #7a7974;
  --text-faint:           #bab9b4;

  --primary:              #01696f;
  --primary-hover:        #0c4e54;
  --primary-active:       #0f3638;
  --primary-highlight:    rgba(1, 105, 111, 0.08);
}
```


### Elevation \& Depth

Use surface layers, not shadows, to create visual depth. The hierarchy is:

- `--background` → the page backdrop behind all panels
- `--surface` → main content panels, sidebar, properties panel
- `--surface-2` → elevated cards, dropdowns, popovers, tooltips
- `--surface-offset` → hover states, selected rows, active sidebar items
- `--border` → alpha-blended borders (never solid grey)


### Spacing

All spacing uses a strict 4px grid. Reference tokens `--space-1` (4px) through `--space-16` (64px). Never use arbitrary pixel values.

***

## Application Architecture

### Directory Structure

```
process-analysis-tool-flows-funds/
├── apps/
│   ├── web/                          # Next.js 15 App
│   │   ├── app/
│   │   │   ├── layout.tsx            # Root layout: providers, fonts, theme
│   │   │   ├── globals.css           # Design tokens, Tailwind @theme
│   │   │   ├── (auth)/
│   │   │   │   ├── login/page.tsx
│   │   │   │   └── register/page.tsx
│   │   │   ├── (platform)/
│   │   │   │   ├── layout.tsx        # Persistent sidebar + topbar shell
│   │   │   │   ├── dashboard/page.tsx
│   │   │   │   ├── processes/
│   │   │   │   │   ├── page.tsx      # Process library list
│   │   │   │   │   └── [id]/
│   │   │   │   │       ├── page.tsx  # Process detail + canvas wrapper
│   │   │   │   │       └── canvas/   # xyflow canvas (Client Component)
│   │   │   │   │           └── index.tsx
│   │   │   │   └── modules/
│   │   │   │       └── page.tsx      # Module registry / marketplace
│   │   │   └── api/
│   │   │       └── [...proxy]/route.ts  # Proxies to FastAPI
│   │   ├── components/
│   │   │   ├── ui/                   # shadcn/ui generated components
│   │   │   ├── canvas/               # xyflow canvas components
│   │   │   │   ├── ProcessCanvas.tsx
│   │   │   │   ├── nodes/
│   │   │   │   │   ├── TaskNode.tsx
│   │   │   │   │   ├── GatewayNode.tsx
│   │   │   │   │   ├── EventNode.tsx
│   │   │   │   │   └── SubprocessNode.tsx
│   │   │   │   └── edges/
│   │   │   │       └── SequenceEdge.tsx
│   │   │   ├── panels/
│   │   │   │   ├── PropertiesPanel.tsx
│   │   │   │   ├── AnalyticsOverlay.tsx
│   │   │   │   └── NodePalette.tsx
│   │   │   └── layout/
│   │   │       ├── Sidebar.tsx
│   │   │       └── Topbar.tsx
│   │   ├── lib/
│   │   │   ├── api-client.ts         # openapi-fetch typed client
│   │   │   ├── utils.ts              # cn(), formatters
│   │   │   └── schemas/              # Zod schemas mirroring FastAPI models
│   │   └── stores/
│   │       ├── process.store.ts      # Zustand: nodes, edges, selection
│   │       └── ui.store.ts           # Zustand: panels, active module
│   └── api/                          # FastAPI Backend
│       ├── main.py                   # App factory, router registration
│       ├── core/
│       │   ├── config.py             # Settings (pydantic-settings)
│       │   ├── database.py           # Async SQLAlchemy engine + session
│       │   └── dependencies.py      # Shared Depends() injections
│       ├── modules/                  # Module registry system
│       │   ├── registry.py           # ModuleRegistry singleton
│       │   ├── base.py               # AbstractModule base class
│       │   └── builtin/
│       │       ├── analytics/        # Built-in analytics module
│       │       ├── simulation/       # Built-in simulation module
│       │       └── importer/         # BPMN/CSV import module
│       ├── routers/
│       │   ├── processes.py
│       │   ├── modules.py
│       │   └── analytics.py
│       ├── models/
│       │   ├── process.py            # SQLAlchemy ORM models
│       │   └── module.py
│       ├── schemas/
│       │   ├── process.py            # Pydantic request/response schemas
│       │   └── graph.py              # NodeSchema, EdgeSchema, GraphSchema
│       ├── services/
│       │   ├── process_service.py
│       │   └── graph_service.py      # DAG validation, cycle detection
│       ├── migrations/               # Alembic migrations
│       └── pyproject.toml
├── packages/
│   └── types/                        # Shared TypeScript types (optional monorepo)
└── docker-compose.yml
```


***

## Module System — Core Design Principle

**New modules must be addable without touching existing code.** This is the non-negotiable architectural constraint. The platform is a shell; modules are the feature payload.

### Backend Module Contract

Every module inherits from `AbstractModule`:

```python
# apps/api/modules/base.py
from abc import ABC, abstractmethod
from fastapi import APIRouter
from pydantic import BaseModel

class AbstractModule(ABC):
    """
    Every module must implement this interface.
    The registry discovers and mounts modules at startup.
    """

    @property
    @abstractmethod
    def module_id(self) -> str:
        """Unique snake_case identifier: 'simulation', 'cycle_time_analysis'"""
        ...

    @property
    @abstractmethod
    def display_name(self) -> str:
        """Human-readable name shown in the UI module registry."""
        ...

    @property
    @abstractmethod
    def version(self) -> str:
        """Semantic version string: '1.0.0'"""
        ...

    @abstractmethod
    def get_router(self) -> APIRouter:
        """
        Returns the module's FastAPI router.
        The registry mounts it at /api/v1/modules/{module_id}/
        """
        ...

    @abstractmethod
    def get_config_schema(self) -> type[BaseModel]:
        """
        Returns the Pydantic model describing this module's configuration.
        The frontend uses this schema to auto-render the config form.
        """
        ...

    def on_startup(self) -> None:
        """Optional: called once when the FastAPI app starts."""
        pass

    def on_graph_update(self, graph: "GraphSchema") -> None:
        """Optional: called whenever a process graph is saved."""
        pass
```


### Backend Module Registry

```python
# apps/api/modules/registry.py
class ModuleRegistry:
    _modules: dict[str, AbstractModule] = {}

    def register(self, module: AbstractModule) -> None:
        self._modules[module.module_id] = module

    def mount_all(self, app: FastAPI) -> None:
        for module_id, module in self._modules.items():
            router = module.get_router()
            app.include_router(
                router,
                prefix=f"/api/v1/modules/{module_id}",
                tags=[module.display_name]
            )
            module.on_startup()

    def list_modules(self) -> list[ModuleManifest]:
        return [ModuleManifest.from_module(m) for m in self._modules.values()]
```


### Adding a New Module (Zero-Touch Process)

To add a new module, a developer:

1. Creates `apps/api/modules/builtin/my_module/` with `module.py` implementing `AbstractModule`.
2. Registers it in `main.py`: `registry.register(MyModule())`.
3. Creates `apps/web/components/modules/MyModule/` with a React panel component.
4. The frontend auto-discovers it via the `/api/v1/modules/` endpoint and renders it in the module panel.

**Nothing else changes.** No routing files modified, no store restructured, no design system altered.

### Frontend Module Contract

Each frontend module is a React component that receives a standardized props interface:

```typescript
// types/module.ts
export interface ModulePanelProps {
  processId: string;
  nodes: Node[];
  edges: Edge[];
  selectedNodeId: string | null;
  onNodeUpdate: (nodeId: string, data: Partial<NodeData>) => void;
}

export interface ModuleManifest {
  moduleId: string;
  displayName: string;
  version: string;
  panelComponent: React.ComponentType<ModulePanelProps>;
  configSchema: ZodSchema;
  icon: LucideIcon;
}
```

The module panel slot in the right sidebar renders whichever `panelComponent` corresponds to the active module ID stored in Zustand's `ui.store.ts`. Switching modules is a store update, not a route change.

***

## Canvas Architecture (xyflow)

### Zustand Store for Process State

```typescript
// stores/process.store.ts
import { create } from "zustand";
import { applyNodeChanges, applyEdgeChanges } from "@xyflow/react";

interface ProcessStore {
  nodes: Node<NodeData>[];
  edges: Edge[];
  selectedNodeId: string | null;
  isDirty: boolean;

  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  setSelectedNode: (id: string | null) => void;
  syncFromServer: (graph: GraphSchema) => void;
  serializeForServer: () => GraphSchema;
}

export const useProcessStore = create<ProcessStore>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  isDirty: false,

  onNodesChange: (changes) =>
    set((s) => ({ nodes: applyNodeChanges(changes, s.nodes), isDirty: true })),

  onEdgesChange: (changes) =>
    set((s) => ({ edges: applyEdgeChanges(changes, s.edges), isDirty: true })),

  onConnect: (connection) =>
    set((s) => ({ edges: addEdge(connection, s.edges), isDirty: true })),

  setSelectedNode: (id) => set({ selectedNodeId: id }),

  syncFromServer: (graph) => set({
    nodes: graph.nodes.map(deserializeNode),
    edges: graph.edges.map(deserializeEdge),
    isDirty: false,
  }),

  serializeForServer: () => ({
    nodes: get().nodes.map(serializeNode),
    edges: get().edges.map(serializeEdge),
  }),
}));
```


### Canvas Component Structure

```typescript
// components/canvas/ProcessCanvas.tsx
"use client";

import { ReactFlow, Background, Controls, MiniMap } from "@xyflow/react";
import { useProcessStore } from "@/stores/process.store";
import { TaskNode, GatewayNode, EventNode } from "./nodes";

const nodeTypes = {
  task:       TaskNode,
  gateway:    GatewayNode,
  event:      EventNode,
  subprocess: SubprocessNode,
  // New module node types are registered here
};

export function ProcessCanvas() {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect } =
    useProcessStore();

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      fitView
      className="bg-[--background]"
    >
      <Background color="var(--border)" gap={20} size={1} />
      <Controls className="bg-[--surface] border-[--border]" />
      <MiniMap
        nodeColor={(n) => nodeColorMap[n.type ?? "task"]}
        className="bg-[--surface] border-[--border] rounded-lg"
      />
    </ReactFlow>
  );
}
```


### Graph Validation (FastAPI)

When the frontend sends a serialized graph to be saved or executed, FastAPI validates its logical integrity:

```python
# services/graph_service.py
from collections import defaultdict, deque

def validate_dag(graph: GraphSchema) -> ValidationResult:
    """
    Validates that the process graph:
    1. Has at least one start event
    2. Has at least one end event
    3. Contains no cycles (is a valid DAG)
    4. Has no orphaned nodes (all nodes are connected)
    """
    adjacency = defaultdict(list)
    in_degree  = {node.id: 0 for node in graph.nodes}

    for edge in graph.edges:
        adjacency[edge.source].append(edge.target)
        in_degree[edge.target] += 1

    # Kahn's algorithm for cycle detection
    queue   = deque(nid for nid, deg in in_degree.items() if deg == 0)
    visited = 0

    while queue:
        node_id = queue.popleft()
        visited += 1
        for neighbour in adjacency[node_id]:
            in_degree[neighbour] -= 1
            if in_degree[neighbour] == 0:
                queue.append(neighbour)

    if visited != len(graph.nodes):
        raise GraphValidationError("Process graph contains a cycle.")

    start_events = [n for n in graph.nodes if n.type == "startEvent"]
    end_events   = [n for n in graph.nodes if n.type == "endEvent"]

    if not start_events:
        raise GraphValidationError("Graph must contain at least one start event.")
    if not end_events:
        raise GraphValidationError("Graph must contain at least one end event.")

    return ValidationResult(valid=True, node_count=len(graph.nodes))
```


***

## Core Views to Build

### 1. Platform Shell

The persistent shell wraps all platform views. It must be built first as all other views live inside it.

- **Left Sidebar (240px, collapsible to 56px):** Platform logo (top-left), navigation items with Lucide icons (Dashboard, Processes, Modules, Settings), bottom section with user avatar and theme toggle.
- **Top Bar:** Breadcrumb trail (Platform > Processes > [Process Name]), right-aligned action cluster (search, notifications bell, user menu).
- **Main Content Area:** Full-height, single scroll region. No nested scrollbars.


### 2. Dashboard (Home)

First view after login. Shows platform-level analytics at a glance.

- **KPI Row:** 4 cards — Total Processes, Active Instances, Avg Cycle Time, Critical Bottlenecks. Each shows a number, a trend sparkline, and a delta badge ("+12% vs last week").
- **Recent Processes:** Table with columns — Name, Last Modified, Instances, Status, Actions.
- **Module Activity Feed:** Timeline of recent module runs (simulation results, analysis completions).


### 3. Process Canvas (Core View)

The primary working surface. Three-panel layout:

```
┌─────────────────────────────────────────────────────────────────┐
│  TOPBAR: Process Name  │  Save  Run  Share  Module ▾    │
├──────────┬──────────────────────────────┬───────────────┤
│          │                              │               │
│  NODE    │   XYFLOW CANVAS              │  PROPERTIES   │
│  PALETTE │   (fills remaining space)    │  PANEL        │
│  (180px) │                              │  (320px)      │
│          │                              │               │
│          │                              │  [Active      │
│          │                              │   Module      │
│          │                              │   Content]    │
└──────────┴──────────────────────────────┴───────────────┘
```

- **Node Palette (left, 180px):** Draggable node types categorised by type — Events (Start, End, Intermediate), Tasks (User, Service, Script), Gateways (Exclusive, Parallel, Inclusive), Subprocesses. Drag onto canvas to create.
- **Canvas (centre):** xyflow `<ReactFlow />` with custom nodes, animated edges, and an analytics overlay layer (heatmap colouring nodes by throughput or bottleneck severity when the Analytics module is active).
- **Properties Panel (right, 320px):** Context-sensitive. Shows node properties when a node is selected (name, type, duration, assignee, cost). Shows edge properties when an edge is selected. Shows module-specific content when no element is selected (e.g., simulation controls, analysis results). The active module component renders here via the module slot.


### 4. Module Registry

A grid view of all registered modules — built-in and third-party.

- Each module card shows: icon, name, version, status (Active/Inactive), a one-line description, and a Configure button.
- A side drawer opens for per-module configuration. The form is auto-rendered from the module's Zod/Pydantic config schema.

***

## Built-in Modules

These three modules ship with the platform. They demonstrate the module pattern to developers adding new ones.

### Module 1: Process Analytics

**ID:** `process_analytics`
Analyses a saved process graph and produces KPIs per node and edge.

- **Frontend panel:** Renders a ranked list of bottleneck nodes with severity bars, a cycle time distribution histogram, and a resource utilisation heatmap. Triggers canvas overlay mode (nodes coloured by KPI value).
- **Backend:** `POST /api/v1/modules/process_analytics/analyse` — accepts a `GraphSchema`, runs statistical analysis across historical instance data from PostgreSQL, returns `AnalyticsResult` with per-node metrics.


### Module 2: Process Simulation

**ID:** `process_simulation`
Runs a configurable Monte Carlo simulation over the process graph.

- **Frontend panel:** Input fields for number of simulation runs, resource availability, and arrival rate distribution. A Run Simulation button triggers the mutation. Results show a time-series chart of simulated throughput and a confidence interval for end-to-end cycle time.
- **Backend:** `POST /api/v1/modules/process_simulation/run` — validates the graph is a DAG, executes `n` simulation iterations using each task's duration distribution, returns `SimulationResult` with percentile breakdowns.


### Module 3: BPMN Importer

**ID:** `bpmn_importer`
Imports an existing BPMN 2.0 XML file and converts it to the platform's graph schema.

- **Frontend panel:** File drop zone (accepts `.bpmn`, `.xml`). On upload, sends file to the backend and receives a `GraphSchema` which is loaded into the canvas via `useProcessStore().syncFromServer()`.
- **Backend:** `POST /api/v1/modules/bpmn_importer/import` — parses the BPMN XML using `python-bpmn-parser` or `lxml`, maps BPMN elements to platform node types, validates the resulting graph, and returns a `GraphSchema`.

***

## Data Flow — Full Request Lifecycle

```
User drags node → onNodesChange → Zustand store updated
                                          │
User clicks "Save"                        ▼
    │                           Canvas re-renders reactively
    ▼
useMutation (React Query)
    │
    ▼
POST /api/graph (Next.js API route)
    │
    ▼
FastAPI POST /api/v1/processes/{id}/graph
    │
    ├── Pydantic validates GraphSchema
    ├── graph_service.validate_dag()
    ├── SQLAlchemy saves to PostgreSQL (JSONB column)
    └── Returns SavedProcessResponse
              │
              ▼
React Query cache invalidated: ["processes", id]
              │
              ▼
Zustand store: isDirty = false
              │
              ▼
UI: Save button returns to idle state, toast "Saved"
```


***

## Startup Instructions for Claude Opus

Execute the following steps in strict order. Do not skip or reorder.

### Phase 1 — Project Scaffolding

1. Initialise the monorepo root with `pnpm` workspaces (or Turborepo if preferred). Create `apps/web` and `apps/api`.
2. Scaffold `apps/web` with `create-next-app@latest --typescript --tailwind --app --src-dir=false`. Select App Router. Do not select `import alias` — configure path aliases manually in `tsconfig.json` as `"@/*": ["./*"]`.
3. Initialise `apps/api` with `uv init`. Add dependencies: `fastapi`, `uvicorn[standard]`, `sqlalchemy[asyncio]`, `asyncpg`, `pydantic-settings`, `alembic`. Run `uv sync`.
4. Create `docker-compose.yml` at the monorepo root with services: `postgres` (image: `postgres:16-alpine`, port `5432`), `api` (builds `apps/api`, port `8000`), `web` (builds `apps/web`, port `3000`).

### Phase 2 — Design System

5. Install shadcn/ui: `npx shadcn@latest init` inside `apps/web`. Select style `Default`, base colour `Neutral`, CSS variables `yes`.
6. Replace the generated CSS variables in `globals.css` with the dark-first palette defined in this document.
7. Define the `--font-display` and `--font-body` variables pointing to the SF Pro Display stack.
8. Install core shadcn components: `button`, `card`, `dialog`, `dropdown-menu`, `input`, `label`, `separator`, `sheet`, `sidebar`, `skeleton`, `table`, `tabs`, `toast`, `tooltip`.
9. Install Tailwind v4 `@theme` extension for the custom tokens (`--primary`, `--surface`, `--border`, etc.) so they are available as Tailwind utilities (`bg-primary`, `text-muted`, `border-border`).

### Phase 3 — Platform Shell

10. Build the root layout (`app/layout.tsx`) with: font variables on `<html>`, `QueryClientProvider`, `ReactFlowProvider`, theme `data-theme` attribute, and the `Toaster` component.
11. Build the platform shell layout (`app/(platform)/layout.tsx`) with the collapsible sidebar and fixed topbar. Use the shadcn `Sidebar` component as the base.
12. Build `Sidebar.tsx` with navigation items, collapse toggle, and user section at the bottom.
13. Build `Topbar.tsx` with breadcrumb, search, notifications, and theme toggle.

### Phase 4 — FastAPI Foundation

14. Create `apps/api/main.py` with the FastAPI app factory, CORS proxy (allow `http://localhost:3000`), and router registration.
15. Create `core/database.py` with the async SQLAlchemy engine and `get_session` dependency.
16. Create `core/config.py` with `pydantic-settings` reading from `.env`.
17. Define `schemas/graph.py` with `NodeSchema`, `EdgeSchema`, `GraphSchema`, `NodeData` Pydantic models.
18. Create `modules/base.py` with `AbstractModule` and `modules/registry.py` with `ModuleRegistry`.
19. Create `routers/processes.py` with endpoints: `GET /processes`, `POST /processes`, `GET /processes/{id}`, `PUT /processes/{id}/graph`, `DELETE /processes/{id}`.
20. Run `alembic init migrations` and create the initial migration for `process_definitions` and `process_instances` tables.

### Phase 5 — xyflow Canvas

21. Install xyflow: `pnpm add @xyflow/react` in `apps/web`. Import the base stylesheet in `globals.css`: `@import "@xyflow/react/dist/style.css"`.
22. Create `stores/process.store.ts` with the full Zustand store as defined in this document.
```
23. Build `ProcessCanvas.tsx` as a Client Component with `<ReactFlow />`, `<Background />`, `<Controls />`, and `<MiniMap />` connected to the Zustand store.
```

24. Build `TaskNode.tsx` as the first custom node. It must display: node label (SF Pro Display, Regular, 13px), a status indicator dot (colour-coded: `--success` active, `--warning` idle, `--error` blocked), and a duration label below. Use shadcn's `Card` as the node container.
25. Build the `NodePalette.tsx` left panel with draggable node stubs for all four node categories.

### Phase 6 — Properties Panel + Module Slot

26. Build `PropertiesPanel.tsx` with three tab sections: Properties (node/edge form), Analysis (module output slot), and History (execution log).
27. Create `stores/ui.store.ts` with `activeModuleId`, `selectedNodeId`, `isPanelOpen`.
28. Implement the module slot: the Analysis tab renders `<ActiveModulePanel />` which reads `activeModuleId` from the UI store and dynamically renders the corresponding module panel component.

### Phase 7 — Built-in Modules

29. Build the **Process Analytics** module: backend service + router + frontend panel component.
30. Build the **Process Simulation** module: backend service + router + frontend panel component with simulation controls.
31. Build the **BPMN Importer** module: backend parser + router + frontend file drop zone.

### Phase 8 — Dashboard

32. Build the Dashboard page with the KPI row, Recent Processes table (using React Query to fetch from FastAPI), and Module Activity Feed.

### Phase 9 — Connectivity + Polish

33. Generate the TypeScript API client from FastAPI's OpenAPI schema using `openapi-fetch` or `openapi-typescript`.
34. Define all Zod schemas in `lib/schemas/` mirroring the Pydantic models.
35. Implement the save flow: `useMutation` → Next.js API route → FastAPI → PostgreSQL → cache invalidation → Zustand `isDirty = false`.
36. Add skeleton loaders to all data-fetching views.
37. Add empty states to the process library and module registry.
38. Verify dark mode and light mode on all views.
39. Verify keyboard navigation: Tab through all interactive elements, Escape to close panels, Enter to confirm.

***

## Quality Constraints

- **No hardcoded colours** anywhere in component files. All colours are CSS variables.
- **No `px` values in spacing** outside of `border-width` and `border-radius`. All spacing uses `--space-*` tokens.
- **No `any` TypeScript types**. All data structures must be typed via Zod inference or Pydantic-generated types.
- **Every `<img>` tag** must have `alt`, `width`, `height`, and `loading="lazy"`.
- **Every icon-only button** must have `aria-label`.
- **Every data-fetching component** must handle loading (skeleton), empty, and error states.
- **The canvas must never block the main thread.** All heavy graph computations (cycle detection, pathfinding, analytics aggregation) happen on the FastAPI backend, never in the browser.
- **The module boundary is sacred.** A module's frontend component may only read from Zustand stores via `ModulePanelProps`. It may not directly mutate the process graph — it must call `onNodeUpdate` from its props.

***

## Environment Variables

```bash
# apps/web/.env.local
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXTAUTH_SECRET=your-secret-here
NEXTAUTH_URL=http://localhost:3000

# apps/api/.env
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/process_analysis_tool_flows_funds
SECRET_KEY=your-secret-here
ALLOWED_ORIGINS=http://localhost:3000
ENVIRONMENT=development
```


***

## Definition of Done

The initialization is complete when:

- [ ] `docker-compose up` starts all three services (Postgres, FastAPI, Next.js) without errors.
- [ ] FastAPI `/docs` renders the full OpenAPI schema with all process and module endpoints.
- [ ] The platform shell renders in dark mode with working sidebar navigation and theme toggle.
- [ ] A process can be created, its graph edited on the xyflow canvas, and saved to PostgreSQL.
- [ ] All three built-in modules appear in the Module Registry and their panels render in the Properties Panel.
- [ ] The BPMN Importer successfully parses a sample `.bpmn` file and loads it into the canvas.
- [ ] A new dummy module can be added by creating one file in `apps/api/modules/builtin/` and one component in `apps/web/components/modules/` — with zero changes to any other file.

---
