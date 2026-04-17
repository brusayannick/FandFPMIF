"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { NodePalette } from "@/components/panels/NodePalette";
import { PropertiesPanel } from "@/components/panels/PropertiesPanel";
import { ProcessCanvas } from "./ProcessCanvas";
import { CanvasHeader } from "./CanvasHeader";
import { useProcessStore } from "@/stores/process.store";
import { api, ApiError } from "@/lib/api-client";
import {
  processDetailSchema,
  processSaveResponseSchema,
  type Graph,
} from "@/lib/schemas/graph";

interface CanvasWorkspaceProps {
  processId: string;
  fallbackName?: string;
}

export function CanvasWorkspace({
  processId,
  fallbackName,
}: CanvasWorkspaceProps) {
  const queryClient = useQueryClient();
  const syncFromServer = useProcessStore((s) => s.syncFromServer);
  const serializeForServer = useProcessStore((s) => s.serializeForServer);
  const setProcessId = useProcessStore((s) => s.setProcessId);
  const reset = useProcessStore((s) => s.reset);

  const [processName, setProcessName] = useState(
    fallbackName ?? "Untitled process",
  );
  const [isLoading, setIsLoading] = useState(processId !== "demo");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setProcessId(processId);

    if (processId === "demo") {
      reset();
      syncFromServer(seedGraph());
      setIsLoading(false);
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      try {
        const data = await api.get(`/processes/${processId}`);
        if (cancelled) return;
        const parsed = processDetailSchema.parse(data);
        setProcessName(parsed.name);
        syncFromServer(parsed.graph);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          toast.error("Process not found");
        } else if (err instanceof ApiError && err.status === 502) {
          toast.error(
            "Backend unavailable. Start the API: `uv run uvicorn main:app --reload`.",
          );
        } else {
          toast.error("Failed to load process");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [processId, reset, setProcessId, syncFromServer]);

  async function handleSave() {
    if (processId === "demo") {
      toast.info("Demo canvas — create a process to persist.");
      return;
    }
    setIsSaving(true);
    try {
      const graph = serializeForServer();
      const data = await api.put(`/processes/${processId}/graph`, { graph });
      const parsed = processSaveResponseSchema.parse(data);
      useProcessStore.getState().markClean();
      queryClient.invalidateQueries({ queryKey: ["processes"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      if (parsed.validation_warnings.length > 0) {
        toast.warning("Saved with warnings", {
          description: parsed.validation_warnings.join(" • "),
        });
      } else {
        toast.success("Process saved");
      }
    } catch (err) {
      if (err instanceof ApiError) {
        const body = err.body as { detail?: string } | null;
        toast.error("Save failed", {
          description: body?.detail ?? `HTTP ${err.status}`,
        });
      } else {
        toast.error("Save failed");
      }
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <CanvasHeader
        processName={isLoading ? "Loading…" : processName}
        isSaving={isSaving}
        onSave={handleSave}
      />
      <div className="flex min-h-0 flex-1">
        <NodePalette />
        <div className="relative min-w-0 flex-1">
          <ProcessCanvas />
        </div>
        <PropertiesPanel processId={processId} />
      </div>
    </div>
  );
}

function seedGraph(): Graph {
  return {
    nodes: [
      {
        id: "n_start",
        type: "startEvent",
        position: { x: 80, y: 180 },
        data: { label: "Start", status: "idle" },
      },
      {
        id: "n_review",
        type: "userTask",
        position: { x: 260, y: 160 },
        data: {
          label: "Review request",
          status: "idle",
          duration_ms: 900_000,
          assignee: "Ops",
        },
      },
      {
        id: "n_gateway",
        type: "exclusiveGateway",
        position: { x: 500, y: 170 },
        data: { label: "Approved?", status: "idle" },
      },
      {
        id: "n_approve",
        type: "serviceTask",
        position: { x: 700, y: 80 },
        data: {
          label: "Process payment",
          status: "idle",
          duration_ms: 5_000,
        },
      },
      {
        id: "n_reject",
        type: "serviceTask",
        position: { x: 700, y: 260 },
        data: { label: "Send rejection", status: "idle", duration_ms: 2_000 },
      },
      {
        id: "n_end_ok",
        type: "endEvent",
        position: { x: 920, y: 100 },
        data: { label: "Done", status: "idle" },
      },
      {
        id: "n_end_rej",
        type: "endEvent",
        position: { x: 920, y: 280 },
        data: { label: "Rejected", status: "idle" },
      },
    ],
    edges: [
      { id: "e1", source: "n_start", target: "n_review", animated: false },
      { id: "e2", source: "n_review", target: "n_gateway", animated: false },
      {
        id: "e3",
        source: "n_gateway",
        target: "n_approve",
        label: "yes",
        animated: false,
      },
      {
        id: "e4",
        source: "n_gateway",
        target: "n_reject",
        label: "no",
        animated: false,
      },
      { id: "e5", source: "n_approve", target: "n_end_ok", animated: false },
      { id: "e6", source: "n_reject", target: "n_end_rej", animated: false },
    ],
  };
}
