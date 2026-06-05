"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LayoutDashboard, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelative } from "@/lib/format";
import {
  useCreateDashboard,
  useDashboards,
  useDeleteDashboard,
  useImportDashboard,
  type DashboardItem,
} from "@/lib/dashboard-queries";

export function DashboardList() {
  const router = useRouter();
  const { data: dashboards, isLoading } = useDashboards();
  const create = useCreateDashboard();
  const del = useDeleteDashboard();
  const importDash = useImportDashboard();
  const fileRef = useRef<HTMLInputElement>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const onCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const dash = await create.mutateAsync({ name });
      setCreateOpen(false);
      setNewName("");
      router.push(`/dashboards/${dash.id}`);
    } catch {
      toast.error("Could not create dashboard");
    }
  };

  const onImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const doc = JSON.parse(text) as {
        name?: string;
        description?: string | null;
        items?: DashboardItem[];
      };
      const dash = await importDash.mutateAsync({
        name: doc.name,
        description: doc.description ?? null,
        items: Array.isArray(doc.items) ? doc.items : [],
      });
      toast.success("Dashboard imported");
      router.push(`/dashboards/${dash.id}`);
    } catch {
      toast.error("Invalid dashboard file");
    }
  };

  const onDelete = async () => {
    if (!deleteId) return;
    try {
      await del.mutateAsync(deleteId);
      toast.success("Dashboard deleted");
    } catch {
      toast.error("Could not delete dashboard");
    } finally {
      setDeleteId(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Dashboards</h1>
          <p className="text-sm text-muted-foreground">
            Compose cards from any module into a saved, reopenable board.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImportFile(f);
              e.target.value = "";
            }}
          />
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload className="mr-1.5 h-4 w-4" />
            Import
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            New dashboard
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : !dashboards || dashboards.length === 0 ? (
        <EmptyState
          icon={LayoutDashboard}
          title="No dashboards yet"
          description="Create a dashboard and drag in cards from your installed modules."
          primaryAction={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              New dashboard
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {dashboards.map((d) => (
            <Card key={d.id} className="group relative transition-colors hover:border-primary/40">
              <Link href={`/dashboards/${d.id}`} className="absolute inset-0" aria-label={d.name}>
                <span className="sr-only">{d.name}</span>
              </Link>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="truncate text-base">{d.name}</CardTitle>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${d.name}`}
                    className="relative z-10 h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                    onClick={(e) => {
                      e.preventDefault();
                      setDeleteId(d.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1">
                    <LayoutDashboard className="h-3.5 w-3.5" />
                    {d.card_count} card{d.card_count === 1 ? "" : "s"}
                  </span>
                  <span>Updated {formatRelative(d.updated_at)}</span>
                </div>
                {d.description && (
                  <p className="mt-2 line-clamp-2">{d.description}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New dashboard</DialogTitle>
            <DialogDescription>Give your dashboard a name to get started.</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Throughput overview"
            onKeyDown={(e) => {
              if (e.key === "Enter") void onCreate();
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={onCreate} disabled={!newName.trim() || create.isPending}>
              {create.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete dashboard?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the dashboard. The underlying event log and module
              data are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
