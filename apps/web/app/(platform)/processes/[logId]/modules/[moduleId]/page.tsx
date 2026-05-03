"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, FileBox, RotateCcw, Settings2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/empty-state";
import { useEventLog, useModules } from "@/lib/queries";
import { getModulePanel } from "@/lib/module-panels";
import { DiscoverySettingsProvider } from "@/components/visualizations/discovery-settings-context";
import { SettingsSheet } from "@/components/visualizations/settings-sheet";
import { useVizSettings } from "@/lib/stores/visualization-settings";

export default function ModulePage() {
  const params = useParams<{ logId: string; moduleId: string }>();
  const { logId, moduleId } = params;

  const { data: log } = useEventLog(logId);
  const { data: modules, isLoading, isError } = useModules(logId);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const resetPositions = useVizSettings((s) => s.resetPositions);

  const mod = modules?.find((m) => m.id === moduleId);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-8 space-y-4">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (isError) {
    return (
      <EmptyState
        icon={FileBox}
        title="Couldn't load module"
        description="The module loader is offline or failed to start."
      />
    );
  }
  if (!mod) {
    return (
      <EmptyState
        icon={FileBox}
        title={`Module "${moduleId}" not found`}
        description="It may not be installed or may have failed to load."
        primaryAction={
          <Button asChild className="cursor-pointer">
            <Link href="/settings/modules/import">Install a module</Link>
          </Button>
        }
      />
    );
  }

  return (
    <DiscoverySettingsProvider logId={logId} moduleId={mod.id}>
      <section className="mx-auto max-w-7xl px-6 py-8">
        <header className="flex items-start justify-between gap-3 pb-6">
          <div className="space-y-1">
            <Button asChild variant="ghost" size="sm" className="cursor-pointer -ml-2 gap-1">
              <Link href={`/processes/${logId}`}>
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>{log?.name ?? "Back"}</span>
              </Link>
            </Button>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{mod.name}</h1>
              <Badge variant="outline" className="border-0 bg-muted text-[10px] uppercase">
                {mod.category.replace("_", " ")}
              </Badge>
              <span className="text-xs text-muted-foreground">{mod.version}</span>
            </div>
            {mod.description && (
              <p className="max-w-2xl text-sm text-muted-foreground">{mod.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="cursor-pointer gap-1.5"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 className="h-3.5 w-3.5" />
              Configure
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="cursor-pointer gap-1.5">
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset layout
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset layout?</AlertDialogTitle>
                  <AlertDialogDescription>
                    All dragged node positions for this module on this log will be discarded and
                    the auto-layout will be reapplied. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="cursor-pointer">Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="cursor-pointer"
                    onClick={() => resetPositions(logId, mod.id)}
                  >
                    Reset
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </header>

        <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} />

        <ModulePanelSlot logId={logId} moduleId={mod.id} />
      </section>
    </DiscoverySettingsProvider>
  );
}

function ModulePanelSlot({ logId, moduleId }: { logId: string; moduleId: string }) {
  const Panel = getModulePanel(moduleId);
  if (Panel) {
    return <Panel logId={logId} moduleId={moduleId} />;
  }
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/40 px-6 py-16 text-center">
      <p className="text-sm text-muted-foreground">
        This module has no frontend panel yet. The platform mounts its API at{" "}
        <code className="rounded bg-muted px-1 text-[11px]">/api/v1/modules/{moduleId}/…</code>.
      </p>
    </div>
  );
}
