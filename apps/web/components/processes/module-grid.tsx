"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Plus, Settings2, FileBox } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { ModuleCard } from "@/components/processes/module-card";
import { useModules } from "@/lib/queries";
import { useUi } from "@/lib/stores/ui";
import type { ModuleSummary } from "@/lib/api-types";

const CATEGORIES: { id: string; label: string }[] = [
  { id: "foundation", label: "Foundation" },
  { id: "attribute", label: "Attribute" },
  { id: "external_input", label: "External input" },
  { id: "advanced", label: "Advanced process analytics" },
  { id: "other", label: "Other" },
];

export function ModuleGrid({ logId }: { logId: string }) {
  const { data: modules, isLoading, isError } = useModules(logId);
  const showUnavailable = useUi((s) => s.showUnavailableModules);
  const setShowUnavailable = useUi((s) => s.setShowUnavailableModules);

  const grouped = useMemo(() => {
    const out = new Map<string, ModuleSummary[]>();
    for (const c of CATEGORIES) out.set(c.id, []);
    for (const m of modules ?? []) {
      if (!showUnavailable && m.availability?.status === "unavailable") continue;
      const bucket = out.get(m.category) ?? out.get("other")!;
      bucket.push(m);
    }
    return out;
  }, [modules, showUnavailable]);

  if (isLoading) {
    return (
      <div className="space-y-8">
        {CATEGORIES.slice(0, 2).map((c) => (
          <section key={c.id} className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {c.label}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-32" />
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        icon={FileBox}
        title="Couldn't load modules"
        description="The module loader is offline or failed to start. Check the API logs."
      />
    );
  }

  if (!modules || modules.length === 0) {
    return (
      <EmptyState
        icon={FileBox}
        title="No modules installed"
        description="v1 ships with no modules. Install one to enable analytics on this process."
        primaryAction={
          <Button asChild className="cursor-pointer gap-2">
            <Link href="/settings/modules/import">
              <Plus className="h-4 w-4" />
              Import module
            </Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
        <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
        <Label htmlFor="toggle-unavailable">
          <Switch
            id="toggle-unavailable"
            checked={showUnavailable}
            onCheckedChange={setShowUnavailable}
            className="cursor-pointer"
          />
          <span className="ml-2 text-xs text-muted-foreground">Show unavailable</span>
        </Label>
      </div>

      {CATEGORIES.map((c) => {
        const bucket = grouped.get(c.id)!;
        if (bucket.length === 0) return null;
        return (
          <section key={c.id} className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {c.label}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {bucket.map((m) => (
                <ModuleCard key={m.id} module={m} logId={logId} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Label({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="inline-flex cursor-pointer items-center">
      {children}
    </label>
  );
}
