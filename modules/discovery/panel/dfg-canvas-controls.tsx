"use client";

import { useState } from "react";
import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";

import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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
 */
export function DfgCanvasControls({ data }: { data: DfgData }) {
  const [dfg, setDfg] = useDfgSettings();
  const resetPositions = useResetPositions();
  const [resetOpen, setResetOpen] = useState(false);

  const filtered = computeDfgVisibility(data, dfg);
  const counts = {
    totalActivities: data.activities.length,
    shownActivities: filtered.visibleActivities.length,
    candidateEdges: filtered.candidateEdges.length,
    shownEdges: filtered.visibleEdges.length,
  };

  return (
    <>
      <PopoverPrimitive.Root>
        <PopoverPrimitive.Trigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 cursor-pointer"
            aria-label="Graph settings"
            title="Graph settings"
            data-tour="discovery-filters"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </Button>
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            side="left"
            align="start"
            sideOffset={10}
            className={cn(
              "z-50 w-80 rounded-lg border bg-popover p-4 text-popover-foreground shadow-md outline-none",
              "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
              "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
            )}
          >
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
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>

      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 cursor-pointer"
        aria-label="Reset layout"
        title="Reset layout"
        onClick={() => setResetOpen(true)}
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </Button>

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset layout?</AlertDialogTitle>
            <AlertDialogDescription>
              All dragged node positions for this module on this log will be
              discarded and the auto-layout will be reapplied. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                resetPositions();
                setResetOpen(false);
              }}
            >
              Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
