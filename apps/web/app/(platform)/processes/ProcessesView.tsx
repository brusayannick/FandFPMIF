"use client";

import Link from "next/link";
import { useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, Plus, Workflow } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { api, ApiError } from "@/lib/api-client";
import { processSummarySchema } from "@/lib/schemas/graph";
import { relativeTime } from "@/lib/time";
import { z } from "zod";

const listSchema = z.array(processSummarySchema);

function useProcessList() {
  return useQuery({
    queryKey: ["processes", "list"],
    queryFn: async () => {
      const data = await api.get("/processes");
      return listSchema.parse(data);
    },
  });
}

export function ProcessesView() {
  const list = useProcessList();
  const qc = useQueryClient();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const createMutation = useMutation({
    mutationFn: async (payload: {
      name: string;
      description: string | null;
    }) => {
      const data = await api.post("/processes", payload);
      return processSummarySchema.parse(data);
    },
    onSuccess: (created) => {
      toast.success("Process created");
      qc.invalidateQueries({ queryKey: ["processes"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setOpen(false);
      setName("");
      setDescription("");
      router.push(`/processes/${created.id}`);
    },
    onError: (err) => {
      toast.error("Failed to create process", {
        description:
          err instanceof ApiError
            ? ((err.body as { detail?: string } | null)?.detail ??
              `HTTP ${err.status}`)
            : undefined,
      });
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    createMutation.mutate({
      name: trimmed,
      description: description.trim() || null,
    });
  }

  return (
    <>
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Processes</h1>
          <p className="mt-1 text-sm text-text-muted">
            Your process library. Create, edit, and analyse BPMN-style graphs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/processes/demo">
              Demo canvas <ArrowRight size={14} />
            </Link>
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus size={14} /> New process
              </Button>
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={submit} className="space-y-4">
                <DialogHeader>
                  <DialogTitle>Create process</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="new-name">Name</Label>
                    <Input
                      id="new-name"
                      required
                      autoFocus
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Order-to-cash"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-desc">Description</Label>
                    <Input
                      id="new-desc"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Optional"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={
                      createMutation.isPending || name.trim().length === 0
                    }
                  >
                    {createMutation.isPending ? "Creating…" : "Create"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      {list.isError && (
        <Card className="border-error/30 bg-error/10">
          <CardContent className="flex items-start gap-2 py-3 text-sm text-error">
            <AlertCircle size={16} className="mt-0.5" />
            <div>
              <div className="font-medium">Could not load processes</div>
              <div className="text-xs">
                Verify the API is running on http://localhost:8000.
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="bg-surface">
        <CardHeader>
          <CardTitle className="text-base">Process library</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {list.isLoading ? (
            <ul className="divide-y">
              {Array.from({ length: 5 }).map((_, i) => (
                <li key={i} className="flex items-center gap-3 px-4 py-3">
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-6 w-16" />
                </li>
              ))}
            </ul>
          ) : list.data && list.data.length > 0 ? (
            <table className="w-full text-sm">
              <thead className="border-b bg-surface-2">
                <tr className="text-left text-[10px] font-medium uppercase tracking-wider text-text-faint">
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Updated</th>
                  <th className="px-4 py-2 text-right">Nodes</th>
                  <th className="px-4 py-2 text-right">Edges</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b last:border-b-0 hover:bg-surface-offset"
                  >
                    <td className="px-4 py-2">
                      <Link
                        href={`/processes/${p.id}`}
                        className="font-medium hover:text-primary"
                      >
                        {p.name}
                      </Link>
                      {p.description && (
                        <div className="truncate text-[11px] text-text-muted">
                          {p.description}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-text-muted">
                      {relativeTime(p.updated_at)}
                    </td>
                    <td className="px-4 py-2 text-right text-xs tabular-nums text-text-muted">
                      {p.node_count}
                    </td>
                    <td className="px-4 py-2 text-right text-xs tabular-nums text-text-muted">
                      {p.edge_count}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/processes/${p.id}`}>Open</Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState
              onCreate={() => setOpen(true)}
              isError={list.isError}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}

function EmptyState({
  onCreate,
  isError,
}: {
  onCreate: () => void;
  isError: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-12 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-md border bg-surface-2 text-text-muted">
        <Workflow size={18} />
      </div>
      <div>
        <div className="text-sm">
          {isError ? "Could not load processes" : "No processes yet"}
        </div>
        <p className="mt-1 max-w-[320px] text-xs text-text-muted">
          Create a process to begin modelling, or open the demo canvas to try
          out the xyflow workspace.
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" asChild>
          <Link href="/processes/demo">Open demo</Link>
        </Button>
        <Button onClick={onCreate}>
          <Plus size={14} /> New process
        </Button>
      </div>
    </div>
  );
}
