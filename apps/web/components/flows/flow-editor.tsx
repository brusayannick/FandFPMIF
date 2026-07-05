"use client";

import dynamic from "next/dynamic";

import { FlowCanvasSkeleton } from "@/components/flows/flow-canvas-skeleton";
import type { FlowDetail } from "@/lib/flow-queries";

// React Flow (@xyflow/react) + the editor subtree live in flow-editor-impl; load
// them in an async chunk so the /flows/[flowId] route's First Load JS stays small.
// ssr:false because the impl renders only a skeleton on the server anyway (flow
// data is client-fetched via useFlow) and React Flow needs real DOM to measure
// its ResizeObserver container.
const FlowEditorImpl = dynamic(
  () => import("./flow-editor-impl").then((m) => m.FlowEditor),
  { ssr: false, loading: () => <FlowCanvasSkeleton /> },
);

export function FlowEditor({ flow }: { flow: FlowDetail }) {
  return <FlowEditorImpl flow={flow} />;
}
