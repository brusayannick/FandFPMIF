"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/empty-state";
import {
  DfgCanvas,
  HeuristicsNetCanvas,
  PetriNetCanvas,
  ProcessTreeCanvas,
} from "@/components/visualizations";
import { DfgDetailsPanel } from "@/components/visualizations/dfg-details-panel";
import { computeDfgVisibility } from "@/components/visualizations/dfg-filter";
import {
  useDfgSettings,
  useHeuristicsRenderSettings,
  useModuleConfig,
  usePetriSettings,
  useProcessTreeSettings,
  useUpdateModuleConfig,
} from "@/components/visualizations/discovery-settings-context";

import {
  useDiscoveryDfg,
  useDiscoveryHeuristicsNet,
  useDiscoveryPetriAlpha,
  useDiscoveryPetriInductive,
  useDiscoveryProcessTree,
  type HeuristicsThresholds,
} from "./queries";

type View = "dfg" | "alpha" | "inductive" | "tree" | "heuristics";
const VIEWS: { value: View; label: string }[] = [
  { value: "dfg", label: "DFG" },
  { value: "alpha", label: "Petri (Alpha)" },
  { value: "inductive", label: "Petri (Inductive)" },
  { value: "tree", label: "Process Tree" },
  { value: "heuristics", label: "Heuristics-Net" },
];

const HEURISTICS_KEYS = [
  "heuristics_dependency_threshold",
  "heuristics_and_threshold",
  "heuristics_loop_two_threshold",
] as const;
type HeuristicsKey = (typeof HEURISTICS_KEYS)[number];

const HEURISTICS_DEFAULTS: Record<HeuristicsKey, number> = {
  heuristics_dependency_threshold: 0.5,
  heuristics_and_threshold: 0.65,
  heuristics_loop_two_threshold: 0.5,
};

export function DiscoveryPanel({ logId }: { logId: string; moduleId: string }) {
  const [view, setView] = useState<View>("dfg");

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Discovery visualisations"
        className="inline-flex w-full max-w-3xl items-center gap-1 rounded-lg bg-muted p-[3px]"
      >
        {VIEWS.map((v) => {
          const isActive = view === v.value;
          return (
            <button
              key={v.value}
              type="button"
              role="tab"
              aria-selected={isActive}
              data-state={isActive ? "active" : "inactive"}
              onClick={() => setView(v.value)}
              className={cn(
                "flex-1 cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium transition-all",
                isActive
                  ? "bg-background text-foreground shadow-sm"
                  : "text-foreground/60 hover:text-foreground",
              )}
            >
              {v.label}
            </button>
          );
        })}
      </div>

      <div className="mt-2 space-y-3">
        {view === "dfg" && <DfgTab logId={logId} />}
        {view === "alpha" && <PetriAlphaTab logId={logId} />}
        {view === "inductive" && <PetriInductiveTab logId={logId} />}
        {view === "tree" && <ProcessTreeTab logId={logId} />}
        {view === "heuristics" && <HeuristicsTab logId={logId} />}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Frame helpers
// --------------------------------------------------------------------------

function CanvasFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative h-[640px] w-full overflow-hidden rounded-xl border bg-card">
      {children}
    </div>
  );
}

function CanvasSkeleton() {
  return (
    <div className="h-[640px] w-full overflow-hidden rounded-xl border bg-card p-4">
      <Skeleton className="h-full w-full" />
    </div>
  );
}

function CanvasError({ message }: { message: string }) {
  return (
    <CanvasFrame>
      <EmptyState
        icon={AlertTriangle}
        title="Could not compute discovery"
        description={message}
      />
    </CanvasFrame>
  );
}

function FilterBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs">
      {children}
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <Label className="text-xs text-muted-foreground font-normal">{label}</Label>
      {children}
    </div>
  );
}

// --------------------------------------------------------------------------
// Tabs
// --------------------------------------------------------------------------

function DfgTab({ logId }: { logId: string }) {
  const [dfg, setDfg] = useDfgSettings();
  const { data, isLoading, isError, error } = useDiscoveryDfg(logId);

  const [selected, setSelected] = useState<{ kind: "node" | "edge"; id: string } | null>(null);

  // Live counts: ask the same helper the canvas uses, so the slider labels
  // and the rendered graph never disagree (e.g. spanning-floor edges still
  // show up in the count even when the user drags connections to 0).
  const counts = (() => {
    if (!data) {
      return {
        totalActivities: 0,
        shownActivities: 0,
        candidateEdges: 0,
        shownEdges: 0,
      };
    }
    const filtered = computeDfgVisibility(data, dfg);
    return {
      totalActivities: data.activities.length,
      shownActivities: filtered.visibleActivities.length,
      candidateEdges: filtered.candidateEdges.length,
      shownEdges: filtered.visibleEdges.length,
    };
  })();

  return (
    <>
      <div className="space-y-3 rounded-lg border bg-muted/40 px-4 py-3 text-xs">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-3">
          <RankSlider
            label="Activities"
            fraction={dfg.activitiesShown}
            shown={counts.shownActivities}
            total={counts.totalActivities}
            onChange={(v) => setDfg({ activitiesShown: v })}
          />
          <RankSlider
            label="Connections"
            fraction={dfg.connectionsShown}
            shown={counts.shownEdges}
            total={counts.candidateEdges}
            onChange={(v) => setDfg({ connectionsShown: v })}
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-2">
          <FilterField label="Hide self-loops">
            <Switch
              checked={dfg.hideSelfLoops}
              onCheckedChange={(v) => setDfg({ hideSelfLoops: v })}
            />
          </FilterField>
          <FilterField label="Edge label">
            <Select value={dfg.edgeLabel} onValueChange={(v) => setDfg({ edgeLabel: v as typeof dfg.edgeLabel })}>
              <SelectTrigger className="h-7 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="count">Count</SelectItem>
                <SelectItem value="duration">Duration</SelectItem>
                <SelectItem value="off">Off</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Thickness">
            <Select
              value={dfg.edgeThicknessEncoding}
              onValueChange={(v) => setDfg({ edgeThicknessEncoding: v as typeof dfg.edgeThicknessEncoding })}
            >
              <SelectTrigger className="h-7 w-28 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="log">Log</SelectItem>
                <SelectItem value="linear">Linear</SelectItem>
                <SelectItem value="off">Off</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Layout">
            <Select
              value={dfg.layoutMode}
              onValueChange={(v) => setDfg({ layoutMode: v as typeof dfg.layoutMode })}
            >
              <SelectTrigger className="h-7 w-28 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="layered">Layered</SelectItem>
                <SelectItem value="temporal">Temporal</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>
        </div>
      </div>

      {isLoading ? (
        <CanvasSkeleton />
      ) : isError || !data ? (
        <CanvasError message={(error as Error)?.message ?? "Unknown error"} />
      ) : (
        <CanvasFrame>
          <DfgCanvas
            data={data}
            selectedNodeId={selected?.kind === "node" ? selected.id : null}
            selectedEdgeId={selected?.kind === "edge" ? selected.id : null}
            onSelect={setSelected}
            overlay={
              selected ? (
                <DfgDetailsPanel
                  data={data}
                  selectedNodeId={selected.kind === "node" ? selected.id : null}
                  selectedEdgeId={selected.kind === "edge" ? selected.id : null}
                  onClose={() => setSelected(null)}
                />
              ) : null
            }
          />
        </CanvasFrame>
      )}
    </>
  );
}

function RankSlider({
  label,
  fraction,
  shown,
  total,
  onChange,
}: {
  label: string;
  fraction: number;
  shown: number;
  total: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <Label className="w-24 shrink-0 text-xs text-muted-foreground font-normal">{label}</Label>
      <Slider
        value={[fraction]}
        min={0}
        max={1}
        step={0.005}
        onValueChange={(v) => onChange(v[0] ?? 0)}
        className="flex-1"
      />
      <span className="tabular-nums w-20 text-right text-muted-foreground shrink-0">
        {shown} / {total}
      </span>
    </div>
  );
}

function PetriAlphaTab({ logId }: { logId: string }) {
  const { data, isLoading, isError, error } = useDiscoveryPetriAlpha(logId);
  return (
    <>
      <PetriFilterBar />
      {isLoading ? (
        <CanvasSkeleton />
      ) : isError || !data ? (
        <CanvasError message={(error as Error)?.message ?? "Unknown error"} />
      ) : (
        <CanvasFrame>
          <PetriNetCanvas data={data} />
        </CanvasFrame>
      )}
    </>
  );
}

function PetriInductiveTab({ logId }: { logId: string }) {
  const { data, isLoading, isError, error } = useDiscoveryPetriInductive(logId);
  return (
    <>
      <PetriFilterBar />
      {isLoading ? (
        <CanvasSkeleton />
      ) : isError || !data ? (
        <CanvasError message={(error as Error)?.message ?? "Unknown error"} />
      ) : (
        <CanvasFrame>
          <PetriNetCanvas data={data} />
        </CanvasFrame>
      )}
    </>
  );
}

function PetriFilterBar() {
  const [petri, setPetri] = usePetriSettings();
  return (
    <FilterBar>
      <FilterField label="Show invisible (τ)">
        <Switch
          checked={petri.showInvisibleTransitions}
          onCheckedChange={(v) => setPetri({ showInvisibleTransitions: v })}
        />
      </FilterField>
      <FilterField label="Highlight markings">
        <Switch
          checked={petri.highlightMarkings}
          onCheckedChange={(v) => setPetri({ highlightMarkings: v })}
        />
      </FilterField>
      <FilterField label="Arc weights">
        <Switch
          checked={petri.showArcWeights}
          onCheckedChange={(v) => setPetri({ showArcWeights: v })}
        />
      </FilterField>
      <FilterField label="Transition label">
        <Select
          value={petri.transitionLabelMode}
          onValueChange={(v) => setPetri({ transitionLabelMode: v as typeof petri.transitionLabelMode })}
        >
          <SelectTrigger className="h-7 w-32 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="activity">Activity</SelectItem>
            <SelectItem value="id">ID</SelectItem>
            <SelectItem value="both">Both</SelectItem>
          </SelectContent>
        </Select>
      </FilterField>
    </FilterBar>
  );
}

function ProcessTreeTab({ logId }: { logId: string }) {
  const [pt, setPt] = useProcessTreeSettings();
  const { data, isLoading, isError, error } = useDiscoveryProcessTree(logId);

  return (
    <>
      <FilterBar>
        <FilterField label="Orientation">
          <Select
            value={pt.orientation}
            onValueChange={(v) => setPt({ orientation: v as typeof pt.orientation })}
          >
            <SelectTrigger className="h-7 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="vertical">Vertical</SelectItem>
              <SelectItem value="horizontal">Horizontal</SelectItem>
            </SelectContent>
          </Select>
        </FilterField>
        <FilterField label="Fold τ leaves">
          <Switch
            checked={pt.foldTauLeaves}
            onCheckedChange={(v) => setPt({ foldTauLeaves: v })}
          />
        </FilterField>
        <FilterField label="Max depth">
          <Select
            value={pt.maxDepth === null ? "all" : String(pt.maxDepth)}
            onValueChange={(v) => setPt({ maxDepth: v === "all" ? null : Number(v) })}
          >
            <SelectTrigger className="h-7 w-24 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="2">2</SelectItem>
              <SelectItem value="3">3</SelectItem>
              <SelectItem value="4">4</SelectItem>
              <SelectItem value="6">6</SelectItem>
              <SelectItem value="8">8</SelectItem>
            </SelectContent>
          </Select>
        </FilterField>
      </FilterBar>

      {isLoading ? (
        <CanvasSkeleton />
      ) : isError || !data ? (
        <CanvasError message={(error as Error)?.message ?? "Unknown error"} />
      ) : (
        <CanvasFrame>
          <ProcessTreeCanvas data={data} />
        </CanvasFrame>
      )}
    </>
  );
}

function HeuristicsTab({ logId }: { logId: string }) {
  const [heur, setHeur] = useHeuristicsRenderSettings();
  const { data: storedConfig } = useModuleConfig();
  const update = useUpdateModuleConfig();

  // Pull current thresholds from module config (fall back to defaults).
  const cfgThresholds = useMemo<Record<HeuristicsKey, number>>(() => {
    const cfg = (storedConfig?.config ?? {}) as Record<string, unknown>;
    return {
      heuristics_dependency_threshold: numberOr(
        cfg.heuristics_dependency_threshold,
        HEURISTICS_DEFAULTS.heuristics_dependency_threshold,
      ),
      heuristics_and_threshold: numberOr(
        cfg.heuristics_and_threshold,
        HEURISTICS_DEFAULTS.heuristics_and_threshold,
      ),
      heuristics_loop_two_threshold: numberOr(
        cfg.heuristics_loop_two_threshold,
        HEURISTICS_DEFAULTS.heuristics_loop_two_threshold,
      ),
    };
  }, [storedConfig]);

  // Local draft for the sliders — debounced commit to backend.
  const [draft, setDraft] = useState<Record<HeuristicsKey, number>>(cfgThresholds);
  useEffect(() => {
    setDraft(cfgThresholds);
  }, [cfgThresholds]);

  // Debounced persistence: 350ms after the last slider movement, PUT config.
  useEffect(() => {
    const same = HEURISTICS_KEYS.every((k) => Math.abs(draft[k] - cfgThresholds[k]) < 1e-6);
    if (same) return;
    const handle = setTimeout(() => {
      update.mutate({
        config: { ...(storedConfig?.config ?? {}), ...draft },
        enabled: storedConfig?.enabled ?? true,
      });
    }, 350);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const queryThresholds: HeuristicsThresholds = {
    dependency_threshold: draft.heuristics_dependency_threshold,
    and_threshold: draft.heuristics_and_threshold,
    loop_two_threshold: draft.heuristics_loop_two_threshold,
  };

  const { data, isLoading, isError, error } = useDiscoveryHeuristicsNet(logId, queryThresholds);

  return (
    <>
      <FilterBar>
        <ThresholdSlider
          label="Dependency"
          value={draft.heuristics_dependency_threshold}
          onChange={(v) => setDraft((d) => ({ ...d, heuristics_dependency_threshold: v }))}
        />
        <ThresholdSlider
          label="AND"
          value={draft.heuristics_and_threshold}
          onChange={(v) => setDraft((d) => ({ ...d, heuristics_and_threshold: v }))}
        />
        <ThresholdSlider
          label="Loop-2"
          value={draft.heuristics_loop_two_threshold}
          onChange={(v) => setDraft((d) => ({ ...d, heuristics_loop_two_threshold: v }))}
        />
        <FilterField label="Edge label">
          <Select
            value={heur.edgeLabel}
            onValueChange={(v) => setHeur({ edgeLabel: v as typeof heur.edgeLabel })}
          >
            <SelectTrigger className="h-7 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dependency">Dependency</SelectItem>
              <SelectItem value="count">Count</SelectItem>
              <SelectItem value="both">Both</SelectItem>
            </SelectContent>
          </Select>
        </FilterField>
        <FilterField label="Hide rare arcs">
          <Switch
            checked={heur.hideRareArcs}
            onCheckedChange={(v) => setHeur({ hideRareArcs: v })}
          />
        </FilterField>
      </FilterBar>

      {isLoading ? (
        <CanvasSkeleton />
      ) : isError || !data ? (
        <CanvasError message={(error as Error)?.message ?? "Unknown error"} />
      ) : (
        <CanvasFrame>
          <HeuristicsNetCanvas data={data} />
        </CanvasFrame>
      )}
    </>
  );
}

function ThresholdSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <FilterField label={label}>
      <div className="flex items-center gap-2 w-44">
        <Slider
          value={[value]}
          min={0}
          max={1}
          step={0.05}
          onValueChange={(v) => onChange(v[0] ?? 0)}
        />
        <span className="tabular-nums w-10 text-right text-muted-foreground">
          {value.toFixed(2)}
        </span>
      </div>
    </FilterField>
  );
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
