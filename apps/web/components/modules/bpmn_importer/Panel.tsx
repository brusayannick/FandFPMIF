"use client";

import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, FileInput, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api-client";
import { graphSchema } from "@/lib/schemas/graph";
import { useProcessStore } from "@/stores/process.store";
import type { ModulePanelProps } from "@/components/modules/types";
import { z } from "zod";

const importResultSchema = z.object({
  graph: graphSchema,
  imported_node_count: z.number().int(),
  imported_edge_count: z.number().int(),
  skipped_elements: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
});

type ImportResult = z.infer<typeof importResultSchema>;

async function uploadBpmn(file: File): Promise<ImportResult> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/v1/modules/bpmn_importer/import", {
    method: "POST",
    body: fd,
  });
  const ct = res.headers.get("content-type") ?? "";
  const payload = ct.includes("application/json") ? await res.json() : null;
  if (!res.ok) {
    throw new ApiError(res.status, payload);
  }
  return importResultSchema.parse(payload);
}

export function BpmnImporterPanel(_props: ModulePanelProps) {
  void _props;
  const syncFromServer = useProcessStore((s) => s.syncFromServer);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const mutation = useMutation({
    mutationFn: uploadBpmn,
    onSuccess: (data) => {
      setResult(data);
      syncFromServer(data.graph);
      toast.success(
        `Imported ${data.imported_node_count} node${
          data.imported_node_count === 1 ? "" : "s"
        }`,
        {
          description:
            data.skipped_elements.length > 0
              ? `${data.skipped_elements.length} element(s) skipped`
              : undefined,
        },
      );
    },
    onError: (err) => {
      const msg =
        err instanceof ApiError
          ? ((err.body as { detail?: string } | null)?.detail ??
            `HTTP ${err.status}`)
          : "Import failed";
      toast.error("BPMN import failed", { description: msg });
    },
  });

  function onFile(file: File | undefined) {
    if (!file) return;
    if (
      !file.name.toLowerCase().endsWith(".bpmn") &&
      !file.name.toLowerCase().endsWith(".xml")
    ) {
      toast.error("Only .bpmn or .xml files are supported");
      return;
    }
    mutation.mutate(file);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <FileInput size={14} className="text-primary" />
        <span className="text-xs font-medium uppercase tracking-wider text-text-muted">
          BPMN Importer
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            onFile(e.dataTransfer.files?.[0]);
          }}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed bg-surface-2 p-6 text-center transition-colors",
            dragging
              ? "border-primary bg-primary-highlight"
              : "border-border hover:border-primary/50",
            mutation.isPending && "pointer-events-none opacity-60",
          )}
        >
          {mutation.isPending ? (
            <Loader2 size={20} className="animate-spin text-primary" />
          ) : (
            <Upload size={20} className="text-text-muted" />
          )}
          <div className="text-sm">
            {mutation.isPending
              ? "Parsing BPMN…"
              : "Drop a .bpmn file or click to browse"}
          </div>
          <p className="max-w-[220px] text-[11px] text-text-muted">
            BPMN 2.0 XML. Element positions from <code>BPMNDiagram</code> are
            preserved when present.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".bpmn,.xml,application/xml"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              onFile(file);
              e.target.value = "";
            }}
          />
          {!mutation.isPending && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
            >
              Browse files
            </Button>
          )}
        </div>

        {mutation.isError && (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-error/30 bg-error/10 p-3 text-xs text-error">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <div>
              {mutation.error instanceof ApiError
                ? ((mutation.error.body as { detail?: string } | null)
                    ?.detail ?? mutation.error.message)
                : "Import failed."}
            </div>
          </div>
        )}

        {result && (
          <div className="mt-4 space-y-3">
            <section className="grid grid-cols-2 gap-2">
              <Stat
                label="Nodes imported"
                value={result.imported_node_count.toString()}
              />
              <Stat
                label="Edges imported"
                value={result.imported_edge_count.toString()}
              />
            </section>
            {result.skipped_elements.length > 0 && (
              <section>
                <h4 className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-text-faint">
                  Skipped ({result.skipped_elements.length})
                </h4>
                <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border bg-surface-2 p-2 text-[11px] text-text-muted">
                  {result.skipped_elements.map((s, i) => (
                    <li key={i} className="truncate">
                      {s}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {result.warnings.length > 0 && (
              <section className="rounded-md border border-warning/30 bg-warning/10 p-2 text-[11px] text-warning">
                {result.warnings.map((w, i) => (
                  <div key={i}>{w}</div>
                ))}
              </section>
            )}
            <p className="text-[11px] text-text-muted">
              The imported graph has replaced the canvas contents. Save to
              persist.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-surface-2 p-2">
      <div className="text-[10px] uppercase tracking-wider text-text-faint">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-medium tabular-nums">{value}</div>
    </div>
  );
}
