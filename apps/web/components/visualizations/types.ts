/**
 * JSON shapes returned by the discovery / performance modules. Mirror of the
 * Python serialisers in `modules/discovery/serializers.py` and
 * `modules/performance/module.py`.
 */

export interface DfgActivity {
  id: string;
  label: string;
  frequency: number;
  /** Mean normalised position (0..1) of this activity within its trace.
   *  Populated by the discovery serializer from v3 onwards; absent on
   *  older cached payloads. */
  mean_trace_position?: number;
}

export interface DfgEdge {
  id: string;
  source: string;
  target: string;
  frequency: number;
  performance_seconds?: number;
  dependency?: number | null;
}

export interface DfgData {
  kind: "dfg" | "dfg_performance" | "heuristics_net";
  activities: DfgActivity[];
  edges: DfgEdge[];
  start_activities: Record<string, number>;
  end_activities: Record<string, number>;
}

export interface PetriPlace {
  id: string;
  label: string;
  is_initial: boolean;
  is_final: boolean;
  tokens: number;
}

export interface PetriTransition {
  id: string;
  label: string;
  is_invisible: boolean;
  name: string;
}

export interface PetriArc {
  id: string;
  source: string;
  target: string;
  weight: number;
}

export interface PetriNetData {
  kind: "petri_net";
  places: PetriPlace[];
  transitions: PetriTransition[];
  arcs: PetriArc[];
}

export type ProcessTreeOperator = "sequence" | "xor" | "parallel" | "loop" | "or";

export interface ProcessTreeNode {
  id: string;
  operator: ProcessTreeOperator | null;
  label: string | null;
  children: ProcessTreeNode[];
}

export interface ProcessTreeData {
  kind: "process_tree";
  root: ProcessTreeNode;
}
