import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import type { ProcessNode, ProcessEdge } from "@/stores/process.store";
import type { NodeData } from "@/lib/schemas/graph";

export interface ModulePanelProps {
  processId: string;
  nodes: ProcessNode[];
  edges: ProcessEdge[];
  selectedNodeId: string | null;
  onNodeUpdate: (nodeId: string, data: Partial<NodeData>) => void;
}

export interface FrontendModuleManifest {
  moduleId: string;
  displayName: string;
  version: string;
  description?: string;
  icon: LucideIcon;
  panelComponent: ComponentType<ModulePanelProps>;
}

export interface BackendModuleManifest {
  module_id: string;
  display_name: string;
  version: string;
  description: string | null;
  config_schema: Record<string, unknown> | null;
}
