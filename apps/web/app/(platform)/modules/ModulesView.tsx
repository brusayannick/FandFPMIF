"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  Blocks,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Settings2,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api-client";
import { getModule, listModules } from "@/components/modules/registry";
import { ModuleConfigDialog } from "@/components/modules/ModuleConfigDialog";
import { z } from "zod";

const backendModuleSchema = z.object({
  module_id: z.string(),
  display_name: z.string(),
  version: z.string(),
  description: z.string().nullable(),
  config_schema: z.record(z.string(), z.unknown()).nullable(),
});
type BackendModule = z.infer<typeof backendModuleSchema>;

const moduleListSchema = z.object({
  modules: z.array(backendModuleSchema),
});

function useBackendModules() {
  return useQuery({
    queryKey: ["modules", "list"],
    queryFn: async () => {
      const data = await api.get("/modules");
      return moduleListSchema.parse(data);
    },
  });
}

export function ModulesView() {
  const query = useBackendModules();
  const [configTarget, setConfigTarget] = useState<BackendModule | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  if (query.isLoading) {
    return (
      <div className="space-y-6">
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="bg-surface">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <Skeleton className="h-9 w-9 rounded-md" />
                  <Skeleton className="h-4 w-32" />
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-3/4" />
              </CardContent>
            </Card>
          ))}
        </section>
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div className="space-y-6">
        <Card className="border-error/30 bg-error/10">
          <CardContent className="flex items-start gap-2 py-3 text-sm text-error">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="font-medium">Could not reach backend registry</div>
              <div className="text-xs">Showing bundled frontend modules only.</div>
              <FrontendOnlyGrid />
            </div>
          </CardContent>
        </Card>
        <AddModuleGuide open={guideOpen} onToggle={() => setGuideOpen((v) => !v)} />
      </div>
    );
  }

  const modules = query.data.modules;

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-text-muted uppercase tracking-wider">
            Registered modules ({modules.length})
          </h2>
        </div>

        {modules.length === 0 ? (
          <Card className="bg-surface">
            <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-md border bg-surface-2 text-text-muted">
                <Blocks size={18} />
              </div>
              <div className="text-sm">No modules registered</div>
              <p className="max-w-[320px] text-xs text-text-muted">
                Follow the guide below to add your first module.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {modules.map((m) => (
              <ModuleCard
                key={m.module_id}
                module={m}
                onConfigure={() => setConfigTarget(m)}
              />
            ))}
          </div>
        )}
      </section>

      <AddModuleGuide open={guideOpen} onToggle={() => setGuideOpen((v) => !v)} />

      {configTarget && (
        <ModuleConfigDialog
          moduleId={configTarget.module_id}
          displayName={configTarget.display_name}
          configSchema={configTarget.config_schema as Parameters<typeof ModuleConfigDialog>[0]["configSchema"]}
          open={Boolean(configTarget)}
          onOpenChange={(open) => { if (!open) setConfigTarget(null); }}
        />
      )}
    </div>
  );
}

function ModuleCard({
  module: m,
  onConfigure,
}: {
  module: BackendModule;
  onConfigure: () => void;
}) {
  const frontend = getModule(m.module_id);
  const Icon = frontend?.icon ?? Blocks;
  const hasUI = Boolean(frontend);
  const hasConfig = Boolean(
    m.config_schema &&
      Object.keys((m.config_schema as { properties?: object }).properties ?? {}).length > 0,
  );

  return (
    <Card className="bg-surface transition-shadow hover:shadow-md">
      <CardHeader className="pb-2">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary-highlight text-primary">
            <Icon size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate text-base">{m.display_name}</CardTitle>
            <div className="mt-0.5 text-[11px] text-text-muted tabular-nums">
              v{m.version} · {m.module_id}
            </div>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] text-success">
            <CheckCircle2 size={10} /> Active
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 pt-0">
        <p className="text-sm text-text-muted">{m.description ?? "—"}</p>

        <div className="flex flex-wrap gap-1.5">
          {hasUI ? (
            <span className="rounded-full border border-primary/30 bg-primary-highlight px-2 py-0.5 text-[10px] text-primary">
              Panel
            </span>
          ) : (
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-text-faint">
              No panel
            </span>
          )}
          {hasConfig && (
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-text-faint">
              Configurable
            </span>
          )}
        </div>

        <div className="flex items-center justify-end border-t border-border pt-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={onConfigure}
          >
            <Settings2 size={13} /> Configure
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AddModuleGuide({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <Card className="bg-surface">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center gap-3 px-6 py-4 text-left"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-surface-2 text-text-muted">
          <Code2 size={16} />
        </div>
        <div className="flex-1">
          <div className="text-sm font-medium">Add a new module</div>
          <div className="text-xs text-text-muted">
            Step-by-step guide to registering a custom analytical module
          </div>
        </div>
        {open ? (
          <ChevronDown size={16} className="text-text-muted" />
        ) : (
          <ChevronRight size={16} className="text-text-muted" />
        )}
      </button>

      {open && (
        <CardContent className="border-t border-border pt-4 space-y-4">
          <Step
            n={1}
            title="Create the module class"
            description="Add a new folder under apps/api/modules/builtin/ and create module.py:"
            code={`# apps/api/modules/builtin/my_module/module.py
from fastapi import APIRouter
from pydantic import BaseModel, Field
from modules.base import AbstractModule

class MyConfig(BaseModel):
    threshold: int = Field(default=100, ge=0, description="Alert threshold")

class MyModule(AbstractModule):
    module_id   = "my_module"
    display_name = "My Module"
    version     = "1.0.0"
    description = "What this module does."

    def get_router(self) -> APIRouter:
        router = APIRouter()

        @router.post("/run")
        async def run():
            return {"status": "ok"}

        return router

    def get_config_schema(self):
        return MyConfig`}
          />

          <Step
            n={2}
            title="Register it in main.py"
            description="Import your module class and add one line to _register_builtin_modules():"
            code={`# apps/api/main.py
from modules.builtin.my_module.module import MyModule

def _register_builtin_modules() -> None:
    ...
    if registry.get("my_module") is None:
        registry.register(MyModule())`}
          />

          <Step
            n={3}
            title="Add a frontend panel (optional)"
            description="Create a React component and register it in the frontend registry:"
            code={`// apps/web/components/modules/my_module/Panel.tsx
"use client";
export function MyModulePanel({ processId, nodes }) {
  return <div>My module UI</div>;
}

// apps/web/components/modules/registry.ts
import { MyModulePanel } from "./my_module/Panel";
// add to manifests array:
{
  moduleId: "my_module",
  displayName: "My Module",
  version: "1.0.0",
  icon: Wrench,
  panelComponent: MyModulePanel,
}`}
          />

          <Step
            n={4}
            title="Restart the API"
            description="The module auto-registers on startup — no database migrations needed:"
            code={`cd apps/api && uv run uvicorn main:app --reload`}
          />
        </CardContent>
      )}
    </Card>
  );
}

function Step({
  n,
  title,
  description,
  code,
}: {
  n: number;
  title: string;
  description: string;
  code: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
          {n}
        </span>
        <div className="text-sm font-medium">{title}</div>
      </div>
      <p className="text-xs text-text-muted pl-7">{description}</p>
      <pre className="ml-7 overflow-x-auto rounded-md border bg-surface-2 p-3 text-[11px] leading-relaxed text-text">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function FrontendOnlyGrid() {
  const modules = listModules();
  return (
    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
      {modules.map((m) => {
        const Icon = m.icon;
        return (
          <div
            key={m.moduleId}
            className="flex items-center gap-2 rounded-md border bg-surface-2 px-2 py-1.5 text-xs text-text-muted"
          >
            <Icon size={14} /> {m.displayName}
          </div>
        );
      })}
    </div>
  );
}
