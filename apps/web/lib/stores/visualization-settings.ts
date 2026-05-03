"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

// --------------------------------------------------------------------------
// Settings shapes
// --------------------------------------------------------------------------

export type LayoutDirection = "LR" | "TB" | "RL" | "BT";
export type EdgeRouting = "orthogonal" | "spline" | "straight";
export type FrequencyDisplayMode = "count" | "ratio" | "per-case";
export type Theme = "default" | "monochrome" | "colorblind";

export interface GeneralSettings {
  layoutDirection: LayoutDirection;
  edgeRouting: EdgeRouting;
  showMinimap: boolean;
  showGrid: boolean;
  nodeLabelMaxLength: number;
  frequencyDisplayMode: FrequencyDisplayMode;
  colorIntensity: number; // 0..1
  theme: Theme;
}

export interface DfgRenderSettings {
  /** Fraction of activities to show, sorted by frequency. 1 = all, 0.5 = top half. */
  activitiesShown: number;
  /** Fraction of edges to show, sorted by frequency, after the activity filter. */
  connectionsShown: number;
  hideSelfLoops: boolean;
  edgeLabel: "count" | "duration" | "off";
  edgeThicknessEncoding: "linear" | "log" | "off";
  /** "layered" = ELK Sugiyama (default; cleanest for cyclical DFGs).
   *  "temporal" = nodes positioned along the primary axis by their mean
   *  trace position; ELK only routes edges. Requires `mean_trace_position`
   *  on activities (discovery serializer v3+). */
  layoutMode: "layered" | "temporal";
}

export interface PetriRenderSettings {
  showInvisibleTransitions: boolean;
  transitionLabelMode: "activity" | "id" | "both";
  placeMode: "rings" | "count";
  highlightMarkings: boolean;
  showArcWeights: boolean;
}

export interface ProcessTreeRenderSettings {
  orientation: "vertical" | "horizontal";
  operatorStyle: "icon" | "text" | "abbrev";
  maxDepth: number | null;
  foldTauLeaves: boolean;
}

export interface HeuristicsRenderSettings {
  edgeLabel: "dependency" | "count" | "both";
  hideRareArcs: boolean;
}

export type VizKey = "dfg" | "petri" | "process_tree" | "heuristics";

export interface PerVizSettings {
  dfg?: DfgRenderSettings;
  petri?: PetriRenderSettings;
  process_tree?: ProcessTreeRenderSettings;
  heuristics?: HeuristicsRenderSettings;
}

export type NodePositions = Record<string, { x: number; y: number }>;

interface VizSettingsState {
  general: GeneralSettings;
  // perLog[logId][moduleId][vizKey] = render settings
  perLog: Record<string, Record<string, PerVizSettings>>;
  // positions[logId][moduleId][vizKey] = { nodeId: {x,y} }
  positions: Record<
    string,
    Record<string, Partial<Record<VizKey, NodePositions>>>
  >;

  setGeneral: (patch: Partial<GeneralSettings>) => void;
  resetGeneral: () => void;

  setDfg: (logId: string, moduleId: string, patch: Partial<DfgRenderSettings>) => void;
  setPetri: (logId: string, moduleId: string, patch: Partial<PetriRenderSettings>) => void;
  setProcessTree: (logId: string, moduleId: string, patch: Partial<ProcessTreeRenderSettings>) => void;
  setHeuristics: (logId: string, moduleId: string, patch: Partial<HeuristicsRenderSettings>) => void;

  resetForLog: (logId: string, moduleId?: string) => void;

  setNodePosition: (logId: string, moduleId: string, viz: VizKey, nodeId: string, pos: { x: number; y: number }) => void;
  setNodePositions: (logId: string, moduleId: string, viz: VizKey, patch: NodePositions) => void;
  resetPositions: (logId: string, moduleId: string, viz?: VizKey) => void;
}

// --------------------------------------------------------------------------
// Defaults
// --------------------------------------------------------------------------

export const DEFAULT_GENERAL: GeneralSettings = {
  // Top-to-bottom by default — matches Celonis's DFG and is what most process
  // mining tooling defaults to. Users can switch to LR via Settings → General.
  layoutDirection: "TB",
  edgeRouting: "orthogonal",
  showMinimap: true,
  showGrid: true,
  nodeLabelMaxLength: 32,
  frequencyDisplayMode: "count",
  colorIntensity: 0.6,
  theme: "default",
};

export const DEFAULT_DFG: DfgRenderSettings = {
  activitiesShown: 1,
  connectionsShown: 1,
  hideSelfLoops: false,
  edgeLabel: "count",
  edgeThicknessEncoding: "log",
  layoutMode: "layered",
};

export const DEFAULT_PETRI: PetriRenderSettings = {
  showInvisibleTransitions: true,
  transitionLabelMode: "activity",
  placeMode: "rings",
  highlightMarkings: true,
  showArcWeights: true,
};

export const DEFAULT_PROCESS_TREE: ProcessTreeRenderSettings = {
  orientation: "vertical",
  operatorStyle: "icon",
  maxDepth: null,
  foldTauLeaves: false,
};

export const DEFAULT_HEURISTICS: HeuristicsRenderSettings = {
  edgeLabel: "both",
  hideRareArcs: false,
};

// --------------------------------------------------------------------------
// Helpers — set into nested per-(log, module) record without losing siblings.
// --------------------------------------------------------------------------

function patchPerViz<K extends keyof PerVizSettings>(
  perLog: VizSettingsState["perLog"],
  logId: string,
  moduleId: string,
  key: K,
  defaults: NonNullable<PerVizSettings[K]>,
  patch: Partial<NonNullable<PerVizSettings[K]>>,
): VizSettingsState["perLog"] {
  const log = perLog[logId] ?? {};
  const mod = log[moduleId] ?? {};
  const current = (mod[key] ?? defaults) as NonNullable<PerVizSettings[K]>;
  const next = { ...current, ...patch } as PerVizSettings[K];
  return {
    ...perLog,
    [logId]: { ...log, [moduleId]: { ...mod, [key]: next } },
  };
}

function patchPositions(
  positions: VizSettingsState["positions"],
  logId: string,
  moduleId: string,
  viz: VizKey,
  patch: NodePositions,
): VizSettingsState["positions"] {
  const log = positions[logId] ?? {};
  const mod = log[moduleId] ?? {};
  const current = mod[viz] ?? {};
  return {
    ...positions,
    [logId]: {
      ...log,
      [moduleId]: { ...mod, [viz]: { ...current, ...patch } },
    },
  };
}

// --------------------------------------------------------------------------
// Store
// --------------------------------------------------------------------------

export const useVizSettings = create<VizSettingsState>()(
  persist(
    (set) => ({
      general: { ...DEFAULT_GENERAL },
      perLog: {},
      positions: {},

      setGeneral: (patch) => set((s) => ({ general: { ...s.general, ...patch } })),
      resetGeneral: () => set({ general: { ...DEFAULT_GENERAL } }),

      setDfg: (logId, moduleId, patch) =>
        set((s) => ({ perLog: patchPerViz(s.perLog, logId, moduleId, "dfg", DEFAULT_DFG, patch) })),
      setPetri: (logId, moduleId, patch) =>
        set((s) => ({ perLog: patchPerViz(s.perLog, logId, moduleId, "petri", DEFAULT_PETRI, patch) })),
      setProcessTree: (logId, moduleId, patch) =>
        set((s) => ({
          perLog: patchPerViz(s.perLog, logId, moduleId, "process_tree", DEFAULT_PROCESS_TREE, patch),
        })),
      setHeuristics: (logId, moduleId, patch) =>
        set((s) => ({ perLog: patchPerViz(s.perLog, logId, moduleId, "heuristics", DEFAULT_HEURISTICS, patch) })),

      resetForLog: (logId, moduleId) =>
        set((s) => {
          const log = s.perLog[logId];
          if (!log) return {};
          if (!moduleId) {
            const next = { ...s.perLog };
            delete next[logId];
            return { perLog: next };
          }
          const nextLog = { ...log };
          delete nextLog[moduleId];
          return { perLog: { ...s.perLog, [logId]: nextLog } };
        }),

      setNodePosition: (logId, moduleId, viz, nodeId, pos) =>
        set((s) => ({ positions: patchPositions(s.positions, logId, moduleId, viz, { [nodeId]: pos }) })),
      setNodePositions: (logId, moduleId, viz, patch) =>
        set((s) => ({ positions: patchPositions(s.positions, logId, moduleId, viz, patch) })),
      resetPositions: (logId, moduleId, viz) =>
        set((s) => {
          const log = s.positions[logId];
          if (!log) return {};
          const mod = log[moduleId];
          if (!mod) return {};
          if (!viz) {
            const nextLog = { ...log };
            delete nextLog[moduleId];
            return { positions: { ...s.positions, [logId]: nextLog } };
          }
          const nextMod = { ...mod };
          delete nextMod[viz];
          return { positions: { ...s.positions, [logId]: { ...log, [moduleId]: nextMod } } };
        }),
    }),
    {
      name: "ff.viz-settings.v1",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      version: 2,
      migrate: (persisted: unknown, version: number) => {
        // v1 → v2: flip stale `layoutDirection: "LR"` to the new TB default.
        // We can't blindly stomp it (a user may have intentionally chosen LR)
        // but anyone still on v1 hasn't seen the new default yet, so the
        // upgrade path is to align them with it.
        if (version < 2 && persisted && typeof persisted === "object") {
          const p = persisted as { general?: GeneralSettings };
          return {
            ...p,
            general: {
              ...DEFAULT_GENERAL,
              ...p.general,
              layoutDirection: "TB",
            },
          };
        }
        return persisted as VizSettingsState;
      },
    },
  ),
);

// --------------------------------------------------------------------------
// Convenience selectors
// --------------------------------------------------------------------------

export function selectDfg(state: VizSettingsState, logId: string, moduleId: string): DfgRenderSettings {
  return state.perLog[logId]?.[moduleId]?.dfg ?? DEFAULT_DFG;
}

export function selectPetri(state: VizSettingsState, logId: string, moduleId: string): PetriRenderSettings {
  return state.perLog[logId]?.[moduleId]?.petri ?? DEFAULT_PETRI;
}

export function selectProcessTree(state: VizSettingsState, logId: string, moduleId: string): ProcessTreeRenderSettings {
  return state.perLog[logId]?.[moduleId]?.process_tree ?? DEFAULT_PROCESS_TREE;
}

export function selectHeuristics(state: VizSettingsState, logId: string, moduleId: string): HeuristicsRenderSettings {
  return state.perLog[logId]?.[moduleId]?.heuristics ?? DEFAULT_HEURISTICS;
}

// Stable reference for the "no persisted positions yet" case. Returning a
// fresh `{}` from the selector would change identity on every call and put
// Zustand subscribers into an infinite re-render loop.
const EMPTY_POSITIONS: NodePositions = Object.freeze({}) as NodePositions;

export function selectNodePositions(
  state: VizSettingsState,
  logId: string,
  moduleId: string,
  viz: VizKey,
): NodePositions {
  return state.positions[logId]?.[moduleId]?.[viz] ?? EMPTY_POSITIONS;
}
