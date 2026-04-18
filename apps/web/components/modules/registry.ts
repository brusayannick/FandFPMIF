import { BarChart3, Activity, FileInput, FileSpreadsheet } from "lucide-react";
import type { FrontendModuleManifest } from "@/components/modules/types";
import { ProcessAnalyticsPanel } from "./process_analytics/Panel";
import { ProcessSimulationPanel } from "./process_simulation/Panel";
import { BpmnImporterPanel } from "./bpmn_importer/Panel";
import { EventLogImporterPanel } from "./event_log_importer/Panel";

const manifests: FrontendModuleManifest[] = [
  {
    moduleId: "process_analytics",
    displayName: "Process Analytics",
    version: "1.0.0",
    description: "Bottleneck ranking, cycle-time distribution, and heatmap overlays.",
    icon: BarChart3,
    panelComponent: ProcessAnalyticsPanel,
  },
  {
    moduleId: "process_simulation",
    displayName: "Process Simulation",
    version: "1.0.0",
    description: "Monte Carlo simulation over the process graph.",
    icon: Activity,
    panelComponent: ProcessSimulationPanel,
  },
  {
    moduleId: "bpmn_importer",
    displayName: "BPMN Importer",
    version: "1.0.0",
    description: "Import BPMN 2.0 XML and convert to the platform graph schema.",
    icon: FileInput,
    panelComponent: BpmnImporterPanel,
  },
  {
    moduleId: "event_log_importer",
    displayName: "Event Log Importer",
    version: "1.0.0",
    description:
      "Upload XES/CSV event logs and discover a Directly-Follows Graph via pm4py.",
    icon: FileSpreadsheet,
    panelComponent: EventLogImporterPanel,
  },
];

const byId = new Map(manifests.map((m) => [m.moduleId, m]));

export function listModules(): FrontendModuleManifest[] {
  return manifests;
}

export function getModule(
  moduleId: string | null,
): FrontendModuleManifest | null {
  if (!moduleId) return null;
  return byId.get(moduleId) ?? null;
}
