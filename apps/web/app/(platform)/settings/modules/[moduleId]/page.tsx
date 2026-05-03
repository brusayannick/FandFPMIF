"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, FileBox, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { useModules, useModuleConfig, useUninstallModule } from "@/lib/queries";

export default function ModuleDetailPage() {
  const router = useRouter();
  const { moduleId } = useParams<{ moduleId: string }>();
  const { data: modules, isLoading } = useModules(null);
  const { data: cfg } = useModuleConfig(moduleId);
  const uninstall = useUninstallModule();
  const m = modules?.find((x) => x.id === moduleId);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (!m) {
    return (
      <EmptyState
        icon={FileBox}
        title={`Module "${moduleId}" not found`}
        description="It may have been uninstalled or failed to load."
      />
    );
  }

  const onUninstall = async () => {
    try {
      await uninstall.mutateAsync(moduleId);
      toast.success(`Uninstalled ${m.name}`);
      router.push("/settings/modules");
    } catch (err: unknown) {
      toast.error(`Uninstall failed: ${(err as Error).message}`);
    }
  };

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm" className="cursor-pointer -ml-2 gap-1">
        <Link href="/settings/modules">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to modules
        </Link>
      </Button>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {m.name}
            <Badge variant="outline" className="border-0 bg-muted text-[10px] uppercase">
              {m.category.replace("_", " ")}
            </Badge>
            <span className="text-xs font-normal text-muted-foreground">{m.version}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {m.description && <p className="text-muted-foreground">{m.description}</p>}
          <Section label="Provides" items={m.provides.length ? m.provides : ["—"]} />
          <Section label="Consumes" items={m.consumes.length ? m.consumes : ["—"]} />
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Configuration
            </div>
            <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
              {JSON.stringify(cfg?.config ?? {}, null, 2)}
            </pre>
            <p className="mt-2 text-xs text-muted-foreground">
              Form-rendered config (Zod-validated against the module&apos;s
              schema) lands when modules start declaring config schemas.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-sm">Danger zone</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <p className="mb-3 text-muted-foreground">
            Removes the module folder, its venv, and any cached results. The
            platform&apos;s own dependencies are unaffected.
          </p>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                className="cursor-pointer gap-2 text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Uninstall
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Uninstall {m.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This deletes <code>modules/{m.id}/</code> from disk and unmounts its
                  routes / event handlers. Your data and other modules are
                  unaffected.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="cursor-pointer">Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={onUninstall}
                  className="cursor-pointer bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Uninstall
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}

function Section({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {items.map((s) => (
          <code key={s} className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
            {s}
          </code>
        ))}
      </div>
    </div>
  );
}
