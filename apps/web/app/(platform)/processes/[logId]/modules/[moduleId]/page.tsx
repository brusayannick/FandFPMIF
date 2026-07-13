"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FileBox } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { PageContainer } from "@/components/page";
import { useModules } from "@/lib/queries";
import { getModulePanel } from "@/lib/module-panels";

export default function ModulePage() {
  const params = useParams<{ logId: string; moduleId: string }>();
  const { logId, moduleId } = params;

  const { data: modules, isLoading, isError } = useModules(logId);

  const mod = modules?.find((m) => m.id === moduleId);

  if (isLoading) {
    return (
      <PageContainer className="space-y-4">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="h-96 w-full" />
      </PageContainer>
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
            <Link href="/modules/import">Install a module</Link>
          </Button>
        }
      />
    );
  }

  return (
    <PageContainer>
      {/* Deep links can reach a module the grid renders grayed-out (disabled,
          or the log doesn't meet its manifest requirements). Mounting the
          panel would just fail on its first query – explain instead. */}
      {mod.enabled === false ? (
        <div className="rounded-xl border border-dashed border-border bg-card/40 px-6 py-16 text-center">
          <p className="text-sm font-medium">This module is disabled</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Enable it under{" "}
            <Link href={`/modules/${mod.id}`} className="underline underline-offset-2">
              Settings → Modules
            </Link>{" "}
            to open it.
          </p>
        </div>
      ) : (mod.availability?.status ?? "available") === "unavailable" ? (
        <div className="rounded-xl border border-dashed border-border bg-card/40 px-6 py-16 text-center">
          <p className="text-sm font-medium">Not available for this process</p>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {(mod.availability?.reasons ?? ["This process doesn't meet the module's requirements."]).map(
              (r, i) => (
                <li key={i}>{r}</li>
              ),
            )}
          </ul>
        </div>
      ) : (
        <ModulePanelSlot logId={logId} moduleId={mod.id} hasFrontend={mod.has_frontend} />
      )}
    </PageContainer>
  );
}

function ModulePanelSlot({
  logId,
  moduleId,
  hasFrontend,
}: {
  logId: string;
  moduleId: string;
  hasFrontend: boolean;
}) {
  const Panel = getModulePanel(moduleId, { hasFrontend });
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
