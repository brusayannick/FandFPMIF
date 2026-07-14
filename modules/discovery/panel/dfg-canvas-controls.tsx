"use client";

import { cn } from "@/lib/cn";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CanvasResetButton,
  CanvasSettingsPopover,
} from "@/components/visualizations/canvases/shared/canvas-toolbar";

import type { DfgData } from "./types";
import { computeDfgVisibility } from "./dfg-filter";
import { useDfgSettings, useResetPositions } from "./discovery-settings-context";

/**
 * DFG canvas controls, rendered inside the canvas's top-right control bar
 * (CanvasShell `toolbarSlot`) so they're available in fullscreen too:
 *
 *  - a config popover with the four kept settings (Activities / Connections
 *    sliders incl. Auto, Layout, Edge label),
 *  - a reset button (replaces the old header "Reset layout") that discards
 *    dragged node positions and re-applies the auto layout.
 *
 * The popover + reset button come from the shared, canvas-agnostic toolbar
 * (`canvas-toolbar.tsx`); only the DFG-specific slider/select body lives here.
 */
export function DfgCanvasControls({ data }: { data: DfgData }) {
  const [dfg, setDfg] = useDfgSettings();
  const resetPositions = useResetPositions();

  const filtered = computeDfgVisibility(data, dfg);
  const counts = {
    totalActivities: data.activities.length,
    shownActivities: filtered.visibleActivities.length,
    candidateEdges: filtered.candidateEdges.length,
    shownEdges: filtered.visibleEdges.length,
  };

  return (
    <>
      <CanvasSettingsPopover tourId="discovery-filters">
        <div className="space-y-4">
          <RankSlider
            label="Activities"
            fraction={filtered.resolvedActivitiesShown}
            shown={counts.shownActivities}
            total={counts.totalActivities}
            auto={filtered.autoActivities}
            onChange={(v) => setDfg({ activitiesShown: v })}
            onAuto={() => setDfg({ activitiesShown: "auto" })}
          />
          <RankSlider
            label="Connections"
            fraction={filtered.resolvedConnectionsShown}
            shown={counts.shownEdges}
            total={counts.candidateEdges}
            auto={filtered.autoConnections}
            onChange={(v) => setDfg({ connectionsShown: v })}
            onAuto={() => setDfg({ connectionsShown: "auto" })}
          />
          <div className="flex items-center justify-between gap-3">
            <Label className="text-xs font-normal text-muted-foreground">Layout</Label>
            <Select value="celonis-classic" onValueChange={() => undefined}>
              <SelectTrigger className="h-7 w-44 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="celonis-classic">Process flow (Celonis)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label className="text-xs font-normal text-muted-foreground">Edge label</Label>
            <Select
              value={dfg.edgeLabel}
              onValueChange={(v) => setDfg({ edgeLabel: v as typeof dfg.edgeLabel })}
            >
              <SelectTrigger className="h-7 w-44 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="count">Count</SelectItem>
                <SelectItem value="duration">Duration</SelectItem>
                <SelectItem value="off">Off</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CanvasSettingsPopover>

      <CanvasResetButton
        onReset={() => resetPositions()}
        description="All dragged node positions for this module on this log will be discarded and the auto-layout will be reapplied. This cannot be undone."
      />
    </>
  );
}

function RankSlider({
  label,
  fraction,
  shown,
  total,
  auto,
  onChange,
  onAuto,
}: {
  label: string;
  fraction: number;
  shown: number;
  total: number;
  auto: boolean;
  onChange: (v: number) => void;
  onAuto: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-normal text-muted-foreground">{label}</Label>
        <div className="flex items-center gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">
            {shown} / {total}
          </span>
          {/* Plain title (not a floating tooltip): the popover can open with
              the pointer already over this badge, and a tooltip firing on
              open looks broken. */}
          <button
            type="button"
            onClick={auto ? undefined : onAuto}
            aria-pressed={auto}
            title={
              auto
                ? `Auto: knee of the frequency curve (showing ${shown})`
                : "Reset to the computed threshold (knee of the frequency curve)"
            }
            className={cn(
              "h-5 shrink-0 rounded-md border px-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors",
              auto
                ? "cursor-default border-primary/40 bg-primary/15 text-primary"
                : "cursor-pointer border-border bg-transparent text-muted-foreground hover:border-primary/40 hover:text-foreground",
            )}
          >
            Auto
          </button>
        </div>
      </div>
      <Slider
        value={[fraction]}
        min={0}
        max={1}
        step={0.005}
        onValueChange={(v) => onChange(v[0] ?? 0)}
      />
    </div>
  );
}
