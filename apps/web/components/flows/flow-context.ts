"use client";

import { createContext, useContext } from "react";

/** Editor-wide context the custom node components consume - the flow id (for
 * node-data fetches), a `version` that bumps on every save (so a node's preview
 * refetches after its config changes), and callbacks to select / mutate a node. */
export interface FlowEditorContextValue {
  flowId: string;
  version: number;
  hasLog: boolean;
  selectNode: (id: string | null) => void;
  patchNodeData: (id: string, patch: Record<string, unknown>) => void;
}

export const FlowEditorContext = createContext<FlowEditorContextValue | null>(null);

export function useFlowEditor(): FlowEditorContextValue {
  const value = useContext(FlowEditorContext);
  if (!value) throw new Error("useFlowEditor must be used within the flow editor.");
  return value;
}
