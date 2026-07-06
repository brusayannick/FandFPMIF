"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Workflow } from "lucide-react";

import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { CardGridSkeleton } from "@/components/skeletons";
import { useCreateFlow, useDeleteFlow, useFlows } from "@/lib/flow-queries";
import { stagger } from "@/lib/stagger";

/** Index of the node-graph builder - parallel to the dashboards list. */
export function FlowList() {
  const router = useRouter();
  const { data: flows, isLoading } = useFlows();
  const create = useCreateFlow();
  const del = useDeleteFlow();

  const onCreate = () =>
    create.mutate(
      { name: "Untitled flow", log_model: "case_centric" },
      { onSuccess: (f) => router.push(`/flows/${f.id}`) },
    );

  return (
    <div className="space-y-5 p-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Builder</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Wire event log → module → transform → visualization on a canvas, and build your own
            widgets.
          </p>
        </div>
        <Button onClick={onCreate} disabled={create.isPending} className="gap-1.5">
          <Plus className="h-4 w-4" />
          New flow
        </Button>
      </header>

      {isLoading ? (
        <CardGridSkeleton count={6} />
      ) : !flows?.length ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <Workflow className="mx-auto h-8 w-8 text-muted-foreground/60" />
          <p className="mt-3 text-sm font-medium">No flows yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Create a flow to start wiring data into your own visualizations.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {flows.map((f, i) => (
            <div
              key={f.id}
              className="animate-in fade-in-0 slide-in-from-bottom-1 fill-mode-both duration-300"
              style={stagger(i)}
            >
            <div
              className={cn(
                "group relative h-full rounded-lg border border-white/10 [border-top-color:var(--glass-refraction-top)] bg-card/70 p-4 backdrop-blur-md transition-all supports-[backdrop-filter]:bg-card/60 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md",
              )}
            >
              <Link href={`/flows/${f.id}`} className="block">
                <div className="flex items-center gap-2">
                  <Workflow className="h-4 w-4 text-muted-foreground" />
                  <span className="truncate text-sm font-medium">{f.name}</span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {f.node_count} node{f.node_count === 1 ? "" : "s"}
                </p>
              </Link>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Delete ${f.name}`}
                className="absolute right-2 top-2 h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                onClick={() => del.mutate(f.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
