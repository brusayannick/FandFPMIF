"use client";

import { Button } from "@/components/ui/button";
import { Play, Save, Share2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useProcessStore } from "@/stores/process.store";
import { ModuleSwitcher } from "./ModuleSwitcher";

interface CanvasHeaderProps {
  processName: string;
  isSaving: boolean;
  onSave: () => void;
  onRun?: () => void;
  onShare?: () => void;
}

export function CanvasHeader({
  processName,
  isSaving,
  onSave,
  onRun,
  onShare,
}: CanvasHeaderProps) {
  const isDirty = useProcessStore((s) => s.isDirty);
  const nodeCount = useProcessStore((s) => s.nodes.length);

  return (
    <div className="flex h-12 shrink-0 items-center justify-between border-b bg-surface px-4">
      <div className="flex min-w-0 items-center gap-3">
        <h2 className="truncate text-sm font-medium">{processName}</h2>
        <span
          className={cn(
            "inline-flex h-5 items-center rounded-full border px-2 text-[10px] uppercase tracking-wider",
            isDirty
              ? "border-warning/40 bg-warning/10 text-warning"
              : "border-border text-text-muted",
          )}
        >
          {isDirty ? "Unsaved" : "Saved"}
        </span>
        <span className="text-[11px] text-text-faint tabular-nums">
          {nodeCount} node{nodeCount === 1 ? "" : "s"}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <ModuleSwitcher />
        <Button
          variant="ghost"
          size="sm"
          onClick={onShare}
          disabled={!onShare}
        >
          <Share2 size={14} /> Share
        </Button>
        <Button variant="outline" size="sm" onClick={onRun} disabled={!onRun}>
          <Play size={14} /> Run
        </Button>
        <Button size="sm" onClick={onSave} disabled={isSaving}>
          <Save size={14} /> {isSaving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
